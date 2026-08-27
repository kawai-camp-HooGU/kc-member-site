-- ============================================================
-- CsWork：運用ループ化（REQ-039）
--
--   REQ-028 の cswork_docs / cswork_audit / Storage(cswork) を土台に、
--   「起草 → 整形 → 承認 → 指示ファイル → 定刻実行 → 成果 → 判断」を
--   一周させるための受け皿を足す。
--
--   ・cswork_docs    … kind を拡張（source / spec / settings / runbook）＋版と親子の列
--   ・cswork_runs    … 定刻実行1回＝1行。成果はDriveに置き、ここは索引だけ持つ
--   ・cswork_actions … 次アクション提案と、人の採否
--   ・cswork_issues  … 課題。run が自動起票し、人がクローズする（ループの接合部）
--   ・role_permissions … 画面キー cswork_edit（起草と整形・実行＝管理者のみ）
--
--   ⚠️ 既存レコード（ops / design / watchlist）は一切壊さない。
--      現行6タブは並走期間（確定6：1週間）そのまま動く必要がある。
--   ⚠️ 成果の本文は当面 Googleドライブが正本（確定3・4）。ここが持つのは
--      メタ情報・Driveへのリンク・人が何を採否したかだけ。
--   ⚠️ 参照はサーバー側（service_role）経由。RLS は「運営ロールのみ select」を
--      最小限で張り、書き込みポリシーは作らない（REQ-028 と同じ方針）。
--   ⚠️ このファイルは冪等（再実行しても壊れない）。
-- ============================================================

-- ── 1) cswork_docs の拡張 ────────────────────────────────
--   kind の許容値を増やす。既存3種はそのまま残す（DROP してから足す）。
alter table public.cswork_docs drop constraint if exists cswork_docs_kind_check;
alter table public.cswork_docs add constraint cswork_docs_kind_check
  check (kind in ('ops','design','watchlist','source','spec','settings','runbook'));

--   doc_version … 承認1回で A(source)/B(spec)/C(settings)/D(runbook) を束ねる版
--   parent_id   … source → spec → runbook の親子（どの原本から生まれたか）
--   runner      … runbook のときだけ入る（agent-browser / portal-cron / human）
alter table public.cswork_docs add column if not exists doc_version text;
alter table public.cswork_docs add column if not exists parent_id   uuid references public.cswork_docs(id) on delete set null;
alter table public.cswork_docs add column if not exists runner      text;
alter table public.cswork_docs add column if not exists approved_by int references public.members(id) on delete set null;
alter table public.cswork_docs add column if not exists approved_at timestamptz;

alter table public.cswork_docs drop constraint if exists cswork_docs_runner_check;
alter table public.cswork_docs add constraint cswork_docs_runner_check
  check (runner is null or runner in ('agent-browser','portal-cron','human'));

--   runbook は runner ごとに現行版を1本持つ。既存の uq_cswork_docs_current は
--   (project, kind) where is_current なので、runbook が runner 別に持てない。
--   runner を含む部分ユニークへ差し替える。
drop index if exists public.uq_cswork_docs_current;
create unique index if not exists uq_cswork_docs_current
  on public.cswork_docs (project, kind, coalesce(runner, '')) where is_current;

create index if not exists idx_cswork_docs_version
  on public.cswork_docs (project, doc_version, kind);

