-- ============================================================
-- migration_add_home_blocks.sql の切戻し（REQ-094）
--
-- ⚠️⚠️ 実行すると、運営が設定したホームのブロックはすべて消えます。
--       実行前に必ず退避してください（psql で実行する場合）：
--
--         \copy (select * from public.home_blocks)           to 'home_blocks.csv'           csv header
--         \copy (select * from public.home_block_attributes) to 'home_block_attributes.csv' csv header
--
--       Supabase の SQL Editor から実行する場合は、上の2表を select して
--       結果を CSV でダウンロードしてから流してください。
--
-- 切戻し後、会員ホームは lib/homeBlocks.ts のフォールバックにより
-- 「大タイル＋お知らせ」の現行と同じ表示に戻ります（コードを戻さなくても壊れません）。
-- ============================================================

-- ① RLS ポリシー（テーブルごと落とすので必須ではないが、順序を明示しておく）
drop policy if exists "home_block_attrs_delete_ops" on public.home_block_attributes;
drop policy if exists "home_block_attrs_update_ops" on public.home_block_attributes;
drop policy if exists "home_block_attrs_insert_ops" on public.home_block_attributes;
drop policy if exists "home_block_attrs_read_all"   on public.home_block_attributes;

drop policy if exists "home_blocks_delete_ops" on public.home_blocks;
drop policy if exists "home_blocks_update_ops" on public.home_blocks;
drop policy if exists "home_blocks_insert_ops" on public.home_blocks;
drop policy if exists "home_blocks_select"     on public.home_blocks;

-- ② トリガと関数
drop trigger  if exists trg_home_blocks_touch on public.home_blocks;
drop function if exists public.touch_home_blocks();

-- ③ テーブル（属性が home_blocks を参照しているので子から落とす）
drop table if exists public.home_block_attributes;
drop table if exists public.home_blocks;

-- ④ content_views のインデックス
--    ⚠️ これは content_views（既存テーブル）に足したもの。
--       残しておいても害は無いので、迷ったらこの1行は実行しなくてよい。
drop index if exists public.content_views_last_idx;
