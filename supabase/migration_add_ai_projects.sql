-- ============================================================
-- プロジェクト設定（Ph3 / R5-③）
--   AI の設定（モデル・検索・制限・PII など）をコードと環境変数から DB へ移す。
--   これにより、設定変更にデプロイが不要になり、複数PJへ横展開できる。
--
--   ★ 初期投入は「いまの値」をそのまま入れる。適用しても挙動は変わらない。
--   ⚠️ APIキー（ANTHROPIC_API_KEY / OPENAI_API_KEY）は絶対にここへ置かない。
--      環境変数のまま。DBに入れると閲覧権限の話になり、事故の面が一気に広がる。
--
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（if not exists / on conflict do nothing）
-- ============================================================

create table if not exists public.ai_projects (
  id           bigserial primary key,
  slug         text unique not null,
  display_name text not null default '',
  persona_id   uuid references public.ai_personas(id),
  is_active    boolean not null default true,
  is_deleted   boolean not null default false,
  created_at   timestamptz not null default now()
);

create table if not exists public.ai_project_configs (
  project_id bigint not null references public.ai_projects(id) on delete cascade,
  key        text not null,
  value_json jsonb not null default '{}'::jsonb,
  updated_by int references public.members(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);

-- 変更履歴。設定を戻したいときの拠り所にする（誰がいつ何にしたか）。
create table if not exists public.ai_project_config_revisions (
  id         bigserial primary key,
  project_id bigint not null,
  key        text not null,
  value_json jsonb not null,
  edited_by  int references public.members(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists ai_pcr_idx
  on public.ai_project_config_revisions(project_id, key, created_at desc);

-- ── RLS：管理者のみ ──
alter table public.ai_projects                enable row level security;
alter table public.ai_project_configs         enable row level security;
alter table public.ai_project_config_revisions enable row level security;

drop policy if exists "ai_projects_admin" on public.ai_projects;
create policy "ai_projects_admin" on public.ai_projects for all to authenticated
  using (public.current_member_role() = '管理者')
  with check (public.current_member_role() = '管理者');

drop policy if exists "ai_project_configs_admin" on public.ai_project_configs;
create policy "ai_project_configs_admin" on public.ai_project_configs for all to authenticated
  using (public.current_member_role() = '管理者')
  with check (public.current_member_role() = '管理者');

drop policy if exists "ai_pcr_admin" on public.ai_project_config_revisions;
create policy "ai_pcr_admin" on public.ai_project_config_revisions for select to authenticated
  using (public.current_member_role() = '管理者');

-- ── プロジェクト行 ──
insert into public.ai_projects (slug, display_name, persona_id)
select 'kawai-camp', 'KAWAI CAMP', p.id
from public.ai_personas p where p.slug = 'kawai'
on conflict (slug) do nothing;

-- persona が後から作られた場合に備えて紐づけ直す（null のときだけ）
update public.ai_projects a
set persona_id = p.id
from public.ai_personas p
where a.slug = 'kawai-camp' and a.persona_id is null and p.slug = 'kawai';

-- ============================================================
-- 初期値（★ いまの値をそのまま入れる。挙動を変えないこと）
--   ・null を入れた項目は「未設定」＝環境変数／コード既定へフォールバックする。
--   ・threshold は R6 で実データを見て決めるまで 0（＝閾値なし）のまま。
--     設計書の 0.35 は暫定値であり、未検証のまま入れない。
-- ============================================================
insert into public.ai_project_configs (project_id, key, value_json)
select a.id, v.key, v.val::jsonb
from public.ai_projects a,
  (values
    ('model',     '{"default":null,"light":null,"embed":null}'),
    ('retrieval', '{"top_k":8,"candidates":20,"threshold":0,"weights":{"vec":0.50,"kw":0.30,"authority":0.15,"fresh":0.05}}'),
    ('memory',    '{"turns":8,"summarize_after":16,"retention_days":30,"transcript_limit":null}'),
    ('output',    '{"max_chars":300,"language":"ja","show_sources":true,"show_confidence":true}'),
    ('limits',    '{"per_min":null,"per_day":{}}'),
    ('pii',       '{"mask":["email","tel"],"keep":["name"]}'),
    ('rules',     '{"fail_mode":"closed","human_gate":[],"do_not_claim":[]}'),
    ('persona',   '{}')
  ) as v(key, val)
where a.slug = 'kawai-camp'
on conflict (project_id, key) do nothing;

comment on table public.ai_project_configs is
  'AIの設定。null は「未設定」＝環境変数／コード既定へフォールバックする。APIキーは置かない。';
