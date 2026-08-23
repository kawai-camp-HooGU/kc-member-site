-- ============================================================
-- ロールマスタの新設（パターン3：オペレーター派生ロールのマスタ化）
--
--   これまで：ロールは members.role / role_permissions.role の
--             CHECK 制約に4値を直書き。増やすたびにスキーマ変更が必要。
--   これから：roles マスタを新設し、CHECK を FK に置換。
--             ロール追加＝roles への INSERT だけで済む。
--
--   ★設計の核：派生できるのは「オペレーター」からのみ（derived_must_be_operator）。
--     これにより派生ロールの DB 権限が確定し、既存の RLS ポリシーを
--     一切書き換えずに新ロールを追加できる。
--
--   ⚠️ roles.key は既存データに合わせて日本語名をそのまま使う。
--      これにより members / role_permissions の既存行を書き換えずに済み、
--      is_admin() 内の `= '管理者'` 比較もそのまま生き残る。
--
--   適用順：本ファイル → （アプリ側デプロイ）
--   切り戻し：migration_add_roles_master_rollback.sql
-- ============================================================

-- ------------------------------------------------------------
-- 1. roles テーブル
-- ------------------------------------------------------------
create table if not exists public.roles (
  key        text primary key,
  label      text not null,
  is_system  boolean not null default false,
  base_role  text references public.roles(key),
  sort_order int not null default 100,
  created_at timestamptz not null default now(),

  -- ★派生できるのはオペレーターのみ。
  --   将来パターン1（自由な階層）へ移行する場合はこの制約を緩める。
  constraint derived_must_be_operator
    check (is_system or base_role = 'オペレーター')
);

comment on table  public.roles is 'ロールマスタ。is_system=true はシステム固定ロール（編集・削除不可）';
comment on column public.roles.key       is 'ロールキー。members.role / role_permissions.role から参照される';
comment on column public.roles.base_role is '派生元ロール。システム固定ロールは null、派生ロールは必ず「オペレーター」';

-- ------------------------------------------------------------
-- 2. システム固定4ロールの投入
--    ※ base_role は null（is_system=true なので CHECK を通る）
-- ------------------------------------------------------------
insert into public.roles (key, label, is_system, base_role, sort_order) values
  ('管理者',       '管理者',       true, null, 10),
  ('オペレーター', 'オペレーター', true, null, 20),
  ('メンバー',     'メンバー',     true, null, 30),
  ('外部',         '外部',         true, null, 40)
on conflict (key) do nothing;

-- ------------------------------------------------------------
-- 3. 孤児データの救済
--    FK を張る前に、roles に存在しないロールを持つ行がないか確認する。
--    （過去の「リーダー」など、改称漏れが残っている可能性への保険）
-- ------------------------------------------------------------
do $$
declare
  orphan text;
begin
  select string_agg(distinct m.role, ', ')
    into orphan
    from public.members m
   where m.role is not null
     and not exists (select 1 from public.roles r where r.key = m.role);

  if orphan is not null then
    raise exception 'members に未登録のロールが存在します: %  先に roles へ追加するかデータを修正してください', orphan;
  end if;

  select string_agg(distinct rp.role, ', ')
    into orphan
    from public.role_permissions rp
   where not exists (select 1 from public.roles r where r.key = rp.role);

  if orphan is not null then
    raise notice 'role_permissions の未登録ロール行を削除します: %', orphan;
    delete from public.role_permissions rp
     where not exists (select 1 from public.roles r where r.key = rp.role);
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. CHECK 制約 → 外部キーへの置換
-- ------------------------------------------------------------
-- members：使用中のロールは削除させない（RESTRICT）
alter table public.members drop constraint if exists members_role_check;
alter table public.members drop constraint if exists members_role_fk;
alter table public.members
  add constraint members_role_fk
  foreign key (role) references public.roles(key)
  on update cascade on delete restrict;

-- role_permissions：ロール削除時に権限設定行も消す（CASCADE）
alter table public.role_permissions drop constraint if exists role_permissions_role_check;
alter table public.role_permissions drop constraint if exists role_permissions_role_fk;
alter table public.role_permissions
  add constraint role_permissions_role_fk
  foreign key (role) references public.roles(key)
  on update cascade on delete cascade;

