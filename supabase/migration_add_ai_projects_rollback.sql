-- ============================================================
-- migration_add_ai_projects.sql のロールバック
--   ⚠️ 消しても挙動は変わらない（設定は環境変数とコード既定へフォールバックする）。
--   ⚠️ 設定を作り込んだあとに消すと、その内容は失われる。
--      revisions ごと消えるので、必要なら先に控えを取ること。
-- ============================================================
drop table if exists public.ai_project_config_revisions;
drop table if exists public.ai_project_configs;
drop table if exists public.ai_projects;