-- ── 2) 実行（run）────────────────────────────────────────
--   ⚠️ 主キーを uuid にするのは cswork_docs に合わせるためと、エージェント側が
--      投入前に run_id を採番できるようにするため（二重投入の冪等判定に使う）。
create table if not exists public.cswork_runs (
  id              uuid primary key,
  project         text not null default 'kawai-camp',
  runbook_doc_id  uuid references public.cswork_docs(id) on delete set null,
  doc_version     text,
  runner          text not null default 'agent-browser',
  scheduled_at    timestamptz,
  started_at      timestamptz,
  finished_at     timestamptz,
  status          text not null default 'partial'
                  check (status in ('success','partial','failed','skipped')),
  -- 件数集計。取得できなかった項目は数値を入れず error を持たせる（0で埋めない）
  counts          jsonb not null default '{}'::jsonb,
  -- タスクごとの success / failed / skipped と理由コード
  steps           jsonb not null default '[]'::jsonb,
  -- 報告・スナップショット・要監視顧客一覧（Driveへのリンク。本文は持たない）
  artifacts       jsonb not null default '[]'::jsonb,
  -- Chatwork 通知の本文と送信フラグ（当面 sent は常に false。確定4）
  notify          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_cswork_runs_recent
  on public.cswork_runs (project, started_at desc);

-- ── 3) 次アクション提案 ──────────────────────────────────
--   run が提案し、人が採否する。却下理由は次回の提案精度の材料になる。
create table if not exists public.cswork_actions (
  id             bigserial primary key,
  run_id         uuid not null references public.cswork_runs(id) on delete cascade,
  project        text not null default 'kawai-camp',
  customer_kind  text,                 -- 会員 / LINE
  customer_id    text,
  customer_name  text,
  funnel         text,
  task_id        text,                 -- spec の CsSpecTask.id
  stale_level    text,                 -- 最優先 / 要フォロー / 通常 / 対象外 / 要確認
  stale_reason   text,
  proposal       text not null,
  channel        text,
  due            date,
  draft_ref      text,                 -- 下書きの置き場（Driveリンク等）
  decision       text not null default 'pending'
                 check (decision in ('pending','adopted','rejected','held')),
  decided_by     int references public.members(id) on delete set null,
  decided_at     timestamptz,
  reject_reason  text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_cswork_actions_pending
  on public.cswork_actions (project, decision, created_at desc);
create index if not exists idx_cswork_actions_run
  on public.cswork_actions (run_id);

-- ── 4) 課題（ループの接合部）─────────────────────────────
--   ⚠️ 同一 code ＋ task_id は1件に集約し occurrences を数える。
--      新規起票を繰り返すと100件に膨れて誰も見なくなる（設計書 R6）。
create table if not exists public.cswork_issues (
  id            bigserial primary key,
  project       text not null default 'kawai-camp',
  code          text not null,          -- UNRESOLVED_REF / LOGIN_CONFLICT …
  level         text not null default 'warn'
                check (level in ('blocker','warn','info')),
  category      text not null default '設定不足'
                check (category in ('設定不足','実行障害','運用の穴','要判断','改善')),
  title         text not null,
  detail        text,
  task_id       text,
  funnel        text,
  first_run_id  uuid references public.cswork_runs(id) on delete set null,
  last_run_id   uuid references public.cswork_runs(id) on delete set null,
  occurrences   int not null default 1,
  assignee      text,
  status        text not null default 'open'
                check (status in ('open','resolved','wontfix')),
  resolution    text,
  resolved_by   int references public.members(id) on delete set null,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 集約キー。task_id が null の行も1件に畳めるよう coalesce で揃える。
create unique index if not exists uq_cswork_issues_key
  on public.cswork_issues (project, code, coalesce(task_id, ''), status)
  where status = 'open';

create index if not exists idx_cswork_issues_open
  on public.cswork_issues (project, status, level, occurrences desc);

-- ── 5) 監査ログの action 拡張 ────────────────────────────
alter table public.cswork_audit drop constraint if exists cswork_audit_action_check;
alter table public.cswork_audit add constraint cswork_audit_action_check
  check (action in (
    'upload','activate','reveal','download',
    'normalize','approve','generate_runbook','run_ingest','decide','close_issue'
  ));

-- ── 6) RLS ───────────────────────────────────────────────
alter table public.cswork_runs    enable row level security;
alter table public.cswork_actions enable row level security;
alter table public.cswork_issues  enable row level security;

--   運営ロール（管理者・オペレーター・その派生）だけが読める。
--   ⚠️ 書き込みポリシーは作らない。挿入・更新は service_role（API）経由のみ。
drop policy if exists cswork_runs_select_ops on public.cswork_runs;
create policy cswork_runs_select_ops on public.cswork_runs
  for select using (
    exists (
      select 1
        from public.members m
        left join public.roles r on r.key = m.role
       where m.user_id = auth.uid()
         and m.is_deleted = false
         and (m.role in ('管理者','オペレーター') or r.base_role = 'オペレーター')
    )
  );

drop policy if exists cswork_actions_select_ops on public.cswork_actions;
create policy cswork_actions_select_ops on public.cswork_actions
  for select using (
    exists (
      select 1
        from public.members m
        left join public.roles r on r.key = m.role
       where m.user_id = auth.uid()
         and m.is_deleted = false
         and (m.role in ('管理者','オペレーター') or r.base_role = 'オペレーター')
    )
  );

drop policy if exists cswork_issues_select_ops on public.cswork_issues;
create policy cswork_issues_select_ops on public.cswork_issues
  for select using (
    exists (
      select 1
        from public.members m
        left join public.roles r on r.key = m.role
       where m.user_id = auth.uid()
         and m.is_deleted = false
         and (m.role in ('管理者','オペレーター') or r.base_role = 'オペレーター')
    )
  );

-- ── 7) 権限キー ──────────────────────────────────────────
--   cswork_edit … 起草と整形・実行（承認／指示ファイル生成）。管理者のみ ON。
insert into public.role_permissions (role, feature, enabled) values
('管理者','cswork_edit',true),
('オペレーター','cswork_edit',false),
('メンバー','cswork_edit',false),
('外部','cswork_edit',false)
on conflict (role, feature) do nothing;

-- 派生ロール（base_role = 'オペレーター'）にも行を持たせる（canFor の安全側フォールバック対策）
insert into public.role_permissions (role, feature, enabled)
select r.key, 'cswork_edit', false
  from public.roles r
 where r.is_system = false
on conflict (role, feature) do nothing;

-- ============================================================
-- 確認:
--   select kind, doc_version, runner, is_current, uploaded_at
--     from public.cswork_docs order by uploaded_at desc limit 20;
--   select id, status, doc_version, started_at from public.cswork_runs order by started_at desc limit 10;
--   select code, level, category, occurrences, status, title from public.cswork_issues where status = 'open';
--   select decision, count(*) from public.cswork_actions group by decision;
--   select role, feature, enabled from public.role_permissions where feature like 'cswork%';
--
-- ロールバック: supabase/migration_add_cswork_loop_rollback.sql
-- ============================================================
