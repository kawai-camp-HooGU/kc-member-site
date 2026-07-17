-- ============================================================
-- 決済情報管理（payments）＋ 決済スクショの保管
--
--   外部の決済サイトで確認した決済を、本アプリ内のリストで一元管理する。
--   ・payments … 決済1件＝1行。member_id で会員に緩く紐付ける（未照合=null 可）。
--   ・payment-shots（プライベートバケット）… AI読取に使った決済画面のスクショ実体。
--       閲覧は service role の署名URL発行だけを通す（content-files と同じ方式）。
--   ・payment_shot_views … スクショ閲覧の記録（署名URL発行時に1行）。
--
--   RLS：運営（is_ops）のみ。会員ゾーンからは一切見えない。
--   金額は「円＝整数」で保持（当面 JPY 固定。表示側で toLocaleString）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. payments 本体 ─────────────────────────────────────────
create table if not exists public.payments (
  id              bigint generated always as identity primary key,
  -- 顧客情報：照合後に member_id が埋まる。未照合は null（会員を消しても決済は残す）
  member_id       int         references public.members(id) on delete set null,
  customer_name   text        not null default '',   -- 入力時点の氏名（照合前表示・手がかり）
  customer_email  text        not null default '',   -- 自動照合の第一キー
  -- 決済情報
  paid_at         timestamptz,                        -- 決済完了日時
  site            text        not null default '',    -- 決済サイト（Stripe / 銀行振込 …）
  method          text        not null default '',    -- 決済方法（クレジットカード / 振込 …）
  amount          int         not null default 0,     -- 決済金額（円＝整数）
  currency        text        not null default 'JPY',
  note            text        not null default '',    -- 備考
  -- 付帯
  status          text        not null default 'unmatched',  -- matched | unmatched
  screenshot_path text,                               -- payment-shots 上のパス（任意）
  -- 監査
  created_by      text,                               -- 登録した運営（user_id 等）
  matched_at      timestamptz,                        -- 照合が確定した時刻
  is_deleted      boolean     not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists payments_member_idx on public.payments(member_id) where not is_deleted;
create index if not exists payments_email_idx  on public.payments(lower(customer_email)) where not is_deleted;
create index if not exists payments_paid_idx   on public.payments(paid_at desc) where not is_deleted;
create index if not exists payments_status_idx on public.payments(status) where not is_deleted;

comment on table  public.payments is '決済情報。外部決済サイトで確認した決済を運営が登録し、member_id で会員に紐付ける。';
comment on column public.payments.member_id is '照合先の会員（members.id）。未照合は null。';
comment on column public.payments.amount   is '決済金額（円＝整数。当面 JPY 固定）。';
comment on column public.payments.status   is 'matched | unmatched（member_id の有無から導出。検索用に保持）。';

-- RLS：運営のみ全操作可。会員ゾーンからは不可視。
alter table public.payments enable row level security;
drop policy if exists "payments_ops_all" on public.payments;
create policy "payments_ops_all" on public.payments for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

-- ── 2. スクショ用プライベートバケット ───────────────────────
insert into storage.buckets (id, name, public)
values ('payment-shots', 'payment-shots', false)
on conflict (id) do nothing;

-- アップロード・差し替え・削除は運営のみ。
--   読み取り（select）ポリシーはあえて作らない。
--   閲覧は service role の署名URL発行を経由させ、閲覧ログを必ず通す。
drop policy if exists "payment_shots_ops_insert" on storage.objects;
create policy "payment_shots_ops_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-shots' and public.is_ops());

drop policy if exists "payment_shots_ops_update" on storage.objects;
create policy "payment_shots_ops_update" on storage.objects for update to authenticated
  using (bucket_id = 'payment-shots' and public.is_ops());

drop policy if exists "payment_shots_ops_delete" on storage.objects;
create policy "payment_shots_ops_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'payment-shots' and public.is_ops());

-- ── 3. スクショ閲覧ログ ─────────────────────────────────────
create table if not exists public.payment_shot_views (
  id          bigint generated always as identity primary key,
  payment_id  bigint not null references public.payments(id) on delete cascade,
  viewer_id   int references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists payment_shot_views_pay_idx
  on public.payment_shot_views(payment_id, created_at desc);

alter table public.payment_shot_views enable row level security;
drop policy if exists "payment_shot_views_ops" on public.payment_shot_views;
create policy "payment_shot_views_ops" on public.payment_shot_views for select to authenticated
  using (public.is_ops());

comment on table public.payment_shot_views is '決済スクショの閲覧記録（署名URLの発行時に1行）。運営のみ閲覧可。';
