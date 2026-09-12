-- ============================================================
-- コンテンツ系テーブルの書き込みを「運営のみ」に制限する（REQ-106 前提整備）
--
--   BEFORE：contents / content_pages / content_attributes / content_page_attributes は
--           いずれも `for all to authenticated using (true) with check (true)` だった。
--           つまり**ログインさえしていれば一般会員でも書き換えられる**。
--             ・contents.body_html を直接 UPDATE できる
--             ・content_attributes の行を DELETE すると「公開対象＝全員」になり、
--               有料限定コンテンツが誰にでも見える状態にできる
--
--   AFTER ：SELECT は従来どおり authenticated 全員（会員ポータルが
--           クライアントから一覧を読むため）。**INSERT / UPDATE / DELETE は
--           public.is_ops() が真のときだけ**に絞る。
--
--   なぜ REQ-106 の前提なのか：
--     本文HTMLに書く data-embed トークンは「運営がこのコンテンツを埋め込みたい」
--     という意思表示として扱い、実際に描いてよいかは描画側で再判定する設計にした。
--     しかし本文を誰でも書き換えられる状態では、その再判定が
--     「多層防御の1枚目」ではなく「唯一の防御線」になってしまう。
--
--   ⚠️ public.is_ops() に依存する。storage.objects の content_files_ops_*
--      ポリシー（migration_content_files.sql）と同じ関数なので、
--      既に本番へ存在しているはず。念のため冒頭で存在を確認して落とす。
--
--   ⚠️ 運営画面からの保存（saveContent 等）はブラウザの会員セッションで
--      実行される。適用後は「運営ロールでコンテンツを保存できること」を
--      必ず確認すること（ここが通らないと運営が編集できなくなる）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 0. 依存関数の存在確認 ───────────────────────────────────
do $$
begin
  if to_regprocedure('public.is_ops()') is null then
    raise exception
      'public.is_ops() が見つかりません。先に運営判定関数を作成してください（migration_content_files.sql のストレージポリシーも同じ関数に依存しています）';
  end if;
end $$;

-- ── 1. contents ─────────────────────────────────────────────
alter table public.contents enable row level security;

drop policy if exists "contents_all"          on public.contents;
drop policy if exists "contents_read"         on public.contents;
drop policy if exists "contents_ops_insert"   on public.contents;
drop policy if exists "contents_ops_update"   on public.contents;
drop policy if exists "contents_ops_delete"   on public.contents;

-- 読み取りは従来どおり（会員ポータルがクライアントから一覧を読む）
create policy "contents_read" on public.contents
  for select to authenticated using (true);

create policy "contents_ops_insert" on public.contents
  for insert to authenticated with check (public.is_ops());

create policy "contents_ops_update" on public.contents
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create policy "contents_ops_delete" on public.contents
  for delete to authenticated using (public.is_ops());

-- ── 2. content_pages ────────────────────────────────────────
alter table public.content_pages enable row level security;

drop policy if exists "content_pages_all"        on public.content_pages;
drop policy if exists "content_pages_read"       on public.content_pages;
drop policy if exists "content_pages_ops_insert" on public.content_pages;
drop policy if exists "content_pages_ops_update" on public.content_pages;
drop policy if exists "content_pages_ops_delete" on public.content_pages;

create policy "content_pages_read" on public.content_pages
  for select to authenticated using (true);

create policy "content_pages_ops_insert" on public.content_pages
  for insert to authenticated with check (public.is_ops());

create policy "content_pages_ops_update" on public.content_pages
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create policy "content_pages_ops_delete" on public.content_pages
  for delete to authenticated using (public.is_ops());

-- ── 3. content_attributes（公開対象属性）────────────────────
--   ここを書き換えられると「公開対象＝全員」に落とせるため、
--   contents 本体と同じ強さで守る。
alter table public.content_attributes enable row level security;

drop policy if exists "content_attributes_all"        on public.content_attributes;
drop policy if exists "content_attributes_read"       on public.content_attributes;
drop policy if exists "content_attributes_ops_insert" on public.content_attributes;
drop policy if exists "content_attributes_ops_update" on public.content_attributes;
drop policy if exists "content_attributes_ops_delete" on public.content_attributes;

create policy "content_attributes_read" on public.content_attributes
  for select to authenticated using (true);

create policy "content_attributes_ops_insert" on public.content_attributes
  for insert to authenticated with check (public.is_ops());

create policy "content_attributes_ops_update" on public.content_attributes
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create policy "content_attributes_ops_delete" on public.content_attributes
  for delete to authenticated using (public.is_ops());

-- ── 4. content_page_attributes ──────────────────────────────
alter table public.content_page_attributes enable row level security;

drop policy if exists "content_page_attributes_all"        on public.content_page_attributes;
drop policy if exists "content_page_attributes_read"       on public.content_page_attributes;
drop policy if exists "content_page_attributes_ops_insert" on public.content_page_attributes;
drop policy if exists "content_page_attributes_ops_update" on public.content_page_attributes;
drop policy if exists "content_page_attributes_ops_delete" on public.content_page_attributes;

create policy "content_page_attributes_read" on public.content_page_attributes
  for select to authenticated using (true);

create policy "content_page_attributes_ops_insert" on public.content_page_attributes
  for insert to authenticated with check (public.is_ops());

create policy "content_page_attributes_ops_update" on public.content_page_attributes
  for update to authenticated using (public.is_ops()) with check (public.is_ops());

create policy "content_page_attributes_ops_delete" on public.content_page_attributes
  for delete to authenticated using (public.is_ops());

-- ── 5. 確認クエリ（実行後に目視する）────────────────────────
--   期待：各テーブルに read（select）1本 ＋ ops_insert / ops_update / ops_delete が並ぶ。
--   *_all が残っていたら削除できていないので、名前を確かめて再実行すること。
--
-- select tablename, policyname, cmd
--   from pg_policies
--  where schemaname = 'public'
--    and tablename in ('contents','content_pages','content_attributes','content_page_attributes')
--  order by tablename, cmd, policyname;
