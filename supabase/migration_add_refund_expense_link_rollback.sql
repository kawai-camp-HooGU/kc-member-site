-- ============================================================
-- REQ-036 ロールバック
--   ⚠️ 生成済みの経費行を先に消す。列だけ落とすと
--      「どの経費が返金由来か」が分からなくなり、二重計上が残る。
-- ============================================================

-- 1) 返金から生成された経費行を消す（消込があれば道連れで消す）
delete from public.cash_allocations
 where source_type = 'expense'
   and source_id in (select id from public.expenses where refund_id is not null);

delete from public.expenses where refund_id is not null;

-- 2) 列とインデックスを落とす
drop index if exists public.expenses_refund_uniq;
alter table public.expenses drop column if exists refund_id;

drop index if exists public.refunds_member_idx;
alter table public.refunds
  drop column if exists expense_category_id,
  drop column if exists payout_site_id,
  drop column if exists payout_method_id,
  drop column if exists payout_expected_date;
