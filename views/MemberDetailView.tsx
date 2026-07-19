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
import { DeleteMemberDialog } from "../components/master/DeleteMemberDialog";
import { fetchContentData } from "../lib/contents";
import {
  fetchContentViews, buildViewIndex, memberProgress, relDays, fmtDateTime,
} from "../lib/engagement";
import type { ContentViewRow } from "../lib/engagement";
import type { Member, MemberMemo, ContentPage, CmsContent } from "../lib/models";
import { allRoles, isStaffRole, roleBadgeClass, loadRoles } from "../lib/roles";
import { isValidEmail, isValidPhone } from "../lib/validators";
import { errMessage } from "../lib/errors";
import { AttrTable } from "../components/master/AttrTable";
import { ChatSummaryCard } from "../components/master/ChatSummaryCard";
import { MemberFormsCard } from "../components/master/MemberFormsCard";
import { MemberPaymentsCard } from "../components/master/MemberPaymentsCard";
import { useToast } from "../components/common/ToastProvider";
import { Icon } from "../components/common/Icon";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const card = "bg-white border border-gray-200 rounded-xl";
const nowStr = () => new Date().toISOString().slice(0, 16).replace("T", " ");

interface Edit {
  name: string; kana: string; email: string; tel: string;
  role: string; company: string; chatId: string; prefecture: string;
  attrIds: number[]; memos: MemberMemo[];
}

