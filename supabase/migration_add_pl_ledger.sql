-- ============================================================
-- 売上経費PL管理（P1〜P3c 一括）
--
--   「売上経費（発生・計上層）」と「入金出金（現金・着金層）」を二層で持ち、
--   消込（cash_allocations）でつなぐ。差額は着金1件につき1行だけ吸収し、
--   明細への按分は行わない。
--
--   ・payment_sites  … 入金サイクル設定＋手数料率を追加（計上予定日と手数料の自動計算の要）
--   ・payments       … 計上日／入金予定日／手数料／外部取引ID／取込ジョブを追加
--   ・expenses       … 経費明細（payments のミラー。顧客照合の代わりに支払先を持つ）
--   ・cash_entries   … 着金・送金 1件＝1行（バッチ）。明細ではない
--   ・cash_allocations … 消込（入出金 × 明細の N:M）
--   ・import_jobs / import_rows … 一括取込のジョブと行
--   ・public_holidays … 営業日計算用（年1回メンテ）
--
--   RLS：全テーブル 運営（is_ops）のみ。会員ゾーンからは不可視（payments と同方針）。
--   金額は「円＝整数・正の値」で保持。符号は表示層で付ける（経費はマイナス表示）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
--   ロールバック: migration_add_pl_ledger_rollback.sql
-- ============================================================

-- ── 0. 事前チェック（適用前に単体で実行して確認する）───────
--   external_txn_id の部分UNIQUE索引が張れるかを事前に見る。
--   列がまだ無い場合は 0 件が返る（＝無条件で作成可）。
--
--   select external_source, external_txn_id, count(*)
--   from public.payments
--   where external_txn_id is not null and external_txn_id <> '' and not is_deleted
--   group by 1,2 having count(*) > 1;


-- ── 1. 決済サイトマスタ：入金サイクル＋手数料 ───────────────
alter table public.payment_sites
  add column if not exists cycle_type    text    not null default 'none',      -- none|closing|offset|periodic
  add column if not exists closing_day   int     not null default 99,          -- 1-31 / 99=末日
  add column if not exists month_offset  int     not null default 1,           -- 締め月から +N ヶ月
  add column if not exists payment_day   int     not null default 99,          -- 1-31 / 99=末日
  add column if not exists offset_days   int     not null default 0,           -- cycle_type=offset のときの日数
  add column if not exists day_type      text    not null default 'calendar',  -- calendar|business
  add column if not exists holiday_shift text    not null default 'none',      -- none|before|after
  add column if not exists fee_rate      numeric(6,3) not null default 0,      -- 決済手数料率（%）
  add column if not exists fee_fixed     int     not null default 0,           -- 1件あたり固定手数料（円）
  add column if not exists fee_rounding  text    not null default 'floor',     -- floor|round|ceil
  add column if not exists transfer_fee  int     not null default 0,           -- 1回の着金あたり振込手数料（円）
  add column if not exists auto_calc     boolean not null default true;        -- 自動計算を使うか

comment on column public.payment_sites.cycle_type    is '入金サイクル方式。none=自動計算しない / closing=締め日方式 / offset=決済からN日後 / periodic=定期日';
comment on column public.payment_sites.transfer_fee  is '1回の着金あたりの振込手数料（円）。明細ではなく消込差額の期待値に使う';
comment on column public.payment_sites.fee_rate      is '決済手数料率（%）。売上明細の計上額＝総額−(総額×率+固定額) の自動計算に使う';


-- ── 2. payments：日付・手数料・外部ID・取込 ─────────────────
alter table public.payments
  add column if not exists accrual_date    date,                        -- 計上日（月次PL・利益分配の集計軸）
  add column if not exists expected_date   date,                        -- 入金予定日（決済サイトから自動計算）
  add column if not exists fee_amount      int     not null default 0,  -- 決済手数料（円）
  add column if not exists is_fee_manual   boolean not null default false,
  add column if not exists is_date_manual  boolean not null default false,
  add column if not exists external_source text    not null default '', -- stripe / paypal / bank …
  add column if not exists external_txn_id text    not null default '', -- ch_xxx など。消込・重複判定の決定キー
  add column if not exists dedup_hash      text    not null default '', -- 自然キーのSHA-256（一括取込の重複判定）
  add column if not exists import_job_id   bigint;

