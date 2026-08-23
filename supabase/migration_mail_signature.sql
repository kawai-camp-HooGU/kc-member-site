-- ============================================================
-- メールアカウントに署名を追加（P0）
--   送信・返信・新規作成時に本文末尾へ自動挿入する差出署名。
--   アカウントごとに設定（例：会社名・連絡先・フッター）。
-- ============================================================
alter table public.mail_accounts
  add column if not exists signature text not null default '';

comment on column public.mail_accounts.signature is
  'アカウント別の署名。メール作成時に本文末尾へ自動挿入する。';
