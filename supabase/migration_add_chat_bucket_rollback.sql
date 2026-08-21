-- ============================================================
-- migration_add_chat_bucket.sql のロールバック
--
--   ⚠️ バケットを消すと、保存済みの添付ファイルが**すべて失われます**。
--      ポリシーだけを外したい場合は、下の drop policy の3行だけを実行すること。
--      バケット削除（最下部）は既定でコメントアウトしてあります。
-- ============================================================

drop policy if exists "chat_bucket_ops_all"       on storage.objects;
drop policy if exists "chat_bucket_member_select" on storage.objects;
drop policy if exists "chat_bucket_member_insert" on storage.objects;

-- ⚠️ 中身ごと消えます。本当に消してよいときだけコメントを外してください。
-- delete from storage.objects where bucket_id = 'chat-attachments';
-- delete from storage.buckets where id = 'chat-attachments';
