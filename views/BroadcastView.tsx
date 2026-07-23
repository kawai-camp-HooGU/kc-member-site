"use client";
// ============================================================
// 一斉配信（Lステップ風）：一覧 / 編集 / URL訪問者レポート を内部で切替
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRoute } from "../hooks/useRoute";
import { useMaster } from "../hooks/useMaster";
import { supabase } from "../lib/supabase";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex, ATTR_MODE_OPTIONS } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { AttrTable } from "../components/master/AttrTable";
import { AttrChips } from "../components/master/AttrChips";
import { SourceTargetPicker } from "../components/master/SourceTargetPicker";
import { AiBroadcastBar } from "../components/master/AiBroadcastBar";
import { errMessage } from "../lib/errors";
import type { Broadcast, BroadcastStatus, Member, Source } from "../lib/models";
import { BROADCAST_VARIABLES } from "../lib/models";
import { fetchSources, buildSourceIndex, sourceLabel as sourceLabelOf } from "../lib/sources";
import type { SourceIndex } from "../lib/sources";
import {
  fetchBroadcasts, saveBroadcast, deleteBroadcast, computeRecipients,
  renderMessage, fetchBroadcastLinks, fetchVisitors, parseEmailList,
} from "../lib/broadcast";
import type { LinkStat, BroadcastVisitor, EmailParseResult } from "../lib/broadcast";
import { useConfirm } from "../components/common/ConfirmProvider";

const EMPTY: Broadcast = {
  id: 0, title: "", status: "draft", targetMode: "filter", targetAttrIds: [], attrMode: "any", targetEmails: [],
  targetSource: "", targetSourceIds: [], targetSourceCats: [],
  // ④ 配信チャネルは重要項目。初期値は空白（未選択）とし、明示選択を必須にする。
  channelChat: false, channelEmail: false, scheduledAt: "", messageBody: "", recipientCount: 0, sentAt: "", createdAt: "",
};

