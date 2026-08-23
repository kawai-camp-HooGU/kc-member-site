-- ============================================================
-- メモ機能 仕様変更
--   ① メモタイトルをフリー入力 → マスタ選択に変更（memo_titles）
--   ② メモに「登録元」を記録（手動登録 / フォーム由来）
--   ③ フォームの回答をメモへ自動連携（forms.memo_link）
--
--   前提：Phase 1（RLS・is_ops()）適用済み。
--   マスタは運営専用（is_ops）。member_memos は従来どおり authenticated。
-- ============================================================

-- ── ① メモタイトルマスタ ─────────────────────────────────────
create table if not exists public.memo_titles (
  id         bigint generated always as identity primary key,
  name       text    not null,
  sort_order int     not null default 0,
  is_active  boolean not null default true,   -- false = 新規選択の候補から外す（既存メモは保持）
  is_deleted boolean not null default false,
  created_at timestamptz default now()
);
-- 有効な（未削除）タイトル名は一意。移行の on conflict で使う。
create unique index if not exists memo_titles_name_uniq
  on public.memo_titles (name) where is_deleted = false;

alter table public.memo_titles enable row level security;
drop policy if exists "memo_titles_ops" on public.memo_titles;
create policy "memo_titles_ops" on public.memo_titles
  for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

-- ── ② member_memos の拡張 ───────────────────────────────────
--   従来の title(text) は残す（移行の元データ／表示フォールバック）。
alter table public.member_memos
  add column if not exists title_id             bigint references public.memo_titles(id) on delete set null,
  add column if not exists source_kind          text   not null default 'manual',  -- 'manual' | 'form'
  add column if not exists source_form_id       bigint,
  add column if not exists source_form_name     text   not null default '',         -- 表示用に非正規化（フォーム削除後も残す）
  add column if not exists source_submission_id bigint;

create index if not exists member_memos_title_idx on public.member_memos(title_id);

-- ── 既存タイトルの移行：distinct なフリー入力タイトルをマスタ化し title_id を張る ──
insert into public.memo_titles (name, sort_order)
select t.title, row_number() over (order by t.title)
from (
  select distinct title from public.member_memos
  where coalesce(title, '') <> ''
) t
on conflict (name) where is_deleted = false do nothing;

update public.member_memos mm
set title_id = mt.id
from public.memo_titles mt
where mm.title_id is null
  and coalesce(mm.title, '') <> ''
  and mm.title = mt.name;

-- ── 初期マスタ（存在しなければ足す。よく使う分類の雛形）──
insert into public.memo_titles (name, sort_order)
values
  ('電話対応メモ', 100),
  ('クレーム・要望', 101),
  ('入金確認', 102),
  ('解約相談', 103)
on conflict (name) where is_deleted = false do nothing;

-- ── ③ フォームのメモ連携設定 ─────────────────────────────────
--   { enabled:boolean, titleId:number|null, fieldIds:number[] }
--   titleId が null のときはフォーム名をタイトルに採用。
alter table public.forms
  add column if not exists memo_link jsonb not null
  default '{"enabled":false,"titleId":null,"fieldIds":[]}'::jsonb;
