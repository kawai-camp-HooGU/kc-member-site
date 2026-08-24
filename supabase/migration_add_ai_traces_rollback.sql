-- ============================================================
-- migration_add_ai_traces.sql のロールバック
--   ⚠️ ai_traces / ai_feedback のデータは失われる。
--   ⚠️ 先にアプリ側を切り戻す（AI_TRACE_ENABLED=false で記録を止める）こと。
-- ============================================================

-- 権限キー
delete from public.role_permissions where feature = 'ai_trace';

-- bot_public_logs の追加列（trace_id は ai_traces を drop する前に落とす）
alter table public.bot_public_logs drop column if exists trace_id;
alter table public.bot_public_logs drop column if exists confidence;
alter table public.bot_public_logs drop column if exists sources;
alter table public.bot_public_logs drop column if exists answer;

-- 関数
drop function if exists public.ai_usage_summary(int);
drop function if exists public.ai_usage_bump(int, text);
drop function if exists public.ai_usage_minute_bump(int);

-- テーブル（依存の順に）
drop table if exists public.ai_feedback;
drop table if exists public.ai_usage_minute;
drop table if exists public.ai_usage;
drop table if exists public.ai_model_prices;
drop table if exists public.ai_traces;
