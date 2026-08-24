-- ============================================================
-- migration_ai_search_v2.sql のロールバック
--   ⚠️ 先にアプリ側を旧経路へ戻すこと（AI_SEARCH_V2=false）。
--   ⚠️ 旧 knowledge_public_search は drop していないため、関数を消せば旧検索に戻る。
-- ============================================================
drop index concurrently if exists kchunk_pgroonga_idx;

drop function if exists public.knowledge_search_v2(uuid, text, text, int[], text[], real, int, int);
drop function if exists public.ai_index_health();
drop function if exists public.knowledge_visibility_matrix(jsonb);
drop function if exists public.doc_visible_to(bigint, int[]);

drop table if exists public.knowledge_eval_runs;

-- 列は残してよい（検索に使われなくなるだけ）。完全に戻すなら以下。
-- alter table public.knowledge_documents drop column if exists expires_at;
-- alter table public.knowledge_documents drop column if exists tags;
-- alter table public.knowledge_documents drop column if exists attr_mode;
-- alter table public.knowledge_documents drop column if exists target_attr_ids;
-- alter table public.knowledge_units     drop column if exists freshness_class;

-- ナレッジソース（contents / news）を消すと、取り込んだ文書も cascade で消える点に注意。
-- delete from public.knowledge_sources where source_type in ('content','news');
