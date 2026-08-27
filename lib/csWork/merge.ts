// ============================================================
// CsWork：spec の差分算出とマージ（REQ-039・設計書 §7-2）
//
//   整形は常に「現行 spec ＋ 投入されたラフmd」の2入力で走る。
//   全文を投げても差分だけを投げても、同じ経路を通る。
//
//   ⚠️ **投入mdに無いものは消さない。** 差分投入を許すということは、投入mdが
//      全体の一部でしかないのが普通ということ。「無いものは削除」にすると、
//      1タスク追記したつもりで29タスクが消える。削除は画面の明示操作だけ。
//   ⚠️ タスクIDは承認後は不変。名前が一致した既存タスクは **IDを保ったまま**
//      中身を差し替える（実行結果と課題がこのIDで紐づいているため）。
// ============================================================
import { funnelKey, type CsSpec, type CsSpecFunnel, type CsSpecTask } from "./spec";

export type CsChangeKind = "added" | "updated" | "kept" | "funnel-added" | "funnel-updated";

export interface CsChange {
  kind: CsChangeKind;
  funnel: string;
  task_id: string | null;
  label: string;
  /** 更新のとき、どの項目が変わったか */
  fields: string[];
}

export interface CsMergeResult {
  spec: CsSpec;
  changes: CsChange[];
  /** 採用/不採用をユーザーが選べる単位（task_id、導線だけの変更は `funnel:キー`） */
  summary: { added: number; updated: number; kept: number };
}

/**
 * 現行 spec に、投入 spec（ラフmdの整形結果）を重ねる。
 *   base が null なら投入分がそのまま新しい spec になる。
 *   accept が渡されたときは、その task_id ／ `funnel:キー` だけを採用する。
 */
export function mergeSpec(base: CsSpec | null, incoming: CsSpec, accept?: readonly string[]): CsMergeResult {
  const allow = accept ? new Set(accept) : null;
  const changes: CsChange[] = [];

  const merged: CsSpec = base
    ? { ...base, funnels: base.funnels.map(cloneFunnel), generated_at: incoming.generated_at }
    : { ...incoming, funnels: [], issues: [] };

  merged.spec_version = incoming.spec_version;
  merged.source_doc_id = incoming.source_doc_id;

  for (const inc of incoming.funnels) {
    const target = findFunnel(merged.funnels, inc);

    if (!target) {
      if (allow && !allow.has(`funnel:${inc.key}`)) continue;
      merged.funnels.push(cloneFunnel(inc));
      changes.push({ kind: "funnel-added", funnel: inc.name, task_id: null, label: `導線「${inc.name}」を追加`, fields: [] });
      for (const t of inc.tasks) {
        changes.push({ kind: "added", funnel: inc.name, task_id: t.id, label: `${t.id} ${t.name}`, fields: [] });
      }
      continue;
    }

    const funnelFields = mergeFunnelAttrs(target, inc, allow);
    if (funnelFields.length) {
      changes.push({
        kind: "funnel-updated", funnel: target.name, task_id: null,
        label: `導線「${target.name}」の属性を更新`, fields: funnelFields,
      });
    }

    for (const t of inc.tasks) {
      const exist = target.tasks.find((x) => sameTask(x, t));
      if (!exist) {
        if (allow && !allow.has(t.id)) continue;
        const id = uniqueId(merged, t.id);
        target.tasks.push({ ...t, id, order: target.tasks.length + 1 });
        changes.push({ kind: "added", funnel: target.name, task_id: id, label: `${id} ${t.name}`, fields: [] });
        continue;
      }

      const fields = diffTask(exist, t);
      if (!fields.length) {
        changes.push({ kind: "kept", funnel: target.name, task_id: exist.id, label: `${exist.id} ${exist.name}`, fields: [] });
        continue;
      }
      if (allow && !allow.has(exist.id)) {
        changes.push({ kind: "kept", funnel: target.name, task_id: exist.id, label: `${exist.id} ${exist.name}（不採用）`, fields: [] });
        continue;
      }
      // ⚠️ ID と order は保つ。実行結果・課題がこのIDで紐づいている。
      Object.assign(exist, { ...t, id: exist.id, order: exist.order });
      changes.push({ kind: "updated", funnel: target.name, task_id: exist.id, label: `${exist.id} ${exist.name}`, fields });
    }
  }

  // 投入mdに出てこなかった既存タスクは「保持」として必ず数える（消さない）。
  const touched = new Set(changes.filter((c) => c.task_id).map((c) => c.task_id));
  for (const f of merged.funnels) {
    for (const t of f.tasks) {
      if (touched.has(t.id)) continue;
      changes.push({ kind: "kept", funnel: f.name, task_id: t.id, label: `${t.id} ${t.name}`, fields: [] });
    }
  }

  return {
    spec: merged,
    changes,
    summary: {
      added: changes.filter((c) => c.kind === "added").length,
      updated: changes.filter((c) => c.kind === "updated").length,
      kept: changes.filter((c) => c.kind === "kept").length,
    },
  };
}

