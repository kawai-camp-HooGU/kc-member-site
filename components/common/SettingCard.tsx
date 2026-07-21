"use client";
// ============================================================
// 設定カード（見出し帯つき）
//   一覧の見出し（.tbl-head）・回答画面の設問帯と同じチャコールを使い、
//   「帯＝ここからこのまとまり」というルールを管理画面で1本に揃える。
//
//   BEFORE：白いカードの中に太字の見出し文字を置くだけ。見出しと項目名の
//           濃さが1段階しか違わず、どこからどこまでが1グループか分からない。
//   AFTER ：帯で区切る。番号バッジで縦に長い画面でも現在地が分かる。
//
//   ⚠️ 帯は sticky にできる（sticky）。縦に長いタブでスクロールしても
//      「何の設定をしているか」が画面に残る。
// ============================================================
import type { ReactNode } from "react";
import { CARD_HEAD } from "../../lib/constants";

interface Props {
  /** 見出し */
  title: string;
  /** 左の番号バッジ（省略可） */
  no?: number;
  /** 見出しの下に出す補足（省略可） */
  desc?: string;
  /** 見出し帯の右側（トグル・状態チップなど） */
  right?: ReactNode;
  /** 目次からの遷移先・現在地判定に使う id */
  id?: string;
  /** 帯をスクロール追従させる */
  sticky?: boolean;
  /** 本文の追加クラス（既定は p-4 space-y-4） */
  bodyClass?: string;
  children: ReactNode;
}

export function SettingCard({
  title, no, desc, right, id, sticky = false, bodyClass = "p-4 space-y-4", children,
}: Props) {
  return (
    <section id={id} className="bg-white rounded-xl border border-gray-200 overflow-hidden scroll-mt-4">
      <div className={`${CARD_HEAD} ${sticky ? "sticky top-0 z-10" : ""}`}>
        {no != null && (
          <span className="w-4 h-4 rounded bg-white/15 text-white text-[9px] font-extrabold grid place-items-center shrink-0">
            {no}
          </span>
        )}
        <span className="text-[12.5px] font-bold text-white tracking-wide">{title}</span>
        {desc && <span className="text-[10.5px] text-white/50 truncate">{desc}</span>}
        <span className="flex-1" />
        {right}
      </div>
      <div className={bodyClass}>{children}</div>
    </section>
  );
}
