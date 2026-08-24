"use client";
// ============================================================
// テンプレート管理（設定 ＞ テンプレート）— 3ペイン
//
//   テンプレート │ フェーズ │ タスク を左から並べ、左で選んだものの中身が
//   右に出る。アコーディオンを開け閉めして探す手間をなくし、「どのテンプレの
//   どのフェーズを見ているか」が常に画面に出ている状態にする。
//
//   ⚠️ フォルダはヘッダのプルダウンへ降格した。3ペインに加えて左端にフォルダ列を
//      置くと4列になり、1列あたりが読めない幅まで痩せるため。
//   ⚠️ 保存は従来と同じ「全置換」（saveTemplateToDb）。タスク1件の編集でも
//      そのテンプレート配下のフェーズ・タスクを作り直すので、
//      template_anken.id / template_tasks.id は保存のたびに変わる。
//      ここに外部から ID 参照する機能を足すときは、先に保存方式を変えること。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { Template } from "../../lib/models";
import type { EditTemplate, EditTask } from "./types";
import { TemplateTaskEditModal } from "./TemplateTaskEditModal";
import { TemplateBulkRegisterModal } from "./TemplateBulkRegisterModal";
import { useFolders } from "../../hooks/useFolders";
import { Icon } from "../common/Icon";
import { FIELD_INPUT, FIELD_SELECT } from "../../lib/constants";

export interface TemplateTabProps {
  templates: Template[];
  onPersist: (t: EditTemplate) => void;
  onCreate: (name: string) => void;
  onDelete: (id: number) => void;
  /** テンプレートを別フォルダへ移動（親で setTemplateFolder ＋ 一覧更新）*/
  onMoveFolder: (id: number, folderId: number | null) => void;
}

interface TaskModalState { tid: number; ai: number; ti: number | null; draft: EditTask }

/** ペイン共通の枠（見出し＋本体＋フッタのボタン） */
function Pane({ title, sub, children, footer, width }: {
  title: string; sub?: string; children: ReactNode; footer?: ReactNode; width?: string;
}) {
  return (
    <div className={`flex flex-col min-w-0 border-r border-gray-200 last:border-r-0 ${width ?? "flex-1"}`}>
      <div className="flex items-baseline gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
        <span className="text-[11px] font-semibold text-gray-400">{title}</span>
        {sub && <span className="text-[11px] text-gray-400 ml-auto">{sub}</span>}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1">{children}</div>
      {footer && <div className="p-2 border-t border-gray-100 shrink-0">{footer}</div>}
    </div>
  );
}

const ADD_BTN = "w-full text-sm py-2 rounded-lg border border-dashed border-gray-300 text-gray-500 hover:border-red-300 hover:text-red-600 transition-colors";

