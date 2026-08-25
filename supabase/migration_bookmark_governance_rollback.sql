-- ============================================================
-- REQ-032 の切り戻し
--   ⚠️ 列を落とすと publish_scope / review_status / 参照実績が失われる。
--      索引側は再同期すれば元に戻る（visibility が 'public' 固定に戻る）。
--      アプリのデプロイを先に戻してから実行すること。
-- ============================================================
drop function if exists public.bookmark_mark_used(bigint[]);
drop function if exists public.bookmark_search_ops(uuid, text, int);

drop index if exists public.cbm_scope_idx;
drop index if exists public.cbm_review_idx;
drop index if exists public.cbm_valid_idx;

alter table public.chat_bookmarks drop constraint if exists chat_bookmarks_publish_scope_chk;
alter table public.chat_bookmarks drop constraint if exists chat_bookmarks_review_status_chk;

alter table public.chat_bookmarks drop column if exists replaced_by_id;
alter table public.chat_bookmarks drop column if exists used_count;
alter table public.chat_bookmarks drop column if exists last_used_at;
alter table public.chat_bookmarks drop column if exists valid_until;
alter table public.chat_bookmarks drop column if exists variables;
alter table public.chat_bookmarks drop column if exists review_status;
alter table public.chat_bookmarks drop column if exists publish_scope;
