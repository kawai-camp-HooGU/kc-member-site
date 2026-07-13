-- ============================================================
-- 通知（Web Push）
--   push_subscriptions   : 端末ごとのプッシュ購読情報（1メンバー複数端末OK）
--   notification_settings: メンバーごとの通知ON/OFF（マスター・トーク・お知らせ）
-- ============================================================

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  member_id  bigint not null references public.members(id) on delete cascade,
  endpoint   text not null unique,          -- 端末を一意に識別
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz default now()
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions(member_id);
alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions_all" on public.push_subscriptions;
create policy "push_subscriptions_all" on public.push_subscriptions
  for all to authenticated using (true) with check (true);

create table if not exists public.notification_settings (
  member_id    bigint primary key references public.members(id) on delete cascade,
  enabled      boolean not null default true,   -- マスター（オフで全停止）
  chat_enabled boolean not null default true,   -- トークの受信
  news_enabled boolean not null default true,   -- お知らせの受信
  updated_at   timestamptz default now()
);
alter table public.notification_settings enable row level security;
drop policy if exists "notification_settings_all" on public.notification_settings;
create policy "notification_settings_all" on public.notification_settings
  for all to authenticated using (true) with check (true);
