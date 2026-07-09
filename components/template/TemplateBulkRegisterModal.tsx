"use client";
import { useState, useRef } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { TBULK_COLS, TBULK_INIT_ROWS, tImpVal, TIMP_LABEL, isBlankNum, offsetRowStatus } from "./templateBulkUtils";
import type { EditTemplate, EditAnken, EditTask } from "./types";

export interface TemplateBulkRegisterModalProps {
  onClose: () => void;
  onPersist: (t: EditTemplate) => void;
}

type CellEl = HTMLInputElement | HTMLSelectElement | null;

export function TemplateBulkRegisterModal({ onClose, onPersist }: TemplateBulkRegisterModalProps) {
  const [tmplName, setTmplName] = useState("");
  const emptyRow = (): string[] => Array(TBULK_COLS).fill("");
  const [rows, setRows] = useState<string[][]>(() => Array.from({ length: TBULK_INIT_ROWS }, emptyRow));
  const cellRefs = useRef<Record<string, CellEl>>({});
  const setRef = (r: number, c: number) => (el: CellEl) => { cellRefs.current[`${r}-${c}`] = el; };
  const focusCell = (r: number, c: number) => { const el = cellRefs.current[`${r}-${c}`]; if (el) { el.focus(); (el as HTMLInputElement).select?.(); } };

  const setCell = (r: number, c: number, val: string) => setRows((rs) => rs.map((row, i) => i === r ? row.map((v, j) => j === c ? val : v) : row));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const delRow = (r: number) => setRows((rs) => { const n = rs.filter((_, i) => i !== r); return n.length ? n : [emptyRow()]; });

  const onPaste = (r: number, c: number, e: ReactClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (!t.includes("\t") && !t.includes("\n")) return;
    e.preventDefault();
    const grid = t.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    setRows((rs) => {
      const next = rs.map((row) => row.slice());
      grid.forEach((cells, dr) => { const rr = r + dr; while (next.length <= rr) next.push(emptyRow()); cells.forEach((val, dc) => { const cc = c + dc; if (cc < TBULK_COLS) next[rr][cc] = val; }); });
      next.forEach((row) => { row[2] = TIMP_LABEL(row[2]); });
      return next;
    });
  };

  const onKeyDown = (r: number, c: number, e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const nr = r + 1; if (nr >= rows.length) addRow(); setTimeout(() => focusCell(nr, c), 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (r > 0) focusCell(r - 1, c); }
    else if (e.key === "Tab") { e.preventDefault(); let nc = c + (e.shiftKey ? -1 : 1), nr = r; if (nc >= TBULK_COLS) { nc = 0; nr = r + 1; } if (nc < 0) { nc = TBULK_COLS - 1; nr = Math.max(0, r - 1); } if (nr >= rows.length) addRow(); setTimeout(() => focusCell(nr, nc), 0); }
  };

  const taskRows = rows.map((row, i) => ({ i, filled: row[1].trim() !== "" }));
  let carry = "";
  const effCats = rows.map((row) => { const c = row[0].trim(); if (c) carry = c; return row[1].trim() ? carry : ""; });
  const catBad = rows.map((row) => row[1].trim() !== "" && effCats[rows.indexOf(row)] === "");

  const ostatuses = rows.map((row) => offsetRowStatus(row[3], row[4]));
  const ngCount =
    ostatuses.filter((s, i) => rows[i][1].trim() && (s === "bad" || s === "warn")).length +
    catBad.filter(Boolean).length;
  const validCount = taskRows.filter((t) => t.filled).length;
  const groupCount = (() => { const set = new Set<string>(); rows.forEach((row, i) => { if (row[1].trim() && effCats[i]) set.add(effCats[i]); }); return set.size; })();
  const canRegister = tmplName.trim() !== "" && ngCount === 0 && validCount > 0;

  const register = () => {
    if (!canRegister) return;
    const anken: EditAnken[] = [];
    let cur: EditAnken | null = null;
    rows.forEach((row, i) => {
      if (!row[1].trim()) return;
      const cat = effCats[i];
      const task: EditTask = {
        name: row[1].trim(),
        importance: tImpVal(row[2]),
        startOffset: isBlankNum(row[3]) ? "" : Number(String(row[3]).trim()),
        endOffset: isBlankNum(row[4]) ? "" : Number(String(row[4]).trim()),
        progressMemo: row[5].trim(),
        specialNotes: row[6].trim(),
        materials: row[7].trim(),
      };
      if (!cur || cur.name !== cat) { cur = { name: cat, tasks: [] }; anken.push(cur); }
      cur.tasks.push(task);
    });
    onPersist({ id: null, name: tmplName.trim(), anken });
    onClose();
  };

  const HEADERS = ["分類", "タスク名", "重要度", "開始日数", "終了日数", "進捗メモ", "特記事項", "資料"];
  const WIDTHS = [150, 180, 84, 84, 84, 150, 150, 130];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-red-600 text-xl leading-none">▤</span>
            <h2 className="font-bold text-gray-800">テンプレート一括登録</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4">
          <p className="text-xs text-gray-500 mb-4">スプレッドシートで整えた表をそのまま貼り付けて、テンプレートをまるごと登録できます。分類名が同じ連続行は1グループにまとまります（分類の空欄＝上の行と同じ分類）。</p>

          <div className="max-w-md mb-4">
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">テンプレート名 <span className="text-red-500">*</span></label>
            <input value={tmplName} onChange={(e) => setTmplName(e.target.value)} placeholder="例：LP制作標準"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400" />
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-[11px] text-gray-500 mb-1.5">
            <span>セルの色：</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-gray-300 bg-white inline-block"></span>OK</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-orange-300 inline-block" style={{ background: "#ffedd5" }}></span>要確認（開始＞終了などの日数逆転）</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-red-300 inline-block" style={{ background: "#fee2e2" }}></span>不正（数値以外・分類なし）</span>
          </div>

          <div className="overflow-x-auto bg-white border border-gray-300 rounded-lg">
            <table className="border-collapse text-sm" style={{ minWidth: 1096, tableLayout: "fixed" }}>
              <colgroup>{WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}<col style={{ width: 40 }} /></colgroup>
              <thead>
                <tr className="bg-blue-50">
                  {HEADERS.map((h, i) => (
                    <th key={i} className="text-left px-2.5 py-2 border-r border-red-100 border-b border-gray-300 text-red-900 font-medium whitespace-nowrap">{h}</th>
                  ))}
                  <th className="border-b border-gray-300"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.map((val, c) => {
                      if (c === 0) {
                        const inherited = row[0].trim() === "" && row[1].trim() !== "" && effCats[r] !== "";
                        const bad = catBad[r];
                        return (
                          <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                            <input ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onPaste={(e) => onPaste(r, c, e)}
                              placeholder={inherited ? "〃 " + effCats[r] : ""}
                              title={bad ? "分類が決まりません。先頭行または上の行に分類名を入力してください" : inherited ? "上の行と同じ分類：" + effCats[r] : ""}
                              className="w-full box-border outline-none px-2.5 py-2 text-sm bg-transparent placeholder-gray-300"
                              style={{ background: bad ? "#fee2e2" : "transparent" }} />
                          </td>
                        );
                      }
                      if (c === 2) {
                        return (
                          <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                            <select ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)}
                              className="w-full box-border outline-none px-1.5 py-2 text-sm bg-transparent">
                              {["", "Ⅰ", "Ⅱ", "Ⅲ"].map((o) => <option key={o} value={o}>{o === "" ? "—" : o}</option>)}
                            </select>
                          </td>
                        );
                      }
                      if (c === 3 || c === 4) {
                        const os = ostatuses[r];
                        const obg = row[1].trim() && os === "bad" ? "#fee2e2" : row[1].trim() && os === "warn" ? "#ffedd5" : "transparent";
                        return (
                          <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                            <input ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onPaste={(e) => onPaste(r, c, e)}
                              placeholder="—"
                              title={os === "bad" ? "0以上の整数で入力してください（空欄＝日付なし）" : os === "warn" ? "開始日数が終了日数を上回っています" : ""}
                              className="w-full box-border outline-none px-2.5 py-2 text-sm text-center bg-transparent placeholder-gray-300" style={{ background: obg }} />
                          </td>
                        );
                      }
                      return (
                        <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                          <input ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onPaste={(e) => onPaste(r, c, e)}
                            className="w-full box-border outline-none px-2.5 py-2 text-sm bg-transparent" />
                        </td>
                      );
                    })}
                    <td className="border-b border-gray-200 text-center">
                      <button onClick={() => delRow(r)} title="行を削除" className="text-red-400 hover:text-red-600 px-1.5 py-1.5 text-sm">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between mt-2">
            <span className="text-xs" style={{ color: ngCount > 0 ? "#dc2626" : (validCount === 0 || !tmplName.trim()) ? "#94a3b8" : "#2563eb" }}>
              {ngCount > 0
                ? `未解決のセルが ${ngCount} 件あります（オレンジ=要確認／赤=不正・分類なし）。修正するまで登録できません`
                : !tmplName.trim()
                  ? "テンプレート名を入力してください"
                  : validCount === 0
                    ? "タスク名を入力するか、スプレッドシートから貼り付けてください"
                    : `${validCount}件のタスクを${groupCount}分類に登録できます`}
            </span>
            <button onClick={addRow} className="text-xs text-red-600 bg-white border border-red-200 rounded-md px-3 py-1.5 hover:bg-blue-50 whitespace-nowrap">＋ 行を追加</button>
          </div>
        </div>

        <div className="flex gap-3 justify-end px-5 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="border border-gray-300 rounded-lg px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={register} disabled={!canRegister}
            className="rounded-lg px-7 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed">一括登録</button>
        </div>
      </div>
    </div>
  );
}
