// ============================================================
// CsWork：エージェント指示ファイル（runbook）の生成（REQ-039・設計書 §8）
//
//   spec からの **決定的変換**（AIを使わない）。同じ spec からは必ず同じ
//   runbook が出る。これで「実行がおかしかったのは spec のせいか、生成の
//   せいか」を切り分けられる。
//
//   ⚠️ {{ }} は展開しない。参照キーのまま出し、実値は設定値スナップショット
//      で別に渡す。指示ファイル自体が漏れても被害を限定するため。
//   ⚠️ runner=human のタスクも「実行しない」として必ず含める。省くと
//      エージェントにはそのタスクが存在しないように見え、
//      「案内が送られていない顧客がいる」ことを検知できなくなる。
//   ⚠️ タスクの並びは運用設定値 workflow.ツール順。開くツールごとにまとめる。
// ============================================================
import { blockedTaskIds, toolOrder, type CsRunner, type CsSpec, type CsSpecIssue, type CsSpecTask } from "./spec";

export interface RunbookInput {
  spec: CsSpec;
  settings: Record<string, unknown>;
  /** 生成対象の runner。Phase 1 は agent-browser の1本だけ生成する */
  runner: CsRunner;
  issues: readonly CsSpecIssue[];
  /** 設定値スナップショットの storage_path（実値の受け渡し先） */
  settingsPath: string | null;
  generatedAt: string;
}

interface Step { tool: string; tasks: { funnel: string; task: CsSpecTask }[] }

/** runbook の md 本文を作る。 */
export function buildRunbook(input: RunbookInput): string {
  const { spec, settings, runner, issues, settingsPath, generatedAt } = input;
  const blocked = new Set(blockedTaskIds([...issues]));
  const schedule = scheduleTimes(settings);
  const steps = orderSteps(spec, settings);
  const out: string[] = [];

  out.push("---");
  out.push("kind: runbook");
  out.push(`project: ${spec.project}`);
  out.push(`doc_version: "${spec.doc_version}"`);
  out.push(`spec_version: "${spec.spec_version}"`);
  out.push(`runner: ${runner}`);
  out.push(`schedule: [${schedule.map((s) => `"${s}"`).join(", ")}]`);
  out.push(`generated_at: ${generatedAt}`);
  out.push(`settings_snapshot: ${settingsPath ?? "（未設定）"}`);
  out.push("---");
  out.push("");

  out.push("# 0. 実行前提");
  out.push("");
  if (runner === "agent-browser") {
    out.push("- PC が起動し Chrome にログイン済であること。満たさない場合は該当ステップを skipped とする");
  }
  const caution = scheduleCaution(settings);
  if (caution) out.push(`- ${caution}`);
  out.push("- 前回スナップショットを読み、(+N) の基準にする。無ければ初回として基準値のみ作る");
  out.push("- 実値（URL・アカウント）は設定値スナップショットを見る。この指示ファイルには実値を書かない");
  out.push("");

  out.push("# 1. 禁止事項（違反したら即中止）");
  out.push("");
  out.push("- 顧客への送信を行わない。下書きの作成までとする");
  out.push("- クレームの一次対応を行わない。検知したら要判断として成果の冒頭に出す");
  const undecided = undecidedTopics(settings);
  out.push(undecided.length
    ? `- 未確定条件（${undecided.join("・")}）に回答しない`
    : "- 未確定条件に回答しない");
  const escalation = escalationTarget(settings);
  if (escalation) out.push(`- 判断に迷う条件は勝手に回答せず、${escalation} へ相談する`);
  out.push("");

  out.push("# 2. 手順（ツール順）");
  out.push("");
  if (!steps.length) out.push("（実行するタスクがありません）");

  steps.forEach((step, i) => {
    const acc = accountFor(settings, step.tool);
    out.push(`## 2-${i + 1}. ${step.tool}${acc ? `　（${acc}）` : ""}`);
    out.push("");
    for (const { funnel, task } of step.tasks) {
      const skip = task.runner === "human";
      out.push(`### [${task.id}] ${task.name}　runner=${task.runner}${skip ? "　← 実行しない" : ""}`);
      out.push("");
      out.push(`- 導線：${funnel}`);
      if (task.detail) out.push(`- タスク詳細：${task.detail}`);
      if (task.trigger) out.push(`- 実行条件：${task.trigger}`);
      for (const b of task.branches) {
        out.push(`- 分岐：${b.if}${b.then ? ` → ${b.then}` : ""}`);
      }
      if (task.refs.length) out.push(`- 参照：${task.refs.map((r) => `{{${r}}}`).join(" / ")}`);
      if (task.outputs.length) out.push(`- 出力先：${task.outputs.join(" / ")}`);

      if (blocked.has(task.id)) {
        const why = issues.find((x) => x.task_id === task.id && x.level === "blocker");
        out.push(`- **実行不可**：${why?.title ?? "必要な情報が不足しています"}。実行せず issues に起票する`);
      }
      if (skip) {
        out.push(`- AI がやること：${task.templates.length ? "顧客ごとの下書きを作る" : "下書きの材料を集める（テンプレート未登録のため文面は作らない）"}`);
        out.push(`- 人がやること：${task.human_gate ?? "内容を確認して実施する"}`);
      } else {
        out.push("- 失敗時：status=failed、reason_code と reason を残して次のツールへ進む");
      }
      out.push("");
    }
  });

  out.push("# 3. 出力仕様");
  out.push("");
  out.push("- result.json を CsWork の result スキーマ（設計書 §9-3）で作る");
  out.push("- 実行できなかったタスクは必ず issues に起票する（reason_code つき）");
  out.push("- 取得できなかった件数は数値を出さず null ＋ error を入れる。0 で埋めない");
  out.push("- Chatwork 通知本文を作る。**送信は人が行う**（notify.sent は false のまま）");
  out.push("");
  out.push(`- 投入先：POST /api/ops/cswork/runs（Phase 1 は画面から貼り付け）`);
  out.push("");

  return out.join("\n");
}

