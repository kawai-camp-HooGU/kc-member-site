-- ============================================================
-- init_full.sql — 新規Supabase構築用の統合スキーマ
--   init.sql ＋ 全 migration_*.sql を1本にまとめたもの。
--   Supabase の SQL Editor にこのファイルを丸ごと貼り付けて実行すれば
--   現行アプリが必要とする全テーブル・カラム・制約・RLS・Realtime が構築されます。
--   生成日: 2026-07-09（元: develop/supabase/ の init + migration 9本）
--   ※ 冪等（IF NOT EXISTS 等）なので再実行しても安全です。
-- ============================================================


-- ============================================================
-- ▼ init.sql
-- ============================================================
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
  role       text default 'メンバー' check (role in ('管理者', 'リーダー', 'メンバー', '外部')),
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


-- ============================================================
-- ▼ migration_add_project_fields.sql
-- ============================================================
-- ============================================================
-- プロジェクトマスタ 項目追加マイグレーション
--   略称 / クローズ日 / 通知先グループチャット / チェックポイント①〜③（名称・日付）
-- Supabase SQL Editor で実行してください（冪等・再実行可）
-- ============================================================

alter table public.projects
  add column if not exists abbreviation      text,
  add column if not exists close_date        date,
  add column if not exists notify_chat       text,
  add column if not exists checkpoint1_name  text,
  add column if not exists checkpoint1_date  date,
  add column if not exists checkpoint2_name  text,
  add column if not exists checkpoint2_date  date,
  add column if not exists checkpoint3_name  text,
  add column if not exists checkpoint3_date  date;


-- ============================================================
-- ▼ migration_add_anken_fields.sql
-- ============================================================
-- ============================================================
-- 分類（anken）マスタ 項目追加マイグレーション
--   分類名略称（abbreviation）
-- Supabase SQL Editor で実行してください（冪等・再実行可）
-- ============================================================

alter table public.anken
  add column if not exists abbreviation text;


-- ============================================================
-- ▼ migration_add_member_fields.sql
-- ============================================================
-- ============================================================
-- 担当者（members）マスタ 項目追加マイグレーション
--   会社名（company） / チャットID（chat_id）
-- Supabase SQL Editor で実行してください（冪等・再実行可）
-- ============================================================

alter table public.members
  add column if not exists company text,
  add column if not exists chat_id text;


-- ============================================================
-- ▼ migration_add_importance.sql
-- ============================================================
-- ============================================================
-- 重要度（importance）カラム追加マイグレーション
--   none → NULL / Ⅰ・Ⅱ・Ⅲ → 1・2・3
-- Supabase SQL Editor で実行してください（冪等・再実行可）
-- ============================================================

alter table public.tasks
  add column if not exists importance smallint;

-- 値域チェック（1〜3 または NULL）
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_importance_check'
  ) then
    alter table public.tasks
      add constraint tasks_importance_check
      check (importance is null or importance between 1 and 3);
  end if;
end $$;

-- （参考）completed_at が未作成の環境向け。既にあれば無視されます
alter table public.tasks
  add column if not exists completed_at timestamptz;


-- ============================================================
-- ▼ migration_add_task_updated_by.sql
-- ============================================================
-- ============================================================
-- tasks.updated_by 列の追加マイグレーション
--   Supabase SQL Editor で実行してください
--   「最終更新者」を表示するため、更新者の表示名を保持する列。
--   updated_at は既存のトリガーで自動更新される（handle_updated_at）。
--   updated_by はアプリ側が保存時にログインユーザーの表示名を書き込む。
-- ============================================================

alter table public.tasks
  add column if not exists updated_by text;


-- ============================================================
-- ▼ migration_add_template_task_importance.sql
-- ============================================================
-- ============================================================
-- template_tasks.importance 列の追加マイグレーション
--   Supabase SQL Editor で実行してください
--   テンプレートのタスクに重要度（1=Ⅰ / 2=Ⅱ / 3=Ⅲ / null=なし）を持たせる。
--   テンプレート適用時、生成タスクの重要度に反映される。
--   start_offset / end_offset は既に nullable（空欄=日付なしで作成）。
-- ============================================================

alter table public.template_tasks
  add column if not exists importance int;


-- ============================================================
-- ▼ migration_add_template_task_notes.sql
-- ============================================================
-- ============================================================
-- template_tasks に進捗メモ／特記事項／資料 列を追加
--   Supabase SQL Editor で実行してください
--   テンプレート適用時、生成タスクの同項目に初期値としてコピーされる。
-- ============================================================

