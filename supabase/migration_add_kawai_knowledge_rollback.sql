-- ============================================================
-- ロールバック: KAWAI ナレッジ基盤（フェーズB / 正本スキーマ）
--   migration_add_kawai_knowledge.sql で追加したものだけを取り消す。
--   ⚠️ 実データを投入済みの場合、全ナレッジが消える。適用前に必ず確認。
--   ※ chat_bookmarks / members / bot_* / set_updated_at() には触れない。
-- ============================================================

drop function if exists public.knowledge_public_search(text, text, integer);
drop function if exists public.knowledge_chunk_upsert(bigint, integer, text[], text, text, integer, integer, integer, text, text);

drop table if exists public.persona_style_examples     cascade;
drop table if exists public.persona_style_profiles     cascade;
drop table if exists public.persona_positions          cascade;
drop table if exists public.persona_facts              cascade;
drop table if exists public.knowledge_conflicts        cascade;
drop table if exists public.knowledge_unit_topics      cascade;
drop table if exists public.knowledge_topics           cascade;
drop table if exists public.knowledge_chunks           cascade;
drop table if exists public.knowledge_assets           cascade;
drop table if exists public.knowledge_units            cascade;
drop table if exists public.knowledge_document_versions cascade;
drop table if exists public.knowledge_documents        cascade;
drop table if exists public.knowledge_source_items     cascade;
drop table if exists public.knowledge_sync_runs        cascade;
drop table if exists public.knowledge_sources          cascade;
drop table if exists public.ai_personas                cascade;

-- ※ pgvector(vector) / pgcrypto は他機能が使う可能性があるため drop しない。
-- ※ set_updated_at() は他テーブルでも使うため drop しない。
