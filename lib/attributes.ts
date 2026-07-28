// ============================================================
// 属性マスタ（属性A ＞ 属性B ＞ 属性C の親子カスケード階層）
//   設定「属性」タブで編集。自己参照ツリー（最大3階層 level 0..2）。
//   role_permissions と同じく self-contained なデータ層として提供する。
// ============================================================
import { supabase } from "./supabase";
import type { Tables, TablesInsert } from "./database.types";
import type { FormAction } from "./models";

/** 階層の深さ（属性A/B/C の3段） */
export const MAX_LEVEL = 2;
export const LEVEL_KEYS = ["A", "B", "C"] as const;
export const DEFAULT_LEVEL_NAMES = ["大分類", "中分類", "小分類"];
export const DEFAULT_COLOR = "#6B7280";

// ── 配色ルール（案A：大分類＝色相／小分類＝濃淡）────────────────
//
//   ① 色相は大分類が決める。配下は同じ色相の濃淡だけで表す。
//      → 会員一覧でチップが並んだとき、色を見ただけで「どの系統の属性か」が分かる。
//   ② 色相は6つまで。7つ目が必要になったら、大分類が多すぎるサイン。
//   ③ 赤・琥珀は「状態」（要対応・解約リスクなど）専用に予約し、自動割り当てしない。
//      分類目的で赤を使うと、一覧の赤いチップが緊急なのか分類なのか判断できなくなる。
//
//   tones は [大分類, 中分類, 小分類]。深いほど淡くなる。
export interface AttrHue { key: string; name: string; tones: [string, string, string] }

export const ATTR_HUES: AttrHue[] = [
  { key: "purple", name: "紫",       tones: ["#534AB7", "#7F77DD", "#AFA9EC"] },
  { key: "teal",   name: "ティール", tones: ["#0F6E56", "#1D9E75", "#5DCAA5"] },
  { key: "blue",   name: "ブルー",   tones: ["#185FA5", "#378ADD", "#85B7EB"] },
  { key: "pink",   name: "ピンク",   tones: ["#993556", "#D4537E", "#ED93B1"] },
  { key: "green",  name: "グリーン", tones: ["#3B6D11", "#639922", "#97C459"] },
  { key: "gray",   name: "グレー",   tones: ["#5F5E5A", "#888780", "#B4B2A9"] },
];

/** 状態を表す予約色。自動では割り当てず、運営が手で選ぶ。 */
export const ATTR_STATUS_COLORS = [
  { name: "要対応・リスク", color: "#A32D2D" },
  { name: "保留・注意",     color: "#BA7517" },
];

const norm = (hex: string) => hex.trim().toUpperCase();

/** 色 → その色を含む色相 */
function hueOf(color: string): AttrHue | null {
  const c = norm(color);
  return ATTR_HUES.find((h) => h.tones.some((t) => norm(t) === c)) ?? null;
}

/** 白へ寄せる（パレット外の色を親に持つ子のフォールバック） */
function mixWhite(hex: string, ratio: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return DEFAULT_COLOR;
  const n = parseInt(m[1], 16);
  const mix = (v: number) => Math.round(v + (255 - v) * ratio);
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * 子ノードの既定色＝親の色相を1段淡くしたもの。
 *   親がパレット外の色（運営が手で選んだ色）なら、その色を白へ寄せて濃淡を作る。
 */
export function childColorOf(parentColor: string, childLevel: number): string {
  const hue = hueOf(parentColor);
  if (hue) return hue.tones[Math.min(childLevel, 2)];
  return mixWhite(parentColor, childLevel === 1 ? 0.3 : 0.5);
}

/**
 * 新しい大分類の既定色＝まだ使われていない色相。
 *   全色相を使い切ったら先頭から回す（＝6つ目以降は色が重複するので、
 *   大分類を整理するべきというシグナルになる）。
 */
export function nextRootColor(usedColors: string[]): string {
  const used = new Set(usedColors.map((c) => hueOf(c)?.key).filter(Boolean) as string[]);
  const free = ATTR_HUES.find((h) => h.key !== "gray" && !used.has(h.key));
  if (free) return free.tones[0];
  return ATTR_HUES[usedColors.length % ATTR_HUES.length].tones[0];
}

/** アプリ内の属性ノード（camelCase）。open/detail はUI状態（DB非永続）。 */
export interface AttrNode {
  id: number;
  level: number;
  parentId: number | null;
  name: string;
  color: string;
  bg: boolean;
  bold: boolean;
  titleColor: boolean;
  visible: boolean;
  sortOrder: number;
  children: AttrNode[];
  open?: boolean;
  detail?: boolean;
}

/** 保存可能なフィールド（open/detail/children/id/level/parentId を除く） */
export type AttrPatch = Partial<
  Pick<AttrNode, "name" | "color" | "bg" | "bold" | "titleColor" | "visible" | "sortOrder">
>;

// ── 変換 ──────────────────────────────────────────────
const toNode = (r: Tables<"attributes">): AttrNode => ({
  id: r.id,
  level: r.level,
  parentId: r.parent_id ?? null,
  name: r.name ?? "",
  color: r.color ?? DEFAULT_COLOR,
  bg: r.bg ?? false,
  bold: r.bold ?? false,
  titleColor: r.title_color ?? false,
  visible: r.visible ?? true,
  sortOrder: r.sort_order ?? 0,
  children: [],
});

const patchToRow = (p: AttrPatch): TablesInsert<"attributes"> => {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined) row.name = p.name;
  if (p.color !== undefined) row.color = p.color;
  if (p.bg !== undefined) row.bg = p.bg;
  if (p.bold !== undefined) row.bold = p.bold;
  if (p.titleColor !== undefined) row.title_color = p.titleColor;
  if (p.visible !== undefined) row.visible = p.visible;
  if (p.sortOrder !== undefined) row.sort_order = p.sortOrder;
  return row as TablesInsert<"attributes">;
};

