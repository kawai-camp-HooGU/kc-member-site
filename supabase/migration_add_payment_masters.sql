-- ============================================================
-- 決済マスタ（商品種別 / 決済サイト / 決済方法）＋ payments 項目追加
--
--   ・3つのマスタを自動採番（id）で持つ。payments 側は番号（*_id）で参照する。
--       商品種別 payment_product_types … 名称 + 売上計上フラグ + 決済必要金額 + 備考
--       決済サイト payment_sites        … 名称 + 備考
--       決済方法  payment_methods       … 名称 + 備考
--   ・削除は「非表示（is_deleted＝推奨）」と「完全削除（物理DELETE）」の2択。
--       完全削除しても payments は on delete set null で残り、表示が「不明」になるだけ。
--   ・payments に 商品種別/サイト/方法(番号)・売上計上金額・電話番号・氏名カナ を追加。
--
--   RLS：運営（is_ops）のみ。機能レベルの制御（payment_master 等）はアプリ側 can() で行う。
--   適用: Supabase コンソール → SQL Editor（何度実行しても安全）
-- ============================================================

-- ── 1. マスタ：商品種別 ──────────────────────────────────────
create table if not exists public.payment_product_types (
  id              bigint generated always as identity primary key,
  name            text    not null default '',
  sales_flag      boolean not null default true,   -- ON の種別だけ売上計上額の集計対象
  required_amount int     not null default 0,       -- 決済必要金額（売上計上金額の初期値の目安）
  note            text    not null default '',
  sort_order      int     not null default 0,
  is_deleted      boolean not null default false,
  created_at      timestamptz not null default now()
);

-- ── 2. マスタ：決済サイト ────────────────────────────────────
create table if not exists public.payment_sites (
  id         bigint generated always as identity primary key,
  name       text    not null default '',
  note       text    not null default '',
  sort_order int     not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

-- ── 3. マスタ：決済方法 ──────────────────────────────────────
create table if not exists public.payment_methods (
  id         bigint generated always as identity primary key,
  name       text    not null default '',
  note       text    not null default '',
  sort_order int     not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);

-- RLS（3マスタ共通：運営のみ全操作）
alter table public.payment_product_types enable row level security;
alter table public.payment_sites         enable row level security;
alter table public.payment_methods       enable row level security;
drop policy if exists "payment_types_ops"   on public.payment_product_types;
drop policy if exists "payment_sites_ops"    on public.payment_sites;
drop policy if exists "payment_methods_ops"  on public.payment_methods;
create policy "payment_types_ops"  on public.payment_product_types for all to authenticated using (public.is_ops()) with check (public.is_ops());
create policy "payment_sites_ops"   on public.payment_sites         for all to authenticated using (public.is_ops()) with check (public.is_ops());
create policy "payment_methods_ops" on public.payment_methods       for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- ── 4. payments に項目追加 ───────────────────────────────────
alter table public.payments
  add column if not exists type_id           int references public.payment_product_types(id) on delete set null,
  add column if not exists site_id           int references public.payment_sites(id)          on delete set null,
  add column if not exists method_id         int references public.payment_methods(id)        on delete set null,
  add column if not exists recognized_amount int  not null default 0,   -- 売上計上金額（円）
  add column if not exists customer_kana     text not null default '',  -- 氏名カナ
  add column if not exists customer_tel      text not null default '';  -- 電話番号

create index if not exists payments_type_idx   on public.payments(type_id)   where not is_deleted;
create index if not exists payments_site_idx   on public.payments(site_id)   where not is_deleted;
create index if not exists payments_method_idx on public.payments(method_id) where not is_deleted;

comment on column public.payments.type_id           is '商品種別マスタ(payment_product_types.id)。表示は番号→マスタ参照。';
comment on column public.payments.recognized_amount is '売上計上金額（円）。空/0 の登録時は決済金額(amount)を自動セット。';
comment on column public.payments.customer_kana     is '氏名カナ（決済時点の入力値。会員マスタへは反映しない）。';
comment on column public.payments.customer_tel      is '電話番号（決済時点の入力値。会員マスタへは反映しない）。';

comment on table public.payment_product_types is '決済の商品種別マスタ。sales_flag=ON のみ売上計上額の集計対象。';