export function TemplateTab({ templates, onPersist, onCreate, onDelete, onMoveFolder }: TemplateTabProps) {
  const fdr = useFolders("template");

  const shownTemplates = useMemo(
    () => templates.filter((t) => fdr.selected === "unfiled" ? t.folderId == null : t.folderId === fdr.selected),
    [templates, fdr.selected],
  );

  const [selTid, setSelTid] = useState<number | null>(null);
  const [selAi,  setSelAi]  = useState<number | null>(null);
  const [taskModal, setTaskModal] = useState<TaskModalState | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);

  const selT = shownTemplates.find((t) => t.id === selTid) ?? null;
  const selA = selT && selAi != null ? selT.anken[selAi] ?? null : null;

  // フォルダを切り替えたら選択を畳む（別フォルダのテンプレートを選んだままにしない）
  useEffect(() => { setSelTid(null); setSelAi(null); }, [fdr.selected]);
  // 選択中テンプレートが消えた／フェーズが減ったときの取りこぼしを防ぐ
  useEffect(() => {
    if (selTid != null && !shownTemplates.some((t) => t.id === selTid)) { setSelTid(null); setSelAi(null); }
    else if (selT && selAi != null && selAi >= selT.anken.length) setSelAi(null);
  }, [shownTemplates, selTid, selT, selAi]);

  const clone = (t: Template): EditTemplate => JSON.parse(JSON.stringify(t)) as EditTemplate;
  const mutate = (tid: number, fn: (t: EditTemplate) => void) => {
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    const nt = clone(t);
    fn(nt);
    onPersist(nt);
  };

  const addAnken = (tid: number) => {
    const t = templates.find((x) => x.id === tid);
    mutate(tid, (nt) => { nt.anken.push({ name: "新しいフェーズ", tasks: [] }); });
    if (t) setSelAi(t.anken.length);   // 追加した行をそのまま開く
  };
  const delAnken = (tid: number, ai: number) => { mutate(tid, (t) => { t.anken.splice(ai, 1); }); setSelAi(null); };
  const renameAnken = (tid: number, ai: number, name: string) => {
    const t = templates.find((x) => x.id === tid);
    if (!t || !name.trim() || t.anken[ai]?.name === name.trim()) return;
    mutate(tid, (nt) => { nt.anken[ai]!.name = name.trim(); });
  };
  const renameTemplate = (tid: number, name: string) => {
    const t = templates.find((x) => x.id === tid);
    if (!t || !name.trim() || t.name === name.trim()) return;
    mutate(tid, (nt) => { nt.name = name.trim(); });
  };
  const delTask = (tid: number, ai: number, ti: number) => mutate(tid, (t) => { t.anken[ai]!.tasks.splice(ti, 1); });
  const saveTask = (draft: EditTask) => {
    if (!taskModal) return;
    const { tid, ai, ti } = taskModal;
    mutate(tid, (t) => { if (ti == null) t.anken[ai]!.tasks.push(draft); else t.anken[ai]!.tasks[ti] = draft; });
    setTaskModal(null);
  };

  /** 重要度のドット。Ⅰ〜Ⅲは赤の濃淡、なしはグレー（IMPORTANCE_CONFIG と同じ序列） */
  const impDot = (imp: string | number | undefined) => {
    const k = String(imp ?? "none");
    const cls = k === "1" ? "bg-red-400" : k === "2" ? "bg-red-600" : k === "3" ? "bg-red-700" : "bg-gray-300";
    const label = k === "none" ? "重要度なし" : `重要度${k === "1" ? "Ⅰ" : k === "2" ? "Ⅱ" : "Ⅲ"}`;
    return <span className={`w-2 h-2 rounded-full shrink-0 ${cls}`} title={label} />;
  };
  const blank = (v: number | string | undefined) => v === "" || v == null;
  const dayLabel = (t: EditTask) =>
    (blank(t.startOffset) && blank(t.endOffset)) ? "日付なし"
      : `${blank(t.startOffset) ? "—" : t.startOffset}〜${blank(t.endOffset) ? "—" : t.endOffset}日`;

  const taskTotal = (t: Template) => t.anken.reduce((s, a) => s + a.tasks.length, 0);

  return (
    <div className="space-y-3">
      {/* ── ヘッダ：パンくず ＋ フォルダ ＋ 一括登録 ── */}
      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex items-center gap-1.5 text-sm min-w-0" aria-label="パンくず">
          <button onClick={() => { setSelTid(null); setSelAi(null); }}
            className={selTid == null ? "text-gray-800 font-bold" : "text-red-600 hover:text-red-800"}>テンプレート</button>
          {selT && (
            <>
              <span className="text-gray-300">/</span>
              <button onClick={() => setSelAi(null)}
                className={`truncate max-w-[14rem] ${selAi == null ? "text-gray-800 font-bold" : "text-red-600 hover:text-red-800"}`}>{selT.name}</button>
            </>
          )}
          {selA && (
            <>
              <span className="text-gray-300">/</span>
              <span className="text-gray-800 font-bold truncate max-w-[14rem]">{selA.name}</span>
            </>
          )}
        </nav>

        <span className="text-xs text-gray-400">{shownTemplates.length} 件</span>

        <div className="ml-auto flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-gray-500">
            <Icon name="folder" size={15} />
            <select value={String(fdr.selected)} disabled={fdr.loading}
              onChange={(e) => fdr.setSelected(e.target.value === "unfiled" ? "unfiled" : Number(e.target.value))}
              aria-label="フォルダ" className={`${FIELD_SELECT} w-44`}>
              <option value="unfiled">未分類</option>
              {fdr.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </span>
          <button onClick={() => setBulkOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-sm hover:bg-red-50 whitespace-nowrap">▤ 一括登録</button>
        </div>
      </div>

      {bulkOpen && <TemplateBulkRegisterModal onClose={() => setBulkOpen(false)} onPersist={onPersist} />}

      {/* ── 3ペイン ── */}
      <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden" style={{ minHeight: "26rem" }}>
        {/* 1. テンプレート */}
        <Pane title="テンプレート" sub={`${shownTemplates.length} 件`} width="w-60 shrink-0"
          footer={adding ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus className={`${FIELD_INPUT} flex-1 min-w-0`} value={newName} placeholder="テンプレート名"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onCreate(newName); setNewName(""); setAdding(false); } }} />
              <button onClick={() => { if (newName.trim()) { onCreate(newName); setNewName(""); setAdding(false); } }} disabled={!newName.trim()}
                className="px-2.5 py-2 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 disabled:opacity-40 shrink-0">追加</button>
              <button onClick={() => { setAdding(false); setNewName(""); }} className="text-sm text-gray-400 px-1 shrink-0">×</button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} className={ADD_BTN}>＋ テンプレートを追加</button>
          )}>
          {shownTemplates.length === 0 && <p className="text-xs text-gray-300 text-center py-8">テンプレートがありません</p>}
          {shownTemplates.map((t) => (
            <button key={t.id ?? t.name} onClick={() => { setSelTid(t.id); setSelAi(null); }}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                selTid === t.id ? "bg-red-50 ring-1 ring-red-200" : "hover:bg-gray-50"}`}>
              <span className={`w-1 h-7 rounded-full shrink-0 ${selTid === t.id ? "bg-red-600" : "bg-gray-200"}`} />
              <span className={`flex-1 min-w-0 text-sm truncate ${selTid === t.id ? "font-bold text-red-700" : "text-gray-700"}`}>{t.name}</span>
              <span className="text-[11px] text-gray-400 shrink-0">{taskTotal(t)}</span>
            </button>
          ))}
        </Pane>

        {/* 2. フェーズ */}
        <Pane title="フェーズ" sub={selT ? `${selT.anken.length} フェーズ` : undefined} width="w-64 shrink-0"
          footer={selT ? <button onClick={() => selT.id != null && addAnken(selT.id)} className={ADD_BTN}>＋ フェーズを追加</button> : undefined}>
          {!selT && <p className="text-xs text-gray-300 text-center py-8">左でテンプレートを選んでください</p>}
          {selT && selT.anken.length === 0 && <p className="text-xs text-gray-300 text-center py-8">「＋ フェーズを追加」で追加してください</p>}
          {selT?.anken.map((a, ai) => (
            <button key={ai} onClick={() => setSelAi(ai)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors ${
                selAi === ai ? "bg-red-50 ring-1 ring-red-200" : "hover:bg-gray-50"}`}>
              <span className={`w-1 h-7 rounded-full shrink-0 ${selAi === ai ? "bg-red-600" : "bg-gray-200"}`} />
              <span className={`flex-1 min-w-0 text-sm truncate ${selAi === ai ? "font-bold text-red-700" : "text-gray-700"}`}>{a.name}</span>
              <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-1.5 shrink-0">{a.tasks.length}</span>
            </button>
          ))}
        </Pane>

        {/* 3. タスク（フェーズ未選択のときはテンプレート自体の設定） */}
        <Pane title="タスク" sub={selA ? `${selA.tasks.length} タスク` : undefined}
          footer={selA && selT?.id != null && selAi != null ? (
            <button onClick={() => setTaskModal({
              tid: selT.id!, ai: selAi, ti: null,
              draft: { name: "", importance: "none", startOffset: 0, endOffset: 7, progressMemo: "", specialNotes: "", materials: "" },
            })} className={ADD_BTN}>＋ タスクを追加</button>
          ) : undefined}>
          {!selT && <p className="text-xs text-gray-300 text-center py-8">テンプレートとフェーズを選ぶと、ここにタスクが並びます</p>}

          {selT && !selA && (
            <div className="space-y-3 px-1 py-1">
              <div>
                <label className="text-xs text-gray-500 block mb-1">テンプレート名</label>
                <input defaultValue={selT.name} key={`${selT.id}-${selT.name}`} className={FIELD_INPUT}
                  onBlur={(e) => selT.id != null && renameTemplate(selT.id, e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">フォルダ</label>
                <select value={selT.folderId ?? ""} className={`${FIELD_INPUT} bg-white`}
                  onChange={(e) => selT.id != null && onMoveFolder(selT.id, e.target.value === "" ? null : Number(e.target.value))}>
                  <option value="">未分類</option>
                  {fdr.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                </select>
              </div>
              <p className="text-[11px] text-gray-400">
                {selT.anken.length} フェーズ / {taskTotal(selT)} タスク。左の「フェーズ」から選ぶとタスクを編集できます。
              </p>
              <div className="pt-2 border-t border-gray-100">
                <button onClick={() => selT.id != null && onDelete(selT.id)}
                  className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 transition-colors">
                  このテンプレートを削除
                </button>
              </div>
            </div>
          )}

          {selT && selA && selAi != null && (
            <>
              <div className="flex items-center gap-2 px-1 pb-2 mb-1 border-b border-gray-100">
                <input defaultValue={selA.name} key={`${selT.id}-${selAi}-${selA.name}`}
                  onBlur={(e) => selT.id != null && renameAnken(selT.id, selAi, e.target.value)}
                  className={`${FIELD_INPUT} flex-1 min-w-0 font-bold`} placeholder="フェーズ名" />
                <button onClick={() => selT.id != null && delAnken(selT.id, selAi)}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0 whitespace-nowrap">フェーズを削除</button>
              </div>

              {selA.tasks.length === 0 && <p className="text-xs text-gray-300 text-center py-8">タスクがありません</p>}
              {selA.tasks.map((tk, ti) => (
                <div key={ti} className="group flex items-center gap-2.5 px-2.5 py-2 rounded-lg hover:bg-gray-50 border-b border-gray-50 last:border-b-0">
                  {impDot(tk.importance)}
                  <span className="flex-1 min-w-0 text-sm text-gray-800 truncate">
                    {tk.name || <span className="text-gray-300">（名称未入力）</span>}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{dayLabel(tk)}</span>
                  <span className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => selT.id != null && setTaskModal({ tid: selT.id, ai: selAi, ti, draft: { ...tk } })}
                      className="text-xs text-red-600 hover:text-red-800 px-1">編集</button>
                    <button onClick={() => selT.id != null && delTask(selT.id, selAi, ti)}
                      className="text-xs text-gray-400 hover:text-red-600 px-1">削除</button>
                  </span>
                </div>
              ))}
            </>
          )}
        </Pane>
      </div>

      {taskModal && (
        <TemplateTaskEditModal task={taskModal.draft}
          onClose={() => setTaskModal(null)}
          onSave={saveTask}
          onDelete={taskModal.ti != null ? () => { delTask(taskModal.tid, taskModal.ai, taskModal.ti!); setTaskModal(null); } : undefined} />
      )}
    </div>
  );
}