alter table public.template_tasks
  add column if not exists progress_memo text,
  add column if not exists special_notes text,
  add column if not exists materials     text;


-- ============================================================
-- ▼ migration_add_notify_settings.sql
-- ============================================================
-- ============================================================
-- 通知文面・ON/OFF 設定の追加マイグレーション
--   Supabase SQL Editor で実行してください
--   1) アプリ全体の既定（カテゴリ毎の文面・通知ON/OFF）= notify_settings
--   2) プロジェクト毎の上書き（継承/ON/OFF + 文面）       = projects.notify_overrides
-- ============================================================

-- ── 1. アプリ全体の通知設定（カテゴリ単位） ──
--   1行 = 1カテゴリ。行が無いカテゴリはコード側の既定値を使う（疎な上書き）。
--   text 系カラムが NULL または空文字なら、その項目はコード既定にフォールバック。
create table if not exists public.notify_settings (
  category    text primary key,            -- 例: 'overdue3' / 'weekDue3' / 'todayCp' …
  enabled     boolean not null default true,-- false でそのカテゴリを送信停止（アプリ全体の既定）
  header      text,                         -- 見出しテンプレート
  lead        text,                         -- 本文・前文（リード文）
  task_line   text,                         -- タスク行テンプレート（件数ぶん繰り返し）
  tail        text,                         -- 本文・末尾文
  updated_at  timestamptz default now()
);

alter table public.notify_settings enable row level security;

drop policy if exists "auth_users_all" on public.notify_settings;
create policy "auth_users_all" on public.notify_settings
  for all to authenticated using (true) with check (true);

-- ── 2. プロジェクト毎の上書き ──
--   JSONB 構造（例）:
--   {
--     "weekDue3": { "mode": "on",  "header": "📅 今週締切【WLF】｜{プロジェクト名}", "lead": "...", "taskLine": "...", "tail": "..." },
--     "todayDue0": { "mode": "off" }
--   }
--   mode: "inherit"（既定・キー省略時も同義） / "on" / "off"
--   text 系キーが空 or 省略なら、その項目はアプリ全体→コード既定へフォールバック。
alter table public.projects
  add column if not exists notify_overrides jsonb not null default '{}'::jsonb;

-- Realtime（任意：他ユーザーの編集を即時反映したい場合）
-- alter publication supabase_realtime add table public.notify_settings;


-- ============================================================
-- ▼ migration_master_no_refactor.sql
-- ============================================================
-- ============================================================
-- マスタID参照リファクタ Phase 1（追加・後方互換）
--   目的: 担当者(members)を「名前直持ち」から「id(master_no)参照」へ正規化
--   方針: 既存の id(serial) を master_no として使用 / 旧textカラムは残す段階移行
--   削除: マスタ(projects/anken/members/templates)は is_deleted で論理削除。
--         tasks(トランザクションデータ)は従来どおり物理DELETE。
--   Supabase SQL Editor で上から順に実行してください
-- ============================================================
-- ※ 実行前に必ずバックアップ（または検証環境で先行確認）を取ってください。
-- ※ Phase 2（旧textカラム削除）はこのファイル末尾にコメントで分離しています。
--    アプリ改修・検証が完了するまで Phase 2 は実行しないでください。
-- ============================================================


-- ────────────────────────────────────────────────
-- 0. 事前監査（任意・推奨）: 名前→memberにマッチしない担当者/リーダーを洗い出す
--    実行しても変更は起きません。NULL化されうる名前の事前確認用。
-- ────────────────────────────────────────────────
-- 担当者(assignees)で members に存在しない名前
--   select distinct a.name
--   from public.tasks t, unnest(t.assignees) as a(name)
--   where a.name is not null and a.name <> ''
--     and not exists (select 1 from public.members m where m.name = a.name);
-- リーダー(leader)で members に存在しない名前
--   select distinct a.leader
--   from public.anken a
--   where a.leader is not null and a.leader <> ''
--     and not exists (select 1 from public.members m where m.name = a.leader);


-- ────────────────────────────────────────────────
-- 1. 論理削除フラグを追加（マスタのみ。tasks は物理削除のため付与しない）
--    親(project)を論理削除したら子(anken)も連鎖論理削除する。
--    tasks は親が論理削除されたらアプリ側フィルタで非表示にする（行は残す）。
-- ────────────────────────────────────────────────
alter table public.projects  add column if not exists is_deleted boolean not null default false;
alter table public.anken     add column if not exists is_deleted boolean not null default false;
alter table public.members   add column if not exists is_deleted boolean not null default false;
alter table public.templates add column if not exists is_deleted boolean not null default false;

