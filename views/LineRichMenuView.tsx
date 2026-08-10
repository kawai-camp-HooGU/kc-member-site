"use client";
// リッチメニュー管理（Phase 5b）：作成・画像・タップ領域（レイアウト＋アクション）・公開/既定/削除。
//   編集はモーダルではなく「1画面（フルページ）」。左＝設定 / 右＝ライブ図解プレビュー。
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLineAccounts } from "../hooks/useLineAccounts";
import { useConfirm } from "../components/common/ConfirmProvider";
import type { LineRichMenu, RichMenuCell, RichMenuSize, RichMenuActionType, RichMenuAudience } from "../lib/models";
import {
  fetchRichMenus, saveRichMenu, uploadRichMenuImage, richMenuImageUrl,
  publishRichMenu, setRichMenuDefault, deleteRichMenu, fetchRichMenuTapCounts,
} from "../lib/lineRichMenu";
import { LineAccountBar } from "../components/line/LineAccountBar";
import { AttrTable } from "../components/master/AttrTable";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";

const AUDIENCE: { k: RichMenuAudience; l: string }[] = [
  { k: "all", l: "全員（既定ベース）" },
  { k: "unlinked", l: "未連携の友だち" },
  { k: "linked", l: "連携済み会員" },
  { k: "attr", l: "タグで指定" },
];
const audienceLabel = (a: RichMenuAudience) => AUDIENCE.find((x) => x.k === a)?.l ?? "全員";

const LAYOUTS: { key: string; label: string; cols: number; rows: number }[] = [
  { key: "1x1", label: "全体1つ", cols: 1, rows: 1 },
  { key: "2x1", label: "横2分割", cols: 2, rows: 1 },
  { key: "3x1", label: "横3分割", cols: 3, rows: 1 },
  { key: "1x2", label: "縦2段", cols: 1, rows: 2 },
  { key: "2x2", label: "2×2", cols: 2, rows: 2 },
  { key: "3x2", label: "3×2（6分割）", cols: 3, rows: 2 },
];
const cellCountOf = (key: string) => {
  const l = LAYOUTS.find((x) => x.key === key) ?? LAYOUTS[1];
  return l.cols * l.rows;
};

interface ActionMeta { label: string; icon: string; hint: string; needVal: boolean; ph?: string }
const ACTION_META: Record<RichMenuActionType, ActionMeta> = {
  liff:        { label: "会員連携フォーム(LIFF)", icon: "📝", hint: "このアカウントのLIFF会員連携フォームを開きます（LIFF ID未設定だと無効）。", needVal: false },
  liff_mypage: { label: "マイページ(LIFF)",       icon: "👤", hint: "LINE内の会員マイページを開きます（LIFF ID未設定だと無効）。", needVal: false },
  uri:         { label: "URLを開く",              icon: "🔗", hint: "タップで指定URLを開きます。", needVal: true, ph: "https://…" },
  message:     { label: "テキスト送信",            icon: "💬", hint: "タップで指定テキストを送信します。", needVal: true, ph: "送信するテキスト" },
};
const ACTION_KEYS = Object.keys(ACTION_META) as RichMenuActionType[];
const ZONE_COLORS = ["#06c755", "#0891b2", "#7c3aed", "#d97706", "#db2777", "#2563eb"];

const emptyCell = (): RichMenuCell => ({ label: "", actionType: "liff", actionValue: "" });

interface Form {
  id?: number; name: string; chatBarText: string; size: RichMenuSize; layout: string;
  imagePath: string; cells: RichMenuCell[]; isDefault: boolean;
  audience: RichMenuAudience; audienceAttrIds: number[]; priority: number; abGroup: string;
}
const EMPTY: Form = { name: "", chatBarText: "メニュー", size: "full", layout: "2x1", imagePath: "", cells: [emptyCell(), emptyCell()], isDefault: false, audience: "all", audienceAttrIds: [], priority: 0, abGroup: "" };

