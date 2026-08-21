"use client";
// ============================================================
// 運営ダッシュボードの KPI カード（REQ-027）
//   左上の一等地に並ぶ5枚。増やすと1枚も読まれなくなるので5枚で固定する。
//   ⚠️ 配色は lib/constants.ts の KPI_TONE を通す（brand.md §7）。
// ============================================================
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import { KPI_TONE } from "../../lib/constants";
import type { KpiTone } from "../../lib/constants";

export interface KpiCardProps {
  icon: IconName;
  label: string;
  /** 主数値。読み込み中は "…" を渡す（レイアウトを動かさないため） */
  value: string;
  /** 数値のあとの単位（件・人など） */
  unit?: string;
  /** 補足1行 */
  note?: string;
  tone?: KpiTone;
  /** 押せるとき。省略時はカーソルを変えず、押せそうに見せない */
  onClick?: () => void;
  onHover?: () => void;
}

export function KpiCard({ icon, label, value, unit, note, tone = "plain", onClick, onHover }: KpiCardProps) {
  const t = KPI_TONE[tone];
  const body = (
    <>
      <span className={`flex items-center gap-1.5 text-[10.5px] font-bold tracking-wide ${t.label}`}>
        <Icon name={icon} size={13} />
        {label}
      </span>
      <span className={`block mt-0.5 text-[26px] font-extrabold leading-tight tabular-nums ${t.value}`}>
        {value}
        {unit && <span className="ml-0.5 text-[11px] font-bold text-gray-400">{unit}</span>}
      </span>
      {note && <span className="block mt-0.5 text-[10.5px] text-gray-400">{note}</span>}
    </>
  );

  if (!onClick) {
    return <div className={`relative rounded-xl border px-3.5 py-2.5 ${t.card}`}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onHover}
      className={`relative rounded-xl border px-3.5 py-2.5 text-left transition-shadow hover:shadow-sm ${t.card}`}
    >
      {body}
      <span className="absolute right-2.5 top-2.5 text-gray-300">›</span>
    </button>
  );
}
