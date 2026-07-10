-- ============================================================
-- プロモPJ管理 Supabase スキーマ
-- Supabase SQL Editor で順番に実行してください
-- ============================================================

-- ── 拡張機能 ──
create extension if not exists "uuid-ossp";

-- ============================================================
-- テーブル定義
-- ============================================================

-- プロジェクト
create table public.projects (
  id                  serial primary key,
  name                text not null,
  abbreviation        text,          -- プロジェクト略称
  start_date          date,
  due_date            date,
  close_date          date,          -- クローズ日
  notify_chat         text,          -- 通知先グループチャット（Webhook URL / グループ名）
  checkpoint1_name    text,          -- チェックポイント①名称
  checkpoint1_date    date,          -- チェックポイント①日付
  checkpoint2_name    text,
  checkpoint2_date    date,
  checkpoint3_name    text,
  checkpoint3_date    date,
  progress            float default 0,
  risk                text default 'normal' check (risk in ('normal', 'caution', 'high')),
  last_updated        date default current_date,
  tasks_due_this_week int default 0,
  tasks_delayed       int default 0,
  tasks_completed     int default 0,
  created_at          timestamptz default now(),
  created_by          uuid references auth.users(id) on delete set null
);

-- 分類（案件）
create table public.anken (
  id                  serial primary key,
  project_id          int not null references public.projects(id) on delete cascade,
  name                text not null,
  abbreviation        text,          -- 分類名略称
  leader              text default '',
  progress            float default 0,
  risk                text default 'normal' check (risk in ('normal', 'caution', 'high')),
  due_date            date,
  last_updated        date default current_date,
  tasks_due_this_week int default 0,
  tasks_delayed       int default 0,
  tasks_completed     int default 0,
  created_at          timestamptz default now()
);

-- タスク
create table public.tasks (
  id               serial primary key,
  project_id       int not null references public.projects(id) on delete cascade,
  anken_id         int not null references public.anken(id) on delete cascade,
  name             text not null,
  assignees        text[] default '{}',       -- 担当者名の配列（Auth連携後はuser_id[]に移行予定）
  start_date       date,
  end_date         date,
  status           text default 'pending' check (status in ('pending', 'in_progress', 'done')),
  risk             text default 'normal' check (risk in ('normal', 'caution', 'high')),
  progress_memo    text default '',
  special_notes    text default '',
  materials        text default '',
  importance       smallint check (importance is null or importance between 1 and 3),  -- 重要度: NULL=なし / 1=Ⅰ / 2=Ⅱ / 3=Ⅲ
  completed_at     timestamptz,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 担当者マスタ（Auth users と紐づけ）
create table public.members (
  id        serial primary key,
  name      text not null unique,
  role      text default 'メンバー' check (role in ('管理者', 'オペレーター', 'メンバー', '外部')),
  email     text,                                               -- ログインアカウント（任意）
  company   text,                                               -- 会社名
  chat_id   text,                                               -- チャットID（将来の通知連携用）
  user_id   uuid references auth.users(id) on delete set null,  -- Supabase Auth と紐づけ
  created_at timestamptz default now()
);

-- テンプレートマスタ
create table public.templates (
  id         serial primary key,
  name       text not null,
  created_at timestamptz default now(),
  created_by uuid references auth.users(id) on delete set null
);

-- テンプレート分類
create table public.template_anken (
  id          serial primary key,
  template_id int not null references public.templates(id) on delete cascade,
  name        text not null,
  sort_order  int default 0
);

-- テンプレートタスク
create table public.template_tasks (
  id               serial primary key,
  template_anken_id int not null references public.template_anken(id) on delete cascade,
  name             text not null,
  start_offset     int default 0,   -- プロジェクト開始日からの日数
  end_offset       int default 7,
  sort_order       int default 0
);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tasks_updated_at
  before update on public.tasks
  for each row execute function public.handle_updated_at();

-- ============================================================
-- Row Level Security (RLS)
-- 全員が読み書きできる設定（本番では認証ユーザーのみに絞ること）
-- ============================================================
alter table public.projects        enable row level security;
alter table public.anken           enable row level security;
alter table public.tasks           enable row level security;
alter table public.members         enable row level security;
alter table public.templates       enable row level security;
alter table public.template_anken  enable row level security;
alter table public.template_tasks  enable row level security;

-- 認証済みユーザーは全データにアクセス可
create policy "auth_users_all" on public.projects        for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.anken           for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.tasks           for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.members         for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.templates       for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.template_anken  for all to authenticated using (true) with check (true);
create policy "auth_users_all" on public.template_tasks  for all to authenticated using (true) with check (true);

-- ============================================================
-- Realtime 有効化
-- ============================================================
alter publication supabase_realtime add table public.projects;
alter publication supabase_realtime add table public.anken;
alter publication supabase_realtime add table public.tasks;
alter publication supabase_realtime add table public.members;
alter publication supabase_realtime add table public.templates;
alter publication supabase_realtime add table public.template_anken;
alter publication supabase_realtime add table public.template_tasks;

-- ============================================================
-- インデックス
-- ============================================================
create index idx_anken_project_id    on public.anken(project_id);
create index idx_tasks_project_id    on public.tasks(project_id);
create index idx_tasks_anken_id      on public.tasks(anken_id);
create index idx_tmpl_anken_tmpl_id  on public.template_anken(template_id);
create index idx_tmpl_tasks_anken_id on public.template_tasks(template_anken_id);
create index idx_members_user_id     on public.members(user_id);

-- ============================================================
-- 通知文面・ON/OFF 設定（migration_add_notify_settings.sql と同内容・冪等）
-- ============================================================
create table if not exists public.notify_settings (
  category    text primary key,
  enabled     boolean not null default true,
  header      text,
  lead        text,
  task_line   text,
  tail        text,
  updated_at  timestamptz default now()
);
alter table public.notify_settings enable row level security;
drop policy if exists "auth_users_all" on public.notify_settings;
create policy "auth_users_all" on public.notify_settings
  for all to authenticated using (true) with check (true);

alter table public.projects
  add column if not exists notify_overrides jsonb not null default '{}'::jsonb;

-- tasks.updated_by（最終更新者の表示名。updated_at はトリガーで自動更新）
alter table public.tasks
  add column if not exists updated_by text;

-- template_tasks.importance（テンプレタスクの重要度。1/2/3、null=なし）
alter table public.template_tasks
  add column if not exists importance int;

-- template_tasks の進捗メモ／特記事項／資料（適用時に生成タスクへコピー）
alter table public.template_tasks
  add column if not exists progress_memo text,
  add column if not exists special_notes text,
  add column if not exists materials     text;

-- ============================================================
-- 初期データ（任意 — 既存データを移行する場合はスキップ）
-- ============================================================
-- insert into public.projects (name, start_date, due_date, progress, risk) values
--   ('WLF',      '2026-06-01', '2027-01-04', 1,   'high'),
--   ('AI_kawai', '2026-05-01', '2026-06-30', 0.4, 'caution');
