-- ============================================================
-- ロードマップ：サブマスタ2種の追加（REQ-026）
--   1) project_categories … プロジェクト区分マスタ（区分名・色・備考）
--   2) phase_statuses     … フェーズ進捗ステータスマスタ（共通 / 区分専用）
--   3) projects.category_id / anken.status_id … 上記への参照列
--
--   背景：
--     プロジェクト一覧を「区分で色分けした表」に、フェーズ一覧を
--     「進捗ステータス付きの並び」にするため、両方をマスタ化する。
--     ガントのフェーズ帯も同じ区分色・同じステータスを使う。
--
--   ★ 参照列はどちらも NULL 許容。適用しただけでは既存の見え方は変わらない
--      （区分なし＝「—」、ステータスなし＝既定ステータス表示）。
--   ⚠️ 何度実行しても安全（if not exists / on conflict do nothing）。
--   ⚠️ 色は brand.md の規定（赤＝アクセント／無彩色が土台）に沿った値のみ入れること。
--      青・緑・紫などの多色パレットは持ち込まない。
--
--   適用: Supabase コンソール → SQL Editor
--   ロールバック: migration_add_roadmap_masters_rollback.sql
-- ============================================================

-- ── 1) プロジェクト区分マスタ ──────────────────────────────
--   color … #RRGGBB。一覧の行頭バー・区分チップ・ガントのフェーズ帯で使う。
--   note  … 備考（任意）。運用メモ。
create table if not exists public.project_categories (
  id         serial primary key,
  name       text    not null,
  color      text    not null default '#dc2626',
  note       text,
  sort_order int     not null default 0,
  is_deleted boolean not null default false,
  created_at timestamptz default now()
);

comment on table  public.project_categories is 'プロジェクト区分マスタ（projects.category_id から参照）';
comment on column public.project_categories.color is '#RRGGBB。brand.md の許容色（赤の濃淡・無彩色）だけを入れる';

create index if not exists idx_project_categories_active
  on public.project_categories (is_deleted, sort_order);

-- ── 2) フェーズ進捗ステータスマスタ ────────────────────────
--   scope       … 'common'（全区分共通）/ 'category'（特定区分専用）
--   category_id … scope='category' のときだけ必須
--   is_default  … 各スコープで1件だけ。新規フェーズの初期値になる
--   is_done     … 「完了扱い」。フェーズ一覧の『完了を除外』とガントの完了フィルタで使う
--
--   ⚠️ フェーズの選択肢は「その区分専用 ＋ 共通」。区分なしのPJは共通のみ。
create table if not exists public.phase_statuses (
  id          serial primary key,
  scope       text    not null default 'common',
  category_id int     references public.project_categories(id) on delete cascade,
  name        text    not null,
  color       text    not null default '#a1a1aa',
  is_default  boolean not null default false,
  is_done     boolean not null default false,
  sort_order  int     not null default 0,
  is_deleted  boolean not null default false,
  created_at  timestamptz default now()
);

-- scope と category_id の整合（共通なら category_id は NULL、区分専用なら必須）
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase_statuses_scope_chk') then
    alter table public.phase_statuses
      add constraint phase_statuses_scope_chk check (
        (scope = 'common'   and category_id is null) or
        (scope = 'category' and category_id is not null)
      );
  end if;
end $$;

comment on table  public.phase_statuses is 'フェーズ進捗ステータスマスタ（anken.status_id から参照）';
comment on column public.phase_statuses.is_done is '完了扱い。フェーズ一覧の「完了を除外」とガントの完了フィルタの判定に使う';

-- 既定は各スコープで1件だけ（部分ユニークインデックス）
create unique index if not exists uq_phase_statuses_default
  on public.phase_statuses (scope, coalesce(category_id, 0))
  where is_default and not is_deleted;

create index if not exists idx_phase_statuses_active
  on public.phase_statuses (is_deleted, sort_order);

-- ── 3) 参照列 ──────────────────────────────────────────────
alter table public.projects add column if not exists category_id int
  references public.project_categories(id) on delete set null;
create index if not exists idx_projects_category on public.projects(category_id);

alter table public.anken    add column if not exists status_id int
  references public.phase_statuses(id) on delete set null;
create index if not exists idx_anken_status on public.anken(status_id);

-- ── 4) RLS ─────────────────────────────────────────────────
--   参照は認証済みなら全員（一覧の区分チップ・ステータスチップの表示に必要）。
--   書き込みは運営のみ（is_ops）。判定関数は migration_phase1_rls.sql 定義。
alter table public.project_categories enable row level security;
alter table public.phase_statuses     enable row level security;

drop policy if exists "project_categories_select" on public.project_categories;
create policy "project_categories_select" on public.project_categories
  for select to authenticated using (true);
drop policy if exists "project_categories_write" on public.project_categories;
create policy "project_categories_write" on public.project_categories
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

drop policy if exists "phase_statuses_select" on public.phase_statuses;
create policy "phase_statuses_select" on public.phase_statuses
  for select to authenticated using (true);
drop policy if exists "phase_statuses_write" on public.phase_statuses;
create policy "phase_statuses_write" on public.phase_statuses
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- ── 5) Realtime ────────────────────────────────────────────
--   ⚠️ 同じテーブルを二重に add すると 42710 で落ちるため存在チェックする。
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'project_categories'
  ) then
    alter publication supabase_realtime add table public.project_categories;
  end if;
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'phase_statuses'
  ) then
    alter publication supabase_realtime add table public.phase_statuses;
  end if;
end $$;

-- ── 6) 初期データ（共通スコープの進捗ステータス4件）────────
--   ⚠️ 色は STATUS_CONFIG（未着手=グレー / 進行中=グリーン / 完了=チャコール）と
--      揃える。確認待ちだけアンバー（対応待ち＝止まっている、の意味）。
-- ⚠️ すでに共通スコープが1件でもあれば何もしない（運用中の設定を上書きしないため）。
do $$
begin
  if not exists (select 1 from public.phase_statuses where scope = 'common') then
    insert into public.phase_statuses (scope, category_id, name, color, is_default, is_done, sort_order) values
      ('common', null, '未着手',   '#a1a1aa', true,  false, 10),
      ('common', null, '進行中',   '#22c55e', false, false, 20),
      ('common', null, '確認待ち', '#f59e0b', false, false, 30),
      ('common', null, '完了',     '#3f3f46', false, true,  40);
  end if;
end $$;

-- ============================================================
-- 確認:
--   select * from public.project_categories order by sort_order, id;
--   select id, scope, category_id, name, color, is_default, is_done
--     from public.phase_statuses order by scope, sort_order, id;
--   select count(*) filter (where category_id is not null) as 区分あり from public.projects;
-- ============================================================
