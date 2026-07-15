"use client";
import { useEffect, useMemo, useState } from "react";
import { fetchNews, saveNews, deleteNews, setNewsPublished, saveNewsOrder } from "../../lib/news";
import { fetchEvents, saveEvent, deleteEventsByNews, emptyEvent } from "../../lib/events";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { renderBodyHtml } from "../../lib/richText";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { AttrTable } from "../master/AttrTable";
import { AttrChips } from "../master/AttrChips";
import { UrlField } from "../common/UrlField";
import type { NewsItem, NewsCategory, PublishMode, CalEvent, EventKind } from "../../lib/models";
import { EVENT_KIND_LABEL, EVENT_KIND_COLOR } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";

const CATS: Record<NewsCategory, { label: string; cls: string }> = {
  notice: { label: "お知らせ", cls: "bg-blue-50 text-blue-600" },
  maint:  { label: "メンテナンス", cls: "bg-amber-50 text-amber-700" },
  event:  { label: "イベント", cls: "bg-emerald-50 text-emerald-600" },
};
const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const MODE_LABEL: Record<PublishMode, string> = { any: "いずれか含む", all: "すべて含む", exany: "いずれか含むを除外", exall: "すべて含むを除外" };
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fmt = (s: string) => (s ? s.replace("T", " ") : "—");
const bodyHtml = (n: NewsItem) => renderBodyHtml(n.bodyMode, n.bodyText, n.bodyHtml);
const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

// 属性の表示は AttrChips（顧客詳細画面と同じ仕様）に統一。ここでは「全員」表記だけ足す。
function TargetTags({ attrIds, mode, index }: { attrIds: number[]; mode: PublishMode; index: AttrIndex }) {
  return <AttrChips index={index} ids={attrIds} mode={attrIds.length ? mode : undefined} emptyLabel="全員" />;
}

