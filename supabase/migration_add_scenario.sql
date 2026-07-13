-- ============================================================
-- シナリオ配信（Lステップ風ステップ配信）
--   scenarios        … シナリオ本体（開始トリガー・対象条件・稼働）
--   scenario_steps   … ステップ明細（経過時間・チャネル・本文）
--   scenario_entries … 顧客の進行状況（登録＝エントリー）
--   scenario_links   … ステップ本文のURL（計測単位）
--   scenario_clicks  … 計測URLのクリック（訪問者ログ）
-- ============================================================

create table if not exists public.scenarios (
  id              bigint generated always as identity primary key,
  name            text    not null default '',
  active          boolean not null default false,
  trigger_type    text    not null default 'manual',  -- source | login | attribute | manual
  target_source   text,
  target_attr_ids jsonb   not null default '[]'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table if not exists public.scenario_steps (
  id            bigint generated always as identity primary key,
  scenario_id   bigint  not null references public.scenarios(id) on delete cascade,
  sort_order    int     not null default 0,
  delay_unit    text    not null default 'immediate', -- immediate | hours | days
  delay_value   int     not null default 0,
  time_of_day   text,                                  -- 'HH:MM'（days時のみ）
  channel_chat  boolean not null default true,
  channel_email boolean not null default false,
  message_body  text    not null default ''
);
create index if not exists idx_scenario_steps_sid on public.scenario_steps(scenario_id);

create table if not exists public.scenario_entries (
  id           bigint generated always as identity primary key,
  scenario_id  bigint  not null references public.scenarios(id) on delete cascade,
  member_id    bigint  not null,
  entered_at   timestamptz not null default now(),
  next_step    int     not null default 0,   -- 次に送るステップの sort_order
  status       text    not null default 'active', -- active | done
  last_sent_at timestamptz,
  unique (scenario_id, member_id)
);
create index if not exists idx_scenario_entries_sid on public.scenario_entries(scenario_id);

create table if not exists public.scenario_links (
  id           bigint generated always as identity primary key,
  scenario_id  bigint not null references public.scenarios(id) on delete cascade,
  step_id      bigint not null references public.scenario_steps(id) on delete cascade,
  url          text   not null
);
create index if not exists idx_scenario_links_step on public.scenario_links(step_id);

create table if not exists public.scenario_clicks (
  id          bigint generated always as identity primary key,
  link_id     bigint not null references public.scenario_links(id) on delete cascade,
  member_id   bigint,
  clicked_at  timestamptz default now()
);
create index if not exists idx_scenario_clicks_link on public.scenario_clicks(link_id);

-- RLS
alter table public.scenarios        enable row level security;
alter table public.scenario_steps   enable row level security;
alter table public.scenario_entries enable row level security;
alter table public.scenario_links   enable row level security;
alter table public.scenario_clicks  enable row level security;
do $$ begin
  perform 1;
end $$;
drop policy if exists "scenarios_auth"        on public.scenarios;
drop policy if exists "scenario_steps_auth"   on public.scenario_steps;
drop policy if exists "scenario_entries_auth" on public.scenario_entries;
drop policy if exists "scenario_links_auth"   on public.scenario_links;
drop policy if exists "scenario_clicks_auth"  on public.scenario_clicks;
create policy "scenarios_auth"        on public.scenarios        for all to authenticated using (true) with check (true);
create policy "scenario_steps_auth"   on public.scenario_steps   for all to authenticated using (true) with check (true);
create policy "scenario_entries_auth" on public.scenario_entries for all to authenticated using (true) with check (true);
create policy "scenario_links_auth"   on public.scenario_links   for all to authenticated using (true) with check (true);
create policy "scenario_clicks_auth"  on public.scenario_clicks  for all to authenticated using (true) with check (true);
