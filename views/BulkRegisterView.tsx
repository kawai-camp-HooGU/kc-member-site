"use client";
import { useState, useRef } from "react";
import type { ClipboardEvent as ReactClipboardEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMaster } from "../hooks/useMaster";
import type { Filters } from "../lib/filters";
import type { Task } from "../lib/models";
import {
  BULK_COLS, BULK_INIT_ROWS, normNm, bulkTokens, assigneeStatus, dateRowStatus,
  bulkStatusVal, bulkImportanceVal, STATUS_LABEL, IMPORTANCE_LABEL,
  type AssigneeCellStatus,
} from "../lib/bulkUtils";

export interface BulkRegisterViewProps {
  tasks: Task[];
  filters: Filters;
  onSave: (t: Task) => void;
  onDone?: (pid: number) => void;
  onCancel: () => void;
}

type CellEl = HTMLInputElement | HTMLSelectElement | null;

export function BulkRegisterView({ tasks, filters, onSave, onDone, onCancel }: BulkRegisterViewProps) {
  const { projects, anken: ankenList, members, permission } = useMaster();
  const viewableProjects = projects.filter((p) => !p.closeDate && (!permission || permission.canViewProject(p.id)));
  const [projectId, setProjectId] = useState<number>(() => {
    const fp = filters?.project?.[0];
    if (fp && viewableProjects.some((p) => String(p.id) === String(fp))) return Number(fp);
    return viewableProjects[0]?.id ?? projects[0]?.id ?? 1;
  });
  const ankenOfProject = ankenList.filter((a) => a.projectId === projectId);
  const [ankenId, setAnkenId] = useState<number | null>(ankenOfProject[0]?.id ?? null);
  const changeProject = (pid: string) => { const p = Number(pid); setProjectId(p); const first = ankenList.find((a) => a.projectId === p); setAnkenId(first?.id ?? null); };

  const currentProject = viewableProjects.find((p) => p.id === projectId) || projects.find((p) => p.id === projectId);
  const projectMembers = members.filter((m) => !m.isDeleted && (currentProject?.memberNames ?? []).includes(m.name));

  const emptyRow = (): string[] => Array(BULK_COLS).fill("");
  const [rows, setRows] = useState<string[][]>(() => Array.from({ length: BULK_INIT_ROWS }, emptyRow));
  const [picker, setPicker] = useState<number | null>(null);
  const [pickerQ, setPickerQ] = useState("");
  const cellRefs = useRef<Record<string, CellEl>>({});
  const setRef = (r: number, c: number) => (el: CellEl) => { cellRefs.current[`${r}-${c}`] = el; };
  const focusCell = (r: number, c: number) => { const el = cellRefs.current[`${r}-${c}`]; if (el) { el.focus(); (el as HTMLInputElement).select?.(); } };

  const setCell = (r: number, c: number, val: string) => setRows((rs) => rs.map((row, i) => i === r ? row.map((v, j) => j === c ? val : v) : row));
  const addRow = () => setRows((rs) => [...rs, emptyRow()]);
  const delRow = (r: number) => { setPicker(null); setRows((rs) => { const n = rs.filter((_, i) => i !== r); return n.length ? n : [emptyRow()]; }); };

  const onPaste = (r: number, c: number, e: ReactClipboardEvent) => {
    const t = e.clipboardData.getData("text");
    if (!t.includes("\t") && !t.includes("\n")) return;
    e.preventDefault();
    const grid = t.replace(/\r/g, "").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    setRows((rs) => {
      const next = rs.map((row) => row.slice());
      grid.forEach((cells, dr) => { const rr = r + dr; while (next.length <= rr) next.push(emptyRow()); cells.forEach((val, dc) => { const cc = c + dc; if (cc < BULK_COLS) next[rr][cc] = val; }); });
      next.forEach((row) => { row[2] = STATUS_LABEL(row[2]); row[3] = IMPORTANCE_LABEL(row[3]); });
      return next;
    });
  };

  const onKeyDown = (r: number, c: number, e: ReactKeyboardEvent) => {
    if (e.key === "Enter" || e.key === "ArrowDown") { e.preventDefault(); const nr = r + 1; if (nr >= rows.length) addRow(); setTimeout(() => focusCell(nr, c), 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (r > 0) focusCell(r - 1, c); }
    else if (e.key === "Tab") { e.preventDefault(); let nc = c + (e.shiftKey ? -1 : 1), nr = r; if (nc >= BULK_COLS) { nc = 0; nr = r + 1; } if (nc < 0) { nc = BULK_COLS - 1; nr = Math.max(0, r - 1); } if (nr >= rows.length) addRow(); setTimeout(() => focusCell(nr, nc), 0); }
  };

  const toggleMember = (name: string) => {
    setRows((rs) => rs.map((row, i) => {
      if (i !== picker) return row;
      const mem = projectMembers.find((m) => m.name === name);
      const idStr = mem ? String(mem.id) : "";
      let ts = bulkTokens(row[1]).filter((x) => x !== idStr);
      const has = ts.some((x) => normNm(x) === normNm(name));
      ts = has ? ts.filter((x) => normNm(x) !== normNm(name)) : [...ts, name];
      return row.map((v, j) => j === 1 ? ts.join(", ") : v);
    }));
  };

  const statuses = rows.map((row) => assigneeStatus(row[1], projectMembers));
  const dstatuses = rows.map((row) => dateRowStatus(row[4], row[5]));
  const ngCount = statuses.filter((s) => s.status === "multi" || s.status === "none").length
    + dstatuses.filter((s) => s === "bad" || s === "warn").length;
  const validCount = rows.filter((row) => row[0].trim()).length;
  const canRegister = ngCount === 0 && validCount > 0;

  const register = () => {
    if (!canRegister || ankenId == null) return;
    let idc = Math.max(0, ...tasks.map((t) => t.id)) + 1;
    rows.forEach((row) => {
      if (!row[0].trim()) return;
      const st = assigneeStatus(row[1], projectMembers);
      const s = row[4].trim(), e = row[5].trim(); const both = Boolean(s && e);
      onSave({
        id: idc++, projectId, ankenId,
        name: row[0].trim(),
        assignees: st.names || [],
        assigneeIds: [],
        start: both ? s : "", end: both ? e : "",
        status: bulkStatusVal(row[2]), importance: bulkImportanceVal(row[3]),
        risk: "normal",
        progressMemo: row[6].trim(), specialNotes: row[7].trim(), materials: row[8].trim(),
        completedAt: null, updatedAt: null, updatedBy: "",
      });
    });
    onDone && onDone(projectId);
  };

  const HEADERS = ["タスク名", "メンバー", "ステータス", "重要度", "開始日", "終了日", "進捗メモ", "特記事項", "資料"];
  const WIDTHS = [170, 150, 96, 80, 112, 112, 160, 160, 140];
  const bgOf = (s: AssigneeCellStatus): string => s.status === "multi" ? "#ffedd5" : s.status === "none" ? "#fee2e2" : "transparent";
  const activeMembers = projectMembers;

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-red-600 text-xl leading-none">▤</span>
        <h1 className="text-lg font-bold text-gray-800">タスク一括登録</h1>
      </div>
      <p className="text-xs text-gray-500 mb-4">スプレッドシートで整えた表をそのまま貼り付けて、まとめて登録できます（横スクロールで全項目を編集）</p>

      <div className="flex gap-3 mb-4 max-w-lg">
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">プロジェクト</label>
          <select value={projectId} onChange={(e) => changeProject(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
            {viewableProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div className="flex-1">
          <label className="text-xs font-semibold text-gray-500 block mb-1.5">分類</label>
          <select value={ankenId ?? ""} onChange={(e) => setAnkenId(Number(e.target.value))}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
            {ankenOfProject.length === 0 && <option value="">（分類なし）</option>}
            {ankenOfProject.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 items-center text-[11px] text-gray-500 mb-1.5">
        <span>メンバー：当該プロジェクトに紐づくメンバーのみ登録可（テキスト / コード / ▾から選択）。セルの色：</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-gray-300 bg-white inline-block"></span>OK</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-orange-300 inline-block" style={{ background: "#ffedd5" }}></span>要確認（複数候補・日付の片方のみ/逆転）</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm border border-red-300 inline-block" style={{ background: "#fee2e2" }}></span>不正・該当なし（メンバーなし・日付エラー）</span>
      </div>

      <div className="overflow-x-auto bg-white border border-gray-300 rounded-lg">
        <table className="border-collapse text-sm" style={{ minWidth: 1180, tableLayout: "fixed" }}>
          <colgroup>{WIDTHS.map((w, i) => <col key={i} style={{ width: w }} />)}<col style={{ width: 40 }} /></colgroup>
          <thead>
            <tr className="bg-blue-50">
              {HEADERS.map((h, i) => (
                <th key={i} className={`text-left px-2.5 py-2 border-r border-red-100 border-b border-gray-300 text-red-900 font-medium whitespace-nowrap ${i === 0 ? "sticky left-0 bg-blue-50 z-20" : ""}`}>{h}</th>
              ))}
              <th className="border-b border-gray-300"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                {row.map((val, c) => {
                  if (c === 1) {
                    const st = statuses[r];
                    return (
                      <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                        <div className="flex items-center" style={{ background: bgOf(st) }}>
                          <input ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onPaste={(e) => onPaste(r, c, e)}
                            title={st.status === "multi" ? ("複数候補: " + (st.cands || []).join(" / ") + " → ▾で1人に絞ってください") : st.status === "none" ? "該当するメンバーがいません" : ((st.names && st.names.length) ? ("→ " + st.names.join(", ")) : "")}
                            className="flex-1 min-w-0 outline-none py-2 pl-2.5 pr-1 text-sm bg-transparent" />
                          <button onClick={() => { setPicker(picker === r ? null : r); setPickerQ(""); }} title="マスタから選択" className="px-2 text-gray-500 hover:text-gray-700 text-xs">▾</button>
                        </div>
                      </td>
                    );
                  }
                  if (c === 2 || c === 3) {
                    const opts = c === 2 ? ["", "未着手", "進行中", "完了"] : ["", "Ⅰ", "Ⅱ", "Ⅲ"];
                    return (
                      <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                        <select ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)}
                          className="w-full box-border outline-none px-1.5 py-2 text-sm bg-transparent">
                          {opts.map((o) => <option key={o} value={o}>{o === "" ? "—" : o}</option>)}
                        </select>
                      </td>
                    );
                  }
                  if (c === 4 || c === 5) {
                    const ds = dstatuses[r];
                    const dbg = ds === "bad" ? "#fee2e2" : ds === "warn" ? "#ffedd5" : "transparent";
                    return (
                      <td key={c} className="p-0 border-r border-gray-200 border-b border-gray-200">
                        <input ref={setRef(r, c)} value={val} onChange={(e) => setCell(r, c, e.target.value)} onKeyDown={(e) => onKeyDown(r, c, e)} onPaste={(e) => onPaste(r, c, e)}
                          title={ds === "bad" ? "日付の形式が正しくありません（YYYY-MM-DD の実在日付）" : ds === "warn" ? "開始日・終了日をご確認ください（片方のみ／開始＞終了）" : ""}
                          className="w-full box-border outline-none px-2.5 py-2 text-sm bg-transparent" style={{ background: dbg }} />
                      </td>
                    );
                  }
                  return (
                    <td key={c} className={`p-0 border-r border-gray-200 border-b border-gray-200 ${c === 0 ? "sticky left-0 bg-white z-10" : ""}`}>
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
        <span className="text-xs" style={{ color: ngCount > 0 ? "#dc2626" : validCount === 0 ? "#94a3b8" : "#2563eb" }}>
          {ngCount > 0
            ? `未解決のセルが ${ngCount} 件あります（オレンジ=要確認／赤=不正・該当なし）。修正するまで登録できません`
            : validCount === 0
              ? "タスク名を入力するか、スプレッドシートから貼り付けてください"
              : `${validCount}件のタスクを登録できます`}
        </span>
        <button onClick={addRow} className="text-xs text-red-600 bg-white border border-red-200 rounded-md px-3 py-1.5 hover:bg-blue-50 whitespace-nowrap">＋ 行を追加</button>
      </div>

      {picker !== null && rows[picker] && (
        <div className="mt-3 bg-white border border-red-300 rounded-xl shadow-lg p-3" style={{ maxWidth: 360 }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-red-900">{picker + 1}行目のメンバーを選択</span>
            <button onClick={() => setPicker(null)} className="text-gray-400 hover:text-gray-600">✕</button>
          </div>
          <input autoFocus value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="メンバーを検索"
            className="w-full box-border border border-gray-300 rounded-md outline-none px-2.5 py-1.5 text-xs mb-2 focus:border-red-400" />
          <div className="overflow-auto" style={{ maxHeight: 176 }}>
            {activeMembers.filter((m) => normNm(m.name).includes(normNm(pickerQ))).map((m) => {
              const cur = bulkTokens(rows[picker!][1]);
              const on = cur.some((x) => normNm(x) === normNm(m.name)) || cur.includes(String(m.id));
              return (
                <label key={m.id} onClick={(e) => { e.preventDefault(); toggleMember(m.name); }}
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-gray-50 cursor-pointer text-sm">
                  <input type="checkbox" checked={on} readOnly className="pointer-events-none" />
                  <span>{m.name}</span><span className="ml-auto text-gray-400 text-xs">{m.id}</span>
                </label>
              );
            })}
            {activeMembers.length === 0 && <p className="text-xs text-gray-400 px-2 py-1.5">このプロジェクトにメンバーが登録されていません（プロジェクト設定でメンバーを追加してください）</p>}
          </div>
        </div>
      )}

      <div className="flex gap-3 justify-end mt-4">
        <button onClick={onCancel} className="border border-gray-300 rounded-lg px-6 py-2.5 text-sm text-gray-600 hover:bg-gray-50">キャンセル</button>
        <button onClick={register} disabled={!canRegister}
          className="rounded-lg px-7 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed">一括登録</button>
      </div>
    </div>
  );
}
