-- ============================================================
-- 利益分配レポート（P4）のロールバック
--
--   ⚠️ 分配先・分配ルール・確定済みの分配額が**すべて消えます**。
--      確定済みの月がある場合、支払いの根拠が残らなくなります。
--      実行前に必ず share_entries / share_periods を書き出してください：
--
--        select * from public.share_entries order by period, id;
--        select * from public.share_periods order by period;
--
--   migration_add_pl_ledger.sql が作ったテーブルには手を触れません。
-- ============================================================

drop policy if exists "share_entries_ops_all" on public.share_entries;
drop policy if exists "share_periods_ops_all" on public.share_periods;
drop policy if exists "share_rules_ops_all"   on public.profit_share_rules;
drop policy if exists "partners_ops_all"      on public.partners;

-- 依存の深い順に落とす
drop table if exists public.share_entries;
drop table if exists public.share_periods;
drop table if exists public.profit_share_rules;
drop table if exists public.partners;
