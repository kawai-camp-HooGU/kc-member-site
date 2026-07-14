-- ============================================================
-- コンテンツのファイル掲載（PDF）＋ ダウンロードログ
--
--   BEFORE：資料コンテンツは「Googleドライブの共有URLを iframe で埋め込む」だけ。
--           共有設定を「リンクを知っている全員」にする必要があり、
--           URLが漏れれば誰でも取得できた（会員限定にできない）。
--
--   AFTER ：Supabase Storage の**プライベートバケット**に実体を置き、
--           閲覧可否をサーバーで判定してから**期限付きの署名URL**を発行する。
--           既存の form-uploads / chat-attachments と同じ方式。
--
--   ⚠️ バケットは public=false。anon/authenticated から直接は読めない。
--      ダウンロードURLの発行は /api/content/download（service role）だけが行う。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. contents にファイル列を追加 ───────────────────────────
alter table public.contents
  add column if not exists file_path text,   -- Storage 上のパス（content-files/ 配下）
  add column if not exists file_name text,   -- 元のファイル名（ダウンロード時の保存名）
  add column if not exists file_size bigint; -- バイト数（一覧に「2.4 MB」と出すため）

comment on column public.contents.file_path is 'Storage(content-files) のパス。URL埋め込みではなく実体を持つ資料に使う';
comment on column public.contents.file_name is 'ダウンロード時の保存名（元のファイル名）';
comment on column public.contents.file_size is 'ファイルサイズ（バイト）';

-- ── 2. ストレージバケット（プライベート）────────────────────
insert into storage.buckets (id, name, public)
values ('content-files', 'content-files', false)
on conflict (id) do nothing;

-- アップロード・差し替え・削除は運営のみ。
--   ⚠️ 読み取り（select）ポリシーは**あえて作らない**。
--      閲覧はすべて service role の署名URL発行を経由させ、
--      「誰が落としたか」を必ずログに残すため。
drop policy if exists "content_files_ops_insert" on storage.objects;
create policy "content_files_ops_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'content-files' and public.is_ops());

drop policy if exists "content_files_ops_update" on storage.objects;
create policy "content_files_ops_update" on storage.objects for update to authenticated
  using (bucket_id = 'content-files' and public.is_ops());

drop policy if exists "content_files_ops_delete" on storage.objects;
create policy "content_files_ops_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'content-files' and public.is_ops());

-- ── 3. ダウンロードログ ─────────────────────────────────────
--   「誰がいつ何を落としたか」に答えるための唯一の記録。
--   署名URLは発行後の追跡ができないため、**発行時点**を1行として残す。
--   （＝厳密には「ダウンロードを開始した」記録。URLを保存して後日使われても追えない）
create table if not exists public.content_downloads (
  id           bigint generated always as identity primary key,
  content_id   bigint not null references public.contents(id) on delete cascade,
  -- 未ログイン（外部公開コンテンツ）のダウンロードもあるので NULL を許す
  member_id    int references public.members(id) on delete set null,
  file_name    text,
  created_at   timestamptz not null default now()
);

create index if not exists content_downloads_content_idx
  on public.content_downloads(content_id, created_at desc);
create index if not exists content_downloads_member_idx
  on public.content_downloads(member_id, created_at desc);

-- RLS：運営のみ閲覧。書き込みは service_role（API Route）経由のみ。
alter table public.content_downloads enable row level security;
drop policy if exists "content_downloads_ops" on public.content_downloads;
create policy "content_downloads_ops" on public.content_downloads for select to authenticated
  using (public.is_ops());

comment on table public.content_downloads is 'PDF等のダウンロード記録（署名URLの発行時に1行）。運営のみ閲覧可';