-- 有効データの絞り込みを高速化するインデックス
create index if not exists idx_projects_active on public.projects (is_deleted);
create index if not exists idx_anken_active    on public.anken    (is_deleted);
create index if not exists idx_members_active  on public.members  (is_deleted);


-- ────────────────────────────────────────────────
-- 2. ID参照カラムを追加（旧 text カラムは残す）
--    tasks.assignee_ids : member.id の配列（配列にはFK制約を張れない）
--    anken.leader_id    : member.id 単一（FK可。論理削除前提なので set null は基本発火しない）
-- ────────────────────────────────────────────────
alter table public.tasks add column if not exists assignee_ids int[] not null default '{}';
alter table public.anken add column if not exists leader_id int;

alter table public.anken drop constraint if exists anken_leader_id_fkey;
alter table public.anken
  add constraint anken_leader_id_fkey
  foreign key (leader_id) references public.members(id) on delete set null;


-- ────────────────────────────────────────────────
-- 3. 既存データのバックフィル（名前 → member.id）
-- ────────────────────────────────────────────────

-- 3a. 未マッチ名の救済: tasks.assignees / anken.leader にあって members に無い名前を
--     「論理削除済みメンバー(role=外部)」として自動生成し、参照を解決可能にする。
--     （過去に物理削除された担当者などの履歴を保てるようにするため）
insert into public.members (name, role, is_deleted)
select distinct s.name, '外部', true
from (
  select unnest(assignees) as name from public.tasks
  union
  select leader            as name from public.anken
) s
where s.name is not null and s.name <> ''
  and not exists (select 1 from public.members m where m.name = s.name);

-- 3b. tasks.assignee_ids を backfill（assignees の並び順を維持）
update public.tasks t
set assignee_ids = coalesce((
  select array_agg(m.id order by a.ord)
  from unnest(t.assignees) with ordinality as a(name, ord)
  join public.members m on m.name = a.name
), '{}')
where array_length(t.assignees, 1) is not null;

-- 3c. anken.leader_id を backfill
update public.anken a
set leader_id = m.id
from public.members m
where m.name = a.leader
  and a.leader is not null and a.leader <> ''
  and a.leader_id is null;


-- ────────────────────────────────────────────────
-- 4. 同名再利用の許可: 有効行(is_deleted=false)の中だけ name を一意にする
--    既存の unique(name) 制約を外し、部分ユニークインデックスへ置換
-- ────────────────────────────────────────────────
alter table public.members drop constraint if exists members_name_key;
drop index if exists members_name_active_uniq;
create unique index members_name_active_uniq
  on public.members (name) where is_deleted = false;


-- ────────────────────────────────────────────────
-- 5. 論理削除の連鎖トリガー（projects → anken）
--    projects.is_deleted を true にしたら配下 anken も true。
--    tasks は is_deleted を持たず物理削除のため連鎖対象外
--    （親が論理削除された分類のタスクはアプリ側フィルタで非表示にする）。
-- ────────────────────────────────────────────────
create or replace function public.cascade_soft_delete()
returns trigger language plpgsql as $$
begin
  if NEW.is_deleted = true and OLD.is_deleted = false then
    update public.anken set is_deleted = true
      where project_id = NEW.id and is_deleted = false;
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_cascade_soft_delete_projects on public.projects;
create trigger trg_cascade_soft_delete_projects
  after update of is_deleted on public.projects
  for each row execute function public.cascade_soft_delete();

-- 旧バージョンで anken にトリガーを作成していた場合に備えて除去
drop trigger if exists trg_cascade_soft_delete_anken on public.anken;


-- ────────────────────────────────────────────────
-- 6. 検証クエリ（任意）: backfill 結果の確認
-- ────────────────────────────────────────────────
-- 担当者: 名前数と id 数が一致しないタスク（取りこぼし検出）
--   select id, name, assignees, assignee_ids
--   from public.tasks
--   where coalesce(array_length(assignees,1),0) <> coalesce(array_length(assignee_ids,1),0);
-- リーダー: 名前はあるが leader_id が NULL の分類
--   select id, name, leader, leader_id
--   from public.anken
--   where leader is not null and leader <> '' and leader_id is null;


-- ============================================================
-- Phase 2（クリーンアップ）— アプリ改修と本番検証が完了してから実行
--   旧 text カラムを削除し、id参照へ完全移行する。
--   ※ 実行すると後方互換のための二重持ちが無くなります。ロールバック不可。
-- ============================================================
-- alter table public.tasks drop column assignees;
-- alter table public.anken drop column leader;

