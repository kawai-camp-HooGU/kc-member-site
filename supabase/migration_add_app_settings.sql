-- 全般設定（機能ON/OFFフラグ）。1行のみ（id=1）で全アプリ共通。
create table if not exists public.app_settings (
  id                    smallint primary key default 1,
  chatwork_enabled      boolean not null default true,
  bulk_register_enabled boolean not null default true,
  content_enabled       boolean not null default true,
  updated_at            timestamptz default now(),
  constraint app_settings_singleton check (id = 1)
);
alter table public.app_settings enable row level security;
drop policy if exists "app_settings_all" on public.app_settings;
create policy "app_settings_all" on public.app_settings
  for all to authenticated using (true) with check (true);
insert into public.app_settings (id, chatwork_enabled, bulk_register_enabled, content_enabled)
values (1, true, true, true)
on conflict (id) do nothing;
