-- ============================================================
-- 設問の「非表示」フラグ
--
--   フォーム編集画面の設問一覧で「非表示」にした設問を表す。
--   true のとき、回答画面には出さず、検証・選択時アクションも走らない。
--   （編集画面には残るので、あとで再表示できる。削除とは異なる。）
--
--   ⚠️ 既存データは false（従来どおり表示）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

alter table public.form_fields
  add column if not exists hidden boolean not null default false;

comment on column public.form_fields.hidden is
  '設問を回答画面に出さない（true=非表示／false=表示）。編集画面には残る。';
