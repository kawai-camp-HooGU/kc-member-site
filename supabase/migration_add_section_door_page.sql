-- ============================================================
-- セクション「扉ページ」
--
--   BEFORE：セクションのハブ（会員のコンテンツ一覧）は
--           「配下ページをカードで自動的に並べる」だけだった。
--           見出しでグルーピングしたり、説明を挟んだりはできない。
--
--   AFTER ：セクションごとに「扉ページHTML」を持てる。
--           運営がHTMLでデザインし、data-page 等のトークンで
--           配下ページへの入口を好きな位置に配置できる。
--
--   ⚠️ door_mode の既定は 'auto'。既存セクションは今までどおり
--      カード一覧が出るため、挙動は一切変わらない（後方互換）。
--
--   ⚠️ door_html は必ず lib/ai/sanitizeDoor.ts の sanitizeDoorHtml() を
--      通した値のみ保存すること。描画は dangerouslySetInnerHTML で行うため、
--      ここが stored-XSS の唯一の入口になる。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. セクションに扉ページを持たせる ───────────────────────
alter table public.content_sections
  add column if not exists door_mode text not null default 'auto',
  add column if not exists door_html text;

-- 想定外の値が入らないよう制約（auto / html / hybrid のみ）
alter table public.content_sections
  drop constraint if exists content_sections_door_mode_chk;
alter table public.content_sections
  add constraint content_sections_door_mode_chk
  check (door_mode in ('auto', 'html', 'hybrid'));

comment on column public.content_sections.door_mode is
  'ハブ本体の表示方式。auto＝ページカード一覧（既定・従来どおり）／html＝扉HTMLのみ／hybrid＝扉HTML＋カード一覧';
comment on column public.content_sections.door_html is
  '扉ページHTML。data-page 等のトークンを描画時に解決する。sanitizeDoorHtml() を通した値のみ保存すること';

-- ── 2. ページに安定した参照キー（slug）を持たせる ──────────
--   扉HTMLから id（数値）で参照すると、開発環境と本番で番号が変わり
--   同じ扉HTMLを使い回せない。人が読める不変キーで参照する。
--
--   ⚠️ abbr（表示用の略称）を流用しない。abbr は一意保証がなく
--      運営が表示都合で変更するため、参照キーにすると
--      リンクが黙って切れる。参照専用の列を分ける。
alter table public.content_pages
  add column if not exists slug text;

-- 部分ユニーク：未設定（NULL）と論理削除済みは対象外にする。
--   これにより「slug を付けないページ」が何件あっても衝突しない。
create unique index if not exists content_pages_slug_uidx
  on public.content_pages(slug)
  where slug is not null and is_deleted = false;

comment on column public.content_pages.slug is
  '扉ページHTMLから参照するための不変キー（例: C00）。未設定は NULL（部分ユニークのため衝突しない）';

-- ── 3. RLS ──────────────────────────────────────────────────
--   追加した列は既存テーブルのものなので、
--   content_sections / content_pages のポリシーがそのまま適用される。
--   （セクションの書き込みは is_ops() のみ ＝ 扉HTMLを書けるのは運営だけ）
--   新規ポリシーは不要。
