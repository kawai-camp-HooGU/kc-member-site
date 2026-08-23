-- ============================================================
-- Phase 5c：LIFF IDトークン検証用に LINEログインチャネルID を保持する。
--   マイページ（LIFF）は会員情報（PII）を表示するため、userId を信用せず
--   ID トークンをサーバーで検証して本人特定する。その検証に client_id として
--   LINEログインチャネルのチャネルIDが必要になる（公開値・暗号化不要）。
--   未設定の場合はマイページの本人検証ができないため表示を拒否する（fail-closed）。
-- ============================================================
alter table public.line_accounts add column if not exists login_channel_id text not null default '';
