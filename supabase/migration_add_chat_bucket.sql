-- ============================================================
-- チャット添付：Storage バケットの作成とポリシー
--
--   【なぜ必要か】
--     migration_add_chat.sql はテーブル（chat_attachments）とそのRLSは作るが、
--     **バケットの作成と storage.objects のポリシーを一切作っていなかった。**
--     そのため lib/chatStorage.ts の upload() が毎回
--       {"statusCode":"404","error":"Bucket not found"}
--     で失敗し、catch に握り潰され、添付は一度も保存されていなかった
--     （2026-08-21 実測：chat_attachments は全会話で0件、バケットも不在）。
--     利用者からは「画像が表示されない・空の吹き出しが出る」に見えていた。
--
--   【作るもの】
--     1. 非公開バケット chat-attachments（20MB上限）
--     2. storage.objects のポリシー
--        ・運営（管理者/オペレーター）… 全操作
--        ・会員                        … 自分の会話フォルダ配下のみ 参照・追加
--     パスは {conversationId}/{messageId}/{timestamp}_{name} なので、
--     先頭フォルダ名＝会話ID で判定できる。
--
--   ⚠️ 何度実行しても安全（on conflict do nothing／drop policy if exists）。
--   ⚠️ 既存の添付データはそもそも無いため、移行は不要。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ロールバック: migration_add_chat_bucket_rollback.sql
-- ============================================================

-- ── 1. バケット ────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit)
values ('chat-attachments', 'chat-attachments', false, 20971520)   -- 20MB（MAX_ATTACH_BYTES と一致させる）
on conflict (id) do nothing;

-- ── 2. ポリシー ────────────────────────────────────────────
-- 運営（管理者・オペレーター）：全会話の添付を読み書きできる
drop policy if exists "chat_bucket_ops_all" on storage.objects;
create policy "chat_bucket_ops_all" on storage.objects for all to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.current_member_role() in ('管理者', 'オペレーター')
  )
  with check (
    bucket_id = 'chat-attachments'
    and public.current_member_role() in ('管理者', 'オペレーター')
  );

-- 会員：自分の会話フォルダ配下だけ参照できる
drop policy if exists "chat_bucket_member_select" on storage.objects;
create policy "chat_bucket_member_select" on storage.objects for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select c.id::text from public.chat_conversations c
       where c.member_id = public.current_member_id()
    )
  );

-- 会員：自分の会話フォルダ配下だけ追加できる（更新・削除は与えない）
drop policy if exists "chat_bucket_member_insert" on storage.objects;
create policy "chat_bucket_member_insert" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and (storage.foldername(name))[1] in (
      select c.id::text from public.chat_conversations c
       where c.member_id = public.current_member_id()
    )
  );
