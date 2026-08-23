-- ============================================================
-- コンテンツページ /p の表示レイアウト（カード一覧 / 埋め込み表示）
--
--   BEFORE：公開ページ /p は「配下コンテンツをカードで並べる一覧」固定。
--           各カードを押すと個別ページ /c へ遷移して、そこで動画やPDFを再生する。
--
--   AFTER ：ページ単位で layout を選べる。
--             cards … 従来どおりカード一覧（既定・既存ページは自動でこちら）
--             embed … 動画・資料・本文を1カラムでその場に埋め込んで表示（LP風の1枚ページ）
--
--   ⚠️ 既定は 'cards' なので、既存の全ページは挙動が変わらない（後方互換）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

alter table public.content_pages
  add column if not exists layout text not null default 'cards';

-- 想定外の値が入らないよう軽く制約（cards / embed のみ）
alter table public.content_pages
  drop constraint if exists content_pages_layout_chk;
alter table public.content_pages
  add constraint content_pages_layout_chk check (layout in ('cards', 'embed'));

comment on column public.content_pages.layout is
  'public /p の表示方式。cards＝カード一覧（既定）／embed＝動画・資料・本文を1カラムで埋め込み表示';
