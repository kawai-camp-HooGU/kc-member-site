-- ============================================================
-- LINEアカウント／メールアカウントに「特記事項」（複数行メモ）を追加
-- ============================================================
alter table public.line_accounts add column if not exists notes text not null default '';
alter table public.mail_accounts add column if not exists notes text not null default '';
