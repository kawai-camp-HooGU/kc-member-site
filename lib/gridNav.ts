import type { KeyboardEvent } from "react";

// ガントのグリッドセル列順（矢印キー移動：重要度→タスク名→メンバー→ステータス→開始→終了）
export const GRID_NAV_COLS = ["importance", "taskName", "assignees", "status", "start", "end"];

// 矢印キーでグリッドセル間を移動。移動したら true。
export function gridCellNav(
  e: KeyboardEvent<HTMLElement>,
  rowId: number | string,
  col: string
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return false;
  const k = e.key;
  if (k !== "ArrowUp" && k !== "ArrowDown" && k !== "ArrowLeft" && k !== "ArrowRight") return false;
  let target: Element | null = null;
  if (k === "ArrowUp" || k === "ArrowDown") {
    const list = Array.from(document.querySelectorAll(`[data-gcol="${col}"]`));
    const idx = list.indexOf(e.currentTarget);
    if (idx !== -1) target = list[idx + (k === "ArrowDown" ? 1 : -1)] ?? null;
  } else {
    const step = k === "ArrowRight" ? 1 : -1;
    for (let j = GRID_NAV_COLS.indexOf(col) + step; j >= 0 && j < GRID_NAV_COLS.length; j += step) {
      const cand = document.querySelector(`[data-grow="${rowId}"][data-gcol="${GRID_NAV_COLS[j]}"]`);
      if (cand) { target = cand; break; }
    }
  }
  if (target) { e.preventDefault(); (target as HTMLElement).focus(); return true; }
  return false;
}
