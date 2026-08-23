-- ============================================================
-- 一斉配信 メール配信の拡張
--   ③ メール件名（一斉配信タイトルとは別に、メールの件名として使う）
--   ④ 送信元メールアカウント（mail_accounts.id）。指定時はそのアカウントのSMTPで送る
--
--   ※ 何度実行しても安全（add column if not exists）
-- ============================================================

alter table public.broadcasts
  -- ③ メール件名（空のときは従来どおり title をフォールバック件名に使う）
  add column if not exists mail_subject text not null default '',
  -- ④ 送信元メールアカウント（null=環境変数SMTPで送信 / 値あり=そのアカウントのSMTP）
  add column if not exists mail_account_id bigint
    references public.mail_accounts(id) on delete set null;

comment on column public.broadcasts.mail_subject is
  'メール配信の件名。一斉配信タイトル（管理用）とは別。空なら title をフォールバック。';
comment on column public.broadcasts.mail_account_id is
  '送信元メールアカウント（mail_accounts.id）。null=環境変数SMTP、値あり=そのアカウントのSMTPで送信。';
