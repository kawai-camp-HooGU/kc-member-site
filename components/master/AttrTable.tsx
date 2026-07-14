"use client";
// ============================================================
// 属性ABC：表表示（メンバー詳細画面）
//
//   BEFORE：チップ（丸いタグ）を横に並べる形。
//           「会員区分 › 有料会員 › フロント」のように可変幅で並ぶため、
//           行ごとに区切り記号の位置がバラバラで、階層が読み取りにくかった。
//
//   AFTER ：A / ＞ / B / ＞ / C の6列テーブル。
//           <colgroup> で列幅を固定するので **「＞」が必ず縦に揃う**。
//           C が無い属性（例：会員区分 ＞ 無料）は C 列が空になるだけで、
//           ＞ の位置はずれない。
//
//   追加は従来どおりカスケード選択（A→B→C）。
// ============================================================
import { useState } from "react";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { attrSegs } from "../../lib/members";

interface Props {
  tree: AttrNode[];
  index: AttrIndex;
  /** 選択済みの末端ノードID配列 */
  value: number[];
  onChange: (ids: number[]) => void;
  /** 閲覧専用（追加・削除ボタンを出さない） */
  readOnly?: boolean;
  /**
   * 追加ボタンの文言。
   *   「付与する属性」「解除する属性」のように、文脈で意味が変わる場所があるため差し替え可能にする。
   */
  addLabel?: string;
}

const findNode = (list: AttrNode[], id: number) => list.find((n) => n.id === id);
const selCls = "border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400 disabled:bg-gray-50";

/** 1セル分の表示（色チップ ＋ 名前） */
function Seg({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700">
      <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: color }} />
      {name}
    </span>
  );
}

export function AttrTable({
  tree, index, value, onChange, readOnly = false, addLabel = "＋ 属性を追加",
}: Props) {
  const [open, setOpen] = useState(false);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");

  const aNode = a ? findNode(tree, +a) : null;
  const bList = aNode ? aNode.children : [];
  const bNode = b ? findNode(bList, +b) : null;
  const cList = bNode ? bNode.children : [];

  // 追加する末端ノードID＝選択された最も深いノード
  const deepestId = c ? +c : b ? +b : a ? +a : null;

  const add = () => {
    if (deepestId == null || value.includes(deepestId)) return;
    onChange([...value, deepestId]);
    setA(""); setB(""); setC(""); setOpen(false);
  };
  const remove = (id: number) => onChange(value.filter((x) => x !== id));

  const opt = (list: AttrNode[]) => [
    <option key="_" value="">（選択）</option>,
    ...list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>),
  ];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        {/* ★ 列幅を固定することで「＞」が縦に揃う */}
        <colgroup>
          <col style={{ width: "30%" }} />
          <col style={{ width: 26 }} />
          <col style={{ width: "28%" }} />
          <col style={{ width: 26 }} />
          <col />
          <col style={{ width: 44 }} />
        </colgroup>
        <thead>
          <tr className="tbl-head text-[11px] text-left">
            <th className="px-3 py-2 border-b border-gray-200">属性A</th>
            <th className="border-b border-gray-200" />
            <th className="px-3 py-2 border-b border-gray-200">属性B</th>
            <th className="border-b border-gray-200" />
            <th className="px-3 py-2 border-b border-gray-200">属性C</th>
            <th className="border-b border-gray-200" />
          </tr>
        </thead>
        <tbody>
          {value.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-[12.5px] text-gray-400">
                属性は付与されていません
              </td>
            </tr>
          )}
          {value.map((id) => {
            const segs = attrSegs(index, id);
            const [sa, sb, sc] = [segs[0], segs[1], segs[2]];
            return (
              <tr key={id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
                <td className="px-3 py-2.5">{sa ? <Seg name={sa.name} color={sa.color} /> : <span className="text-gray-300">—</span>}</td>
                <td className={`text-center font-bold ${sb ? "text-gray-300" : "text-gray-200"}`}>＞</td>
                <td className="px-3 py-2.5">{sb ? <Seg name={sb.name} color={sb.color} /> : <span className="text-gray-300">—</span>}</td>
                <td className={`text-center font-bold ${sc ? "text-gray-300" : "text-gray-200"}`}>＞</td>
                <td className="px-3 py-2.5">{sc ? <Seg name={sc.name} color={sc.color} /> : <span className="text-gray-300">—</span>}</td>
                <td className="px-2 py-2.5 text-center">
                  {!readOnly && (
                    <button type="button" onClick={() => remove(id)} title="この属性を外す"
                      className="text-gray-400 hover:text-red-500 text-xs font-bold">✕</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {!readOnly && (
        <div className="border-t border-gray-100 bg-gray-50/60 p-2.5">
          {open ? (
            <div>
              {/* 「何をしている欄なのか」を明示する。セレクトが3つ並ぶだけだと用途が読めない。 */}
              <p className="text-[11px] font-bold text-gray-500 mb-1.5">
                属性を選んで <span className="text-gray-700">追加</span>（大分類 ＞ 中分類 ＞ 小分類）
              </p>
              <div className="grid gap-2 items-center" style={{ gridTemplateColumns: "1fr 1fr 1fr auto auto" }}>
                <select className={selCls} value={a} onChange={(e) => { setA(e.target.value); setB(""); setC(""); }}>{opt(tree)}</select>
                <select className={selCls} value={b} disabled={!a} onChange={(e) => { setB(e.target.value); setC(""); }}>{opt(bList)}</select>
                <select className={selCls} value={c} disabled={!b} onChange={(e) => setC(e.target.value)}>{opt(cList)}</select>
                <button type="button" onClick={add} disabled={deepestId == null}
                  className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">
                  ＋ 追加
                </button>
                <button type="button" onClick={() => { setOpen(false); setA(""); setB(""); setC(""); }}
                  className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700">キャンセル</button>
              </div>
              <p className="text-[10.5px] text-gray-400 mt-1.5">
                途中まで（大分類だけ・中分類まで）の選択でも追加できます。
              </p>
            </div>
          ) : (
            <button type="button" onClick={() => setOpen(true)}
              className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-xs font-semibold hover:bg-white hover:text-gray-700">
              {addLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
