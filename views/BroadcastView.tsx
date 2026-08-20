"use client";
// ============================================================
// 一斉配信（Lステップ風）：一覧 / 編集 / URL訪問者レポート を内部で切替
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DragEvent } from "react";
import { useRoute } from "../hooks/useRoute";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex, ATTR_MODE_OPTIONS } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { AttrTable } from "../components/master/AttrTable";
import { RichMessageEditor } from "../components/line/RichMessageEditor";
import { fetchLineAudienceCount } from "../lib/lineAnalytics";
import { AttrChips } from "../components/master/AttrChips";
import { SourceTargetPicker } from "../components/master/SourceTargetPicker";
import { AiBroadcastBar } from "../components/master/AiBroadcastBar";
import { errMessage } from "../lib/errors";
import { fetchContactLists } from "../lib/contactLists";
import { resolveListAudience, isSelectableForDelivery, unselectableReason, EMPTY_AUDIENCE, BREAKDOWN_LABEL } from "../lib/listRecipients";
import type { ListAudience } from "../lib/listRecipients";
import type { ContactList } from "../lib/models";
import type { Broadcast, BroadcastStatus, Member, Source } from "../lib/models";
import { BROADCAST_VARIABLES } from "../lib/models";
import { fetchSources, buildSourceIndex, sourceLabel as sourceLabelOf } from "../lib/sources";
import type { SourceIndex } from "../lib/sources";
import {
  fetchBroadcasts, saveBroadcast, deleteBroadcast, computeRecipients,
  renderMessage, fetchBroadcastLinks, fetchVisitors, parseEmailList,
  setBroadcastFolder,
} from "../lib/broadcast";
import { useFolders } from "../hooks/useFolders";
import { FolderPane, FOLDER_DND_MIME } from "../components/common/FolderPane";
import { Icon } from "../components/common/Icon";
import type { LinkStat, BroadcastVisitor, EmailParseResult } from "../lib/broadcast";
import { fetchLineAccounts } from "../lib/lineAccounts";
import type { LineAccount } from "../lib/models";
import { fetchAccounts as fetchMailAccounts } from "../lib/mail";
import type { MailAccount } from "../lib/mail";
import { useConfirm } from "../components/common/ConfirmProvider";

const EMPTY: Broadcast = {
  id: 0, title: "", status: "draft", targetMode: "filter", targetAttrIds: [], targetExcludeAttrIds: [], attrMode: "any", targetEmails: [],
  targetListIds: [], listDedupe: true,
  targetSource: "", targetSourceIds: [], targetSourceCats: [],
  // ① 配信チャネルは単一選択（1つだけ）。初期値は空白（未選択）とし、明示選択を必須にする。
  channelChat: false, channelEmail: false,
  channelLine: false,
  // ③④ メール件名／送信元メールアカウント（メールチャネル選択時に使用）
  mailSubject: "", mailAccountId: null, keepSentCopy: false,
  lineAccountId: null, lineAudience: "linked", lineSentCount: 0,
  scheduledAt: "", messageBody: "", recipientCount: 0, sentAt: "", createdAt: "",
  folderId: null,
};

// ① 配信チャネル（単一選択）のメタ。ラベルは「ポータルトーク」に統一。
type ChannelKey = "chat" | "email" | "line";
const CHANNELS: { key: ChannelKey; ico: string; label: string }[] = [
  { key: "chat",  ico: "💬", label: "ポータルトーク" },
  { key: "email", ico: "✉️", label: "メール" },
  { key: "line",  ico: "🟢", label: "LINE" },
];

