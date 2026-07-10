// ============================================================
// メンバーマスタ用ヘルパー（抽出条件・並び替え・属性パス・保存）
// ============================================================
import { supabase } from "./supabase";
import type { Member, MemberMemo } from "./models";
import type { AttrNode } from "./attributes";

// 都道府県
export const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県","茨城県","栃木県","群馬県",
  "埼玉県","千葉県","東京都","神奈川県","新潟県","富山県","石川県","福井県","山梨県","長野県",
  "岐阜県","静岡県","愛知県","三重県","滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県","福岡県",
  "佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

// 属性抽出モード
export type AttrMode = "any" | "all" | "exany" | "exall";
export const ATTR_MODE_LABEL: Record<AttrMode, string> = {
  any: "いずれか含む", all: "すべて含む", exany: "いずれか含むを除外", exall: "すべて含むを除外",
};
export const ATTR_MODE_OPTIONS: { value: AttrMode; label: string }[] = [
  { value: "any",   label: "選択したタグをいずれか1つ以上含む" },
  { value: "all",   label: "選択したタグをすべて含む" },
  { value: "exany", label: "いずれか1つ以上含む人を除外" },
  { value: "exall", label: "すべて含む人を除外" },
];

export type SortKey = "createdAt" | "name";
export interface MemberFilter { keyword: string; tags: number[]; attrMode: AttrMode; unlinkedOnly: boolean; }
export interface MemberSort { key: SortKey; dir: "asc" | "desc"; }
export const DEFAULT_FILTER: MemberFilter = { keyword: "", tags: [], attrMode: "any", unlinkedOnly: false };
export const DEFAULT_SORT: MemberSort = { key: "createdAt", dir: "asc" };
export const isDefaultSort = (s: MemberSort) => s.key === "createdAt" && s.dir === "asc";

// ── 属性インデックス（ツリー → パス／祖先集合）──
export interface AttrSeg { id: number; name: string; color: string; }
export interface AttrIndex {
  segsById: Map<number, AttrSeg[]>;       // ルート→当該ノードのパス
  ancestors: Map<number, Set<number>>;    // 当該ノードの祖先ID（自身を含む）
}
export function buildAttrIndex(tree: AttrNode[]): AttrIndex {
  const segsById = new Map<number, AttrSeg[]>();
  const ancestors = new Map<number, Set<number>>();
  const walk = (node: AttrNode, path: AttrSeg[]) => {
    const newPath = [...path, { id: node.id, name: node.name, color: node.color }];
    segsById.set(node.id, newPath);
    ancestors.set(node.id, new Set(newPath.map((s) => s.id)));
    node.children.forEach((c) => walk(c, newPath));
  };
  tree.forEach((n) => walk(n, []));
  return { segsById, ancestors };
}
export const attrSegs  = (index: AttrIndex, id: number): AttrSeg[] => index.segsById.get(id) ?? [];
export const attrLabel = (index: AttrIndex, id: number): string => attrSegs(index, id).map((s) => s.name).join(" › ");

// メンバー m がタグ（属性ノードID）t を含むか（末端が t、または t の配下）
function memberHasTag(m: Member, t: number, index: AttrIndex): boolean {
  return (m.attrIds ?? []).some((aid) => index.ancestors.get(aid)?.has(t));
}

// ── 抽出・並び替え ──
export function filterMembers(members: Member[], f: MemberFilter, index: AttrIndex): Member[] {
  let rows = members.filter((m) => !m.isDeleted);
  const q = f.keyword.trim().toLowerCase();
  if (q) rows = rows.filter((m) =>
    (m.name + " " + (m.kana ?? "") + " " + m.email + " " + (m.memos ?? []).map((mo) => mo.title).join(" "))
      .toLowerCase().includes(q));
  if (f.unlinkedOnly) rows = rows.filter((m) => !m.userId);
  if (f.tags.length) {
    rows = rows.filter((m) => {
      const some  = f.tags.some((t) => memberHasTag(m, t, index));
      const every = f.tags.every((t) => memberHasTag(m, t, index));
      switch (f.attrMode) {
        case "any":   return some;
        case "all":   return every;
        case "exany": return !some;
        case "exall": return !every;
        default:      return true;
      }
    });
  }
  return rows;
}

export function sortMembers(rows: Member[], s: MemberSort): Member[] {
  const arr = [...rows];
  arr.sort((x, y) => {
    const kx = s.key === "name" ? (x.kana || x.name) : (x.createdAt || "");
    const ky = s.key === "name" ? (y.kana || y.name) : (y.createdAt || "");
    const c = String(kx).localeCompare(String(ky), "ja");
    return s.dir === "asc" ? c : -c;
  });
  return arr;
}

export function activeFilterCount(f: MemberFilter, s: MemberSort): number {
  let n = 0;
  if (f.keyword.trim()) n++;
  if (f.tags.length) n++;
  if (f.unlinkedOnly) n++;
  if (!isDefaultSort(s)) n++;
  return n;
}

// ── 保存（属性・メモは全消し→再挿入のシンプル方式）──
export async function saveMemberExtras(memberId: number, attrIds: number[], memos: MemberMemo[]): Promise<void> {
  await supabase.from("member_attributes").delete().eq("member_id", memberId);
  if (attrIds.length) {
    await supabase.from("member_attributes").insert(attrIds.map((id) => ({ member_id: memberId, attribute_id: id })));
  }
  await supabase.from("member_memos").delete().eq("member_id", memberId);
  if (memos.length) {
    await supabase.from("member_memos").insert(memos.map((mo, i) => ({
      member_id: memberId, title: mo.title, body: mo.body, sort_order: i,
      updated_at: mo.updatedAt || new Date().toISOString(),
    })));
  }
}