// ── 階層レベル名 ────────────────────────────────────────
export async function loadLevelNames(): Promise<string[]> {
  const { data, error } = await supabase.from("attribute_levels").select("*").order("level");
  const names = [...DEFAULT_LEVEL_NAMES];
  if (error || !data) return names;
  for (const r of data) if (r.level >= 0 && r.level <= MAX_LEVEL) names[r.level] = r.name;
  return names;
}

export async function saveLevelName(level: number, name: string): Promise<void> {
  await supabase.from("attribute_levels").upsert({ level, name }, { onConflict: "level" });
}

// ── ツリー取得 ──────────────────────────────────────────
export async function loadAttributeTree(): Promise<AttrNode[]> {
  const { data, error } = await supabase
    .from("attributes")
    .select("*")
    .eq("is_deleted", false)
    .order("sort_order")
    .order("id");
  if (error || !data) return [];

  const nodes = data.map(toNode);
  const byId = new Map<number, AttrNode>();
  nodes.forEach((n) => byId.set(n.id, n));

  const roots: AttrNode[] = [];
  nodes.forEach((n) => {
    if (n.parentId != null && byId.has(n.parentId)) byId.get(n.parentId)!.children.push(n);
    else roots.push(n);
  });
  const sortRec = (list: AttrNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    list.forEach((c) => sortRec(c.children));
  };
  sortRec(roots);
  return roots;
}

// ── CRUD ────────────────────────────────────────────────
export async function createAttribute(input: {
  level: number;
  parentId: number | null;
  name: string;
  sortOrder: number;
  color?: string;
}): Promise<AttrNode | null> {
  const { data, error } = await supabase
    .from("attributes")
    .insert({
      level: input.level,
      parent_id: input.parentId,
      name: input.name,
      color: input.color ?? DEFAULT_COLOR,
      sort_order: input.sortOrder,
    })
    .select()
    .single();
  if (error || !data) { console.error("attribute insert:", error); return null; }
  return toNode(data);
}

export async function updateAttribute(id: number, patch: AttrPatch): Promise<void> {
  const { error } = await supabase.from("attributes").update(patchToRow(patch)).eq("id", id);
  if (error) console.error("attribute update:", error);
}

/** 指定ノードと配下を全てソフト削除（idの配列はUI側で算出して渡す） */
export async function deleteAttributes(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await supabase.from("attributes").update({ is_deleted: true }).in("id", ids);
  if (error) console.error("attribute delete:", error);
}

/** 同一階層の並び順を保存（[{id, sortOrder}] を順次更新） */
export async function saveOrder(items: { id: number; sortOrder: number }[]): Promise<void> {
  await Promise.all(
    items.map((it) => supabase.from("attributes").update({ sort_order: it.sortOrder }).eq("id", it.id))
  );
}

// ── ユーティリティ ──────────────────────────────────────
/** ノードと全子孫のidを収集 */
export function collectIds(node: AttrNode): number[] {
  const ids = [node.id];
  node.children.forEach((c) => ids.push(...collectIds(c)));
  return ids;
}

/** ツリー全ノード数 */
export function countNodes(nodes: AttrNode[]): number {
  return nodes.reduce((n, x) => n + 1 + countNodes(x.children), 0);
}