/** runner に該当するタスクを、ツール順に並べ替えて段取りにする。 */
export function orderSteps(spec: CsSpec, settings: Record<string, unknown>): Step[] {
  const order = toolOrder(settings);
  const all: { funnel: string; task: CsSpecTask }[] = [];
  for (const f of spec.funnels) {
    if (f.status === "archived") continue;
    for (const t of f.tasks) all.push({ funnel: f.name, task: t });
  }

  const steps: Step[] = [];
  const used = new Set<CsSpecTask>();

  for (const tool of order) {
    const tasks = all.filter((x) => x.task.tool === tool);
    if (!tasks.length) continue;
    tasks.forEach((x) => used.add(x.task));
    steps.push({ tool, tasks });
  }
  const rest = all.filter((x) => !used.has(x.task));
  if (rest.length) steps.push({ tool: "その他", tasks: rest });
  return steps;
}

// ── 設定値の読み取り（無ければ既定値で通す）────────────────
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function scheduleTimes(settings: Record<string, unknown>): string[] {
  const s = asRecord(settings.schedule);
  const t = s["実行時刻"];
  return Array.isArray(t) ? t.map((x) => String(x)) : ["09:30", "13:00", "17:00"];
}

function scheduleCaution(settings: Record<string, unknown>): string {
  const s = asRecord(settings.schedule);
  return String(s["注意"] ?? "");
}

function undecidedTopics(settings: Record<string, unknown>): string[] {
  const t = settings.undecided_topics;
  return Array.isArray(t) ? t.map((x) => String(x)) : [];
}

function escalationTarget(settings: Record<string, unknown>): string {
  const scope = asRecord(settings.scope);
  return String(scope["エスカレーション先"] ?? "");
}

/** ツールに対応するアカウントの「用途」を返す（実値は出さない）。 */
function accountFor(settings: Record<string, unknown>, tool: string): string {
  const accounts = Array.isArray(settings.accounts) ? settings.accounts : [];
  for (const a of accounts) {
    const use = String(asRecord(a)["用途"] ?? "");
    if (!use) continue;
    if (use.includes(tool) || tool.includes(use.replace(/（.*$/, ""))) return use;
  }
  return "";
}
