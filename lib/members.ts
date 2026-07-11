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

export type SortKey = "createdAt" | "name" | "lastLogin" | "progress";
export const SORT_KEY_LABEL: Record<SortKey, string> = {
  createdAt: "登録日時", name: "氏名", lastLogin: "最終ログイン", progress: "視聴率",
};

// 最終ログインのフィルタ
export type LoginFilter = "all" | "never" | "idle7" | "idle30" | "active7";
export const LOGIN_FILTER_OPTIONS: { value: LoginFilter; label: string }[] = [
  { value: "all",     label: "指定なし" },
  { value: "active7", label: "7日以内にログイン" },
  { value: "idle7",   label: "7日以上ログインなし" },
  { value: "idle30",  label: "30日以上ログインなし" },
  { value: "never",   label: "一度もログインしていない" },
];

// コンテンツ視聴の進捗フィルタ
export type ProgressFilter = "all" | "none" | "partial" | "done";
export const PROGRESS_FILTER_OPTIONS: { value: ProgressFilter; label: string }[] = [
  { value: "all",     label: "指定なし" },
  { value: "none",    label: "未着手（0%）" },
  { value: "partial", label: "視聴途中（1〜99%）" },
  { value: "done",    label: "すべて視聴済み（100%）" },
];

// 通知（Web Push）の状態フィルタ
export type NotifyFilter = "all" | "registered" | "unregistered" | "off";
export const NOTIFY_FILTER_OPTIONS: { value: NotifyFilter; label: string }[] = [
  { value: "all",          label: "指定なし" },
  { value: "registered",   label: "通知登録済みのみ" },
  { value: "unregistered", label: "通知未登録のみ" },
  { value: "off",          label: "通知OFFのみ" },
];

export interface MemberFilter {
  keyword: string; tags: number[]; attrMode: AttrMode; unlinkedOnly: boolean;
  notify: NotifyFilter; login: LoginFilter; progress: ProgressFilter;
}
export interface MemberSort { key: SortKey; dir: "asc" | "desc"; }
export const DEFAULT_FILTER: MemberFilter = {
  keyword: "", tags: [], attrMode: "any", unlinkedOnly: false, notify: "all", login: "all", progress: "all",
};
/** コンテンツ視聴の進捗（lib/engagement の Progress と構造互換） */
export interface MemberProgressLike { total: number; viewed: number; pct: number; }
export type ProgressMap = Map<number, MemberProgressLike>;
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

// ── 通知状態 ──
export type NotifyState = "registered" | "unregistered" | "off";
/**
 * メンバーの通知状態を判定する。
 *  - unregistered: 端末が1台も登録されていない（プッシュを受け取れない）
 *  - off:          端末は登録済みだが、本人が通知をOFFにしている
 *  - registered:   端末登録済み かつ 通知ON
 */
export function notifyState(m: Member): NotifyState {
  const devices = m.pushDevices ?? 0;
  if (devices === 0) return "unregistered";
  if (m.notifyEnabled === false) return "off";
  return "registered";
}
export const NOTIFY_STATE_LABEL: Record<NotifyState, string> = {
  registered: "登録済", unregistered: "未登録", off: "通知OFF",
};

// ── ログイン経過日数（未ログインは null）──
export function loginDays(m: Member): number | null {
  const t = m.lastLoginAt ? Date.parse(m.lastLoginAt) : NaN;
  return isNaN(t) ? null : Math.floor((Date.now() - t) / 86400000);
}
function matchLogin(m: Member, f: LoginFilter): boolean {
  const d = loginDays(m);
  switch (f) {
    case "never":   return d === null;
    case "active7": return d !== null && d < 7;
    case "idle7":   return d === null || d >= 7;
    case "idle30":  return d === null || d >= 30;
    default:        return true;
  }
}
function matchProgress(m: Member, f: ProgressFilter, pm: ProgressMap | undefined): boolean {
  if (f === "all") return true;
  const p = pm?.get(m.id);
  if (!p) return f === "none";
  if (f === "none")    return p.viewed === 0;
  if (f === "done")    return p.total > 0 && p.viewed >= p.total;
  /* partial */        return p.viewed > 0 && p.viewed < p.total;
}

// ── 抽出・並び替え ──
export function filterMembers(members: Member[], f: MemberFilter, index: AttrIndex, progress?: ProgressMap): Member[] {
  let rows = members.filter((m) => !m.isDeleted);
  const q = f.keyword.trim().toLowerCase();
  if (q) rows = rows.filter((m) =>
    (m.name + " " + (m.kana ?? "") + " " + m.email + " " + (m.memos ?? []).map((mo) => mo.title).join(" "))
      .toLowerCase().includes(q));
  if (f.unlinkedOnly) rows = rows.filter((m) => !m.userId);
  if (f.notify !== "all") rows = rows.filter((m) => notifyState(m) === f.notify);
  if (f.login !== "all") rows = rows.filter((m) => matchLogin(m, f.login));
  if (f.progress !== "all") rows = rows.filter((m) => matchProgress(m, f.progress, progress));
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

export function sortMembers(rows: Member[], s: MemberSort, progress?: ProgressMap): Member[] {
  const arr = [...rows];
  if (s.key === "progress") {
    arr.sort((x, y) => {
      const c = (progress?.get(x.id)?.pct ?? 0) - (progress?.get(y.id)?.pct ?? 0);
      return s.dir === "asc" ? c : -c;
    });
    return arr;
  }
  arr.sort((x, y) => {
    const pick = (m: Member) =>
      s.key === "name"      ? (m.kana || m.name) :
      s.key === "lastLogin" ? (m.lastLoginAt || "") :   // 未ログインは空＝昇順で先頭
                              (m.createdAt || "");
    const c = String(pick(x)).localeCompare(String(pick(y)), "ja");
    return s.dir === "asc" ? c : -c;
  });
  return arr;
}

export function activeFilterCount(f: MemberFilter, s: MemberSort): number {
  let n = 0;
  if (f.keyword.trim()) n++;
  if (f.tags.length) n++;
  if (f.unlinkedOnly) n++;
  if (f.notify !== "all") n++;
  if (f.login !== "all") n++;
  if (f.progress !== "all") n++;
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
