-- ============================================================
-- 体験シナリオ基盤（REQ-067）の切り戻し
--
--   ⚠️ 危険：体験の履歴と成果物がすべて消える。
--      bot_trial_artifacts.body には利用者が作ったものが入っている。
--      戻す前に、残す必要があるかを必ず確認すること。
--
--   ⚠️ bot_share_links の追加列は drop すると発行済みURLの設定が消える。
--      列の削除は既定でコメントアウトしてある。
--      「体験レーンだけ止めたい」なら、列は残したまま
--      update public.bot_share_links set scenario_id = null;
--      で全URLを従来のQ&Aボットに戻せる（無害・可逆）。
--
--   適用: Supabase コンソール → SQL Editor
-- ============================================================

-- ── 依存の深い順に落とす ──
drop table if exists public.bot_trial_reviews;
drop table if exists public.bot_trial_artifacts;
drop table if exists public.bot_trial_usage;
drop table if exists public.bot_trial_runs;

-- ── 体験版URL側の追加列 ──
--   ⚠️ scenario_id は bot_trial_scenarios への FK なので、
--      シナリオ表を落とす前にこの列を落とす必要がある。
alter table public.bot_share_links
  drop column if exists scenario_id,
  drop column if exists gen_used_count;

-- 設定と上限は消すと発行済みURLの意図が失われる。必要なときだけ手で外す。
-- alter table public.bot_share_links
--   drop column if exists settings,
--   drop column if exists gen_limit,
--   drop column if exists assumed_users;

drop table if exists public.bot_trial_scenarios;

-- ── 画像単価の列 ──
--   他の用途で使い始めていたら消さない。既定はコメントアウト。
-- delete from public.ai_model_prices where model like 'gpt-image-1:%';
-- alter table public.ai_model_prices drop column if exists image_jpy_per_unit;
