"use client";
import { useState } from "react";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { attrSegs } from "../../lib/members";

interface Props {
  tree: AttrNode[];
  index: AttrIndex;
  value: number[];                       // 選択済みの末端ノードID配列
  onChange: (ids: number[]) => void;
  emptyLabel?: string;
}

const findNode = (list: AttrNode[], id: number) => list.find((n) => n.id === id);

// 属性A ＞ B ＞ C を段階選択し、末端ノードIDをタグとして追加する複数選択UI
export function AttrCascadePicker({ tree, index, value, onChange, emptyLabel = "未選択" }: Props) {
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
    if (deepestId == null) return;
    if (value.includes(deepestId)) return;
    onChange([...value, deepestId]);
    setA(""); setB(""); setC("");
  };
  const remove = (id: number) => onChange(value.filter((x) => x !== id));

  const opt = (list: AttrNode[]) =>
    [<option key="_" value="">（選択）</option>,
     ...list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)];

  return (
    <div className="border border-gray-200 rounded-xl p-3">
      <div className="grid gap-2 items-center" style={{ gridTemplateColumns: "1fr 1fr 1fr auto" }}>
        <select className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400"
          value={a} onChange={(e) => { setA(e.target.value); setB(""); setC(""); }}>{opt(tree)}</select>
        <select className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400 disabled:bg-gray-50"
          value={b} disabled={!a} onChange={(e) => { setB(e.target.value); setC(""); }}>{opt(bList)}</select>
        <select className="border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400 disabled:bg-gray-50"
          value={c} disabled={!b} onChange={(e) => setC(e.target.value)}>{opt(cList)}</select>
        <button type="button" onClick={add} disabled={deepestId == null}
          className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed">＋ 追加</button>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {value.length === 0 && <span className="text-[11.5px] text-gray-400">{emptyLabel}</span>}
        {value.map((id) => {
          const segs = attrSegs(index, id);
          return (
            <span key={id} className="inline-flex items-center gap-1.5 bg-white border border-gray-200 rounded-full px-2.5 py-1 text-[11.5px] text-gray-700">
              {segs.map((s, i) => (
                <span key={s.id} className="inline-flex items-center gap-1">
                  {i > 0 && <span className="text-gray-300">›</span>}
                  <span className="w-2 h-2 rounded-[2px] inline-block" style={{ background: s.color }} />
                  {s.name}
                </span>
              ))}
              <span className="cursor-pointer text-gray-400 hover:text-red-500 font-bold" onClick={() => remove(id)}>×</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
