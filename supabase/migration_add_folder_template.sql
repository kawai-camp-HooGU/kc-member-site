-- ============================================================
-- フォルダ管理：テンプレート への展開
--   templates に folder_id を追加（folders テーブルを scope='template' で共用）。
--   folders / folder_role_shares / RLS は migration_add_folders.sql で作成済み。
-- ============================================================
alter table public.templates
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_templates_folder on public.templates(folder_id);
comment on column public.templates.folder_id is '所属フォルダ（null=未分類）';
