-- ============================================================
-- コンテンツ「セクション（入口）」層の新設
--
--   会員ポータルの「コンテンツ」入口を、コンテンツ2・3…と汎用的に増やせるように、
--   ページの上に「セクション（＝サイドバーの入口／会員ハブ1つ）」層を足す。
--
--   ・content_sections            … 入口。1セクション＝サイドバー1項目＝ハブ1つ
--   ・content_section_attributes  … セクションの公開対象属性（ページ/コンテンツと同方式）
--   ・content_pages.section_id    … ページがどのセクションに所属するか
--
--   設計はコンテンツ既存踏襲：論理削除（is_deleted）／属性は中間テーブル／
--   公開判定はアプリ側 canView を流用。RLS も contents/content_pages と同じ方針。
-- ============================================================

-- ① セクション本体
create table if not exists public.content_sections (
  id          serial primary key,
  name        text    not null default '',      -- 表示名（例：コンテンツ / 講座 / 特典）
  icon        text,                              -- サイドバー用アイコンキー（任意・将来用）
  overview    text,                              -- ハブ上部の説明（任意）
  sort_order  int     not null default 0,        -- サイドバーの並び順
  published   boolean not null default true,     -- 入口自体の公開ON/OFF
  attr_mode   text    not null default 'any',    -- 公開対象モード（any/all/exany/exall）
  is_default  boolean not null default false,    -- 既定セクション（削除不可・未所属ページの受け皿）
  is_deleted  boolean not null default false,    -- 論理削除
  created_at  timestamptz default now()
);

-- ② セクションの公開対象属性（末端ノードID）
create table if not exists public.content_section_attributes (
  section_id   int not null references public.content_sections(id) on delete cascade,
  attribute_id int not null
);
create index if not exists idx_content_section_attributes_section
  on public.content_section_attributes(section_id);

-- ③ ページにセクション参照を追加
alter table public.content_pages
  add column if not exists section_id int references public.content_sections(id);
create index if not exists idx_content_pages_section on public.content_pages(section_id);

-- ④ 既定セクションを1つ用意し、未所属の既存ページを寄せる（後方互換）
do $$
declare def_id int;
begin
  -- 既存の既定セクションがあれば使う。無ければ作る。
  select id into def_id from public.content_sections where is_default = true and is_deleted = false limit 1;
  if def_id is null then
    insert into public.content_sections (name, sort_order, published, is_default)
      values ('コンテンツ', 0, true, true)
      returning id into def_id;
  end if;
  -- 未所属（section_id が NULL）の既存ページを既定セクションへ
  update public.content_pages set section_id = def_id where section_id is null;
end $$;

-- ⑤ RLS（contents / content_pages と同じ方針）
alter table public.content_sections           enable row level security;
alter table public.content_section_attributes enable row level security;

-- セクション：未公開/削除は運営のみ。会員は公開かつ未削除のみ参照可。書き込みは運営のみ。
create policy "content_sections_select" on public.content_sections for select to authenticated
  using (public.is_ops() or (published = true and is_deleted = false));
create policy "content_sections_insert_ops" on public.content_sections for insert to authenticated
  with check (public.is_ops());
create policy "content_sections_update_ops" on public.content_sections for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "content_sections_delete_ops" on public.content_sections for delete to authenticated
  using (public.is_ops());

-- セクション属性：全員が参照可（表示判定に必要）。書き込みは運営のみ。
create policy "content_section_attrs_read_all" on public.content_section_attributes for select to authenticated
  using (true);
create policy "content_section_attrs_insert_ops" on public.content_section_attributes for insert to authenticated
  with check (public.is_ops());
create policy "content_section_attrs_update_ops" on public.content_section_attributes for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "content_section_attrs_delete_ops" on public.content_section_attributes for delete to authenticated
  using (public.is_ops());
