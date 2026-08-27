// ============================================================
// CsWork：ラフmd → spec の整形（REQ-039・入力契約 v2）
//
//   人が守るルールは3つだけ（設計書 §6-1）。
//     1. `#` は導線種別、`###` はタスク。`##` は自由な小見出し。行頭の空白は許す
//     2. 顧客へ送る文面はコードブロックで囲む
//     3. URL・アカウント・しきい値は {{ }} で参照する（実値は運用設定値に置く）
//
//   足りない項目はここで推定し、推定した項目名を task.inferred に必ず残す。
//   **推定の精度より、推定した事実を隠さないことのほうが運用上は重要である。**
//
//   ⚠️ これは Phase 1 の規則ベース整形（AI不使用）。同じ spec スキーマを
//      Phase 2 の Claude API 整形（normalize.ts）と共有するので、
//      呼び出し側はどちらで作られた spec かを区別しない。
//   ⚠️ 送信を含むタスクは runner を human に倒し、human_gate を自動付与する。
//      判断に迷ったら「人がやる」側へ倒すのが安全側。
// ============================================================
import {
  SPEC_VERSION, funnelKey, needsHumanGate, toolOrder,
  type CsRunner, type CsSpec, type CsSpecBranch, type CsSpecFunnel,
  type CsSpecTask, type CsSpecTemplate,
} from "./spec";

/** 行頭の空白を許す見出し。現行 parse.ts の HEADING と同じ意味で、緩めたもの。 */
const LOOSE_HEADING = /^\s*(#{1,6})\s+(.*?)\s*#*$/;

/** 任意マーカー。書けば確定、書かなければ推定する。 */
const MARKER_RE = /^\s*(?:[-*]\s*)?@(tool|when|out|runner|gate)\s*[:：]\s*(.+)$/i;

/** サンプルの `★[output]へ"A"、"B"へ計上。` 記法。@out と同義に扱う。 */
const OUTPUT_RE = /[★☆]?\[output\][^\n]*/i;

/** ブラウザ操作が要るツール。runner=agent-browser に倒す根拠になる。 */
const BROWSER_TOOLS: readonly string[] = [
  "まるなげ", "UTAGE", "テレコムクレジット", "テレコム", "KAWAICAMPポータル", "ポータル", "ウェビナー",
];

/** 本文からツール名を拾うときの別名。左が本文の語、右が正式名。 */
const TOOL_ALIASES: readonly (readonly [string, string])[] = [
  ["まるなげ", "まるなげ"],
  ["UTAGE", "UTAGE"],
  ["テレコム", "テレコムクレジット"],
  ["ポータル", "KAWAICAMPポータル"],
  ["LINE", "UTAGE"],
  ["メール", "メール"],
  ["ウェビナー", "ウェビナー"],
  ["台帳", "要監視顧客台帳"],
  ["報告", "報告"],
];

const TRIGGER_WORDS: readonly string[] = [
  "とき", "直後", "翌営業日", "翌日", "当日", "前日", "毎日", "経過", "受信", "申込後", "回答時",
];

const BRANCH_WORDS: readonly string[] = [
  "ならば", "なら", "無ければ", "なければ", "ない場合", "場合には", "場合は", "→", "反応なし", "未",
];

export interface DraftOptions {
  project: string;
  settings: Record<string, unknown>;
  /** 差分投入で採番が既存とぶつからないようにするための既存ID一覧 */
  usedTaskIds?: readonly string[];
}

/** ラフmd を spec に整形する。front matter は無くてよい（あれば尊重する）。 */
export function normalizeLocal(md: string, opts: DraftOptions): CsSpec {
  const body = stripFrontMatter(md);
  const lines = body.split(/\r?\n/);
  const tools = toolOrder(opts.settings);
  const used = new Set<string>(opts.usedTaskIds ?? []);

  const funnels: WorkFunnel[] = [];
  let funnel: WorkFunnel | null = null;
  let taskLines: string[] = [];
  let taskName = "";
  let taskStart = 0;
  let inCode = false;

  const closeTask = (endLine: number) => {
    if (!funnel || !taskName) { taskLines = []; taskName = ""; return; }
    funnel.tasks.push(buildTask(taskName, taskLines, {
      funnel, tools, used, order: funnel.tasks.length + 1, from: taskStart, to: endLine,
    }));
    taskLines = [];
    taskName = "";
  };

  const closeFunnel = (endLine: number) => {
    closeTask(endLine);
    if (funnel) funnels.push(funnel);
    funnel = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) inCode = !inCode;

    const m = inCode ? null : LOOSE_HEADING.exec(line);
    if (m) {
      const level = m[1].length;
      const title = m[2].trim();

      if (level === 1) {
        closeFunnel(i);
        funnel = newFunnel(title);
        continue;
      }
      if (level >= 3) {
        closeTask(i);
        taskName = title;
        taskStart = i + 1;
        continue;
      }
      // `##` は自由な小見出し。導線の属性として読める見出しだけ拾う。
      closeTask(i);
      if (funnel) funnel.pendingSection = title;
      continue;
    }

    if (taskName) { taskLines.push(line); continue; }
    if (funnel) applyFunnelLine(funnel, line);
  }
  closeFunnel(lines.length);

  // pendingSection は組み立て用の一時プロパティ。spec には出さない。
  for (const f of funnels) delete f.pendingSection;

  return {
    spec_version: SPEC_VERSION,
    doc_version: "0.0",
    project: opts.project,
    generated_at: new Date().toISOString(),
    source_doc_id: null,
    settings_doc_id: null,
    funnels,
    issues: [],
  };
}

