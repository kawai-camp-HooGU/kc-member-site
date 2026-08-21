"use client";
import { useState, useEffect, useRef } from "react";
import { useMaster } from "../../hooks/useMaster";
import { FIELD_INPUT, LINKCARD, SELECT_WHITE_ARROW, importanceFillCls, statusFillCls } from "../../lib/constants";
import { collectUrls, urlParts } from "../../lib/textUtils";
import { AutoGrowTextarea, linkifyText } from "../common/text";
import { Icon, IconBadge } from "../common/Icon";
import type { Task, Status, Importance } from "../../lib/models";

export interface TaskDetailPopupProps {
  task: Task | null;
  onClose: () => void;
  onSave: (t: Task) => void;
  onDelete: (id: number) => void;
  onDuplicate?: (t: Task) => void;
  canEdit?: boolean;
}

type TextFieldKey = "progressMemo" | "specialNotes" | "materials";

export function TaskDetailPopup({ task, onClose, onSave, onDelete, onDuplicate, canEdit = true }: TaskDetailPopupProps) {
  const { projects, anken: ankenList, members, permission } = useMaster();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [form, setForm] = useState<Task | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const assigneeRef = useRef<HTMLDivElement>(null);
  const ro = !canEdit;

  useEffect(() => {
    if (task) setForm({ ...task, assignees: [...(task.assignees ?? [])] });
    setConfirmDelete(false);
    setAssigneeOpen(false);
  }, [task]);

  useEffect(() => {
    if (!assigneeOpen) return;
    const handler = (e: MouseEvent) => {
      if (assigneeRef.current && !assigneeRef.current.contains(e.target as Node)) setAssigneeOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [assigneeOpen]);

  if (!task || !form) return null;

  const anken = ankenList.find((a) => a.id === task.ankenId);

  const toggleAssignee = (name: string) => {
    setForm((prev) => prev ? {
      ...prev,
      assignees: prev.assignees.includes(name)
        ? prev.assignees.filter((a) => a !== name)
        : [...prev.assignees, name],
    } : prev);
  };

  const invalid = form.assignees.length === 0 || (!!form.start !== !!form.end);
  const handleSave = () => {
    if (ro || invalid) return;
    onSave({ ...form, updatedBy: permission?.myName || form.updatedBy || "" });
    onClose();
  };
  const handleDelete = () => { onDelete(task.id); onClose(); };
  const handleDuplicate = () => { onDuplicate?.(task); onClose(); };

  const statusFill = statusFillCls(form.status);
  const impKey = String(form.importance ?? "none");
  const impFill = importanceFillCls(impKey);
  const fmtDT = (v: string | null): string =>
    v ? new Date(v).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "";

  const SELECT = "w-full border rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none font-medium disabled:cursor-default";
  const INPUT  = `${FIELD_INPUT} disabled:bg-gray-50 disabled:text-gray-500`;
  const TA     = FIELD_INPUT;

  // ⚠️ URL は項目ごとに出さず、下の「本文中のリンク」へ集約する。
  //    同じURLを複数の項目に書いても1件にまとまり、参照先を一目で追える。
  const renderTextField = (label: string, field: TextFieldKey, placeholder: string) => {
    const val = form[field] || "";
    return (
      <div key={field}>
        <label className="text-xs font-semibold text-gray-500 block mb-1.5">{label}</label>
        {ro ? (
          <div className="text-sm rounded-lg p-3 border border-gray-200 bg-gray-50 whitespace-pre-wrap break-all" style={{ minHeight: "3.4em" }}>
            {val ? <span className="text-gray-700 leading-relaxed">{linkifyText(val)}</span> : <span className="text-gray-300 italic">未入力</span>}
          </div>
        ) : (
          <AutoGrowTextarea value={form[field]} minRows={2} placeholder={placeholder}
            onChange={(e) => setForm((f) => f ? { ...f, [field]: e.target.value } : f)} className={TA} />
        )}
      </div>
    );
  };

  // 本文中のリンク：進捗メモ → 特記事項 → 資料 の順に拾い、重複は1件にまとめる。
  //   入力中の textarea からもその場で拾うので、貼った直後に一覧へ現れる。
  const bodyUrls = collectUrls([form.progressMemo, form.specialNotes, form.materials]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 border-b border-gray-100 shrink-0">
          <div>
            <div className="font-bold text-gray-800 text-base">{task.name}</div>
            {anken && <div className="text-xs text-red-500 mt-0.5">フェーズ：{anken.name}</div>}
          </div>
          <div className="flex items-center gap-2 ml-3 shrink-0">
            {ro && <span className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-2 py-0.5 whitespace-nowrap">閲覧のみ</span>}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">ステータス</label>
              <select value={form.status} disabled={ro}
                onChange={(e) => setForm((f) => f ? { ...f, status: e.target.value as Status } : f)}
                style={SELECT_WHITE_ARROW} className={`${SELECT} ${statusFill}`}>
                <option value="pending">未着手</option>
                <option value="in_progress">進行中</option>
                <option value="completed">完了</option>
              </select>
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">重要度</label>
              <select value={impKey} disabled={ro}
                onChange={(e) => { const k = e.target.value; setForm((f) => f ? { ...f, importance: (k === "none" ? "none" : Number(k) as 1 | 2 | 3) as Importance } : f); }}
                style={SELECT_WHITE_ARROW} className={`${SELECT} ${impFill}`}>
                <option value="none">なし</option>
                <option value="1">Ⅰ（低）</option>
                <option value="2">Ⅱ（中）</option>
                <option value="3">Ⅲ（高）</option>
              </select>
            </div>
          </div>

          {form.status === "completed" && (
            <div className="flex justify-between items-center bg-blue-50 rounded-lg px-3 py-1.5">
              <span className="text-xs text-red-600">完了日</span>
              <span className="text-xs text-red-700">{form.completedAt ? fmtDT(form.completedAt) : "保存時に記録されます"}</span>
            </div>
          )}

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">開始日</label>
              <input type="date" value={form.start} disabled={ro}
                onChange={(e) => setForm((f) => f ? { ...f, start: e.target.value } : f)} className={INPUT} />
            </div>
            <div className="flex-1">
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">期限日（終了日）</label>
              <input type="date" value={form.end} disabled={ro}
                onChange={(e) => setForm((f) => f ? { ...f, end: e.target.value } : f)} className={INPUT} />
            </div>
          </div>

          <div ref={assigneeRef}>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">メンバー{!ro && "（複数選択可）"}</label>
            {ro ? (
              <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-700">
                {form.assignees.length ? form.assignees.join(", ") : <span className="text-gray-400">未設定</span>}
              </div>
            ) : (
              <>
                <button type="button" onClick={() => setAssigneeOpen((o) => !o)}
                  className={`${FIELD_INPUT} text-left flex items-center justify-between`}>
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
                        && (projects.find((p) => p.id === task.projectId)?.memberNames ?? []).includes(m.name)
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
                {form.assignees.length === 0 && (
                  <p className="text-xs text-red-500 mt-1">メンバーを1名以上選択してください</p>
                )}
              </>
            )}
          </div>

          {renderTextField("進捗メモ", "progressMemo", "現在の状況・ブロッカー・次のアクションなどを記入...")}
          {renderTextField("特記事項", "specialNotes", "注意点・リスク・クライアントへの確認事項など...")}
          {renderTextField("資料", "materials", "関連ドキュメントのURL・ファイル名など（複数ある場合は改行で区切り）")}

          {bodyUrls.length > 0 && (
            <div>
              <div className={LINKCARD.head}>本文中のリンク（{bodyUrls.length}件）</div>
              <div className={LINKCARD.list}>
                {bodyUrls.map((u) => {
                  const p = urlParts(u);
                  return (
                    <a key={u} href={u} target="_blank" rel="noopener noreferrer" title={u} className={LINKCARD.item}>
                      <IconBadge name="doc" size={18} box="w-9 h-9" />
                      <span className="flex-1 min-w-0">
                        <span className={LINKCARD.host}>{p.host}</span>
                        <span className={LINKCARD.url}>{p.label}</span>
                      </span>
                      <span className={LINKCARD.arrow}><Icon name="external" size={16} /></span>
                    </a>
                  );
                })}
              </div>
            </div>
          )}

          {!ro && (!!form.start !== !!form.end) && (
            <p className="text-xs text-red-500">開始日と期限日は両方入力するか、両方空欄にしてください</p>
          )}

          <div className="border-t border-dashed border-gray-200 pt-3 flex gap-8">
            <div>
              <div className="text-[10px] text-gray-400">最終更新日時</div>
              <div className="text-xs text-gray-600">{form.updatedAt ? fmtDT(form.updatedAt) : "—"}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-400">最終更新者</div>
              <div className="text-xs text-gray-600">{form.updatedBy || "—"}</div>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-100 shrink-0">
          {confirmDelete ? (
            <div className="bg-red-50 rounded-lg p-3 border border-red-200">
              <p className="text-sm text-red-700 mb-3 font-medium">一度削除したタスクはもとに戻せません。削除してよろしいですか？</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(false)}
                  className="flex-1 text-sm py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">いいえ</button>
                <button onClick={handleDelete}
                  className="flex-1 text-sm py-2 rounded-lg bg-red-600 text-white hover:bg-red-700">はい</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <button onClick={() => setConfirmDelete(true)} disabled={ro}
                  className="text-sm py-2.5 px-4 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">削除</button>
                <button onClick={handleDuplicate} disabled={ro}
                  className="text-sm py-2.5 px-4 rounded-lg border border-green-200 text-green-700 hover:bg-green-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium">複製</button>
              </div>
              <div className="flex gap-2">
                <button onClick={onClose}
                  className="text-sm py-2.5 px-4 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors">{ro ? "閉じる" : "キャンセル"}</button>
                {!ro && (
                  <button onClick={handleSave} disabled={invalid}
                    className="text-sm py-2.5 px-5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">保存する</button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
