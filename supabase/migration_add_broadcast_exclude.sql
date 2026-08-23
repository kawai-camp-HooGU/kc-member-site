-- ============================================================
-- Phase P2-A：配信の除外リスト
--   絞り込みに一致しても「この属性を持つ人は除外」する。
--   例：見込み全員へ。ただし「既存顧客」タグの人は除外。
-- ============================================================
alter table public.broadcasts add column if not exists target_exclude_attr_ids integer[] not null default '{}';
