"use client";
// ============================================================
// メンバー詳細画面（/ops/members/[id]）
//
//   BEFORE：設定 ＞ メンバー の編集はモーダル。縦に長く、
//           属性・利用状況・通知が1本のスクロールに詰め込まれていた。
//   AFTER ：1画面に昇格。メンバー一覧の「編集」から **別ウィンドウ** で開く。
//
//   ⚠️ 別ウィンドウなので MasterContext（app.tsx が配る全件データ）が無い。
//      この画面に必要なデータは lib/memberDetail.ts で単体取得する。
//
//   ⚠️ 流入経路（source_id）はこの画面では扱わない（要望により削除）。
//      付与は「招待」と「公開フォームの ?src=」で行われる。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex, PREFECTURES, notifyState } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import { saveMemberExtras } from "../lib/members";
import { fetchMemberDetail, saveMemberBasic } from "../lib/memberDetail";
import type { MemberLineLink } from "../lib/memberDetail";
import { DeleteMemberDialog } from "../components/master/DeleteMemberDialog";
import { fetchContentData } from "../lib/contents";
import {
  fetchContentViews, buildViewIndex, memberProgress, relDays, fmtDateTime,
} from "../lib/engagement";
import type { ContentViewRow } from "../lib/engagement";
import type { Member, MemberMemo, MemoTitle, ContentPage, CmsContent } from "../lib/models";
import { fetchMemoTitles, activeMemoTitles, memoTitleName } from "../lib/memoTitles";
import { allRoles, isStaffRole, roleBadgeClass, loadRoles } from "../lib/roles";
import { isValidEmail, isValidPhone } from "../lib/validators";
import { errMessage } from "../lib/errors";
import { AttrTable } from "../components/master/AttrTable";
import { ChatSummaryCard } from "../components/master/ChatSummaryCard";
import { MemberFormsCard } from "../components/master/MemberFormsCard";
import { MemberMergeHistoryCard } from "../components/master/MemberMergeHistoryCard";
import { MemberListsCard } from "../components/master/MemberListsCard";
import { MemberPaymentsCard } from "../components/master/MemberPaymentsCard";
import { MemberRefundsCard } from "../components/master/MemberRefundsCard";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import { Icon } from "../components/common/Icon";
import type { IconName } from "../components/common/Icon";
import { closeSelf, notifyOpener, returnToOpener, openChildWindow } from "../lib/childWindow";

// タブ構成（サマリーバー付き2カラム × タブ整理のマージ）
type MemberTab = "summary" | "basic" | "chat" | "pay" | "form" | "content";
const MEMBER_TABS: { key: MemberTab; label: string; icon: IconName }[] = [
  { key: "summary", label: "サマリー",     icon: "chart" },
  { key: "basic",   label: "基本情報",     icon: "users" },
  { key: "chat",    label: "チャット履歴", icon: "chat" },
  { key: "pay",     label: "決済・解約",   icon: "doc" },
  { key: "form",    label: "フォーム履歴", icon: "form" },
  { key: "content", label: "コンテンツ",   icon: "content" },
];

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const card = "bg-white border border-gray-200 rounded-xl";
const nowStr = () => new Date().toISOString().slice(0, 16).replace("T", " ");

/**
 * メモ本文から http(s) のURLを拾う（「本文中のリンク」用）。
 *   ⚠️ 日本語文中では URL の直後に 。、） などが続くことが多い。
 *      そのまま含めるとリンクが壊れるので末尾の記号は落とす。
 */
const URL_RE = /https?:\/\/[^\s<>"'「」【】（）]+/g;
function extractUrls(text: string): string[] {
  const out: string[] = [];
  for (const raw of (text || "").match(URL_RE) ?? []) {
    const u = raw.replace(/[)\]}>。、，．,.:;!?！？]+$/, "");
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

interface Edit {
  name: string; kana: string; email: string; tel: string;
  role: string; company: string; chatId: string; prefecture: string;
  attrIds: number[]; memos: MemberMemo[];
}

