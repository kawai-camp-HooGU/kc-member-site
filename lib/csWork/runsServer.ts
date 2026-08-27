// ============================================================
// CsWork：実行・成果・課題の保存（REQ-039・サーバー専用）
//
//   Driveが本文、ポータルが索引と判断の記録（設計書 §5）。
//   ここが持つのは run のメタ情報・Driveへのリンク・人が何を採否したかだけ。
//
//   ⚠️ このファイルは service_role（supabaseAdmin）で動く。呼び出し元で
//      必ず requireOps() / requireAdmin() を通してから使うこと。
//   ⚠️ 課題は同一 code ＋ task_id を1件に集約し occurrences を数える。
//      新規起票を繰り返すと膨れて誰も見なくなる（設計書 R6）。
//   ⚠️ 実行できなかった理由が課題にならなければループは STEP 7 で止まる。
//      ingestRun() で必ず起票するのがこの設計の要である。
// ============================================================
import { supabaseAdmin } from "../supabaseAdmin";
import { CSWORK_PROJECT } from "./server";
import type { CsIssueLevel, CsSpecIssue } from "./spec";

export type RunStatus = "success" | "partial" | "failed" | "skipped";
export type ActionDecision = "pending" | "adopted" | "rejected" | "held";
export type IssueCategory = "設定不足" | "実行障害" | "運用の穴" | "要判断" | "改善";
export type IssueStatus = "open" | "resolved" | "wontfix";

export interface CsRunRow {
  id: string;
  project: string;
  runbook_doc_id: string | null;
  doc_version: string | null;
  runner: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: RunStatus;
  counts: Record<string, unknown>;
  steps: unknown[];
  artifacts: unknown[];
  notify: Record<string, unknown>;
  created_at: string;
}

