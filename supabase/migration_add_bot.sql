-- ============================================================
-- 公開問い合わせボット（フェーズA：ブックマークのみ）
--   ・知識源は既存 public.chat_bookmarks（ai_enabled=true）だけ。chat_bookmarks は変更しない。
--   ・検索用の索引・入口別ポリシー・回数・体験版URL・監査ログを追加する。
--   ・埋め込みは OpenAI text-embedding-3-small（1536次元 / pgvector）。
--   ・回答生成は Claude（既存 lib/ai/claude.ts）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ※ 何度実行しても安全（if not exists / drop policy if exists / on conflict do nothing）
--   ⚠️ 本番適用・feature flag(BOT_PUBLIC_ENABLED) 有効化はオーナー承認後に行う。
-- ============================================================

-- pgvector（埋め込みの類似検索に使用）
create extension if not exists vector;

-- ── ① ブックマーク検索索引（chat_bookmarks から再生成する“索引”）──
--   ソース・オブ・トゥルースは chat_bookmarks。この表はいつでも再構築/drop 可能。
create table if not exists public.bot_bm_index (
  bookmark_id     bigint primary key references public.chat_bookmarks(id) on delete cascade,
  genre           text   not null default '',
  retrieval_text  text   not null default '',          -- 埋め込み・全文検索の対象（想定質問+キーワード+原文）
  answer_text     text   not null default '',          -- 回答文脈に渡す本文（formatted_reply など）
  search_tsv      tsvector generated always as (to_tsvector('simple', coalesce(retrieval_text,''))) stored,
  embedding       vector(1536),                        -- OpenAI text-embedding-3-small
  embedding_model text   default 'text-embedding-3-small',
  content_hash    text   not null default '',          -- retrieval_text の SHA-256（未変更なら再埋め込みしない）
  updated_at      timestamptz not null default now()
);
create index if not exists bot_bm_index_tsv_idx   on public.bot_bm_index using gin(search_tsv);
create index if not exists bot_bm_index_genre_idx  on public.bot_bm_index(genre);
-- ベクトル索引は HNSW 非対応の pgvector 環境でも止まらないよう、失敗時はスキップする。
do $$ begin
  begin
    create index if not exists bot_bm_index_vec_idx on public.bot_bm_index using hnsw (embedding vector_cosine_ops);
  exception when others then
    raise notice 'HNSW索引をスキップしました（pgvectorが未対応の可能性）: %', sqlerrm;
  end;
end $$;
comment on table public.bot_bm_index is '公開ボットのブックマーク検索索引。chat_bookmarks(ai_enabled=true) から再生成する。';

-- ── ② 入口別ポリシー（anon / member / trial）──
create table if not exists public.bot_policies (
  entry        text primary key check (entry in ('anon','member','trial')),
  daily_limit  int  not null default 3,                -- 1日の上限回数（trial は累計＝share_links.used_count で判定）
  scope_genres text[] not null default '{}',           -- 回答対象ジャンル（空＝全許可）
  web_search   text not null default 'off' check (web_search in ('off','assist','always')),
  max_tokens   int  not null default 700,              -- 1回答の生成上限
  enabled      boolean not null default true
);

-- ── ③ 回数カウント（端末/会員/体験版トークン × 日）──
create table if not exists public.bot_usage (
  id          bigserial primary key,
  entry       text not null,
  subject_key text not null,                            -- 端末ハッシュ / 会員ID / 体験版token
  day         date not null default (now() at time zone 'Asia/Tokyo')::date,
  count       int  not null default 0,
  updated_at  timestamptz not null default now(),
  unique (entry, subject_key, day)
);
create index if not exists bot_usage_lookup_idx on public.bot_usage(entry, subject_key, day);

