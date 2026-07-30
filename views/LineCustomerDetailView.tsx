"use client";
// ============================================================
// LINE顧客 詳細画面（/ops/line-customers/[friendId]）
//
//   会員詳細（/ops/members/[id]）と UI を共有する「1画面」。モーダルは廃止。
//   会員側の「顧客情報」ボタンと同じく、LINEトークの「顧客情報」から別ウィンドウで開く。
//
//   ・連携済みの友だち … 会員が正本。会員詳細（/ops/members/[id]）へ誘導する。
//   ・未連携の友だち   … ここで 基本情報 / 属性ABC / メモ を編集・保存する。
//       共通項目 … line_friends.collected_*
//       属性/メモ … member_attributes / member_memos（friend_id・会員と同じマスタ）
//
//   ⚠️ app.tsx を経由しないため、必要なデータは lib/lineCustomer.ts で単体取得する。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadAttributeTree } from "../lib/attributes";
import type { AttrNode } from "../lib/attributes";
import { buildAttrIndex } from "../lib/members";
import type { AttrIndex } from "../lib/members";
import type { MemberMemo, MemoTitle } from "../lib/models";
import { fetchMemoTitles, activeMemoTitles, memoTitleName } from "../lib/memoTitles";
import { fmtDateTime } from "../lib/engagement";
import {
  fetchLineCustomerDetail, saveLineCustomerProfile, saveLineCustomerExtras,
} from "../lib/lineCustomer";
import { AttrTable } from "../components/master/AttrTable";
import { FriendAvatar } from "../components/line/FriendAvatar";
import { useToast } from "../components/common/ToastProvider";
import { closeSelf, returnToOpener, openChildWindow } from "../lib/childWindow";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400";
const card = "bg-white border border-gray-200 rounded-xl";
const nowStr = () => new Date().toISOString().slice(0, 16).replace("T", " ");

interface Edit { name: string; kana: string; email: string; phone: string; attrIds: number[]; memos: MemberMemo[] }

