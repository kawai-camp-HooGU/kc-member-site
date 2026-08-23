-- ============================================================
-- LINEアカウントのアイコン画像URLを保持（外枠ヘッダーでの表示用）
--   接続テスト（getBotInfo）で取得した pictureUrl を保存する。公開URLのため暗号化不要。
-- ============================================================
alter table public.line_accounts add column if not exists picture_url text;
