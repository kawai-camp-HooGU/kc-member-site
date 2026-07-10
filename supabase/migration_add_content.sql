-- ============================================================
-- コンテンツ機能
--   コンテンツページ（タブ）と コンテンツ（動画/資料/なし）。
--   動画・資料は URL 埋め込み（ファイル添付は当面なし）。
--   公開対象は属性ABC＋公開条件（any/all/exany/exall）。
-- ============================================================

-- コンテンツページ（掲載画面のタブ＝1タブ1ページ）
create table if not exists public.content_pages (
  id         bigint generated always as identity primary key,
  name       text not null default '',
  abbr       text not null default '',
  attr_mode  text not null default 'any' check (attr_mode in ('any','all','exany','exall')),
  sort_order int  not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz default now()
);
alter table public.content_pages enable row level security;
drop policy if exists "content_pages_all" on public.content_pages;
create policy "content_pages_all" on public.content_pages
  for all to authenticated using (true) with check (true);

-- コンテンツ
--   kind: video=動画(URL埋め込み) / doc=資料(URL埋め込み) / none=なし(テキスト/HTML)
--   none_mode: text / html
create table if not exists public.contents (
  id         bigint generated always as identity primary key,
  page_id    bigint not null references public.content_pages(id) on delete cascade,
  name       text not null default '',
  kind       text not null default 'none' check (kind in ('video','doc','none')),
  url        text not null default '',      -- 動画/資料の埋め込みURL
  none_mode  text not null default 'text' check (none_mode in ('text','html')),
  body_text  text not null default '',
  body_html  text not null default '',
  thumb_url  text not null default '',      -- サムネイル画像URL（任意）
  published  boolean not null default true,
  attr_mode  text not null default 'any' check (attr_mode in ('any','all','exany','exall')),
  sort_order int  not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists contents_page_idx on public.contents(page_id);
alter table public.contents enable row level security;
drop policy if exists "contents_all" on public.contents;
create policy "contents_all" on public.contents
  for all to authenticated using (true) with check (true);

-- 公開対象属性（多対多）。attribute_id は選択した末端ノード。
create table if not exists public.content_page_attributes (
  page_id      bigint not null references public.content_pages(id) on delete cascade,
  attribute_id bigint not null references public.attributes(id) on delete cascade,
  primary key (page_id, attribute_id)
);
alter table public.content_page_attributes enable row level security;
drop policy if exists "content_page_attributes_all" on public.content_page_attributes;
create policy "content_page_attributes_all" on public.content_page_attributes
  for all to authenticated using (true) with check (true);

create table if not exists public.content_attributes (
  content_id   bigint not null references public.contents(id) on delete cascade,
  attribute_id bigint not null references public.attributes(id) on delete cascade,
  primary key (content_id, attribute_id)
);
alter table public.content_attributes enable row level security;
drop policy if exists "content_attributes_all" on public.content_attributes;
create policy "content_attributes_all" on public.content_attributes
  for all to authenticated using (true) with check (true);