comment on column public.payments.accrual_date  is '計上日。既定は決済日と同日。月次PL・利益分配の集計はこの日付を軸にする';
comment on column public.payments.expected_date is '入金予定日。決済日＋payment_sites の入金サイクル設定から自動計算（手動上書き時は is_date_manual=true）';
comment on column public.payments.fee_amount    is '決済手数料（円）。売上計上金額 recognized_amount = amount - fee_amount';

-- 既存行の計上日を決済日で埋める（後方互換の要。既に入っている行は触らない）
update public.payments
   set accrual_date = (paid_at at time zone 'Asia/Tokyo')::date
 where accrual_date is null and paid_at is not null;

create index if not exists payments_accrual_idx  on public.payments(accrual_date)  where not is_deleted;
create index if not exists payments_expected_idx on public.payments(expected_date) where not is_deleted;
create index if not exists payments_dedup_idx    on public.payments(dedup_hash)    where not is_deleted and dedup_hash <> '';
create index if not exists payments_job_idx      on public.payments(import_job_id) where import_job_id is not null;

-- 外部取引IDの二重登録を構造的に防ぐ（空文字は対象外）
create unique index if not exists payments_ext_uk
  on public.payments(external_source, external_txn_id)
  where external_txn_id <> '' and not is_deleted;


