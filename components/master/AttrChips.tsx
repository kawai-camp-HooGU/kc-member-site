"use client";
// ============================================================
// 属性の表示（読み取り専用）— アプリ共通
//
//   BEFORE：画面ごとにバラバラだった。
//     ・コンテンツ設定 / お知らせ … 各ファイルに TargetTags を別々に定義（末端色の淡いピル）
//     ・イベント                   … 赤で固定のピル（属性色を無視）
//     ・一斉配信 / シナリオ        … attrLabel を " / " で join しただけの文字列
//     ・メンバー一覧               … 色ドット付きピル
//
//   AFTER ：ここに一本化する。表示仕様は「顧客詳細画面（AttrTable）」に合わせ、
//           色チップ（属性色）＋ フルパス（A › B › C）を出す。
//           ⚠️ 色は 属性C ＞ 属性B ＞ 属性A の優先順位で、**マスタで実際に設定された色**を使う
//              （lib/members.ts の attrColor）。末端の色だけを見ると、色未設定の末端が
//              グレーになって親で設定した系統色が消えてしまうため。
//
//   編集が必要な場所は AttrTable（表＋カスケード追加）を使うこと。
// ============================================================
import { attrColor, attrLabel } from "../../lib/members";
import type { AttrIndex } from "../../lib/members";
import { ATTR_MODE_LABEL } from "../../lib/members";
import type { PublishMode } from "../../lib/models";

interface Props {
  index: AttrIndex;
  ids: number[];
  /** 公開条件（any/all/exany/exall）。渡すと「（いずれか）」のように前置きする */
  mode?: PublishMode;
  /** 属性が空のときの表示（例：「全員」「—」） */
  emptyLabel?: string;
  /** 小さめ（一覧の行内など） */
  size?: "sm" | "md";
}

export function AttrChips({ index, ids, mode, emptyLabel = "—", size = "sm" }: Props) {
  if (!ids?.length) return <span className="text-gray-400">{emptyLabel}</span>;

  const text = size === "sm" ? "text-[10.5px]" : "text-[11.5px]";
  const dot  = size === "sm" ? "w-[7px] h-[7px]" : "w-2 h-2";

  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {mode && <span className={`${text} text-gray-400`}>（{ATTR_MODE_LABEL[mode]}）</span>}
      {ids.map((id) => {
        // 色は 属性C ＞ 属性B ＞ 属性A の優先順位で、マスタに設定のあるものを使う
        const color = attrColor(index, id);
        return (
          <span key={id}
            className={`inline-flex items-center gap-1 ${text} px-2 py-0.5 rounded-full border whitespace-nowrap`}
            style={{ borderColor: `${color}55`, color, background: `${color}0f` }}>
            <span className={`${dot} rounded-[2px] shrink-0`} style={{ background: color }} />
            {attrLabel(index, id)}
          </span>
        );
      })}
    </span>
  );
}
