-- ============================================================
-- ナレッジ検索 v2（R3 / Ph2）
--   ① pgroonga による日本語N-gram索引（S-2）
--   ② knowledge_search_v2：persona 分離・属性フィルタ・スコア閾値・内訳返却（S-3 / S-6）
--   ③ contents / news をナレッジソースに追加（S-4 の前提）
--   ④ doc_visible_to：属性による公開判定（★高リスク。§運用注意を読むこと）
--   ⑤ knowledge_eval_runs：検索評価の履歴
--   ⑥ knowledge_units.freshness_class：発言単位の鮮度クラス（B-12）
--
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（if not exists / create or replace / on conflict do nothing）
--   ⚠️ 旧 knowledge_public_search は drop しない（切り戻せる状態を保つ）。
--   ⚠️ 索引作成はテーブルロックを避けるため concurrently を別途実行する（末尾の手順）。
-- ============================================================

create extension if not exists pgroonga;

-- ── ① 文書に「属性による公開範囲」「タグ」「期限」を持たせる ──
alter table public.knowledge_documents
  add column if not exists target_attr_ids int[] not null default '{}';
alter table public.knowledge_documents
  add column if not exists attr_mode text not null default 'any';
do $$ begin
  begin
    alter table public.knowledge_documents
      add constraint knowledge_documents_attr_mode_chk
      check (attr_mode in ('any','all','exany','exall'));
  exception when duplicate_object then null;
  end;
end $$;
alter table public.knowledge_documents
  add column if not exists tags text[] not null default '{}';
alter table public.knowledge_documents
  add column if not exists expires_at timestamptz;

-- ── ①-2 発言単位に「鮮度クラス」を持たせる（B-12） ──
--   ⚠️ knowledge_search_v2 が u.freshness_class を読むため、この列が無いと関数作成が
--      42703 で失敗する（freshness_class は persona_facts にしか無かった）。
--   ⚠️ 既存行は null のまま。取り込み直すまで鮮度注意は発火しない（§末尾の手順）。
alter table public.knowledge_units
  add column if not exists freshness_class text
  check (freshness_class in ('stable','periodic','volatile'));

comment on column public.knowledge_units.freshness_class is
  'stable / periodic / volatile。volatile を採用したら回答に鮮度注意を添える（B-12）。取込時に detectFreshness() が決める。';

create index if not exists kdoc_attr_idx    on public.knowledge_documents using gin(target_attr_ids);
create index if not exists kdoc_tags_idx    on public.knowledge_documents using gin(tags);
create index if not exists kdoc_expires_idx on public.knowledge_documents(expires_at)
  where expires_at is not null;

comment on column public.knowledge_documents.target_attr_ids is
  '公開対象の属性ID。空なら全員。contents/news の属性設定をコピーする。';
comment on column public.knowledge_documents.expires_at is
  'この日時を過ぎたら検索対象から外す。news に既定90日を入れる。null は無期限。';

