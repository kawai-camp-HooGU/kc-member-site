-- ============================================================
-- お知らせ（ホーム掲載＋メンテナンス）
--   本文はテキスト/HTML、公開対象は属性ABC＋公開条件（any/all/exany/exall）。
--   予約公開は published=true かつ published_at<=now で表示。
-- ============================================================
create table if not exists public.news (
  id           bigint generated always as identity primary key,
  category     text not null default 'notice' check (category in ('notice','maint','event')),
  title        text not null default '',
  body_mode    text not null default 'text' check (body_mode in ('text','html')),
  body_text    text not null default '',
  body_html    text not null default '',
  important    boolean not null default false,   -- 重要（ピン留め）
  published    boolean not null default true,
  published_at timestamptz default now(),        -- 公開日時（未来日で予約公開）
  attr_mode    text not null default 'any' check (attr_mode in ('any','all','exany','exall')),
  sort_order   int  not null default 0,
  is_deleted   boolean not null default false,
  created_at   timestamptz default now()
);
create index if not exists news_pub_idx on public.news(published, published_at);
alter table public.news enable row level security;
drop policy if exists "news_all" on public.news;
create policy "news_all" on public.news
  for all to authenticated using (true) with check (true);

-- 公開対象属性（多対多）。attribute_id は選択した末端ノード。
create table if not exists public.news_attributes (
  news_id      bigint not null references public.news(id) on delete cascade,
  attribute_id bigint not null references public.attributes(id) on delete cascade,
  primary key (news_id, attribute_id)
);
alter table public.news_attributes enable row level security;
drop policy if exists "news_attributes_all" on public.news_attributes;
create policy "news_attributes_all" on public.news_attributes
  for all to authenticated using (true) with check (true);
