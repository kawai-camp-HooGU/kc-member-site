"use client";
// ============================================================
// LINE顧客 詳細（会員と同じ編集UIで管理）
//   会員未連携のLINE友だちでも、氏名・フリガナ・メール・電話＋属性ABC＋メモを
//   会員と同じ部品（MemberExtraFields）で編集・保存する。
//     ・共通項目 … line_friends.collected_*
//     ・属性/メモ … member_attributes / member_memos（friend_id 紐づけ）
//   連携済みの場合は会員側が正本のため、会員詳細（別ウィンドウ）への導線を出す。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { LineFriend, MemberMemo, MemoTitle } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { AttrIndex } from "../../lib/members";
import { fetchMemoTitles } from "../../lib/memoTitles";
import {
  fetchLineCustomerDetail, saveLineCustomerProfile, saveLineCustomerExtras,
} from "../../lib/lineCustomer";
import { MemberExtraFields } from "../master/MemberExtraFields";
import { FriendAvatar } from "./FriendAvatar";
import { useToast } from "../common/ToastProvider";
import { openChildWindow } from "../../lib/childWindow";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-emerald-400";

export interface LineCustomerDetailModalProps {
  friend: LineFriend;
  onClose: () => void;
  onSaved?: () => void;
}

export function LineCustomerDetailModal({ friend, onClose, onSaved }: LineCustomerDetailModalProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  const [name, setName]   = useState("");
  const [kana, setKana]   = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [attrIds, setAttrIds] = useState<number[]>([]);
  const [memos, setMemos]     = useState<MemberMemo[]>([]);
  const [memberId, setMemberId] = useState<number | null>(friend.memberId ?? null);

  const [tree, setTree]           = useState<AttrNode[]>([]);
  const [memoTitles, setMemoTitles] = useState<MemoTitle[]>([]);
  const index: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);

  const displayName = friend.displayName || "(名称未取得)";
  const statusLabel = friend.status === "friend" ? "友だち" : "ブロック/解除";

  useEffect(() => {
    (async () => {
      const [d, t, mt] = await Promise.all([
        fetchLineCustomerDetail(friend.id), loadAttributeTree(), fetchMemoTitles(),
      ]);
      setTree(t); setMemoTitles(mt);
      if (d) {
        setName(d.profile.name); setKana(d.profile.kana);
        setEmail(d.profile.email); setPhone(d.profile.phone);
        setAttrIds(d.attrIds); setMemos(d.memos);
        setMemberId(d.profile.memberId);
      }
      setLoading(false);
    })().catch(() => setLoading(false));
  }, [friend.id]);

  const save = async () => {
    setSaving(true);
    const err = await saveLineCustomerProfile(friend.id, { name, kana, email, phone });
    if (err) { setSaving(false); toast.error("保存に失敗しました"); return; }
    await saveLineCustomerExtras(friend.id, attrIds, memos);
    setSaving(false);
    toast.success("保存しました");
    onSaved?.();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[560px] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* ヘッダ */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
          <FriendAvatar name={displayName} pictureUrl={friend.pictureUrl} seed={friend.lineUserId} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <b className="text-[15px] truncate">{displayName}</b>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
            </div>
            <div className="text-[11px] text-gray-500">{memberId != null ? `会員 #${memberId} に連携済み` : "未連携"}</div>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        {loading ? (
          <div className="px-5 py-10 text-center text-sm text-gray-400">読み込み中…</div>
        ) : (
          <>
            <div className="px-5 py-4 overflow-auto space-y-4">
              {/* 連携済みは会員が正本。会員詳細へ誘導。 */}
              {memberId != null && (
                <div className="text-[12px] bg-blue-50 border border-blue-200 text-blue-800 rounded-lg px-3 py-2 flex items-center gap-2">
                  この顧客は会員 #{memberId} に連携済みです。プロフィールは会員側が正本です。
                  <button onClick={() => openChildWindow(`/ops/members/${memberId}`, `member-${memberId}`)}
                    className="ml-auto font-bold underline whitespace-nowrap">会員詳細を開く</button>
                </div>
              )}

              {/* LINE情報（読み取り専用）*/}
              <div>
                <div className="text-[10.5px] font-bold text-gray-400 mb-1">LINE情報</div>
                <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-1 text-[12.5px]">
                  <span className="text-gray-500">表示名</span><span className="font-medium">{displayName}</span>
                  <span className="text-gray-500">userID</span><span className="font-medium break-all">{friend.lineUserId ? `${friend.lineUserId.slice(0, 10)}…` : "—"}</span>
                  <span className="text-gray-500">ステータス</span><span className="font-medium">{statusLabel}</span>
                </div>
              </div>

              {/* 共通項目（編集可・line_friends に保存）*/}
              <div>
                <div className="text-[10.5px] font-bold text-gray-400 mb-1.5 pt-3 border-t border-gray-100">基本情報</div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">氏名</label>
                    <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="氏名" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">フリガナ</label>
                    <input className={inputCls} value={kana} onChange={(e) => setKana(e.target.value)} placeholder="フリガナ" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">メール</label>
                    <input className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="メール" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-500 block mb-1">電話</label>
                    <input className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="電話" />
                  </div>
                </div>
              </div>

              {/* 属性ABC ＋ メモ（会員と同じ部品。都道府県は隠す）*/}
              <div className="space-y-4 pt-3 border-t border-gray-100">
                <MemberExtraFields
                  tree={tree} index={index}
                  prefecture="" onPref={() => {}}
                  attrIds={attrIds} onAttrIds={setAttrIds}
                  memos={memos} onMemos={setMemos}
                  memoTitles={memoTitles}
                  hidePrefecture
                />
              </div>
            </div>

            <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-end gap-2">
              <button onClick={onClose} className="text-sm font-bold border border-gray-300 rounded-lg px-4 py-2 text-gray-600 hover:bg-gray-50">閉じる</button>
              <button onClick={save} disabled={saving}
                className="text-sm font-bold bg-emerald-600 text-white rounded-lg px-5 py-2 hover:bg-emerald-700 disabled:opacity-50">
                {saving ? "保存中…" : "保存"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
