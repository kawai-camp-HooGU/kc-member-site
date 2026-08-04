"use client";
// ============================================================
// シナリオ配信（ステップ配信）：一覧 / 編集 / URL訪問者 を内部で切替
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useRoute } from "../hooks/useRoute";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { AttrTable } from "../components/master/AttrTable";
import { AttrChips } from "../components/master/AttrChips";
import { SourceTargetPicker } from "../components/master/SourceTargetPicker";
import { errMessage } from "../lib/errors";
import type { Scenario, ScenarioStep, ScenarioTrigger, StepDelayUnit, Member, Source, LineAccount } from "../lib/models";
import { BROADCAST_VARIABLES, SCENARIO_TRIGGER_LABEL } from "../lib/models";
import { fetchLineAccounts } from "../lib/lineAccounts";
import { renderMessage } from "../lib/broadcast";
import { fetchSources, buildSourceIndex, sourceLabel as sourceLabelOf } from "../lib/sources";
import type { SourceIndex } from "../lib/sources";
import {
  fetchScenarios, fetchScenario, saveScenario, deleteScenario, scenarioCandidates,
  fetchScenarioLinks, fetchScenarioVisitors, setScenarioFolder,
} from "../lib/scenario";
import type { ScenarioListItem, ScenarioLinkStat, ScenarioVisitor } from "../lib/scenario";
import { useConfirm } from "../components/common/ConfirmProvider";
import { useFolders } from "../hooks/useFolders";
import { FolderPane, FOLDER_DND_MIME } from "../components/common/FolderPane";
import { Icon } from "../components/common/Icon";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");
const newStep = (): ScenarioStep => ({ id: 0, sortOrder: 0, delayUnit: "days", delayValue: 1, timeOfDay: "", channelChat: true, channelEmail: false, channelLine: false, messageBody: "" });
const EMPTY: Scenario = {
  id: 0, name: "", active: false, triggerType: "source",
  targetSource: "", targetSourceIds: [], targetSourceCats: [], targetAttrIds: [],
  lineAccountId: null,
  steps: [{ ...newStep(), delayUnit: "immediate", delayValue: 0 }], createdAt: "",
  folderId: null,
};

