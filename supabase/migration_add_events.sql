-- ============================================================
-- イベント・予定（カレンダー掲載）
--
--   events            … コミュニティのイベント／予定。公開対象は属性ABC＋公開条件（既存と同じ）。
--   event_attributes  … 公開対象属性（多対多）
--   forms に2列追加   … 回答期限をカレンダーに表示するオプション
--
--   ⚠️ 出欠（RSVP）テーブルは作らない。
--      申込・アンケートは「フォーム機能」で作ったフォームを events.form_id に紐付け、
--      回答済／未回答は form_submissions.member_id と公開対象メンバーの差分で算出する。
-- ============================================================

create table if not exists public.events (
  id            bigint generated always as identity primary key,
  title         text not null default '',
  kind          text not null default 'event' check (kind in ('event','meeting','deadline','other')),
  color         text not null default '#0d9488',
  all_day       boolean not null default false,
  start_at      timestamptz not null default now(),
  end_at        timestamptz not null default now(),
  location      text not null default '',
  url           text not null default '',
  body_text     text not null default '',
  published     boolean not null default true,
  -- お知らせ連携（お知らせ側から作られた予定は news_id が入る）
  news_id       bigint references public.news(id) on delete cascade,
  -- 申込・回答フォーム（フォーム機能で作成済みのものを紐付ける）
  form_id       bigint references public.forms(id) on delete set null,
  -- 紐付けたフォームの回答期限もカレンダーに表示するか
  show_form_deadline boolean not null default true,
  attr_mode     text not null default 'any' check (attr_mode in ('any','all','exany','exall')),
  is_deleted    boolean not null default false,
  created_at    timestamptz default now()
);
create index if not exists events_range_idx on public.events(start_at, end_at);
create index if not exists events_news_idx  on public.events(news_id);
create index if not exists events_form_idx  on public.events(form_id);

alter table public.events enable row level security;
-- 未公開（下書き）は運営にしか見せない（contents / news と同じ方針）
drop policy if exists "events_select"     on public.events;
drop policy if exists "events_insert_ops" on public.events;
drop policy if exists "events_update_ops" on public.events;
drop policy if exists "events_delete_ops" on public.events;
create policy "events_select" on public.events for select to authenticated
  using (public.is_ops() or (published = true and is_deleted = false));
create policy "events_insert_ops" on public.events for insert to authenticated
  with check (public.is_ops());
create policy "events_update_ops" on public.events for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "events_delete_ops" on public.events for delete to authenticated
  using (public.is_ops());

-- 公開対象属性（attribute_id は選択した末端ノード）
create table if not exists public.event_attributes (
  event_id     bigint not null references public.events(id) on delete cascade,
  attribute_id bigint not null references public.attributes(id) on delete cascade,
  primary key (event_id, attribute_id)
);
alter table public.event_attributes enable row level security;
drop policy if exists "event_attributes_select"     on public.event_attributes;
drop policy if exists "event_attributes_write_ops"  on public.event_attributes;
create policy "event_attributes_select" on public.event_attributes for select to authenticated
  using (true);
create policy "event_attributes_write_ops" on public.event_attributes for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

-- ── フォーム側：回答期限をカレンダーに表示する ──────────────
alter table public.forms
  add column if not exists show_on_calendar boolean not null default false,
  add column if not exists calendar_label   text    not null default '';

comment on column public.forms.show_on_calendar is '回答期限の日にカレンダーへチップを表示する';
comment on column public.forms.calendar_label   is 'カレンダー表示名（空ならフォーム名）';
comment on column public.events.form_id         is '申込・回答フォーム。回答済/未回答は form_submissions から算出する（RSVPテーブルは持たない）';
