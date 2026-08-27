// ============================================================
// CsWork：GET /api/ops/cswork のレスポンス型（クライアント安全・REQ-039）
//
//   4メニューが共通で受け取る形。サーバー専用モジュール（server.ts /
//   runsServer.ts）を import しないので、そのままクライアントから読める。
//
//   ⚠️ ここに service_role を触る import を足さないこと。
// ============================================================
import type { CsSpecFunnel, CsSpecIssue } from "./spec";

export type CsWorkKindClient = "ops" | "design" | "watchlist" | "source" | "spec" | "settings" | "runbook";

export interface CsSection { title: string; html: string }
export interface CsTaskView { funnel: string; name: string; tool: string; html: string }
export interface CsFunnelView { name: string; summaryHtml: string; sections: CsSection[]; tasks: CsTaskView[] }
export interface CsFlowStepView {
  tool: string;
  account: { 用途?: string; url?: string; id?: string } | null;
  tasks: CsTaskView[];
}

export interface CsWatchRowView {
  優先度: string; 導線種別: string; 氏名: string; 現況: string; 顧客種別: string;
  LINE名: string; メールアドレス: string; 電話番号: string; 顧客ID: string; 予定日: string;
  監視要件: string; 最終アクション日: string; 最終アクション内容: string;
  次アクション予定日: string; 次アクション提案: string; 備考: string;
  stale: { level: string; reason: string };
  links: { name: string; url: string | null }[];
}

export interface CsDocRow {
  id: string;
  kind: CsWorkKindClient;
  title: string | null;
  version: string | null;
  filename: string | null;
  is_current: boolean;
  uploaded_at: string;
  bytes: number | null;
  doc_version: string | null;
  runner: string | null;
  meta?: { validation?: { label: string; status: string; detail: string }[] } | null;
}

export interface CsRunView {
  id: string;
  doc_version: string | null;
  runner: string;
  scheduled_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  status: "success" | "partial" | "failed" | "skipped";
  counts: Record<string, { value?: number | null; delta?: number | null; as_of?: string; error?: string }>;
  steps: { task_id?: string; status?: string; reason_code?: string; reason?: string }[];
  artifacts: { kind?: string; name?: string; url?: string }[];
  notify: { room?: string; body?: string; sent?: boolean };
}

export interface CsActionView {
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
  decision: "pending" | "adopted" | "rejected" | "held";
  decided_at: string | null;
  reject_reason: string | null;
  created_at: string;
}

export interface CsIssueView {
  id: number;
  code: string;
  level: "blocker" | "warn" | "info";
  category: "設定不足" | "実行障害" | "運用の穴" | "要判断" | "改善";
  title: string;
  detail: string | null;
  task_id: string | null;
  funnel: string | null;
  occurrences: number;
  assignee: string | null;
  status: "open" | "resolved" | "wontfix";
  resolution: string | null;
  created_at: string;
  updated_at: string;
}

export interface CsWorkPayload {
  ops: {
    title: string; version: string;
    funnels: CsFunnelView[]; intro: CsSection[]; settingsSections: CsSection[];
  } | null;
  flow: CsFlowStepView[];
  design: { title: string; sections: CsSection[] } | null;
  watch: CsWatchRowView[];
  docs: {
    ops: CsDocRow | null; design: CsDocRow | null; watchlist: CsDocRow | null;
    spec: CsDocRow | null; source: CsDocRow | null; runbook: CsDocRow | null;
  };
  spec: {
    doc_version: string;
    generated_at: string;
    funnels: CsSpecFunnel[];
    stats: { funnels: number; tasks: number; inferred: number };
  } | null;
  specIssues: CsSpecIssue[];
  blockedTaskIds: string[];
  settingsFrom: "settings" | "ops" | "none";
  resources: {
    links: { key: string; name: string; url: string | null }[];
    accounts: { 用途: string; url: string | null; id: string | null; pass: string | null }[];
  };
  latestRun: CsRunView | null;
  issues: CsIssueView[];
  actions: CsActionView[];
  reveal: boolean;
}

/** 整形の差分（POST /api/ops/cswork/draft のレスポンス）。 */
export interface CsDraftOutcome {
  spec: { doc_version: string; funnels: CsSpecFunnel[] };
  changes: { kind: string; funnel: string; task_id: string | null; label: string; fields: string[] }[];
  summary: { added: number; updated: number; kept: number };
  issues: CsSpecIssue[];
  stats: { funnels: number; tasks: number; inferred: number };
  normalizedBy: "spec-json" | "rules";
  canApprove: boolean;
  settingsFrom: "settings" | "ops" | "none";
}
