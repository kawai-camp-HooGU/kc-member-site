-- ============================================================
-- ②返信提案の相談セッションをサーバー保存する（A-3）
--
--   ★ なぜ要るか
--     いまは相談チャットの履歴をクライアントが保持し、リクエストごとに丸ごと送っている。
--     ・develop.md の「クライアントから受け取った本文をそのままプロンプトに入れない」に反する
--     ・改ざん・プロンプト注入の入口になる（オペレーターの端末を経由すれば何でも差し込める）
--     ・サーバーに残らないので、後から「何を相談したか」を追えない
--     セッションをサーバーに置き、クライアントは何も送らない形にする。
--
--   ⚠️ 顧客に関する記述を含みうる。運営のみ閲覧。ai-purge で古い行を消す。
--   ⚠️ 追加のみ。既存テーブルには触れない。
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（if not exists / drop policy if exists）
-- ============================================================

create table if not exists public.ai_consult_sessions (
  id         bigserial primary key,
  -- 相談しているオペレーター。セッションは「担当者ごと」に分ける
  staff_id   int  not null references public.members(id) on delete cascade,
  -- どの相手についての相談か
  kind       text not null check (kind in ('chat', 'line')),
  -- kind='chat' … chat_conversations.id ／ kind='line' … line_friends.id
  subject_id bigint not null,
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now(),
  -- 担当者×相手 で1セッション。切り替えて戻っても続きから話せる
  unique (staff_id, kind, subject_id)
);

create table if not exists public.ai_consult_turns (
  id         bigserial primary key,
  session_id bigint not null references public.ai_consult_sessions(id) on delete cascade,
  role       text   not null check (role in ('user', 'assistant')),
  body       text   not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ai_consult_turns_idx
  on public.ai_consult_turns(session_id, created_at);
create index if not exists ai_consult_sessions_last_idx
  on public.ai_consult_sessions(last_at);

comment on table public.ai_consult_sessions is
  '②返信提案の相談セッション（A-3）。クライアントは履歴を送らず、サーバーがここから組み立てる。';
comment on column public.ai_consult_turns.body is
  'オペレーターの相談文と、AIの説明（talk）だけを残す。返信案カードの本文は残さない。';

-- ── RLS：運営のみ ──
--   書き込みは service_role（API）が行うため、ここでは select だけ開ける。
alter table public.ai_consult_sessions enable row level security;
alter table public.ai_consult_turns    enable row level security;

drop policy if exists "ai_consult_sessions_ops" on public.ai_consult_sessions;
create policy "ai_consult_sessions_ops" on public.ai_consult_sessions for select to authenticated
  using (public.is_ops());

drop policy if exists "ai_consult_turns_ops" on public.ai_consult_turns;
create policy "ai_consult_turns_ops" on public.ai_consult_turns for select to authenticated
  using (public.is_ops());
