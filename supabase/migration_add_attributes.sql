-- ============================================================
-- 属性マスタ（属性A ＞ 属性B ＞ 属性C の親子カスケード階層）
--   設定「属性」タブで編集。自己参照ツリー（最大3階層 level 0..2）。
-- ============================================================

-- 階層レベル名（level 0=属性A / 1=属性B / 2=属性C）
create table if not exists public.attribute_levels (
  level smallint primary key check (level between 0 and 2),
  name  text not null
);
alter table public.attribute_levels enable row level security;
drop policy if exists "attribute_levels_all" on public.attribute_levels;
create policy "attribute_levels_all" on public.attribute_levels
  for all to authenticated using (true) with check (true);

insert into public.attribute_levels (level, name) values
 (0, '大分類'), (1, '中分類'), (2, '小分類')
on conflict (level) do nothing;

-- 属性ノード（自己参照ツリー）
create table if not exists public.attributes (
  id          bigint generated always as identity primary key,
  level       smallint not null check (level between 0 and 2),
  parent_id   bigint references public.attributes(id) on delete cascade,
  name        text    not null default '',
  color       text    not null default '#6B7280',
  bg          boolean not null default false,   -- 背景色を敷く
  bold        boolean not null default false,   -- 太字
  title_color boolean not null default false,   -- タイトル色に表示色を適用
  visible     boolean not null default true,    -- 一覧での表示/非表示
  sort_order  int     not null default 0,       -- 同一階層内の並び順
  is_deleted  boolean not null default false,
  created_at  timestamptz default now()
);
-- level 0 は親なし、level 1/2 は親あり（アプリ側でも担保）
create index if not exists attributes_parent_idx on public.attributes(parent_id);
create index if not exists attributes_level_sort_idx on public.attributes(level, sort_order);

alter table public.attributes enable row level security;
drop policy if exists "attributes_all" on public.attributes;
create policy "attributes_all" on public.attributes
  for all to authenticated using (true) with check (true);
