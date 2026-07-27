"use client";
// LINE友だちの顧客情報モーダル（ポータルトークの顧客情報に相当）。
//   LINEプロフィール／連携状態／フォーム収集情報／連携会員の基本情報 を1枚で確認する。
import type { LineFriend, Member } from "../../lib/models";
import { FriendAvatar } from "./FriendAvatar";

export interface LineCustomerInfoModalProps {
  friend: LineFriend;
  member: Member | null;
  onClose: () => void;
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="grid grid-cols-[92px_1fr] gap-x-3 gap-y-0.5 py-1 text-[12.5px]">
      <span className="text-gray-500">{k}</span>
      <span className="font-medium break-words">{v || "—"}</span>
    </div>
  );
}

const fmtDate = (iso: string) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "");

export function LineCustomerInfoModal({ friend, member, onClose }: LineCustomerInfoModalProps) {
  const name = friend.displayName || "(名称未取得)";
  const statusLabel = friend.status === "friend" ? "友だち" : "ブロック/解除";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-[440px] shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-200 flex items-center gap-3">
          <FriendAvatar name={name} pictureUrl={friend.pictureUrl} seed={friend.lineUserId} size={40} />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <b className="text-[15px] truncate">{name}</b>
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500 text-white">LINE</span>
            </div>
            <div className="text-[11px] text-gray-500">
              {friend.memberId != null ? `会員 #${friend.memberId} に連携済み` : "未連携"}
            </div>
          </div>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
        </div>

        <div className="px-5 py-3 max-h-[70vh] overflow-auto">
          <div className="text-[10.5px] font-bold text-gray-400 mb-1">LINE情報</div>
          <Row k="表示名" v={name} />
          <Row k="userID" v={friend.lineUserId ? `${friend.lineUserId.slice(0, 8)}…` : ""} />
          <Row k="友だち追加" v={fmtDate(friend.followedAt)} />
          <Row k="ステータス" v={statusLabel} />

          <div className="text-[10.5px] font-bold text-gray-400 mt-3 mb-1 pt-3 border-t border-gray-100">フォーム収集情報</div>
          {(friend.collectedName || friend.collectedEmail || friend.collectedPhone) ? (
            <>
              <Row k="氏名" v={friend.collectedName} />
              <Row k="メール" v={friend.collectedEmail} />
              <Row k="電話" v={friend.collectedPhone} />
            </>
          ) : (
            <div className="text-[12px] text-gray-400 py-1">未収集（連携フォーム未回答）</div>
          )}

          <div className="text-[10.5px] font-bold text-gray-400 mt-3 mb-1 pt-3 border-t border-gray-100">連携会員</div>
          {member ? (
            <>
              <Row k="氏名" v={member.name} />
              {member.kana ? <Row k="フリガナ" v={member.kana} /> : null}
              <Row k="メール" v={member.email} />
              <Row k="電話" v={member.tel ?? ""} />
              <Row k="会社" v={member.company} />
              <Row k="属性" v={`${member.attrIds?.length ?? 0} 件`} />
            </>
          ) : (
            <div className="text-[12px] text-gray-400 py-1">未連携です。名寄せ画面で会員と紐づけできます。</div>
          )}
        </div>
      </div>
    </div>
  );
}