/** 導線の対応づけ。名前・キー・別名のいずれかが一致すれば同じ導線とみなす。 */
function findFunnel(list: CsSpecFunnel[], inc: CsSpecFunnel): CsSpecFunnel | undefined {
  return list.find((f) =>
    f.key === inc.key ||
    f.name === inc.name ||
    f.aliases.includes(inc.name) ||
    inc.aliases.includes(f.name));
}

function sameTask(a: CsSpecTask, b: CsSpecTask): boolean {
  return a.id === b.id || normName(a.name) === normName(b.name);
}

function normName(s: string): string {
  return s.replace(/^\s*\d+[.．]\s*/, "").replace(/\s+/g, "").trim();
}

const TASK_FIELDS = ["tool", "runner", "detail", "trigger", "human_gate"] as const;

function diffTask(a: CsSpecTask, b: CsSpecTask): string[] {
  const fields: string[] = [];
  for (const k of TASK_FIELDS) {
    if ((a[k] ?? "") !== (b[k] ?? "")) fields.push(k);
  }
  if (JSON.stringify(a.branches) !== JSON.stringify(b.branches)) fields.push("branches");
  if (JSON.stringify(a.templates) !== JSON.stringify(b.templates)) fields.push("templates");
  if (a.outputs.join("|") !== b.outputs.join("|")) fields.push("outputs");
  if (a.refs.join("|") !== b.refs.join("|")) fields.push("refs");
  return fields;
}

/** 導線の属性は「空だったところだけ埋める」。既存の記述を上書きしない。 */
function mergeFunnelAttrs(target: CsSpecFunnel, inc: CsSpecFunnel, allow: Set<string> | null): string[] {
  if (allow && !allow.has(`funnel:${target.key}`)) return [];
  const fields: string[] = [];

  for (const k of ["targets", "goal", "entry", "stale_policy"] as const) {
    if (!target[k] && inc[k]) { target[k] = inc[k]; fields.push(k); }
  }
  for (const a of inc.aliases) {
    if (a !== target.name && !target.aliases.includes(a)) { target.aliases.push(a); fields.push("aliases"); }
  }
  for (const r of inc.resources) {
    if (target.resources.some((x) => x.key === r.key && x["用途"] === r["用途"])) continue;
    target.resources.push({ ...r });
    fields.push("resources");
  }
  return Array.from(new Set(fields));
}

function cloneFunnel(f: CsSpecFunnel): CsSpecFunnel {
  return {
    ...f,
    aliases: [...f.aliases],
    resources: f.resources.map((r) => ({ ...r })),
    tasks: f.tasks.map((t) => ({
      ...t,
      branches: t.branches.map((b) => ({ ...b })),
      templates: t.templates.map((x) => ({ ...x })),
      outputs: [...t.outputs],
      refs: [...t.refs],
      inferred: [...t.inferred],
      source_lines: [...t.source_lines],
    })),
  };
}

/** spec 全体で一意なタスクIDにする（差分投入で採番がぶつかるのを防ぐ）。 */
function uniqueId(spec: CsSpec, wanted: string): string {
  const used = new Set(spec.funnels.flatMap((f) => f.tasks.map((t) => t.id)));
  if (!used.has(wanted)) return wanted;
  const m = /^(.*?)-(\d+)$/.exec(wanted);
  const prefix = m ? m[1] : wanted;
  for (let n = (m ? Number(m[2]) : 1) + 1; n < 999; n++) {
    const id = `${prefix}-${String(n).padStart(2, "0")}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}-${funnelKey(wanted).slice(0, 4)}`;
}

/**
 * 明示操作での削除。整形の結果としては絶対に呼ばない（画面のボタンからだけ）。
 */
export function removeTasks(spec: CsSpec, taskIds: readonly string[]): CsSpec {
  const drop = new Set(taskIds);
  return {
    ...spec,
    funnels: spec.funnels.map((f) => ({ ...f, tasks: f.tasks.filter((t) => !drop.has(t.id)) })),
  };
}
