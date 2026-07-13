-- ============================================================
-- AI機能（5機能）用マイグレーション
--   ① メンバー AI相談チャット      : ai_conversations / ai_messages
--   ② オペ 返信提案                : ai_knowledge
--   ③ オペ メッセージ添削          : app_settings.ai_style_guide
--   ④ HTMLコード生成               : contents.ai_assisted
--   ⑤ 配信原稿生成                 : broadcasts.ai_assisted
--   共通                           : ai_logs（監査・レート制限）
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ※ 何度実行しても安全（if not exists / drop policy if exists）
-- ============================================================

-- ── ① メンバーのAI相談スレッド ──────────────────────────────
create table if not exists public.ai_conversations (
  id          bigserial primary key,
  member_id   int not null references public.members(id) on delete cascade,
  title       text default '',
  -- 事務局へ引き継いだ場合の chat_conversations.id
  escalated_conversation_id bigint references public.chat_conversations(id) on delete set null,
  created_at  timestamptz default now()
);

create table if not exists public.ai_messages (
  id                 bigserial primary key,
  ai_conversation_id bigint not null references public.ai_conversations(id) on delete cascade,
  role               text not null check (role in ('user','assistant')),
  body               text not null default '',
  -- 参照した資料 [{kind:'content'|'news', id, title}]
  citations          jsonb default '[]'::jsonb,
  escalate           boolean default false,
  created_at         timestamptz default now()
);

create index if not exists idx_ai_conv_member on public.ai_conversations(member_id, created_at desc);
create index if not exists idx_ai_msg_conv    on public.ai_messages(ai_conversation_id, created_at);

-- ── ② 社内ナレッジ（返信提案の参照元）───────────────────────
create table if not exists public.ai_knowledge (
  id         bigserial primary key,
  title      text not null default '',
  body       text not null default '',
  tags       text[] default '{}',
  published  boolean not null default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

-- ── 共通：監査ログ（レート制限の判定にも使う）───────────────
create table if not exists public.ai_logs (
  id         bigserial primary key,
  -- member_consult / reply_suggest / review / html_generate / broadcast_draft / summarize / adopt
  feature    text not null,
  member_id  int references public.members(id) on delete set null,
  model      text not null default '',
  tokens_in  int default 0,
  tokens_out int default 0,
  latency_ms int default 0,
  ok         boolean not null default true,
  error      text,
  created_at timestamptz default now()
);
create index if not exists idx_ai_logs_member on public.ai_logs(member_id, created_at desc);
create index if not exists idx_ai_logs_feature on public.ai_logs(feature, created_at desc);

-- ── ③ 文体ガイド（添削の基準・設定画面で編集）───────────────
alter table public.app_settings add column if not exists ai_style_guide text default '';

-- ── ④⑤ AI生成を含むかの追跡フラグ ───────────────────────────
alter table public.contents   add column if not exists ai_assisted boolean default false;
alter table public.broadcasts add column if not exists ai_assisted boolean default false;

-- ============================================================
-- RLS
--   書き込みはすべて service_role（API Route）経由。
--   クライアントからの直接書込は許可しない（select のみ）。
-- ============================================================
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_knowledge     enable row level security;
alter table public.ai_logs          enable row level security;

-- 自分のAI相談スレッドのみ閲覧可（スタッフも他人の相談は見ない）
drop policy if exists "ai_conv_own" on public.ai_conversations;
create policy "ai_conv_own" on public.ai_conversations for select to authenticated
  using (member_id = public.current_member_id());

drop policy if exists "ai_msg_own" on public.ai_messages;
create policy "ai_msg_own" on public.ai_messages for select to authenticated
  using (ai_conversation_id in (
    select id from public.ai_conversations where member_id = public.current_member_id()
  ));

-- ナレッジ：スタッフのみ全操作（設定画面で管理）
drop policy if exists "ai_knowledge_ops" on public.ai_knowledge;
create policy "ai_knowledge_ops" on public.ai_knowledge for all to authenticated
  using (public.current_member_role() in ('管理者','オペレーター'))
  with check (public.current_member_role() in ('管理者','オペレーター'));

-- ログ：管理者のみ閲覧（書込は service_role のみ）
drop policy if exists "ai_logs_admin" on public.ai_logs;
create policy "ai_logs_admin" on public.ai_logs for select to authenticated
  using (public.current_member_role() = '管理者');

-- ============================================================
-- ロール権限（設定 → 権限タブに表示される）
--   ai         … ② 返信提案 / ③ 添削（既存キーを継続利用）
--   ai_consult … ① メンバー向けAI相談
--   ai_html    … ④ HTMLコード生成
--   ai_draft   … ⑤ 配信原稿生成
--   ※ 管理者は canFor() 側で常時ON扱いのため行を入れなくても通る
-- ============================================================
insert into public.role_permissions (role, feature, enabled) values
  ('管理者',       'ai_consult', true),
  ('オペレーター', 'ai_consult', false),
  ('メンバー',     'ai_consult', true),
  ('外部',         'ai_consult', false),
  ('管理者',       'ai_html',    true),
  ('オペレーター', 'ai_html',    false),
  ('メンバー',     'ai_html',    false),
  ('外部',         'ai_html',    false),
  ('管理者',       'ai_draft',   true),
  ('オペレーター', 'ai_draft',   true),
  ('メンバー',     'ai_draft',   false),
  ('外部',         'ai_draft',   false)
on conflict (role, feature) do nothing;

-- ── ナレッジの初期サンプル（不要なら削除可）─────────────────
insert into public.ai_knowledge (title, body, tags, published, sort_order)
select '請求書の再発行フロー',
       E'宛名や金額の誤りが判明した場合：\n1. 経理へ再発行を依頼（即日〜翌営業日）\n2. 顧客へは「本日中に発送」ではなく「本日中に手配し、通常は翌営業日にお届け」と案内する\n3. 旧請求書は破棄いただくよう一言添える',
       array['請求','経理'], true, 0
where not exists (select 1 from public.ai_knowledge);

insert into public.ai_knowledge (title, body, tags, published, sort_order)
select '事務局の文体ガイド',
       E'・一人称は「事務局」\n・「了解しました」ではなく「承知いたしました」\n・絵文字は1通につき1個まで\n・確約できない事項（配送日・在庫・金額）は断定しない',
       array['文体'], true, 1
where not exists (select 1 from public.ai_knowledge where title = '事務局の文体ガイド');
