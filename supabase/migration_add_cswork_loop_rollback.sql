-- ============================================================
-- ロールバック：CsWork 運用ループ化（REQ-039）
--
--   ⚠️ cswork_runs / cswork_actions / cswork_issues を **データごと** 落とす。
--      実行履歴・提案の採否・課題の解決記録が消える。実行前に必要なら
--      バックアップを取ること。
--   ⚠️ cswork_docs は落とさない（REQ-028 の資産）。足した列だけ外し、
--      kind の許容値を元の3種へ戻す。**戻す前に source/spec/settings/runbook の
--      行を消す必要がある**（残っていると check 制約が張れない）。
-- ============================================================

-- ── 1) 新規3表 ───────────────────────────────────────────
drop table if exists public.cswork_actions;
drop table if exists public.cswork_issues;
drop table if exists public.cswork_runs;

-- ── 2) 監査ログの action を元へ ──────────────────────────
delete from public.cswork_audit
 where action in ('normalize','approve','generate_runbook','run_ingest','decide','close_issue');

alter table public.cswork_audit drop constraint if exists cswork_audit_action_check;
alter table public.cswork_audit add constraint cswork_audit_action_check
  check (action in ('upload','activate','reveal','download'));

-- ── 3) cswork_docs を元へ ────────────────────────────────
--   REQ-039 で足した種別の行を先に消す（本文は Storage に残るので、
--   必要なら storage.objects からも消すこと）。
delete from public.cswork_docs where kind in ('source','spec','settings','runbook');

drop index if exists public.uq_cswork_docs_current;
create unique index if not exists uq_cswork_docs_current
  on public.cswork_docs (project, kind) where is_current;

drop index if exists public.idx_cswork_docs_version;

alter table public.cswork_docs drop constraint if exists cswork_docs_runner_check;
alter table public.cswork_docs drop column if exists approved_at;
alter table public.cswork_docs drop column if exists approved_by;
alter table public.cswork_docs drop column if exists runner;
alter table public.cswork_docs drop column if exists parent_id;
alter table public.cswork_docs drop column if exists doc_version;

alter table public.cswork_docs drop constraint if exists cswork_docs_kind_check;
alter table public.cswork_docs add constraint cswork_docs_kind_check
  check (kind in ('ops','design','watchlist'));

-- ── 4) 権限キー ──────────────────────────────────────────
delete from public.role_permissions where feature = 'cswork_edit';