-- members.role での絞り込み・集計（ロール別の使用中人数）を効かせる
create index if not exists idx_members_role on public.members(role);

-- ------------------------------------------------------------
-- 5. システム固定ロールの保護
--    RLS だけでは service_role キーで回避できるため、トリガーで防御する。
--    あわせて base_role の書き換え（権限昇格の経路）も禁止する。
-- ------------------------------------------------------------
create or replace function public.protect_roles()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'DELETE' then
    if OLD.is_system then
      raise exception 'システム固定ロール「%」は削除できません', OLD.key;
    end if;
    return OLD;
  end if;

  -- UPDATE
  if OLD.is_system and (NEW.key <> OLD.key or NEW.is_system = false) then
    raise exception 'システム固定ロール「%」のキー・種別は変更できません', OLD.key;
  end if;

  -- ★権限昇格の防止：派生元は後から変更させない
  if NEW.base_role is distinct from OLD.base_role then
    raise exception '派生元ロールは変更できません（ロールを作り直してください）';
  end if;

  -- 派生ロールを固定ロールに昇格させることも禁止
  if not OLD.is_system and NEW.is_system then
    raise exception '派生ロールをシステム固定ロールに変更することはできません';
  end if;

  return NEW;
end $$;

drop trigger if exists trg_protect_roles on public.roles;
create trigger trg_protect_roles
  before update or delete on public.roles
  for each row execute function public.protect_roles();

-- ------------------------------------------------------------
-- 6. RLS（role_permissions と同方針：読み取り＝全員 / 書き込み＝管理者のみ）
--    ⚠️ 読み取りは全ユーザーに開放する。各ユーザーが自分の実効ロールを
--       解決するために roles を参照する必要があるため。
-- ------------------------------------------------------------
alter table public.roles enable row level security;

drop policy if exists "roles_read_all"     on public.roles;
drop policy if exists "roles_insert_admin" on public.roles;
drop policy if exists "roles_update_admin" on public.roles;
drop policy if exists "roles_delete_admin" on public.roles;

create policy "roles_read_all" on public.roles
  for select to authenticated using (true);

create policy "roles_insert_admin" on public.roles
  for insert to authenticated with check (public.is_admin());

create policy "roles_update_admin" on public.roles
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "roles_delete_admin" on public.roles
  for delete to authenticated using (public.is_admin());

-- ------------------------------------------------------------
-- 7. is_ops() のマスタ参照化
--
--    ★本マイグレーションで挙動が変わりうる唯一の関数。
--      ただし派生ロールが0件のうちは、返り値は従来と完全に一致する。
--
--    これを書き換えるだけで、is_ops() を参照している全 RLS ポリシー
--    （events / payments / chat / attributes / content_files /
--      hide_member_names ビュー等）に派生ロールが一括で反映される。
-- ------------------------------------------------------------
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.key in ('管理者', 'オペレーター')
        or r.base_role = 'オペレーター'
      from public.roles r
     where r.key = public.current_member_role()
  ), false)
$$;

grant execute on function public.is_ops() to authenticated;

-- ------------------------------------------------------------
-- 8. 権限マスタの初期値コピー用ヘルパー
--    ロール追加時に、指定ロールの権限設定を丸ごと複製する。
--    （クライアントから複数 upsert を投げるより原子的で速い）
-- ------------------------------------------------------------
create or replace function public.copy_role_permissions(src_role text, dst_role text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if not public.is_admin() then
    raise exception '権限がありません';
  end if;
  if not exists (select 1 from public.roles where key = dst_role) then
    raise exception 'コピー先ロールが存在しません: %', dst_role;
  end if;

  insert into public.role_permissions (role, feature, enabled)
  select dst_role, rp.feature, rp.enabled
    from public.role_permissions rp
   where rp.role = src_role
  on conflict (role, feature) do update set enabled = excluded.enabled;

  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.copy_role_permissions(text, text) to authenticated;

-- ------------------------------------------------------------
-- 9. Realtime（members / role_permissions と揃える）
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.roles;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;
