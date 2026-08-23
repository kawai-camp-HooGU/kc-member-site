-- ============================================================
-- ロールバック: 公開問い合わせボット（フェーズA）
--   migration_add_bot.sql で追加したものだけを取り消す。
--   chat_bookmarks / role_permissions の既存行には触れない。
--   ⚠️ bot_bm_index は chat_bookmarks から再生成できる索引のため drop 安全。
-- ============================================================

drop function if exists public.bot_hybrid_search(text, text, text[], int);
drop function if exists public.bot_bm_upsert(bigint, text, text, text, text, text);

drop table if exists public.bot_public_logs;
drop table if exists public.bot_usage;
drop table if exists public.bot_share_links;
drop table if exists public.bot_policies;
drop table if exists public.bot_bm_index;

-- ボット用のロール権限行を除去（他機能のキーには影響しない）
delete from public.role_permissions where feature in ('bot','bot_manage');

-- ※ pgvector 拡張(vector)は他機能が使う可能性があるため drop しない。
