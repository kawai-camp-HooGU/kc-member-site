"use client";
// ============================================================
// 顧客情報詳細：所属リスト（要件R9・確定事項 No.11=a／サマリータブに1枚）
//
//   ⚠️ 「会員IDで一致」と「メールで名寄せ」を区別して見せる。
//      名寄せは推定なので、根拠が見えないと運用側が信用できない。
//   ⚠️ ここは参照のみ。リストの値で会員マスタを補完しない（No.12=a）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { Icon } from "../common/Icon";
import { fmtJst } from "../../lib/dateFmt";
import { fetchMemberLists } from "../../lib/contactLists";
import type { MemberListMembership } from "../../lib/contactLists";

export interface MemberListsCardProps {
  memberId: number;
  memberEmail: string;
  /** リスト管理画面を開く（あれば「開く」ボタンを出す） */
  onOpenList?: (listId: number) => void;
}

export function MemberListsCard({ memberId, memberEmail, onOpenList }: MemberListsCardProps) {
  const [rows, setRows] = useState<MemberListMembership[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setRows(await fetchMemberLists(memberId, memberEmail));
    setLoading(false);
  }, [memberId, memberEmail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-[#3f3f46] text-white">
        <Icon name="layers" size={14} />
        <span className="text-[12.5px] font-bold">所属リスト</span>
        <span className="ml-auto text-[10.5px] text-gray-300">{rows.length} 件</span>
      </div>

      {loading ? (
        <p className="px-4 py-6 text-center text-[11.5px] text-gray-400">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-[11.5px] text-gray-400">
          どのリストにも登録されていません。
        </p>
      ) : (
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="tbl-head">
              {["リスト名", "このリストでの登録日時", "紐づけ", ""].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((r) => (
              <tr key={r.entryId} className={`hover:bg-gray-50/60 ${r.isArchived ? "opacity-60" : ""}`}>
                <td className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <b className="text-gray-800">{r.listName}</b>
                    {r.isArchived && (
                      <span className="text-[9px] font-bold rounded-full px-1.5 py-0.5 bg-gray-400 text-white">
                        アーカイブ
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-2.5 py-1.5 font-mono text-[10.5px] text-gray-500 whitespace-nowrap">
                  {fmtJst(r.createdAt)}
                </td>
                <td className="px-2.5 py-1.5">
                  {r.matchedBy === "member_id" ? (
                    <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 border bg-emerald-50 text-emerald-700 border-emerald-300 whitespace-nowrap"
                      title="このレコードは会員IDで紐づいています（確実）">
                      会員IDで一致
                    </span>
                  ) : (
                    <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 border bg-blue-50 text-blue-700 border-blue-200 whitespace-nowrap"
                      title="メールアドレスが一致したため同一人物と推定しています">
                      メールで名寄せ
                    </span>
                  )}
                </td>
                <td className="px-2.5 py-1.5">
                  {onOpenList ? (
                    <button onClick={() => onOpenList(r.listId)}
                      className="text-[10.5px] font-bold px-2 py-1 rounded-md border border-gray-200 text-gray-600
                        hover:bg-gray-50 flex items-center gap-1 whitespace-nowrap">
                      <Icon name="external" size={12} />開く
                    </button>
                  ) : <span className="text-gray-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
