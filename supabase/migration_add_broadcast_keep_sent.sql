-- ============================================================
-- 一斉配信：送信履歴（送信ボックス）を残すオプション
--   既定は false（従来どおり Sent への保存をスキップ＝大量送信の負荷軽減）。
--   true のとき、送信元メールアカウントの Sent フォルダへ各通を保存する。
--   ※ 環境変数SMTP（送信元アカウント未選択）では Sent 保存はできない。
-- ============================================================
alter table public.broadcasts
  add column if not exists keep_sent_copy boolean not null default false;

comment on column public.broadcasts.keep_sent_copy is
  '送信履歴を送信ボックス(Sent)へ残すか。送信元メールアカウント選択時のみ有効。';

-- ロールバック（必要時のみ）
-- alter table public.broadcasts drop column if exists keep_sent_copy;
