-- ============================================================
-- ⚠️⚠️ 前提が未確認です（2026-08-20 追記）⚠️⚠️
--
--   このファイルの内容は、接続先を誤ったDB（別プロジェクト）の実態に
--   基づいて作られています。次はいずれも KAWAI CAMP では未確認です：
--     ・決済サイト名 'Stripe' / '銀行振込' / 'PayPal' が存在すること
--     ・商品種別 type_id 1〜3 / 決済方法 method_id 1〜3 が存在すること
--     ・members が 19件あること（mrn の割り当てが 1〜19 前提）
--     ・既存シードの判定条件 customer_email like '%@example.com'
--
--   ★ 対象DBを確定し、再棚卸しを行ってから内容を見直すこと。
--   ★ そのまま実行しないこと。
-- ============================================================

-- ============================================================
-- 売上経費PL管理 デモ用サンプルデータ（動作確認用）
--
--   目的：P1〜P4 の動作確認に使うデータを用意する。
--         実運用データが1件も無いため、これが無いと消込・月次PL・
--         利益分配レポートの検証ができない。
--
--   ⚠️ このファイルは【データを変更する】。適用前に必ず内容を確認すること。
--   ⚠️ migration_add_pl_ledger.sql を先に適用しておくこと。
--   ⚠️ 投入後は末尾の「取り消し」ブロックで一括除去できる。
--
--   構成：
--     ① 決済サイトマスタ3件に入金サイクル・手数料率を設定
--     ② 既存のシードデータ（payments 5件 / refunds 2件）を論理削除
--     ③ 売上 42件（2026-06〜08 / Stripe・銀行振込・PayPal / 未照合3件）
--     ④ 経費 13件（2026-06〜08）
--     ⑤ 入出金＋消込（6月・7月は消込済み。8月は未入金のまま残す）
-- ============================================================

begin;

-- ── ① 決済サイトマスタの設定 ───────────────────────────────
--   ⚠️ 手数料率・入金サイクルは一般的な公表値に基づく仮値。
--      実契約のレートに必ず置き換えること。
update public.payment_sites set
  cycle_type = 'offset', offset_days = 4, day_type = 'business', holiday_shift = 'after',
  fee_rate = 3.600, fee_fixed = 0, fee_rounding = 'floor', transfer_fee = 250, auto_calc = true
where name = 'Stripe';

update public.payment_sites set
  cycle_type = 'offset', offset_days = 3, day_type = 'business', holiday_shift = 'after',
  fee_rate = 3.600, fee_fixed = 40, fee_rounding = 'floor', transfer_fee = 250, auto_calc = true
where name = 'PayPal';

update public.payment_sites set
  cycle_type = 'none', offset_days = 0, day_type = 'calendar', holiday_shift = 'none',
  fee_rate = 0, fee_fixed = 0, fee_rounding = 'floor', transfer_fee = 0, auto_calc = true
where name = '銀行振込';


-- ── ② 既存シードの論理削除（確認事項7d）────────────────────
--   物理削除はしない。is_deleted を立てるだけなので元に戻せる。
--   対象：customer_email が @example.com のもの（= seed.sql 由来）
update public.payments
   set is_deleted = true
 where not is_deleted
   and customer_email like '%@example.com';

update public.refunds
   set is_deleted = true
 where not is_deleted
   and customer_email like '%@example.com';
--   ※ refunds 側は customer_email が空の可能性がある。実行前に必ず確認すること：
--     select id, customer_email, refund_amount, status_id from public.refunds where not is_deleted;
--     空だった場合は id を直接指定して落とす：
--     update public.refunds set is_deleted = true where id in (1,2);


-- ── ③ 売上 42件 ────────────────────────────────────────────
--   member_id は既存 members を id 昇順に並べた n 番目に割り当てる。
--   mrn=999 の行は該当なし → 未照合（unmatched）として残る。
insert into public.payments (
  paid_at, accrual_date, expected_date, type_id, site_id, method_id,
  amount, fee_amount, recognized_amount,
  external_source, external_txn_id,
  customer_name, customer_email, member_id, status, currency, note
)
select
  v.paid_at, v.accrual_date, v.expected_date, v.type_id, v.site_id, v.method_id,
  v.amount, v.fee, v.amount - v.fee,
  v.src, v.txn,
  coalesce(m.name, ''),
  coalesce(nullif(m.email, ''), v.fallback_mail),
  m.id,
  case when m.id is null then 'unmatched' else 'matched' end,
  'JPY',
  'サンプルデータ'
