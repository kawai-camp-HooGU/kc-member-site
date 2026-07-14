"use client";
// ============================================================
// イベント（予定）の登録・編集モーダル ─ 運営のみ
//   カレンダーの「＋ 予定を追加」と 設定＞イベント・予定 の両方から使う。
//   出欠は持たず、申込はフォーム機能で作ったフォームを紐付けて受ける。
// ============================================================
import { useEffect, useState } from "react";
import { saveEvent, deleteEvent, fetchFormBriefs } from "../../lib/events";
import type { FormBrief } from "../../lib/events";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { AttrTable } from "../master/AttrTable";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { EVENT_KIND_LABEL, EVENT_KIND_COLOR } from "../../lib/models";
import type { CalEvent, EventKind, PublishMode } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";

const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const COLORS = ["#0d9488", "#2563eb", "#7c3aed", "#ea580c", "#e11d2a", "#0891b2"];
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const STATUS_LABEL: Record<string, string> = { draft: "下書き", published: "公開中", closed: "受付終了" };

export function EventEditModal({
  value, onClose, onSaved,
}: { value: CalEvent; onClose: () => void; onSaved: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const [e, setE] = useState<CalEvent>(value);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [forms, setForms] = useState<FormBrief[]>([]);
  const index = buildAttrIndex(tree);

  useEffect(() => {
    (async () => {
      const [t, f] = await Promise.all([loadAttributeTree(), fetchFormBriefs()]);
      setTree(t); setForms(f);
    })();
  }, []);

  const form = e.formId != null ? forms.find((f) => f.id === e.formId) ?? null : null;

  const doSave = async () => {
    if (!e.title.trim()) { alert("タイトルを入力してください"); return; }
    if (e.endAt && e.startAt && e.endAt < e.startAt) { alert("終了日時が開始日時より前になっています"); return; }
    const id = await saveEvent(e);
    if (id == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    toast.success("保存しました");
    onSaved(); onClose();
  };
  const doDelete = async () => {
    if (!e.id) return;
    if (!(await confirm({ title: "予定を削除", message: `「${e.title}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return;
    await deleteEvent(e.id);
    toast.success("削除しました");
    onSaved(); onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[70] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(ev) => ev.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800">{e.id ? "予定を編集" : "予定を追加"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">タイトル <span className="text-red-500">*</span></label>
            <input className={input} value={e.title} onChange={(ev) => setE({ ...e, title: ev.target.value })} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">種別</label>
              <select className={`${input} bg-white`} value={e.kind}
                onChange={(ev) => {
                  const k = ev.target.value as EventKind;
                  setE({ ...e, kind: k, color: EVENT_KIND_COLOR[k] });
                }}>
                {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => (
                  <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">色</label>
              <div className="flex gap-1.5 pt-1">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => setE({ ...e, color: c })}
                    className={`w-7 h-7 rounded-lg ${e.color === c ? "ring-2 ring-offset-2 ring-gray-400" : ""}`}
                    style={{ background: c }} aria-label={c} />
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-3.5">
            <label className="inline-flex items-center gap-2 text-xs font-bold text-gray-600 mb-2.5 cursor-pointer">
              <input type="checkbox" className="w-4 h-4 accent-red-600"
                checked={e.allDay} onChange={(ev) => setE({ ...e, allDay: ev.target.checked })} />
              終日
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">開始</label>
                <input type="datetime-local" className={input} value={e.startAt}
                  onChange={(ev) => setE({ ...e, startAt: ev.target.value })} />
              </div>
              <div>
                <label className="text-[11px] font-bold text-gray-500 block mb-1">終了</label>
                <input type="datetime-local" className={input} value={e.endAt}
                  onChange={(ev) => setE({ ...e, endAt: ev.target.value })} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">場所 <span className="text-gray-400 font-normal">任意</span></label>
              <input className={input} value={e.location} onChange={(ev) => setE({ ...e, location: ev.target.value })} />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 block mb-1">関連URL <span className="text-gray-400 font-normal">任意</span></label>
              <input className={input} value={e.url} placeholder="https://…" onChange={(ev) => setE({ ...e, url: ev.target.value })} />
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">説明 <span className="text-gray-400 font-normal">任意</span></label>
            <textarea className={`${input} min-h-[80px]`} value={e.bodyText}
              onChange={(ev) => setE({ ...e, bodyText: ev.target.value })} />
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">
              公開対象属性 <span className="text-gray-400 font-normal">未選択なら全員</span>
            </label>
            <AttrTable tree={tree} index={index} value={e.attrIds}
              onChange={(ids) => setE({ ...e, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
            <div className="mt-2">
              <label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
              <select className={`${input} bg-white`} value={e.attrMode}
                onChange={(ev) => setE({ ...e, attrMode: ev.target.value as PublishMode })}>
                {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
          </div>

          {/* 申込・回答フォームの紐付け（出欠機能の代わり） */}
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50/50 p-3.5">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input type="checkbox" className="mt-0.5 w-4 h-4 accent-blue-600"
                checked={e.formId != null}
                onChange={(ev) => setE({ ...e, formId: ev.target.checked ? (forms[0]?.id ?? null) : null })} />
              <span>
                <span className="text-sm font-bold text-blue-900">申込・回答フォームを紐付ける</span>
                <span className="block text-[11px] text-blue-700 mt-0.5">
                  フォーム管理で作成済みのフォームから選びます。イベント詳細に「申し込む」ボタンが出て、回答状況を集計できます。
                </span>
              </span>
            </label>

            {e.formId != null && (
              <div className="mt-3 space-y-2.5 pl-6">
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1">フォームを選択</label>
                  <select className={`${input} bg-white`} value={e.formId ?? ""}
                    onChange={(ev) => setE({ ...e, formId: ev.target.value ? Number(ev.target.value) : null })}>
                    {forms.length === 0 && <option value="">（フォームがありません）</option>}
                    {forms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name || "無題のフォーム"}（{STATUS_LABEL[f.status] ?? f.status}
                        {f.deadlineAt ? ` ・期限 ${f.deadlineAt.slice(5, 10).replace("-", "/")}` : ""}）
                      </option>
                    ))}
                  </select>
                </div>
                {form && (
                  <div className="rounded-lg bg-white border border-blue-100 px-3 py-2 text-[11.5px] text-gray-600 flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-800">{form.name}</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold text-[10.5px] ${form.status === "published" ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-500"}`}>
                      {STATUS_LABEL[form.status] ?? form.status}
                    </span>
                    <span className="font-mono">/f/{form.slug}</span>
                    {form.deadlineAt && <span className="text-gray-400">・回答期限 {form.deadlineAt.replace("T", " ")}</span>}
                  </div>
                )}
                <label className="inline-flex items-center gap-2 text-[12px] font-bold text-blue-800 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 accent-blue-600"
                    checked={e.showFormDeadline}
                    onChange={(ev) => setE({ ...e, showFormDeadline: ev.target.checked })} />
                  フォームの回答期限もカレンダーに表示する
                </label>
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">公開状態</label>
            <div className="flex items-center gap-2.5">
              <button type="button" onClick={() => setE({ ...e, published: !e.published })}
                className={`relative w-10 h-[21px] rounded-full ${e.published ? "bg-green-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${e.published ? "left-[21px]" : "left-0.5"}`} />
              </button>
              <span className="text-xs text-gray-600">{e.published ? "公開（カレンダーに表示）" : "下書き（運営にのみ表示）"}</span>
            </div>
          </div>

          {e.newsId != null && (
            <p className="text-[11px] text-gray-400">※ この予定はお知らせから作成されています。お知らせを削除すると予定も削除されます。</p>
          )}
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
          {e.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <SaveButton onSave={doSave} />
        </div>
      </div>
    </div>
  );
}