// ── 付与会員（属性 → メンバー）────────────────────────────
//
//   member_attributes に入っているのは「末端ノードのID」だけ。
//   例：会員区分 ＞ 有料会員 ＞ フロント を持つ会員は「フロント」のIDしか持たない。
//   したがって上位ノード（会員区分・有料会員）の付与人数を出すには、
//   末端IDから **祖先を辿って加算** する必要がある。
//
//   ⚠️ 集計はノード数 × 会員数で高々数万程度なのでクライアントで回す。
//      規模が大きくなったらビュー（v_attribute_member_counts）に寄せること。

export interface AttrMemberLink { memberId: number; attributeId: number }

/** member_attributes を丸ごと取得（削除済み会員は除外） */
export async function loadAttrMemberLinks(): Promise<AttrMemberLink[]> {
  const [{ data: links }, { data: members }] = await Promise.all([
    // 会員に紐づく行のみ（friend_id 側＝LINE顧客の属性は会員集計に含めない）
    supabase.from("member_attributes").select("member_id, attribute_id").not("member_id", "is", null),
    supabase.from("members_visible").select("id").eq("is_deleted", false),
  ]);
  const alive = new Set((members ?? []).map((m) => m.id));
  return (links ?? [])
    .filter((l): l is { member_id: number; attribute_id: number } => l.member_id != null && alive.has(l.member_id))
    .map((l) => ({ memberId: l.member_id, attributeId: l.attribute_id }));
}

/**
 * 属性ID → その属性が付与されている会員IDの集合。
 *   祖先ノードにも子孫の会員を積み上げる（＝「会員区分」には有料・無料の全員が入る）。
 *
 * @param tree  loadAttributeTree() のツリー
 * @param links loadAttrMemberLinks() の結果
 */
export function buildAttrMemberMap(
  tree: AttrNode[],
  links: AttrMemberLink[],
): Map<number, Set<number>> {
  // 末端ID → 祖先ID配列（自身を含む）
  const ancestorsOf = new Map<number, number[]>();
  const walk = (node: AttrNode, path: number[]) => {
    const p = [...path, node.id];
    ancestorsOf.set(node.id, p);
    node.children.forEach((c) => walk(c, p));
  };
  tree.forEach((n) => walk(n, []));

  const map = new Map<number, Set<number>>();
  for (const l of links) {
    for (const aid of ancestorsOf.get(l.attributeId) ?? [l.attributeId]) {
      const set = map.get(aid) ?? new Set<number>();
      set.add(l.memberId);
      map.set(aid, set);
    }
  }
  return map;
}

// ── 使用箇所（この属性を付与／解除するアクションが設定されている箇所）──────
//
//   属性は各機能に分散して設定される（案B）。「どこで付与されているか」を
//   一望するため、アクションを持ちうる場所を横断で走査する。
//     ・一斉配信 broadcasts.link_actions … リンククリック時
//     ・シナリオ scenario_steps.link_actions … ステップのリンククリック時
//     ・フォーム forms.after_actions（回答後）/ form_fields.options[].actions（選択時）
//     ・流入経路 sources.actions … 流入時
//   参照: docs/属性自動更新_実装案.md

export type AttrUsageKind = "broadcast" | "scenario" | "form" | "source";

export interface AttrUsageItem {
  kind: AttrUsageKind;
  /** 遷移先の実体ID */
  id: number;
  /** 表示名 */
  title: string;
  /** 補足（ステップ番号・選択肢名・状態など） */
  detail?: string;
  /** 付与 or 解除 */
  op: "add" | "remove";
  /** 発火タイミングの説明（クリック時／回答後／選択時／流入時） */
  where: string;
  /** 別ウィンドウで開くURL（無い場合は開くボタンを出さない） */
  href?: string;
}

/** アクション配列の中に、対象属性の付与／解除があるか調べる */
function opsForAttr(raw: unknown, attrId: number): ("add" | "remove")[] {
  if (!Array.isArray(raw)) return [];
  const ops: ("add" | "remove")[] = [];
  for (const a of raw as FormAction[]) {
    if (a && a.attrId === attrId) {
      if (a.type === "attr_add") ops.push("add");
      else if (a.type === "attr_remove") ops.push("remove");
    }
  }
  return ops;
}

/** link_actions（URL→アクション配列）を全URL分まとめて走査 */
function opsInLinkMap(map: unknown, attrId: number): ("add" | "remove")[] {
  if (!map || typeof map !== "object" || Array.isArray(map)) return [];
  const ops: ("add" | "remove")[] = [];
  for (const acts of Object.values(map as Record<string, unknown>)) {
    ops.push(...opsForAttr(acts, attrId));
  }
  return ops;
}

const BROADCAST_STATUS: Record<string, string> = {
  draft: "下書き", scheduled: "予約", sending: "送信中", sent: "送信済み", canceled: "取消",
};
const FORM_STATUS: Record<string, string> = {
  draft: "下書き", published: "公開中", closed: "終了", archived: "アーカイブ",
};

