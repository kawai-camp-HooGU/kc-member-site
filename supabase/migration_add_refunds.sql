-- ============================================================
-- 返金・解約管理（refunds）＋ 返金解約マスタ
--
--   決済（payments）に対する返金・解約を運営が登録し、進捗を管理する。
--   ・refunds … 返金/解約 1件＝1行。member_id で会員に緩く紐付ける（未照合=null 可）。
--       payment_id で元決済を任意に参照する。
--   ・申請者（applicant_*）は対象者会員と異なる場合がある（家族・代理申請）。
--   ・解約区分①/②・進捗ステータスはマスタ（refund_masters）から選択し、番号(ID)で保持。
--       マスタ名称そのもの（「解約区分①」等）は refund_master_groups.label で編集可能。
--   ・売上レポートでは refund_amount を「経費」として計上（純売上＝売上計上額 − 返金経費）。
--       計上対象・計上月は「完了扱い(is_done)」ステータス到達時の refunded_at を基準。
--
--   RLS：運営（is_ops）のみ。会員ゾーンからは不可視（payments と同方針）。
--   金額は「円＝整数」で保持（当面 JPY 固定。表示側で toLocaleString）。
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. マスタのグループ（表示名を編集可能に：「解約区分①」等の名称もマスタ化）──
create table if not exists public.refund_master_groups (
  key        text primary key,          -- 'cancel_cat1' | 'cancel_cat2' | 'refund_status'
  label      text not null,             -- 画面に出す名称（編集可）例「解約区分①」
  sort_order int  not null default 0
);
insert into public.refund_master_groups (key, label, sort_order) values
  ('cancel_cat1',   '解約区分①',       1),
  ('cancel_cat2',   '解約区分②',       2),
  ('refund_status', '解約進捗ステータス', 3)
on conflict (key) do nothing;

-- ── 2. マスタの選択肢（グループごと）──
create table if not exists public.refund_masters (
  id         bigint generated always as identity primary key,
  group_key  text    not null references public.refund_master_groups(key) on delete cascade,
  name       text    not null default '',
  note       text    not null default '',
  is_done    boolean not null default false,  -- refund_status 用：完了扱い（経費計上のトリガ）
  sort_order int     not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists refund_masters_group_idx on public.refund_masters(group_key, sort_order) where not is_deleted;

-- 初期データ（存在しなければ投入）。名称・並び順は画面から編集可。
insert into public.refund_masters (group_key, name, is_done, sort_order)
select v.group_key, v.name, v.is_done, v.sort_order
from (values
  ('cancel_cat1', '自主退会', false, 1),
  ('cancel_cat1', '中途解約', false, 2),
  ('cancel_cat1', '強制退会', false, 3),
  ('cancel_cat2', '受講前',   false, 1),
  ('cancel_cat2', '受講中',   false, 2),
  ('cancel_cat2', '受講後',   false, 3),
  ('refund_status', '受付',     false, 1),
  ('refund_status', '確認中',   false, 2),
  ('refund_status', '手続き中', false, 3),
  ('refund_status', '完了',     true,  4),
  ('refund_status', '却下',     false, 5)
) as v(group_key, name, is_done, sort_order)
where not exists (select 1 from public.refund_masters m where m.group_key = v.group_key);

-- ── 3. 返金・解約 本体 ──
create table if not exists public.refunds (
  id               bigint generated always as identity primary key,
  member_id        int         references public.members(id)  on delete set null,
  payment_id       bigint      references public.payments(id) on delete set null,
  customer_name    text        not null default '',   -- 対象者会員の氏名（照合前表示・手がかり）
  customer_email   text        not null default '',   -- 自動照合の第一キー
  -- 申請者（対象者会員と異なる場合あり）
  applicant_name    text       not null default '',
  applicant_address text       not null default '',
  applicant_email   text       not null default '',
  applicant_tel     text       not null default '',
  -- マスタ参照
  cancel_cat1_id   bigint      references public.refund_masters(id) on delete set null,
  cancel_cat2_id   bigint      references public.refund_masters(id) on delete set null,
  status_id        bigint      references public.refund_masters(id) on delete set null,
  kind             text        not null default 'refund',     -- refund | cancel | both
  refund_amount    int         not null default 0,            -- 円＝整数。経費計上対象
  expense_category text        not null default 'refund',     -- 経費区分
  requested_at     timestamptz,                               -- 申請・受付日時
  refunded_at      timestamptz,                               -- 返金完了日時（完了扱いで確定・計上月の基準）
  reason           text        not null default '',
  progress_memo    text        not null default '',           -- 進捗メモ
  note             text        not null default '',
  screenshot_path  text,
  created_by       text,
  matched_at       timestamptz,
  is_deleted       boolean     not null default false,
  created_at       timestamptz not null default now()
);

create index if not exists refunds_member_idx   on public.refunds(member_id)  where not is_deleted;
create index if not exists refunds_payment_idx   on public.refunds(payment_id) where not is_deleted;
create index if not exists refunds_email_idx     on public.refunds(lower(customer_email)) where not is_deleted;
create index if not exists refunds_status_idx    on public.refunds(status_id)  where not is_deleted;
create index if not exists refunds_refunded_idx  on public.refunds(refunded_at desc) where not is_deleted;

comment on table  public.refunds is '返金・解約管理。payments への返金/解約を運営が登録し進捗管理。売上レポートでは refund_amount を経費計上。';
comment on column public.refunds.refund_amount is '返金金額（円＝整数）。売上レポートの経費として計上。';
comment on column public.refunds.refunded_at   is '返金完了日時（完了扱いステータスで確定。計上月の基準）。';
comment on column public.refunds.status_id     is '解約進捗ステータス（refund_masters group=refund_status を参照）。';

-- RLS：運営のみ全操作可（payments_ops_all と同型）。3テーブルとも同方針。
alter table public.refunds               enable row level security;
alter table public.refund_masters        enable row level security;
alter table public.refund_master_groups  enable row level security;
drop policy if exists "refunds_ops_all" on public.refunds;
create policy "refunds_ops_all" on public.refunds for all to authenticated
  using (public.is_ops()) with check (public.is_ops());
drop policy if exists "refund_masters_ops_all" on public.refund_masters;
create policy "refund_masters_ops_all" on public.refund_masters for all to authenticated
  using (public.is_ops()) with check (public.is_ops());
drop policy if exists "refund_master_groups_ops_all" on public.refund_master_groups;
create policy "refund_master_groups_ops_all" on public.refund_master_groups for all to authenticated
  using (public.is_ops()) with check (public.is_ops());
