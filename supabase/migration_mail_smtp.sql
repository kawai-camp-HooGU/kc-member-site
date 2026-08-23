-- ============================================================
-- メール：送信（SMTP）対応（Step 4）
--   アカウントごとに SMTP 送信するためのホスト/ポートを追加。
--   認証は IMAP と同じユーザー/パスワードを流用する（imap_user + 暗号化パスワード）。
-- ============================================================
alter table public.mail_accounts
  add column if not exists smtp_host text not null default '',
  add column if not exists smtp_port int  not null default 465;

comment on column public.mail_accounts.smtp_host is 'SMTP送信ホスト（空なら送信不可）。認証は imap_user＋暗号化パスワードを流用';
