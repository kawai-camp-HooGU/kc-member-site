-- ============================================================
-- ProManage（プロマネージ）Supabase 初期化スクリプト（新規プロジェクト用）
-- まっさらな Supabase プロジェクトの「SQL Editor」に貼り付けて、上から一括実行してください。
-- これ1本でテーブル・関数・RLS・Realtime・インデックスがすべて作成されます。
-- （個別の migration_*.sql は既存環境向け。新規はこの init.sql のみでOK）
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
  abbreviation        text,            -- プロジェクト略称
  start_date          date,
  due_date            date,
  close_date          date,            -- クローズ日（入るとデータ画面の抽出対象から除外）
  notify_chat         text,            -- 通知先グループチャット（ChatWork ルームID 等）
  checkpoint1_name    text,            -- チェックポイント①名称
  checkpoint1_date    date,            -- チェックポイント①日付
  checkpoint2_name    text,
  checkpoint2_date    date,
  checkpoint3_name    text,
  checkpoint3_date    date,
  member_names        text[] default '{}',   -- 関連メンバー名の配列
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
  abbreviation        text,            -- 分類名略称
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
  assignees        text[] default '{}',
  start_date       date,              -- 開始日（任意。両方そろわない場合は「日付なし」扱い）
  end_date         date,              -- 終了日（任意）
  status           text default 'pending' check (status in ('pending', 'in_progress', 'completed')),
  risk             text default 'normal' check (risk in ('normal', 'caution', 'high')),
  progress_memo    text default '',
  special_notes    text default '',
  materials        text default '',
  importance       smallint check (importance is null or importance between 1 and 3),  -- NULL=なし / 1=Ⅰ / 2=Ⅱ / 3=Ⅲ
  completed_at     timestamptz,       -- ステータスを完了にした日時
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- 担当者マスタ（Auth users と紐づけ）
create table public.members (
  id         serial primary key,
  name       text not null unique,
  role       text default 'メンバー' check (role in ('管理者', 'オペレーター', 'メンバー', '外部')),
  email      text,                                                -- ログインアカウント（任意）
  company    text,                                                -- 会社名
  chat_id    text,                                                -- チャットID（ChatWork account_id 等）
  user_id    uuid references auth.users(id) on delete set null,   -- Supabase Auth と紐づけ
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
  id                serial primary key,
  template_anken_id int not null references public.template_anken(id) on delete cascade,
  name              text not null,
  start_offset      int default 0,
  end_offset        int default 7,
  sort_order        int default 0
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
-- メールアドレスから auth.users の user_id を取得する関数
-- （担当者マスタのアカウント紐づけで使用：supabase.rpc('get_user_id_by_email')）
-- ============================================================
create or replace function public.get_user_id_by_email(email_input text)
returns uuid
language sql
security definer
set search_path = public
as $$
  select id from auth.users
  where lower(email) = lower(trim(email_input))
  limit 1;
$$;
grant execute on function public.get_user_id_by_email(text) to authenticated;

-- ============================================================
-- Row Level Security (RLS)：認証済みユーザーは全データにアクセス可
-- ============================================================
alter table public.projects        enable row level security;
alter table public.anken           enable row level security;
alter table public.tasks           enable row level security;
alter table public.members         enable row level security;
alter table public.templates       enable row level security;
alter table public.template_anken  enable row level security;
alter table public.template_tasks  enable row level security;

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
-- 初期データ（任意）
-- 最初の管理者は「アプリのログイン画面 → アカウント作成」で登録し、
-- 担当者マスタで role=管理者 として追加・メール紐づけしてください。
-- 必要ならサンプルのプロジェクトを下記のように投入できます（任意）。
-- ============================================================
-- insert into public.projects (name, abbreviation, start_date, due_date) values
--   ('サンプルPJ', 'SMP', current_date, current_date + 30);
