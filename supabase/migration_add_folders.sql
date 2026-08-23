-- ============================================================
-- フォルダ管理（全画面共通の土台）
--   一斉配信・シナリオ・フォーム・テンプレート・属性・お知らせ・
--   流入経路・コンテンツ・ブックマークの各一覧に「フォルダ」を追加する。
--
--   ・folders            … 全画面共通。scope 列で画面を分ける（単一テーブル）
--   ・folder_role_shares … フォルダ×ロールの共有（ロール単位のみ）
--   ・各レコード側は folder_id を1列足すだけ（今回は broadcasts のみ）
--
--   共有＝「フォルダの見え方」の制御。画面そのものの表示可否は
--   role_permissions（FEATURES の screen 権限）が本丸で、こちらは別レイヤー。
--   作成者ロールはデフォルト共有（オーナー相当）。管理者は全フォルダを閲覧・管理。
-- ============================================================

-- ── 現在ユーザーのロールキー（既存 current_member_role() の別名）──────────
--   spec と lib/folders.ts に合わせて current_role_key() を用意する。
--   派生ロールも roles を見る current_member_role() 側で解決される。
create or replace function public.current_role_key()
returns text
language sql stable security definer set search_path = public
as $$ select public.current_member_role() $$;
grant execute on function public.current_role_key() to authenticated;

-- ── folders ────────────────────────────────────────────────
create table if not exists public.folders (
  id          bigint generated always as identity primary key,
  scope       text        not null,                       -- 'broadcast' | 'scenario' | 'form' | 'template' | 'attribute' | 'news' | 'source' | 'content' | 'bookmark'
  name        text        not null,
  parent_id   bigint      references public.folders(id) on delete set null,  -- 将来の入れ子用（当面 null）
  visibility  text        not null default 'role',         -- 'private'（作成者ロールのみ）| 'role'（指定ロール）| 'public'（全運営）
  owner_role  text        not null,                        -- 作成者ロール（デフォルト共有・オーナー相当）
  created_by  uuid,                                        -- 監査用（auth.uid）
  sort_order  int         not null default 0,
  is_deleted  boolean     not null default false,          -- 論理削除（マスタ方針に合わせる）
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_folders_scope on public.folders(scope) where is_deleted = false;

comment on table  public.folders            is '全画面共通フォルダ。scope で画面を分ける';
comment on column public.folders.scope      is '対象画面のキー（broadcast / scenario / form / template / attribute / news / source / content / bookmark）';
comment on column public.folders.visibility is 'private=作成者ロールのみ / role=指定ロール / public=全運営';
comment on column public.folders.owner_role is '作成者ロール。デフォルト共有かつオーナー相当（共有設定を変更できる）';

-- ── folder_role_shares（ロール単位の共有）───────────────────
create table if not exists public.folder_role_shares (
  folder_id  bigint  not null references public.folders(id) on delete cascade,
  role_key   text    not null references public.roles(key) on delete cascade,
  access     text    not null default 'view',              -- 'edit' | 'view'
  primary key (folder_id, role_key)
);
create index if not exists idx_folder_shares_role on public.folder_role_shares(role_key);

comment on table public.folder_role_shares is 'フォルダ×ロールの追加共有（ロール単位）。access= edit/view';

-- ── レコード側：broadcasts に folder_id を追加（今回の縦通し対象）──────────
alter table public.broadcasts
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_broadcasts_folder on public.broadcasts(folder_id);

comment on column public.broadcasts.folder_id is '所属フォルダ（null=未分類。フォルダ削除時は set null で「すべて」へ戻る）';

-- ============================================================
-- RLS
--   folders            … SELECT は「管理者 or 全体公開 or 作成者ロール or 共有先ロール」
--                        書き込みは「管理者 or 作成者ロール」
--   folder_role_shares … SELECT は運営全員／書き込みは「管理者 or フォルダのオーナーロール」
--   ※ レコード（broadcasts）自体は従来どおり ops_only。フォルダは見え方の制御。
-- ============================================================
alter table public.folders            enable row level security;
alter table public.folder_role_shares enable row level security;

-- folders --------------------------------------------------
drop policy if exists folders_select on public.folders;
create policy folders_select on public.folders for select to authenticated
using (
  public.is_ops() and (
       public.is_admin()
    or visibility = 'public'
    or owner_role = public.current_role_key()
    or exists (
         select 1 from public.folder_role_shares s
         where s.folder_id = folders.id
           and s.role_key  = public.current_role_key()
       )
  )
);

drop policy if exists folders_insert on public.folders;
create policy folders_insert on public.folders for insert to authenticated
with check ( public.is_ops() and owner_role = public.current_role_key() );

drop policy if exists folders_update on public.folders;
create policy folders_update on public.folders for update to authenticated
using      ( public.is_admin() or owner_role = public.current_role_key() )
with check ( public.is_admin() or owner_role = public.current_role_key() );

drop policy if exists folders_delete on public.folders;
create policy folders_delete on public.folders for delete to authenticated
using ( public.is_admin() or owner_role = public.current_role_key() );

-- folder_role_shares ---------------------------------------
drop policy if exists folder_shares_select on public.folder_role_shares;
create policy folder_shares_select on public.folder_role_shares for select to authenticated
using ( public.is_ops() );

drop policy if exists folder_shares_insert on public.folder_role_shares;
create policy folder_shares_insert on public.folder_role_shares for insert to authenticated
with check (
  public.is_admin() or exists (
    select 1 from public.folders f
    where f.id = folder_id and f.owner_role = public.current_role_key()
  )
);

drop policy if exists folder_shares_update on public.folder_role_shares;
create policy folder_shares_update on public.folder_role_shares for update to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.folders f
    where f.id = folder_id and f.owner_role = public.current_role_key()
  )
)
with check (
  public.is_admin() or exists (
    select 1 from public.folders f
    where f.id = folder_id and f.owner_role = public.current_role_key()
  )
);

drop policy if exists folder_shares_delete on public.folder_role_shares;
create policy folder_shares_delete on public.folder_role_shares for delete to authenticated
using (
  public.is_admin() or exists (
    select 1 from public.folders f
    where f.id = folder_id and f.owner_role = public.current_role_key()
  )
);
