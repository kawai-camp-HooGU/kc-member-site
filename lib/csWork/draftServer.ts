// ============================================================
// CsWork：起草 → 整形 → 承認の一連（REQ-039・サーバー専用）
//
//   draft（試算）と approve（確定）で同じ経路を通すためのモジュール。
//   ポータルは「整形をどこでやったか」を問わない（設計書 §7-1）。
//     ・spec JSON が渡されれば、それを使う（Phase 1：Claude セッションで整形）
//     ・渡されなければ、規則ベースで整形する（draft.ts の normalizeLocal）
//   どちらで作られても、検証・差分・承認は同じコードを通る。
//
//   ⚠️ このファイルは service_role を使う server.ts / runsServer.ts に依存する。
//      呼び出し元で必ず requireAdmin() を通すこと。
//   ⚠️ MISSING_HUMAN_GATE がある間は承認しない（唯一、承認そのものを止める）。
// ============================================================
import { normalizeLocal } from "./draft";
import { mergeSpec, type CsChange } from "./merge";
import { buildRunbook } from "./runbook";
import {
  CSWORK_PROJECT, audit, fetchCurrent, loadSettings, nextDocVersion,
  readCurrentContent, saveDoc,
} from "./server";
import { syncSpecIssues } from "./runsServer";
import {
  hasFatal, parseSpec, specStats, validateSpec,
  type CsSpec, type CsSpecIssue,
} from "./spec";

export interface DraftInput {
  /** 人が書いたラフmd（原本）。必須 */
  sourceMd: string;
  /** Claude セッションで整形した spec JSON（任意。無ければ規則ベースで整形する） */
  specJson?: string;
  /** 採用する変更の識別子（task_id ／ `funnel:キー`）。未指定なら全採用 */
  accept?: readonly string[];
  filename?: string;
}

export interface DraftOutcome {
  spec: CsSpec;
  changes: CsChange[];
  summary: { added: number; updated: number; kept: number };
  issues: CsSpecIssue[];
  stats: { funnels: number; tasks: number; inferred: number };
  /** 整形をどこで行ったか（画面に出す） */
  normalizedBy: "spec-json" | "rules";
  /** 承認できるか（MISSING_HUMAN_GATE が無いこと） */
  canApprove: boolean;
  settingsFrom: "settings" | "ops" | "none";
}

/** 整形して差分と検証結果を返す。**保存はしない。** */
export async function draftSpec(input: DraftInput): Promise<DraftOutcome> {
  const { settings, from } = await loadSettings();

  const baseDoc = await readCurrentContent("spec");
  const base = baseDoc ? parseSpec(JSON.parse(baseDoc.text)) : null;
  const usedTaskIds = base ? base.funnels.flatMap((f) => f.tasks.map((t) => t.id)) : [];

  let incoming: CsSpec;
  let normalizedBy: DraftOutcome["normalizedBy"];
  if ((input.specJson ?? "").trim()) {
    incoming = parseSpec(JSON.parse(input.specJson as string));
    normalizedBy = "spec-json";
  } else {
    incoming = normalizeLocal(input.sourceMd, { project: CSWORK_PROJECT, settings, usedTaskIds });
    normalizedBy = "rules";
  }

  const merged = mergeSpec(base, incoming, input.accept);
  const issues = validateSpec(merged.spec, settings);
  merged.spec.issues = issues;

  return {
    spec: merged.spec,
    changes: merged.changes,
    summary: merged.summary,
    issues,
    stats: specStats(merged.spec),
    normalizedBy,
    canApprove: !hasFatal(issues),
    settingsFrom: from,
  };
}

export interface ApproveOutcome extends DraftOutcome {
  docVersion: string;
  sourceDocId: string;
  specDocId: string;
  runbookDocId: string;
  issueSync: { opened: number; autoClosed: number };
}

/**
 * 承認する。source / spec / settings / runbook を同じ doc_version で束ねて保存し、
 * 解消した課題を自動クローズする。
 */
export async function approveSpec(input: DraftInput, memberId: number | null): Promise<ApproveOutcome> {
  const outcome = await draftSpec(input);
  if (!outcome.canApprove) {
    throw new Error("送信を伴うタスクに人の関門（human_gate）がありません。承認できません");
  }

  const { yaml } = await loadSettings();
  const docVersion = await nextDocVersion();
  const now = new Date().toISOString();

  // A：原本（人が書いたラフmd）
  const sourceRow = await saveDoc({
    kind: "source",
    filename: input.filename ?? `${now.slice(0, 10)}_起草.md`,
    text: input.sourceMd,
    title: `起草 ${docVersion}`,
    version: docVersion,
    meta: { normalizedBy: outcome.normalizedBy },
    memberId,
    makeCurrent: true,
    docVersion,
  });

  // B：正規形
  const spec: CsSpec = {
    ...outcome.spec,
    doc_version: docVersion,
    source_doc_id: sourceRow.id,
    generated_at: now,
  };

  // C：設定値のスナップショット（実値を含むため伏字は画面側で行う）
  let settingsDocId: string | null = null;
  if (yaml.trim()) {
    const settingsRow = await saveDoc({
      kind: "settings",
      filename: `${now.slice(0, 10)}_設定値.yaml`,
      text: yaml,
      title: `運用設定値 ${docVersion}`,
      version: docVersion,
      meta: {},
      memberId,
      makeCurrent: true,
      docVersion,
      parentId: sourceRow.id,
    });
    settingsDocId = settingsRow.id;
  }
  spec.settings_doc_id = settingsDocId;

  const specRow = await saveDoc({
    kind: "spec",
    filename: `spec_v${docVersion}.json`,
    text: JSON.stringify(spec, null, 2),
    title: `運用仕様 ${docVersion}`,
    version: docVersion,
    meta: { stats: outcome.stats, issues: outcome.issues.length },
    memberId,
    makeCurrent: true,
    docVersion,
    parentId: sourceRow.id,
    approvedBy: memberId,
  });

  // D：指示ファイル（Phase 1 は agent-browser の1本）
  const settingsRowNow = await fetchCurrent("settings");
  const { settings } = await loadSettings();
  const runbookMd = buildRunbook({
    spec,
    settings,
    runner: "agent-browser",
    issues: outcome.issues,
    settingsPath: settingsRowNow?.storage_path ?? null,
    generatedAt: now,
  });
  const runbookRow = await saveDoc({
    kind: "runbook",
    filename: `runbook_agent-browser_v${docVersion}.md`,
    text: runbookMd,
    title: `指示ファイル ${docVersion}`,
    version: docVersion,
    meta: { runner: "agent-browser" },
    memberId,
    makeCurrent: true,
    docVersion,
    parentId: specRow.id,
    runner: "agent-browser",
  });

  const issueSync = await syncSpecIssues(outcome.issues, memberId);

  await audit("approve", memberId, specRow.id, {
    doc_version: docVersion, ...outcome.summary, issues: outcome.issues.length,
  });
  await audit("generate_runbook", memberId, runbookRow.id, { runner: "agent-browser", doc_version: docVersion });

  return {
    ...outcome,
    spec,
    docVersion,
    sourceDocId: sourceRow.id,
    specDocId: specRow.id,
    runbookDocId: runbookRow.id,
    issueSync,
  };
}
