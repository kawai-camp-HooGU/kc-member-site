"use client";
// ============================================================
// ブックマーク一覧・メンテナンス（運営）  view = "bookmarks"
//   左＝一覧（ジャンル・キーワードで抽出）／右＝編集パネル（コンテンツ設定と同じ）
//   AI利用トグル・AI再生成・手修正・削除。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useMaster } from "../hooks/useMaster";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import {
  BOOKMARK_GENRES, fetchBookmarks, updateBookmark, deleteBookmark, regenerateBookmark, setBookmarkFolder,
  createDirectBookmark,
} from "../lib/bookmarks";
import type { ChatBookmark } from "../lib/bookmarks";
import { useFolders } from "../hooks/useFolders";
import { FolderPane, FOLDER_DND_MIME } from "../components/common/FolderPane";
import { Icon } from "../components/common/Icon";
import { KnowledgeStatusPanel } from "../components/knowledge/KnowledgeStatusPanel";

const GENRE_CLS: Record<string, string> = {
  "アプローチ": "bg-sky-100 text-sky-700",
  "クレーム": "bg-red-100 text-red-700",
  "説明": "bg-emerald-100 text-emerald-700",
  "申込・手続き": "bg-amber-100 text-amber-700",
  "料金・支払い": "bg-violet-100 text-violet-700",
  "予約・日程": "bg-cyan-100 text-cyan-700",
  "解約・返金": "bg-rose-100 text-rose-700",
  "フォローアップ": "bg-teal-100 text-teal-700",
};
const gcls = (g: string) => GENRE_CLS[g] ?? "bg-gray-100 text-gray-600";
import { fmtJst } from "../lib/dateFmt";
const fmt = (s: string | null) => fmtJst(s);
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} type="button"
      className={`relative w-9 h-[19px] rounded-full shrink-0 ${on ? "bg-emerald-500" : "bg-gray-300"}`}>
      <span className={`absolute top-0.5 w-[15px] h-[15px] rounded-full bg-white transition-all ${on ? "left-[19px]" : "left-0.5"}`} />
    </button>
  );
}

