// ============================================================
// CsWork：運用仕様（spec）の型と充足チェック（REQ-039）
//
//   spec は「人が書いたラフmd」を整形した正規形。画面・指示ファイル・検証は
//   すべてこの JSON を見る。人は直接編集しない（確定1）。
//
//   ⚠️ キーは設計書（2026-08-26_CsWork運用ループ化_再設計_設計書.html §5-1）と
//      同じ snake_case で固定する。spec は DB 列ではなく「ドキュメントの契約」で、
//      ポータル外（Claude セッション）でも生成されるため、変換層を挟まない。
//   ⚠️ 検証は「書式が正しいか」ではなく「実行に必要な情報が揃っているか」を見る。
//      書式の責任は AI 整形が引き取ったので、ここで書式を問い直さない。
//   ⚠️ MISSING_HUMAN_GATE だけは承認そのものを止める唯一の blocker。
//      誤送信・二重送信は信用と売上を直接毀損するため、例外を作らない。
// ============================================================

/** spec の契約バージョン。読み取り側はこの値で分岐する。 */
export const SPEC_VERSION = "5.0";

/** タスクの実行者。Phase 1 で稼働するのは agent-browser と human だけ。 */
export type CsRunner = "agent-browser" | "portal-cron" | "human";
export const RUNNERS: readonly CsRunner[] = ["agent-browser", "portal-cron", "human"];

export type CsIssueLevel = "blocker" | "warn" | "info";

/** 充足チェックの結果コード。画面のバッジと課題の code をこれで揃える。 */
export type CsIssueCode =
  | "MISSING_HUMAN_GATE"
  | "UNRESOLVED_REF"
  | "NO_TASK"
  | "TOOL_UNKNOWN"
  | "TEMPLATE_MISSING"
  | "FUNNEL_UNKNOWN"
  | "LITERAL_URL"
  | "NAME_MISMATCH"
  | "INFERRED";

export interface CsSpecIssue {
  code: CsIssueCode;
  level: CsIssueLevel;
  /** 該当タスク（導線全体の指摘なら null） */
  task_id: string | null;
  funnel: string | null;
  title: string;
  detail: string;
}

export interface CsSpecBranch { if: string; then: string }
export interface CsSpecTemplate { channel: string; body: string }
export interface CsSpecResource {
  用途: string;
  key: string;
   備考: string;
  /** 設定値でURLが解決できたか */
  resolved: boolean;
}

export interface CsSpecTask {
  /** 導線キー2文字＋連番。承認後は不変（実行結果と課題がこのIDで紐づく） */
  id: string;
  name: string;
  order: number;
  tool: string;
  runner: CsRunner;
  detail: string;
  trigger: string;
  branches: CsSpecBranch[];
  templates: CsSpecTemplate[];
  /** 成果の計上先（@out / ★[output] 記法） */
  outputs: string[];
  /** 人の関門。送信を含むタスクは必須 */
  human_gate: string | null;
  /** タスク本文が参照している {{ }} のキー */
  refs: string[];
  /** AI（または規則）が推定した項目名。画面に「AI推定」バッジを出す */
  inferred: string[];
  /** 起草mdの何行目から来たか（原文へ戻るため） */
  source_lines: number[];
}

export interface CsSpecFunnel {
  key: string;
  name: string;
  /** 起草mdでの別名。次回の差分マージで同一導線と判定するために保持する */
  aliases: string[];
  targets: string;
  goal: string;
  entry: string;
  stale_policy: string;
  /** 確定7：区分を増やせるようにしたため、休止も表せるようにする */
  status: "active" | "archived";
  /** 既存導線の下位施策として扱う場合の親キー（集計はここへ丸める） */
  parent_key: string | null;
  resources: CsSpecResource[];
  tasks: CsSpecTask[];
}

