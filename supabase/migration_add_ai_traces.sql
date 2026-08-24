-- ============================================================
-- AI回答トレース ＆ 利用量カウンタ（R1 / Ph0）
--   ① ai_traces        … LLMへ送った最終プロンプト全文・回答・根拠・コストを1行で保存
--   ② ai_model_prices  … コスト換算の単価（画面から更新する。コードに単価を書かない）
--   ③ ai_feedback      … 回答への評価（画面はPh1以降。器だけ先に作る）
--   ④ ai_usage         … レート制限のカウンタ（ai_logs の count(*) 判定から分離）
--   ⑤ ai_usage_minute  … 1分あたりの判定用（全機能合算）
--   ⑥ bot_public_logs へ列追加（回答本文・出典・trace_id・信頼度）
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ※ 何度実行しても安全（if not exists / drop policy if exists / on conflict do nothing）
--   ⚠️ 追加のみ。既存テーブルの列の意味は変えない。
--   ⚠️ ai_traces は顧客の個人情報を含む。管理者のみ閲覧・既定90日で物理削除。
--      preview/ 配下へこのデータを出力してはならない。
-- ============================================================

-- ── ① 回答トレース ──────────────────────────────────────────
create table if not exists public.ai_traces (
  id              bigserial primary key,

  -- 識別
  feature         text   not null,                     -- ai_logs.feature と同じキー
  member_id       int    references public.members(id) on delete set null,
  subject_key     text   not null default '',          -- 公開ボットの端末ハッシュ等
  entry           text   not null default '',          -- anon / member / trial（ボットのみ）
  session_id      bigint,                              -- Ph4 の bot_sessions.id 用（Ph0では null）
  request_id      text   not null default '',          -- 1リクエスト内の複数呼び出しを束ねる

  -- 入力
  user_input      text   not null default '',
  rewritten_query text,                                -- Ph4 の Query Rewrite 用（Ph0では null）
  system_prompt   text   not null default '',          -- LLMへ送った system 全文
  messages_json   jsonb  not null default '[]'::jsonb, -- LLMへ送った messages 全文
  prompt_version  text   not null default '',          -- 例 "member_consult@2026-08-11T09:12:00Z"

  -- 検索
  retrieval_json  jsonb  not null default '[]'::jsonb, -- [{src,id,title,vec,kw,score,used}]
  used_sources    jsonb  not null default '[]'::jsonb,
  confidence      real,                                -- Ph2で導入（Ph0では null）

  -- 出力
  answer          text   not null default '',
  refused         boolean not null default false,
  needs_human     boolean not null default false,

  -- 実行
  model           text   not null default '',
  temperature     real,
  max_tokens      int,
  tokens_in       int    not null default 0,
  tokens_out      int    not null default 0,
  cost_jpy        numeric(10,4) not null default 0,
  latency_ms      int    not null default 0,           -- LLM呼び出し区間
  total_ms        int    not null default 0,           -- 検索・文脈構築を含む全体
  retry_count     int    not null default 0,
  ok              boolean not null default true,
  error           text,

  created_at      timestamptz not null default now()
);

create index if not exists ai_traces_created_idx on public.ai_traces(created_at desc);
create index if not exists ai_traces_feature_idx on public.ai_traces(feature, created_at desc);
create index if not exists ai_traces_member_idx  on public.ai_traces(member_id, created_at desc);
create index if not exists ai_traces_request_idx on public.ai_traces(request_id);
create index if not exists ai_traces_bad_idx     on public.ai_traces(created_at desc)
  where refused = true or ok = false;

comment on table public.ai_traces is
  'AI回答の完全トレース。個人情報を含むため管理者のみ閲覧。既定90日で物理削除（/api/cron/ai-purge）。';

-- ── ② モデル単価 ────────────────────────────────────────────
create table if not exists public.ai_model_prices (
  model             text primary key,
  input_jpy_per_1k  numeric(10,4) not null default 0,
  output_jpy_per_1k numeric(10,4) not null default 0,
  note              text not null default '',
  updated_at        timestamptz not null default now()
);
comment on table public.ai_model_prices is
  'コスト換算の単価。0 のあいだは画面に金額を出さない（誤った数字を出さないため）。';

-- 行だけ用意する（単価は運用者が画面から設定する。コードに単価を書かない）
insert into public.ai_model_prices (model, input_jpy_per_1k, output_jpy_per_1k, note) values
  ('claude-sonnet-4-5',      0, 0, '要設定：料金表と為替から算出する'),
  ('claude-3-5-haiku-latest',0, 0, '要設定'),
  ('text-embedding-3-small', 0, 0, '要設定：埋め込みは input のみ')
on conflict (model) do nothing;