export function BookmarksView() {
  const { members } = useMaster();
  const toast = useToast();
  const confirm = useConfirm();

  const [rows, setRows] = useState<ChatBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [kw, setKw] = useState("");
  const [genreF, setGenreF] = useState("");
  const [sel, setSel] = useState<ChatBookmark | null>(null);   // 編集中（コピーを保持）
  const [busy, setBusy] = useState(false);
  const [kwInput, setKwInput] = useState("");
  const [pendingOnly, setPendingOnly] = useState(false);
  const [creating, setCreating] = useState(false);

  const memberName = (id: number | null) => (id != null ? (members.find((m) => m.id === id)?.name ?? "（不明）") : "—");

  const reload = async () => setRows(await fetchBookmarks());
  useEffect(() => { (async () => { setRows(await fetchBookmarks()); setLoading(false); })(); }, []);

  // ── フォルダ ──
  const fdr = useFolders("bookmark");
  const fcounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (r.folderId != null) m.set(r.folderId, (m.get(r.folderId) ?? 0) + 1);
    return m;
  }, [rows]);
  const folderName = useMemo(() => new Map(fdr.folders.map((f) => [f.id, f.name])), [fdr.folders]);
  const moveFolder = async (recordId: number, targetFolderId: number | null) => {
    setRows((prev) => prev.map((r) => (r.id === recordId ? { ...r, folderId: targetFolderId } : r)));
    await setBookmarkFolder(recordId, targetFolderId);
  };
  const onRowDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.setData(FOLDER_DND_MIME, String(id));
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  };

  const filtered = useMemo(() => {
    const k = kw.trim().toLowerCase();
    return rows.filter((r) => {
      if (fdr.selected === "unfiled" ? r.folderId != null : r.folderId !== fdr.selected) return false;
      if (genreF && r.genre !== genreF) return false;
      if (pendingOnly && !r.aiPending) return false;
      if (!k) return true;
      return [r.originalText, r.expectedQuestion, r.formattedReply, r.keywords.join(" "), memberName(r.sourceMemberId)]
        .some((s) => (s ?? "").toLowerCase().includes(k));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, kw, genreF, pendingOnly, members, fdr.selected]);

  const pending = rows.filter((r) => r.aiPending).length;
  const enabled = rows.filter((r) => r.aiEnabled).length;

  const open = (b: ChatBookmark) => { setSel({ ...b }); setKwInput(""); };

  const save = async () => {
    if (!sel) return;
    setBusy(true);
    const ok = await updateBookmark(sel.id, {
      genre: sel.genre, expectedQuestion: sel.expectedQuestion,
      keywords: sel.keywords, formattedReply: sel.formattedReply,
    });
    setBusy(false);
    if (ok) { toast.success("保存しました"); await reload(); setSel(null); }
    else toast.error("保存に失敗しました");
  };
  const toggleAi = async (b: ChatBookmark) => {
    await updateBookmark(b.id, { aiEnabled: !b.aiEnabled });
    setRows((prev) => prev.map((x) => (x.id === b.id ? { ...x, aiEnabled: !x.aiEnabled } : x)));
    if (sel?.id === b.id) setSel({ ...sel, aiEnabled: !sel.aiEnabled });
  };
  const regen = async () => {
    if (!sel) return;
    setBusy(true);
    const r = await regenerateBookmark(sel.id);
    setBusy(false);
    if (!r.ok) { toast.error(r.error ?? "再生成に失敗しました"); return; }
    toast.success("AIで再生成しました");
    const fresh = await fetchBookmarks(); setRows(fresh);
    const u = fresh.find((x) => x.id === sel.id); if (u) setSel({ ...u });
  };
  const del = async () => {
    if (!sel) return;
    if (!(await confirm({ title: "ブックマークを削除", message: "このブックマークを削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    await deleteBookmark(sel.id); toast.success("削除しました"); await reload(); setSel(null);
  };
  const addKw = () => {
    const t = kwInput.trim();
    if (!sel || !t || sel.keywords.includes(t)) { setKwInput(""); return; }
    setSel({ ...sel, keywords: [...sel.keywords, t] }); setKwInput("");
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 m-0">ナレッジ</h1>
        <p className="text-xs text-gray-400 mt-1">AIが回答の根拠にする材料を管理します。AI利用がONのブックマークは返信案・チャットボットの両方から参照されます。</p>
      </div>

      {/* 取り込み状況（同期・評価の実行導線はここに一本化） */}
      <KnowledgeStatusPanel />

      {/* 統計 */}
      <div className="flex gap-3 flex-wrap">
        {[["登録数", `${rows.length} 件`, ""], ["AI利用中", `${enabled} 件`, "text-emerald-600"], ["要確認（AI未生成）", `${pending} 件`, pending ? "text-amber-600" : ""]].map(([k, v, c]) => (
          <div key={k} className="flex-1 min-w-[120px] bg-white border border-gray-200 rounded-xl px-4 py-2.5">
            <div className="text-[11px] text-gray-400">{k}</div><div className={`text-xl font-extrabold ${c}`}>{v}</div>
          </div>
        ))}
      </div>

      {/* 抽出 */}
      <div className="flex items-center gap-2 flex-wrap">
        <input className={`${input} max-w-xs`} placeholder="原文・想定質問・キーワードで検索" value={kw} onChange={(e) => setKw(e.target.value)} />
        <select className={`${input} bg-white max-w-[180px]`} value={genreF} onChange={(e) => setGenreF(e.target.value)}>
          <option value="">ジャンル：すべて</option>
          {BOOKMARK_GENRES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <button type="button" onClick={() => setPendingOnly((v) => !v)}
          className={`text-[12px] font-bold px-3 py-1.5 rounded-full border ${pendingOnly ? "bg-amber-50 border-amber-300 text-amber-700" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
          要確認のみ{pending > 0 && ` (${pending})`}
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => setCreating(true)}
          className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700">新規登録</button>
      </div>

      <div className={sel ? "grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-4 items-start" : ""}>
        {/* ── 左：フォルダ＋一覧 ── */}
        <div className="flex border border-gray-200 rounded-xl overflow-hidden self-start bg-white">
          <FolderPane scope="bookmark" folders={fdr.folders} loading={fdr.loading} selected={fdr.selected} onSelect={fdr.setSelected}
            counts={fcounts} total={rows.length} myRole={fdr.myRole} canEdit={fdr.canEdit} canManage={fdr.canManage}
            onChanged={fdr.reload} onMoveRecord={moveFolder} />
          <div className="flex-1 min-w-0">
          {filtered.length === 0 ? (
            <div className="text-center text-gray-300 py-10 text-sm">該当するブックマークはありません。</div>
          ) : filtered.map((b, i) => (
            <div key={b.id} draggable onDragStart={(e) => onRowDragStart(e, b.id)} onClick={() => open(b)}
              className={`flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""} ${sel?.id === b.id ? "bg-red-50" : ""}`}>
              <span className="text-gray-300 select-none cursor-grab shrink-0 mt-0.5" title="ドラッグでフォルダ移動">⠿</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-[13px] font-bold text-gray-800">{memberName(b.sourceMemberId)}</span>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${gcls(b.genre)}`}>{b.genre}</span>
                  {b.aiPending && <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">要確認</span>}
                  {b.folderId != null && folderName.get(b.folderId) && (
                    <span title={folderName.get(b.folderId)} className="inline-flex items-center gap-1 max-w-[140px] text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full pl-1.5 pr-2 py-0.5">
                      <Icon name="folder" size={10} className="text-yellow-500 shrink-0" /><span className="truncate">{folderName.get(b.folderId)}</span>
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-gray-600 line-clamp-2">{b.originalText}</div>
                <div className="text-[10.5px] text-gray-400 mt-1">
                  対象トーク {fmt(b.sourceMessageAt)} ・ 登録 {fmt(b.createdAt)}
                  {b.keywords.length > 0 && <span className="ml-2">{b.keywords.slice(0, 4).map((k) => <span key={k} className="inline-block bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5 mr-1">{k}</span>)}</span>}
                </div>
              </div>
              <div onClick={(e) => { e.stopPropagation(); toggleAi(b); }} title="AI利用" className="shrink-0 self-center"><Toggle on={b.aiEnabled} onClick={() => {}} /></div>
            </div>
          ))}
          </div>
        </div>

        {/* ── 右：編集パネル ── */}
        {sel && (
          <div className="lg:sticky lg:top-4 self-start min-w-0">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm flex flex-col max-h-[calc(100vh-7rem)]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <h2 className="font-bold text-gray-800">ブックマークを編集</h2>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-500">AI利用<Toggle on={sel.aiEnabled} onClick={() => toggleAi(sel)} /></span>
                  <button onClick={() => setSel(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4 overflow-y-auto">
                <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 text-[11.5px] text-gray-500 leading-relaxed">
                  登録元トーク：<b className="text-gray-700">{memberName(sel.sourceMemberId)}</b>（トーク {fmt(sel.sourceMessageAt)}）　／　登録日時：{fmt(sel.createdAt)}
                </div>

                <div className="flex items-center gap-2.5 bg-indigo-50 border border-dashed border-indigo-200 rounded-xl px-3 py-2.5">
                  <span className="text-[11.5px] text-indigo-700 flex-1 leading-relaxed">各項目はAIが原文から自動生成。内容を直接修正するか、AIで作り直せます。</span>
                  <button onClick={regen} disabled={busy} className="shrink-0 px-3 py-2 rounded-lg bg-indigo-600 text-white text-[12px] font-bold hover:bg-indigo-700 disabled:opacity-40">{busy ? "生成中…" : "✦ AIで再生成"}</button>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">ジャンル <span className="text-red-500">*</span></label>
                  <div className="flex flex-wrap gap-2">
                    {BOOKMARK_GENRES.map((g) => (
                      <button key={g} type="button" onClick={() => setSel({ ...sel, genre: g })}
                        className={`text-[12px] font-bold px-3 py-1.5 rounded-full border ${sel.genre === g ? "bg-red-50 border-red-400 text-red-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{g}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">案内例原文 <span className="text-gray-400 font-normal">選択メッセージ（原則そのまま）</span></label>
                  <textarea className={`${input} bg-gray-50 text-gray-600 min-h-[64px]`} value={sel.originalText} readOnly />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">想定される質問 <span className="text-gray-400 font-normal">AI生成・編集可</span></label>
                  <textarea className={`${input} min-h-[56px]`} value={sel.expectedQuestion} onChange={(e) => setSel({ ...sel, expectedQuestion: e.target.value })} />
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">検索キーワード <span className="text-gray-400 font-normal">Enterで追加</span></label>
                  <div className="flex flex-wrap gap-1.5 items-center border border-gray-300 rounded-lg px-2 py-2">
                    {sel.keywords.map((k) => (
                      <span key={k} className="text-[11.5px] font-bold bg-indigo-50 text-indigo-700 rounded px-2 py-0.5 inline-flex items-center gap-1">
                        {k}<button onClick={() => setSel({ ...sel, keywords: sel.keywords.filter((x) => x !== k) })} className="text-indigo-400 hover:text-indigo-700">✕</button>
                      </span>
                    ))}
                    <input className="flex-1 min-w-[90px] text-[13px] outline-none py-0.5" placeholder="キーワードを追加…" value={kwInput}
                      onChange={(e) => setKwInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKw(); } }} onBlur={addKw} />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-gray-500 block mb-1">成型後案内例 <span className="text-gray-400 font-normal">AIが参照する完成文面</span></label>
                  <textarea className={`${input} min-h-[100px]`} value={sel.formattedReply} onChange={(e) => setSel({ ...sel, formattedReply: e.target.value })} />
                </div>
              </div>

              <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
                <button onClick={del} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button>
                <div className="flex-1" />
                <button onClick={() => setSel(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
                <button onClick={save} disabled={busy} className="text-sm py-2 px-5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40">{busy ? "保存中…" : "保存する"}</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {creating && (
        <NewBookmarkModal
          onClose={() => setCreating(false)}
          onCreated={async () => { setCreating(false); await reload(); }}
        />
      )}
    </div>
  );
}

// ── 直接登録（トークを経由しない先回り登録）────────────────────
//   取り込み仕様 決定1：まだ聞かれていない質問も登録できるようにする。
//   想定質問・キーワード・整形後の案内文はサーバー側でAIが生成する。
function NewBookmarkModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> }) {
  const toast = useToast();
  const [genre, setGenre] = useState<string>(BOOKMARK_GENRES[0]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const body = text.trim();
    if (!body) { toast.error("案内例の原文を入力してください"); return; }
    setBusy(true);
    const r = await createDirectBookmark({ genre, originalText: body });
    setBusy(false);
    if (!r.ok) { toast.error(r.error ?? "登録に失敗しました"); return; }
    toast.success("登録しました。生成された内容を確認してください");
    await onCreated();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center overflow-y-auto py-10 px-4"
      onClick={onClose}>
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="font-bold text-gray-800 m-0">新規登録</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">ジャンル <span className="text-red-500">*</span></label>
            <div className="flex flex-wrap gap-2">
              {BOOKMARK_GENRES.map((g) => (
                <button key={g} type="button" onClick={() => setGenre(g)}
                  className={`text-[12px] font-bold px-3 py-1.5 rounded-full border ${genre === g ? "bg-red-50 border-red-400 text-red-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{g}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-bold text-gray-500 block mb-1">
              案内例の原文 <span className="text-red-500">*</span>
              <span className="text-gray-400 font-normal ml-1">そのまま送れる文面で書く</span>
            </label>
            <textarea className={`${input} min-h-[160px]`} value={text} onChange={(e) => setText(e.target.value)}
              placeholder={"恐れ入ります、領収書についてご案内いたします。\nマイページ右上の「お支払い履歴」から、各月の領収書をPDFでダウンロードいただけます。"} />
            <p className="text-[11px] text-gray-400 mt-1">目安300〜800字。1つの想定質問に答えきる単位で書きます。</p>
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-[11.5px] text-gray-600 leading-relaxed">
            登録すると、AIが「想定質問（2〜4個）／検索キーワード（3〜8個）／整形後の案内文」を自動生成します。あとから手で直せます。
            <b className="text-gray-800">生成された内容は必ず目視で確認してください。</b>とくに、原文に無い金額・日程が入っていないか。
          </div>
        </div>

        <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <button onClick={() => void submit()} disabled={busy}
            className="text-sm py-2 px-5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40">
            {busy ? "生成中…" : "登録してAI生成"}
          </button>
        </div>
      </div>
    </div>
  );
}