export function NewsMaint() {
  const confirm = useConfirm();
  const toast = useToast();
  const [news, setNews] = useState<NewsItem[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<NewsItem | null>(null);
  // 「全員に公開する」チェック（初期OFF）。属性が空＝全員という既存仕様のまま、必須判定と復元だけに使う。
  const [publishAll, setPublishAll] = useState(false);
  // お知らせに紐づくカレンダー予定（events.news_id）。チェックONのときだけ実体を持つ。
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [evt, setEvt] = useState<CalEvent | null>(null);
  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  /** 編集モーダルを開く（紐づく予定があれば一緒に読み込む） */
  const openEdit = (n: NewsItem) => {
    setEdit(n);
    setPublishAll(!!n.id && n.attrIds.length === 0);   // 既存で属性が空＝全員公開として復元。新規はOFF
    setEvt(n.id ? (events.find((e) => e.newsId === n.id) ?? null) : null);
  };
  const closeEdit = () => { setEdit(null); setEvt(null); };
  /** 複写：既存を土台に「新規（id=0）」として編集モーダルを開く。保存するまでDBには増えない。 */
  const duplicateNews = (n: NewsItem) => {
    openEdit({ ...n, id: 0, title: `${n.title}（複写）`, publishedAt: nowLocal(), sortOrder: rows.length });
    setPublishAll(n.attrIds.length === 0);
  };

  const reload = async () => { setNews(await fetchNews()); setEvents(await fetchEvents()); };
  useEffect(() => {
    (async () => {
      try {
        const [n, t, ev] = await Promise.all([fetchNews(), loadAttributeTree(), fetchEvents()]);
        setNews(n); setTree(t); setEvents(ev);
      }
      catch (e) { console.error("お知らせ読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const rows = [...news].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const newItem = (): NewsItem => ({
    id: 0, category: "notice", title: "", bodyMode: "text", bodyText: "", bodyHtml: "",
    important: false, published: true, publishedAt: nowLocal(), attrMode: "any", attrIds: [], sortOrder: rows.length,
  });

  const move = async (idx: number, dir: number) => {
    const to = idx + dir; if (to < 0 || to >= rows.length) return;
    const arr = [...rows]; [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((n, i) => ({ id: n.id, sortOrder: i }));
    setNews((prev) => prev.map((n) => { const u = updates.find((x) => x.id === n.id); return u ? { ...n, sortOrder: u.sortOrder } : n; }));
    await saveNewsOrder(updates);
  };
  const togglePub = async (n: NewsItem) => { await setNewsPublished(n.id, !n.published); setNews((p) => p.map((x) => x.id === n.id ? { ...x, published: !x.published } : x)); };
  const doSave = async () => {
    if (!edit) return;
    if (!edit.title.trim()) { alert("タイトルを入力してください"); return; }
    if (!publishAll && edit.attrIds.length === 0) {
      alert("公開対象を指定してください（属性を1つ以上指定するか、「全員に公開する」にチェック）"); return;
    }
    const id = await saveNews(edit);
    if (id == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; }

    // カレンダー登録：ONなら events を作成／更新、OFFなら紐づく予定を削除
    if (evt) {
      const ok = await saveEvent({
        ...evt,
        newsId: id,
        title: evt.title.trim() || edit.title,
        bodyText: evt.bodyText || edit.bodyText,
        published: edit.published,          // お知らせの公開状態に追従
        attrMode: edit.attrMode,            // 公開対象はお知らせと同じものを使う
        attrIds: edit.attrIds,
      });
      if (ok == null) toast.error("カレンダー予定の保存に失敗しました");
    } else {
      await deleteEventsByNews(id);
    }

    closeEdit(); await reload(); toast.success("保存しました");
  };
  const doDelete = async () => {
    if (!edit?.id) return;
    if (!(await confirm({ title: "お知らせを削除", message: `「${edit.title}」を削除しますか？`, confirmLabel: "削除する", danger: true }))) return;
    await deleteEventsByNews(edit.id);      // 紐づくカレンダー予定も一緒に削除
    await deleteNews(edit.id);
    closeEdit(); await reload(); toast.success("削除しました");
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400 m-0">{news.length} 件（公開 {news.filter((n) => n.published).length}）</p>
        <button onClick={() => openEdit(newItem())} className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ お知らせを追加</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {rows.length === 0 && <div className="text-center text-gray-300 py-10 text-sm">お知らせがありません</div>}
        {rows.map((n, i) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => move(i, -1)} disabled={i === 0} className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▲</button>
              <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="w-6 h-5 border border-gray-200 rounded text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed">▼</button>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-800 flex items-center gap-1.5 flex-wrap">
                {n.title || "（無題）"}
                {!n.published && <span className="text-[10px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">下書き</span>}
              </div>
              <div className="text-[11px] text-gray-400 flex items-center gap-2 flex-wrap mt-1">
                {n.important && <span className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">重要</span>}
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${CATS[n.category].cls}`}>{CATS[n.category].label}</span>
                <span>公開：{fmt(n.publishedAt)}</span>
                <TargetTags attrIds={n.attrIds} mode={n.attrMode} index={index} />
              </div>
            </div>
            <button onClick={() => togglePub(n)} title="公開/非公開" className={`relative w-10 h-[21px] rounded-full shrink-0 ${n.published ? "bg-green-500" : "bg-gray-300"}`}>
              <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${n.published ? "left-[21px]" : "left-0.5"}`} />
            </button>
            <button onClick={() => duplicateNews(n)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 shrink-0">複写</button>
            <button onClick={() => openEdit({ ...n })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
          </div>
        ))}
      </div>

      {edit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeEdit}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-800">{edit.id ? "お知らせを編集" : "お知らせを追加"}</h2>
              <button onClick={closeEdit} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">カテゴリ</label>
                  <select className={`${input} bg-white`} value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as NewsCategory })}>
                    {Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                  </select></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">公開日時 <span className="text-gray-400 font-normal">未来日で予約公開</span></label>
                  <input type="datetime-local" className={input} value={edit.publishedAt} onChange={(e) => setEdit({ ...edit, publishedAt: e.target.value })} /></div>
              </div>
              <div><label className="text-xs font-bold text-gray-500 block mb-1">タイトル <span className="text-red-500">*</span></label>
                <input className={input} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></div>

              {/* 発行済みURL（会員ポータルのお知らせ詳細） */}
              <UrlField label="お知らせURL" hint="会員向け・ログインが必要"
                path={edit.id ? `/news/${edit.id}` : ""} />

              <div>
                <div className="inline-flex bg-gray-100 rounded-lg p-0.5 mb-2">
                  {(["text", "html"] as const).map((m) => (
                    <button key={m} onClick={() => setEdit({ ...edit, bodyMode: m })}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md ${edit.bodyMode === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>{m === "text" ? "テキスト" : "HTMLコード"}</button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mb-1.5">テキストはURLを自動リンク化、HTMLはそのまま反映されます。</p>
                {edit.bodyMode === "text"
                  ? <textarea className={`${input} min-h-[130px]`} value={edit.bodyText} onChange={(e) => setEdit({ ...edit, bodyText: e.target.value })} placeholder="本文（テキスト）" />
                  : <textarea className={`${input} min-h-[130px] font-mono text-[13px]`} value={edit.bodyHtml} onChange={(e) => setEdit({ ...edit, bodyHtml: e.target.value })} placeholder="<h3>見出し</h3>…" />}
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1">公開対象属性 <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">必須</span></label>

                {/* 全員に公開する：ONなら属性指定なしで全員に公開（初期OFF） */}
                <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${publishAll ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600"
                    checked={publishAll}
                    onChange={(e) => { const on = e.target.checked; setPublishAll(on); if (on) setEdit({ ...edit, attrIds: [] }); }} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${publishAll ? "text-emerald-800" : "text-gray-700"}`}>全員に公開する</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${publishAll ? "text-emerald-700" : "text-gray-500"}`}>
                      属性の指定なしで、対象ロール全員に公開します。
                    </span>
                  </span>
                </label>

                {!publishAll && (
                  <div className="mt-2.5">
                    <AttrTable tree={tree} index={index} value={edit.attrIds}
                      onChange={(ids) => setEdit({ ...edit, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
                    <div className="mt-2"><label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                      <select className={`${input} bg-white`} value={edit.attrMode} onChange={(e) => setEdit({ ...edit, attrMode: e.target.value as PublishMode })}>
                        {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select></div>
                    {edit.attrIds.length === 0 && (
                      <p className="text-[11px] text-red-600 mt-1.5">
                        ⚠ 属性を1つ以上指定するか、「全員に公開する」にチェックしてください
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* カレンダー登録（events に news_id 付きで1件作成／更新される） */}
              <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-3.5">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-teal-600"
                    checked={evt != null}
                    onChange={(e) => setEvt(e.target.checked
                      ? { ...emptyEvent(edit.publishedAt.slice(0, 10)), title: edit.title, bodyText: edit.bodyText }
                      : null)} />
                  <span>
                    <span className="text-sm font-bold text-teal-900">カレンダーにも登録する</span>
                    <span className="block text-[11px] text-teal-700 mt-0.5">
                      このお知らせに紐づく予定をカレンダーへ表示します。公開対象属性・公開状態はお知らせと同じものが使われます。
                    </span>
                  </span>
                </label>

                {evt && (
                  <div className="mt-3 space-y-2.5 pl-6">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-[11px] font-bold text-gray-500 block mb-1">開始</label>
                        <input type="datetime-local" className={input} value={evt.startAt}
                          onChange={(e) => setEvt({ ...evt, startAt: e.target.value })} /></div>
                      <div><label className="text-[11px] font-bold text-gray-500 block mb-1">終了</label>
                        <input type="datetime-local" className={input} value={evt.endAt}
                          onChange={(e) => setEvt({ ...evt, endAt: e.target.value })} /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="text-[11px] font-bold text-gray-500 block mb-1">種別／色</label>
                        <select className={`${input} bg-white`} value={evt.kind}
                          onChange={(e) => { const k = e.target.value as EventKind; setEvt({ ...evt, kind: k, color: EVENT_KIND_COLOR[k] }); }}>
                          {(Object.keys(EVENT_KIND_LABEL) as EventKind[]).map((k) => <option key={k} value={k}>{EVENT_KIND_LABEL[k]}</option>)}
                        </select></div>
                      <div><label className="text-[11px] font-bold text-gray-500 block mb-1">場所 <span className="text-gray-400 font-normal">任意</span></label>
                        <input className={input} value={evt.location}
                          onChange={(e) => setEvt({ ...evt, location: e.target.value })} /></div>
                    </div>
                    <label className="inline-flex items-center gap-2 text-[12px] font-bold text-teal-800 cursor-pointer">
                      <input type="checkbox" className="w-4 h-4 accent-teal-600"
                        checked={evt.allDay} onChange={(e) => setEvt({ ...evt, allDay: e.target.checked })} />
                      終日
                    </label>
                    <p className="text-[10.5px] text-gray-400">
                      ※ 申込フォームの紐付けは「設定 ＞ イベント・予定」から行えます。
                    </p>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs font-bold text-gray-500 block mb-1">重要（ピン留め）</label>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => setEdit({ ...edit, important: !edit.important })} className={`relative w-10 h-[21px] rounded-full ${edit.important ? "bg-red-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.important ? "left-[21px]" : "left-0.5"}`} /></button>
                    <span className="text-xs text-gray-600">一覧の先頭に「重要」表示</span>
                  </div></div>
                <div><label className="text-xs font-bold text-gray-500 block mb-1">公開状態</label>
                  <div className="flex items-center gap-2.5">
                    <button onClick={() => setEdit({ ...edit, published: !edit.published })} className={`relative w-10 h-[21px] rounded-full ${edit.published ? "bg-green-500" : "bg-gray-300"}`}>
                      <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${edit.published ? "left-[21px]" : "left-0.5"}`} /></button>
                    <span className="text-xs text-gray-600">{edit.published ? "公開" : "下書き"}</span>
                  </div></div>
              </div>

              <div><label className="text-xs font-bold text-gray-500 block mb-1.5">プレビュー</label>
                <div className="border border-dashed border-gray-300 rounded-xl p-3 bg-gray-50">
                  <div className="text-[10px] text-gray-400 mb-2">{edit.important ? "重要・" : ""}{CATS[edit.category].label}　{edit.title || "（タイトル）"}</div>
                  <div className="text-[13.5px] leading-7 text-gray-700 bg-white border border-gray-200 rounded-lg p-3 content-rich"
                    dangerouslySetInnerHTML={{ __html: bodyHtml(edit) || "（本文未入力）" }} />
                </div></div>
            </div>
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {edit.id ? <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button> : null}
              <div className="flex-1" />
              <button onClick={closeEdit} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
