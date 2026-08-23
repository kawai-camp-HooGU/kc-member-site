-- ============================================================
-- Phase 7①：リッチメッセージ（Flex/カード/カルーセル/ボタン/クイックリプライ）
--   配信・シナリオの本文に、LINE向けのリッチメッセージ(JSON)を持たせる。
--   未設定ならこれまで通りテキスト本文（message_body）を送る（後方互換）。
--   JSONで保持するため、種別追加はアプリ側のみで拡張できる。
-- ============================================================
alter table public.broadcasts      add column if not exists message_json jsonb;
alter table public.scenario_steps  add column if not exists message_json jsonb;
