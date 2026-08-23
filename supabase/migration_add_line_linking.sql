-- ============================================================
-- LINE名寄せ（Phase 2）：登録フォームで集めた本人情報 → 会員照合
--   ・照合キー：②メール ③電話（一意一致で自動連携）／④氏名（候補・手動）
--   ・①userId は照合キーから除外（連携結果の書き込み先としてのみ使用）
--   ・本人情報は「登録フォーム」で収集（トークン付きURLで友だちを特定）
--   ・自動連携は「ちょうど1会員に一致」かつ「その会員が未連携」のときだけ
--   ・1会員=1LINE（members.line_user_id は単一値）
-- ============================================================

-- ── 友だちに、収集した本人情報とフォーム用トークンを持たせる ──
alter table public.line_friends add column if not exists collected_name    text;
alter table public.line_friends add column if not exists collected_kana    text;
alter table public.line_friends add column if not exists collected_email   text;
alter table public.line_friends add column if not exists collected_phone   text;
-- 収集経路：form（登録フォーム）/ manual（運営手入力）
alter table public.line_friends add column if not exists identity_source   text;
alter table public.line_friends add column if not exists identity_at       timestamptz;
-- 登録フォームのトークン（友だちを特定するための不透明値）
alter table public.line_friends add column if not exists link_token        text;
create unique index if not exists uq_line_friends_link_token
  on public.line_friends(link_token) where link_token is not null;

-- ── 連携の証跡（なぜ紐づいたか）─────────────────────────────
create table if not exists public.line_link_audit (
  id           bigserial primary key,
  friend_id    bigint references public.line_friends(id) on delete set null,
  member_id    int    references public.members(id) on delete set null,
  -- 照合キー：email / phone / manual（① userId は照合キーから除外）
  matched_by   text   not null,
  -- 実行者：'auto' or 実施スタッフの members.id（文字列で残す）
  linked_by    text   not null default 'auto',
  action       text   not null default 'link' check (action in ('link','unlink')),
  detail       text   not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists idx_line_link_audit_friend on public.line_link_audit(friend_id);
create index if not exists idx_line_link_audit_member on public.line_link_audit(member_id);

comment on table public.line_link_audit is 'LINE名寄せの証跡。どのキーで・誰が・いつ 連携/解除したか。';

alter table public.line_link_audit enable row level security;
drop policy if exists "line_link_audit_ops" on public.line_link_audit;
create policy "line_link_audit_ops" on public.line_link_audit
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- ── 照合の補助インデックス（会員側）─────────────────────────
-- メールは小文字で照合するため関数インデックスを張る（電話はアプリ側で正規化して突合）。
create index if not exists idx_members_lower_email
  on public.members(lower(email)) where is_deleted = false;