/** front matter があれば落とす（無くてよい契約なので、あっても無くても同じ結果にする）。 */
function stripFrontMatter(text: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return m ? text.slice(m[0].length) : text;
}

interface WorkFunnel extends CsSpecFunnel { pendingSection?: string }

function newFunnel(title: string): WorkFunnel {
  // 「個別面談（販促アプローチ①）」→ name=個別面談 / aliases=[販促アプローチ①]
  const aliases: string[] = [];
  const name = title.replace(/[（(]([^）)]+)[）)]\s*$/, (_all, inner: string) => {
    aliases.push(inner.trim());
    return "";
  }).trim() || title.trim();

  return {
    key: funnelKey(name),
    name,
    aliases,
    targets: "",
    goal: "",
    entry: "",
    stale_policy: "",
    status: "active",
    parent_key: null,
    resources: [],
    tasks: [],
    pendingSection: "",
  };
}

/** タスク見出しの外にある行を、導線の属性へ寄せる。 */
function applyFunnelLine(funnel: WorkFunnel, line: string): void {
  const text = line.replace(/^\s*[-*]\s+/, "").trim();
  if (!text) return;
  const section = funnel.pendingSection ?? "";

  if (/対象/.test(section)) { funnel.targets = join(funnel.targets, text); return; }
  if (/入口|導線|流入/.test(section)) { funnel.entry = join(funnel.entry, text); return; }
  if (/扱い|方針|ゴール|概要/.test(section)) {
    if (/ゴール|目的/.test(text)) funnel.goal = join(funnel.goal, text);
    else funnel.stale_policy = join(funnel.stale_policy, text);
    return;
  }
  if (/資料|アカウント|URL|ページ/.test(section)) {
    const key = /\{\{(.+?)\}\}/.exec(text)?.[1]?.trim() ?? "";
    funnel.resources.push({ 用途: text.replace(/\{\{.+?\}\}/g, "").trim(), key, 備考: "", resolved: false });
    return;
  }
  if (!funnel.goal && /ゴール|目的/.test(text)) funnel.goal = text;
}

function join(base: string, add: string): string {
  return base ? `${base} / ${add}` : add;
}

interface TaskCtx {
  funnel: CsSpecFunnel;
  tools: string[];
  used: Set<string>;
  order: number;
  from: number;
  to: number;
}

