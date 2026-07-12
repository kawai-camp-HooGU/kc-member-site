// ============================================================
// 属性マスタ（属性A ＞ 属性B ＞ 属性C の親子カスケード階層）
//   設定「属性」タブで編集。自己参照ツリー（最大3階層 level 0..2）。
//   role_permissions と同じく self-contained なデータ層として提供する。
// ============================================================
import { supabase } from "./supabase";
import type { Tables, TablesInsert } from "./database.types";

/** 階層の深さ（属性A/B/C の3段） */
export const MAX_LEVEL = 2;
export const LEVEL_KEYS = ["A", "B", "C"] as const;
export const DEFAULT_LEVEL_NAMES = ["大分類", "中分類", "小分類"];
export const DEFAULT_COLOR = "#6B7280";

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
    supabase.from("member_attributes").select("member_id, attribute_id"),
    supabase.from("members_visible").select("id").eq("is_deleted", false),
  ]);
  const alive = new Set((members ?? []).map((m) => m.id));
  return (links ?? [])
    .filter((l) => alive.has(l.member_id))
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
