-- ============================================================
-- フォルダ管理：お知らせ / 流入経路 / ブックマーク への展開
--   news・sources・chat_bookmarks に folder_id を追加。
--   folders / folder_role_shares / RLS は migration_add_folders.sql で作成済み。
-- ============================================================
alter table public.news
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_news_folder on public.news(folder_id);
comment on column public.news.folder_id is '所属フォルダ（null=未分類）';

alter table public.sources
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_sources_folder on public.sources(folder_id);
comment on column public.sources.folder_id is '所属フォルダ（null=未分類）';

alter table public.chat_bookmarks
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_chat_bookmarks_folder on public.chat_bookmarks(folder_id);
comment on column public.chat_bookmarks.folder_id is '所属フォルダ（null=未分類）';
