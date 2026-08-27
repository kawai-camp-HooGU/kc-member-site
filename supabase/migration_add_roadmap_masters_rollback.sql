-- ============================================================
-- migration_add_roadmap_masters.sql のロールバック
--
--   ⚠️ プロジェクトに設定した「区分」とフェーズに設定した「進捗ステータス」は
--      すべて失われる。マスタの中身（区分名・色・ステータス定義）も消える。
--      戻すなら先に下の退避クエリでバックアップを取ること。
--
--   退避（任意）:
--     create table bk_project_categories as select * from public.project_categories;
--     create table bk_phase_statuses     as select * from public.phase_statuses;
--     create table bk_projects_category  as select id, category_id from public.projects;
--     create table bk_anken_status       as select id, status_id   from public.anken;
-- ============================================================

-- Realtime から外す（無ければ何もしない）
do $$
begin
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'phase_statuses'
  ) then
    alter publication supabase_realtime drop table public.phase_statuses;
  end if;
  if exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_categories'
  ) then
    alter publication supabase_realtime drop table public.project_categories;
  end if;
end $$;

-- 参照列（FK が付いているのでテーブルより先に落とす）
drop index if exists public.idx_anken_status;
alter table public.anken    drop column if exists status_id;

drop index if exists public.idx_projects_category;
alter table public.projects drop column if exists category_id;

-- マスタ本体
drop table if exists public.phase_statuses;
drop table if exists public.project_categories;