-- ── 3. 経費科目マスタ ───────────────────────────────────────
create table if not exists public.expense_categories (
  id         bigint generated always as identity primary key,
  name       text    not null default '',
  is_cost    boolean not null default false,   -- true=原価 / false=販管費
  note       text    not null default '',
  sort_order int     not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
comment on table public.expense_categories is '経費科目マスタ。売上側の商品種別(payment_product_types)に相当する';

-- 初期データ（1件も無いときだけ投入）
insert into public.expense_categories (name, is_cost, sort_order)
select v.name, v.is_cost, v.sort_order
from (values
  ('広告宣伝費',     false, 1),
  ('外注費',         true,  2),
  ('システム利用料', false, 3),
  ('支払手数料',     false, 4),
  ('返金',           false, 5),
  ('人件費',         false, 6),
  ('その他',         false, 99)
) as v(name, is_cost, sort_order)
where not exists (select 1 from public.expense_categories);


-- ── 4. 経費明細（payments のミラー構造）─────────────────────
create table if not exists public.expenses (
  id                bigint generated always as identity primary key,
  paid_at           timestamptz,                                -- 支払日時
  accrual_date      date,                                       -- 計上日
  expected_date     date,                                       -- 出金予定日
  category_id       bigint references public.expense_categories(id) on delete set null,
  site_id           int    references public.payment_sites(id)      on delete set null,
  method_id         int    references public.payment_methods(id)    on delete set null,
  vendor_name       text    not null default '',                 -- 支払先名
  vendor_invoice_no text    not null default '',                 -- インボイス登録番号
  amount            int     not null default 0,                  -- 支払金額 総額（正の値）
  fee_amount        int     not null default 0,                  -- 支払手数料（円）
  recognized_amount int     not null default 0,                  -- 経費計上金額（正の値。表示のみマイナス）
  currency          text    not null default 'JPY',
  note              text    not null default '',
  is_fee_manual     boolean not null default false,
  is_date_manual    boolean not null default false,
  external_source   text    not null default '',
  external_txn_id   text    not null default '',
  dedup_hash        text    not null default '',
  import_job_id     bigint,
  receipt_path      text,                                        -- 領収書（payment-shots バケット共用）
  created_by        text,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now()
);
comment on table  public.expenses is '経費明細。payments のミラー構造。顧客照合の代わりに支払先(vendor_name)を持つ';
comment on column public.expenses.recognized_amount is '経費計上金額（円・正の値）。一覧では計上金額列にマイナス表示する';

create index if not exists expenses_accrual_idx  on public.expenses(accrual_date)  where not is_deleted;
create index if not exists expenses_expected_idx on public.expenses(expected_date) where not is_deleted;
create index if not exists expenses_cat_idx      on public.expenses(category_id)   where not is_deleted;
create index if not exists expenses_vendor_idx   on public.expenses(lower(vendor_name)) where not is_deleted;
create index if not exists expenses_dedup_idx    on public.expenses(dedup_hash)    where not is_deleted and dedup_hash <> '';
create unique index if not exists expenses_ext_uk
  on public.expenses(external_source, external_txn_id)
  where external_txn_id <> '' and not is_deleted;


-- ── 5. 入出金（着金・送金 1件＝1行。明細ではない）───────────
create table if not exists public.cash_entries (
  id                 bigint generated always as identity primary key,
  direction          text not null default 'in',     -- in | out
  entry_date         date not null,
  site_id            int  references public.payment_sites(id) on delete set null,
  account_name       text not null default '',       -- 口座名（三菱UFJ 普通 など）
  amount             int  not null default 0,        -- 実着金額・実送金額（正の値）
  description        text not null default '',       -- 通帳の摘要そのまま
  adjustments        jsonb not null default '[]',    -- [{kind,amount,memo}] kind=transfer_fee|fee_diff|withholding|fx|unknown
  external_payout_id text not null default '',       -- po_xxx など
  import_job_id      bigint,
  created_by         text,
  is_deleted         boolean not null default false,
  created_at         timestamptz not null default now()
);
comment on table  public.cash_entries is '入出金。着金・送金1件＝1行（バッチ）。中身の明細は payments/expenses 側にあり cash_allocations でつなぐ';
comment on column public.cash_entries.adjustments is '消込差額の内訳。明細に按分せず、着金1件につき配列で保持する';

create index if not exists cash_entries_date_idx on public.cash_entries(entry_date desc) where not is_deleted;
create index if not exists cash_entries_site_idx on public.cash_entries(site_id)         where not is_deleted;


-- ── 6. 消込（入出金 × 明細の N:M）───────────────────────────
create table if not exists public.cash_allocations (
  id            bigint generated always as identity primary key,
  cash_entry_id bigint not null references public.cash_entries(id) on delete cascade,
  source_type   text   not null,                 -- payment | expense | refund
  source_id     bigint not null,
  amount        int    not null default 0,       -- 充当額（正の値）
  created_at    timestamptz not null default now(),
  unique (cash_entry_id, source_type, source_id)
);
comment on table public.cash_allocations is '消込。1入金:N明細 と 1明細:M入金 の双方向が起きるため中間テーブルで持つ';

create index if not exists cash_alloc_src_idx on public.cash_allocations(source_type, source_id);


-- ── 7. 一括取込のジョブと行 ─────────────────────────────────
create table if not exists public.import_jobs (
  id           bigint generated always as identity primary key,
  target       text not null,                    -- sales | expense | cash
  file_name    text not null default '',
  file_hash    text not null default '',         -- 同一ファイル再取込の検知
  mapping      jsonb not null default '{}',      -- 列マッピング（パターンとして再利用）
  total_count  int  not null default 0,
  ok_count     int  not null default 0,
  skip_count   int  not null default 0,
  ng_count     int  not null default 0,
  -- running   … 実行中（作成直後。完了時に done/partial へ更新する）
  -- done      … 全件成功 ／ partial … 一部の行が入らなかった
  -- reverted  … ジョブ単位で取消済み ／ partial_reverted … 消込済み・分配確定済みが残り一部だけ取消
  -- failed    … ジョブ自体が失敗
  status       text not null default 'done',
  reverted_at  timestamptz,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists import_jobs_hash_idx on public.import_jobs(file_hash) where file_hash <> '';

-- 想定外のステータスが入ると履歴の絞り込みが静かに壊れるので、値を固定する
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'import_jobs_status_chk') then
    alter table public.import_jobs
      add constraint import_jobs_status_chk
      check (status in ('running','done','partial','reverted','partial_reverted','failed'));
  end if;
end $$;

create table if not exists public.import_rows (
  id             bigint generated always as identity primary key,
  job_id         bigint not null references public.import_jobs(id) on delete cascade,
  row_no         int    not null default 0,
  raw            jsonb  not null default '{}',   -- 取り込んだ元データ1行
  verdict        text   not null default 'ok',   -- ok | skip_dup | error
  errors         jsonb  not null default '[]',
  created_ref_id bigint,                          -- 作成された payments/expenses/cash_entries の id
  created_at     timestamptz not null default now()
);
create index if not exists import_rows_job_idx on public.import_rows(job_id, row_no);


-- ── 8. 祝日マスタ（営業日計算用）─────────────────────────────
--   ※ 中身は運用者が内閣府「国民の祝日について」の公表値で維持する。
--     春分の日・秋分の日は年ごとに官報で確定するため、必ず公表値を確認して投入すること。
--     このマイグレーションでは空のテーブルだけを作る（誤った日付を既定で入れない）。
create table if not exists public.public_holidays (
  d    date primary key,
  name text not null default ''
);
comment on table public.public_holidays is '国民の祝日。営業日計算（payment_sites.day_type=business）に使う。内閣府の公表値で年1回メンテする';


-- ── 9. 消込状況ビュー（列ではなくビューで導出する）──────────
--   settled_amount を実列にすると消込のたびに更新が必要で整合が崩れるため、
--   cash_allocations の SUM から都度導出する。
create or replace view public.v_settlement as
select source_type, source_id, sum(amount)::int as settled_amount
from public.cash_allocations
group by source_type, source_id;

comment on view public.v_settlement is '明細ごとの消込済み金額。一覧はこれを JOIN して 未入金/一部/入金済 を判定する';


-- ── 10. RLS：全テーブル 運営のみ（payments_ops_all と同型）──
alter table public.expense_categories enable row level security;
alter table public.expenses           enable row level security;
alter table public.cash_entries       enable row level security;
alter table public.cash_allocations   enable row level security;
alter table public.import_jobs        enable row level security;
alter table public.import_rows        enable row level security;
alter table public.public_holidays    enable row level security;

drop policy if exists "expense_categories_ops_all" on public.expense_categories;
create policy "expense_categories_ops_all" on public.expense_categories for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "expenses_ops_all" on public.expenses;
create policy "expenses_ops_all" on public.expenses for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "cash_entries_ops_all" on public.cash_entries;
create policy "cash_entries_ops_all" on public.cash_entries for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "cash_allocations_ops_all" on public.cash_allocations;
create policy "cash_allocations_ops_all" on public.cash_allocations for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "import_jobs_ops_all" on public.import_jobs;
create policy "import_jobs_ops_all" on public.import_jobs for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "import_rows_ops_all" on public.import_rows;
create policy "import_rows_ops_all" on public.import_rows for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "public_holidays_ops_all" on public.public_holidays;
create policy "public_holidays_ops_all" on public.public_holidays for all to authenticated
  using (public.is_ops()) with check (public.is_ops());


-- ── 11. 適用後の確認 ────────────────────────────────────────
--   下記が 12 行返れば列追加は成功。
--
--   select table_name, column_name from information_schema.columns
--   where table_schema='public'
--     and (   (table_name='payments'      and column_name in ('accrual_date','expected_date','fee_amount','external_txn_id','external_source','dedup_hash','import_job_id'))
--          or (table_name='payment_sites' and column_name in ('cycle_type','fee_rate','closing_day','holiday_shift','transfer_fee')))
--   order by 1,2;
--
--   新規6テーブル＋1ビューの存在確認：
--   select table_name from information_schema.tables where table_schema='public'
--     and table_name in ('expenses','expense_categories','cash_entries','cash_allocations','import_jobs','import_rows','public_holidays','v_settlement')
--   order by 1;