export function LineCustomerDetailView({ friendId }: { friendId: number }) {
  const toast = useToast();

  const [displayName, setDisplayName] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [status, setStatus] = useState("");
  const [memberId, setMemberId] = useState<number | null>(null);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [memoTitles, setMemoTitles] = useState<MemoTitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [saving, setSaving] = useState(false);

  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  const load = useCallback(async () => {
    const [d, t, mt] = await Promise.all([
      fetchLineCustomerDetail(friendId), loadAttributeTree(), fetchMemoTitles(),
    ]);
    setTree(t); setMemoTitles(mt);
    if (!d) { setNotFound(true); setLoading(false); return; }
    setDisplayName(d.profile.displayName);
    setLineUserId(d.profile.lineUserId);
    setStatus(d.profile.status);
    setMemberId(d.profile.memberId);
    setEdit({
      name: d.profile.name, kana: d.profile.kana, email: d.profile.email, phone: d.profile.phone,
      attrIds: [...d.attrIds], memos: d.memos.map((m) => ({ ...m })),
    });
    setLoading(false);
  }, [friendId]);

  useEffect(() => { load().catch(() => { setNotFound(true); setLoading(false); }); }, [load]);

  const patch = (p: Partial<Edit>) => setEdit((e) => (e ? { ...e, ...p } : e));
  const updateMemo = (i: number, p: Partial<MemberMemo>) =>
    patch({ memos: (edit?.memos ?? []).map((m, idx) => (idx === i ? { ...m, ...p, updatedAt: nowStr() } : m)) });
  const addMemo = () => patch({ memos: [...(edit?.memos ?? []), { titleId: null, body: "", source: { kind: "manual" }, updatedAt: nowStr() }] });
  const delMemo = (i: number) => patch({ memos: (edit?.memos ?? []).filter((_, idx) => idx !== i) });

  const save = async () => {
    if (!edit) return;
    setSaving(true);
    const err = await saveLineCustomerProfile(friendId, { name: edit.name, kana: edit.kana, email: edit.email, phone: edit.phone });
    if (err) { setSaving(false); toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    await saveLineCustomerExtras(friendId, edit.attrIds, edit.memos);
    setSaving(false);
    toast.success("保存しました");
    setTimeout(() => returnToOpener("/ops"), 600);
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-gray-400">読み込み中...</div>;
  if (notFound || !edit) {
    return <div className="min-h-screen grid place-items-center text-sm text-gray-500">LINE顧客が見つかりません。</div>;
  }

  const statusLabel = status === "friend" ? "友だち" : status === "blocked" ? "ブロック" : status || "—";

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6 pb-28">

        {/* ── ヘッダー ── */}
        <div className="flex items-center gap-3 flex-wrap mb-5">
          <button onClick={() => returnToOpener("/ops")}
            className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="閉じて呼び出し元に戻る">←</button>
          <FriendAvatar name={displayName || "?"} pictureUrl="" seed={lineUserId} size={48} />
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold text-gray-800 leading-tight flex items-center gap-2">
              {displayName || "(名称未取得)"}
              <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
            </h1>
            <p className="text-[12px] text-gray-500 mt-0.5">{memberId != null ? `会員 #${memberId} に連携済み` : "未連携"}</p>
          </div>
          <div className="flex-1" />
          <button onClick={save} disabled={saving}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>

        {/* 連携済みは会員側が正本 */}
        {memberId != null && (
          <div className="mb-4 text-[12.5px] bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-3 flex items-center gap-2 flex-wrap">
            この顧客は会員 #{memberId} に連携済みです。プロフィールは<b>会員側が正本</b>です。属性・メモも会員詳細で管理してください。
            <button onClick={() => openChildWindow(`/ops/members/${memberId}`, `member-${memberId}`)}
              className="ml-auto font-bold underline whitespace-nowrap">会員詳細を開く</button>
          </div>
        )}

        <div className="space-y-4">

          {/* LINE情報（読み取り専用） */}
          <div className={card}>
            <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">LINE情報</div>
            <div className="p-4">
              <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1.5 text-[13px]">
                <span className="text-gray-500">表示名</span><span className="font-medium">{displayName || "—"}</span>
                <span className="text-gray-500">userID</span><span className="font-medium break-all">{lineUserId ? `${lineUserId.slice(0, 12)}…` : "—"}</span>
                <span className="text-gray-500">ステータス</span><span className="font-medium">{statusLabel}</span>
              </div>
            </div>
          </div>

          {/* 基本情報（会員詳細と同じ体裁） */}
          <div className={card}>
            <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">基本情報</div>
            <div className="p-4 space-y-3">
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">氏名</label>
                  <input className={inputCls} maxLength={40} value={edit.name} onChange={(e) => patch({ name: e.target.value })} placeholder="氏名" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">フリガナ</label>
                  <input className={inputCls} value={edit.kana} onChange={(e) => patch({ kana: e.target.value })} placeholder="セイ メイ" />
                </div>
              </div>
              <div className="grid gap-3" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">メールアドレス <span className="text-gray-400 font-normal">名寄せに使用</span></label>
                  <input className={inputCls} type="email" value={edit.email} onChange={(e) => patch({ email: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-500 block mb-1">電話番号</label>
                  <input className={inputCls} type="tel" value={edit.phone} onChange={(e) => patch({ phone: e.target.value })} placeholder="090-0000-0000" />
                </div>
              </div>
              <p className="text-[11px] text-gray-400">氏名・フリガナ・メール・電話は名寄せ（会員照合）に使われます。会員と一致すると連携できます。</p>
            </div>
          </div>

          {/* 属性ABC（会員と同じ AttrTable） */}
          <div className={card}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2 flex-wrap">
              <span className="font-bold text-sm">属性ABC</span>
              <span className="text-[11px] text-gray-400">A ＞ B ＞ C の階層を表で表示</span>
            </div>
            <div className="p-4">
              <AttrTable tree={tree} index={index} value={edit.attrIds} onChange={(ids) => patch({ attrIds: ids })} />
            </div>
          </div>

          {/* メモ（会員と同じ体裁） */}
          <div className={card}>
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <span className="font-bold text-sm">メモ</span>
              <span className="text-[11px] text-gray-400">タイトル（マスタ選択）・登録元・本文・更新日時</span>
            </div>
            <div className="p-4">
              <div className="space-y-2.5">
                {edit.memos.map((mo, i) => {
                  const isForm = mo.source?.kind === "form";
                  const opts = activeMemoTitles(memoTitles);
                  const curName = memoTitleName(memoTitles, mo.titleId);
                  return (
                    <div key={i} className="border border-gray-200 rounded-xl p-3">
                      <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                        <select className={`${inputCls} bg-white flex-1 min-w-[180px]`} value={mo.titleId ?? ""}
                          onChange={(e) => updateMemo(i, { titleId: e.target.value ? Number(e.target.value) : null })}>
                          <option value="">{mo.title ? mo.title : "（タイトルを選択）"}</option>
                          {opts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                          {mo.titleId != null && !opts.some((t) => t.id === mo.titleId) && curName && (
                            <option value={mo.titleId}>{curName}（無効）</option>
                          )}
                        </select>
                        {isForm ? (
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap max-w-[220px] truncate"
                            title={`登録元：${(mo.source as { formName: string }).formName || "フォーム"}`}>
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                            {(mo.source as { formName: string }).formName || "フォーム"}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-full px-2 py-1 bg-slate-100 text-slate-600 border border-slate-300 whitespace-nowrap">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                            手動登録
                          </span>
                        )}
                        <span className="text-[10.5px] text-gray-400 whitespace-nowrap">更新：{fmtDateTime(mo.updatedAt)}</span>
                        <button type="button" className="text-red-500 text-xs whitespace-nowrap" onClick={() => delMemo(i)}>削除</button>
                      </div>
                      <textarea className={`${inputCls} min-h-[52px] resize-y`} value={mo.body} placeholder="メモ本文"
                        onChange={(e) => updateMemo(i, { body: e.target.value })} />
                    </div>
                  );
                })}
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

      {/* 保存バー（下部固定） */}
      <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          <div className="flex-1" />
          <button onClick={() => closeSelf("/ops")}
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50">閉じる</button>
          <button onClick={save} disabled={saving}
            className="px-6 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
