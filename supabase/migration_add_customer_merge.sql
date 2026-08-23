-- ============================================================
-- 顧客情報 改善：データ種別・LINE統合名寄せ
--   ① customer_merge_history … 統合(名寄せ)の項目単位の履歴。
--        会員(親)へ、LINE(子)の不足分を補完したときの差分を1件ずつ残す。
--   ② v_customers            … 会員 × LINE友だち を「データ種別」で束ねた統合ビュー。
--        顧客一覧（種別バッジ・絞り込み）の読み取りモデル。
--
--   前提：Phase 1（RLS・is_ops()）＋ LINE Phase 2（line_friends / line_link_audit）適用済み。
--   既存の line_link_audit（連携事実）はそのまま残し、本テーブルで「何が変わったか」を補う。
-- ============================================================

-- ── ① 統合の項目単位履歴 ─────────────────────────────────────
create table if not exists public.customer_merge_history (
  id          bigint generated always as identity primary key,
  member_id   int    not null references public.members(id)      on delete cascade,   -- 親（会員）
  friend_id   bigint references public.line_friends(id)          on delete set null,  -- 子（LINE友だち）
  field       text   not null,                       -- 'kana' | 'email' | 'tel' | 'line_user_id' …
  old_value   text,                                   -- 変更前（多くは空）
  new_value   text,                                   -- 変更後（補完値）
  source_kind text   not null default 'line',         -- 'line' | 'member'
  matched_by  text,                                   -- 'email' | 'phone' | 'manual' | 'auto'
  merged_by   text   not null default 'auto',         -- 'auto' or 実施者 members.id（文字列）
  action      text   not null default 'merge' check (action in ('merge','unmerge')),
  created_at  timestamptz not null default now()
);
create index if not exists idx_cmh_member on public.customer_merge_history(member_id);
create index if not exists idx_cmh_friend on public.customer_merge_history(friend_id);

comment on table public.customer_merge_history is
  '名寄せ統合の項目単位履歴。会員(親)にLINE(子)の不足分を補完した差分を残す。line_link_audit（連携事実）の補完。';

alter table public.customer_merge_history enable row level security;
drop policy if exists "cmh_ops" on public.customer_merge_history;
create policy "cmh_ops" on public.customer_merge_history
  for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

-- ── ② 顧客統合ビュー（会員 ∪ LINE。データ種別で切り分け）───────
--   ・運営専用（各枝に is_ops() ゲート。非運営が引くと 0 件）。
--   ・LINEは「LINE公式アカウント単位（account_id × line_user_id）」で1行。
--   ・status：会員＝active固定 / LINEは member_id があれば merged（子）、無ければ active。
drop view if exists public.v_customers;
create view public.v_customers as
  select
    'member'::text               as data_kind,
    m.id                         as member_id,
    null::bigint                 as friend_id,
    null::bigint                 as line_account_id,
    m.line_user_id               as line_user_id,
    m.name                       as display_name,
    m.email                      as email,
    m.tel                        as phone,
    'active'::text               as status,
    m.created_at                 as created_at
  from public.members m
  where m.is_deleted = false
    and public.is_ops()
  union all
  select
    'line'::text                 as data_kind,
    f.member_id                  as member_id,
    f.id                         as friend_id,
    f.account_id                 as line_account_id,
    f.line_user_id               as line_user_id,
    coalesce(nullif(f.display_name, ''), f.collected_name) as display_name,
    f.collected_email            as email,
    f.collected_phone            as phone,
    case when f.member_id is not null then 'merged' else 'active' end as status,
    f.created_at                 as created_at
  from public.line_friends f
  where public.is_ops();

grant select on public.v_customers to authenticated;

comment on view public.v_customers is
  '顧客統合ビュー：会員(data_kind=member) と LINE友だち(data_kind=line) を種別で束ねた読み取りモデル。運営専用。';
