-- ============================================================
-- Phase 3：LINEトークもブックマーク（ナレッジ）に登録できるようにする
--   既存 chat_bookmarks を共通ナレッジとして流用（アプリ内トーク＋LINEで共通化）。
--   ・source_channel …'app'（アプリ内トーク）/ 'line'（LINEトーク）
--   ・source_line_message_id … LINEの場合の登録元（line_messages.id ＝内部ID）
--   AI返信提案（reply-suggest）は ai_enabled のブックマークを channel 横断で参照する。
-- ============================================================
alter table public.chat_bookmarks
  add column if not exists source_channel text not null default 'app';
alter table public.chat_bookmarks
  add column if not exists source_line_message_id bigint;

create index if not exists chat_bookmarks_line_msg_idx
  on public.chat_bookmarks(source_line_message_id) where source_line_message_id is not null;
create index if not exists chat_bookmarks_channel_idx
  on public.chat_bookmarks(source_channel) where is_deleted = false;
