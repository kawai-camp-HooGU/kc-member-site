-- ============================================================
-- migration_add_ai_consult_sessions.sql のロールバック
--   ⚠️ 先にアプリを戻すこと。テーブルが無くても API は動く（履歴なしで進む）ため、
--      消すだけなら壊れないが、相談の記録は失われる。
-- ============================================================
drop table if exists public.ai_consult_turns;
drop table if exists public.ai_consult_sessions;
