"use client";
import { useState, useEffect, useRef } from "react";
import type { ReactNode, CSSProperties } from "react";
import { IMPORTANCE_CONFIG, PROJECT_BADGE_STYLES, PROJECT_BAR_COLORS, projectBadge } from "../../lib/constants";

const PROJECT_COLOR_NAMES = ["青", "スカイ", "シアン", "ティール", "藍", "紺"];

export type ColorRuleVariant = "gantt" | "kanban" | "calendar";

// 色ルール早見表ポップオーバー（🎨ボタン）
export function ColorRulePopover({ variant = "gantt" }: { variant?: ColorRuleVariant }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const isKanban = variant === "kanban";
  const isCal = variant === "calendar";

  const Row = ({ sample, desc }: { sample: ReactNode; desc: ReactNode }) => (
    <div className="grid items-center gap-3 px-2 py-1.5 border-b border-gray-100"
      style={{ gridTemplateColumns: isKanban ? "200px 1fr" : isCal ? "190px 1fr" : "152px 1fr" }}>
      <div className="overflow-hidden">{sample}</div>
      <div className="text-xs text-gray-600 leading-snug">{desc}</div>
    </div>
  );
  const Sec = ({ children }: { children: ReactNode }) => (
    <div className="text-[10px] font-semibold text-gray-400 px-2 pt-2.5 pb-1">{children}</div>
  );

  interface KCardProps {
    chipCls?: string; chipText?: string; name: string; nameCls?: string;
    label?: string; labelCls?: string; date?: string; style?: CSSProperties; cardCls?: string;
  }
  const KCard = ({ chipCls, chipText, name, nameCls, label, labelCls, date, style, cardCls = "border-gray-200 shadow-sm" }: KCardProps) => (
    <span className={`block rounded-lg border p-1.5 ${cardCls}`} style={style}>
      <span className="flex flex-wrap gap-1 items-center mb-1">
        {chipText && <span className={`text-[8.5px] font-bold rounded-full px-1.5 py-0.5 ${chipCls}`}>{chipText}</span>}
        <span className={`text-[8.5px] font-bold rounded-full px-1.5 py-0.5 border ${projectBadge(1)}`}>プロジェクト名</span>
      </span>
      <span className={`block text-[11.5px] ${nameCls}`}>
        {label && <span className={`inline-block text-[8px] font-bold text-white rounded px-1 mr-1 ${labelCls}`}>{label}</span>}
        {name}
      </span>
      {date && <span className="block text-[9px] text-gray-400 mt-0.5">{date}</span>}
    </span>
  );

  interface CBarProps {
    color: string; pill?: string; pillCls?: string; dl?: string; dlCls?: string; name: string; strike?: boolean;
  }
  const CBar = ({ color, pill, pillCls, dl, dlCls, name, strike }: CBarProps) => (
    <span className={`flex items-center gap-0.5 rounded text-white text-[10px] px-1 overflow-hidden ${color}`} style={{ height: 18 }}>
      {pill && <span className={`shrink-0 font-bold rounded px-1 ${pillCls}`} style={{ fontSize: "8.5px" }}>{pill}</span>}
      {dl && <span className={`shrink-0 font-bold rounded px-1 text-white ${dlCls}`} style={{ fontSize: "8.5px" }}>{dl}</span>}
      <span className={`truncate ${strike ? "line-through" : ""}`}>{name}</span>
    </span>
  );

  interface DayCellProps { num: string; today?: boolean; due?: boolean; cp?: boolean; }
  const DayCell = ({ num, today, due, cp }: DayCellProps) => (
    <span className="inline-block relative border border-gray-100 rounded"
      style={{ width: 40, height: 34, ...(due ? { background: "#fef2f2", boxShadow: "inset 0 0 0 2px #ef4444" } : cp ? { background: "#faf5ff", boxShadow: "inset 0 0 0 2px #7c3aed" } : {}) }}>
      {today
        ? <span className="absolute left-1 top-1 bg-red-500 text-white rounded-full inline-flex items-center justify-center" style={{ width: 16, height: 16, fontSize: 9 }}>{num}</span>
        : <span className="absolute left-1 top-0.5 text-[10px] text-gray-500">{num}</span>}
      {due && <span className="absolute right-0.5 top-0.5 text-[7px] text-white bg-red-500 rounded px-0.5">🚩期限</span>}
      {cp && <span className="absolute right-0.5 top-0.5 text-[7px] text-white bg-violet-600 rounded px-0.5">①</span>}
    </span>
  );

  const overlapNote = (
    <div className="mx-2 mt-2.5 mb-1 p-2 rounded-lg border border-gray-100 bg-gray-50 text-[11px] text-gray-600 leading-relaxed">
      重なった時の背景優先：完了 ＞ 期限超過 ＞ 今週期限 ＞ 重要度Ⅲ ＞ 通常／文字色は重要度を優先。
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border transition-colors ${
          open ? "border-red-400 bg-blue-50 text-red-600" : "border-gray-300 bg-white text-gray-600 hover:border-red-400"
        }`}>
        🎨 色ルール <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className={`absolute left-0 top-full mt-1 z-40 ${isKanban ? "w-[500px]" : isCal ? "w-[480px]" : "w-[460px]"} max-w-[92vw] max-h-[75vh] overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-lg`}>
          <div className="sticky top-0 flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-white">
            <span className="text-sm font-semibold text-gray-800">色ルール早見表</span>
            <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-600 text-sm leading-none">✕</button>
          </div>
          <div className="pb-2">
            <Sec>プロジェクト色（{isCal ? "バー" : isKanban ? "ラベル" : "ラベル／バー"}）</Sec>
            <div className="text-[11px] text-gray-500 px-2 pb-1.5 leading-relaxed">
              {isCal
                ? "バーの色はプロジェクトごとに6色を順番に割り当て（7件目以降は循環）。完了タスクのバーはグレー。"
                : isKanban
                ? "プロジェクトごとに6色を順番に割り当て（7件目以降は循環）。カード上部のラベルで識別。"
                : "プロジェクトごとに6色を順番に割り当て（7件目以降は循環）。上＝ラベル、下＝ガントバー。完了タスクのバーはグレー。"}
            </div>
            <div className="flex gap-1.5 px-2 pb-2">
              {PROJECT_BADGE_STYLES.map((badge, i) => (
                <div key={i} className="flex-1 text-center">
                  {isCal ? (
                    <div className={`h-2.5 rounded mb-0.5 ${PROJECT_BAR_COLORS[i]}`} />
                  ) : (
                    <>
                      <span className={`block text-[9px] ${isKanban ? "rounded-full" : "rounded"} border py-0.5 mb-0.5 ${badge}`}>PJ</span>
                      {!isKanban && <div className={`h-2 rounded-sm mb-0.5 ${PROJECT_BAR_COLORS[i]}`} />}
                    </>
                  )}
                  <div className="text-[9px] text-gray-400">{PROJECT_COLOR_NAMES[i]}</div>
                </div>
              ))}
            </div>

            {isCal ? (
              <>
                <Sec>重要度（バー先頭ラベル）</Sec>
                <Row desc="重要度Ⅲ：濃い赤ラベル" sample={<CBar color="bg-red-600" pill="Ⅲ" pillCls={IMPORTANCE_CONFIG[3].solid} name="サンプルタスク" />} />
                <Row desc="重要度Ⅱ：赤ラベル" sample={<CBar color="bg-neutral-800" pill="Ⅱ" pillCls={IMPORTANCE_CONFIG[2].solid} name="サンプルタスク" />} />
                <Row desc="重要度Ⅰ：薄赤ラベル" sample={<CBar color="bg-red-800" pill="Ⅰ" pillCls={IMPORTANCE_CONFIG[1].solid} name="サンプルタスク" />} />
                <Row desc="重要度なし：ラベルなし" sample={<CBar color="bg-neutral-500" name="サンプルタスク" />} />
                <Sec>期限の状態（バー先頭ラベル）</Sec>
                <Row desc="期限超過：赤「超過」ラベル" sample={<CBar color="bg-red-900" dl="超過" dlCls="bg-red-600" name="サンプルタスク" />} />
                <Row desc="今週期限（7日以内）：オレンジ「今週」ラベル" sample={<CBar color="bg-rose-500" dl="今週" dlCls="bg-orange-500" name="サンプルタスク" />} />
                <Row desc="重なる場合：重要度→期限の順にラベルを並べて表示" sample={<CBar color="bg-red-600" pill="Ⅲ" pillCls={IMPORTANCE_CONFIG[3].solid} dl="超過" dlCls="bg-red-600" name="サンプルタスク" />} />
                <Sec>完了</Sec>
                <Row desc="完了：グレーのバー＋取り消し線" sample={<CBar color="bg-gray-400" name="サンプルタスク" strike />} />
                <Sec>日付セルの強調（単一プロジェクト表示時）</Sec>
                <Row desc="今日：日付を赤丸で表示" sample={<DayCell num="12" today />} />
                <Row desc="期限日：赤枠＋薄赤背景＋「🚩 期限」" sample={<DayCell num="18" due />} />
                <Row desc="チェックポイント：紫枠＋薄紫背景＋ラベル（①〜③）" sample={<DayCell num="22" cp />} />
              </>
            ) : isKanban ? (
              <>
                <Sec>重要度（カード色・文字色）</Sec>
                <Row desc="重要度Ⅲ：赤の太字＋薄い赤背景" sample={
                  <KCard chipCls={IMPORTANCE_CONFIG[3].chip} chipText="重要度Ⅲ" name="サンプルタスク" nameCls="font-bold text-red-600" style={{ background: "#fff0f0" }} />} />
                <Row desc="重要度Ⅱ：赤字" sample={
                  <KCard chipCls={IMPORTANCE_CONFIG[2].chip} chipText="重要度Ⅱ" name="サンプルタスク" nameCls="font-medium text-red-500" />} />
                <Row desc="重要度Ⅰ：薄い赤字" sample={
                  <KCard chipCls={IMPORTANCE_CONFIG[1].chip} chipText="重要度Ⅰ" name="サンプルタスク" nameCls="font-medium text-red-300" />} />
                <Row desc="重要度なし：ラベル表示なし（重要度チップは付きません）" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-800" />} />
                <Sec>期限の状態（カード背景＋ラベル）</Sec>
                <Row desc="期限超過：赤の斜線＋左赤ライン＋「超過」" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-800" label="超過" labelCls="bg-red-600" date="〜YYYY-MM-DD"
                    cardCls="border-gray-200 shadow-sm"
                    style={{ borderLeft: "4px solid #dc2626", background: "repeating-linear-gradient(45deg,#fde4e4,#fde4e4 7px,#f7cccc 7px,#f7cccc 14px)" }} />} />
                <Row desc="今週期限：薄オレンジ＋左ライン＋「今週期限」" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-800" label="今週期限" labelCls="bg-orange-500" date="〜YYYY-MM-DD"
                    cardCls="border-gray-200 shadow-sm" style={{ borderLeft: "4px solid #f97316", background: "#ffe8cc" }} />} />
                <Row desc="完了：薄グレー＋取り消し線（完了列へ移動）" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-400 line-through" style={{ background: "#edeef0" }} />} />
                <Row desc="日付なし：背景は通常＋「日付なし」" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-800" label="日付なし" labelCls="bg-gray-400" />} />
                <Sec>ドラッグで移動した直後</Sec>
                <Row desc="ドラッグ＆ドロップでステータスを変更すると、移動したカードが青い枠＋青いリングで一時的に強調され、移動先がひと目で分かります。" sample={
                  <KCard name="サンプルタスク" nameCls="font-medium text-gray-800" cardCls="border-red-400 ring-2 ring-red-400 ring-offset-1 shadow-lg" />} />
                {overlapNote}
              </>
            ) : (
              <>
                <Sec>重要度（文字色）</Sec>
                <Row desc="重要度Ⅲ：赤の太字＋薄い赤背景" sample={
                  <span className="text-xs rounded px-1.5 py-0.5 inline-flex items-center" style={{ background: "#fff0f0" }}>
                    <span className="text-[10px] font-bold rounded-full px-1.5 mr-1 bg-red-600 text-white">Ⅲ</span>
                    <b className="text-red-600">サンプルタスク</b>
                  </span>} />
                <Row desc="重要度Ⅱ：赤字" sample={
                  <span className="text-xs inline-flex items-center">
                    <span className="text-[10px] font-bold rounded-full px-1.5 mr-1" style={{ background: "#fca5a5", color: "#7f1d1d" }}>Ⅱ</span>
                    <span className="text-red-500">サンプルタスク</span>
                  </span>} />
                <Row desc="重要度Ⅰ：薄い赤字" sample={
                  <span className="text-xs inline-flex items-center">
                    <span className="text-[10px] font-bold rounded-full px-1.5 mr-1" style={{ background: "#fef2f2", color: "#b91c1c" }}>Ⅰ</span>
                    <span style={{ color: "#fca5a5" }}>サンプルタスク</span>
                  </span>} />
                <Sec>期限の状態（背景＋ラベル）</Sec>
                <Row desc="期限超過：赤の斜線＋左赤ライン＋「超過」" sample={
                  <span className="text-xs rounded px-1.5 py-0.5 inline-flex items-center"
                    style={{ borderLeft: "3px solid #dc2626", background: "repeating-linear-gradient(45deg,#fde4e4,#fde4e4 5px,#f7cccc 5px,#f7cccc 10px)" }}>
                    <span className="text-[9px] font-bold text-white rounded px-1 mr-1 bg-red-600">超過</span>サンプルタスク
                  </span>} />
                <Row desc="今週期限：薄オレンジ＋左ライン＋「今週期限」" sample={
                  <span className="text-xs rounded px-1.5 py-0.5 inline-flex items-center" style={{ borderLeft: "3px solid #f97316", background: "#ffe8cc" }}>
                    <span className="text-[9px] font-bold text-white rounded px-1 mr-1" style={{ background: "#f97316" }}>今週期限</span>サンプルタスク
                  </span>} />
                <Row desc="完了：薄グレー＋取り消し線" sample={
                  <span className="text-xs rounded px-1.5 py-0.5 inline-block" style={{ background: "#edeef0", color: "#9ca3af", textDecoration: "line-through" }}>サンプルタスク</span>} />
                <Row desc="日付なし：背景なし＋「日付なし」" sample={
                  <span className="text-xs inline-flex items-center">
                    <span className="text-[9px] font-bold text-white rounded px-1 mr-1" style={{ background: "#94a3b8" }}>日付なし</span>サンプルタスク
                  </span>} />
                {overlapNote}
                <Sec>縦のライン</Sec>
                <Row desc="今日：赤の実線で今日の位置を表示" sample={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-4" style={{ borderLeft: "2px solid #ef4444" }} />
                    <span className="text-[9px] text-white rounded px-1" style={{ background: "#ef4444" }}>今日</span>
                  </span>} />
                <Row desc="チェックポイント：紫の破線（①〜③）※単一PJ表示時" sample={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-4" style={{ borderLeft: "2px dashed #7c3aed" }} />
                    <span className="text-[9px] text-white rounded px-1" style={{ background: "#7c3aed" }}>① チェックポイント</span>
                  </span>} />
                <Row desc="期限日：赤の点線 ※単一PJ表示時" sample={
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-4" style={{ borderLeft: "2px dotted #ef4444" }} />
                    <span className="text-[9px] text-white rounded px-1" style={{ background: "#ef4444" }}>期限</span>
                  </span>} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
