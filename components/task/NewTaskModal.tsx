"use client";
import { useState, useEffect, useRef } from "react";
import { useMaster } from "../../hooks/useMaster";
import { SELECT_WHITE_ARROW, statusFillCls, importanceFillCls } from "../../lib/constants";
import { AutoGrowTextarea } from "../common/text";
import type { Task, Status, Importance } from "../../lib/models";

export interface NewTaskModalProps {
  tasks: Task[];
  onClose: () => void;
  onSave: (t: Task) => void;
  initialDate?: string;
  initialTask?: Task | null;
  initialStatus?: Status;
}

interface ParsedBulkTask { name: string; assignees: string[]; start: string; end: string; }

// 新規タスク登録モーダル
export function NewTaskModal({ tasks, onClose, onSave, initialDate = "", initialTask = null, initialStatus = "pending" }: NewTaskModalProps) {
  const { projects, anken: ankenList, members, permission } = useMaster();
  const nextId = Math.max(0, ...tasks.map((t) => t.id)) + 1;
  const viewableProjects = projects.filter((p) => !p.closeDate && (!permission || permission.canViewProject(p.id)));
  const defaultProjectId = viewableProjects[0]?.id ?? projects[0]?.id ?? 1;

  const [inputMode] = useState<"single" | "bulk">("single");
  const [bulkText] = useState("");
  const [bulkProjectId] = useState<number>(defaultProjectId);
  const [bulkAnkenId] = useState<number>(ankenList.filter((a) => a.projectId === defaultProjectId)[0]?.id ?? 1);

  const parseBulkTasks = (text: string): ParsedBulkTask[] =>
    text.trim().split("\n")
      .map((line) => line.split("\t"))
      .filter((cols) => cols.length >= 1 && (cols[0] ?? "").trim())
      .map((cols) => {
        const s = cols[2]?.trim() || "";
        const e = cols[3]?.trim() || "";
        const bothFilled = Boolean(s && e);
        return {
          name: (cols[0] ?? "").trim(),
          assignees: cols[1] ? cols[1].split(",").map((x) => x.trim()).filter(Boolean) : [],
          start: bothFilled ? s : "",
          end: bothFilled ? e : "",
        };
      });

  const handleBulkSave = () => {
    const parsed = parseBulkTasks(bulkText);
    if (parsed.length === 0) return;
    let idCtr = nextId;
    parsed.forEach((t) => {
      onSave({
        id: idCtr++,
        projectId: bulkProjectId,
        ankenId: bulkAnkenId,
        status: "pending",
        importance: "none",
        risk: "normal",
        progressMemo: "", specialNotes: "", materials: "",
        assigneeIds: [], completedAt: null, updatedAt: null, updatedBy: "",
        ...t,
      });
    });
    onClose();
  };
  void handleBulkSave; // bulk入力UIは現在無効（将来用に保持）

  const [form, setForm] = useState<Task>(() => {
    if (initialTask) {
      const pid = initialTask.projectId ?? defaultProjectId;
      return {
        id: nextId,
        projectId: pid,
        ankenId: initialTask.ankenId ?? (ankenList.filter((a) => a.projectId === pid)[0]?.id ?? 1),
        name: `${initialTask.name}（コピー）`,
        assignees: [...(initialTask.assignees ?? [])],
        assigneeIds: [],
        start: initialTask.start || "",
        end: initialTask.end || "",
        status: "pending",
        importance: initialTask.importance ?? "none",
        risk: initialTask.risk ?? "normal",
        progressMemo: initialTask.progressMemo ?? "",
        specialNotes: initialTask.specialNotes ?? "",
        materials: initialTask.materials ?? "",
        completedAt: null, updatedAt: null, updatedBy: "",
      };
    }
    return {
      id: nextId,
      projectId: defaultProjectId,
      ankenId: ankenList.filter((a) => a.projectId === defaultProjectId)[0]?.id ?? 1,
      name: "",
      assignees: (permission?.role === "member" && permission?.myName) ? [permission.myName] : [],
      assigneeIds: [],
      start: initialDate || "",
      end: initialDate || "",
      status: initialStatus,
      importance: "none",
      risk: "normal",
      progressMemo: "", specialNotes: "", materials: "",
      completedAt: null, updatedAt: null, updatedBy: "",
    };
  });
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const assigneeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!assigneeOpen) return;
    const handler = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) setAssigneeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [assigneeOpen]);

  const filteredAnken = ankenList.filter((a) => a.projectId === form.projectId);

  const toggleAssignee = (name: string) => {
    setForm((prev) => ({
      ...prev,
      assignees: prev.assignees.includes(name)
        ? prev.assignees.filter((a) => a !== name)
        : [...prev.assignees, name],
    }));
  };

  const handleProjectChange = (pid: string) => {
    const pId = Number(pid);
    const firstAnken = ankenList.find((a) => a.projectId === pId);
    setForm((f) => ({ ...f, projectId: pId, ankenId: firstAnken?.id ?? f.ankenId }));
  };

  const datesOk = (!form.start && !form.end) || (!!form.start && !!form.end);
  const canSave = form.name.trim() !== "" && form.assignees.length > 0 && datesOk;

  const handleSave = () => {
    if (!canSave) return;
    onSave(form);
    onClose();
  };

  const INPUT_CLS = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
  const SELECT_CLS = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400 bg-white";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">新規タスク登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        {inputMode === "single" && (
        <>
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">タスク名 <span className="text-red-500">*</span></label>
            <input type="text" value={form.name} placeholder="タスク名を入力"
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className={INPUT_CLS} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">プロジェクト</label>
            <select value={form.projectId} onChange={(e) => handleProjectChange(e.target.value)} className={SELECT_CLS}>
              {viewableProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">分類</label>
            <select value={form.ankenId} onChange={(e) => setForm((f) => ({ ...f, ankenId: Number(e.target.value) }))} className={SELECT_CLS}>
              {filteredAnken.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">ステータス</label>
              <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as Status }))}
                style={SELECT_WHITE_ARROW}
                className={`w-full border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none font-medium ${statusFillCls(form.status)}`}>
                <option value="pending">未着手</option>
                <option value="in_progress">進行中</option>
                <option value="completed">完了</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">重要度</label>
              <select value={String(form.importance ?? "none")}
                onChange={(e) => { const k = e.target.value; setForm((f) => ({ ...f, importance: (k === "none" ? "none" : Number(k) as 1 | 2 | 3) as Importance })); }}
                style={SELECT_WHITE_ARROW}
                className={`w-full border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none font-medium ${importanceFillCls(String(form.importance ?? "none"))}`}>
                <option value="none">なし</option>
                <option value="1">Ⅰ（低）</option>
                <option value="2">Ⅱ（中）</option>
                <option value="3">Ⅲ（高）</option>
              </select>
            </div>
          </div>

          <div>
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-500 block mb-1.5">開始日</label>
                <input type="date" value={form.start}
                  onChange={(e) => setForm((f) => ({ ...f, start: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div className="flex-1">
                <label className="text-xs font-semibold text-gray-500 block mb-1.5">期限日（終了日）</label>
                <input type="date" value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))} className={INPUT_CLS} />
              </div>
            </div>
            {(!!form.start !== !!form.end) && (
              <p className="text-xs text-red-500 mt-1">開始日と期限日は両方入力するか、両方空欄にしてください</p>
            )}
            {(!form.start && !form.end) && (
              <p className="text-xs text-gray-400 mt-1">空欄のまま登録すると「日付登録なし」になります</p>
            )}
          </div>

          <div ref={assigneeRef}>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">メンバー（複数選択可） <span className="text-red-500">*</span></label>
            <button type="button" onClick={() => setAssigneeOpen((o) => !o)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left flex items-center justify-between focus:outline-none focus:border-red-400 bg-white">
              <span className={form.assignees.length === 0 ? "text-gray-400" : "text-gray-700"}>
                {form.assignees.length === 0 ? "メンバーを選択..." : form.assignees.join(", ")}
              </span>
              <span className="text-gray-400 text-xs ml-2">{assigneeOpen ? "▲" : "▼"}</span>
            </button>
            {assigneeOpen && (
              <div className="border border-gray-200 rounded-lg mt-1 bg-white shadow-lg max-h-52 overflow-y-auto z-50">
                <div className="sticky top-0 bg-white p-1.5 border-b border-gray-100">
                  <input autoFocus value={assigneeQuery} onChange={(e) => setAssigneeQuery(e.target.value)}
                    placeholder="メンバーを検索…"
                    className="w-full border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-red-400" />
                </div>
                {(() => {
                  const opts = members.filter((m) => !m.isDeleted
                    && (projects.find((p) => p.id === form.projectId)?.memberNames ?? []).includes(m.name)
                    && m.name.toLowerCase().includes(assigneeQuery.toLowerCase()));
                  if (opts.length === 0) return <p className="text-xs text-gray-400 px-3 py-2">該当するメンバーがいません</p>;
                  return opts.map((m) => {
                    const name = m.name;
                    const checked = form.assignees.includes(name);
                    return (
                      <label key={name} className="flex items-center gap-2.5 px-3 py-2 hover:bg-blue-50 cursor-pointer text-sm text-gray-700 select-none">
                        <input type="checkbox" checked={checked} onChange={() => toggleAssignee(name)} className="w-4 h-4 accent-blue-600 rounded" />
                        {name}
                      </label>
                    );
                  });
                })()}
              </div>
            )}
            {form.assignees.length === 0 && <p className="text-xs text-red-500 mt-1">メンバーを1名以上選択してください</p>}
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">進捗メモ</label>
            <AutoGrowTextarea minRows={2} value={form.progressMemo}
              onChange={(e) => setForm((f) => ({ ...f, progressMemo: e.target.value }))}
              placeholder="現在の状況・ブロッカー・次のアクションなどを記入..." className={INPUT_CLS} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">特記事項</label>
            <AutoGrowTextarea minRows={2} value={form.specialNotes}
              onChange={(e) => setForm((f) => ({ ...f, specialNotes: e.target.value }))}
              placeholder="注意点・リスク・確認事項など..." className={INPUT_CLS} />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">資料</label>
            <AutoGrowTextarea minRows={2} value={form.materials}
              onChange={(e) => setForm((f) => ({ ...f, materials: e.target.value }))}
              placeholder="関連ドキュメントのURL・ファイル名など..." className={INPUT_CLS} />
          </div>
        </div>

        <div className="flex gap-3 px-5 py-4 border-t border-gray-100">
          <button onClick={onClose}
            className="flex-1 text-sm py-2.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">
            キャンセル
          </button>
          <button onClick={handleSave} disabled={!canSave}
            className="flex-1 text-sm py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            登録する
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