-- ── ④ 体験版URL（固有token・期限・累計上限・失効）──
create table if not exists public.bot_share_links (
  token       text primary key,                         -- 推測困難なランダム
  label       text not null default '',
  expires_at  timestamptz,
  total_limit int  not null default 10,
  used_count  int  not null default 0,
  passcode    text,
  web_search  boolean not null default false,
  revoked     boolean not null default false,
  created_by  bigint references public.members(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists bot_share_links_active_idx on public.bot_share_links(revoked, expires_at);

-- ── ⑤ 監査ログ（出典追跡・コスト集計。顧客の個人情報は保存しない）──
create table if not exists public.bot_public_logs (
  id                   bigserial primary key,
  entry                text not null default '',
  subject_key          text not null default '',        -- 端末ハッシュ等（氏名等は保存しない）
  question             text not null default '',
  matched_bookmark_ids bigint[] not null default '{}',  -- 採用ブックマーク（出典追跡）
  used_web             boolean not null default false,
  tokens_in            int not null default 0,
  tokens_out           int not null default 0,
  latency_ms           int not null default 0,
  refused              boolean not null default false,   -- スコープ外辞退
  ok                   boolean not null default true,
  error                text,
  created_at           timestamptz not null default now()
);
create index if not exists bot_public_logs_created_idx on public.bot_public_logs(created_at desc);

-- ============================================================
-- ハイブリッド検索（キーワード + ベクトル）
--   service_role（/api/bot）から呼ぶ。ブックマーク索引のみを対象とする。
--   ※ 日本語の全文検索は 'simple' 構成のため補助的。主軸はベクトル類似。
-- ============================================================
--   ※ q_emb は PostgREST から確実に渡すため text で受け、内部で vector へキャストする。
create or replace function public.bot_hybrid_search(
  q      text,
  q_emb  text,
  cats   text[] default null,
  k      int    default 6
)
returns table (
  bookmark_id bigint,
  genre       text,
  answer_text text,
  score       real
)
language sql stable as $$
  with qe as (select nullif(q_emb, '')::vector as v),
  kw as (
    select bookmark_id,
           ts_rank(search_tsv, plainto_tsquery('simple', q)) as kw_score
    from public.bot_bm_index
    where (cats is null or genre = any(cats))
      and search_tsv @@ plainto_tsquery('simple', q)
    order by kw_score desc
    limit 40
  ),
  vec as (
    select bookmark_id,
           1 - (embedding <=> (select v from qe)) as vec_score
    from public.bot_bm_index
    where embedding is not null
      and (select v from qe) is not null
      and (cats is null or genre = any(cats))
    order by embedding <=> (select v from qe)
    limit 40
  ),
  merged as (
    select b.bookmark_id, b.genre, b.answer_text,
           ( coalesce(v.vec_score, 0) * 0.55
           + coalesce(kw.kw_score, 0) * 0.35
           + (case when cats is not null and b.genre = any(cats) then 0.10 else 0 end)
           )::real as score
    from public.bot_bm_index b
    left join vec v  on v.bookmark_id  = b.bookmark_id
    left join kw     on kw.bookmark_id = b.bookmark_id
    where v.bookmark_id is not null or kw.bookmark_id is not null
  )
  select bookmark_id, genre, answer_text, score
  from merged
  order by score desc
  limit k;
$$;

-- 索引の upsert（埋め込みは text で受けて vector へキャスト）。/api/bot/index から呼ぶ。
create or replace function public.bot_bm_upsert(
  p_id        bigint,
  p_genre     text,
  p_retrieval text,
  p_answer    text,
  p_emb       text,
  p_hash      text
)
returns void
language sql as $$
  insert into public.bot_bm_index
    (bookmark_id, genre, retrieval_text, answer_text, embedding, content_hash, updated_at)
  values
    (p_id, p_genre, p_retrieval, p_answer, nullif(p_emb, '')::vector, p_hash, now())
  on conflict (bookmark_id) do update set
    genre          = excluded.genre,
    retrieval_text = excluded.retrieval_text,
    answer_text    = excluded.answer_text,
    embedding      = excluded.embedding,
    content_hash   = excluded.content_hash,
    updated_at     = now();
$$;

-- ============================================================
-- RLS
--   ・bot_bm_index / bot_policies / bot_share_links … 運営(is_ops)のみ全操作。
--   ・bot_usage / bot_public_logs … 書込は service_role のみ、read は管理者。
--   ・公開ボット /api/bot は service_role で bot_bm_index と chat_bookmarks を読む（匿名OK）。
-- ============================================================
alter table public.bot_bm_index     enable row level security;
alter table public.bot_policies     enable row level security;
alter table public.bot_share_links  enable row level security;
alter table public.bot_usage        enable row level security;
alter table public.bot_public_logs  enable row level security;

drop policy if exists "bot_bm_index_ops" on public.bot_bm_index;
create policy "bot_bm_index_ops" on public.bot_bm_index for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "bot_policies_ops" on public.bot_policies;
create policy "bot_policies_ops" on public.bot_policies for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "bot_share_links_ops" on public.bot_share_links;
create policy "bot_share_links_ops" on public.bot_share_links for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

-- usage / logs は運営が閲覧のみ（書込は service_role がRLSをバイパス）
drop policy if exists "bot_usage_ops_read" on public.bot_usage;
create policy "bot_usage_ops_read" on public.bot_usage for select to authenticated
  using (public.is_ops());

drop policy if exists "bot_public_logs_admin_read" on public.bot_public_logs;
create policy "bot_public_logs_admin_read" on public.bot_public_logs for select to authenticated
  using (public.current_member_role() = '管理者');

-- ============================================================
-- 初期シード
-- ============================================================
-- 入口別ポリシー（既定値。設定画面で変更可）
insert into public.bot_policies (entry, daily_limit, scope_genres, web_search, max_tokens, enabled) values
  ('anon',   3,  '{}', 'off',    700, true),
  ('member', 50, '{}', 'assist', 700, true),
  ('trial',  10, '{}', 'off',    700, true)
on conflict (entry) do nothing;

-- ロール権限（設定 → 権限タブに表示）
--   bot         … サイドバーに「ボット」メニューを表示
--   bot_manage  … ボット設定・ナレッジ管理（索引再構築・体験版URL）
--   ※ 公開チャット自体はロール不問（未ログインで利用可）
insert into public.role_permissions (role, feature, enabled) values
  ('管理者',       'bot',        true),
  ('オペレーター', 'bot',        true),
  ('メンバー',     'bot',        true),
  ('外部',         'bot',        false),
  ('管理者',       'bot_manage', true),
  ('オペレーター', 'bot_manage', true),
  ('メンバー',     'bot_manage', false),
  ('外部',         'bot_manage', false)
on conflict (role, feature) do nothing;
