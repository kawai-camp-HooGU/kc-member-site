-- ============================================================
-- 会員ホームの「ブロック」層の新設（REQ-094）
--
--   会員ホームを固定レイアウトから「運営が組んだブロックの並び」に変える。
--   ホームは2枚ある：メンバー用（audience='member'）／外部用（audience='external'）。
--   1ブロックは必ずどちらか一方に属する（"両方" は無い。両方に出したければ2件作る）。
--
--   ・home_blocks             … ブロック本体。1行＝会員ホーム上の1区画
--   ・home_block_attributes   … ブロックの公開対象属性（ページ/コンテンツ/セクションと同方式）
--
--   設計はコンテンツ既存踏襲：論理削除（is_deleted）／属性は中間テーブル／
--   公開判定はアプリ側 canView を流用。RLS も content_sections と同じ方針。
--
-- ⚠️ 何度実行しても安全（冪等）にしてある。
--    create policy には IF NOT EXISTS が無いため、必ず drop policy if exists を前置する。
-- ⚠️ このSQLは新規テーブルの追加のみで、既存テーブルの列変更・データ更新を含まない。
--    唯一の例外は content_views へのインデックス追加（③）で、これも追加のみ。
-- ============================================================

-- ① ブロック本体 ------------------------------------------------
create table if not exists public.home_blocks (
  id           serial primary key,
  -- どちらのホーム画面に属するか。sort_order は audience ごとの並び順として扱う。
  --   ⚠️ これは「どちらの画面に置くか」であって、アクセス権ではない。
  --      中身そのものの可否は属性（canView）と RLS が決める。
  audience     text    not null default 'member',
  kind         text    not null,                 -- hero/continue/shelf/ranking/launcher/news/event/html
  title        text    not null default '',      -- 会員に見せる見出し（空なら見出しを出さない）
  sort_order   int     not null default 0,
  published    boolean not null default true,

  -- 掲載期間。運営編集枠（hero/html/手動 shelf）が
  -- 「更新が止まった瞬間に古びる」のを構造で防ぐ。
  --   display_from  : NULL なら即時
  --   display_until : NULL なら無期限。hero はアプリ側で必須にする
  --                   （DBでは NULL を許す＝既存行の移行と、他 kind のため）
  display_from  timestamptz,
  display_until timestamptz,

  attr_mode    text    not null default 'any',   -- any/all/exany/exall（既存と同じ語彙）

  -- ソース参照は「列」で持つ。jsonb に埋めるとページ削除時に宙ぶらりんになるため。
  source_mode       text not null default 'none', -- none/section/page/content/manual/auto
  source_section_id int references public.content_sections(id),
  source_page_id    int references public.content_pages(id),
  source_content_id int references public.contents(id),
  -- manual のときの並び。中間テーブルを増やさない（develop.md §4）
  content_ids       int[] not null default '{}',

  -- 表示だけの設定は kind ごとに形が変わるので jsonb（develop.md §4 の条件に合致）
  --   { limit, lead, ctaLabel, imageUrl, showMore, period }
  config       jsonb   not null default '{}'::jsonb,

  -- kind='html' のみ。sanitizeDoorHtml() を通した値だけ保存する
  body_html    text,

  is_deleted   boolean not null default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 列挙値は CHECK で縛る（migration_add_section_door_page.sql の door_mode と同方式）。
-- 制約違反は lib/contents.ts の describeDbError() が 23514 として日本語に訳す。
alter table public.home_blocks drop constraint if exists home_blocks_audience_chk;
alter table public.home_blocks add  constraint home_blocks_audience_chk
  check (audience in ('member','external'));

alter table public.home_blocks drop constraint if exists home_blocks_kind_chk;
alter table public.home_blocks add  constraint home_blocks_kind_chk
  check (kind in ('hero','continue','shelf','ranking','launcher','news','event','html'));

alter table public.home_blocks drop constraint if exists home_blocks_source_mode_chk;
alter table public.home_blocks add  constraint home_blocks_source_mode_chk
  check (source_mode in ('none','section','page','content','manual','auto'));

alter table public.home_blocks drop constraint if exists home_blocks_attr_mode_chk;
alter table public.home_blocks add  constraint home_blocks_attr_mode_chk
  check (attr_mode in ('any','all','exany','exall'));

-- 並び順は「どちらのホームか」ごとに独立している
create index if not exists idx_home_blocks_order
  on public.home_blocks(audience, sort_order, id) where is_deleted = false;
-- 掲載期限の切れたブロックを弾く問い合わせ用
create index if not exists idx_home_blocks_until
  on public.home_blocks(display_until) where is_deleted = false;
-- 参照キーには必ずインデックスを張る（develop.md §2-3）
create index if not exists idx_home_blocks_src_section on public.home_blocks(source_section_id);
create index if not exists idx_home_blocks_src_page    on public.home_blocks(source_page_id);
create index if not exists idx_home_blocks_src_content on public.home_blocks(source_content_id);

-- updated_at はトリガで必ず動かす（アプリ側の送信漏れに依存しない）
create or replace function public.touch_home_blocks() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists trg_home_blocks_touch on public.home_blocks;
create trigger trg_home_blocks_touch before update on public.home_blocks
  for each row execute function public.touch_home_blocks();

-- ② ブロックの公開対象属性（content_section_attributes と同型）------
create table if not exists public.home_block_attributes (
  block_id     int not null references public.home_blocks(id) on delete cascade,
  attribute_id int not null
);
create index if not exists idx_home_block_attributes_block
  on public.home_block_attributes(block_id);

-- ③ ランキング集計用インデックス --------------------------------
--   「今週よく見られているもの」は content_views.last_viewed_at で期間を切る。
--   view_count は累計なので期間集計には使えない。
create index if not exists content_views_last_idx
  on public.content_views(last_viewed_at);

-- ④ RLS（content_sections と同じ方針）---------------------------
alter table public.home_blocks           enable row level security;
alter table public.home_block_attributes enable row level security;

-- ブロック：未公開/削除済は運営のみ。会員は公開かつ未削除のみ参照可。書き込みは運営のみ。
drop policy if exists "home_blocks_select"     on public.home_blocks;
create policy "home_blocks_select" on public.home_blocks for select to authenticated
  using (public.is_ops() or (published = true and is_deleted = false));
drop policy if exists "home_blocks_insert_ops" on public.home_blocks;
create policy "home_blocks_insert_ops" on public.home_blocks for insert to authenticated
  with check (public.is_ops());
drop policy if exists "home_blocks_update_ops" on public.home_blocks;
create policy "home_blocks_update_ops" on public.home_blocks for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
drop policy if exists "home_blocks_delete_ops" on public.home_blocks;
create policy "home_blocks_delete_ops" on public.home_blocks for delete to authenticated
  using (public.is_ops());

-- ブロック属性：全員が参照可（表示判定に必要）。書き込みは運営のみ。
drop policy if exists "home_block_attrs_read_all"   on public.home_block_attributes;
create policy "home_block_attrs_read_all" on public.home_block_attributes for select to authenticated
  using (true);
drop policy if exists "home_block_attrs_insert_ops" on public.home_block_attributes;
create policy "home_block_attrs_insert_ops" on public.home_block_attributes for insert to authenticated
  with check (public.is_ops());
drop policy if exists "home_block_attrs_update_ops" on public.home_block_attributes;
create policy "home_block_attrs_update_ops" on public.home_block_attributes for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
drop policy if exists "home_block_attrs_delete_ops" on public.home_block_attributes;
create policy "home_block_attrs_delete_ops" on public.home_block_attributes for delete to authenticated
  using (public.is_ops());

-- ⑤ 既定ブロック（＝現行ホームと同じ見た目）---------------------
--   メンバー用・外部用の両方に入れる。
--   ⚠️ 外部用を空のままにすると、外部ロールの方のホームが空になる。必ず両方入れること。
--   ⚠️ 1件でも既に存在する場合は何もしない（再実行しても増えない）。
do $$
begin
  if not exists (select 1 from public.home_blocks) then
    insert into public.home_blocks (audience, kind, title, sort_order, published) values
      ('member',   'launcher', '',         0, true),
      ('member',   'news',     'お知らせ', 1, true),
      ('external', 'launcher', '',         0, true),
      ('external', 'news',     'お知らせ', 1, true);
  end if;
end $$;
