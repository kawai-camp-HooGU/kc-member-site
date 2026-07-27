"use client";
// LINE公式アカウントのブランド帯（案B）。関連画面の外枠ヘッダーとして共用する。
//   ・LINEグリーンの帯に、公式アカウントのアイコン画像＋名前＋LINEマークを白抜きで表示。
//   ・複数アカウント接続時はプルダウンで参照中アカウントを切替。
import type { ReactNode } from "react";
import type { LineAccount } from "../../lib/models";

export interface LineAccountBarProps {
  /** 画面名（例：LINEトーク／友だち一覧／名寄せ）。右側に薄く表示。 */
  screenLabel?: string;
  accounts: LineAccount[];
  accountId: number | null;
  onSelectAccount?: (id: number) => void;
  /** 右側に出す任意の操作（ボタン等）。 */
  right?: ReactNode;
}

export function LineAccountBar({ screenLabel, accounts, accountId, onSelectAccount, right }: LineAccountBarProps) {
  const acc = accounts.find((a) => a.id === accountId) ?? accounts[0] ?? null;
  const name = acc?.name || acc?.channelId || "（LINEアカウント未接続）";

  return (
    <div
      className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0"
      style={{ background: "linear-gradient(90deg,#06c755,#0bbf5b)" }}
    >
      {/* アイコン画像（無ければ頭文字） */}
      <span className="w-9 h-9 rounded-full bg-white grid place-items-center overflow-hidden flex-shrink-0">
        {acc?.pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={acc.pictureUrl} alt="" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
        ) : (
          <span className="text-[#06c755] font-extrabold text-sm">{(name || "L").charAt(0)}</span>
        )}
      </span>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <b className="text-white text-[15px] truncate max-w-[280px]">{name}</b>
          <span className="text-[10px] font-extrabold text-[#06c755] bg-white rounded-full px-2 py-0.5 flex-shrink-0">LINE</span>
        </div>
        <div className="text-[11px] text-white/85 truncate">
          {acc?.basicId ? `${acc.basicId}` : ""}{screenLabel ? `${acc?.basicId ? " ／ " : ""}${screenLabel}` : ""}
        </div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {right}
        {accounts.length > 1 && onSelectAccount && (
          <select
            value={accountId ?? ""}
            onChange={(e) => onSelectAccount(Number(e.target.value))}
            className="text-[12px] font-bold text-white bg-white/20 border border-white/30 rounded-lg px-2 py-1 max-w-[170px]"
            title="参照中の公式アカウントを切り替え"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id} className="text-gray-800">{a.name || a.channelId}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
