-- ============================================================
-- ナレッジ取り込み状況（R5-① / ナレッジ管理画面）
--   ・入口（source_type）ごとに 文書数・チャンク数・検索対象数・埋め込み済み数・最終同期 を1回で返す。
--   ・画面から件数を出すために PostgREST で何度も数えると往復が増えるため、SQL側で1回にまとめる。
--
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（create or replace）。テーブルは作らない。
--   前提: migration_add_kawai_knowledge.sql ／ migration_ai_search_v2.sql
-- ============================================================

create or replace function public.knowledge_status(p_persona_id uuid default null)
returns table (
  source_type    text,
  authority      numeric,
  documents      bigint,   -- 検索に生きている文書（is_active かつ published）
  inactive       bigint,   -- 元が消えた／非公開になり対象外にした文書
  chunks         bigint,
  retrievable    bigint,   -- そのうち検索対象の断片
  embedded       bigint,   -- そのうち埋め込み済みの断片
  last_synced_at timestamptz,
  last_status    text
)
language sql stable as $$
  with src as (
    select ks.id, ks.source_type, ks.authority_weight
    from public.knowledge_sources ks
    where p_persona_id is null or ks.persona_id = p_persona_id
  ),
  -- 文書数（生きている／対象外）
  docs as (
    select s.source_type,
           count(*) filter (where d.is_active and d.publication_status = 'published') as documents,
           count(*) filter (where not d.is_active) as inactive
    from src s
    left join public.knowledge_documents d on d.source_id = s.id
    group by s.source_type
  ),
  -- 断片数（生きている文書のものだけ数える）
  chk as (
    select s.source_type,
           count(c.id) as chunks,
           count(c.id) filter (where c.is_retrievable) as retrievable,
           count(c.id) filter (where c.embedding is not null) as embedded
    from src s
    join public.knowledge_documents d on d.source_id = s.id and d.is_active
    join public.knowledge_units u      on u.document_id = d.id
    left join public.knowledge_chunks c on c.unit_id = u.id
    group by s.source_type
  ),
  -- 直近の同期（成否を問わず最後の1件）
  runs as (
    select distinct on (s.source_type)
           s.source_type, r.finished_at, r.status
    from src s
    join public.knowledge_sync_runs r on r.source_id = s.id
    order by s.source_type, r.started_at desc
  )
  select s.source_type,
         max(s.authority_weight)                as authority,
         coalesce(max(docs.documents), 0)       as documents,
         coalesce(max(docs.inactive), 0)        as inactive,
         coalesce(max(chk.chunks), 0)           as chunks,
         coalesce(max(chk.retrievable), 0)      as retrievable,
         coalesce(max(chk.embedded), 0)         as embedded,
         max(runs.finished_at)                  as last_synced_at,
         max(runs.status)                       as last_status
  from src s
  left join docs on docs.source_type = s.source_type
  left join chk  on chk.source_type  = s.source_type
  left join runs on runs.source_type = s.source_type
  group by s.source_type
  order by s.source_type;
$$;

comment on function public.knowledge_status(uuid) is
  'ナレッジ管理画面の「取り込み状況」。入口ごとの件数と最終同期を1回で返す。';
