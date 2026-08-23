-- ============================================================
-- 設問「説明文」の HTML 表示フラグ
--
--   見出し／説明文ブロック（type=heading）や各設問の説明文を、
--   プレーンテキスト（改行保持）だけでなくサニタイズ済み HTML でも
--   表示できるようにする。true のとき HTML として描画する。
--
--   ⚠️ 表示側は必ず renderBodyHtml（<script>・on〇〇属性・javascript: を除去）
--      を通す。生 HTML はそのまま出さない。未ログインの外部回答者も開くため。
--   ⚠️ 既存データは false（プレーンテキスト）＝従来どおりの見え方。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

alter table public.form_fields
  add column if not exists desc_html boolean not null default false;

comment on column public.form_fields.desc_html is
  '説明文を HTML として表示するか（true=サニタイズHTML／false=プレーンテキスト・改行保持）';
