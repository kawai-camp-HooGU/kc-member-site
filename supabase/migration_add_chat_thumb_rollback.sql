-- ============================================================
-- migration_add_chat_thumb.sql のロールバック
--
--   ⚠️ 列を落とすと、生成済みの縮小版ファイルへの参照が失われる。
--      Storage 側の *_thumb.jpg は残るため、不要なら別途削除する。
--   ⚠️ アプリ側のコード（lib/chatStorage.ts / lib/chat.ts）を先に戻すこと。
--      列だけ落とすと insert が失敗する。
-- ============================================================

alter table public.chat_attachments
  drop column if exists thumb_path;