export function ScenarioView() {
  // 画面状態は URL（/ops/scenario ・/ops/scenario/3 ・/ops/scenario/3/report ・/ops/scenario/new）
  const route = useRoute();
  const seg0 = route.detail[0] ?? null;
  const editId: number | null = seg0 && seg0 !== "new" ? Number(seg0) : null;
  const sub: "list" | "edit" | "report" =
    seg0 == null ? "list" : route.detail[1] === "report" ? "report" : "edit";
  const toList = () => route.goDetail([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);
  // Phase 3：流入経路は sources マスタから取得
  const [sources, setSources] = useState<Source[]>([]);
  useEffect(() => {
    loadAttributeTree().then(setTree).catch(() => setTree([]));
    fetchSources().then(setSources).catch(() => setSources([]));
  }, []);
  const sourceIndex: SourceIndex = useMemo(() => buildSourceIndex(sources), [sources]);
  const sourceLabel = useCallback(
    (id: number | null | undefined) => (id == null ? "" : sourceIndex.get(id)?.label ?? ""),
    [sourceIndex],
  );

  // 複写元ID（/ops/scenario/new?from=3）。新規作成時のみ有効。
  const fromId = editId == null ? route.qNum("from") : null;

  if (sub === "edit") return <ScenarioEdit id={editId} fromId={fromId} tree={tree} index={index} sources={sources} sourceIndex={sourceIndex} sourceLabel={sourceLabel} onClose={toList} />;
  if (sub === "report" && editId != null) return <ScenarioReport id={editId} index={index} sourceIndex={sourceIndex} onClose={toList} />;
  return <ScenarioList onNew={() => route.goDetail(["new"])} onEdit={(id) => route.goDetail([id])} onDuplicate={(id) => route.goDetail(["new"], { from: id })} onReport={(id) => route.goDetail([id, "report"])} />;
}

// ── 一覧 ──────────────────────────────────────────────────────
function ScenarioList({ onNew, onEdit, onDuplicate, onReport }: { onNew: () => void; onEdit: (id: number) => void; onDuplicate: (id: number) => void; onReport: (id: number) => void }) {
  const [items, setItems] = useState<ScenarioListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => { fetchScenarios().then((d) => { setItems(d); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);
  const confirm = useConfirm();
  const remove = async (id: number) => { if (await confirm({ title: "シナリオを削除", message: "このシナリオを削除しますか？（進行中の配信も止まります）", confirmLabel: "削除する", danger: true })) { await deleteScenario(id); reload(); } };

  // ── フォルダ ──
  const fdr = useFolders("scenario");
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of items) if (s.folderId != null) m.set(s.folderId, (m.get(s.folderId) ?? 0) + 1);
    return m;
  }, [items]);
  const folderName = useMemo(() => new Map(fdr.folders.map((f) => [f.id, f.name])), [fdr.folders]);
  const inFolder = useCallback((s: ScenarioListItem) => (fdr.selected === "unfiled" ? s.folderId == null : s.folderId === fdr.selected), [fdr.selected]);
  const shown = items.filter(inFolder);

  const moveRecord = useCallback(async (recordId: number, targetFolderId: number | null) => {
    const before = items;
    setItems((prev) => prev.map((s) => (s.id === recordId ? { ...s, folderId: targetFolderId } : s)));
    const ok = await setScenarioFolder(recordId, targetFolderId);
    if (!ok) setItems(before);
  }, [items]);
  const onRowDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.setData(FOLDER_DND_MIME, String(id));
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col gap-4">
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">Scenario</h1>
        <span className="text-xs text-gray-400">ステップ配信（登録起点で自動的に順次送信）</span>
        <button onClick={onNew} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 新規シナリオ</button>
      </div>

      <div className="flex-1 min-h-0 flex border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <FolderPane
          scope="scenario"
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
          <div className="shrink-0 flex gap-2 items-center px-4 py-3 border-b border-gray-100">
            <span className="text-xs font-bold text-gray-600">{fdr.selected === "unfiled" ? "未分類のシナリオ" : (folderName.get(fdr.selected as number) ?? "フォルダ")}</span>
            <span className="text-[11px] text-gray-400">{shown.length} 件</span>
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-gray-50/40">
            <div className="p-3 flex flex-col gap-2.5">
              {loading && <div className="text-center text-gray-400 py-10 text-sm">読み込み中...</div>}
              {!loading && shown.length === 0 && <div className="text-center text-gray-400 py-10 text-sm">シナリオはありません。「＋ 新規シナリオ」から作成します。</div>}
              {shown.map((s) => (
                <div key={s.id} draggable onDragStart={(e) => onRowDragStart(e, s.id)}
                  className="bg-white border border-gray-200 rounded-xl px-3.5 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow cursor-grab active:cursor-grabbing">
                  <span className="text-gray-300 select-none shrink-0" title="ドラッグでフォルダ移動">⠿</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <b className="text-[14px] text-gray-900">{s.name || "（無題）"}</b>
                      <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${s.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{s.active ? "● 稼働中" : "停止中"}</span>
                      {s.folderId != null && folderName.get(s.folderId)
                        ? <span title={folderName.get(s.folderId)} className="inline-flex items-center gap-1 max-w-[180px] text-[10.5px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full pl-1.5 pr-2 py-0.5"><Icon name="folder" size={11} className="text-yellow-500 shrink-0" /><span className="truncate">{folderName.get(s.folderId)}</span></span>
                        : <span className="text-[10.5px] font-bold text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">未分類</span>}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-2">
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">開始 {SCENARIO_TRIGGER_LABEL[s.triggerType]}</span>
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">ステップ <b className="text-gray-800">{s.stepCount}</b></span>
                      <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">登録者 <b className="text-gray-800">{s.activeCount}</b> 進行 / <b className="text-gray-800">{s.doneCount}</b> 完了</span>
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => onEdit(s.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">編集</button>
                    <button onClick={() => onReport(s.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">レポート</button>
                    <button onClick={() => onDuplicate(s.id)} className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-50">複写</button>
                    <button onClick={() => remove(s.id)} className="text-xs px-2 py-1 rounded-md text-red-500 hover:bg-red-50">削除</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 編集 ──────────────────────────────────────────────────────
function ScenarioEdit({ id, fromId, tree, index, sources, sourceIndex, sourceLabel, onClose }: {
  id: number | null; fromId?: number | null; tree: AttrNode[]; index: AttrIndex;
  sources: Source[]; sourceIndex: SourceIndex;
  sourceLabel: (id: number | null | undefined) => string; onClose: () => void;
}) {
  const { members } = useMaster();
  const [s, setS] = useState<Scenario>(EMPTY);
  const [lineAccounts, setLineAccounts] = useState<LineAccount[]>([]);
  useEffect(() => { fetchLineAccounts().then(setLineAccounts); }, []);
  const [testEmail, setTestEmail] = useState("");
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    // 新規：複写元（fromId）があれば既存シナリオ（ステップ含む）を土台に「停止中の新規」を作る。
    if (id == null) {
      if (fromId == null) { setS(EMPTY); return; }
      fetchScenario(fromId).then((sc) => {
        if (!sc) { setS(EMPTY); return; }
        const steps = sc.steps.length ? sc.steps : [newStep()];
        setS({ ...sc, id: 0, name: `${sc.name}（複写）`, active: false, createdAt: "", steps: steps.map((st) => ({ ...st, id: 0 })) });
      });
      return;
    }
    fetchScenario(id).then((sc) => { if (sc) setS(sc.steps.length ? sc : { ...sc, steps: [newStep()] }); });
  }, [id, fromId]);

  const patch = (p: Partial<Scenario>) => setS((v) => ({ ...v, ...p }));
  const patchStep = (i: number, p: Partial<ScenarioStep>) => setS((v) => ({ ...v, steps: v.steps.map((st, idx) => idx === i ? { ...st, ...p } : st) }));
  const addStep = () => setS((v) => ({ ...v, steps: [...v.steps, newStep()] }));
  const delStep = (i: number) => setS((v) => ({ ...v, steps: v.steps.filter((_, idx) => idx !== i) }));

  const candidates = useMemo(() => scenarioCandidates(members, s, sourceIndex), [members, s, sourceIndex]);
  const sample: Partial<Member> = candidates[0] ?? {
    name: "山田 太郎", kana: "ヤマダ タロウ", company: "ABC商事",
    sourceId: s.targetSourceIds[0] ?? null, prefecture: "東京都", email: "taro@example.com",
  };

  const insertVar = (i: number, token: string) => {
    const ta = document.getElementById(`sc-msg-${i}`) as HTMLTextAreaElement | null;
    const st = s.steps[i];
    if (!ta) { patchStep(i, { messageBody: st.messageBody + token }); return; }
    const a = ta.selectionStart, b = ta.selectionEnd;
    patchStep(i, { messageBody: st.messageBody.slice(0, a) + token + st.messageBody.slice(b) });
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = a + token.length; }, 0);
  };

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
  };

  const save = async () => {
    if (!s.name.trim()) { setMsg({ ok: false, text: "シナリオ名を入力してください" }); return; }
    if (s.steps.length === 0) { setMsg({ ok: false, text: "ステップを1つ以上追加してください" }); return; }
    if (s.steps.some((st) => !st.messageBody.trim())) { setMsg({ ok: false, text: "各ステップの本文を入力してください" }); return; }
    if (s.steps.some((st) => !st.channelChat && !st.channelEmail && !st.channelLine)) { setMsg({ ok: false, text: "各ステップで配信チャネルを1つ以上選んでください" }); return; }
    if (s.steps.some((st) => st.channelLine) && s.lineAccountId == null) { setMsg({ ok: false, text: "LINEステップがあります。送信元のLINEアカウントを選択してください" }); return; }
    setBusy(true); setMsg(null);
    try {
      const nid = await saveScenario(s);
      if (!nid) throw new Error("保存に失敗しました");
      setMsg({ ok: true, text: s.active ? "シナリオを登録しました（稼働中）" : "保存しました（停止中）" });
      setTimeout(onClose, 700);
    } catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  const bulkTest = async () => {
    if (!testEmail.trim()) { setMsg({ ok: false, text: "テスト送信先メールを入力してください" }); return; }
    setBusy(true); setMsg(null);
    try {
      const nid = s.id > 0 ? s.id : await saveScenario(s);
      if (!nid) throw new Error("先に保存が必要です");
      const res = await fetch("/api/scenario/test", { method: "POST", headers: await authHeader(), body: JSON.stringify({ scenarioId: nid, email: testEmail.trim() }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "テストに失敗しました");
      setMsg({ ok: true, text: `${testEmail} に全${json.count ?? s.steps.length}ステップをテスト送信しました` });
    } catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  const delayText = (st: ScenarioStep) =>
    st.delayUnit === "immediate" ? "登録直後（即時）" : st.delayUnit === "hours" ? `${st.delayValue}時間後` : `${st.delayValue}日後${st.timeOfDay ? ` ${st.timeOfDay}` : ""}`;

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">← Scenario 一覧</button>

      {/* シナリオ設定（ヘッダ） */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">シナリオ設定 <span className="text-[11px] text-gray-400 font-normal">開始トリガーと基本情報</span></div>
        <div className="p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">シナリオ名 <span className="text-red-500">*</span></label>
              <input className={inputCls} value={s.name} onChange={(e) => patch({ name: e.target.value })} placeholder="管理用のシナリオ名" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">稼働状態</label>
              <div className="flex items-center gap-2.5">
                <button onClick={() => patch({ active: !s.active })} className={`relative w-11 h-6 rounded-full transition-colors ${s.active ? "bg-red-600" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${s.active ? "translate-x-5" : ""}`} />
                </button>
                <span className="text-[11px] text-gray-400">ONの間、トリガー合致者を自動登録して配信します（配信は数分毎の処理で送出）。</span>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">配信先設定（開始トリガー）</label>
              <select className={`${inputCls} bg-white`} value={s.triggerType} onChange={(e) => patch({ triggerType: e.target.value as ScenarioTrigger })}>
                {(Object.keys(SCENARIO_TRIGGER_LABEL) as ScenarioTrigger[]).map((k) => <option key={k} value={k}>{SCENARIO_TRIGGER_LABEL[k]}</option>)}
              </select>
            </div>
            {/* Phase 3：単一キー完全一致 → 複数経路 ＋ カテゴリ一括 */}
            <SourceTargetPicker
              sources={sources}
              sourceIds={s.targetSourceIds}
              sourceCats={s.targetSourceCats}
              onChange={({ sourceIds, sourceCats }) => patch({ targetSourceIds: sourceIds, targetSourceCats: sourceCats })}
            />
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">属性ABCで絞り込み <span className="text-gray-400 font-normal">任意・いずれか含む</span></label>
              <AttrTable tree={tree} index={index} value={s.targetAttrIds}
                onChange={(ids) => patch({ targetAttrIds: ids })} addLabel="＋ 配信対象の属性を追加" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">送信元LINEアカウント <span className="text-gray-400 font-normal">LINEステップを使う場合に必須</span></label>
              <select value={s.lineAccountId ?? ""} onChange={(e) => patch({ lineAccountId: Number(e.target.value) || null })} className={`${inputCls} max-w-[280px]`}>
                <option value="">選択なし</option>
                {lineAccounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.channelId}</option>)}
              </select>
              <p className="text-[10.5px] text-gray-400 mt-1">※ LINEステップは連携済みの友だちにのみ届きます（会員ごとにPush・本文は差し込み反映）。1通ごとに課金されます。</p>
            </div>
            <div className="inline-flex items-center gap-2 bg-neutral-900 text-white rounded-full px-3.5 py-1.5 text-xs font-bold">👥 対象になりうる顧客：{candidates.length}名</div>
          </div>
        </div>
      </div>

      {/* ステップ明細 */}
      <div className="flex items-center gap-2 px-1">
        <span className="font-extrabold text-sm">シナリオ明細（ステップ）</span>
        <span className="text-[11px] text-gray-400">上から順に、各ステップの経過時間で自動配信</span>
      </div>

      <div className="space-y-3">
        {s.steps.map((st, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-2.5 bg-gray-50 border-b border-gray-100">
              <span className="w-6 h-6 rounded-full bg-neutral-900 text-white text-[11px] font-bold grid place-items-center">{i + 1}</span>
              <b className="text-[13px]">ステップ{i + 1}</b>
              <span className="text-[11px] text-gray-400">｜{delayText(st)}</span>
              {s.steps.length > 1 && <button onClick={() => delStep(i)} className="ml-auto text-red-500 text-xs font-bold">削除</button>}
            </div>
            <div className="p-4 grid gap-4" style={{ gridTemplateColumns: "1fr 300px" }}>
              <div>
                <div className="mb-3">
                  <label className="text-xs font-semibold text-gray-500 block mb-1">配信日時設定</label>
                  <div className="flex gap-2 flex-wrap items-center">
                    <select className={`${inputCls} max-w-[130px]`} value={st.delayUnit} onChange={(e) => patchStep(i, { delayUnit: e.target.value as StepDelayUnit })}>
                      <option value="immediate">即時</option>
                      <option value="days">◯日後</option>
                      <option value="hours">◯時間後</option>
                    </select>
                    {st.delayUnit !== "immediate" && (
                      <>
                        <input type="number" min={0} className={`${inputCls} max-w-[80px]`} value={st.delayValue} onChange={(e) => patchStep(i, { delayValue: Number(e.target.value) })} />
                        <span className="text-xs text-gray-500">{st.delayUnit === "days" ? "日後" : "時間後"}</span>
                      </>
                    )}
                    {st.delayUnit === "days" && (
                      <>
                        <span className="text-xs text-gray-400">の</span>
                        <input type="time" className={`${inputCls} max-w-[120px]`} value={st.timeOfDay} onChange={(e) => patchStep(i, { timeOfDay: e.target.value })} />
                        <span className="text-[10.5px] text-gray-400">JST・任意</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="mb-2 flex gap-4 text-sm">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={st.channelChat} onChange={(e) => patchStep(i, { channelChat: e.target.checked })} /> チャット</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={st.channelEmail} onChange={(e) => patchStep(i, { channelEmail: e.target.checked })} /> メール</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={st.channelLine} onChange={(e) => patchStep(i, { channelLine: e.target.checked })} /> LINE</label>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <span className="text-[11px] text-gray-400 w-full">変数：</span>
                  {BROADCAST_VARIABLES.map((v) => (
                    <button key={v.token} onClick={() => insertVar(i, v.token)} className="text-[11.5px] border border-purple-200 bg-purple-50 text-purple-700 rounded-md px-2 py-1 font-semibold hover:bg-purple-100">{v.label}</button>
                  ))}
                </div>
                <textarea id={`sc-msg-${i}`} className={`${inputCls} min-h-[120px] leading-relaxed`} value={st.messageBody}
                  onChange={(e) => patchStep(i, { messageBody: e.target.value })} placeholder={"{{氏名}} 様\n\n本文（URLは自動リンク＆計測）"} />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">プレビュー</label>
                <div className="bg-gray-100 rounded-xl p-3 min-h-[120px]">
                  <div className="flex items-center gap-2 mb-2"><span className="w-6 h-6 rounded-full bg-neutral-900 text-white grid place-items-center text-[10px] font-bold">運</span><b className="text-[11.5px]">事務局</b></div>
                  <div className="bg-white rounded-lg rounded-tl-sm px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words shadow-sm"
                    dangerouslySetInnerHTML={{ __html: previewHtml(renderMessage(st.messageBody, sample, sourceLabel)) }} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <button onClick={addStep} className="w-full border-2 border-dashed border-gray-300 rounded-xl py-3 text-gray-500 font-bold text-sm hover:bg-gray-50">＋ ステップを追加</button>

      <div className="bg-white border border-gray-200 rounded-xl p-3 flex items-center gap-2">
        <span className="text-xs font-semibold text-gray-500">テスト送信先</span>
        <input className={`${inputCls} max-w-[280px]`} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="自分のメールに全ステップ試し送り" />
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-gray-50 to-transparent py-3 flex items-center gap-3 justify-end">
        {msg && <span className={`text-xs mr-auto ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
        <button onClick={bulkTest} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">一括テスト</button>
        <button onClick={() => setPreview(true)} className="text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50">一括プレビュー</button>
        <button onClick={save} disabled={busy} className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">{busy ? "処理中..." : "シナリオ登録"}</button>
      </div>

      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-5" onClick={(e) => { if (e.target === e.currentTarget) setPreview(false); }}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[86vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center font-bold text-sm">👁 一括プレビュー（{sample.name}さんの流れ）
              <button onClick={() => setPreview(false)} className="ml-auto text-gray-400 text-lg">✕</button></div>
            <div className="p-4 overflow-y-auto bg-gray-100 space-y-1">
              {s.steps.map((st, i) => (
                <div key={i}>
                  <div className="text-center"><span className="inline-block text-[11px] text-white bg-neutral-900 rounded-full px-3 py-1 my-2 font-bold">{delayText(st)}</span></div>
                  <div className="bg-white rounded-lg rounded-tl-sm px-3 py-2 text-[12.5px] leading-relaxed whitespace-pre-wrap break-words shadow-sm mr-auto max-w-[88%]"
                    dangerouslySetInnerHTML={{ __html: previewHtml(renderMessage(st.messageBody, sample, sourceLabel)) }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function previewHtml(text: string): string {
  return esc(text).replace(/(https?:\/\/[^\s<>"']+)/g, (u) =>
    `<a style="color:#e11d2a;text-decoration:underline;font-weight:600">${u}</a><span style="font-size:9.5px;color:#2563eb;background:#eef4ff;border-radius:5px;padding:1px 5px;margin-left:4px">🔗計測</span>`);
}

// ── レポート（ステップ×URL 訪問者）───────────────────────────
function ScenarioReport({ id, index, sourceIndex, onClose }: {
  id: number; index: AttrIndex; sourceIndex: SourceIndex; onClose: () => void;
}) {
  const { members } = useMaster();
  const [name, setName] = useState("");
  const [links, setLinks] = useState<ScenarioLinkStat[]>([]);
  const [linkId, setLinkId] = useState<number | null>(null);
  const [visitors, setVisitors] = useState<ScenarioVisitor[]>([]);

  useEffect(() => {
    fetchScenario(id).then((s) => setName(s?.name ?? ""));
    fetchScenarioLinks(id).then((ls) => { setLinks(ls); if (ls[0]) setLinkId(ls[0].linkId); });
  }, [id]);
  useEffect(() => { if (linkId != null) fetchScenarioVisitors(linkId, members).then(setVisitors); }, [linkId, members]);

  const cur = links.find((l) => l.linkId === linkId);
  const clicks = cur?.clicks ?? 0, uniques = cur?.uniques ?? 0;
  const stepIndexById = useMemo(() => {
    const ids = Array.from(new Set(links.map((l) => l.stepId)));
    const m = new Map<number, number>(); ids.forEach((sid, i) => m.set(sid, i + 1)); return m;
  }, [links]);

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">← Scenario 一覧</button>
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 flex-wrap">
        <div><div className="text-[11px] text-gray-400">シナリオ</div><div className="font-extrabold">{name || "—"}</div></div>
        <div className="ml-auto min-w-[300px]">
          <div className="text-[11px] text-gray-400 mb-1">計測URL（ステップ）</div>
          <select className={`${inputCls} bg-white`} value={linkId ?? ""} onChange={(e) => setLinkId(Number(e.target.value))}>
            {links.length === 0 && <option>URLはありません</option>}
            {links.map((l) => <option key={l.linkId} value={l.linkId}>ステップ{stepIndexById.get(l.stepId)}｜{l.url}（{l.clicks}）</option>)}
          </select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[["クリック数", `${clicks}`], ["ユニーク訪問者", `${uniques}`], ["リピート率", uniques > 0 ? `${(((clicks - uniques) / clicks || 0) * 100).toFixed(0)}%` : "—"]].map(([l, n], i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4"><div className="text-2xl font-extrabold">{n}</div><div className="text-[11px] text-gray-400 mt-0.5">{l}</div></div>
        ))}
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">訪問者一覧 <span className="text-[11px] text-gray-400 font-normal">このステップURLをクリックした顧客</span></div>
        <table className="w-full text-sm">
          <thead><tr className="tbl-head text-left text-[11px]">
            <th className="px-3 py-2.5 font-medium">訪問者</th><th className="px-3 py-2.5 font-medium">属性</th>
            <th className="px-3 py-2.5 font-medium">流入経路</th>
            <th className="px-3 py-2.5 font-medium">初回</th><th className="px-3 py-2.5 font-medium">最終</th><th className="px-3 py-2.5 font-medium">回数</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {visitors.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">まだクリックがありません。</td></tr>}
            {visitors.map((v, i) => (
              <tr key={i} className="hover:bg-gray-50/60">
                <td className="px-3 py-2.5"><b>{v.name}</b></td>
                <td className="px-3 py-2.5"><AttrChips index={index} ids={v.attrIds} /></td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{sourceLabelOf(sourceIndex, v.sourceId)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmt(v.firstClick)}</td>
                <td className="px-3 py-2.5 text-xs text-gray-500">{fmt(v.lastClick)}</td>
                <td className="px-3 py-2.5"><b>{v.count}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
