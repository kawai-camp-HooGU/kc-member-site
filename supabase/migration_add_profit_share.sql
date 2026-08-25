-- ============================================================
-- 利益分配レポート（P4）
--
--   売上明細ごとに「誰にいくら分配するか」を決める層。
--
--   ・partners            … 分配先（社外パートナー／会員と紐付けも可）
--   ・profit_share_rules  … 分配ルール（率／固定額・初回／2回目以降・2ティア）
--   ・share_periods       … 月次の確定（ロック）
--   ・share_entries       … 確定時の分配額スナップショット
--
--   ＜按分ベース＞（確認事項3a＋で確定）
--     計上金額（総額 − 決済手数料）から返金を控除した額。
--     振込手数料は金額が小さいため按分せず、月次の共通経費として1本で計上する。
--     → 売上が確定した時点で分配額が出せる（着金を待たない）。
--
--   ＜なぜスナップショットを持つか＞
--     確定後に売上や返金を直しても、支払い済みの分配額が勝手に動かないようにするため。
--     確定した月の売上は一括取込からも取り消せなくなる（設計書 §6-5）。
--
--   RLS：全テーブル 運営（is_ops）のみ。会員ゾーンからは不可視（payments と同方針）。
--   金額は「円＝整数」。**分配エントリだけは負の値を許す**（返金のマイナス計上）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
--   前提: migration_add_pl_ledger.sql が適用済みであること
--   ロールバック: migration_add_profit_share_rollback.sql
-- ============================================================


-- ── 1. 分配先 ────────────────────────────────────────────────
create table if not exists public.partners (
  id                bigint generated always as identity primary key,
  name              text    not null default '',
  email             text    not null default '',
  member_id         bigint,                                   -- 会員と同一人物なら members.id
  parent_partner_id bigint references public.partners(id),    -- 2ティア報酬の紹介元
  note              text    not null default '',
  sort_order        int     not null default 0,
  is_deleted        boolean not null default false,
  created_at        timestamptz not null default now()
);

comment on table  public.partners is '利益分配の分配先。社外パートナーとしても、会員と紐付けても持てる';
comment on column public.partners.parent_partner_id is '2ティア報酬の紹介元。ルールの parent_rate と組で効く。循環はアプリ側で防ぐ';

create index if not exists partners_active_idx on public.partners(sort_order, id) where not is_deleted;

-- 自分を自分の紹介元にはできない（循環の最小ケースをDBでも塞ぐ）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'partners_parent_not_self') then
    alter table public.partners
      add constraint partners_parent_not_self check (parent_partner_id is null or parent_partner_id <> id);
  end if;
end $$;


-- ── 2. 分配ルール ────────────────────────────────────────────
create table if not exists public.profit_share_rules (
  id            bigint generated always as identity primary key,
  partner_id    bigint  not null references public.partners(id) on delete cascade,
  scope         text    not null default 'all',    -- all | type
  type_id       bigint references public.payment_product_types(id),  -- scope='type' のとき
  tier          text    not null default 'both',   -- first | repeat | both
  calc          text    not null default 'rate',   -- rate | fixed
  rate          numeric not null default 0,        -- calc='rate' のときの率（％）
  fixed_amount  int     not null default 0,        -- calc='fixed' のときの固定額（円）
  parent_rate   numeric not null default 0,        -- 紹介元へ渡す率（％）。0＝渡さない
  valid_from    date,                              -- 適用期間。計上日で判定する
  valid_to      date,
  priority      int     not null default 0,        -- 同一パートナーで複数一致したときの優先度
  rounding      text    not null default 'floor',  -- floor | round | ceil
  note          text    not null default '',
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on table  public.profit_share_rules is '分配ルール。1つの売上に複数パートナーのルールが当たれば、それぞれに分配される';
comment on column public.profit_share_rules.tier is '初回購入のみ/2回目以降のみ/両方。同一顧客・同一商品種別で最初の決済かで判定する';
comment on column public.profit_share_rules.priority is '同一パートナーで複数一致した場合、具体的なルールを優先し、同点ならこの値が大きい方を採る';
comment on column public.profit_share_rules.rounding is '端数処理。既定は切り捨て（払い過ぎない側に寄せる）';

create index if not exists share_rules_partner_idx on public.profit_share_rules(partner_id) where not is_deleted;
create index if not exists share_rules_type_idx    on public.profit_share_rules(type_id)    where not is_deleted and scope = 'type';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'share_rules_scope_chk') then
    alter table public.profit_share_rules
      add constraint share_rules_scope_chk check (scope in ('all','type')),
      add constraint share_rules_tier_chk  check (tier  in ('first','repeat','both')),
      add constraint share_rules_calc_chk  check (calc  in ('rate','fixed')),
      add constraint share_rules_round_chk check (rounding in ('floor','round','ceil')),
      add constraint share_rules_rate_chk  check (rate >= 0 and rate <= 100),
      add constraint share_rules_prate_chk check (parent_rate >= 0 and parent_rate <= 100),
      add constraint share_rules_fixed_chk check (fixed_amount >= 0),
      -- 商品種別を指定するなら type_id が要る（指定漏れで全商品に効いてしまう事故を防ぐ）
      add constraint share_rules_type_req  check (scope <> 'type' or type_id is not null);
  end if;
