-- ============================================================
-- REQ-036 返金・解約を経費／出金につなぐ
--
--   確認事項 5b を採用：返金が「完了扱い＋返金完了日時あり」に到達したら
--   expenses に実体行を1本生成する（refund_id で1:1に紐付く）。
--   これにより出金の消込は既存の expense 経路にそのまま乗る（cash 側は無改修）。
--
--   ・売上経費一覧では refund_id 付きの経費行を「返金」区分として表示し、
--     refunds からは行を作らない（二重計上を原理的に起こさない）。
--   ・経費一覧（/ops/expenses）では refund_id 付きの行を出さない（確認事項 6a）。
--
--   既存列の変更・削除はしない。追加列はすべて NULL 可で、
--   値が無ければ現行とまったく同じ挙動になる。
-- ============================================================

-- ── refunds：経費科目と出金の情報 ────────────────────────────
alter table public.refunds
  add column if not exists expense_category_id  bigint references public.expense_categories(id) on delete set null,
  add column if not exists payout_site_id       bigint references public.payment_sites(id)      on delete set null,
  add column if not exists payout_method_id     bigint references public.payment_methods(id)    on delete set null,
  add column if not exists payout_expected_date date;

comment on column public.refunds.expense_category_id  is '経費科目。生成する経費行の category_id になる';
comment on column public.refunds.payout_site_id       is '出金経路（payment_sites を経費と共用）';
comment on column public.refunds.payout_method_id     is '出金方法（payment_methods を経費と共用）';
comment on column public.refunds.payout_expected_date is '出金予定日。NULL なら refunded_at の日付を使う（確認事項 8a）';

create index if not exists refunds_member_idx on public.refunds(member_id) where is_deleted = false;

-- ── expenses：どの返金から生まれた行かを持つ ─────────────────
alter table public.expenses
  add column if not exists refund_id bigint references public.refunds(id) on delete cascade;

comment on column public.expenses.refund_id is
  '返金・解約から自動生成された経費行。NULL は手入力の経費。経費一覧には出さず、売上経費一覧で「返金」区分として表示する';

-- 1返金につき経費行は1本だけ（二重計上の防止をDBでも担保する）
create unique index if not exists expenses_refund_uniq on public.expenses(refund_id) where refund_id is not null;

-- ── バックフィル：既存の「完了扱い」返金ぶんの経費行を作る ───
--   ※ 画面側は「経費行が無ければ従来どおり refunds から1行を出す」ので、
--      これを流さなくても表示は壊れない。流したほうが状態が揃う。
insert into public.expenses (
  paid_at, accrual_date, expected_date,
  category_id, site_id, method_id,
  vendor_name, amount, fee_amount, recognized_amount,
  currency, note, is_fee_manual, is_date_manual,
  external_source, external_txn_id, refund_id
)
select
  r.refunded_at,
  (r.refunded_at at time zone 'Asia/Tokyo')::date,
  coalesce(r.payout_expected_date, (r.refunded_at at time zone 'Asia/Tokyo')::date),
  r.expense_category_id, r.payout_site_id, r.payout_method_id,
  coalesce(nullif(r.customer_name, ''), nullif(r.customer_email, ''), '（氏名なし）'),
  r.refund_amount, 0, r.refund_amount,
  'JPY',
  coalesce(nullif(r.reason, ''), r.note),
  true, true,
  'refund', '',
  r.id
from public.refunds r
join public.refund_masters m on m.id = r.status_id and m.is_done = true
where r.is_deleted = false
  and r.refunded_at is not null
  and not exists (select 1 from public.expenses e where e.refund_id = r.id);
