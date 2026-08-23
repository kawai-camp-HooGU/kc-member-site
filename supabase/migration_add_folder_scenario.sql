-- ============================================================
-- フォルダ管理：シナリオ配信への展開
--   scenarios に folder_id を追加（一斉配信と同じ folders テーブルを scope='scenario' で共用）。
--   folders / folder_role_shares / RLS は migration_add_folders.sql で作成済み。
-- ============================================================
alter table public.scenarios
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_scenarios_folder on public.scenarios(folder_id);

comment on column public.scenarios.folder_id is '所属フォルダ（null=未分類。フォルダ削除時は「すべて」へ戻る）';