end $$;


-- ── 3. 月次の確定 ────────────────────────────────────────────
create table if not exists public.share_periods (
  id           bigint generated always as identity primary key,
  period       text    not null,                   -- 'YYYY-MM'
  status       text    not null default 'draft',   -- draft | fixed
  fixed_at     timestamptz,
  fixed_by     text    not null default '',
  total_base   bigint  not null default 0,
  total_share  bigint  not null default 0,
  created_at   timestamptz not null default now()
);

comment on table public.share_periods is '月次の確定状態。fixed になるとその月の分配額は再計算されず、対象の売上は一括取込から取り消せなくなる';

-- upsert(onConflict:'period') が効くよう一意にする
create unique index if not exists share_periods_period_uk on public.share_periods(period);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'share_periods_status_chk') then
    alter table public.share_periods
      add constraint share_periods_status_chk check (status in ('draft','fixed')),
      add constraint share_periods_fmt_chk    check (period ~ '^\d{4}-\d{2}$');
  end if;
end $$;


-- ── 4. 分配エントリ（確定時のスナップショット）───────────────
create table if not exists public.share_entries (
  id            bigint generated always as identity primary key,
  period        text    not null,                  -- 'YYYY-MM'
  uid           text    not null default '',       -- 'sale:{payment_id}:{partner_id}:direct' 等
  partner_id    bigint  not null references public.partners(id),
  rule_id       bigint  references public.profit_share_rules(id),
  kind          text    not null default 'sale',   -- sale | refund
  tier_kind     text    not null default 'direct', -- direct | parent（2ティア報酬）
  source_type   text    not null default 'payment',-- payment | refund
  source_id     bigint  not null,
  accrual_date  date,
  base_amount   bigint  not null default 0,        -- 按分ベース。返金は負
  amount        bigint  not null default 0,        -- 分配額。返金は負
  note          text    not null default '',
  created_at    timestamptz not null default now()
);

comment on table  public.share_entries is '確定した月の分配額スナップショット。確定後はこの表を読むだけで、再計算しない';
comment on column public.share_entries.amount is '分配額（円）。**返金の戻しは負の値**。ここだけは負を許す';

create index if not exists share_entries_period_idx  on public.share_entries(period, partner_id);
create index if not exists share_entries_source_idx  on public.share_entries(source_type, source_id);
-- 同じ月に同じエントリが二重に焼かれないようにする
create unique index if not exists share_entries_uid_uk on public.share_entries(period, uid) where uid <> '';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'share_entries_kind_chk') then
    alter table public.share_entries
      add constraint share_entries_kind_chk   check (kind in ('sale','refund')),
      add constraint share_entries_tier_chk   check (tier_kind in ('direct','parent')),
      add constraint share_entries_src_chk    check (source_type in ('payment','refund')),
      -- 売上は正、返金は負。符号が逆のデータが入ると合計がそっと狂う
      add constraint share_entries_sign_chk   check (
        (kind = 'sale' and amount >= 0) or (kind = 'refund' and amount <= 0));
  end if;
end $$;


-- ── 5. RLS（運営のみ）────────────────────────────────────────
alter table public.partners           enable row level security;
alter table public.profit_share_rules enable row level security;
alter table public.share_periods      enable row level security;
alter table public.share_entries      enable row level security;

drop policy if exists "partners_ops_all" on public.partners;
create policy "partners_ops_all" on public.partners for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "share_rules_ops_all" on public.profit_share_rules;
create policy "share_rules_ops_all" on public.profit_share_rules for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "share_periods_ops_all" on public.share_periods;
create policy "share_periods_ops_all" on public.share_periods for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "share_entries_ops_all" on public.share_entries;
create policy "share_entries_ops_all" on public.share_entries for all to authenticated
  using (public.is_ops()) with check (public.is_ops());


-- ── 6. 適用後の確認（別途 SELECT して目視する）───────────────
--   select table_name from information_schema.tables
--    where table_schema='public'
--      and table_name in ('partners','profit_share_rules','share_periods','share_entries')
--    order by 1;
--
--   -- 制約が入っているか
--   select conname from pg_constraint
--    where conrelid in ('public.share_entries'::regclass,'public.profit_share_rules'::regclass)
--    order by 1;
