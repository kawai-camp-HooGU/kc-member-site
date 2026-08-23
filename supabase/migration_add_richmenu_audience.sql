-- ============================================================
-- Phase 7②：リッチメニューのセグメント出し分け
--   メニューごとに「表示条件」を持たせ、友だち追加・タグ変化・会員連携時に
--   条件に合う最優先メニューを個別リンク（linkRichMenu）で自動表示する。
--     audience:  all（全員・既定のベース）/ unlinked（未連携）/ linked（連携済み会員）/ attr（タグ指定）
--     audience_attr_ids: attr のときの対象属性ID（いずれか保有で一致）
--     priority: 大きいほど優先（同条件が複数一致したとき）
-- ============================================================
alter table public.line_rich_menus add column if not exists audience text not null default 'all';
alter table public.line_rich_menus add column if not exists audience_attr_ids integer[] not null default '{}';
alter table public.line_rich_menus add column if not exists priority integer not null default 0;