/**
 * 指定した属性が「どこで付与／解除されるか」を横断で集める。
 *   同一の実体（配信・シナリオ・フォーム）で同じ操作が複数あっても1件にまとめる。
 */
export async function loadAttrUsage(attrId: number): Promise<AttrUsageItem[]> {
  const out: AttrUsageItem[] = [];
  const push = (it: AttrUsageItem) => out.push(it);

  const [bc, steps, scen, forms, secs, fields, srcs] = await Promise.all([
    supabase.from("broadcasts").select("id, title, status, link_actions"),
    supabase.from("scenario_steps").select("id, scenario_id, sort_order, link_actions"),
    supabase.from("scenarios").select("id, name"),
    supabase.from("forms").select("id, title, name, status, after_actions"),
    supabase.from("form_sections").select("id, form_id"),
    supabase.from("form_fields").select("id, section_id, label, options"),
    supabase.from("sources").select("id, label, actions"),
  ]);

  // ── 一斉配信（クリック時）──
  for (const b of bc.data ?? []) {
    const ops = new Set(opsInLinkMap(b.link_actions, attrId));
    for (const op of ops) {
      push({
        kind: "broadcast", id: b.id, title: b.title || "（無題の配信）",
        op, where: "クリック時", detail: BROADCAST_STATUS[b.status] ?? b.status ?? undefined,
        href: `/ops/broadcast/${b.id}`,
      });
    }
  }

  // ── シナリオ配信（ステップのクリック時）──
  const scName = new Map((scen.data ?? []).map((s) => [s.id, s.name]));
  // シナリオ×操作 で重複排除しつつ、該当ステップ番号を集約
  const scAgg = new Map<string, { scId: number; op: "add" | "remove"; steps: number[] }>();
  for (const st of steps.data ?? []) {
    const ops = new Set(opsInLinkMap(st.link_actions, attrId));
    for (const op of ops) {
      const key = `${st.scenario_id}:${op}`;
      const agg = scAgg.get(key) ?? { scId: st.scenario_id, op, steps: [] };
      agg.steps.push((st.sort_order ?? 0) + 1);
      scAgg.set(key, agg);
    }
  }
  for (const agg of scAgg.values()) {
    agg.steps.sort((a, b) => a - b);
    push({
      kind: "scenario", id: agg.scId, title: scName.get(agg.scId) || "（無題のシナリオ）",
      op: agg.op, where: "クリック時", detail: "STEP " + agg.steps.join(", "),
      href: `/ops/scenario/${agg.scId}`,
    });
  }

  // ── フォーム（回答後 / 選択時）──
  const secToForm = new Map((secs.data ?? []).map((s) => [s.id, s.form_id]));
  const formTitle = new Map((forms.data ?? []).map((f) => [f.id, f.title || f.name || "（無題のフォーム）"]));
  const formStatus = new Map((forms.data ?? []).map((f) => [f.id, f.status]));
  // 回答後アクション
  for (const f of forms.data ?? []) {
    const ops = new Set(opsForAttr(f.after_actions, attrId));
    for (const op of ops) {
      push({
        kind: "form", id: f.id, title: f.title || f.name || "（無題のフォーム）",
        op, where: "回答後", detail: FORM_STATUS[f.status] ?? f.status ?? undefined,
        href: `/ops/form/${f.id}`,
      });
    }
  }
  // 選択肢アクション（フォーム×操作 で重複排除）
  const optAgg = new Map<string, { formId: number; op: "add" | "remove" }>();
  for (const fld of fields.data ?? []) {
    const opts = fld.options;
    if (!Array.isArray(opts)) continue;
    const formId = secToForm.get(fld.section_id);
    if (formId == null) continue;
    for (const o of opts as { actions?: unknown }[]) {
      for (const op of new Set(opsForAttr(o?.actions, attrId))) {
        optAgg.set(`${formId}:${op}`, { formId, op });
      }
    }
  }
  for (const a of optAgg.values()) {
    // 回答後で既に同じフォーム×操作を出していれば、選択時は補足に留めず別行で示す
    push({
      kind: "form", id: a.formId, title: formTitle.get(a.formId) || "（無題のフォーム）",
      op: a.op, where: "選択肢の選択時", detail: FORM_STATUS[formStatus.get(a.formId) ?? ""] ?? undefined,
      href: `/ops/form/${a.formId}`,
    });
  }

  // ── 流入経路（流入時）──
  for (const s of srcs.data ?? []) {
    for (const op of new Set(opsForAttr((s as { actions?: unknown }).actions, attrId))) {
      push({
        kind: "source", id: s.id, title: s.label || "（無名の流入経路）",
        op, where: "流入時",
      });
    }
  }

  return out;
}
