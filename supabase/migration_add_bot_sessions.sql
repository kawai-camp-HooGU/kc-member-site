-- ============================================================
-- 公開ボットの会話履歴（S-5）
--
--   ★ なぜ要るか
--     画面には履歴が見えているのに、AIは1問ごとに忘れていた。
--     利用者から見て「壊れている」ように映る、最も分かりやすい欠陥（現行調査 S-5）。
--
--   ⚠️ セッションの鍵は subject_key ではなく token（下の設計判断を読むこと）
--     設計書は「subject_key をセッションキーに流用」としていたが、それは使えない。
--     subject_key は anon で sha256(IP|UA) のため、
--     同じ社内NAT・同じブラウザの別人が同一キーになりうる。
--     それを会話の鍵にすると、他人の会話の続きをAIが読むことになる。
--     そこで、推測できないランダムな token を発行し、それを鍵にする。
--     subject_key は「誰の分だったか」を後から追うためだけに持つ（回数制限は従来どおり）。
--
--   ⚠️ 会話本文は個人情報を含みうる。運営のみ閲覧。ai-purge で古い行を消す。
--   ⚠️ 追加のみ。既存テーブルには触れない。
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（if not exists / drop policy if exists）
-- ============================================================

create table if not exists public.bot_sessions (
  id          bigserial primary key,
  -- ★ 会話の鍵。クライアントが保持して毎回送り返す。推測できない値にする。
  token       text not null unique,
  -- どのプロジェクトの会話か（ai_projects 未適用でも動くよう FK は後段で任意に付ける）
  project_id  bigint,
  entry       text not null default '',      -- anon / member / trial
  subject_key text not null default '',      -- 端末ハッシュ / m:{id} / t:{token}。追跡用
  member_id   int references public.members(id) on delete set null,
  -- ★Ph4：古いターンの要約。現時点では書き込まない（窓だけで足りる）
  summary     text not null default '',
  turn_count  int  not null default 0,
  last_at     timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
create index if not exists bot_sessions_subject_idx on public.bot_sessions(subject_key, last_at desc);
create index if not exists bot_sessions_last_idx    on public.bot_sessions(last_at);

create table if not exists public.bot_messages (
  id         bigserial primary key,
  session_id bigint not null references public.bot_sessions(id) on delete cascade,
  role       text   not null check (role in ('user', 'assistant')),
  body       text   not null default '',
  sources    jsonb  not null default '[]'::jsonb,
  trace_id   bigint,                          -- ai_traces.id。FK は後段で任意に付ける
  created_at timestamptz not null default now()
);
create index if not exists bot_messages_session_idx on public.bot_messages(session_id, created_at);

-- ── 他のマイグレーションが適用済みなら FK を張る（順序に依存させないため）──
--   ai_projects … migration_add_ai_projects.sql
--   ai_traces   … migration_add_ai_traces.sql
do $$ begin
  if to_regclass('public.ai_projects') is not null then
    begin
      alter table public.bot_sessions
        add constraint bot_sessions_project_fk
        foreign key (project_id) references public.ai_projects(id) on delete cascade;
    exception when duplicate_object then null;
    end;
  end if;

  if to_regclass('public.ai_traces') is not null then
    begin
      alter table public.bot_messages
        add constraint bot_messages_trace_fk
        foreign key (trace_id) references public.ai_traces(id) on delete set null;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

comment on column public.bot_sessions.token is
  '会話の鍵。クライアントが保持して送り返す。subject_key を鍵にすると同一NATの別人が混ざるため。';
comment on column public.bot_sessions.summary is
  'Ph4：古いターンの要約。現時点では未使用（直近N往復の窓だけで運用する）。';

-- ── RLS：運営のみ閲覧。書き込みは service_role（API）が行う ──
alter table public.bot_sessions enable row level security;
alter table public.bot_messages enable row level security;

drop policy if exists "bot_sessions_ops" on public.bot_sessions;
create policy "bot_sessions_ops" on public.bot_sessions for select to authenticated
  using (public.is_ops());

drop policy if exists "bot_messages_ops" on public.bot_messages;
create policy "bot_messages_ops" on public.bot_messages for select to authenticated
  using (public.is_ops());
