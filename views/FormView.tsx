"use client";
// ============================================================
// フォーム（Lステップ「回答フォーム」相当）
//   一覧 / 編集 / 問合せ（回答）一覧 を内部で切替
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { FormEdit } from "../components/form/FormEdit";
import { FormSubmissions } from "../components/form/FormSubmissions";
import type { ScenarioOpt } from "../components/form/ActionEditor";
import { fetchForms, deleteForm, duplicateForm } from "../lib/forms";
import type { FormListItem } from "../lib/forms";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { fetchScenarios } from "../lib/scenario";
import { FORM_STATUS_LABEL, FORM_VISIBILITY_LABEL } from "../lib/models";
import type { FormStatus, FormVisibility } from "../lib/models";

const card = "bg-white rounded-xl border border-gray-200";

const STATUS_CLS: Record<string, string> = {
  published: "bg-emerald-50 text-emerald-700",
  draft:     "bg-gray-100 text-gray-500",
  closed:    "bg-red-50 text-red-700",
};

export function FormView() {
  const [sub, setSub] = useState<"list" | "edit" | "subs">("list");
  const [editId, setEditId] = useState<number | null>(null);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOpt[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  useEffect(() => {
    loadAttributeTree().then(setTree).catch(() => setTree([]));
    fetchScenarios().then((s) => setScenarios(s.map((x) => ({ id: x.id, name: x.name })))).catch(() => setScenarios([]));
  }, []);

  if (sub === "edit") {
    return <FormEdit id={editId} tree={tree} index={index} scenarios={scenarios} onClose={() => setSub("list")} />;
  }
  if (sub === "subs" && editId != null) {
    return <FormSubmissions formId={editId} onBack={() => setSub("list")} onEdit={() => setSub("edit")} />;
  }
  return (
    <FormList
      onNew={() => { setEditId(null); setSub("edit"); }}
      onEdit={(id) => { setEditId(id); setSub("edit"); }}
      onSubs={(id) => { setEditId(id); setSub("subs"); }}
    />
  );
}

// ── 一覧 ──────────────────────────────────────────────────────
function FormList({ onNew, onEdit, onSubs }: { onNew: () => void; onEdit: (id: number) => void; onSubs: (id: number) => void }) {
  const [items, setItems] = useState<FormListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"all" | FormStatus>("all");
  const [folder, setFolder] = useState("all");

  const reload = useCallback(() => { fetchForms().then((d) => { setItems(d); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);

  const folders = useMemo(
    () => Array.from(new Set(items.map((i) => i.folder).filter(Boolean))) as string[],
    [items],
  );

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return items.filter((i) => {
      if (status !== "all" && i.status !== status) return false;
      if (folder !== "all" && i.folder !== folder) return false;
      if (kw && !i.name.toLowerCase().includes(kw)) return false;
      return true;
    });
  }, [items, q, status, folder]);

  const remove = async (id: number) => {
    if (!confirm("このフォームを削除しますか？（回答もすべて削除されます）")) return;
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
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">Form</h1>
        <span className="text-xs text-gray-400">アンケート・申込み・問合せを受け付け、回答を会員に紐付けて蓄積します</span>
        <button onClick={onNew} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
          ＋ 新規フォーム
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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

      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="フォーム名で検索"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] w-56 focus:outline-none focus:border-red-400" />
        <select value={folder} onChange={(e) => setFolder(e.target.value)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white">
          <option value="all">すべてのフォルダ</option>
          {folders.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        {(["all", "published", "draft", "closed"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)}
            className={`px-2.5 py-1 rounded-full text-[11.5px] font-bold border ${
              status === s ? "bg-red-50 border-red-200 text-red-700" : "bg-white border-gray-200 text-gray-500"}`}>
            {s === "all" ? "すべて" : FORM_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              {["フォーム名", "ステータス", "公開範囲", "回答数", "回答期限", "公開URL", "更新日", ""].map((h, i) => (
                <th key={i} className="text-[11px] text-gray-400 font-bold text-left px-3 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={8} className="text-center text-[12.5px] text-gray-400 py-10">読み込み中...</td></tr>}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={8} className="text-center text-[12.5px] text-gray-400 py-10">フォームがありません。「＋ 新規フォーム」から作成してください。</td></tr>
            )}
            {rows.map((f) => (
              <tr key={f.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-3 py-3">
                  <button onClick={() => onEdit(f.id)} className="text-[13px] font-bold text-gray-800 hover:text-red-600 text-left">{f.name}</button>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {f.folder ? `📁 ${f.folder} ／ ` : ""}全{f.fieldCount}問・{f.sectionCount}セクション
                  </p>
                </td>
                <td className="px-3 py-3">
                  <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${STATUS_CLS[f.status]}`}>
                    {FORM_STATUS_LABEL[f.status as FormStatus] ?? f.status}
                  </span>
                </td>
                <td className="px-3 py-3 text-[12px] text-gray-500">{FORM_VISIBILITY_LABEL[f.visibility as FormVisibility] ?? f.visibility}</td>
                <td className="px-3 py-3">
                  <span className="text-[13px] font-bold text-gray-800">{f.total}</span>
                  {f.newCount > 0 && <p className="text-[10.5px] text-amber-600 font-bold">未対応 {f.newCount}</p>}
                </td>
                <td className="px-3 py-3 text-[12px] text-gray-500 whitespace-nowrap">{f.deadlineAt ? f.deadlineAt.replace("T", " ") : "—"}</td>
                <td className="px-3 py-3">
                  <button onClick={() => copyUrl(f.slug)}
                    className="text-[11px] font-mono bg-gray-50 border border-gray-200 rounded px-2 py-1 text-gray-500 hover:bg-gray-100 whitespace-nowrap">
                    /f/{f.slug} 📋
                  </button>
                </td>
                <td className="px-3 py-3 text-[12px] text-gray-400 whitespace-nowrap">{(f.updatedAt || "").slice(5, 10)}</td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <button onClick={() => onSubs(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 mr-1">問合せ一覧</button>
                  <button onClick={() => onEdit(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 mr-1">編集</button>
                  <button onClick={() => copy(f.id)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1 mr-1">複製</button>
                  <button onClick={() => remove(f.id)} className="text-[11.5px] font-bold text-red-600 border border-gray-200 rounded-lg px-2 py-1">削除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[11.5px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        公開URLはログイン中の会員が開くと自動で本人に紐付きます。外部の方が開いた場合は氏名・メールを入力して回答でき、問合せ一覧から後で会員に紐付けられます。
      </p>
    </div>
  );
}