// ① 配信チャネルのバッジ表示（一覧・共通）
const CHANNEL_BADGES: { key: ChannelKey; label: string; cls: string }[] = [
  { key: "chat",  label: "ポータルトーク", cls: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  { key: "email", label: "メール",         cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  { key: "line",  label: "LINE",           cls: "bg-green-50 text-green-700 border-green-100" },
];
function ChannelBadges({ chat, email, line = false }: { chat: boolean; email: boolean; line?: boolean }) {
  const on = { chat, email, line };
  const shown = CHANNEL_BADGES.filter((c) => on[c.key]);
  if (shown.length === 0) return <span className="text-[11px] text-gray-300">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((c) => (
        <span key={c.key} className={`inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-md border ${c.cls}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />{c.label}
        </span>
      ))}
    </span>
  );
}

const STATUS_TAG: Record<BroadcastStatus, { label: string; cls: string }> = {
  draft:     { label: "下書き",   cls: "bg-gray-100 text-gray-600" },
  scheduled: { label: "⏰ 予約中", cls: "bg-blue-50 text-blue-700" },
  sent:      { label: "✓ 配信済", cls: "bg-green-50 text-green-700" },
};
// UTCで保存された日時（toISOString / DBのtimestamptz）を JST に直して分解する。
//   ⚠️ これまで s.slice(0,16) でUTC文字列をそのまま表示していたため、配信日時が9時間ずれていた。
function jstParts(s: string): { y: string; mo: string; d: string; h: string; mi: string } | null {
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(dt);
  const g = (t: string): string => parts.find((p) => p.type === t)?.value ?? "";
  return { y: g("year"), mo: g("month"), d: g("day"), h: g("hour"), mi: g("minute") };
}
// 一覧・レポートの表示用（JST：YYYY-MM-DD HH:mm）
const fmt = (s: string): string => {
  if (!s) return "—";
  const p = jstParts(s);
  return p ? `${p.y}-${p.mo}-${p.d} ${p.h}:${p.mi}` : s.replace("T", " ").slice(0, 16);
};
// datetime-local 入力用（JST：YYYY-MM-DDTHH:mm）。UTC保存値を編集画面に戻すときに使う
const toJstLocal = (s: string): string => {
  if (!s) return "";
  const p = jstParts(s);
  return p ? `${p.y}-${p.mo}-${p.d}T${p.h}:${p.mi}` : s.slice(0, 16);
};
const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

export function BroadcastView() {
  // 画面状態は URL（/ops/broadcast ・/ops/broadcast/7 ・/ops/broadcast/7/report ・/ops/broadcast/new）
  const route = useRoute();
  const seg0 = route.detail[0] ?? null;
  const editId: number | null = seg0 && seg0 !== "new" ? Number(seg0) : null;
  const sub: "list" | "edit" | "report" =
    seg0 == null ? "list" : route.detail[1] === "report" ? "report" : "edit";
  const toList = () => route.goDetail([]);

  const [tree, setTree] = useState<AttrNode[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);
  // Phase 3：流入経路は sources マスタから取得（旧 welcome_routes(JSON) は廃止）
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

  // 複写元ID（/ops/broadcast/new?from=7）。新規作成時のみ有効。
  const fromId = editId == null ? route.qNum("from") : null;

  if (sub === "edit") return <BroadcastEdit id={editId} fromId={fromId} tree={tree} index={index} sources={sources} sourceIndex={sourceIndex} sourceLabel={sourceLabel} onClose={toList} />;
  if (sub === "report" && editId != null) return <BroadcastReport id={editId} index={index} sourceIndex={sourceIndex} onClose={toList} />;
  return <BroadcastList
    onNew={() => route.goDetail(["new"])}
    onEdit={(id) => route.goDetail([id])}
    onDuplicate={(id) => route.goDetail(["new"], { from: id })}
    onReport={(id) => route.goDetail([id, "report"])} />;
}

// ── 一覧 ──────────────────────────────────────────────────────
function BroadcastList({ onNew, onEdit, onDuplicate, onReport }: { onNew: () => void; onEdit: (id: number) => void; onDuplicate: (id: number) => void; onReport: (id: number) => void }) {
  const [items, setItems] = useState<Broadcast[]>([]);
  const [filter, setFilter] = useState<"all" | BroadcastStatus>("all");
  const [loading, setLoading] = useState(true);
  const reload = useCallback(() => { fetchBroadcasts().then((d) => { setItems(d); setLoading(false); }); }, []);
  useEffect(() => { reload(); }, [reload]);

  // ── フォルダ ──
  const fdr = useFolders("broadcast");
  // フォルダID → 件数（フォルダ横断の全件で数える）
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const b of items) if (b.folderId != null) m.set(b.folderId, (m.get(b.folderId) ?? 0) + 1);
    return m;
  }, [items]);
  // フォルダID → 名前（一覧の「フォルダ」列の表示に使う）
  const folderName = useMemo(() => new Map(fdr.folders.map((f) => [f.id, f.name])), [fdr.folders]);

  // フォルダ選択 → 状態フィルタの順で AND 絞り込み
  const inFolder = useCallback((b: Broadcast) => (fdr.selected === "unfiled" ? b.folderId == null : b.folderId === fdr.selected), [fdr.selected]);
  const shown = items.filter((b) => inFolder(b) && (filter === "all" || b.status === filter));
  const count = (s: BroadcastStatus) => items.filter((b) => inFolder(b) && b.status === s).length;
  const folderTotal = items.filter(inFolder).length;

  const confirm = useConfirm();
  const remove = async (id: number) => { if (await confirm({ title: "配信を削除", message: "この配信を削除しますか？", confirmLabel: "削除する", danger: true })) { await deleteBroadcast(id); reload(); } };

  // ── ドラッグ&ドロップ移動（楽観的更新 → 失敗でロールバック）──
  const moveRecord = useCallback(async (recordId: number, targetFolderId: number | null) => {
    const before = items;
    setItems((prev) => prev.map((b) => (b.id === recordId ? { ...b, folderId: targetFolderId } : b)));
    const ok = await setBroadcastFolder(recordId, targetFolderId);
    if (!ok) setItems(before);
  }, [items]);

  const onRowDragStart = (e: DragEvent, id: number) => {
    e.dataTransfer.setData(FOLDER_DND_MIME, String(id));
    e.dataTransfer.setData("text/plain", String(id));
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    // 大枠をウィンドウ高さに自動フィット（main の py-6=3rem を差し引く）。一覧側だけ内部スクロール。
    <div className="h-[calc(100dvh-3rem)] flex flex-col gap-4">
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">Broadcast</h1>
        <span className="text-xs text-gray-400">顧客への一斉配信・予約・効果測定</span>
        <button onClick={onNew} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 新規配信</button>
      </div>

      <div className="flex-1 min-h-0 flex border border-gray-200 rounded-2xl overflow-hidden bg-white shadow-sm">
        <FolderPane
          scope="broadcast"
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
            {([["all", "すべて"], ["draft", "下書き"], ["scheduled", "予約中"], ["sent", "配信済"]] as const).map(([k, l]) => (
              <button key={k} onClick={() => setFilter(k)}
                className={`text-xs px-3 py-1.5 rounded-full border ${filter === k ? "bg-red-50 border-red-200 text-red-700 font-bold" : "bg-white border-gray-200 text-gray-500"}`}>
                {l} {k === "all" ? folderTotal : count(k as BroadcastStatus)}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-auto bg-gray-50/40">
            <div className="p-3 flex flex-col gap-2.5">
              {loading && <div className="text-center text-gray-400 py-10 text-sm">読み込み中...</div>}
              {!loading && shown.length === 0 && <div className="text-center text-gray-400 py-10 text-sm">配信はありません。「＋ 新規配信」から作成します。</div>}
              {shown.map((b) => {
                const st = STATUS_TAG[b.status];
                const targetLabel = b.targetMode === "all" ? "全員"
                  : b.targetMode === "email" ? "メールアドレス指定"
                  : b.targetMode === "list" ? "リストから選ぶ" : "条件で絞り込み";
                return (
                  <div key={b.id} draggable onDragStart={(e) => onRowDragStart(e, b.id)}
                    className="bg-white border border-gray-200 rounded-xl px-3.5 py-3 flex items-center gap-3 hover:shadow-sm transition-shadow cursor-grab active:cursor-grabbing">
                    <span className="text-gray-300 select-none shrink-0" title="ドラッグでフォルダ移動">⠿</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <b className="text-[14px] text-gray-900">{b.title || "（無題）"}</b>
                        <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
                        {b.folderId != null && folderName.get(b.folderId)
                          ? <span title={folderName.get(b.folderId)} className="inline-flex items-center gap-1 max-w-[180px] text-[10.5px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-full pl-1.5 pr-2 py-0.5"><Icon name="folder" size={11} className="text-yellow-500 shrink-0" /><span className="truncate">{folderName.get(b.folderId)}</span></span>
                          : <span className="text-[10.5px] font-bold text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">未分類</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-2">
                        <ChannelBadges chat={b.channelChat} email={b.channelEmail} line={b.channelLine} />
                        <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">配信先 {targetLabel}</span>
                        {b.status === "sent" && <span className="text-[11px] text-gray-500 bg-gray-50 rounded-md px-2 py-0.5">配信数 <b className="text-gray-800">{b.recipientCount}</b></span>}
                        <span className="text-[11px] text-gray-400">{b.status === "sent" ? fmt(b.sentAt) : b.scheduledAt ? `予約 ${fmt(b.scheduledAt)}` : "未送信"}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {b.status === "sent"
                        ? <>
                            <button onClick={() => onReport(b.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">レポート</button>
                            {/* 配信済みは編集不可の閲覧専用で開く（複写の土台確認・内容チェック用） */}
                            <button onClick={() => onEdit(b.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">確認</button>
                          </>
                        : <button onClick={() => onEdit(b.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">編集</button>}
                      <button onClick={() => onDuplicate(b.id)} className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-50">複写</button>
                      <button onClick={() => remove(b.id)} className="text-xs px-2 py-1 rounded-md text-red-500 hover:bg-red-50">削除</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── 編集 ──────────────────────────────────────────────────────
function BroadcastEdit({ id, fromId, tree, index, sources, sourceIndex, sourceLabel, onClose }: {
  id: number | null; fromId?: number | null; tree: AttrNode[]; index: AttrIndex;
  sources: Source[]; sourceIndex: SourceIndex;
  sourceLabel: (id: number | null | undefined) => string; onClose: () => void;
}) {
  const { members, can } = useMaster();
  const [b, setB] = useState<Broadcast>(EMPTY);
  const [lineAccounts, setLineAccounts] = useState<LineAccount[]>([]);
  const [mailAccounts, setMailAccounts] = useState<MailAccount[]>([]);
  useEffect(() => { fetchLineAccounts().then(setLineAccounts); }, []);
  useEffect(() => { fetchMailAccounts().then(setMailAccounts).catch(() => setMailAccounts([])); }, []);
  const [whenMode, setWhenMode] = useState<"now" | "later">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [testEmail, setTestEmail] = useState("");
  /** ③ メールアドレス指定配信の貼り付けテキスト（解析前の生入力） */
  const [emailText, setEmailText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  /** 即時配信の最終確認モーダル表示 */
  const [pendingSend, setPendingSend] = useState(false);
  /** 配信対象の内訳（対象者一覧）モーダル表示 */
  const [showRecipients, setShowRecipients] = useState(false);
  /** AI(⑤)で原稿を生成したか（監査フラグ broadcasts.ai_assisted） */
  const [aiUsed, setAiUsed] = useState(false);

  useEffect(() => {
    // 新規：複写元（fromId）があれば既存配信を土台に「下書きの新規」を作る。なければ空。
    if (id == null) {
      if (fromId == null) { setB(EMPTY); return; }
      fetchBroadcasts().then((all) => {
        const src = all.find((x) => x.id === fromId);
        if (src) setB({ ...src, id: 0, title: `${src.title}（複写）`, status: "draft", scheduledAt: "", sentAt: "", recipientCount: 0, createdAt: "" });
        else setB(EMPTY);
      });
      return;
    }
    fetchBroadcasts().then((all) => {
      const cur = all.find((x) => x.id === id);
      if (cur) {
        setB(cur);
        setEmailText((cur.targetEmails ?? []).join("\n"));
        if (cur.scheduledAt) { setWhenMode("later"); setScheduledLocal(toJstLocal(cur.scheduledAt)); }
      }
    });
  }, [id, fromId]);

  const patch = (p: Partial<Broadcast>) => setB((s) => ({ ...s, ...p }));

  // 配信済みは編集不可（確認のみ）。閲覧用に編集画面は開けるが、入力・保存・送信はすべて無効化する。
  const readOnly = b.status === "sent";

  // ① 現在の配信チャネル（単一選択）。boolean 3種から導出。
  const channel: ChannelKey | null =
    b.channelChat ? "chat" : b.channelEmail ? "email" : b.channelLine ? "line" : null;

  // ① チャネル切替：選んだ1つだけ true にし、②不整合な配信先条件をリセットする。
  const setChannel = (c: ChannelKey) => {
    const wasEmailAddr = b.targetMode === "email";
    // リスト配信もメール専用（リストはメール・電話の集合であってポータル会員ではない）
    const wasList = b.targetMode === "list";
    patch({
      channelChat: c === "chat", channelEmail: c === "email", channelLine: c === "line",
      // メールアドレス指定はメール専用。他チャネルへ切替時は「条件で絞り込み」に戻す。
      // LINEは属性で配信先を決めるため targetMode=filter に寄せる。
      ...(c !== "email" && wasEmailAddr ? { targetMode: "filter" as const, targetEmails: [] } : {}),
      ...(c !== "email" && wasList ? { targetMode: "filter" as const, targetListIds: [] } : {}),
      ...(c === "line" ? { targetMode: "filter" as const } : {}),
    });
    if (c !== "email" && wasEmailAddr) setEmailText("");
  };

  // ② 選択チャネルで選べる配信先モード（メールのみ「メールアドレス指定」を許可）
  const targetModeOptions = (channel === "email"
    ? [["filter", "条件で絞り込み"], ["all", "全員に配信"], ["email", "✉ メールアドレス指定"], ["list", "リストから選ぶ"]]
    : [["filter", "条件で絞り込み"], ["all", "全員に配信"]]) as [Broadcast["targetMode"], string][];

  // ③ メールアドレス指定配信：貼り付けテキスト → 解析（有効/無効/重複）
  const emailParse: EmailParseResult = useMemo(() => parseEmailList(emailText), [emailText]);
  const onEmailChange = (v: string) => { setEmailText(v); patch({ targetEmails: parseEmailList(v).valid }); };

  // 配信先ラジオ切替：前モードの条件値を初期化してから切り替える（誤送信防止）
  const changeTargetMode = (mode: Broadcast["targetMode"]) => {
    setEmailText("");
    patch({
      targetMode: mode,
      targetAttrIds: [], targetExcludeAttrIds: [], attrMode: "any",
      targetSourceIds: [], targetSourceCats: [],
      targetEmails: [], targetListIds: [],
    });
  };

  // ── リスト配信（Phase 3a：下書き保存と件数表示まで。実送信は未解禁）──
  const [contactLists, setContactLists] = useState<ContactList[]>([]);
  const [listAudience, setListAudience] = useState<ListAudience>(EMPTY_AUDIENCE);
  const [listBusy, setListBusy] = useState(false);

  useEffect(() => {
    if (b.targetMode !== "list" || contactLists.length > 0) return;
    fetchContactLists().then(setContactLists);
  }, [b.targetMode, contactLists.length]);

  // 選択が変わるたびに「実際に何件送られるか」を算出する。
  //   ⚠️ 件数は必ず実データから出す。ここの数字と実績が食い違うと誤送信の温床になる。
  useEffect(() => {
    if (b.targetMode !== "list") { setListAudience(EMPTY_AUDIENCE); return; }
    if (b.targetListIds.length === 0) { setListAudience(EMPTY_AUDIENCE); return; }
    let alive = true;
    setListBusy(true);
    const t = setTimeout(() => {
      resolveListAudience(b.targetListIds, contactLists, b.listDedupe)
        .then((a) => { if (alive) { setListAudience(a); setListBusy(false); } })
        .catch(() => { if (alive) { setListAudience(EMPTY_AUDIENCE); setListBusy(false); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [b.targetMode, b.targetListIds, b.listDedupe, contactLists]);

  const toggleList = (id: number) => {
    const cur = b.targetListIds;
    patch({ targetListIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  };

  // 対象人数（顧客のみ）。Phase 3：カテゴリ判定に sources マスタが要るので index を渡す。
  const recipients = useMemo(() => computeRecipients(members, b, sourceIndex), [members, b, sourceIndex]);
  // LINE配信先の人数プレビュー（P2-A）
  const [lineCount, setLineCount] = useState<number | null>(null);
  useEffect(() => {
    if (channel !== "line" || b.lineAccountId == null) { setLineCount(null); return; }
    let alive = true;
    fetchLineAudienceCount(b.lineAccountId, b.lineAudience, recipients.map((m) => m.id), b.targetAttrIds, b.attrMode, b.targetExcludeAttrIds ?? [])
      .then((n) => { if (alive) setLineCount(n); })
      .catch(() => { if (alive) setLineCount(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, b.lineAccountId, b.lineAudience, b.targetAttrIds, b.attrMode, b.targetExcludeAttrIds, recipients]);
  // 表示用の対象数：メール指定は有効メアド件数、それ以外はメンバー抽出結果
  const recipientCount = b.targetMode === "email" ? emailParse.valid.length
    : b.targetMode === "list" ? listAudience.sendCount
    : recipients.length;
  /** リスト宛の配信かどうか（最終確認の文面を変える） */
  const isListTarget = b.targetMode === "list";
  // プレビュー用サンプル
  const sample: Partial<Member> = recipients[0] ?? {
    name: "山田 太郎", kana: "ヤマダ タロウ", company: "ABC商事",
    sourceId: b.targetSourceIds[0] ?? null, prefecture: "東京都", email: "taro@example.com",
  };
  const previewText = renderMessage(b.messageBody, sample, sourceLabel);

  const insertVar = (token: string) => {
    const ta = document.getElementById("bc-msg") as HTMLTextAreaElement | null;
    if (!ta) { patch({ messageBody: b.messageBody + token }); return; }
    const s = ta.selectionStart, e = ta.selectionEnd;
    patch({ messageBody: b.messageBody.slice(0, s) + token + b.messageBody.slice(e) });
    setTimeout(() => { ta.focus(); ta.selectionStart = ta.selectionEnd = s + token.length; }, 0);
  };

  const buildForSave = (status: BroadcastStatus): Broadcast => ({
    ...b, status,
    aiAssisted: aiUsed || b.aiAssisted,
    scheduledAt: whenMode === "later" && scheduledLocal ? new Date(scheduledLocal).toISOString() : "",
  });

  const validate = (): string | null => {
    if (!b.title.trim()) return "タイトルを入力してください";
    if (!channel) return "配信チャネルを選択してください";
    if (channel === "email") {
      if (!b.mailSubject.trim()) return "メール件名を入力してください";
      if (b.mailAccountId == null) return "送信元メールアカウントを選択してください";
      if (b.targetMode === "email" && emailParse.valid.length === 0) return "配信先メールアドレスを1件以上入力してください";
      if (b.targetMode === "list" && b.targetListIds.length === 0) return "配信先のリストを1つ以上選択してください";
    }
    if (channel === "line" && b.lineAccountId == null) return "送信元のLINEアカウントを選択してください";
    if (!b.messageBody.trim()) return "メッセージを入力してください";
    return null;
  };

  const authHeader = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
  };

  const saveDraft = async () => {
    // 下書きでもタイトル（管理用）は必須（一覧が「（無題）」だらけになるのを防ぐ）
    if (!b.title.trim()) { setMsg({ ok: false, text: "タイトルを入力してください" }); return; }
    if (b.targetMode === "list" && b.targetListIds.length === 0) {
      setMsg({ ok: false, text: "配信先のリストを1つ以上選択してください" }); return;
    }
    // 予約を選んでいる場合は日時を保持しないと再開時に「今すぐ」に戻ってしまうため、日時入力を必須化
    if (whenMode === "later" && !scheduledLocal) {
      setMsg({ ok: false, text: "予約日時を入力してください（未入力のままでは下書きに予約が保持されません）" });
      return;
    }
    setBusy(true); setMsg(null);
    try { await saveBroadcast(buildForSave("draft")); setMsg({ ok: true, text: "下書きを保存しました" }); setTimeout(onClose, 600); }
    catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  // 実際の登録処理（予約 or 即時送信）
  const doRegister = async () => {
    setBusy(true); setMsg(null);
    try {
      if (whenMode === "later") {
        await saveBroadcast(buildForSave("scheduled"));
        setMsg({ ok: true, text: "予約しました（指定時刻に自動配信）" });
      } else {
        const newId = await saveBroadcast(buildForSave("draft"));
        if (!newId) throw new Error("保存に失敗しました");
        const res = await fetch("/api/broadcast/send", { method: "POST", headers: await authHeader(), body: JSON.stringify({ broadcastId: newId }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "配信に失敗しました");
        setMsg({ ok: true, text: `${json.recipientCount ?? recipientCount}件に配信しました` });
      }
      setTimeout(onClose, 800);
    } catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  const register = () => {
    const err = validate(); if (err) { setMsg({ ok: false, text: err }); return; }
    if (whenMode === "later") {
      if (!scheduledLocal) { setMsg({ ok: false, text: "配信日時を指定してください" }); return; }
      void doRegister();
    } else {
      // 即時配信は取り消せないため最終確認を挟む
      setPendingSend(true);
    }
  };

  const testSend = async () => {
    if (!testEmail.trim()) { setMsg({ ok: false, text: "テスト送信先メールを入力してください" }); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/broadcast/test", { method: "POST", headers: await authHeader(), body: JSON.stringify({ title: b.mailSubject.trim() || b.title, message: b.messageBody, email: testEmail.trim() }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "テスト送信に失敗しました");
      setMsg({ ok: true, text: `${testEmail} にテスト送信しました` });
    } catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">← Broadcast 一覧</button>

      {readOnly && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">
          <span className="font-bold">🔒 配信済みのため編集できません</span>
          <span className="text-amber-700">内容の確認のみ可能です。同じ内容を再利用する場合は一覧の「複写」から新規作成してください。</span>
        </div>
      )}

      <fieldset disabled={readOnly} className="space-y-4 min-w-0 border-0 p-0 m-0 disabled:opacity-95">
      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">一斉配信タイトル <span className="text-red-500">*</span></label>
        <input className={inputCls} value={b.title} onChange={(e) => patch({ title: e.target.value })} placeholder="管理用タイトル（顧客には表示されません）" />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* ① 配信日時＋チャネル（チャネルは単一選択。先に選ぶと右の配信先設定が切り替わる） */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">配信日時・チャネル</div>
          <div className="p-4 space-y-3">
            <div className="flex gap-2">
              {(["now", "later"] as const).map((w) => (
                <label key={w} className={`flex-1 border rounded-lg px-3 py-2 text-sm cursor-pointer ${whenMode === w ? "border-red-400 bg-red-50 font-bold" : "border-gray-300"}`}>
                  <input type="radio" className="mr-1.5" checked={whenMode === w} onChange={() => setWhenMode(w)} />
                  {w === "now" ? "今すぐ配信" : "予約配信"}
                </label>
              ))}
            </div>
            {whenMode === "later" && (
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">配信日時（JST）</label>
                <input type="datetime-local" className={inputCls} value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
              </div>
            )}
            {/* ① 配信チャネル：単一選択（1つだけ）。初期値は未選択（EMPTY で false）。 */}
            <div className="rounded-xl border-2 border-red-500 overflow-hidden shadow-sm">
              <div className="bg-red-600 text-white px-3 py-2 text-[13px] font-bold flex items-center gap-2">
                📡 配信チャネル <span className="text-[10px] opacity-90 font-normal">1つだけ選択</span>
                <span className="ml-auto text-[10px] bg-white text-red-700 rounded-full px-2 py-0.5 font-extrabold">必須</span>
              </div>
              <div className="p-3 grid grid-cols-3 gap-2">
                {CHANNELS.map(({ key, ico, label }) => {
                  const on = channel === key;
                  return (
                    <button key={key} type="button"
                      onClick={() => setChannel(key)}
                      className={`relative rounded-lg border-2 px-3 py-3 text-center transition-colors ${on ? "border-red-500 bg-red-50" : "border-gray-300 hover:border-gray-400"}`}>
                      <div className="text-lg leading-none">{ico}</div>
                      <div className="text-[12.5px] font-bold mt-1">{label}</div>
                      {on && <span className="absolute top-1.5 right-2 text-red-600 font-extrabold text-sm">✓</span>}
                    </button>
                  );
                })}
              </div>
              {/* ④ メール：送信元アカウント ＋ ③ メール件名 */}
              {channel === "email" && (
                <div className="mx-3 mb-3 border border-emerald-200 bg-emerald-50/40 rounded-lg p-3 space-y-2">
                  <div>
                    <label className="text-[11px] font-bold text-gray-600 block mb-1">送信元メールアカウント <span className="text-red-500">*</span></label>
                    <select value={b.mailAccountId ?? ""} onChange={(e) => patch({ mailAccountId: Number(e.target.value) || null })} className={inputCls}>
                      <option value="">選択してください</option>
                      {mailAccounts.map((a) => <option key={a.id} value={a.id}>{a.displayName ? `${a.displayName}（${a.address}）` : a.address}</option>)}
                    </select>
                    {mailAccounts.length === 0 && <p className="text-[10.5px] text-amber-600 mt-1">送信可能なメールアカウントがありません。メール設定でアカウントを登録してください。</p>}
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-gray-600 block mb-1">メール件名 <span className="text-red-500">*</span></label>
                    <input className={inputCls} value={b.mailSubject} onChange={(e) => patch({ mailSubject: e.target.value })} placeholder="例）【KAWAI CAMP】夏キャンプ 早割は7/31まで" />
                    <p className="text-[10.5px] text-gray-400 mt-1">※ 一斉配信タイトル（管理用）とは別に、このメール件名が受信者に表示されます。</p>
                  </div>
                  {/* 送信履歴（送信ボックス）を残す */}
                  <label className="flex items-start gap-2 pt-1 cursor-pointer">
                    <input type="checkbox" className="mt-0.5" checked={b.keepSentCopy} onChange={(e) => patch({ keepSentCopy: e.target.checked })} />
                    <span className="text-[11.5px] text-gray-700 leading-relaxed">
                      <b>送信履歴を残す</b>（送信ボックスに保存）
                      <span className="block text-[10.5px] text-gray-400">送信元アカウントの送信済みフォルダに各通を保存します。大量配信では送信に時間がかかる場合があります。未選択（既定）は保存しません。</span>
                    </span>
                  </label>
                </div>
              )}
              {/* LINE：送信元アカウント（配信先＝右の配信先設定へ） */}
              {channel === "line" && (
                <div className="mx-3 mb-3 border border-emerald-200 bg-emerald-50/40 rounded-lg p-3">
                  <label className="text-[11px] font-bold text-gray-600 block mb-1">送信元LINEアカウント <span className="text-red-500">*</span></label>
                  <select value={b.lineAccountId ?? ""} onChange={(e) => patch({ lineAccountId: Number(e.target.value) || null })} className={inputCls}>
                    <option value="">選択してください</option>
                    {lineAccounts.map((a) => <option key={a.id} value={a.id}>{a.name || a.channelId}</option>)}
                  </select>
                  <p className="text-[10.5px] text-gray-500 mt-2">※ LINEは全員同一本文で送信します（差し込み変数は反映されません）。1通ごとに課金されます。配信先は右の「配信先設定」で指定します。</p>
                  <div className="mt-3 border-t border-emerald-200 pt-3">
                    <label className="text-[11px] font-bold text-gray-600 block mb-1.5">リッチメッセージ <span className="text-gray-400 font-normal">（任意・未設定なら本文テキストを送信）</span></label>
                    <RichMessageEditor value={b.messageJson ?? null} onChange={(mj) => patch({ messageJson: mj })} accountId={b.lineAccountId} />
                  </div>
                </div>
              )}
              {!channel && (
                <p className="mx-3 mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠ 配信チャネルが未選択です。1つ選択してください。</p>
              )}
            </div>
            {/* テスト送信（メール） */}
            {channel === "email" && (
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">テスト送信先（メール）</label>
                <div className="flex gap-2">
                  <input className={inputCls} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="自分のメールに試し送り" />
                  <button onClick={testSend} disabled={busy} className="whitespace-nowrap text-sm px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">テスト送信</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ② 配信先設定：選択チャネルに連動して切り替わる */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">配信先設定</div>
          <div className="p-4 space-y-3">
            {!channel && (
              <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-4 text-center">先に配信チャネルを選択してください。チャネルに合わせて配信先の指定方法が表示されます。</p>
            )}

            {/* ポータルトーク / メール：配信先モード（メールのみ「メールアドレス指定」あり） */}
            {channel != null && channel !== "line" && (
              <>
                <div className={`grid gap-2 ${channel === "email" ? "grid-cols-3" : "grid-cols-2"}`}>
                  {targetModeOptions.map(([mode, label]) => (
                    <label key={mode} className={`border rounded-lg px-3 py-2 text-xs cursor-pointer text-center ${b.targetMode === mode ? "border-red-400 bg-red-50 font-bold" : "border-gray-300"}`}>
                      <input type="radio" className="mr-1" checked={b.targetMode === mode} onChange={() => changeTargetMode(mode)} />
                      {label}
                    </label>
                  ))}
                </div>
                {b.targetMode === "filter" && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">属性ABC</label>
                      <AttrTable tree={tree} index={index} value={b.targetAttrIds}
                        onChange={(ids) => patch({ targetAttrIds: ids })} addLabel="＋ 配信対象の属性を追加" />
                      <div className="mt-2">
                        <label className="text-xs font-semibold text-gray-500 block mb-1">除外する属性 <span className="text-gray-400 font-normal">この属性を持つ人は対象外</span></label>
                        <AttrTable tree={tree} index={index} value={b.targetExcludeAttrIds ?? []}
                          onChange={(ids) => patch({ targetExcludeAttrIds: ids })} addLabel="＋ 除外する属性を追加" />
                      </div>
                      <div className="mt-2">
                        <label className="text-[11px] font-bold text-gray-500 block mb-1">抽出条件</label>
                        <select value={b.attrMode} onChange={(e) => patch({ attrMode: e.target.value as Broadcast["attrMode"] })}
                          className={`${inputCls} bg-white`}>
                          {ATTR_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <SourceTargetPicker
                      sources={sources}
                      sourceIds={b.targetSourceIds}
                      sourceCats={b.targetSourceCats}
                      onChange={({ sourceIds, sourceCats }) => patch({ targetSourceIds: sourceIds, targetSourceCats: sourceCats })}
                    />
                  </>
                )}
                {b.targetMode === "all" && (
                  <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">現在の全メンバー（削除・運営を除く）へ配信します。</p>
                )}
                {b.targetMode === "email" && (
                  <div className="space-y-2">
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">配信先メールアドレス <span className="text-red-500">*</span> <span className="text-gray-400 font-normal">スプレッドシートからコピペで一括入力</span></label>
                      <textarea value={emailText} onChange={(e) => onEmailChange(e.target.value)}
                        className={`${inputCls} min-h-[120px] leading-relaxed`}
                        placeholder={"カンマ・改行・スペース・タブ区切りに対応\ntaro@example.com\nhanako@example.com, ichiro@example.com"} />
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="inline-flex items-center gap-1 bg-neutral-900 text-white rounded-full px-2.5 py-1 font-bold">✉ 有効 {emailParse.valid.length}件</span>
                      {emailParse.invalid.length > 0 && <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-1 font-bold">⚠ 形式エラー {emailParse.invalid.length}件</span>}
                      {emailParse.duplicates > 0 && <span className="inline-flex items-center gap-1 bg-gray-100 text-gray-500 rounded-full px-2.5 py-1">重複除去 {emailParse.duplicates}件</span>}
                    </div>
                    {emailParse.invalid.length > 0 && (
                      <p className="text-[11px] text-amber-600 break-all">形式エラー：{emailParse.invalid.slice(0, 5).join(" , ")}{emailParse.invalid.length > 5 ? " …" : ""}</p>
                    )}
                  </div>
                )}

                {b.targetMode === "list" && (
                  <div className="space-y-2">
                    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                      <p className="text-[11px] text-gray-600">
                        選んだリストのメールアドレスへ<b>1通ずつ個別に</b>送信します（CC/BCCは使いません）。
                        配信停止リストのアドレスは<b>送信直前にもう一度照合</b>して除外します。
                      </p>
                    </div>

                    {contactLists.length === 0 ? (
                      <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-4 text-center">
                        リストがありません。「顧客 ＞ リスト」で作成してください。
                      </p>
                    ) : (
                      <div className="border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-[11.5px]">
                          <thead>
                            <tr className="tbl-head">
                              <th className="px-2 py-2 w-8"></th>
                              <th className="px-2.5 py-2 text-left font-medium">リスト名</th>
                              <th className="px-2 py-2 text-right font-medium whitespace-nowrap">総件数</th>
                              <th className="px-2 py-2 text-right font-medium whitespace-nowrap">メール可</th>
                              <th className="px-2 py-2 text-right font-medium whitespace-nowrap">電話のみ</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {contactLists.map((l) => {
                              const ok = isSelectableForDelivery(l);
                              const reason = unselectableReason(l);
                              const on = b.targetListIds.includes(l.id);
                              return (
                                <tr key={l.id} className={ok ? "hover:bg-gray-50/60" : "opacity-50"}>
                                  <td className="px-2 py-1.5 text-center">
                                    <input type="checkbox" checked={on} disabled={!ok}
                                      onChange={() => toggleList(l.id)} aria-label={`${l.name} を選択`} />
                                  </td>
                                  <td className="px-2.5 py-1.5">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <b className="text-gray-800">{l.name}</b>
                                      {!ok && (
                                        <span className="text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300">
                                          {reason}
                                        </span>
                                      )}
                                    </div>
                                    {l.description && <div className="text-[10px] text-gray-400 truncate">{l.description}</div>}
                                  </td>
                                  <td className="px-2 py-1.5 text-right font-mono">{l.entryCount.toLocaleString()}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-emerald-700 font-bold">{l.emailableCount.toLocaleString()}</td>
                                  <td className="px-2 py-1.5 text-right font-mono text-amber-700">{l.phoneOnlyCount.toLocaleString()}</td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    <label className="flex items-center gap-2 text-[11.5px] text-gray-700 cursor-pointer">
                      <input type="checkbox" checked={b.listDedupe} onChange={(e) => patch({ listDedupe: e.target.checked })} />
                      複数リストで重複するアドレスは1通だけ送る（重複排除）
                    </label>

                    {b.targetListIds.length > 0 && (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
                        {listBusy ? (
                          <p className="text-[11.5px] text-emerald-800">送信件数を計算しています…</p>
                        ) : (
                          <>
                            <p className="text-[12.5px] font-bold text-emerald-800 mb-1">
                              この設定で送られるのは <span className="text-[17px]">{listAudience.sendCount.toLocaleString()}</span> 件です
                            </p>
                            <p className="text-[11px] text-emerald-900 leading-relaxed">
                              対象 {listAudience.targetCount.toLocaleString()} 件（{b.targetListIds.length}リストの合計）
                              − 除外 {listAudience.excludedCount.toLocaleString()} 件 = <b>{listAudience.sendCount.toLocaleString()} 件</b>
                              <br />
                              {(Object.keys(listAudience.breakdown) as (keyof typeof listAudience.breakdown)[])
                                .map((k) => `・${BREAKDOWN_LABEL[k]}：${listAudience.breakdown[k]} 件`)
                                .join("　")}
                            </p>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* LINE：配信先（連携済み会員 / 属性で絞る / 友だち全員）＋属性・経路の絞り込み */}
            {channel === "line" && (
              <>
                <div>
                  <label className="text-[11px] font-bold text-gray-500 block mb-1">LINEの配信先</label>
                  <div className="flex gap-2 flex-wrap">
                    {([["linked", "連携済み会員（属性）"], ["attr", "属性で絞る（未連携も）"], ["all", "友だち全員"]] as const).map(([v, l]) => (
                      <button key={v} type="button" onClick={() => patch({ lineAudience: v })}
                        className={`text-[11.5px] font-bold rounded-lg px-3 py-1.5 border ${b.lineAudience === v ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-300 text-gray-600"}`}>{l}</button>
                    ))}
                  </div>
                  <p className="text-[10.5px] text-gray-500 mt-2">「連携済み会員（属性）」＝下の絞り込み属性に一致する連携済み会員。「属性で絞る（未連携も）」＝同じ属性条件で、未連携の友だち（LINE入口で付与したタグ）も対象に含めます。「友だち全員」＝アカウントの友だち全員。</p>
                </div>
                {b.lineAudience !== "all" && (
                  <>
                    <div>
                      <label className="text-xs font-semibold text-gray-500 block mb-1">属性ABC</label>
                      <AttrTable tree={tree} index={index} value={b.targetAttrIds}
                        onChange={(ids) => patch({ targetAttrIds: ids })} addLabel="＋ 配信対象の属性を追加" />
                      <div className="mt-2">
                        <label className="text-xs font-semibold text-gray-500 block mb-1">除外する属性 <span className="text-gray-400 font-normal">この属性を持つ人は対象外</span></label>
                        <AttrTable tree={tree} index={index} value={b.targetExcludeAttrIds ?? []}
                          onChange={(ids) => patch({ targetExcludeAttrIds: ids })} addLabel="＋ 除外する属性を追加" />
                      </div>
                      <div className="mt-2">
                        <label className="text-[11px] font-bold text-gray-500 block mb-1">抽出条件</label>
                        <select value={b.attrMode} onChange={(e) => patch({ attrMode: e.target.value as Broadcast["attrMode"] })}
                          className={`${inputCls} bg-white`}>
                          {ATTR_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                    </div>
                    <SourceTargetPicker
                      sources={sources}
                      sourceIds={b.targetSourceIds}
                      sourceCats={b.targetSourceCats}
                      onChange={({ sourceIds, sourceCats }) => patch({ targetSourceIds: sourceIds, targetSourceCats: sourceCats })}
                    />
                  </>
                )}
              </>
            )}

            {channel != null && (
              <div className="flex items-center gap-2 flex-wrap">
                <button type="button" onClick={() => setShowRecipients(true)}
                  className="inline-flex items-center gap-2 bg-neutral-900 text-white rounded-full px-3.5 py-1.5 text-xs font-bold hover:bg-neutral-700 transition-colors">👥 対象：{recipientCount}{b.targetMode === "email" || b.targetMode === "list" ? "件" : "名"} <span className="opacity-70">▾</span></button>
                {channel === "line" && lineCount != null && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1.5">LINE配信先 約{lineCount}人{b.lineAudience === "attr" ? "（目安）" : ""}</span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* メッセージ */}
      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">配信メッセージ設定 <span className="text-[11px] text-gray-400 font-normal">変数で顧客情報を差込・URLは自動リンク＆計測</span></div>
        <div className="p-4 grid gap-5" style={{ gridTemplateColumns: "1.05fr .95fr" }}>
          <div>
            {/* ⑤ AIで配信原稿を生成（画面上の配信先条件をそのまま生成条件に使う） */}
            {can("ai_draft") && (
              <div className="mb-4">
                <AiBroadcastBar
                  target={{ targetMode: b.targetMode === "filter" ? "filter" : "all", targetAttrIds: b.targetAttrIds, targetSourceIds: b.targetSourceIds, targetSourceCats: b.targetSourceCats }}
                  messageBody={b.messageBody}
                  onApply={(t) => { patch({ messageBody: t }); setAiUsed(true); }}
                />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5 mb-2">
              <span className="text-[11px] text-gray-400 w-full mb-0.5">変数を挿入：</span>
              {BROADCAST_VARIABLES.map((v) => (
                <button key={v.token} onClick={() => insertVar(v.token)} className="text-[11.5px] border border-purple-200 bg-purple-50 text-purple-700 rounded-md px-2 py-1 font-semibold hover:bg-purple-100">{v.label}</button>
              ))}
            </div>
            <textarea id="bc-msg" className={`${inputCls} min-h-[200px] leading-relaxed`} value={b.messageBody}
              onChange={(e) => patch({ messageBody: e.target.value })}
              placeholder={"{{氏名}} 様\n\nいつもKAWAI CAMPをご利用いただきありがとうございます。\n詳細はこちら 👇\nhttps://kawaicamp-portal.com/lp/xxx\n\nKAWAI CAMP 事務局"} />
            <p className="text-[11px] text-gray-400 mt-2">💡 URLは配信ごと・顧客ごとに計測リンクへ自動変換され、「レポート（URL訪問者）」で誰がクリックしたか確認できます。</p>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">プレビュー <span className="text-gray-400 font-normal">（{sample.name}さんの場合）</span></label>
            <div className="bg-gray-100 rounded-xl p-4 min-h-[220px]">
              <div className="flex items-center gap-2 mb-3"><span className="w-7 h-7 rounded-full bg-neutral-900 text-white grid place-items-center text-[11px] font-bold">運</span><b className="text-xs">KAWAI CAMP 事務局</b></div>
              <div className="bg-white rounded-lg rounded-tl-sm px-3 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap break-words shadow-sm"
                dangerouslySetInnerHTML={{ __html: previewHtml(previewText) }} />
            </div>
          </div>
        </div>
      </div>

      </fieldset>

      {readOnly ? (
        <div className="sticky bottom-0 bg-gradient-to-t from-gray-50 to-transparent py-3 flex items-center gap-3 justify-end">
          <span className="text-xs text-gray-400 mr-auto">配信済みの配信は編集・再送信できません。</span>
          <button onClick={onClose} className="text-sm px-5 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 font-medium hover:bg-gray-50">一覧へ戻る</button>
        </div>
      ) : (
        <div className="sticky bottom-0 bg-gradient-to-t from-gray-50 to-transparent py-3 flex items-center gap-3 justify-end">
          {msg && <span className={`text-xs mr-auto ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
          <button onClick={saveDraft} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">下書き保存</button>
          <button onClick={register} disabled={busy} className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
            {busy ? "処理中..." : whenMode === "later" ? "予約登録" : "配信登録"}
          </button>
        </div>
      )}

      {/* 配信対象の内訳（誰に届くかを配信前に確認） */}
      {showRecipients && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center md:items-center z-[65] p-4" onClick={() => setShowRecipients(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm flex items-center justify-between">
              <span>配信対象 {recipientCount}{b.targetMode === "email" || b.targetMode === "list" ? "件" : "名"}</span>
              <button onClick={() => setShowRecipients(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-2">
              {b.targetMode === "list"
                ? (listAudience.recipients.length === 0
                    ? <p className="text-sm text-gray-400 p-6 text-center">送信できる宛先がありません</p>
                    : listAudience.recipients.slice(0, 500).map((r) => (
                        <div key={`${r.listId}:${r.emailNorm}`} className="px-3 py-2 text-sm border-b border-gray-50 last:border-0 flex items-center gap-2">
                          {r.name && <span className="font-medium text-gray-800 shrink-0">{r.name}</span>}
                          <span className="text-xs text-gray-400 truncate">{r.email}</span>
                        </div>
                      )))
                : b.targetMode === "email"
                ? (emailParse.valid.length === 0
                    ? <p className="text-sm text-gray-400 p-6 text-center">有効なメールアドレスがありません</p>
                    : emailParse.valid.map((e) => (
                        <div key={e} className="px-3 py-2 text-sm border-b border-gray-50 last:border-0 text-gray-700 truncate">{e}</div>
                      )))
                : recipients.length === 0
                  ? <p className="text-sm text-gray-400 p-6 text-center">条件に一致する対象者がいません</p>
                  : recipients.map((m) => (
                      <div key={m.id} className="px-3 py-2 text-sm border-b border-gray-50 last:border-0 flex items-center gap-2">
                        <span className="font-medium text-gray-800">{m.name}</span>
                        {m.email && <span className="text-xs text-gray-400 truncate">{m.email}</span>}
                      </div>
                    ))}
            </div>
          </div>
        </div>
      )}

      {/* 即時配信の最終確認（取り消し不可のため） */}
      {pendingSend && (
        <div className="fixed inset-0 bg-black/40 flex items-end justify-center md:items-center z-[60] p-4" onClick={() => setPendingSend(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-2">今すぐ配信しますか？</h3>
            {isListTarget ? (
              <div className="mb-4">
                <p className="text-sm text-gray-600 mb-2">
                  リストの <b className="text-red-700">{listAudience.sendCount.toLocaleString()}件</b> に今すぐ配信します。この操作は取り消せません。
                </p>
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                  <p className="text-[11px] text-gray-600 leading-relaxed">
                    対象 {listAudience.targetCount.toLocaleString()} 件 − 除外 {listAudience.excludedCount.toLocaleString()} 件
                    <br />
                    {(Object.keys(listAudience.breakdown) as (keyof typeof listAudience.breakdown)[])
                      .map((k) => `・${BREAKDOWN_LABEL[k]}：${listAudience.breakdown[k]} 件`)
                      .join("　")}
                  </p>
                </div>
                <p className="text-[11px] text-amber-700 mt-2">
                  送信直前に配信停止リストを再照合するため、実際の送信数はこれより少なくなることがあります。
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 mb-4">対象 <b>{recipientCount}{b.targetMode === "email" ? "件" : "名"}</b> に今すぐ配信します。この操作は取り消せません。</p>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setPendingSend(false)} disabled={busy}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              <button onClick={() => { setPendingSend(false); void doRegister(); }} disabled={busy}
                className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">送信する</button>
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

// ── レポート（URL訪問者）───────────────────────────────────────
function BroadcastReport({ id, index, sourceIndex, onClose }: {
  id: number; index: AttrIndex; sourceIndex: SourceIndex; onClose: () => void;
}) {
  const { members } = useMaster();
  const [b, setB] = useState<Broadcast | null>(null);
  const [links, setLinks] = useState<LinkStat[]>([]);
  const [linkId, setLinkId] = useState<number | null>(null);
  const [visitors, setVisitors] = useState<BroadcastVisitor[]>([]);

  useEffect(() => {
    fetchBroadcasts().then((all) => setB(all.find((x) => x.id === id) ?? null));
    fetchBroadcastLinks(id).then((ls) => { setLinks(ls); if (ls[0]) setLinkId(ls[0].linkId); });
  }, [id]);
  useEffect(() => { if (linkId != null) fetchVisitors(linkId, members).then(setVisitors); }, [linkId, members]);

  const cur = links.find((l) => l.linkId === linkId);
  const recip = b?.recipientCount ?? 0;
  const clicks = cur?.clicks ?? 0;
  const uniques = cur?.uniques ?? 0;
  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "—");

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">← Broadcast 一覧</button>

      <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4 flex-wrap">
        <div><div className="text-[11px] text-gray-400">配信</div><div className="font-extrabold">{b?.title || "—"}</div></div>
        <div className="ml-auto min-w-[260px]">
          <div className="text-[11px] text-gray-400 mb-1">計測URL</div>
          <select className={`${inputCls} bg-white`} value={linkId ?? ""} onChange={(e) => setLinkId(Number(e.target.value))}>
            {links.length === 0 && <option>URLはありません</option>}
            {links.map((l) => <option key={l.linkId} value={l.linkId}>{l.url}（クリック{l.clicks}）</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3">
        {[["配信数", `${recip}`, ""], ["クリック数", `${clicks}`, `クリック率 ${pct(clicks, recip)}`], ["ユニーク訪問者", `${uniques}`, ""], ["訪問者率", pct(uniques, recip), "ユニーク/配信"]].map(([l, n, d], i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-2xl font-extrabold">{n}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{l}</div>
            {d && <div className="text-[10.5px] text-green-600 mt-1">{d}</div>}
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
        <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">訪問者一覧 <span className="text-[11px] text-gray-400 font-normal">このURLをクリックした顧客</span></div>
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
