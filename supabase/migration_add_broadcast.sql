-- ============================================================
-- 一斉配信（Lステップ風）
--   broadcasts         … 配信本体（宛先条件・日時・チャネル・本文・状態）
--   broadcast_links    … 配信本文に含まれるURL（計測単位）
--   broadcast_clicks   … 計測URLのクリック（＝訪問者ログ）
-- ============================================================

create table if not exists public.broadcasts (
  id               bigint generated always as identity primary key,
  title            text        not null default '',
  status           text        not null default 'draft',   -- draft | scheduled | sent
  target_mode      text        not null default 'filter',  -- all | filter
  target_attr_ids  jsonb       not null default '[]'::jsonb,
  target_source    text,                                    -- 流入経路キー（null=指定なし）
  channel_chat     boolean     not null default true,
  channel_email    boolean     not null default false,
  scheduled_at     timestamptz,                             -- null=即時（登録時に送信）
  message_body     text        not null default '',
  recipient_count  int         not null default 0,
  sent_at          timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.broadcast_links (
  id            bigint generated always as identity primary key,
  broadcast_id  bigint not null references public.broadcasts(id) on delete cascade,
  url           text   not null
);
create index if not exists idx_broadcast_links_bid on public.broadcast_links(broadcast_id);

create table if not exists public.broadcast_clicks (
  id          bigint generated always as identity primary key,
  link_id     bigint not null references public.broadcast_links(id) on delete cascade,
  member_id   bigint,
  clicked_at  timestamptz default now()
);
create index if not exists idx_broadcast_clicks_link on public.broadcast_clicks(link_id);

-- RLS（認証ユーザーに開放。書き込みは基本サーバー(service role)経由）
alter table public.broadcasts       enable row level security;
alter table public.broadcast_links  enable row level security;
alter table public.broadcast_clicks enable row level security;
drop policy if exists "broadcasts_auth"      on public.broadcasts;
drop policy if exists "broadcast_links_auth" on public.broadcast_links;
drop policy if exists "broadcast_clicks_auth" on public.broadcast_clicks;
create policy "broadcasts_auth"       on public.broadcasts       for all to authenticated using (true) with check (true);
create policy "broadcast_links_auth"  on public.broadcast_links  for all to authenticated using (true) with check (true);
create policy "broadcast_clicks_auth" on public.broadcast_clicks for all to authenticated using (true) with check (true);