from (values
  (timestamptz '2026-06-01 09:00:00+09', date '2026-06-01', date '2026-06-07', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0001', 1, 'demo01@example.invalid'),
  (timestamptz '2026-06-03 10:07:00+09', date '2026-06-03', date '2026-06-09', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0002', 2, 'demo02@example.invalid'),
  (timestamptz '2026-06-05 11:14:00+09', date '2026-06-05', date '2026-06-11', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0003', 3, 'demo03@example.invalid'),
  (timestamptz '2026-06-07 12:21:00+09', date '2026-06-07', date '2026-06-13', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0004', 4, 'demo04@example.invalid'),
  (timestamptz '2026-06-09 13:28:00+09', date '2026-06-09', date '2026-06-15', 2, 1, 1, 98000, 3527, 'stripe', 'ch_demo_0005', 999, 'demo05@example.invalid'),
  (timestamptz '2026-06-11 14:35:00+09', date '2026-06-11', date '2026-06-11', 2, 2, 2, 98000, 0, 'bank', '', 6, 'demo06@example.invalid'),
  (timestamptz '2026-06-13 15:42:00+09', date '2026-06-13', date '2026-06-13', 1, 2, 2, 9800, 0, 'bank', '', 7, 'demo07@example.invalid'),
  (timestamptz '2026-06-15 16:49:00+09', date '2026-06-15', date '2026-06-20', 1, 3, 1, 9800, 392, 'paypal', 'pp_demo_0008', 8, 'demo08@example.invalid'),
  (timestamptz '2026-06-17 17:56:00+09', date '2026-06-17', date '2026-06-23', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0009', 9, 'demo09@example.invalid'),
  (timestamptz '2026-06-19 18:03:00+09', date '2026-06-19', date '2026-06-25', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0010', 10, 'demo10@example.invalid'),
  (timestamptz '2026-06-21 09:10:00+09', date '2026-06-21', date '2026-06-27', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0011', 11, 'demo11@example.invalid'),
  (timestamptz '2026-06-23 10:17:00+09', date '2026-06-23', date '2026-06-23', 3, 2, 2, 19800, 0, 'bank', '', 12, 'demo12@example.invalid'),
  (timestamptz '2026-06-25 11:24:00+09', date '2026-06-25', date '2026-07-01', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0013', 13, 'demo13@example.invalid'),
  (timestamptz '2026-06-27 12:31:00+09', date '2026-06-27', date '2026-07-02', 2, 3, 1, 98000, 3567, 'paypal', 'pp_demo_0014', 14, 'demo14@example.invalid'),
  (timestamptz '2026-07-01 09:00:00+09', date '2026-07-01', date '2026-07-07', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0015', 15, 'demo15@example.invalid'),
  (timestamptz '2026-07-03 10:07:00+09', date '2026-07-03', date '2026-07-09', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0016', 16, 'demo16@example.invalid'),
  (timestamptz '2026-07-05 11:14:00+09', date '2026-07-05', date '2026-07-11', 2, 1, 1, 98000, 3527, 'stripe', 'ch_demo_0017', 17, 'demo17@example.invalid'),
  (timestamptz '2026-07-07 12:21:00+09', date '2026-07-07', date '2026-07-13', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0018', 18, 'demo18@example.invalid'),
  (timestamptz '2026-07-09 13:28:00+09', date '2026-07-09', date '2026-07-15', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0019', 999, 'demo19@example.invalid'),
  (timestamptz '2026-07-11 14:35:00+09', date '2026-07-11', date '2026-07-11', 1, 2, 2, 9800, 0, 'bank', '', 1, 'demo20@example.invalid'),
  (timestamptz '2026-07-13 15:42:00+09', date '2026-07-13', date '2026-07-19', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0021', 2, 'demo21@example.invalid'),
  (timestamptz '2026-07-15 16:49:00+09', date '2026-07-15', date '2026-07-20', 3, 3, 1, 19800, 752, 'paypal', 'pp_demo_0022', 3, 'demo22@example.invalid'),
  (timestamptz '2026-07-17 17:56:00+09', date '2026-07-17', date '2026-07-23', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0023', 4, 'demo23@example.invalid'),
  (timestamptz '2026-07-19 18:03:00+09', date '2026-07-19', date '2026-07-25', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0024', 5, 'demo24@example.invalid'),
  (timestamptz '2026-07-21 09:10:00+09', date '2026-07-21', date '2026-07-21', 2, 2, 2, 98000, 0, 'bank', '', 6, 'demo25@example.invalid'),
  (timestamptz '2026-07-23 10:17:00+09', date '2026-07-23', date '2026-07-29', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0026', 7, 'demo26@example.invalid'),
  (timestamptz '2026-07-25 11:24:00+09', date '2026-07-25', date '2026-07-31', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0027', 8, 'demo27@example.invalid'),
  (timestamptz '2026-07-27 12:31:00+09', date '2026-07-27', date '2026-08-02', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0028', 9, 'demo28@example.invalid'),
  (timestamptz '2026-07-28 13:38:00+09', date '2026-07-28', date '2026-08-02', 1, 3, 1, 9800, 392, 'paypal', 'pp_demo_0029', 10, 'demo29@example.invalid'),
  (timestamptz '2026-08-01 09:00:00+09', date '2026-08-01', date '2026-08-07', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0030', 11, 'demo30@example.invalid'),
  (timestamptz '2026-08-03 10:07:00+09', date '2026-08-03', date '2026-08-09', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0031', 12, 'demo31@example.invalid'),
  (timestamptz '2026-08-05 11:14:00+09', date '2026-08-05', date '2026-08-11', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0032', 13, 'demo32@example.invalid'),
  (timestamptz '2026-08-07 12:21:00+09', date '2026-08-07', date '2026-08-13', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0033', 999, 'demo33@example.invalid'),
  (timestamptz '2026-08-09 13:28:00+09', date '2026-08-09', date '2026-08-09', 1, 2, 2, 9800, 0, 'bank', '', 15, 'demo34@example.invalid'),
  (timestamptz '2026-08-11 14:35:00+09', date '2026-08-11', date '2026-08-17', 2, 1, 1, 98000, 3527, 'stripe', 'ch_demo_0035', 16, 'demo35@example.invalid'),
  (timestamptz '2026-08-13 15:42:00+09', date '2026-08-13', date '2026-08-19', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0036', 17, 'demo36@example.invalid'),
  (timestamptz '2026-08-15 16:49:00+09', date '2026-08-15', date '2026-08-20', 1, 3, 1, 9800, 392, 'paypal', 'pp_demo_0037', 18, 'demo37@example.invalid'),
  (timestamptz '2026-08-17 17:56:00+09', date '2026-08-17', date '2026-08-23', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0038', 19, 'demo38@example.invalid'),
  (timestamptz '2026-08-19 18:03:00+09', date '2026-08-19', date '2026-08-25', 3, 1, 1, 19800, 712, 'stripe', 'ch_demo_0039', 1, 'demo39@example.invalid'),
  (timestamptz '2026-08-21 09:10:00+09', date '2026-08-21', date '2026-08-27', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0040', 2, 'demo40@example.invalid'),
  (timestamptz '2026-08-23 10:17:00+09', date '2026-08-23', date '2026-08-23', 2, 2, 2, 98000, 0, 'bank', '', 3, 'demo41@example.invalid'),
  (timestamptz '2026-08-25 11:24:00+09', date '2026-08-25', date '2026-08-31', 1, 1, 1, 9800, 352, 'stripe', 'ch_demo_0042', 4, 'demo42@example.invalid')
) as v(paid_at, accrual_date, expected_date, type_id, site_id, method_id,
       amount, fee, src, txn, mrn, fallback_mail)
left join (
  select id, name, email, row_number() over (order by id) as rn
  from public.members where not is_deleted
) m on m.rn = v.mrn;


-- ── ④ 経費 13件 ────────────────────────────────────────────
--   category_id は expense_categories の sort_order で引く
--   （1=広告宣伝費 2=外注費 3=システム利用料 4=支払手数料 5=返金 6=人件費 7=その他）
insert into public.expenses (
  paid_at, accrual_date, expected_date, category_id, site_id, method_id,
  amount, fee_amount, recognized_amount,
  vendor_name, vendor_invoice_no, currency, note
)
select
  v.paid_at, v.accrual_date, v.expected_date,
  c.id, v.site_id, v.method_id,
  v.amount, 0, v.amount,
  v.vendor, v.inv, 'JPY',
  v.memo || ' / サンプルデータ'
from (values
  (timestamptz '2026-06-05 00:00:00+09', date '2026-06-05', date '2026-06-05', 1, 2, 2, 330000, '株式会社ADworks', 'T1234567890123', '6月分 リスティング広告'),
  (timestamptz '2026-06-10 00:00:00+09', date '2026-06-10', date '2026-06-10', 2, 2, 2, 180000, '山田 太郎（外注）', '', '6月分 動画編集'),
  (timestamptz '2026-06-01 00:00:00+09', date '2026-06-01', date '2026-06-01', 3, 1, 1, 3900, 'Supabase Inc.', '', 'Pro プラン'),
  (timestamptz '2026-06-20 00:00:00+09', date '2026-06-20', date '2026-06-20', 6, 2, 2, 250000, '業務委託 A', 'T9876543210987', '6月分 運営代行'),
  (timestamptz '2026-07-05 00:00:00+09', date '2026-07-05', date '2026-07-05', 1, 2, 2, 280000, '株式会社ADworks', 'T1234567890123', '7月分 リスティング広告'),
  (timestamptz '2026-07-10 00:00:00+09', date '2026-07-10', date '2026-07-10', 2, 2, 2, 210000, '山田 太郎（外注）', '', '7月分 動画編集'),
  (timestamptz '2026-07-01 00:00:00+09', date '2026-07-01', date '2026-07-01', 3, 1, 1, 3900, 'Supabase Inc.', '', 'Pro プラン'),
  (timestamptz '2026-07-20 00:00:00+09', date '2026-07-20', date '2026-07-20', 6, 2, 2, 250000, '業務委託 A', 'T9876543210987', '7月分 運営代行'),
  (timestamptz '2026-07-28 00:00:00+09', date '2026-07-28', date '2026-07-28', 7, 2, 2, 44000, '税理士事務所B', 'T5555555555555', '7月分 顧問料'),
  (timestamptz '2026-08-05 00:00:00+09', date '2026-08-05', date '2026-08-05', 1, 2, 2, 310000, '株式会社ADworks', 'T1234567890123', '8月分 リスティング広告'),
  (timestamptz '2026-08-01 00:00:00+09', date '2026-08-01', date '2026-08-01', 3, 1, 1, 3900, 'Supabase Inc.', '', 'Pro プラン'),
  (timestamptz '2026-08-10 00:00:00+09', date '2026-08-10', date '2026-08-10', 2, 2, 2, 195000, '山田 太郎（外注）', '', '8月分 動画編集'),
  (timestamptz '2026-08-20 00:00:00+09', date '2026-08-20', date '2026-08-20', 6, 2, 2, 250000, '業務委託 A', 'T9876543210987', '8月分 運営代行')
) as v(paid_at, accrual_date, expected_date, cat_order, site_id, method_id,
       amount, vendor, inv, memo)
left join public.expense_categories c
  on c.sort_order = v.cat_order and not c.is_deleted;


-- ── ⑤ 入出金＋消込 ─────────────────────────────────────────
--   6月・7月の Stripe 分をまとめて着金させ、振込手数料の差額を
--   着金1件につき1行だけ吸収する（明細への按分はしない）。
--   8月分は入金させず「未入金」として残す（滞留表示の確認用）。

-- 6月 Stripe（7/6 着金）
with e as (
  insert into public.cash_entries
    (direction, entry_date, site_id, account_name, amount, description, adjustments, external_payout_id)
  select 'in', date '2026-07-06', s.id, 'Stripe残高',
         (select coalesce(sum(p.recognized_amount),0) from public.payments p
           where p.site_id = s.id and p.accrual_date between date '2026-06-01' and date '2026-06-30'
             and not p.is_deleted and p.note = 'サンプルデータ') - 250,
         'ストライプジヤパン（カ',
         '[{"kind":"transfer_fee","amount":250,"memo":"Stripe 振込手数料"}]'::jsonb,
         'po_demo_202606'
  from public.payment_sites s where s.name = 'Stripe'
  returning id
)
insert into public.cash_allocations (cash_entry_id, source_type, source_id, amount)
select e.id, 'payment', p.id, p.recognized_amount
from e
join public.payment_sites s on s.name = 'Stripe'
join public.payments p on p.site_id = s.id
 and p.accrual_date between date '2026-06-01' and date '2026-06-30'
 and not p.is_deleted and p.note = 'サンプルデータ';

-- 7月 Stripe（8/5 着金）
with e as (
  insert into public.cash_entries
    (direction, entry_date, site_id, account_name, amount, description, adjustments, external_payout_id)
  select 'in', date '2026-08-05', s.id, 'Stripe残高',
         (select coalesce(sum(p.recognized_amount),0) from public.payments p
           where p.site_id = s.id and p.accrual_date between date '2026-07-01' and date '2026-07-31'
             and not p.is_deleted and p.note = 'サンプルデータ') - 250,
         'ストライプジヤパン（カ',
         '[{"kind":"transfer_fee","amount":250,"memo":"Stripe 振込手数料"}]'::jsonb,
         'po_demo_202607'
  from public.payment_sites s where s.name = 'Stripe'
  returning id
)
insert into public.cash_allocations (cash_entry_id, source_type, source_id, amount)
select e.id, 'payment', p.id, p.recognized_amount
from e
join public.payment_sites s on s.name = 'Stripe'
join public.payments p on p.site_id = s.id
 and p.accrual_date between date '2026-07-01' and date '2026-07-31'
 and not p.is_deleted and p.note = 'サンプルデータ';

-- 6〜7月 経費の支払（出金・差額なし）
with e as (
  insert into public.cash_entries
    (direction, entry_date, site_id, account_name, amount, description, adjustments)
  select 'out', date '2026-07-31', s.id, '三菱UFJ 普通',
         (select coalesce(sum(x.recognized_amount),0) from public.expenses x
           where x.accrual_date between date '2026-06-01' and date '2026-07-31'
             and not x.is_deleted and x.note like '%サンプルデータ'),
         '6-7月分 経費支払', '[]'::jsonb
  from public.payment_sites s where s.name = '銀行振込'
  returning id
)
insert into public.cash_allocations (cash_entry_id, source_type, source_id, amount)
select e.id, 'expense', x.id, x.recognized_amount
from e, public.expenses x
where x.accrual_date between date '2026-06-01' and date '2026-07-31'
  and not x.is_deleted and x.note like '%サンプルデータ';

commit;


-- ── 適用後の確認 ────────────────────────────────────────────
--   月次PL（計上日ベース）
--   select to_char(accrual_date,'YYYY-MM') as tsuki, count(*) as ken,
--          sum(amount) as sogaku, sum(fee_amount) as tesuryo, sum(recognized_amount) as keijo
--   from public.payments where not is_deleted group by 1 order by 1;
--
--   入金状況（未入金が8月分だけ残っていれば成功）
--   select to_char(p.accrual_date,'YYYY-MM') as tsuki,
--          count(*) filter (where coalesce(v.settled_amount,0) = 0) as minyukin,
--          count(*) filter (where coalesce(v.settled_amount,0) >= p.recognized_amount) as nyukinzumi
--   from public.payments p
--   left join public.v_settlement v on v.source_type='payment' and v.source_id=p.id
--   where not p.is_deleted group by 1 order by 1;


-- ── 取り消し（サンプルデータを消す）─────────────────────────
--   begin;
--   delete from public.cash_allocations
--    where cash_entry_id in (select id from public.cash_entries
--                             where external_payout_id like 'po_demo_%'
--                                or description = '6-7月分 経費支払');
--   delete from public.cash_entries
--    where external_payout_id like 'po_demo_%' or description = '6-7月分 経費支払';
--   update public.expenses set is_deleted = true where note like '%サンプルデータ';
--   update public.payments set is_deleted = true where note = 'サンプルデータ';
--   -- 元のシードを戻す場合：
--   -- update public.payments set is_deleted = false where customer_email like '%@example.com';
--   -- update public.refunds  set is_deleted = false where customer_email like '%@example.com';
--   commit;
