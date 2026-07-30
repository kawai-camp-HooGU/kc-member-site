"use client";
// ============================================================
// フォーム（Lステップ「回答フォーム」相当）
//   一覧 / 編集 / 問合せ（回答）一覧 を内部で切替
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useRoute } from "../hooks/useRoute";
import { FormEdit } from "../components/form/FormEdit";
import { FormSubmissions } from "../components/form/FormSubmissions";
import type { ScenarioOpt } from "../components/form/ActionEditor";
import { fetchForms, deleteForm, duplicateForm, setFormFolder } from "../lib/forms";
import type { FormListItem } from "../lib/forms";
import { useFolders } from "../hooks/useFolders";
import { FolderPane, FOLDER_DND_MIME } from "../components/common/FolderPane";
import { Icon } from "../components/common/Icon";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { fetchScenarios } from "../lib/scenario";
import { FORM_STATUS_LABEL, FORM_VISIBILITY_LABEL } from "../lib/models";
import type { FormStatus, FormVisibility } from "../lib/models";
import { useConfirm } from "../components/common/ConfirmProvider";
import { usePresenceCounts } from "../hooks/usePresenceCount";

const card = "bg-white rounded-xl border border-gray-200";

// 現在このフォームを開いている人数を表示するだけの部品（購読は親で集約）。
//   0人のときは控えめに「—」。
function LiveViewers({ n }: { n: number }) {
  if (n <= 0) return <span className="text-[11px] text-gray-300">—</span>;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600" title="いまこのフォームを開いている人数（概算・接続中タブ数）">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      {n}人
    </span>
  );
}

const STATUS_CLS: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700",
  draft:     "bg-gray-100 text-gray-500",
  closed:    "bg-red-50 text-red-700",
};

