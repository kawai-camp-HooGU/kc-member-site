-- ============================================================
-- 売上経費PL管理 ロールバック
--
--   migration_add_pl_ledger.sql を巻き戻す。
--
--   ⚠️ 新規テーブルの drop はデータを失う。実行前に必ず内容を確認すること。
--      本番で実行する場合は、先に pg_dump でバックアップを取る。
--
--   ⚠️ 既存テーブル（payments / payment_sites）への追加列は、既定では
--      「残す」方針にしている（列が残っていてもアプリは壊れないため）。
--      完全に戻したい場合のみ、末尾のブロックのコメントを外して実行する。
-- ============================================================

-- ── 1. ビュー ───────────────────────────────────────────────
drop view if exists public.v_settlement;

-- ── 2. 新規テーブル（依存の逆順）─────────────────────────────
drop table if exists public.import_rows       cascade;
drop table if exists public.import_jobs       cascade;
drop table if exists public.cash_allocations  cascade;
drop table if exists public.cash_entries      cascade;
drop table if exists public.expenses          cascade;
drop table if exists public.expense_categories cascade;
drop table if exists public.public_holidays   cascade;

-- ── 3. 追加した索引 ─────────────────────────────────────────
drop index if exists public.payments_accrual_idx;
drop index if exists public.payments_expected_idx;
drop index if exists public.payments_dedup_idx;
drop index if exists public.payments_job_idx;
drop index if exists public.payments_ext_uk;


-- ── 4. 既存テーブルの追加列（既定では実行しない）─────────────
--   列を残しても既存アプリは動作する。データを失う操作のため、
--   本当に戻す必要があるときだけコメントを外すこと。
--
-- alter table public.payments
--   drop column if exists accrual_date,
--   drop column if exists expected_date,
--   drop column if exists fee_amount,
--   drop column if exists is_fee_manual,
--   drop column if exists is_date_manual,
--   drop column if exists external_source,
--   drop column if exists external_txn_id,
--   drop column if exists dedup_hash,
--   drop column if exists import_job_id;
--
-- alter table public.payment_sites
--   drop column if exists cycle_type,
--   drop column if exists closing_day,
--   drop column if exists month_offset,
--   drop column if exists payment_day,
--   drop column if exists offset_days,
--   drop column if exists day_type,
--   drop column if exists holiday_shift,
--   drop column if exists fee_rate,
--   drop column if exists fee_fixed,
--   drop column if exists fee_rounding,
--   drop column if exists transfer_fee,
--   drop column if exists auto_calc;