// ① 配信チャネルのバッジ表示（一覧・共通）
const CHANNEL_BADGES: { key: "chat" | "email" | "line"; label: string; cls: string }[] = [
  { key: "chat",  label: "アプリ内トーク", cls: "bg-indigo-50 text-indigo-700 border-indigo-100" },
  { key: "email", label: "メール",         cls: "bg-emerald-50 text-emerald-700 border-emerald-100" },
  { key: "line",  label: "LINE",           cls: "bg-green-50 text-green-700 border-green-100" },
];
function ChannelBadges({ chat, email }: { chat: boolean; email: boolean }) {
  const on = { chat, email, line: false };
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

  const shown = items.filter((b) => filter === "all" || b.status === filter);
  const count = (s: BroadcastStatus) => items.filter((b) => b.status === s).length;

  const confirm = useConfirm();
  const remove = async (id: number) => { if (await confirm({ title: "配信を削除", message: "この配信を削除しますか？", confirmLabel: "削除する", danger: true })) { await deleteBroadcast(id); reload(); } };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">Broadcast</h1>
        <span className="text-xs text-gray-400">顧客への一斉配信・予約・効果測定</span>
        <button onClick={onNew} className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 新規配信</button>
      </div>

      <div className="flex gap-2">
        {([["all", "すべて"], ["draft", "下書き"], ["scheduled", "予約中"], ["sent", "配信済"]] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)}
            className={`text-xs px-3 py-1.5 rounded-full border ${filter === k ? "bg-red-50 border-red-200 text-red-700 font-bold" : "bg-white border-gray-200 text-gray-500"}`}>
            {l} {k === "all" ? items.length : count(k as BroadcastStatus)}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="tbl-head text-left text-[11px]">
            <th className="px-3 py-2.5 font-medium">タイトル</th>
            <th className="px-3 py-2.5 font-medium">配信チャネル</th>
            <th className="px-3 py-2.5 font-medium">配信先</th>
            <th className="px-3 py-2.5 font-medium">配信日時</th>
            <th className="px-3 py-2.5 font-medium">状態</th>
            <th className="px-3 py-2.5 font-medium">配信数</th>
            <th className="px-3 py-2.5 font-medium w-[150px]">操作</th>
          </tr></thead>
          <tbody className="divide-y divide-gray-50">
            {loading && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">読み込み中...</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-gray-400">配信はありません。「＋ 新規配信」から作成します。</td></tr>}
            {shown.map((b) => {
              const st = STATUS_TAG[b.status];
              const targetLabel = b.targetMode === "all" ? "全員" : b.targetMode === "email" ? "メールアドレス指定" : "条件で絞り込み";
              return (
                <tr key={b.id} className="hover:bg-gray-50/60">
                  <td className="px-3 py-3"><b className="text-gray-800">{b.title || "（無題）"}</b></td>
                  <td className="px-3 py-3"><ChannelBadges chat={b.channelChat} email={b.channelEmail} /></td>
                  <td className="px-3 py-3 text-xs text-gray-500">{targetLabel}</td>
                  <td className="px-3 py-3 text-xs text-gray-500">{b.status === "sent" ? fmt(b.sentAt) : b.scheduledAt ? fmt(b.scheduledAt) : "—"}</td>
                  <td className="px-3 py-3"><span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                  <td className="px-3 py-3 text-xs">{b.status === "sent" ? `${b.recipientCount} 件` : "—"}</td>
                  <td className="px-3 py-3">
                    <div className="flex gap-1.5">
                      {b.status === "sent"
                        ? <button onClick={() => onReport(b.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">レポート</button>
                        : <button onClick={() => onEdit(b.id)} className="text-xs px-2.5 py-1 rounded-md border border-gray-200 hover:bg-gray-50">編集</button>}
                      <button onClick={() => onDuplicate(b.id)} className="text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-50">複写</button>
                      <button onClick={() => remove(b.id)} className="text-xs px-2 py-1 rounded-md text-red-500 hover:bg-red-50">削除</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

  // ③ メールアドレス指定配信：貼り付けテキスト → 解析（有効/無効/重複）
  const emailParse: EmailParseResult = useMemo(() => parseEmailList(emailText), [emailText]);
  const onEmailChange = (v: string) => { setEmailText(v); patch({ targetEmails: parseEmailList(v).valid }); };

  // 配信先ラジオ切替：前モードの条件値を初期化してから切り替える（誤送信防止）
  const changeTargetMode = (mode: Broadcast["targetMode"]) => {
    setEmailText("");
    patch({
      targetMode: mode,
      targetAttrIds: [], attrMode: "any",
      targetSourceIds: [], targetSourceCats: [],
      targetEmails: [],
      // メールアドレス指定はメール配信固定（アプリ内トークは宛先を持てないため）
      ...(mode === "email" ? { channelChat: false, channelEmail: true } : {}),
    });
  };

  // 対象人数（顧客のみ）。Phase 3：カテゴリ判定に sources マスタが要るので index を渡す。
  const recipients = useMemo(() => computeRecipients(members, b, sourceIndex), [members, b, sourceIndex]);
  // 表示用の対象数：メール指定は有効メアド件数、それ以外はメンバー抽出結果
  const recipientCount = b.targetMode === "email" ? emailParse.valid.length : recipients.length;
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
    if (b.targetMode === "email" && emailParse.valid.length === 0) return "配信先メールアドレスを1件以上入力してください";
    if (!b.channelChat && !b.channelEmail) return "配信チャネルを1つ以上選んでください";
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
      const res = await fetch("/api/broadcast/test", { method: "POST", headers: await authHeader(), body: JSON.stringify({ title: b.title, message: b.messageBody, email: testEmail.trim() }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "テスト送信に失敗しました");
      setMsg({ ok: true, text: `${testEmail} にテスト送信しました` });
    } catch (e) { setMsg({ ok: false, text: errMessage(e) }); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50">← Broadcast 一覧</button>

      <div>
        <label className="text-xs font-semibold text-gray-500 block mb-1">一斉配信タイトル <span className="text-red-500">*</span></label>
        <input className={inputCls} value={b.title} onChange={(e) => patch({ title: e.target.value })} placeholder="管理用タイトル（顧客には表示されません）" />
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
        {/* 配信先設定 */}
        <div className="bg-white border border-gray-200 rounded-xl">
          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">配信先設定</div>
          <div className="p-4 space-y-3">
            {/* ③ 配信先モード：条件で絞り込み / 全員 / メールアドレス指定 */}
            <div className="grid grid-cols-3 gap-2">
              {([["filter", "条件で絞り込み"], ["all", "全員に配信"], ["email", "✉ メールアドレス指定"]] as const).map(([mode, label]) => (
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
                  {/* ② 抽出モード（メンバー抽出と同一の4モード） */}
                  <div className="mt-2">
                    <label className="text-[11px] font-bold text-gray-500 block mb-1">抽出条件</label>
                    <select value={b.attrMode} onChange={(e) => patch({ attrMode: e.target.value as Broadcast["attrMode"] })}
                      className={`${inputCls} bg-white`}>
                      {ATTR_MODE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                </div>
                {/* Phase 3：単一キー完全一致 → 複数経路 ＋ カテゴリ一括 */}
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
                <p className="text-[11px] text-gray-400">※ メールアドレス指定配信ではチャネルは「メール」に固定されます。</p>
              </div>
            )}
            <button type="button" onClick={() => setShowRecipients(true)}
              className="inline-flex items-center gap-2 bg-neutral-900 text-white rounded-full px-3.5 py-1.5 text-xs font-bold hover:bg-neutral-700 transition-colors">👥 対象：{recipientCount}{b.targetMode === "email" ? "件" : "名"} <span className="opacity-70">▾</span></button>
          </div>
        </div>

        {/* 配信日時＋チャネル */}
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
            {/* ④ 配信チャネル：重要項目として強調。初期値は未選択（EMPTY で false）。 */}
            <div className="rounded-xl border-2 border-red-500 overflow-hidden shadow-sm">
              <div className="bg-red-600 text-white px-3 py-2 text-[13px] font-bold flex items-center gap-2">
                📡 配信チャネル
                <span className="ml-auto text-[10px] bg-white text-red-700 rounded-full px-2 py-0.5 font-extrabold">必須</span>
              </div>
              <div className="p-3 grid grid-cols-2 gap-2">
                {([["chat", "💬", "アプリ内トーク", b.channelChat] as const, ["email", "✉️", "メール", b.channelEmail] as const]).map(([key, ico, label, on]) => {
                  const emailLocked = b.targetMode === "email";
                  const disabled = emailLocked && key === "chat";
                  return (
                    <button key={key} type="button" disabled={disabled}
                      onClick={() => patch(key === "chat" ? { channelChat: !b.channelChat } : { channelEmail: !b.channelEmail })}
                      className={`relative rounded-lg border-2 px-3 py-3 text-center transition-colors ${disabled ? "opacity-40 cursor-not-allowed border-gray-200" : on ? "border-red-500 bg-red-50" : "border-gray-300 hover:border-gray-400"}`}>
                      <div className="text-lg leading-none">{ico}</div>
                      <div className="text-[12.5px] font-bold mt-1">{label}</div>
                      {on && <span className="absolute top-1.5 right-2 text-red-600 font-extrabold text-sm">✓</span>}
                    </button>
                  );
                })}
              </div>
              {!b.channelChat && !b.channelEmail && (
                <p className="mx-3 mb-3 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">⚠ 配信チャネルが未選択です。1つ以上選択してください。</p>
              )}
              {b.targetMode === "email" && (
                <p className="mx-3 mb-3 text-[11px] text-gray-500">メールアドレス指定配信のため「メール」に固定しています。</p>
              )}
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">テスト送信先（メール）</label>
              <div className="flex gap-2">
                <input className={inputCls} value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="自分のメールに試し送り" />
                <button onClick={testSend} disabled={busy} className="whitespace-nowrap text-sm px-3 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50">テスト送信</button>
              </div>
            </div>
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

      <div className="sticky bottom-0 bg-gradient-to-t from-gray-50 to-transparent py-3 flex items-center gap-3 justify-end">
        {msg && <span className={`text-xs mr-auto ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
        <button onClick={saveDraft} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-50">下書き保存</button>
        <button onClick={register} disabled={busy} className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
          {busy ? "処理中..." : whenMode === "later" ? "予約登録" : "配信登録"}
        </button>
      </div>

      {/* 配信対象の内訳（誰に届くかを配信前に確認） */}
      {showRecipients && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[65] p-4" onClick={() => setShowRecipients(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm max-h-[70vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm flex items-center justify-between">
              <span>配信対象 {recipientCount}{b.targetMode === "email" ? "件" : "名"}</span>
              <button onClick={() => setShowRecipients(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <div className="overflow-y-auto p-2">
              {b.targetMode === "email"
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={() => setPendingSend(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-bold text-gray-800 mb-2">今すぐ配信しますか？</h3>
            <p className="text-sm text-gray-600 mb-4">対象 <b>{recipientCount}{b.targetMode === "email" ? "件" : "名"}</b> に今すぐ配信します。この操作は取り消せません。</p>
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