export function MemberDetailView({ memberId }: { memberId: number }) {
  const toast = useToast();
  const confirm = useConfirm();

  const [member, setMember]   = useState<Member | null>(null);
  const [convId, setConvId]   = useState<number | null>(null);
  // LINE連携（名寄せ済みの友だち）。基本情報タブで表示する
  const [lineLinks, setLineLinks] = useState<MemberLineLink[]>([]);
  // メモの開閉（トグル）。キーは保存済みなら id、未保存なら並び順
  const [openMemos, setOpenMemos] = useState<Set<string>>(new Set());
  const [urlCopied, setUrlCopied] = useState(false);
  const [edit, setEdit]       = useState<Edit | null>(null);
  const [tree, setTree]       = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [tab, setTab] = useState<MemberTab>("basic");
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** ログイン中の運営ロール（付与できるロールの絞り込みに使う） */
  const [myRole, setMyRole] = useState<string>("");
  /** ログイン中の auth ユーザーID（自分自身の編集かどうかの判定に使う） */
  const [myUserId, setMyUserId] = useState<string | null>(null);

  // メモタイトルマスタ（メモのプルダウン候補）
  const [memoTitles, setMemoTitles] = useState<MemoTitle[]>([]);

  // コンテンツ視聴（利用状況）
  const [pages, setPages]       = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [viewRows, setViewRows] = useState<ContentViewRow[]>([]);

  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);
  const viewIndex = useMemo(() => buildViewIndex(viewRows), [viewRows]);

  const load = useCallback(async () => {
    // ⚠️ この画面は app.tsx を経由しないため、ロールマスタを自前で読む。
    //    読まないと isStaffRole()/roleBadgeClass() が派生ロールを認識できず、
    //    付与できるロールの一覧からも派生ロールが落ちる。
    const [d, t] = await Promise.all([
      fetchMemberDetail(memberId), loadAttributeTree(), loadRoles(),
    ]);
    setTree(t);
    if (!d) { setNotFound(true); setLoading(false); return; }
    setMember(d.member);
    setConvId(d.conversationId);
    setLineLinks(d.lineLinks ?? []);
    setEdit({
      name: d.member.name, kana: d.member.kana ?? "", email: d.member.email ?? "",
      tel: d.member.tel ?? "", role: d.member.role, company: d.member.company ?? "",
      chatId: d.member.chatId ?? "", prefecture: d.member.prefecture ?? "",
      attrIds: [...(d.member.attrIds ?? [])],
      memos: (d.member.memos ?? []).map((m) => ({ ...m })),
    });
    setLoading(false);
  }, [memberId]);

  useEffect(() => { load().catch(() => { setNotFound(true); setLoading(false); }); }, [load]);
  useEffect(() => { fetchMemoTitles().then(setMemoTitles).catch(() => setMemoTitles([])); }, []);

  useEffect(() => {
    supabase.rpc("current_member_role").then(({ data }) => setMyRole((data as string | null) ?? ""));
    supabase.auth.getUser().then(({ data }) => setMyUserId(data.user?.id ?? null));
    (async () => {
      try {
        const [{ pages, contents }, rows] = await Promise.all([fetchContentData(), fetchContentViews()]);
        setPages(pages); setContents(contents); setViewRows(rows);
      } catch { /* 利用状況は取得できなくても画面は開く */ }
    })();
  }, []);

  // 付与できるロール：管理者 → 管理者以外 ／ オペレーター → 会員側のみ
  //   ⚠️ 派生ロールはオペレーター相当の権限を持つため、付与できるのは管理者のみ。
  //   ※ 派生ロールのスタッフもオペレーターと同じ範囲を割り当てられる
  const assignableRoles: string[] = myRole === "管理者"
    ? allRoles().map((r) => r.key).filter((r) => r !== "管理者")
    : isStaffRole(myRole)
      ? allRoles().map((r) => r.key).filter((r) => !isStaffRole(r))
      : [];

  /**
   * 外部 → 本会員（メンバー等）への昇格中か。
   *   外部ロールは「パスワードなし・メール確認なし」で作られる（フォームに他人のメールを
   *   書いても登録できてしまう）。本会員に上げる時点で本人確認を取り直す必要がある。
   */
  /**
   * 自分自身のレコードか。
   *
   * ⚠️ 自分のロールを自分で変更できると、管理者が誤って降格し
   *    設定画面へ戻れなくなる（復旧は SQL 直接実行のみ）。
   *    そのためロール変更だけを禁止する（氏名・連絡先の編集は可）。
   */
  const isSelf = member?.userId != null && member.userId === myUserId;

  const promoting = member?.role === "外部" && edit != null && edit.role !== "外部";
  /** 昇格時にパスワード設定メールを送るか（既定ON） */
  const [sendSetup, setSendSetup] = useState(true);

  const patch = (p: Partial<Edit>) => setEdit((e) => (e ? { ...e, ...p } : e));

  // ── メモ ──
  const updateMemo = (i: number, p: Partial<MemberMemo>) =>
    patch({ memos: (edit?.memos ?? []).map((m, idx) => (idx === i ? { ...m, ...p, updatedAt: nowStr() } : m)) });
  const addMemo = () => {
    const next = [...(edit?.memos ?? []), { titleId: null, body: "", source: { kind: "manual" } as MemberMemo["source"], updatedAt: nowStr() }];
    patch({ memos: next });
    // 追加したものはすぐ書けるように開いておく
    setOpenMemos((prev) => new Set(prev).add(`new:${next.length - 1}`));
  };
  const delMemo = (i: number) => patch({ memos: (edit?.memos ?? []).filter((_, idx) => idx !== i) });
  /**
   * 手動並び替え。保存時に sort_order = 配列の添字で書き戻されるため、
   * ここで入れ替えれば並びはそのまま残る（lib/members.ts saveMemberExtras）。
   */
  const moveMemo = (i: number, dir: -1 | 1) => {
    const list = [...(edit?.memos ?? [])];
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    patch({ memos: list });
  };
  /** 開閉キー。保存済みは id で追従させる（並び替えても開閉が入れ替わらない） */
  const memoKey = (mo: MemberMemo, i: number) => (mo.id != null ? `id:${mo.id}` : `new:${i}`);
  const toggleMemo = (k: string) =>
    setOpenMemos((prev) => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // ── この画面のURL（共有・貼り付け用）──
  const pageUrl = typeof window === "undefined" ? "" : `${window.location.origin}/ops/members/${memberId}`;
  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(pageUrl);
      setUrlCopied(true);
      window.setTimeout(() => setUrlCopied(false), 1600);
    } catch {
      toast.error("コピーできませんでした。URLを選択して手動でコピーしてください");
    }
  };

  // ── 保存 ──
  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error("氏名は必須です"); return; }
    if (edit.email.trim() && !isValidEmail(edit.email.trim())) { toast.error("メールアドレスの形式が正しくありません"); return; }
    if (!isValidPhone(edit.tel)) { toast.error("電話番号の形式が正しくありません（数字10〜15桁）"); return; }

    // ── ロック防止 ──────────────────────────────────────────
    //   自分自身のロール変更は UI で無効化しているが、DOM を書き換えれば
    //   送れてしまうためここでも弾く。
    if (isSelf && edit.role !== member?.role) {
      toast.error("自分自身のロールは変更できません");
      return;
    }
    //   最後の管理者を降格させると、権限マスタも設定画面も触れなくなる。
    //   復旧手段が SQL の直接実行しかないため、保存前に人数を確認する。
    if (member?.role === "管理者" && edit.role !== "管理者") {
      const { count, error: cntErr } = await supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("role", "管理者")
        .eq("is_deleted", false);
      if (cntErr) { toast.error("管理者の人数を確認できませんでした。時間をおいて再度お試しください"); return; }
      if ((count ?? 0) <= 1) {
        toast.error("最後の管理者のロールは変更できません。先に別のメンバーを管理者にしてください");
        return;
      }
    }

    // 昇格の判定は保存前に取る（保存後は member.role が更新されて promoting が false になる）
    const willPromote = promoting;
    const email = edit.email.trim();

    setSaving(true);
    const err = await saveMemberBasic(memberId, edit);
    if (err) { setSaving(false); toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    await saveMemberExtras(memberId, edit.attrIds, edit.memos);

    // ── 外部 → 本会員への昇格：パスワード設定メールを送る ──
    //   外部ロールは createUser({ email_confirm:true }) で作られており、
    //   「メールの所有者が本人か」を一度も確認していない。
    //   パスワード設定メールを踏ませることで、ここで初めて本人確認が成立する。
    //   ⚠️ inviteUserByEmail は使えない（auth.users に既にいるためエラーになる）。
    //      resetPasswordForEmail で /set-password に着地させる。
    let promoted = false;
    let mailFailed = false;
    if (willPromote && sendSetup && email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/set-password`,
      });
      if (error) { mailFailed = true; toast.error(`保存しましたが、パスワード設定メールの送信に失敗しました：${error.message}`); }
      else promoted = true;
    }

    setSaving(false);

    // メール送信に失敗した場合は、内容を確認できるよう画面を開いたままにする。
    if (mailFailed) { await load(); return; }

    toast.success(promoted
      ? "保存しました（パスワード設定メールを送信しました）"
      : "保存しました");
    // 保存完了 → 呼び出し元に一覧の読み直しを促す。そのうえで閉じるか確認する。
    notifyOpener("member-updated", memberId);
    if (await confirm({
      title: "保存しました",
      message: "ウィンドウを閉じますか？",
      confirmLabel: "閉じる", cancelLabel: "閉じない",
    })) {
      returnToOpener();
    }
  };

  const sendReset = async () => {
    const email = edit?.email.trim();
    if (!email) { setAcctMsg({ ok: false, text: "メールアドレスが未設定です" }); return; }
    try {
      const redirectTo = `${window.location.origin}/set-password`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw new Error(error.message);
      setAcctMsg({ ok: true, text: "パスワードリセットメールを送信しました" });
    } catch (e) {
      setAcctMsg({ ok: false, text: errMessage(e) });
    }
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-gray-400">読み込み中...</div>;
  if (notFound || !member || !edit) {
    return (
      <div className="min-h-screen grid place-items-center text-sm text-gray-500">
        メンバーが見つかりません（削除された可能性があります）。
      </div>
    );
  }

  const progress = memberProgress(member, pages, contents, index, viewIndex);
  const nState = notifyState(member);
  const initial = (member.name?.[0] ?? "?").toUpperCase();
  const roleCls = roleBadgeClass(member.role);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-6 pb-28">

        {/* ── ヘッダー ── */}
        <div className="flex items-center gap-3 flex-wrap mb-5">
          {/* ← ：ウィンドウを閉じて呼び出し元ウィンドウへ戻る */}
          <button onClick={() => returnToOpener()}
            className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="閉じて呼び出し元に戻る">←</button>
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 grid place-items-center font-extrabold text-lg shrink-0">{initial}</div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-gray-800 leading-tight">
              {member.name}
              {member.kana && <span className="text-xs text-gray-400 font-bold ml-2">{member.kana}</span>}
            </h1>
            <p className="text-[12px] text-gray-500 mt-0.5">
              ID: {member.id}　／　登録日時: {fmtDateTime(member.createdAt)}
            </p>
            {/* この顧客ページのURL。台帳や報告に貼るため、そのままコピーできるようにしておく */}
            <div className="flex items-center gap-1.5 mt-1">
              <code className="text-[11px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-2 py-1 truncate max-w-[420px]"
                    title={pageUrl}>{pageUrl}</code>
              <button type="button" onClick={copyUrl}
                className={`text-[11px] font-bold rounded-lg border px-2 py-1 whitespace-nowrap ${urlCopied ? "border-green-300 bg-green-50 text-green-700" : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50"}`}>
                {urlCopied ? "コピーしました" : "URLをコピー"}
              </button>
            </div>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${roleCls}`}>{member.role}</span>
          <div className="flex-1" />
          <button onClick={() => setConfirmDel(true)}
            className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">削除</button>
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>

        {/* タブバー */}
        <div className="flex gap-1 border-b border-gray-200 mb-4 overflow-x-auto">
          {MEMBER_TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 text-[12.5px] font-bold px-3.5 py-2.5 rounded-t-lg whitespace-nowrap ${tab === t.key ? "text-red-600 bg-white border border-gray-200 border-b-white -mb-px" : "text-gray-400 hover:text-gray-700"}`}>
              <Icon name={t.icon} size={14} />{t.label}
            </button>
          ))}
        </div>

        {/* ── サマリー ── */}
        {tab === "summary" && (
          <div className="space-y-4">
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))" }}>
              <div className={`${card} px-4 py-3`}><div className="text-[11px] text-gray-500 font-semibold">コンテンツ視聴</div><div className="text-xl font-extrabold text-gray-800 mt-0.5">{progress.viewed}/{progress.total}</div><div className="text-[10px] text-gray-400">{progress.pct}%</div></div>
              <div className={`${card} px-4 py-3`}><div className="text-[11px] text-gray-500 font-semibold">ログイン回数</div><div className="text-xl font-extrabold text-gray-800 mt-0.5">{member.loginCount ?? 0}</div><div className="text-[10px] text-gray-400">回</div></div>
              <div className={`${card} px-4 py-3`}><div className="text-[11px] text-gray-500 font-semibold">最終ログイン</div><div className="text-sm font-extrabold text-gray-800 mt-1.5">{member.lastLoginAt ? relDays(member.lastLoginAt) : "—"}</div></div>
              <div className={`${card} px-4 py-3`}><div className="text-[11px] text-gray-500 font-semibold">通知</div><div className="text-sm font-extrabold mt-1.5 text-gray-800">{nState === "registered" ? "登録済" : nState === "off" ? "OFF" : "未登録"}</div></div>
            </div>
            {/* 所属リスト（要件R9）。参照のみ＝会員マスタは書き換えない */}
            <MemberListsCard memberId={memberId} memberEmail={member.email ?? ""}
              onOpenList={(listId) => window.open(`/ops/lists/${listId}`, "_blank", "noopener")} />
            <MemberMergeHistoryCard memberId={memberId} />
          </div>
        )}

        {/* ── 基本情報（左：基本情報・アカウント・通知設定／右：属性ラベル・メモ）── */}
        {tab === "basic" && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(440px,1fr))" }}>
            <div className="space-y-4 min-w-0">
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">基本情報</div>
                          <div className="p-4 space-y-3">
                            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">氏名 <span className="text-red-500">*</span></label>
                                <input className={inputCls} maxLength={40} value={edit.name} onChange={(e) => patch({ name: e.target.value })} />
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">氏名カナ</label>
                                <input className={inputCls} value={edit.kana} onChange={(e) => patch({ kana: e.target.value })} placeholder="セイ メイ" />
                              </div>
                            </div>

                            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">
                                  メールアドレス <span className="text-gray-400 font-normal">アカウント紐づけ</span>
                                </label>
                                <div className="flex items-center gap-2">
                                  <input className={inputCls} type="email" value={edit.email} onChange={(e) => patch({ email: e.target.value })} />
                                  <button type="button"
                                    onClick={() => { const em = edit.email.trim(); if (em) openChildWindow(`/ops/mailbox?compose=${encodeURIComponent(em)}`, "mail-compose"); }}
                                    disabled={!edit.email.trim()}
                                    title={edit.email.trim() ? "この宛先で新規メールを作成（メール画面が開きます）" : "メールアドレス未登録"}
                                    className="shrink-0 inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-xs font-bold px-3 py-2 hover:bg-blue-100 disabled:opacity-50 disabled:cursor-not-allowed">
                                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="m22 6-10 7L2 6" /></svg>
                                    作成
                                  </button>
                                </div>
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">電話番号</label>
                                <input className={inputCls} type="tel" value={edit.tel} onChange={(e) => patch({ tel: e.target.value })} placeholder="090-0000-0000" />
                              </div>
                            </div>

                            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">権限</label>
                                <select className={`${inputCls} bg-white disabled:bg-gray-50 disabled:text-gray-400`}
                                  value={edit.role} disabled={isSelf}
                                  onChange={(e) => patch({ role: e.target.value })}>
                                  {((assignableRoles as string[]).includes(edit.role) ? (assignableRoles as string[]) : [edit.role, ...(assignableRoles as string[])])
                                    .map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                {isSelf && (
                                  <p className="text-[10.5px] text-gray-400 mt-1">
                                    自分自身のロールは変更できません（誤って権限を失うことを防ぐため）。
                                  </p>
                                )}

                                {/* 外部 → 本会員への昇格。外部ロールはパスワードを持たないため、
                                    昇格時に「パスワード設定メール」を送って本人確認を取り直す。 */}
                                {promoting && (
                                  <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2">
                                    <p className="text-[11px] font-bold text-amber-800">外部 → {edit.role} に昇格します</p>
                                    <p className="text-[10.5px] text-amber-700 mt-0.5 leading-relaxed">
                                      外部ロールはパスワードを持たず、メール確認も済んでいません（フォームに他人のメールを書いても登録できるため）。
                                      昇格時に本人確認を取り直してください。
                                    </p>
                                    <label className="flex items-start gap-1.5 mt-1.5 cursor-pointer">
                                      <input type="checkbox" className="mt-0.5 w-3.5 h-3.5 accent-amber-600"
                                        checked={sendSetup} onChange={(e) => setSendSetup(e.target.checked)}
                                        disabled={!edit.email.trim()} />
                                      <span className="text-[11px] text-amber-800">
                                        保存時にパスワード設定メールを送る
                                        {!edit.email.trim() && <b className="text-red-600">（メールアドレス未設定のため送れません）</b>}
                                      </span>
                                    </label>
                                  </div>
                                )}
                              </div>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">都道府県</label>
                                <select className={`${inputCls} bg-white`} value={edit.prefecture} onChange={(e) => patch({ prefecture: e.target.value })}>
                                  <option value="">（未選択）</option>
                                  {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                                </select>
                              </div>
                            </div>

                            <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">所属</label>
                                <input className={inputCls} value={edit.company} onChange={(e) => patch({ company: e.target.value })} />
                              </div>
                              {/* LINE連携（読み取り専用）。名寄せは「LINE ＞ 名寄せ」で行う。
                                  ⚠️ 旧「チャットワークID」欄はここにあったが、運用で使わなくなったため画面から外した。
                                     members.chat_id の値自体は保存時にそのまま持ち越す（消さない）。 */}
                              <div>
                                <label className="text-xs font-semibold text-gray-500 block mb-1">LINEアカウント名</label>
                                {lineLinks.length === 0 ? (
                                  <div className="border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-400 bg-gray-50">
                                    未連携
                                  </div>
                                ) : (
                                  <div className="space-y-1.5">
                                    {lineLinks.map((f) => (
                                      <div key={f.friendId} className="border border-gray-200 rounded-lg px-3 py-2 bg-white flex items-center gap-2 flex-wrap">
                                        <span className="text-sm font-semibold text-gray-800 truncate max-w-[160px]">
                                          {f.displayName || "（表示名なし）"}
                                        </span>
                                        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 whitespace-nowrap"
                                              title={`名寄せ：${f.identitySource || "不明"}${f.identityAt ? ` / ${fmtDateTime(f.identityAt)}` : ""}`}>
                                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                                          LINE照合済み
                                        </span>
                                        {f.status && f.status !== "friend" && (
                                          <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-amber-50 text-amber-700 border border-amber-200 whitespace-nowrap">
                                            {f.status === "blocked" ? "ブロック" : f.status}
                                          </span>
                                        )}
                                        <button type="button" onClick={() => openChildWindow(`/ops/line-customers/${f.friendId}`, `line-${f.friendId}`)}
                                          className="ml-auto text-[11px] font-bold text-blue-700 underline whitespace-nowrap">LINE顧客ページ</button>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">アカウント</div>
                          <div className="p-4 space-y-2">
                            <button onClick={sendReset}
                              className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50">
                              パスワード再設定メールを送る
                            </button>
                            {acctMsg && (
                              <p className={`text-xs px-3 py-2 rounded-lg ${acctMsg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                                {acctMsg.text}
                              </p>
                            )}
                            <p className="text-[11px] text-gray-400">
                              アカウント連携：{member.userId ? "済" : "未（メールを保存すると自動で紐づきます）"}
                            </p>
                          </div>
                        </div>
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm flex items-center gap-1.5"><Icon name="bell" size={14} />通知設定</span>
                            <span className="text-[11px] text-gray-400">閲覧専用</span>
                            <div className="flex-1" />
                            <span className="text-[10.5px] text-gray-500">
                              {nState === "registered" ? `登録済（${member.pushDevices ?? 0}台）`
                                : nState === "off" ? `通知OFF（${member.pushDevices ?? 0}台登録）` : "未登録"}
                            </span>
                          </div>
                          <div className="p-4">
                            {nState === "unregistered" ? (
                              <p className="text-xs text-gray-400">端末が登録されていません。本人が「通知設定」画面で登録すると届くようになります。</p>
                            ) : (
                              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                                <span>通知を受け取る：<b className={member.notifyEnabled === false ? "text-gray-400" : "text-emerald-600"}>{member.notifyEnabled === false ? "OFF" : "ON"}</b></span>
                                <span>トーク：<b className={member.notifyChatEnabled === false ? "text-gray-400" : "text-emerald-600"}>{member.notifyChatEnabled === false ? "OFF" : "ON"}</b></span>
                                <span>お知らせ：<b className={member.notifyNewsEnabled === false ? "text-gray-400" : "text-emerald-600"}>{member.notifyNewsEnabled === false ? "OFF" : "ON"}</b></span>
                              </div>
                            )}
                            <p className="text-[11px] text-gray-400 mt-2">端末の登録・解除は本人のみ操作できます。</p>
                          </div>
                        </div>
            </div>
            <div className="space-y-4 min-w-0">
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm">属性ラベル</span>
                            <span className="text-[11px] text-gray-400">A ＞ B ＞ C の階層を表で表示</span>
                          </div>
                          <div className="p-4">
                            <AttrTable tree={tree} index={index} value={edit.attrIds} onChange={(ids) => patch({ attrIds: ids })} />
                          </div>
                        </div>
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm">メモ</span>
                            <span className="text-[11px] text-gray-400">見出しをクリックで開閉／↑↓で並び替え</span>
                            <div className="flex-1" />
                            <button type="button"
                              onClick={() => setOpenMemos(new Set(edit.memos.map((m, i) => memoKey(m, i))))}
                              className="text-[11px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:bg-gray-50">すべて開く</button>
                            <button type="button" onClick={() => setOpenMemos(new Set())}
                              className="text-[11px] rounded-lg border border-gray-200 bg-white px-2 py-1 text-gray-600 hover:bg-gray-50">すべて閉じる</button>
                          </div>
                          <div className="p-4">
                            <div className="space-y-2.5">
                              {edit.memos.map((mo, i) => {
                                const isForm = mo.source?.kind === "form";
                                // 選択中タイトルが無効化済みでも一覧に残す（選択が消えないように）
                                const opts = activeMemoTitles(memoTitles);
                                const curName = memoTitleName(memoTitles, mo.titleId);
                                const label = curName || mo.title || "（タイトル未選択）";
                                const urls = extractUrls(mo.body);
                                const k = memoKey(mo, i);
                                const open = openMemos.has(k);
                                return (
                                <div key={k} className="border border-gray-200 rounded-xl overflow-hidden">
                                  {/* 見出し（クリックで開閉）。必要なメモだけ開いて読む */}
                                  <div onClick={() => toggleMemo(k)}
                                    className="flex items-center gap-2 px-3 py-2.5 bg-gray-50 flex-wrap cursor-pointer select-none">
                                    <span className={`text-gray-400 text-[10px] shrink-0 ${open ? "rotate-90" : ""}`} style={{ display: "inline-block", transition: "transform .12s" }}>▶</span>
                                    <b className="text-[13px] text-gray-800 truncate max-w-[220px]">{label}</b>
                                    {isForm ? (
                                      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap max-w-[200px] truncate"
                                        title={`登録元：${(mo.source as { formName: string }).formName || "フォーム"}`}>
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                                        {(mo.source as { formName: string }).formName || "フォーム"}
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                                        手動登録
                                      </span>
                                    )}
                                    {urls.length > 0 && (
                                      <span className="text-[10.5px] font-bold rounded-full px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-200 whitespace-nowrap">
                                        リンク {urls.length}
                                      </span>
                                    )}
                                    {!open && mo.body.trim() && (
                                      <span className="text-[11px] text-gray-400 truncate max-w-[200px]">{mo.body.replace(/\s+/g, " ").slice(0, 40)}</span>
                                    )}
                                    <span className="text-[10.5px] text-gray-400 whitespace-nowrap">更新：{fmtDateTime(mo.updatedAt)}</span>
                                    <div className="flex-1" />
                                    {/* 手動並び替え（保存すると sort_order に反映される） */}
                                    <button type="button" title="上へ" disabled={i === 0}
                                      onClick={(e) => { e.stopPropagation(); moveMemo(i, -1); }}
                                      className="w-7 h-7 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs disabled:opacity-30 hover:bg-gray-50">↑</button>
                                    <button type="button" title="下へ" disabled={i === edit.memos.length - 1}
                                      onClick={(e) => { e.stopPropagation(); moveMemo(i, 1); }}
                                      className="w-7 h-7 rounded-lg border border-gray-200 bg-white text-gray-500 text-xs disabled:opacity-30 hover:bg-gray-50">↓</button>
                                    <button type="button" className="text-red-500 text-xs whitespace-nowrap px-1"
                                      onClick={(e) => { e.stopPropagation(); delMemo(i); }}>削除</button>
                                  </div>

                                  {open && (
                                    <div className="p-3 border-t border-gray-200 space-y-2">
                                      <select
                                        className={`${inputCls} bg-white`}
                                        value={mo.titleId ?? ""}
                                        onChange={(e) => updateMemo(i, { titleId: e.target.value ? Number(e.target.value) : null })}>
                                        {/* 未選択の表示名：フォーム名/旧タイトルがあればそれを、無ければプレースホルダ */}
                                        <option value="">{mo.title ? mo.title : "（タイトルを選択）"}</option>
                                        {opts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                                        {/* 無効化済みだが現在選択中のタイトルは残す */}
                                        {mo.titleId != null && !opts.some((t) => t.id === mo.titleId) && curName && (
                                          <option value={mo.titleId}>{curName}（無効）</option>
                                        )}
                                      </select>
                                      <textarea className={`${inputCls} min-h-[72px] resize-y`} value={mo.body} placeholder="メモ本文"
                                        onChange={(e) => updateMemo(i, { body: e.target.value })} />
                                      {urls.length > 0 && (
                                        <div className="border border-indigo-100 bg-indigo-50/50 rounded-lg px-3 py-2">
                                          <div className="text-[11px] font-bold text-indigo-700 mb-1">本文中のリンク</div>
                                          <div className="flex flex-col gap-1">
                                            {urls.map((u, ui) => (
                                              <a key={ui} href={u} target="_blank" rel="noopener noreferrer"
                                                className="text-[11.5px] text-blue-700 underline break-all">{u}</a>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );})}
                            </div>
                            <button type="button" onClick={addMemo}
                              className="w-full mt-2 py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
                              ＋ メモ明細を追加
                            </button>
                            {memoTitles.length === 0 && (
                              <p className="text-[11px] text-gray-400 mt-1.5">タイトル候補は「設定 ＞ メモタイトル」で追加できます。</p>
                            )}
                          </div>
                        </div>
            </div>
          </div>
        )}

        {/* ── チャット履歴 ── */}
        {tab === "chat" && (
          <div className="space-y-4">
            <ChatSummaryCard conversationId={convId} />
          </div>
        )}

        {/* ── 決済・解約 ── */}
        {tab === "pay" && (
          <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(440px,1fr))" }}>
            <MemberPaymentsCard memberId={memberId} />
            <MemberRefundsCard memberId={memberId} />
          </div>
        )}

        {/* ── フォーム履歴 ── */}
        {tab === "form" && (
          <div className="space-y-4">
            <MemberFormsCard memberId={memberId} />
          </div>
        )}

        {/* ── コンテンツ ── */}
        {tab === "content" && (
          <div className="space-y-4">
                        <div className={card}>
                          <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                            <span className="font-bold text-sm flex items-center gap-1.5"><Icon name="chart" size={14} />利用状況</span>
                            <span className="text-[11px] text-gray-400">閲覧専用</span>
                          </div>
                          <div className="p-4">
                            <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600 mb-3">
                              <span>最終ログイン：<b className="text-gray-800">{fmtDateTime(member.lastLoginAt)}</b>
                                {member.lastLoginAt && <span className="text-gray-400 ml-1">（{relDays(member.lastLoginAt)}）</span>}</span>
                              <span>初回ログイン：<b className="text-gray-800">{fmtDateTime(member.firstLoginAt)}</b></span>
                              <span>ログイン回数：<b className="text-gray-800">{member.loginCount ?? 0}</b> 回</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 shrink-0">コンテンツ視聴</span>
                              <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
                                <div className="h-full bg-red-500 rounded-full" style={{ width: `${progress.pct}%` }} />
                              </div>
                              <span className="text-xs font-bold text-gray-700 shrink-0">
                                {progress.viewed}/{progress.total}（{progress.pct}%）
                              </span>
                            </div>
                          </div>
                        </div>
          </div>
        )}
      </div>

      {/* 保存バー（下部固定） */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <button onClick={() => setConfirmDel(true)}
            className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">削除</button>
          <div className="flex-1" />
          {/* 「閉じる」：入力中の内容を破棄してよいか確認してから閉じる */}
          <button onClick={async () => {
            if (await confirm({
              title: "確認",
              message: "入力中の内容を破棄してウィンドウを閉じますか？",
              confirmLabel: "破棄して閉じる", cancelLabel: "編集を続ける", danger: true,
            })) closeSelf();
          }}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50">閉じる</button>
          <button onClick={save} disabled={saving}
            className="px-6 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>

      {confirmDel && (
        <DeleteMemberDialog
          memberId={memberId}
          memberName={member.name}
          onCancel={() => setConfirmDel(false)}
          onError={(msg) => { setConfirmDel(false); toast.error(msg); }}
          onDone={async (mode) => {
            setConfirmDel(false);
            toast.success(mode === "purge"
              ? "完全に削除しました（復元できません）"
              : "利用停止しました（ログイン不可・再招待できます）");
            // 削除完了 → 呼び出し元に一覧の読み直しを促す。そのうえで閉じるか確認する。
            notifyOpener("member-deleted", memberId);
            if (await confirm({
              title: "削除しました",
              message: "ウィンドウを閉じますか？",
              confirmLabel: "閉じる", cancelLabel: "閉じない",
            })) {
              returnToOpener();
            }
          }}
        />
      )}
    </div>
  );
}
