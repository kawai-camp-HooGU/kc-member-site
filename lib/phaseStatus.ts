// ============================================================
// フェーズ進捗ステータスの解決ロジック
//
//   選択肢は「その区分専用 ＋ 共通」。区分なしのプロジェクトは共通のみ。
//   フェーズ管理画面・ガントのフェーズ帯・フェーズ編集フォームが
//   同じ並び／同じ既定を出すよう、判定はこの1ファイルに集約する。
//
//   ⚠️ status_id が null のフェーズは「未設定」。画面では既定ステータスの
//      見た目で出すが、DB は null のまま（既定を変えたら全フェーズが追従する）。
// ============================================================
import type { Anken, PhaseStatus, Project, ProjectCategory } from "./models";
import { PHASE_STATUS_COLOR_DEFAULT } from "./constants";

/** 未設定フェーズの表示に使うフォールバック（既定ステータスも無い場合） */
export const PHASE_STATUS_UNSET: Pick<PhaseStatus, "name" | "color" | "isDone"> = {
  name:  "未設定",
  color: PHASE_STATUS_COLOR_DEFAULT,
  isDone: false,
};

/** 有効な行だけを並び順で返す */
const active = (list: PhaseStatus[]): PhaseStatus[] =>
  list.filter((s) => !s.isDeleted).sort((a, b) => (a.sortOrder - b.sortOrder) || (a.id - b.id));

/**
 * その区分で選べるステータス（区分専用 → 共通 の順）。
 * @param categoryId null なら共通のみ
 */
export function statusOptions(all: PhaseStatus[], categoryId: number | null): PhaseStatus[] {
  const rows = active(all);
  const own  = categoryId == null ? [] : rows.filter((s) => s.scope === "category" && s.categoryId === categoryId);
  const common = rows.filter((s) => s.scope === "common");
  return [...own, ...common];
}

/** そのスコープの既定ステータス（区分専用が優先。無ければ共通の既定 → 先頭） */
export function defaultStatus(all: PhaseStatus[], categoryId: number | null): PhaseStatus | null {
  const opts = statusOptions(all, categoryId);
  return opts.find((s) => s.isDefault) ?? opts[0] ?? null;
}

/**
 * フェーズに表示するステータス。
 *   statusId が立っていればそれを、無ければ既定を返す。
 *   ⚠️ 削除済みステータスを指している場合も既定へ倒す（画面が空にならないように）。
 */
export function resolveStatus(
  all: PhaseStatus[],
  statusId: number | null,
  categoryId: number | null,
): PhaseStatus | null {
  if (statusId != null) {
    const hit = all.find((s) => s.id === statusId && !s.isDeleted);
    if (hit) return hit;
  }
  return defaultStatus(all, categoryId);
}

/** 表示用（null 安全）。チップの文言と色をここで確定させる */
export function statusView(st: PhaseStatus | null): { name: string; color: string; isDone: boolean } {
  return st
    ? { name: st.name, color: st.color, isDone: st.isDone }
    : { ...PHASE_STATUS_UNSET };
}

/** そのフェーズが「完了扱い」か（フェーズ一覧の除外・ガントの完了フィルタで使う） */
export function isPhaseDone(
  all: PhaseStatus[],
  anken: Pick<Anken, "statusId">,
  categoryId: number | null,
): boolean {
  return resolveStatus(all, anken.statusId, categoryId)?.isDone ?? false;
}

/** projectId → その PJ の区分ID を引くマップを作る */
export function categoryIdByProject(projects: Project[]): Map<number, number | null> {
  return new Map(projects.map((p) => [p.id, p.categoryId ?? null]));
}

/** 区分ID → 区分 を引くマップ（色・名前の表示用） */
export function categoryById(categories: ProjectCategory[]): Map<number, ProjectCategory> {
  return new Map(categories.filter((c) => !c.isDeleted).map((c) => [c.id, c]));
}