export function MemberDetailView({ memberId }: { memberId: number }) {
  const toast = useToast();

  const [member, setMember]   = useState<Member | null>(null);
  const [convId, setConvId]   = useState<number | null>(null);
  const [edit, setEdit]       = useState<Edit | null>(null);
  const [tree, setTree]       = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [acctMsg, setAcctMsg] = useState<{ ok: boolean; text: string } | null>(null);

  /** ログイン中の運営ロール（付与できるロールの絞り込みに使う） */
  const [myRole, setMyRole] = useState<string>("");

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

  useEffect(() => {
    supabase.rpc("current_member_role").then(({ data }) => setMyRole((data as string | null) ?? ""));
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
  const promoting = member?.role === "外部" && edit != null && edit.role !== "外部";
  /** 昇格時にパスワード設定メールを送るか（既定ON） */
  const [sendSetup, setSendSetup] = useState(true);

  const patch = (p: Partial<Edit>) => setEdit((e) => (e ? { ...e, ...p } : e));

  // ── メモ ──
  const updateMemo = (i: number, p: Partial<MemberMemo>) =>
    patch({ memos: (edit?.memos ?? []).map((m, idx) => (idx === i ? { ...m, ...p, updatedAt: nowStr() } : m)) });
  const addMemo = () => patch({ memos: [...(edit?.memos ?? []), { title: "", body: "", updatedAt: nowStr() }] });
  const delMemo = (i: number) => patch({ memos: (edit?.memos ?? []).filter((_, idx) => idx !== i) });

  // ── 保存 ──
  const save = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error("氏名は必須です"); return; }
    if (edit.email.trim() && !isValidEmail(edit.email.trim())) { toast.error("メールアドレスの形式が正しくありません"); return; }
    if (!isValidPhone(edit.tel)) { toast.error("電話番号の形式が正しくありません（数字10〜15桁）"); return; }

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
    if (willPromote && sendSetup && email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/set-password`,
      });
      if (error) toast.error(`保存しましたが、パスワード設定メールの送信に失敗しました：${error.message}`);
      else promoted = true;
    }

    setSaving(false);
    await load();
    toast.success(promoted
      ? "保存しました（パスワード設定メールを送信しました）"
      : "保存しました");
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
          <button onClick={() => { if (window.opener) window.close(); else window.history.back(); }}
            className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="閉じる">←</button>
          <div className="w-12 h-12 rounded-full bg-red-100 text-red-700 grid place-items-center font-extrabold text-lg shrink-0">{initial}</div>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-gray-800 leading-tight">
              {member.name}
              {member.kana && <span className="text-xs text-gray-400 font-bold ml-2">{member.kana}</span>}
            </h1>
            <p className="text-[12px] text-gray-500 mt-0.5">
              ID: {member.id}　／　登録日時: {fmtDateTime(member.createdAt)}
            </p>
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

        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(440px,1fr))" }}>

          {/* ═══ 左カラム ═══ */}
          <div className="space-y-4 min-w-0">

            {/* 基本情報 */}
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
                    <input className={inputCls} type="email" value={edit.email} onChange={(e) => patch({ email: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">電話番号</label>
                    <input className={inputCls} type="tel" value={edit.tel} onChange={(e) => patch({ tel: e.target.value })} placeholder="090-0000-0000" />
                  </div>
                </div>

                <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">権限</label>
                    <select className={`${inputCls} bg-white`} value={edit.role} onChange={(e) => patch({ role: e.target.value })}>
                      {((assignableRoles as string[]).includes(edit.role) ? (assignableRoles as string[]) : [edit.role, ...(assignableRoles as string[])])
                        .map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>

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
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">チャットワークID</label>
                    <input className={inputCls} value={edit.chatId} onChange={(e) => patch({ chatId: e.target.value })} />
                  </div>
                </div>
              </div>
            </div>

            {/* 属性ABC（表表示） */}
            <div className={card}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
                <span className="font-bold text-sm">属性ABC</span>
                <span className="text-[11px] text-gray-400">A ＞ B ＞ C の階層を表で表示</span>
              </div>
              <div className="p-4">
                <AttrTable tree={tree} index={index} value={edit.attrIds} onChange={(ids) => patch({ attrIds: ids })} />
              </div>
            </div>

            {/* メモ */}
            <div className={card}>
              <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
                <span className="font-bold text-sm">メモ</span>
                <span className="text-[11px] text-gray-400">タイトル・本文・更新日時</span>
              </div>
              <div className="p-4">
                <div className="space-y-2.5">
                  {edit.memos.map((mo, i) => (
                    <div key={i} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <input className={`${inputCls} flex-1`} value={mo.title} placeholder="タイトル"
                          onChange={(e) => updateMemo(i, { title: e.target.value })} />
                        <span className="text-[10.5px] text-gray-400 whitespace-nowrap">更新：{fmtDateTime(mo.updatedAt)}</span>
                        <button type="button" className="text-red-500 text-xs whitespace-nowrap" onClick={() => delMemo(i)}>削除</button>
                      </div>
                      <textarea className={`${inputCls} min-h-[52px] resize-y`} value={mo.body} placeholder="メモ本文"
                        onChange={(e) => updateMemo(i, { body: e.target.value })} />
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addMemo}
                  className="w-full mt-2 py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
                  ＋ メモ明細を追加
                </button>
              </div>
            </div>

          </div>

          {/* ═══ 右カラム ═══ */}
          <div className="space-y-4 min-w-0">

            {/* 過去のチャット要約 */}
            <ChatSummaryCard conversationId={convId} />

            {/* フォーム回答状況 */}
            <MemberFormsCard memberId={memberId} />

            {/* 決済履歴 */}
            <MemberPaymentsCard memberId={memberId} />

            {/* 利用状況（閲覧専用） */}
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

            {/* 通知設定（閲覧専用） */}
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

            {/* アカウント */}
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

          </div>
        </div>
      </div>

      {/* 保存バー（下部固定） */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-2">
          <button onClick={() => setConfirmDel(true)}
            className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">削除</button>
          <div className="flex-1" />
          <button onClick={() => { if (window.opener) window.close(); else window.history.back(); }}
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
          onDone={(mode) => {
            setConfirmDel(false);
            toast.success(mode === "purge"
              ? "完全に削除しました（復元できません）"
              : "利用停止しました（ログイン不可・再招待できます）");
            // 別ウィンドウで開かれている想定：閉じる。単独タブなら運営トップへ。
            setTimeout(() => { if (window.opener) window.close(); else window.location.href = "/ops"; }, 600);
          }}
        />
      )}
    </div>
  );
}