-- ── ③ 回答へのフィードバック ────────────────────────────────
create table if not exists public.ai_feedback (
  id         bigserial primary key,
  trace_id   bigint not null references public.ai_traces(id) on delete cascade,
  rating     smallint not null check (rating in (-1, 1)),   -- -1 悪い / 1 良い
  reason     text not null default '',
  member_id  int references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_feedback_trace_idx on public.ai_feedback(trace_id);
-- 1つの回答につき評価は1件（押し直しは上書き）。連打でログが膨らむのを防ぐ。
create unique index if not exists ai_feedback_trace_uq on public.ai_feedback(trace_id);

-- ── ④ レート制限カウンタ（日次・機能別）────────────────────
create table if not exists public.ai_usage (
  id         bigserial primary key,
  member_id  int not null references public.members(id) on delete cascade,
  feature    text not null,
  day        date not null default (now() at time zone 'Asia/Tokyo')::date,
  count      int  not null default 0,
  updated_at timestamptz not null default now(),
  unique (member_id, feature, day)
);
create index if not exists ai_usage_lookup_idx on public.ai_usage(member_id, feature, day);

-- ── ⑤ レート制限カウンタ（分次・全機能合算）────────────────
create table if not exists public.ai_usage_minute (
  member_id int not null references public.members(id) on delete cascade,
  minute_at timestamptz not null,                      -- 分単位に丸めた時刻
  count     int not null default 0,
  primary key (member_id, minute_at)
);
create index if not exists ai_usage_minute_idx on public.ai_usage_minute(minute_at);

-- ── カウンタの加算（1クエリで upsert して加算後の値を返す）──
create or replace function public.ai_usage_bump(p_member_id int, p_feature text)
returns int
language sql as $$
  insert into public.ai_usage (member_id, feature, day, count, updated_at)
  values (p_member_id, p_feature, (now() at time zone 'Asia/Tokyo')::date, 1, now())
  on conflict (member_id, feature, day) do update
    set count = public.ai_usage.count + 1, updated_at = now()
  returning count;
$$;

create or replace function public.ai_usage_minute_bump(p_member_id int)
returns int
language sql as $$
  insert into public.ai_usage_minute (member_id, minute_at, count)
  values (p_member_id, date_trunc('minute', now()), 1)
  on conflict (member_id, minute_at) do update
    set count = public.ai_usage_minute.count + 1
  returning count;
$$;

-- ── 利用状況の集計（機能別。管理画面から呼ぶ）──────────────
create or replace function public.ai_usage_summary(p_days int default 30)
returns table (
  feature    text,
  calls      bigint,
  tokens_in  bigint,
  tokens_out bigint,
  cost_jpy   numeric,
  avg_ms     numeric,
  p95_ms     numeric,
  errors     bigint,
  refused    bigint
)
language sql stable as $$
  select t.feature,
         count(*)::bigint                                                     as calls,
         coalesce(sum(t.tokens_in), 0)::bigint                                as tokens_in,
         coalesce(sum(t.tokens_out), 0)::bigint                               as tokens_out,
         coalesce(sum(t.cost_jpy), 0)::numeric                                as cost_jpy,
         round(coalesce(avg(t.latency_ms), 0))::numeric                       as avg_ms,
         coalesce(percentile_cont(0.95) within group (order by t.latency_ms), 0)::numeric as p95_ms,
         count(*) filter (where not t.ok)::bigint                             as errors,
         count(*) filter (where t.refused)::bigint                            as refused
  from public.ai_traces t
  where t.created_at >= now() - make_interval(days => p_days)
  group by t.feature
  order by count(*) desc;
$$;

-- ── ⑥ 公開ボットの監査ログを拡張 ────────────────────────────
alter table public.bot_public_logs add column if not exists answer     text not null default '';
alter table public.bot_public_logs add column if not exists sources    jsonb not null default '[]'::jsonb;
alter table public.bot_public_logs add column if not exists trace_id   bigint references public.ai_traces(id) on delete set null;
alter table public.bot_public_logs add column if not exists confidence real;
-- 既存の matched_bookmark_ids は残す（フェーズA運用中の互換のため）。
-- 新規書き込みでは sources（type/id/score）を正とする。
-- tokens_in / tokens_out / latency_ms は書き込まない（ai_traces を正とし、二重管理にしない）。

-- ============================================================
-- RLS
--   書込はすべて service_role（API Route）経由。クライアントからの直接書込は許可しない。
-- ============================================================
alter table public.ai_traces        enable row level security;
alter table public.ai_model_prices  enable row level security;
alter table public.ai_feedback      enable row level security;
alter table public.ai_usage         enable row level security;
alter table public.ai_usage_minute  enable row level security;

drop policy if exists "ai_traces_admin_read" on public.ai_traces;
create policy "ai_traces_admin_read" on public.ai_traces for select to authenticated
  using (public.current_member_role() = '管理者');

drop policy if exists "ai_model_prices_admin" on public.ai_model_prices;
create policy "ai_model_prices_admin" on public.ai_model_prices for all to authenticated
  using (public.current_member_role() = '管理者')
  with check (public.current_member_role() = '管理者');

drop policy if exists "ai_feedback_admin_read" on public.ai_feedback;
create policy "ai_feedback_admin_read" on public.ai_feedback for select to authenticated
  using (public.current_member_role() = '管理者');

drop policy if exists "ai_usage_ops_read" on public.ai_usage;
create policy "ai_usage_ops_read" on public.ai_usage for select to authenticated
  using (public.is_ops());

drop policy if exists "ai_usage_minute_ops_read" on public.ai_usage_minute;
create policy "ai_usage_minute_ops_read" on public.ai_usage_minute for select to authenticated
  using (public.is_ops());

-- ============================================================
-- ロール権限（設定 → 権限タブに表示される）
--   ai_trace … 回答トレース／利用状況の閲覧
-- ============================================================
insert into public.role_permissions (role, feature, enabled) values
  ('管理者',       'ai_trace', true),
  ('オペレーター', 'ai_trace', false),
  ('メンバー',     'ai_trace', false),
  ('外部',         'ai_trace', false)
on conflict (role, feature) do nothing;