export interface CsSpec {
  spec_version: string;
  doc_version: string;
  project: string;
  generated_at: string;
  source_doc_id: string | null;
  settings_doc_id: string | null;
  funnels: CsSpecFunnel[];
  issues: CsSpecIssue[];
}

/** 顧客への送信を含むと判断する語。ここに引っかかったら human_gate を要求する。 */
export const SEND_WORDS: readonly string[] = [
  "送信", "送る", "案内を送", "返信", "回答", "配信", "リマインド", "連絡する", "メールする",
];

export function emptySpec(project: string): CsSpec {
  return {
    spec_version: SPEC_VERSION,
    doc_version: "0.0",
    project,
    generated_at: new Date().toISOString(),
    source_doc_id: null,
    settings_doc_id: null,
    funnels: [],
    issues: [],
  };
}

/** JSON.parse 済みの値が spec の形をしているかを確かめる（外部生成物を受けるため）。 */
export function parseSpec(raw: unknown): CsSpec {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("spec が JSON オブジェクトではありません");
  }
  const o = raw as Record<string, unknown>;
  const version = String(o.spec_version ?? "");
  if (!version) throw new Error("spec_version がありません");
  if (major(version) !== major(SPEC_VERSION)) {
    throw new Error(`spec_version ${version} は読めません（対応：${SPEC_VERSION}）`);
  }
  if (!Array.isArray(o.funnels)) throw new Error("funnels がありません");

  return {
    spec_version: version,
    doc_version: String(o.doc_version ?? "0.0"),
    project: String(o.project ?? ""),
    generated_at: String(o.generated_at ?? new Date().toISOString()),
    source_doc_id: o.source_doc_id == null ? null : String(o.source_doc_id),
    settings_doc_id: o.settings_doc_id == null ? null : String(o.settings_doc_id),
    funnels: (o.funnels as unknown[]).map((f, i) => normalizeFunnel(f, i)),
    issues: Array.isArray(o.issues) ? (o.issues as CsSpecIssue[]) : [],
  };
}

function major(v: string): string {
  return (v.split(".")[0] ?? "").trim();
}

function normalizeFunnel(raw: unknown, index: number): CsSpecFunnel {
  const f = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = String(f.name ?? `導線${index + 1}`).trim();
  const status = f.status === "archived" ? "archived" : "active";
  return {
    key: String(f.key ?? funnelKey(name)),
    name,
    aliases: strArray(f.aliases),
    targets: String(f.targets ?? ""),
    goal: String(f.goal ?? ""),
    entry: String(f.entry ?? ""),
    stale_policy: String(f.stale_policy ?? ""),
    status,
    parent_key: f.parent_key == null ? null : String(f.parent_key),
    resources: Array.isArray(f.resources)
      ? (f.resources as unknown[]).map((r) => {
          const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
          return {
            用途: String(o["用途"] ?? ""),
            key: String(o.key ?? ""),
            備考: String(o["備考"] ?? ""),
            resolved: o.resolved === true,
          };
        })
      : [],
    tasks: Array.isArray(f.tasks)
      ? (f.tasks as unknown[]).map((t, i) => normalizeTask(t, name, i))
      : [],
  };
}

function normalizeTask(raw: unknown, funnelName: string, index: number): CsSpecTask {
  const t = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const runner = RUNNERS.includes(t.runner as CsRunner) ? (t.runner as CsRunner) : "human";
  return {
    id: String(t.id ?? `${funnelKey(funnelName).slice(0, 2).toUpperCase()}-${String(index + 1).padStart(2, "0")}`),
    name: String(t.name ?? `タスク${index + 1}`).trim(),
    order: Number(t.order ?? index + 1),
    tool: String(t.tool ?? "その他"),
    runner,
    detail: String(t.detail ?? ""),
    trigger: String(t.trigger ?? ""),
    branches: Array.isArray(t.branches)
      ? (t.branches as unknown[]).map((b) => {
          const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
          return { if: String(o.if ?? ""), then: String(o.then ?? "") };
        })
      : [],
    templates: Array.isArray(t.templates)
      ? (t.templates as unknown[]).map((x) => {
          const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
          return { channel: String(o.channel ?? ""), body: String(o.body ?? "") };
        })
      : [],
    outputs: strArray(t.outputs),
    human_gate: t.human_gate == null || t.human_gate === "" ? null : String(t.human_gate),
    refs: strArray(t.refs),
    inferred: strArray(t.inferred),
    source_lines: Array.isArray(t.source_lines) ? (t.source_lines as unknown[]).map((n) => Number(n) || 0) : [],
  };
}

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x)).filter((s) => s.trim() !== "");
}

