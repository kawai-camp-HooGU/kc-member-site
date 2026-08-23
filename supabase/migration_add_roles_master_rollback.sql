-- ============================================================
-- migration_add_roles_master.sql の切り戻し
--
--   ⚠️ 実行前に必ず確認すること：
--      派生ロール（is_system=false）を持つメンバーが存在すると、
--      CHECK 制約の復元に失敗する。先に該当メンバーのロールを
--      システム固定4ロールのいずれかへ戻すこと。
--
--      確認クエリ：
--        select m.id, m.name, m.role
--          from public.members m
--          join public.roles r on r.key = m.role
--         where r.is_system = false;
-- ============================================================

-- ------------------------------------------------------------
-- 0. 事前チェック（派生ロール使用中なら中断）
-- ------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n
    from public.members m
    join public.roles r on r.key = m.role
   where r.is_system = false;

  if n > 0 then
    raise exception '派生ロールを使用中のメンバーが %件 あります。先にロールを付け替えてください', n;
  end if;
end $$;

-- ------------------------------------------------------------
-- 1. is_ops() を旧定義へ戻す
-- ------------------------------------------------------------
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() in ('管理者', 'オペレーター'), false)
$$;

-- ------------------------------------------------------------
-- 2. ヘルパー関数の削除
-- ------------------------------------------------------------
drop function if exists public.copy_role_permissions(text, text);

-- ------------------------------------------------------------
-- 3. 派生ロールの権限設定行を削除
-- ------------------------------------------------------------
delete from public.role_permissions rp
 where exists (
   select 1 from public.roles r
    where r.key = rp.role and r.is_system = false
 );

-- ------------------------------------------------------------
-- 4. FK → CHECK 制約へ戻す
-- ------------------------------------------------------------
alter table public.members drop constraint if exists members_role_fk;
alter table public.members
  add constraint members_role_check
  check (role in ('管理者', 'オペレーター', 'メンバー', '外部'));

alter table public.role_permissions drop constraint if exists role_permissions_role_fk;
alter table public.role_permissions
  add constraint role_permissions_role_check
  check (role in ('管理者', 'オペレーター', 'メンバー', '外部'));

drop index if exists public.idx_members_role;

-- ------------------------------------------------------------
-- 5. roles テーブルと保護トリガーの削除
-- ------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime drop table public.roles;
exception
  when others then null;
end $$;

drop trigger  if exists trg_protect_roles on public.roles;
drop function if exists public.protect_roles();
drop table    if exists public.roles;