export function FormView() {
  // 画面状態は URL（/ops/form ・/ops/form/3 ・/ops/form/3/submissions ・/ops/form/new）
  const route = useRoute();
  const seg0 = route.detail[0] ?? null;
  const editId: number | null = seg0 && seg0 !== "new" ? Number(seg0) : null;
  const sub: "list" | "edit" | "subs" =
    seg0 == null ? "list" : route.detail[1] === "submissions" ? "subs" : "edit";
  const toList = () => route.goDetail([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOpt[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    loadAttributeTree().then(setTree).catch(() => setTree([]));
    fetchScenarios().then((s) => setScenarios(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => setScenarios([]));
  }, []);

  if (sub === "edit") {
    return <FormEdit id={editId} tree={tree} index={index} scenarios={scenarios} onClose={toList} onTreeChange={setTree} />;
  }
  if (sub === "subs" && editId != null) {
    return <FormSubmissions formId={editId} onBack={toList} onEdit={() => route.goDetail([editId])} />;
  }
  return (
    <FormList
      onNew={() => route.goDetail(["new"])}
      onEdit={(id) => route.goDetail([id])}
      onSubs={(id) => route.goDetail([id, "submissions"])}
    />
  );
}

// ── 一覧 ──────────────────────────────────────────────────────
function FormList({ onNew, onEdit, onSubs }: { onNew: () => void; onEdit: (id: number) => void; onSubs: (id: number) => void }) {
  const confirm = useConfirm();
  const [items, setItems] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | FormStatus>("all");

  const reload = useCallback(() => { fetchForms().then((d) => { setItems(d); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);

  // ── フォルダ ──
  const fdr = useFolders("form");
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const i of items) if (i.folderId != null) m.set(i.folderId, (m.get(i.folderId) ?? 0) + 1);
    return m;
  }, [items]);
  const folderName = useMemo(() => new Map(fdr.folders.map((f) => [f.id, f.name])), [fdr.folders]);

  const moveRecord = useCallback(async (recordId: number, targetFolderId: number | null) => {
    const before = items;
    setItems((prev) => prev.map((i) => (i.id === recordId ? { ...i, folderId: targetFolderId } : i)));
    const ok = await setFormFolder(recordId, targetFolderId);
    if (!ok) setItems(before);
  }, [items]);
  const onRowDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.setData(FOLDER_DND_MIME, String(id));
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  };

  // 全フォームの「いま閲覧中」人数を集約観測（フィルタに関係なく全件を対象にする）
  const liveKeys = useMemo(() => items.map((i) => `form:${i.slug}`), [items]);
  const live = usePresenceCounts(liveKeys);
  const liveTotal = useMemo(() => Object.values(live).reduce((a, b) => a + b, 0), [live]);

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((i) => {
      if (status !== "all" && i.status !== status) return false;
      if (fdr.selected !== "all" && i.folderId !== fdr.selected) return false;
      if (kw && !i.name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [items, q, status, fdr.selected]);

  const remove = async (id: number) => {
    if (!(await confirm({ title: "フォームを削除", message: "このフォームを削除しますか？（回答もすべて削除されます）", confirmLabel: "削除する", danger: true }))) return;
    await deleteForm(id);
    reload();
  };
  const copy = async (id: number) => { await duplicateForm(id); reload(); };
  const copyUrl = (slug: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/f/${slug}`);
    alert("公開URLをコピーしました");
  };

  const kpi = {
    forms: items.length,
    published: items.filter((i) => i.status === "published").length,
    answers: items.reduce((n, i) => n + i.total, 0),
    news: items.reduce((n, i) => n + i.newCount, 0),
  };

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col gap-4">
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">Form</h1>
        <span className="text-xs text-gray-400">アンケート・申込み・問合せを受け付け、回答を会員に紐付けて蓄積します</span>
        <button onClick={onNew} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
          ＋ 新規フォーム
        </button>
      </div>

      <div className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className={`${card} p-3.5`}>
          <p className="text-xl font-extrabold text-emerald-600 flex items-center gap-1.5">
            {liveTotal > 0 && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />}
            {liveTotal}
          </p>
          <p className="text-[11px] text-gray-400 mt-0.5">いま閲覧中（全フォーム）</p>
        </div>
        {[
          { n: `${kpi.forms}`, l: `フォーム総数（公開中 ${kpi.published}）`, c: "text-gray-800" },
          { n: `${kpi.answers}`, l: "累計回答数", c: "text-gray-800" },
          { n: `${kpi.news}`, l: "未対応の問合せ", c: "text-amber-600" },
          { n: `${kpi.forms - kpi.published}`, l: "下書き・受付終了", c: "text-gray-400" },
        ].map((b) => (
          <div key={b.l} className={`${card} p-3.5`}>
            <p className={`text-xl font-extrabold ${b.c}`}>{b.n}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{b.l}</p>
          </div>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <FolderPane
          scope="form"
          folders={fdr.folders}
          loading={fdr.loading}
          selected={fdr.selected}
          onSelect={fdr.setSelected}
          counts={counts}
          total={items.length}
          myRole={fdr.myRole}
          canEdit={fdr.canEdit}
          canManage={fdr.canManage}
          onChanged={fdr.reload}
          onMoveRecord={moveRecord}
        />

        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="shrink-0 flex flex-wrap gap-2 items-center px-4 py-3 border-b border-gray-100">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="フォーム名で検索"
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] w-56 focus:outline-none focus:border-red-400" />
            {(["all", "published", "draft", "closed"] as const).map((s) => (
              <button key={s} onClick={() => setStatus(s)}
                className={`px-2.5 py-1 rounded-full text-[11.5px] font-bold border ${
                  status === s ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-500"}`}>
                {s === "all" ? "すべて" : FORM_STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-gray-50/40">
            <div className="p-3 flex flex-col gap-2.5">
              {loading && <div className="text-center text-[12.5px] text-gray-400 py-10">読み込み中...</div>}
              {!loading && rows.length === 0 && (
                <div className="text-center text-[12.5px] text-gray-400 py-10">フォームがありません。「＋ 新規フォーム」から作成してください。</div>
              )}
              {rows.map((f) => (
                <div key={f.id} draggable onDragStart={(e) => onRowDragStart(e, f.id)}
                  className="bg-white border border-gray-200 rounded-xl px-3.5 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow cursor-grab active:cursor-grabbing">
                  <span className="text-gray-300 select-none shrink-0" title="ドラッグでフォルダ移動">⠿</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button onClick={() => onEdit(f.id)} className="text-[14px] font-bold text-gray-900 hover:text-red-600 text-left">{f.name}</button>
                      <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${STATUS_CLS[f.status]}`}>{FORM_STATUS_LABEL[f.status as FormStatus] ?? f.status}</span>
                      {f.folderId != null && folderName.get(f.folderId)
                        ? <span title={folderName.get(f.folderId)} className="inline-flex items-center gap-1 max-w-[180px] text-[10.5px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full pl-1.5 pr-2 py-0.5"><Icon name="folder" size={11} className="text-yellow-500 shrink-0" /><span className="truncate">{folderName.get(f.folderId)}</span></span>
                        : <span className="text-[10.5px] font-bold text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">未分類</span>}
                      {f.newCount > 0 && <span className="text-[10.5px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">未対応 {f.newCount}</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">回答 <b className="text-gray-800">{f.total}</b></span>
                      <LiveViewers n={live[`form:${f.slug}`] ?? 0} />
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">{FORM_VISIBILITY_LABEL[f.visibility as FormVisibility] ?? f.visibility}</span>
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">全{f.fieldCount}問・{f.sectionCount}セクション</span>
                      {f.deadlineAt && <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">期限 {f.deadlineAt.replace("T", " ")}</span>}
                      <button onClick={() => copyUrl(f.slug)} className="text-[10.5px] font-mono text-gray-500 bg-gray-50 border border-gray-200 rounded px-2 py-0.5 hover:bg-gray-100 whitespace-nowrap">/f/{f.slug} 📋</button>
                      <span className="text-[11px] text-gray-400">更新 {(f.updatedAt || "").slice(5, 10)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onSubs(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1">問合せ一覧</button>
                    <button onClick={() => onEdit(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1">編集</button>
                    <button onClick={() => copy(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1">複製</button>
                    <button onClick={() => remove(f.id)} className="text-[11.5px] font-bold text-red-600 border border-gray-200 rounded-lg px-2 py-1">削除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <p className="shrink-0 text-[11.5px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        公開URLはログイン中の会員が開くと自動で本人に紐付きます。外部の方が開いた場合は氏名・メールを入力して回答でき、問合せ一覧から後で会員に紐付けられます。
      </p>
    </div>
  );
}
