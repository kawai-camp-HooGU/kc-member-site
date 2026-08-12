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
import {
  createAttribute, loadAttributeTree, childColorOf, nextRootColor,
  DEFAULT_LEVEL_NAMES, MAX_LEVEL,
} from "../../lib/attributes";
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
  /**
   * その場で新しい属性を作成できるようにするか（付与欄で使う）。
   *   true のとき「＋ 新しい属性を作成」を出す。作成には onTreeChange が必要。
   */
  allowCreate?: boolean;
  /** 属性ツリーが変わったとき（新規作成時）に親へ通知。親は index を作り直す。 */
  onTreeChange?: (tree: AttrNode[]) => void;
  /** 階層レベル名（大分類/中分類/小分類）。作成UIのラベルに使う。 */
  levels?: string[];
}

const findNode = (list: AttrNode[], id: number) => list.find((n) => n.id === id);
/** ツリー全体から id でノードを探す（階層を問わず） */
function findDeep(list: AttrNode[], id: number): AttrNode | null {
  for (const n of list) {
    if (n.id === id) return n;
    const hit = findDeep(n.children, id);
    if (hit) return hit;
  }
  return null;
}
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
  allowCreate = false, onTreeChange, levels = DEFAULT_LEVEL_NAMES,
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

  // ── その場で新しい属性を作成 ──────────────────────────────
  const canCreate = allowCreate && !!onTreeChange;
  const [newOpen, setNewOpen] = useState(false);
  const [nLevel, setNLevel] = useState(0);           // 0=A 1=B 2=C
  const [nParent, setNParent] = useState("");        // 親ノードID（level 0 は不要）
  const [nName, setNName] = useState("");
  const [busy, setBusy] = useState(false);

  // 作成する階層の親候補（level 1 → 大分類、level 2 → 中分類を「A ＞ B」で列挙）
  const parentOptions: { id: number; label: string; color: string }[] =
    nLevel === 1
      ? tree.map((r) => ({ id: r.id, label: r.name || "（無名）", color: r.color }))
      : nLevel === 2
        ? tree.flatMap((r) => r.children.map((m) => ({
            id: m.id, label: `${r.name || "（無名）"} ＞ ${m.name || "（無名）"}`, color: m.color,
          })))
        : [];

  const resetNew = () => { setNewOpen(false); setNLevel(0); setNParent(""); setNName(""); };

  const create = async () => {
    const name = nName.trim();
    if (!name || busy) return;
    if (nLevel > 0 && !nParent) return;
    const parent = nLevel > 0 ? findDeep(tree, +nParent) : null;
    const color = parent ? childColorOf(parent.color, nLevel) : nextRootColor(tree.map((r) => r.color));
    const sortOrder = parent ? parent.children.length : tree.length;

    setBusy(true);
    const created = await createAttribute({
      level: nLevel, parentId: parent ? parent.id : null, name, sortOrder, color,
    });
    if (!created) { setBusy(false); return; }
    // 属性マスタの最新ツリーを取り直して親へ渡す（index が作り直され、チップが正しく表示される）
    const fresh = await loadAttributeTree();
    onTreeChange?.(fresh);
    onChange([...value, created.id]);   // 作成した属性をこのアクションに付与
    setBusy(false);
    resetNew();
  };

  const opt = (list: AttrNode[]) => [
    <option key="_" value="">（選択）</option>,
    ...list.map((n) => <option key={n.id} value={n.id}>{n.name}</option>),
  ];

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
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

              {/* ── その場で新しい属性を作成 ── */}
              {canCreate && (
                <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200">
                  {!newOpen ? (
                    <button type="button" onClick={() => setNewOpen(true)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold text-emerald-700 hover:text-emerald-800">
                      ＋ 新しい属性を作成（その場で）
                    </button>
                  ) : (
                    <div className="border border-emerald-200 bg-emerald-50/70 rounded-xl p-3">
                      <p className="text-[11px] font-bold text-emerald-700 mb-2">✨ 新しい属性を作成 — 保存と同時に属性マスタへ登録されます</p>
                      <div className="flex flex-wrap gap-2 items-center mb-2">
                        <select className={selCls} value={nLevel}
                          onChange={(e) => { setNLevel(+e.target.value); setNParent(""); }}>
                          {Array.from({ length: MAX_LEVEL + 1 }, (_, i) => (
                            <option key={i} value={i}>属性{["A", "B", "C"][i]}（{levels[i]}）</option>
                          ))}
                        </select>
                        {nLevel > 0 && (
                          <select className={`${selCls} flex-1 min-w-[160px]`} value={nParent}
                            onChange={(e) => setNParent(e.target.value)}>
                            <option value="">親を選択…</option>
                            {parentOptions.map((p) => <option key={p.id} value={p.id}>親：{p.label}</option>)}
                          </select>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        <input className={`${selCls} flex-1 min-w-[140px] bg-white`}
                          value={nName} onChange={(e) => setNName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") create(); }}
                          placeholder={`新しい${levels[nLevel]}名（例：AI活用）`} autoFocus />
                        <button type="button" onClick={create}
                          disabled={busy || !nName.trim() || (nLevel > 0 && !nParent)}
                          className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold whitespace-nowrap hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed">
                          {busy ? "作成中…" : "作成して付与"}
                        </button>
                        <button type="button" onClick={resetNew}
                          className="px-2 py-2 text-xs text-gray-500 hover:text-gray-700">キャンセル</button>
                      </div>
                      <p className="text-[10.5px] text-emerald-700 mt-2">色は親から自動で継承します。作成後すぐこのアクションに付与されます。</p>
                    </div>
                  )}
                </div>
              )}
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
