-- ============================================================
-- migration_add_bot_sessions.sql のロールバック
--   ⚠️ 先にアプリを戻すこと。テーブルが無くても API は動く（履歴なしで進む）ため、
--      消すだけなら壊れないが、会話の記録は失われる。
-- ============================================================
drop table if exists public.bot_messages;
drop table if exists public.bot_sessions;