-- ── ③-0 既存 CHECK 制約を広げる（新しい種別を受け入れるため）──
--   knowledge_sources.source_type      ← content / news を追加
--   knowledge_documents.visibility     ← member（会員限定。属性で絞る）を追加
--   ※ 制約名は自動生成のため、名前を決め打ちせず pg_constraint から探して外す。
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.knowledge_sources'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%source_type%'
  loop
    execute format('alter table public.knowledge_sources drop constraint %I', r.conname);
  end loop;

  for r in
    select conname from pg_constraint
    where conrelid = 'public.knowledge_documents'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%visibility%'
  loop
    execute format('alter table public.knowledge_documents drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.knowledge_sources
  add constraint knowledge_sources_source_type_chk
  check (source_type in ('note','x','chat_bookmark','content','news'));

alter table public.knowledge_documents
  add constraint knowledge_documents_visibility_chk
  check (visibility in ('public','paid','mixed','internal','unknown','member'));

comment on constraint knowledge_documents_visibility_chk on public.knowledge_documents is
  'member = 会員限定。target_attr_ids / attr_mode と doc_visible_to() で絞る。';

-- ── ③ contents / news をナレッジソースへ ──
insert into public.knowledge_sources
  (persona_id, source_type, name, root_locator, default_retrieval_mode, authority_weight)
select p.id, v.source_type, v.name, v.root_locator, 'answer_and_style', v.aw
from public.ai_personas p,
  (values
    ('content', 'kawai-contents', 'postgresql://public.contents', 1.000::numeric),
    ('news',    'kawai-news',     'postgresql://public.news',     0.900::numeric)
  ) as v(source_type, name, root_locator, aw)
where p.slug = 'kawai'
on conflict (persona_id, source_type, name) do nothing;

-- ============================================================
-- ④ 属性による公開判定
--   ⚠️ 高リスク（H2）。誤ると会員が他属性向けの資料をAI経由で閲覧できてしまう。
--   ⚠️ 判定は lib/ai/context.ts の canView() と同じ意味でなければならない。
--      ・p_member_attrs は「祖先を展開済み」の属性ID配列をアプリ側から渡す
--        （SQL側で再帰しない。展開は loadAttrTree() が持つ唯一の実装に任せる）
--      ・any   … 対象属性のいずれかを持つ
--      ・all   … 対象属性のすべてを持つ
--      ・exany … いずれも持たない
--      ・exall … すべては持たない
--   ⚠️ 本番で有効化する前に /api/bot/knowledge/verify で全件の同値性を確認すること。
-- ============================================================
create or replace function public.doc_visible_to(p_doc_id bigint, p_member_attrs int[])
returns boolean
language sql stable as $$
  select case
    when cardinality(d.target_attr_ids) = 0 then true
    when p_member_attrs is null             then false
    when d.attr_mode = 'any'   then      d.target_attr_ids &&  p_member_attrs
    when d.attr_mode = 'all'   then      d.target_attr_ids <@  p_member_attrs
    when d.attr_mode = 'exany' then not (d.target_attr_ids &&  p_member_attrs)
    when d.attr_mode = 'exall' then not (d.target_attr_ids <@  p_member_attrs)
    else true end
  from public.knowledge_documents d
  where d.id = p_doc_id;
$$;

-- ============================================================
-- ② 検索 v2
--   変更点（旧 knowledge_public_search との差）
--     ・persona_id を必須引数にした（複数ペルソナ・複数PJの混入防止）
--     ・キーワードを pgroonga（&@~ ＋ pgroonga_score）に置換
--       ★ pgroonga_score は「索引経由で全文検索した行」でしか値を返さないため、
--         キーワード候補とベクトル候補を別々に取ってから突き合わせる
--     ・両スコアを候補集合の最大値で 0〜1 に正規化してから重み付けする
--       ★ 旧実装は ts_rank の生値（0.06前後）に 0.35 を掛けており、配点が意図どおりでなかった
--     ・スコア閾値（p_threshold）を導入
--     ・属性フィルタ（p_member_attrs）と期限（expires_at）に対応
--     ・vec / kw の内訳を返す（ai_traces に採点根拠を残すため）
-- ============================================================
create or replace function public.knowledge_search_v2(
  p_persona_id   uuid,
  p_query        text,
  p_emb          text,
  p_member_attrs int[]   default null,   -- null = 属性判定なし（公開ボット）
  p_source_types text[]  default null,
  p_threshold    real    default 0.0,
  p_candidates   int     default 20,
  p_k            int     default 8
)
returns table (
  chunk_id      bigint,
  document_id   bigint,
  source_type   text,
  title         text,
  canonical_url text,
  chunk_text    text,
  vec_score     real,
  kw_score      real,
  score         real,
  -- B-12：stable / periodic / volatile。volatile を採用したら回答に鮮度注意を添える。
  freshness     text
)
language sql stable as $$
  with qe as (select nullif(p_emb, '')::vector as v),

  -- 対象範囲（権限・公開判定・persona分離・期限）
  scope as (
    select c.id as chunk_id, c.text, c.embedding, u.document_id,
           ks.source_type, ks.authority_weight, d.title, d.canonical_url,
           u.duplicate_group_key, d.published_at, u.freshness_class,
           c.tableoid as toid, c.ctid as tid
    from public.knowledge_chunks c
    join public.knowledge_units u      on u.id = c.unit_id
    join public.knowledge_documents d  on d.id = u.document_id
    join public.knowledge_sources ks   on ks.id = d.source_id
    where c.is_retrievable
      and u.retrieval_mode in ('answer_and_style','answer_only')
      and d.publication_status = 'published'
      and d.is_active
      and d.persona_id = p_persona_id
      and (d.expires_at is null or d.expires_at > now())
      and (p_source_types is null or ks.source_type = any(p_source_types))
      and (
        d.visibility = 'public'
        or (p_member_attrs is not null
            and d.visibility = 'member'
            and public.doc_visible_to(d.id, p_member_attrs))
      )
  ),

  -- キーワード候補（pgroonga 索引経由。ここでしかスコアが取れない）
  kw as (
    select s.chunk_id, pgroonga_score(s.toid, s.tid)::real as raw
    from scope s
    where s.text &@~ p_query
    order by raw desc
    limit p_candidates * 2
  ),
  -- ベクトル候補
  vec as (
    select s.chunk_id,
           (1 - (s.embedding <=> (select v from qe)))::real as raw
    from scope s
    where s.embedding is not null and (select v from qe) is not null
    order by s.embedding <=> (select v from qe)
    limit p_candidates * 2
  ),

  -- 正規化用の最大値（0除算を避ける）
  mx as (
    select greatest((select coalesce(max(raw), 0) from kw),  0.000001) as kw_max,
           greatest((select coalesce(max(raw), 0) from vec), 0.000001) as vec_max
  ),

  merged as (
    select s.*,
           (coalesce(v.raw, 0) / (select vec_max from mx))::real as vec_n,
           (coalesce(k.raw, 0) / (select kw_max  from mx))::real as kw_n
    from scope s
    left join vec v on v.chunk_id = s.chunk_id
    left join kw  k on k.chunk_id = s.chunk_id
    where v.chunk_id is not null or k.chunk_id is not null
  ),
  scored as (
    select *,
      ( vec_n * 0.50
      + kw_n  * 0.30
      + authority_weight * 0.15
      + (case when published_at is null then 0.5
              else greatest(0, 1 - (extract(epoch from (now() - published_at)) / (86400*365*2)))
         end)::real * 0.05
      )::real as score
    from merged
  ),
  ranked as (
    select *, row_number() over (
      partition by coalesce(duplicate_group_key, chunk_id::text)
      order by score desc) as rn
    from scored
  )
  select chunk_id, document_id, source_type, title, canonical_url, text,
         vec_n, kw_n, score, freshness_class
  from ranked
  where rn = 1 and score >= p_threshold
  order by score desc
  limit p_k;
$$;

-- ============================================================
-- ④-2 公開判定の突き合わせ用（/api/bot/knowledge/verify が使う）
--   会員1人ずつ RPC を投げると往復が多すぎるため、まとめて評価する。
--   p_members … [{"member_id":1,"attrs":[10,11]}, ...]（attrs は祖先展開済み）
--   返り値   … その会員が見てよい文書ID（visibility='member' の文書のみ）
--   ⚠️ 検証専用。回答生成では使わない。
-- ============================================================
create or replace function public.knowledge_visibility_matrix(p_members jsonb)
returns table (member_id int, document_id bigint)
language sql stable as $$
  select (m->>'member_id')::int as member_id, d.id as document_id
  from jsonb_array_elements(p_members) as m
  cross join public.knowledge_documents d
  where d.is_active
    and d.publication_status = 'published'
    and d.visibility = 'member'
    and public.doc_visible_to(
          d.id,
          (select coalesce(array_agg((x)::int), '{}'::int[])
             from jsonb_array_elements_text(m->'attrs') as x)
        );
$$;

-- ============================================================
-- ⑥ 索引の健康チェック（B-11）
--   ⚠️ HNSW索引は pgvector 非対応環境で「握り潰して」作成をスキップする実装になっている。
--      索引が無いと全走査になり、件数が増えた時点で急にレイテンシが悪化する。
--      しかも失敗しないので誰も気づかない。画面から見えるようにする。
--   ⚠️ 参照専用。運営（is_ops）から呼ぶ。
-- ============================================================
create or replace function public.ai_index_health()
returns table (name text, present boolean, valid boolean, note text)
language sql stable security definer set search_path = public as $$
  select v.name,
         (i.indexrelid is not null)                     as present,
         coalesce(i.indisvalid, false)                  as valid,
         v.note
  from (values
    ('kchunk_vec_idx',      'ベクトル検索（HNSW）。無いと全走査になる'),
    ('kchunk_pgroonga_idx', '日本語キーワード検索（pgroonga）。無いとキーワードスコアが常に0になる'),
    ('kchunk_retr_idx',     '検索対象チャンクの絞り込み')
  ) as v(name, note)
  left join pg_class c on c.relname = v.name and c.relkind = 'i'
  left join pg_index i on i.indexrelid = c.oid;
$$;
revoke all on function public.ai_index_health() from public;
grant execute on function public.ai_index_health() to authenticated;

-- ============================================================
-- ⑦ chunk の upsert を「埋め込みを保てる」形に差し替える（B-8）
--   ⚠️ 変更点は1か所だけ：p_emb が null のとき、既存の embedding を消さない。
--      取り込みで本文が変わっていない断片は埋め込みを取り直さない（有料なので）。
--      旧実装のまま null を渡すと embedding が消え、ベクトル検索から落ちる。
--   ※ create or replace。引数は変えていないので、そのまま置き換わる。
-- ============================================================
create or replace function public.knowledge_chunk_upsert(
  p_unit_id bigint,
  p_ordinal integer,
  p_heading text[],
  p_kind    text,
  p_text    text,
  p_start   integer,
  p_end     integer,
  p_tokens  integer,
  p_emb     text,
  p_model   text
)
returns bigint
language sql as $$
  insert into public.knowledge_chunks
    (unit_id, ordinal, heading_path, chunk_kind, text, start_char, end_char, token_count, embedding, embedding_model)
  values
    (p_unit_id, p_ordinal, coalesce(p_heading, '{}'), p_kind, p_text, p_start, p_end, p_tokens,
     nullif(p_emb, '')::vector, p_model)
  on conflict (unit_id, ordinal) do update set
    heading_path    = excluded.heading_path,
    chunk_kind      = excluded.chunk_kind,
    text            = excluded.text,
    start_char      = excluded.start_char,
    end_char        = excluded.end_char,
    token_count     = excluded.token_count,
    -- ★ 渡されなかったら既存を残す（B-8）
    embedding       = coalesce(excluded.embedding, public.knowledge_chunks.embedding),
    embedding_model = coalesce(excluded.embedding_model, public.knowledge_chunks.embedding_model),
    updated_at      = now()
  returning id;
$$;

-- ── ⑤ 検索評価の実行履歴 ──
create table if not exists public.knowledge_eval_runs (
  id         bigserial primary key,
  total      int not null default 0,
  passed     int not null default 0,
  results    jsonb not null default '[]'::jsonb,
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.knowledge_eval_runs enable row level security;
drop policy if exists "knowledge_eval_runs_ops" on public.knowledge_eval_runs;
create policy "knowledge_eval_runs_ops" on public.knowledge_eval_runs for select to authenticated
  using (public.is_ops());

-- ============================================================
-- ⚠️ 索引はロックを避けるため、下の1文を「単独で」実行すること
--    （SQL Editor で他の文と一緒に流さない。concurrently はトランザクション外が必要）
--
--    create index concurrently if not exists kchunk_pgroonga_idx
--      on public.knowledge_chunks using pgroonga (text);
--
--    実行後に無効な索引が残っていないか確認する：
--      select indexrelid::regclass, indisvalid from pg_index where not indisvalid;
--      → 0行なら正常
-- ============================================================