function buildTask(name: string, lines: string[], ctx: TaskCtx): CsSpecTask {
  const markers = new Map<string, string>();
  const templates: CsSpecTemplate[] = [];
  const body: string[] = [];
  const outputs: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) { buf.push(lines[i]); i++; }
      templates.push({ channel: "", body: buf.join("\n").trim() });
      continue;
    }

    const mk = MARKER_RE.exec(line);
    if (mk) { markers.set(mk[1].toLowerCase(), mk[2].trim()); continue; }

    const out = OUTPUT_RE.exec(line);
    if (out) { outputs.push(...extractOutputs(out[0])); continue; }

    const text = line.replace(/^\s*[-*]\s+/, "").trim();
    if (text) body.push(text);
  }

  const outMarker = markers.get("out");
  if (outMarker != null) {
    outputs.length = 0;
    outputs.push(...outMarker.split(/[、,／/]/).map((s) => s.trim()).filter((s) => s !== ""));
  }

  const detailLines = body.filter((t) => !isBranch(t));
  const branchLines = body.filter((t) => isBranch(t));
  const detail = detailLines.join(" ");
  const hay = `${name} ${body.join(" ")}`;

  const inferred: string[] = [];

  let tool = markers.get("tool") ?? "";
  if (!tool) { tool = inferTool(hay, ctx.tools); inferred.push("tool"); }

  let trigger = markers.get("when") ?? "";
  if (!trigger) { trigger = inferTrigger(body); inferred.push("trigger"); }

  const branches: CsSpecBranch[] = branchLines.map(toBranch);
  if (branches.length) inferred.push("branches");

  let runner = asRunner(markers.get("runner"));
  if (!runner) { runner = inferRunner(tool, hay); inferred.push("runner"); }

  const draft: CsSpecTask = {
    id: nextId(ctx),
    name,
    order: ctx.order,
    tool,
    runner,
    detail,
    trigger,
    branches,
    templates,
    outputs: Array.from(new Set(outputs)),
    human_gate: markers.get("gate") ?? null,
    refs: Array.from(hay.matchAll(/\{\{(.+?)\}\}/g)).map((m) => m[1].trim()),
    inferred,
    source_lines: [ctx.from, ctx.to],
  };

  // 送信を含むのに関門が書かれていなければ自動付与する（安全側）。
  if (!draft.human_gate && needsHumanGate(draft)) {
    draft.human_gate = "送信は人が実施する";
    draft.runner = "human";
    if (!inferred.includes("human_gate")) inferred.push("human_gate");
  }

  return draft;
}

/** `★[output]へ"要監視顧客（販促）"、"要対応一覧"へ計上。` から計上先を取り出す。 */
function extractOutputs(text: string): string[] {
  const quoted = Array.from(text.matchAll(/[「"“']([^」"”']+)[」"”']/g)).map((m) => m[1].trim());
  if (quoted.length) return quoted;
  const rest = text.replace(/[★☆]?\[output\]\s*[へに]?/i, "").replace(/[へに]?計上。?$/, "").trim();
  return rest ? rest.split(/[、,／/]/).map((s) => s.trim()).filter(Boolean) : [];
}

function isBranch(text: string): boolean {
  return BRANCH_WORDS.some((w) => text.includes(w));
}

function toBranch(text: string): CsSpecBranch {
  const arrow = text.split(/→|->/);
  if (arrow.length >= 2) return { if: arrow[0].trim(), then: arrow.slice(1).join("→").trim() };
  const m = /^(.*?(?:ならば|なら|無ければ|なければ|ない場合|場合には|場合は))(.*)$/.exec(text);
  if (m) return { if: m[1].trim(), then: m[2].trim() };
  return { if: text, then: "" };
}

function inferTool(hay: string, tools: string[]): string {
  for (const t of tools) {
    if (hay.includes(t)) return t;
  }
  for (const [word, formal] of TOOL_ALIASES) {
    if (hay.includes(word)) return formal;
  }
  return "その他";
}

function inferTrigger(body: string[]): string {
  const hit = body.find((t) => TRIGGER_WORDS.some((w) => t.includes(w)));
  return hit ?? "各実行時";
}

function inferRunner(tool: string, hay: string): CsRunner {
  if (BROWSER_TOOLS.some((t) => tool.includes(t))) return "agent-browser";
  if (/判断|検討|エスカレーション|面談/.test(hay)) return "human";
  return "human";
}

function asRunner(v: string | undefined): CsRunner | null {
  if (v === "agent-browser" || v === "portal-cron" || v === "human") return v;
  return null;
}

/** 導線ごとに `XX-01` 形式で採番する。既存IDとはぶつけない。 */
function nextId(ctx: TaskCtx): string {
  const prefix = idPrefix(ctx.funnel.name);
  for (let n = ctx.order; n < ctx.order + 200; n++) {
    const id = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!ctx.used.has(id)) { ctx.used.add(id); return id; }
  }
  const fallback = `${prefix}-${ctx.used.size + 1}`;
  ctx.used.add(fallback);
  return fallback;
}

/** 導線名から2文字のIDプレフィックスを作る（日本語は仮名の読みを持てないのでキー由来）。 */
export function idPrefix(name: string): string {
  const ascii = name.replace(/[^A-Za-z]/g, "");
  if (ascii.length >= 2) return ascii.slice(0, 2).toUpperCase();
  const key = funnelKey(name).replace(/[^a-z0-9]/g, "");
  return (key.slice(0, 2) || "TS").toUpperCase();
}
