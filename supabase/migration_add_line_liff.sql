-- ============================================================
-- Phase 5：LIFF連携。アカウントごとに LIFF ID を保持する。
--   LIFFアプリ（LINEログインチャネル配下）のIDを登録し、LINE内でフォームを開く。
--   LIFF ID は公開値（クライアントに露出する）ため暗号化不要。
-- ============================================================
alter table public.line_accounts add column if not exists liff_id text not null default '';