export interface CsActionRow {
  id: number;
  run_id: string;
  customer_kind: string | null;
  customer_id: string | null;
  customer_name: string | null;
  funnel: string | null;
  task_id: string | null;
  stale_level: string | null;
  stale_reason: string | null;
  proposal: string;
  channel: string | null;
  due: string | null;
  draft_ref: string | null;
  decision: ActionDecision;
  decided_by: number | null;
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface CsIssueRow {
  id: number;
  project: string;
  code: string;
  level: CsIssueLevel;
  category: IssueCategory;
  title: string;
  detail: string | null;
  task_id: string | null;
  funnel: string | null;
  first_run_id: string | null;
  last_run_id: string | null;
  occurrences: number;
  assignee: string | null;
  status: IssueStatus;
  resolution: string | null;
  resolved_by: number | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** エージェントが投入する実行結果（設計書 §9-3）。 */
export interface RunResultPayload {
  run_id?: string;
  doc_version?: string;
  runner?: string;
  scheduled_at?: string;
  started_at?: string;
  finished_at?: string;
  status?: RunStatus;
  counts?: Record<string, unknown>;
  steps?: { task_id?: string; status?: string; reason_code?: string; reason?: string }[];
  next_actions?: {
    customer_kind?: string; customer_id?: string; name?: string; funnel?: string;
    stale?: string; stale_reason?: string; action?: string; channel?: string;
    due?: string; task_id?: string; draft_ref?: string;
  }[];
  notify?: Record<string, unknown>;
  issues?: {
    code?: string; level?: CsIssueLevel; category?: IssueCategory;
    title?: string; detail?: string; task_id?: string; funnel?: string; assignee?: string;
  }[];
  artifacts?: { kind?: string; name?: string; url?: string }[];
}

const db = () => supabaseAdmin as unknown as { from: (t: string) => any };

// ── 実行（run）────────────────────────────────────────────
export async function fetchRuns(limit = 30): Promise<CsRunRow[]> {
  const { data, error } = await db()
    .from("cswork_runs")
    .select("*")
    .eq("project", CSWORK_PROJECT)
    .order("started_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsRunRow[];
}

export async function fetchLatestRun(): Promise<CsRunRow | null> {
  const rows = await fetchRuns(1);
  return rows[0] ?? null;
}

/**
 * 実行結果を1件取り込む。run → next_actions → issues の順に展開する。
 *   同じ run_id で再投入されたら上書きする（エージェント側の再送で二重にしない）。
 */
export async function ingestRun(
  payload: RunResultPayload,
  runbookDocId: string | null,
  memberId: number | null,
): Promise<CsRunRow> {
  const id = (payload.run_id ?? "").trim() || crypto.randomUUID();
  const now = new Date().toISOString();

  const row = {
    id,
    project: CSWORK_PROJECT,
    runbook_doc_id: runbookDocId,
    doc_version: payload.doc_version ?? null,
    runner: payload.runner ?? "agent-browser",
    scheduled_at: payload.scheduled_at ?? null,
    started_at: payload.started_at ?? now,
    finished_at: payload.finished_at ?? now,
    status: payload.status ?? "partial",
    counts: payload.counts ?? {},
    steps: payload.steps ?? [],
    artifacts: payload.artifacts ?? [],
    notify: payload.notify ?? {},
  };

  const { data, error } = await db()
    .from("cswork_runs").upsert(row, { onConflict: "id" }).select("*").single();
  if (error) throw new Error(error.message);

  // 再投入に備えて、この run に紐づく提案は入れ直す（採否は失われるが、
  // 同じ run を投入し直すのは「結果が違っていた」ときなので入れ直しが正しい）。
  await db().from("cswork_actions").delete().eq("run_id", id);

  const actions = (payload.next_actions ?? []).map((a) => ({
    run_id: id,
    project: CSWORK_PROJECT,
    customer_kind: a.customer_kind ?? null,
    customer_id: a.customer_id ?? null,
    customer_name: a.name ?? null,
    funnel: a.funnel ?? null,
    task_id: a.task_id ?? null,
    stale_level: a.stale ?? null,
    stale_reason: a.stale_reason ?? null,
    proposal: (a.action ?? "").trim() || "（提案なし）",
    channel: a.channel ?? null,
    due: a.due ?? null,
    draft_ref: a.draft_ref ?? null,
    decision: "pending" as ActionDecision,
  }));
  if (actions.length) {
    const { error: e2 } = await db().from("cswork_actions").insert(actions);
    if (e2) throw new Error(e2.message);
  }

  // 実行できなかった理由を必ず課題にする（ループの接合部）。
  for (const i of payload.issues ?? []) {
    await upsertIssue({
      code: (i.code ?? "UNKNOWN").trim(),
      level: i.level ?? "warn",
      category: i.category ?? "実行障害",
      title: (i.title ?? "").trim() || `${i.code ?? "UNKNOWN"}`,
      detail: i.detail ?? null,
      task_id: i.task_id ?? null,
      funnel: i.funnel ?? null,
      assignee: i.assignee ?? null,
      runId: id,
    });
  }

  // steps の failed / skipped も、issues に載っていなければ課題にする。
  for (const s of payload.steps ?? []) {
    if (s.status !== "failed" && s.status !== "skipped") continue;
    const code = (s.reason_code ?? "").trim() || (s.status === "failed" ? "STEP_FAILED" : "STEP_SKIPPED");
    if ((payload.issues ?? []).some((i) => i.code === code && i.task_id === s.task_id)) continue;
    await upsertIssue({
      code,
      level: s.status === "failed" ? "blocker" : "warn",
      category: "実行障害",
      title: `${s.task_id ?? "（タスク不明）"}：${s.status === "failed" ? "実行に失敗" : "実行しませんでした"}`,
      detail: s.reason ?? null,
      task_id: s.task_id ?? null,
      funnel: null,
      assignee: null,
      runId: id,
    });
  }

  await db().from("cswork_audit").insert({
    doc_id: runbookDocId, action: "run_ingest", actor: memberId,
    detail: { run_id: id, status: row.status },
  });

  return data as CsRunRow;
}

// ── 次アクション提案 ──────────────────────────────────────
export async function fetchActions(runId?: string, limit = 200): Promise<CsActionRow[]> {
  let q = db().from("cswork_actions").select("*").eq("project", CSWORK_PROJECT);
  if (runId) q = q.eq("run_id", runId);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsActionRow[];
}

export async function decideAction(
  id: number,
  decision: ActionDecision,
  memberId: number | null,
  rejectReason: string | null,
): Promise<CsActionRow> {
  const { data, error } = await db().from("cswork_actions").update({
    decision,
    decided_by: memberId,
    decided_at: decision === "pending" ? null : new Date().toISOString(),
    reject_reason: decision === "rejected" ? rejectReason : null,
  }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsActionRow;
}

// ── 課題 ──────────────────────────────────────────────────
export async function fetchIssues(status: IssueStatus | "all" = "open", limit = 200): Promise<CsIssueRow[]> {
  let q = db().from("cswork_issues").select("*").eq("project", CSWORK_PROJECT);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q.order("occurrences", { ascending: false }).limit(limit);
  if (error) throw new Error(error.message);

  // 重さ順に並べる。DB の text 順（blocker < info < warn）では info が warn より
  // 前に来てしまうので、並べ替えはここで行う。
  const rank: Record<string, number> = { blocker: 0, warn: 1, info: 2 };
  return ((data ?? []) as CsIssueRow[]).sort((a, b) => {
    const d = (rank[a.level] ?? 9) - (rank[b.level] ?? 9);
    return d !== 0 ? d : b.occurrences - a.occurrences;
  });
}

interface UpsertIssueInput {
  code: string;
  level: CsIssueLevel;
  category: IssueCategory;
  title: string;
  detail: string | null;
  task_id: string | null;
  funnel: string | null;
  assignee: string | null;
  runId: string | null;
}

/**
 * 課題を1件足す。同じ code ＋ task_id の open があれば occurrences を増やすだけ。
 *   ⚠️ 「3回連続で実行できていない」を数えるのがここ。件数が影響度になる。
 */
export async function upsertIssue(input: UpsertIssueInput): Promise<CsIssueRow> {
  // ⚠️ task_id が null の行も畳めるよう、同じ code の open をまとめて引いてから
  //    JS 側で突き合わせる（`.is()` と `.eq()` を条件で切り替えると読みにくい）。
  const { data: found } = await db()
    .from("cswork_issues").select("*")
    .eq("project", CSWORK_PROJECT)
    .eq("code", input.code)
    .eq("status", "open")
    .limit(100);

  const rows = (found ?? []) as CsIssueRow[];
  const exist = rows.find((r) => (r.task_id ?? null) === input.task_id);

  if (exist) {
    const { data, error } = await db().from("cswork_issues").update({
      occurrences: exist.occurrences + 1,
      last_run_id: input.runId ?? exist.last_run_id,
      title: input.title || exist.title,
      detail: input.detail ?? exist.detail,
      updated_at: new Date().toISOString(),
    }).eq("id", exist.id).select("*").single();
    if (error) throw new Error(error.message);
    return data as CsIssueRow;
  }

  const { data, error } = await db().from("cswork_issues").insert({
    project: CSWORK_PROJECT,
    code: input.code,
    level: input.level,
    category: input.category,
    title: input.title,
    detail: input.detail,
    task_id: input.task_id,
    funnel: input.funnel,
    first_run_id: input.runId,
    last_run_id: input.runId,
    occurrences: 1,
    assignee: input.assignee,
    status: "open",
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsIssueRow;
}

export async function closeIssue(
  id: number,
  status: IssueStatus,
  resolution: string | null,
  memberId: number | null,
): Promise<CsIssueRow> {
  const { data, error } = await db().from("cswork_issues").update({
    status,
    resolution,
    resolved_by: status === "open" ? null : memberId,
    resolved_at: status === "open" ? null : new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsIssueRow;
}

export async function setIssueAssignee(id: number, assignee: string | null): Promise<CsIssueRow> {
  const { data, error } = await db().from("cswork_issues").update({
    assignee, updated_at: new Date().toISOString(),
  }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsIssueRow;
}

/**
 * 承認時に、spec の充足チェック結果と課題を突き合わせる。
 *   ・blocker で残っているものは起票（既存なら回数を増やす）
 *   ・整形で解消した「設定不足」は自動クローズ（確定：自動クローズできる区分を先に作る）
 */
export async function syncSpecIssues(issues: readonly CsSpecIssue[], memberId: number | null): Promise<{
  opened: number; autoClosed: number;
}> {
  const blockers = issues.filter((i) => i.level === "blocker");
  let opened = 0;

  for (const i of blockers) {
    await upsertIssue({
      code: i.code,
      level: i.level,
      category: i.code === "UNRESOLVED_REF" ? "設定不足" : "運用の穴",
      title: i.title,
      detail: i.detail,
      task_id: i.task_id,
      funnel: i.funnel,
      assignee: null,
      runId: null,
    });
    opened++;
  }

  // いま出ていない「設定不足」の課題は解消したとみなす。
  const open = await fetchIssues("open");
  const alive = new Set(blockers.map((i) => `${i.code}|${i.task_id ?? ""}`));
  let autoClosed = 0;

  for (const row of open) {
    if (row.category !== "設定不足") continue;
    if (alive.has(`${row.code}|${row.task_id ?? ""}`)) continue;
    await closeIssue(row.id, "resolved", "整形で解消を確認（自動クローズ）", memberId);
    autoClosed++;
  }

  return { opened, autoClosed };
}