/** 導線名からキーを作る（日本語はそのまま使えないので簡易ハッシュに落とす）。 */
export function funnelKey(name: string): string {
  const ascii = name.replace(/[^\x21-\x7e]/g, "");
  if (ascii.length >= 3) return ascii.toLowerCase().slice(0, 24);
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return `f${h.toString(36)}`;
}

// ── 充足チェック ──────────────────────────────────────────
/**
 * spec が「実行できる状態か」を確かめる。
 *   settings は運用設定値（links / workflow / screen_names …）。
 *   戻り値は spec.issues にそのまま入れられる形にする。
 */
export function validateSpec(spec: CsSpec, settings: Record<string, unknown>): CsSpecIssue[] {
  const issues: CsSpecIssue[] = [];
  const tools = toolOrder(settings);
  const links = asRecord(settings.links);
  const knownFunnels = knownFunnelNames(settings);
  const screenNames = strArray(settings.screen_names);

  for (const f of spec.funnels) {
    if (f.status === "archived") continue;

    if (!f.tasks.length) {
      issues.push({
        code: "NO_TASK", level: "blocker", task_id: null, funnel: f.name,
        title: `${f.name}：タスクがありません`,
        detail: "導線にタスクが1件も無いため、指示ファイルを作れません",
      });
    }

    if (knownFunnels.length && !knownFunnels.includes(f.name) && !f.parent_key) {
      issues.push({
        code: "FUNNEL_UNKNOWN", level: "warn", task_id: null, funnel: f.name,
        title: `導線区分「${f.name}」は既知の区分にありません`,
        detail: `既知：${knownFunnels.join("・")}。新設するか、既存の別名として扱うかを選んでください`,
      });
    }

    for (const t of f.tasks) {
      if (needsHumanGate(t) && !t.human_gate) {
        issues.push({
          code: "MISSING_HUMAN_GATE", level: "blocker", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：人の関門がありません`,
          detail: "顧客への送信を含むタスクには human_gate が必須です（送信は人が行う）",
        });
      }

      for (const ref of t.refs) {
        if (!resolvesLink(links, ref)) {
          issues.push({
            code: "UNRESOLVED_REF", level: "blocker", task_id: t.id, funnel: f.name,
            title: `${t.id} ${t.name}：{{${ref}}} が未登録`,
            detail: "参照先のURLが運用設定値にありません。このタスクは実行できません",
          });
        }
      }

      if (tools.length && !tools.includes(t.tool)) {
        issues.push({
          code: "TOOL_UNKNOWN", level: "warn", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：使用ツール「${t.tool}」が未定義`,
          detail: `業務フローでは「その他」に落ちます。設定値 workflow.ツール順：${tools.join("・")}`,
        });
      }

      if (needsHumanGate(t) && !t.templates.length) {
        issues.push({
          code: "TEMPLATE_MISSING", level: "warn", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：案内テンプレートが未登録`,
          detail: "送信を伴うタスクですが文面がありません。実行時に下書きを作れません",
        });
      }

      const literal = findLiteralUrl(t);
      if (literal) {
        issues.push({
          code: "LITERAL_URL", level: "warn", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：URLが直書きされています`,
          detail: `${literal} を運用設定値へ切り出し、タスクからは {{ }} で参照してください`,
        });
      }

      const mismatch = screenNames.length ? findNameMismatch(t, screenNames) : null;
      if (mismatch) {
        issues.push({
          code: "NAME_MISMATCH", level: "warn", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：画面名「${mismatch}」が現行と一致しません`,
          detail: `設定値 screen_names の候補：${screenNames.join("・")}`,
        });
      }

      if (t.inferred.length) {
        issues.push({
          code: "INFERRED", level: "info", task_id: t.id, funnel: f.name,
          title: `${t.id} ${t.name}：${t.inferred.length}項目を推定しました`,
          detail: t.inferred.join("・"),
        });
      }
    }
  }

  return issues;
}

/** 顧客への送信を含むタスクか。 */
export function needsHumanGate(task: CsSpecTask): boolean {
  const hay = `${task.name} ${task.detail} ${task.branches.map((b) => `${b.if}${b.then}`).join(" ")}`;
  return SEND_WORDS.some((w) => hay.includes(w));
}

/** blocker が1件でもあるか（承認可否の判定に使う）。 */
export function hasBlocker(issues: CsSpecIssue[]): boolean {
  return issues.some((i) => i.level === "blocker");
}

/** 承認そのものを止める blocker（MISSING_HUMAN_GATE）があるか。 */
export function hasFatal(issues: CsSpecIssue[]): boolean {
  return issues.some((i) => i.code === "MISSING_HUMAN_GATE");
}

/** 実行不可のタスクID（UNRESOLVED_REF が付いたもの）。 */
export function blockedTaskIds(issues: CsSpecIssue[]): string[] {
  const ids = new Set<string>();
  for (const i of issues) {
    if (i.level === "blocker" && i.task_id) ids.add(i.task_id);
  }
  return Array.from(ids);
}

export function specStats(spec: CsSpec): { funnels: number; tasks: number; inferred: number } {
  const active = spec.funnels.filter((f) => f.status !== "archived");
  const tasks = active.flatMap((f) => f.tasks);
  return {
    funnels: active.length,
    tasks: tasks.length,
    inferred: tasks.reduce((n, t) => n + t.inferred.length, 0),
  };
}

// ── 設定値の読み取り ──────────────────────────────────────
export function toolOrder(settings: Record<string, unknown>): string[] {
  const wf = asRecord(settings.workflow);
  const order = wf["ツール順"];
  return Array.isArray(order) ? order.map((x) => String(x)) : [];
}

export function knownFunnelNames(settings: Record<string, unknown>): string[] {
  const f = settings.funnels;
  if (Array.isArray(f)) return f.map((x) => String(x));
  if (f && typeof f === "object") return Object.keys(f as Record<string, unknown>);
  return [];
}

/** {{ }} の参照先が設定値で解決できるか（links の値 or url が空でないこと）。 */
export function resolvesLink(links: Record<string, unknown>, ref: string): boolean {
  const v = links[ref];
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "object") {
    const url = (v as Record<string, unknown>).url;
    return typeof url === "string" && url.trim() !== "";
  }
  return false;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const URL_RE = /https?:\/\/[^\s、。）)]+/;

function findLiteralUrl(task: CsSpecTask): string | null {
  const hay = `${task.detail} ${task.branches.map((b) => `${b.if} ${b.then}`).join(" ")}`;
  return URL_RE.exec(hay)?.[0] ?? null;
}

/** 「〜一覧」「〜画面」に見える語のうち、正表に無いものを1つ返す。 */
function findNameMismatch(task: CsSpecTask, screenNames: string[]): string | null {
  const hay = `${task.detail} ${task.branches.map((b) => b.if + b.then).join(" ")}`;
  for (const m of hay.matchAll(/「([^」]{2,24})」/g)) {
    const word = m[1].trim();
    if (!/(一覧|画面|メニュー|ページ)$/.test(word)) continue;
    if (screenNames.includes(word)) continue;
    return word;
  }
  return null;
}