export function LineRichMenuView() {
  const { accounts, accountId, setAccountId } = useLineAccounts();
  const confirm = useConfirm();
  const [menus, setMenus] = useState<LineRichMenu[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const attrIndex: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  const [taps, setTaps] = useState<Map<number, number>>(new Map());
  const load = useCallback(async () => {
    const [ms, tc] = await Promise.all([fetchRichMenus(accountId), fetchRichMenuTapCounts(accountId)]);
    setMenus(ms); setTaps(tc);
  }, [accountId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadAttributeTree().then(setTree).catch(() => setTree([])); }, []);

  const openNew = () => { setForm({ ...EMPTY, cells: [emptyCell(), emptyCell()] }); setErr(""); setOpen(true); };
  const openEdit = (m: LineRichMenu) => {
    setForm({ id: m.id, name: m.name, chatBarText: m.chatBarText, size: m.size, layout: m.layout, imagePath: m.imagePath, cells: m.cells.length ? m.cells : [emptyCell()], isDefault: m.isDefault, audience: m.audience, audienceAttrIds: m.audienceAttrIds, priority: m.priority, abGroup: m.abGroup });
    setErr(""); setOpen(true);
  };

  const setLayout = (key: string) => {
    const n = cellCountOf(key);
    setForm((f) => {
      const cells = [...f.cells];
      while (cells.length < n) cells.push(emptyCell());
      cells.length = n;
      return { ...f, layout: key, cells };
    });
  };
  const setCell = (i: number, p: Partial<RichMenuCell>) =>
    setForm((f) => ({ ...f, cells: f.cells.map((c, idx) => idx === i ? { ...c, ...p } : c) }));

  const onImage = async (file: File) => {
    if (accountId == null) return;
    setUploading(true); setErr("");
    const r = await uploadRichMenuImage(accountId, file);
    setUploading(false);
    if (r.error) { setErr(r.error); return; }
    setForm((f) => ({ ...f, imagePath: r.path }));
  };

  const save = async (): Promise<number | null> => {
    if (accountId == null) { setErr("アカウントを選択してください"); return null; }
    setBusy(true); setErr("");
    const id = await saveRichMenu({
      id: form.id, accountId, name: form.name, chatBarText: form.chatBarText,
      size: form.size, layout: form.layout, imagePath: form.imagePath, cells: form.cells, isDefault: form.isDefault,
      audience: form.audience, audienceAttrIds: form.audienceAttrIds, priority: form.priority, abGroup: form.abGroup,
    });
    setBusy(false);
    if (id == null) { setErr("保存に失敗しました"); return null; }
    setForm((f) => ({ ...f, id }));
    await load();
    return id;
  };
  const saveClose = async () => { const id = await save(); if (id != null) setOpen(false); };
  const publish = async () => {
    if (!form.imagePath) { setErr("画像を設定してください"); return; }
    const id = await save();
    if (id == null) return;
    setBusy(true);
    const r = await publishRichMenu(id);
    setBusy(false);
    if (!r.ok) { setErr(r.error ?? "公開に失敗しました"); return; }
    setOpen(false); await load();
  };
  const makeDefault = async (m: LineRichMenu) => { setBusy(true); const r = await setRichMenuDefault(m.id); setBusy(false); if (!r.ok) alert(r.error ?? "失敗"); await load(); };
  const remove = async (m: LineRichMenu) => {
    if (!(await confirm({ title: "リッチメニューを削除", message: `「${m.name || "無題"}」を削除します。LINE上のメニューも削除されます。` }))) return;
    setBusy(true); await deleteRichMenu(m.id); setBusy(false); await load();
  };

  const layoutMeta = useMemo(() => LAYOUTS.find((x) => x.key === form.layout) ?? LAYOUTS[1], [form.layout]);
  const previewUrl = form.imagePath ? richMenuImageUrl(form.imagePath) : "";
  const ratio = form.size === "compact" ? 843 / 2500 : 1686 / 2500;

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <LineAccountBar screenLabel="リッチメニュー" accounts={accounts} accountId={accountId} onSelectAccount={setAccountId} />

      {!open ? (
        // ── 一覧 ──────────────────────────────────────────────
        <div className="flex-1 overflow-auto p-5">
          <div className="flex items-center gap-3 mb-4">
            <h1 className="text-lg font-extrabold">リッチメニュー</h1>
            <span className="text-xs text-gray-500">LINEトーク下部の固定メニュー</span>
            <button onClick={openNew} disabled={accountId == null} className="ml-auto bg-emerald-500 text-white font-bold text-[12.5px] rounded-lg px-4 py-2 disabled:opacity-50">＋ 作成</button>
          </div>

          {menus.length === 0 && (
            <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center text-sm text-gray-400">
              まだリッチメニューがありません。「＋ 作成」から追加してください。
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {menus.map((m) => (
              <div key={m.id} className="bg-white border border-gray-200 rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <b className="text-[14px]">{m.name || "（無題）"}</b>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${m.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{m.status === "published" ? "公開中" : "下書き"}</span>
                  {m.isDefault && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">既定</span>}
                </div>
                {m.imagePath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={richMenuImageUrl(m.imagePath)} alt="" className="w-full rounded-lg border border-gray-100 mb-2" />
                )}
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${m.audience === "all" ? "bg-gray-100 text-gray-500" : "bg-emerald-50 text-emerald-700"}`}>{audienceLabel(m.audience)}</span>
                  {m.priority !== 0 && <span className="text-[10.5px] text-gray-400">優先 {m.priority}</span>}
                  {m.abGroup && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700">A/B: {m.abGroup}</span>}
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700">👆 タップ {taps.get(m.id) ?? 0}</span>
                </div>
                <div className="text-[11.5px] text-gray-500 mb-2">バー表示: {m.chatBarText}／{m.size === "full" ? "大" : "小"}・{m.layout}</div>
                <div className="flex gap-2 flex-wrap">
                  <button onClick={() => openEdit(m)} className="text-[12px] font-bold border border-gray-200 rounded-lg px-3 py-1.5">編集</button>
                  {m.status === "published" && !m.isDefault && <button onClick={() => makeDefault(m)} disabled={busy} className="text-[12px] font-bold border border-emerald-300 text-emerald-700 rounded-lg px-3 py-1.5">既定にする</button>}
                  <button onClick={() => remove(m)} disabled={busy} className="text-[12px] font-bold border border-red-200 text-red-600 rounded-lg px-3 py-1.5 ml-auto">削除</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        // ── 編集（1画面）─────────────────────────────────────
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 overflow-auto">
            <div className="max-w-[1150px] mx-auto px-5 pt-4 pb-6">
              {/* ページ見出し */}
              <div className="flex items-center gap-3 mb-5">
                <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3 py-1.5">← 一覧に戻る</button>
                <h1 className="text-lg font-extrabold">{form.id ? "リッチメニューを編集" : "リッチメニューを作成"}</h1>
                <span className="text-xs text-gray-500">LINEトーク下部の固定メニュー</span>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px] gap-6 items-start">
                {/* 左：設定 */}
                <div className="space-y-5">
                  {/* 1. 基本設定 */}
                  <section className="bg-white border border-gray-200 rounded-2xl">
                    <div className="px-5 py-3 border-b border-gray-100 font-extrabold text-[13.5px] flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-emerald-500 text-white text-[11px] flex items-center justify-center">1</span>基本設定
                    </div>
                    <div className="p-5">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="block text-[12px] font-bold mb-1">名前（管理用）</label>
                          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="7月メニュー" />
                          <div className="text-[11px] text-gray-400 mt-1">運営の管理用。LINEには表示されません。</div>
                        </div>
                        <div>
                          <label className="block text-[12px] font-bold mb-1">バーの表示テキスト</label>
                          <input value={form.chatBarText} maxLength={14} onChange={(e) => setForm({ ...form, chatBarText: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="メニュー" />
                          <div className="text-[11px] text-gray-400 mt-1">トーク下部の帯の文言（14文字まで）。</div>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-[12px] font-bold mb-1">サイズ</label>
                          <select value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value as RichMenuSize })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                            <option value="full">大（2500×1686）</option><option value="compact">小（2500×843）</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-[12px] font-bold mb-1">レイアウト</label>
                          <select value={form.layout} onChange={(e) => setLayout(e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                            {LAYOUTS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
                          </select>
                        </div>
                      </div>

                      {/* 表示条件（出し分け・Phase 7②）*/}
                      <div className="mt-3 border-t border-gray-100 pt-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[12px] font-bold mb-1">表示条件（誰に出すか）</label>
                            <select value={form.audience} onChange={(e) => setForm({ ...form, audience: e.target.value as RichMenuAudience })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50">
                              {AUDIENCE.map((a) => <option key={a.k} value={a.k}>{a.l}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[12px] font-bold mb-1">優先度 <span className="text-gray-400 font-normal">大きいほど優先</span></label>
                            <input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) || 0 })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" />
                          </div>
                        </div>
                        <div className="mt-3">
                          <label className="block text-[12px] font-bold mb-1">A/Bテスト群 <span className="text-gray-400 font-normal">任意</span></label>
                          <input value={form.abGroup} onChange={(e) => setForm({ ...form, abGroup: e.target.value })} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[13px] bg-gray-50" placeholder="例）summer_test" />
                          <div className="text-[11px] text-gray-400 mt-1">同じ群名・同じ表示条件・同じ優先度のメニューを2つ以上公開すると、友だちごとに自動で振り分けて比較できます（タップ数は下の一覧で確認）。</div>
                        </div>
                        {form.audience === "attr" && (
                          <div className="mt-2">
                            <label className="block text-[12px] font-bold mb-1">対象タグ（いずれか保有で表示）</label>
                            <AttrTable tree={tree} index={attrIndex} value={form.audienceAttrIds} onChange={(ids) => setForm({ ...form, audienceAttrIds: ids })} addLabel="＋ タグを追加" />
                          </div>
                        )}
                        <div className="text-[11px] text-gray-400 mt-1.5">
                          「全員」＝既定メニュー（全員に出るベース）。「未連携／連携済み／タグ」＝条件に合う人へ自動で切替（友だち追加・タグ変化・会員連携時）。
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* 2. メニュー画像 */}
                  <section className="bg-white border border-gray-200 rounded-2xl">
                    <div className="px-5 py-3 border-b border-gray-100 font-extrabold text-[13.5px] flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-emerald-500 text-white text-[11px] flex items-center justify-center">2</span>メニュー画像
                    </div>
                    <div className="p-5">
                      <label className="block text-[12px] font-bold mb-1">
                        画像ファイル <span className="text-gray-400 font-normal">JPEG/PNG・1MBまで・{form.size === "full" ? "2500×1686" : "2500×843"}px</span>
                      </label>
                      <input type="file" accept="image/jpeg,image/png" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); }} className="text-[12px]" />
                      {uploading && <span className="text-[12px] text-gray-400 ml-2">アップロード中…</span>}
                      <div className="text-[11px] text-gray-400 mt-2">画像の上に、下のマス割りでタップ領域を重ねます。右のプレビューと同じ位置に絵柄が来るよう作成してください。</div>
                    </div>
                  </section>

                  {/* 3. マス割り・アクション */}
                  <section className="bg-white border border-gray-200 rounded-2xl">
                    <div className="px-5 py-3 border-b border-gray-100 font-extrabold text-[13.5px] flex items-center gap-2">
                      <span className="w-5 h-5 rounded-md bg-emerald-500 text-white text-[11px] flex items-center justify-center">3</span>マス割り・アクション
                      <span className="ml-auto text-[11.5px] font-semibold text-gray-500">{layoutMeta.cols}×{layoutMeta.rows}＝{form.cells.length}マス・左上から順</span>
                    </div>
                    <div className="p-5 space-y-3">
                      {form.cells.map((c, i) => {
                        const meta = ACTION_META[c.actionType];
                        return (
                          <div key={i} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                            <div className="flex items-center gap-2 mb-2">
                              <span className="w-6 h-6 rounded-md text-white font-extrabold text-[12px] flex items-center justify-center" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}>{i + 1}</span>
                              <span className="font-extrabold text-[12.5px]">マス{i + 1}</span>
                              <span className="ml-auto text-[13px]">{meta.icon}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input value={c.label} onChange={(e) => setCell(i, { label: e.target.value })} className={`border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white ${meta.needVal ? "" : "col-span-1"}`} placeholder="ラベル（任意）" />
                              <select value={c.actionType} onChange={(e) => setCell(i, { actionType: e.target.value as RichMenuActionType })} className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white">
                                {ACTION_KEYS.map((k) => <option key={k} value={k}>{ACTION_META[k].label}</option>)}
                              </select>
                              {meta.needVal && (
                                <input value={c.actionValue} onChange={(e) => setCell(i, { actionValue: e.target.value })}
                                  className="col-span-2 w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white"
                                  placeholder={meta.ph} />
                              )}
                            </div>
                            <div className="text-[10.5px] text-gray-400 mt-1.5">{meta.hint}</div>
                          </div>
                        );
                      })}

                      <label className="flex items-center gap-2 text-[12.5px] pt-1">
                        <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
                        公開時に全員の既定メニューにする
                      </label>
                    </div>
                  </section>
                </div>

                {/* 右：ライブ図解プレビュー */}
                <div className="lg:sticky lg:top-4">
                  <div className="text-[12.5px] font-extrabold text-gray-500 mb-2 flex items-center gap-2">📱 プレビュー（マスと画面の対応）</div>
                  <div className="bg-white border border-gray-200 rounded-[22px] p-3 shadow-sm">
                    <div className="rounded-2xl overflow-hidden border border-gray-100">
                      {/* トーク上部 */}
                      <div className="bg-[#0b7a3b] text-white px-3.5 py-2 text-[12px] font-bold flex items-center gap-2">
                        <span className="w-5 h-5 rounded-full bg-white/90 text-[10px] flex items-center justify-center">👩‍💼</span>
                        {accounts.find((a) => a.id === accountId)?.name ?? "アカウント"}
                      </div>
                      {/* トーク本文（雰囲気） */}
                      <div className="px-3 py-3" style={{ background: "linear-gradient(180deg,#93b0d8,#a7c0e0)", height: 96 }}>
                        <div className="bg-white rounded-xl px-2.5 py-1.5 text-[10.5px] max-w-[75%] shadow-sm mb-1.5">メニューからどうぞ 👇</div>
                        <div className="rounded-xl px-2.5 py-1.5 text-[10.5px] max-w-[70%] shadow-sm ml-auto" style={{ background: "#8de055" }}>はい！</div>
                      </div>
                      {/* リッチメニュー本体（図解の主役）*/}
                      <div className="bg-[#e9edf2]">
                        <div className="relative w-full"
                          style={{
                            paddingTop: `${ratio * 100}%`,
                            backgroundColor: "#eef2f6",
                            backgroundImage: previewUrl ? `url(${previewUrl})` : "repeating-linear-gradient(45deg,#f1f5f9 0 12px,#e9eef4 12px 24px)",
                            backgroundSize: "cover", backgroundPosition: "center",
                          }}>
                          {form.cells.map((c, i) => {
                            const meta = ACTION_META[c.actionType];
                            const col = i % layoutMeta.cols;
                            const row = Math.floor(i / layoutMeta.cols);
                            const color = ZONE_COLORS[i % ZONE_COLORS.length];
                            return (
                              <div key={i} className="absolute flex flex-col items-center justify-center text-white text-center p-1"
                                style={{
                                  left: `${(col * 100) / layoutMeta.cols}%`, top: `${(row * 100) / layoutMeta.rows}%`,
                                  width: `${100 / layoutMeta.cols}%`, height: `${100 / layoutMeta.rows}%`,
                                  background: `linear-gradient(160deg, ${color}dd, ${color}99)`,
                                  border: "2px solid rgba(255,255,255,.9)",
                                }}>
                                <span className="font-extrabold text-[10px] bg-black/25 rounded w-[18px] h-[18px] flex items-center justify-center mb-0.5">{i + 1}</span>
                                <span className="text-[14px] leading-none">{meta.icon}</span>
                                <span className="text-[9.5px] font-bold mt-0.5 leading-tight" style={{ textShadow: "0 1px 2px rgba(0,0,0,.5)" }}>{c.label || meta.label}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                      {/* チャットバー */}
                      <div className="bg-[#f7f8fa] border-t border-gray-200 py-2">
                        <div className="w-8 h-1 rounded bg-gray-300 mx-auto mb-1.5" />
                        <div className="text-center text-[11px] font-bold text-gray-700">{form.chatBarText || "メニュー"}</div>
                      </div>
                    </div>
                  </div>

                  {/* 凡例：マス→アクション */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-4 mt-3">
                    <h4 className="text-[11.5px] text-gray-500 font-bold mb-2">マス → アクション対応</h4>
                    <div className="divide-y divide-dashed divide-gray-100">
                      {form.cells.map((c, i) => {
                        const meta = ACTION_META[c.actionType];
                        return (
                          <div key={i} className="flex items-center gap-2.5 py-1.5 text-[12px]">
                            <span className="w-[22px] h-[22px] rounded-md text-white font-extrabold text-[11px] flex items-center justify-center shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }}>{i + 1}</span>
                            <b className={c.label ? "" : "text-gray-400 font-normal"}>{c.label || "（ラベル未設定）"}</b>
                            <span className="ml-auto text-gray-500 text-[11px]">{meta.icon} {meta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-3">
                    💡 マス番号は「左上 → 右へ → 次の段」の順です。画像の絵柄もこの順に合わせて作成してください。
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 下部アクションバー */}
          <div className="border-t border-gray-200 bg-white/95 backdrop-blur px-5 py-3 flex items-center justify-end gap-2">
            {err && <span className="mr-auto text-[12px] text-red-600">{err}</span>}
            <button onClick={() => setOpen(false)} className="text-[12.5px] font-bold border border-gray-200 bg-white rounded-lg px-3.5 py-2">キャンセル</button>
            <button onClick={saveClose} disabled={busy || uploading} className="text-[12.5px] font-bold border border-gray-300 rounded-lg px-4 py-2 disabled:opacity-50">下書き保存</button>
            <button onClick={publish} disabled={busy || uploading} className="text-[12.5px] font-bold bg-emerald-500 text-white rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "処理中…" : "保存して LINE に公開"}</button>
          </div>
        </div>
      )}
    </div>
  );
}
