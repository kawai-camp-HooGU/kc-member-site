"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import {
  loadLevelNames, saveLevelName, loadAttributeTree,
  createAttribute, updateAttribute, deleteAttributes, saveOrder,
  collectIds, countNodes, DEFAULT_LEVEL_NAMES, LEVEL_KEYS, MAX_LEVEL,
} from "../../lib/attributes";
import type { AttrNode, AttrPatch } from "../../lib/attributes";

// 属性A/B/C のバッジ色（Tailwindのリテラルクラスで固定）
const LV_BADGE = ["bg-red-600", "bg-amber-600", "bg-teal-600"];
const LV_DEPTH = ["第1階層（親）", "第2階層", "第3階層（末端）"];

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return `rgba(107,114,128,${a})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export function AttributeTab() {
  const [, force] = useReducer((x) => x + 1, 0);
  const treeRef = useRef<AttrNode[]>([]);
  const [levels, setLevels] = useState<string[]>(DEFAULT_LEVEL_NAMES);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1600);
  };

  useEffect(() => {
    (async () => {
      const [names, tree] = await Promise.all([loadLevelNames(), loadAttributeTree()]);
      setLevels(names);
      treeRef.current = tree;
      setLoading(false);
      force();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 操作 ──────────────────────────────────────────────
  const patch = (node: AttrNode, p: AttrPatch) => {
    Object.assign(node, p);
    force();
    updateAttribute(node.id, p);
  };

  const move = (siblings: AttrNode[], idx: number, dir: number) => {
    const to = idx + dir;
    if (to < 0 || to >= siblings.length) return;
    [siblings[idx], siblings[to]] = [siblings[to], siblings[idx]];
    force();
    saveOrder(siblings.map((n, i) => ({ id: n.id, sortOrder: i })));
  };

  const del = (siblings: AttrNode[], idx: number) => {
    const node = siblings[idx];
    const n = node.children.length;
    if (!window.confirm(`「${node.name || "（無名）"}」${n ? `と配下 ${countNodes(node.children)} 件` : ""}を削除します。よろしいですか？`)) return;
    const ids = collectIds(node);
    siblings.splice(idx, 1);
    force();
    deleteAttributes(ids);
    showToast("削除しました");
  };

  const addChild = async (parent: AttrNode) => {
    const lvl = parent.level + 1;
    const created = await createAttribute({
      level: lvl, parentId: parent.id,
      name: `新しい${levels[lvl]}`, sortOrder: parent.children.length,
    });
    if (!created) { showToast("追加に失敗しました"); return; }
    parent.children.push(created);
    parent.open = true;
    force();
    showToast(`${levels[lvl]}を追加しました`);
  };

  const addRoot = async () => {
    const created = await createAttribute({
      level: 0, parentId: null,
      name: `新しい${levels[0]}`, sortOrder: treeRef.current.length,
    });
    if (!created) { showToast("追加に失敗しました"); return; }
    treeRef.current.push(created);
    force();
    showToast(`${levels[0]}を追加しました`);
  };

  const renameLevel = (level: number, name: string) => {
    setLevels((prev) => { const next = [...prev]; next[level] = name; return next; });
    saveLevelName(level, name);
    showToast("レベル名を変更しました");
  };

  // ── プレビュー ────────────────────────────────────────
  const Preview = ({ node }: { node: AttrNode }) => {
    const style: React.CSSProperties = {
      background: node.bg ? hexToRgba(node.color, 0.1) : "transparent",
      borderColor: node.bg ? hexToRgba(node.color, 0.35) : "#e5e7eb",
      borderStyle: node.bg ? "solid" : "dashed",
    };
    return (
      <div className="mt-2.5 px-3 py-2 border rounded-lg" style={style}>
        <div className="text-[10px] mb-1" style={{ color: node.bg ? hexToRgba(node.color, 0.7) : "#9ca3af" }}>一覧での見え方プレビュー</div>
        <span style={{ color: node.titleColor ? node.color : "#1f2937", fontWeight: node.bold ? 800 : 500 }}>
          {node.name || "（名称）"}
        </span>
      </div>
    );
  };

  // ── ノード（再帰描画）─────────────────────────────────
  const renderNode = (node: AttrNode, level: number, siblings: AttrNode[], idx: number): React.ReactNode => {
    const hasChildLevel = level < MAX_LEVEL;
    return (
      <div key={node.id} className="mb-2">
        <div className={`bg-white border border-gray-200 rounded-xl px-3 py-2.5 ${node.visible ? "" : "opacity-50"}`}
          style={{ borderLeft: `4px solid ${node.color}` }}>
          {/* 上段 */}
          <div className="flex items-center gap-2">
            <button onClick={() => { node.open = !node.open; force(); }}
              className={`w-6 h-7 text-gray-400 text-xs shrink-0 ${node.children.length ? "" : "invisible"}`}
              title="開閉">{node.open ? "▼" : "▶"}</button>

            <div className="flex flex-col gap-0.5 shrink-0">
              <button onClick={() => move(siblings, idx, -1)} disabled={idx === 0}
                className="w-7 h-5 border border-gray-200 rounded-md text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed" title="上へ">▲</button>
              <button onClick={() => move(siblings, idx, 1)} disabled={idx === siblings.length - 1}
                className="w-7 h-5 border border-gray-200 rounded-md text-gray-500 text-[10px] leading-none hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed" title="下へ">▼</button>
            </div>

            <input type="color" value={node.color}
              onChange={(e) => patch(node, { color: e.target.value.toUpperCase() })}
              className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer shrink-0 p-0" title="表示色" />

            <input value={node.name}
              onChange={(e) => { node.name = e.target.value; force(); }}
              onBlur={(e) => updateAttribute(node.id, { name: e.target.value })}
              className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2.5 py-2 text-sm font-bold text-gray-800 focus:outline-none focus:border-red-400" />

            <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full shrink-0 ${LV_BADGE[level]}`}>属性{LEVEL_KEYS[level]}</span>
            {node.children.length > 0 && <span className="text-[11px] text-gray-400 shrink-0">{node.children.length}</span>}

            <button onClick={() => { node.detail = !node.detail; force(); }}
              className={`w-8 h-8 rounded-lg border border-gray-200 text-sm shrink-0 flex items-center justify-center hover:bg-gray-50 ${node.detail ? "bg-gray-100 text-gray-700" : "text-gray-500"}`}
              title="色・表示仕様">⚙</button>
            <button onClick={() => patch(node, { visible: !node.visible })}
              className={`w-8 h-8 rounded-lg border border-gray-200 text-sm shrink-0 flex items-center justify-center hover:bg-gray-50 ${node.visible ? "text-green-600" : "text-gray-400"}`}
              title={node.visible ? "表示中（クリックで非表示）" : "非表示（クリックで表示）"}>{node.visible ? "👁" : "🚫"}</button>
            <button onClick={() => del(siblings, idx)}
              className="w-8 h-8 rounded-lg border border-gray-200 text-sm shrink-0 flex items-center justify-center text-red-500 hover:bg-red-50" title="削除">🗑</button>
          </div>

          {/* 詳細 */}
          {node.detail && (
            <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-700">表示色</span>
                <span className="text-xs text-gray-400 font-mono">{node.color.toUpperCase()}</span>
                <span className="w-3" />
                <button onClick={() => patch(node, { bg: !node.bg })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.bg ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>🎨 背景色</button>
                <button onClick={() => patch(node, { bold: !node.bold })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.bold ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>𝐁 太字</button>
                <button onClick={() => patch(node, { titleColor: !node.titleColor })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.titleColor ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>🏷 タイトル色</button>
              </div>
              <Preview node={node} />
            </div>
          )}
        </div>

        {/* 子コンテナ */}
        {hasChildLevel && node.open && (
          <div className="mt-2 ml-5 pl-3.5 border-l-2 border-dashed border-gray-200">
            {node.children.map((ch, ci) => renderNode(ch, level + 1, node.children, ci))}
            <button onClick={() => addChild(node)}
              className="inline-flex items-center gap-1 mt-1 px-3 py-1.5 rounded-lg border border-dashed border-gray-300 bg-white text-gray-500 text-xs font-semibold hover:bg-gray-50 hover:text-gray-700">
              ＋ {levels[level + 1]}を追加
            </button>
          </div>
        )}
      </div>
    );
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">読み込み中…</p>;

  const roots = treeRef.current;
  const rootVisible = roots.filter((n) => n.visible).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        属性A ＞ 属性B ＞ 属性C の親子階層（カスケード）を設定します。上位で選んだ値に応じて下位の選択肢が絞り込まれます。
      </p>

      {/* 階層レベル名 */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-1.5 text-xs font-bold text-gray-500 mb-3">
          <span className="inline-block w-[3px] h-3.5 rounded-sm bg-yellow-500" />階層レベルの名前
        </div>
        <div className="space-y-2.5">
          {levels.map((nm, i) => (
            <div key={i} className="grid items-center gap-2.5" style={{ gridTemplateColumns: "auto 1fr auto" }}>
              <span className={`text-[11px] font-bold text-white px-2.5 py-1 rounded-full whitespace-nowrap ${LV_BADGE[i]}`}>属性{LEVEL_KEYS[i]}</span>
              <input defaultValue={nm}
                onBlur={(e) => { if (e.target.value !== nm) renameLevel(i, e.target.value); }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold bg-gray-50 focus:outline-none focus:border-red-400 focus:bg-white" />
              <span className="text-[11px] text-gray-400 whitespace-nowrap">{LV_DEPTH[i]}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-2.5">各レベルの名前は自由に変更できます（例：大分類 ＞ 中分類 ＞ 小分類）。</p>
      </div>

      {/* 追加バー */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-400">
          {levels[0]} {roots.length} 件（表示 {rootVisible} ／ 非表示 {roots.length - rootVisible}）・全 {countNodes(roots)} ノード
        </span>
        <button onClick={addRoot} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700">＋ {levels[0]}を追加</button>
      </div>

      {/* ツリー */}
      <div>
        {roots.length === 0 && <p className="text-center text-gray-300 py-8 text-sm">属性がまだありません。「＋ {levels[0]}を追加」から作成してください。</p>}
        {roots.map((n, i) => renderNode(n, 0, roots, i))}
      </div>

      <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 pt-3">
        ▶ で子（下位属性）を開閉。<b className="text-gray-600">＋ 子を追加</b>で階層を作成（属性A→属性B→属性C、属性Cが末端）。
        各ノードは <b className="text-gray-600">▲▼</b> で同階層の並び替え、<b className="text-gray-600">⚙</b> で色・表示仕様、<b className="text-gray-600">👁</b> で表示/非表示、<b className="text-gray-600">🗑</b> で削除（配下ごと）。
      </p>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
