"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  loadLevelNames, saveLevelName, loadAttributeTree,
  createAttribute, updateAttribute, deleteAttributes, saveOrder,
  collectIds, countNodes, loadAttrMemberLinks, buildAttrMemberMap,
  DEFAULT_LEVEL_NAMES, LEVEL_KEYS, MAX_LEVEL,
} from "../../lib/attributes";
import type { AttrNode, AttrPatch, AttrMemberLink } from "../../lib/attributes";
import { supabase, toMember } from "../../lib/supabase";
import type { Member } from "../../lib/models";
import { Icon } from "../common/Icon";
import { useConfirm } from "../common/ConfirmProvider";

// 属性A/B/C のバッジ色（Tailwindのリテラルクラスで固定）
const LV_BADGE = ["bg-red-600", "bg-amber-600", "bg-teal-600"];
const LV_DEPTH = ["第1階層（親）", "第2階層", "第3階層（末端）"];

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  if (h.length < 6) return `rgba(107,114,128,${a})`;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

// ── 一覧（表）ビュー用の行 ────────────────────────────────
//   ツリーをフラット化し、各ノードを「A ＞ B ＞ C」のパスとして持つ。
interface FlatRow {
  node: AttrNode;
  level: number;
  /** ルート→自身のパス（最大3段。無い階層は undefined） */
  segs: AttrNode[];
}
function flatten(nodes: AttrNode[], path: AttrNode[] = []): FlatRow[] {
  const out: FlatRow[] = [];
  for (const n of nodes) {
    const segs = [...path, n];
    out.push({ node: n, level: n.level, segs });
    out.push(...flatten(n.children, segs));
  }
  return out;
}

type ViewMode = "table" | "tree";
type VisFilter = "all" | "on" | "off";

/** 検索語をハイライト（部分一致・大文字小文字を無視） */
function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>;
  const i = text.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-yellow-200 rounded-[3px] px-0.5">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function AttributeTab() {
  const confirm = useConfirm();
  const [, force] = useReducer((x) => x + 1, 0);
  const treeRef = useRef<AttrNode[]>([]);
  const [levels, setLevels] = useState<string[]>(DEFAULT_LEVEL_NAMES);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string>("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 一覧（表）ビュー ──
  const [view, setView] = useState<ViewMode>("table");
  const [q, setQ]       = useState("");
  const [lvFilter, setLvFilter]   = useState<"" | "0" | "1" | "2">("");
  const [visFilter, setVisFilter] = useState<VisFilter>("all");

  // 付与会員（属性ID → 会員IDの集合）。祖先にも子孫の会員を積み上げ済み。
  const [links, setLinks]     = useState<AttrMemberLink[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  /** 対象者一覧モーダル（クリックされた属性ノード） */
  const [audience, setAudience] = useState<AttrNode | null>(null);

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

  // 付与会員の集計（属性の編集では変わらないので初回のみ）
  useEffect(() => {
    (async () => {
      try {
        const [ls, { data: rows }] = await Promise.all([
          loadAttrMemberLinks(),
          supabase.from("members_visible").select("*").eq("is_deleted", false).order("name"),
        ]);
        setLinks(ls);
        setMembers((rows ?? []).map(toMember));
      } catch { /* 集計できなくても画面は使える */ }
    })();
  }, []);

  const memberMap = useMemo(
    () => buildAttrMemberMap(treeRef.current, links),
    // treeRef は force() で再描画されるだけなので、links/loading を依存にする
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [links, loading],
  );
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

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

  const del = async (siblings: AttrNode[], idx: number) => {
    const node = siblings[idx];
    const n = node.children.length;
    if (!(await confirm({ title: "属性を削除", message: `「${node.name || "（無名）"}」${n ? `と配下 ${countNodes(node.children)} 件` : ""}を削除します。よろしいですか？`, confirmLabel: "削除する", danger: true }))) return;
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
    // 追加した子自身も開いておく（そうしないと、その子に孫を追加できない）
    created.open = true;
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
    // 開いた状態で追加する（閉じたままだと「＋ 子を追加」が出ず、子を作れない）
    created.open = true;
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
            {/* 開閉：子を持てる階層なら、子が0件でも押せる（子の追加ボタンを出すため） */}
            <button onClick={() => { node.open = !node.open; force(); }}
              className={`w-6 h-7 text-gray-400 text-xs shrink-0 hover:text-gray-600 ${hasChildLevel ? "" : "invisible"}`}
              title={hasChildLevel ? (node.open ? "閉じる" : "開く（下位属性を追加）") : ""}>
              {node.open ? "▼" : "▶"}
            </button>

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
              title="色・表示仕様"><Icon name="palette" size={16} /></button>
            <button onClick={() => patch(node, { visible: !node.visible })}
              className={`w-8 h-8 rounded-lg border border-gray-200 text-sm shrink-0 flex items-center justify-center hover:bg-gray-50 ${node.visible ? "text-green-600" : "text-gray-400"}`}
              title={node.visible ? "表示中（クリックで非表示）" : "非表示（クリックで表示）"}><Icon name={node.visible ? "eye" : "eyeOff"} size={16} /></button>
            <button onClick={() => del(siblings, idx)}
              className="w-8 h-8 rounded-lg border border-gray-200 text-sm shrink-0 flex items-center justify-center text-red-500 hover:bg-red-50" title="削除"><Icon name="trash" size={16} /></button>
          </div>

          {/* 詳細 */}
          {node.detail && (
            <div className="mt-2.5 pt-2.5 border-t border-dashed border-gray-200">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[13px] font-semibold text-gray-700">表示色</span>
                <span className="text-xs text-gray-400 font-mono">{node.color.toUpperCase()}</span>
                <span className="w-3" />
                <button onClick={() => patch(node, { bg: !node.bg })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.bg ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}><Icon name="palette" size={14} /> 背景色</button>
                <button onClick={() => patch(node, { bold: !node.bold })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.bold ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>𝐁 太字</button>
                <button onClick={() => patch(node, { titleColor: !node.titleColor })}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${node.titleColor ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}><Icon name="tag" size={14} /> タイトル色</button>
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

  // ── 一覧（表）ビューの行を組み立て ──
  const allRows = flatten(roots);
  const kw = q.trim().toLowerCase();
  const rows = allRows.filter((r) => {
    // ★ キーワードは属性A/B/C を横断検索（どの階層に含まれていてもヒット）
    if (kw && !r.segs.some((s) => s.name.toLowerCase().includes(kw))) return false;
    if (lvFilter !== "" && r.level !== Number(lvFilter)) return false;
    if (visFilter === "on" && !r.node.visible) return false;
    if (visFilter === "off" && r.node.visible) return false;
    return true;
  });

  const countOf = (id: number) => memberMap.get(id)?.size ?? 0;

  /** 対象者一覧（クリックされた属性に紐づく会員） */
  const audienceMembers: Member[] = audience
    ? Array.from(memberMap.get(audience.id) ?? [])
        .map((id) => memberById.get(id))
        .filter((m): m is Member => Boolean(m))
        .sort((a, b) => a.name.localeCompare(b.name, "ja"))
    : [];

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

      {/* ── ヘッダー：ビュー切替 ＋ フィルター ──
          表ビューは「閲覧・検索専用」。編集（並び替え・色・追加・削除）はツリー側に一本化する。 */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex items-center gap-2.5 flex-wrap sticky top-0 z-20">
        <div className="inline-flex border border-gray-200 rounded-lg overflow-hidden shrink-0">
          {([
            ["table", "☰ 一覧（表）"],
            ["tree", "🌳 ツリー編集"],
          ] as [ViewMode, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)}
              className={`px-3 py-2 text-[12.5px] font-bold transition-colors ${view === v ? "bg-neutral-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
              {label}
            </button>
          ))}
        </div>

        {view === "table" && (
          <>
            <div className="relative flex-1 min-w-[220px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
              <input value={q} onChange={(e) => setQ(e.target.value)}
                placeholder={`属性ABC をキーワード検索（${levels.join(" / ")}を横断）`}
                className="w-full border border-gray-300 rounded-lg pl-8 pr-8 py-2 text-[13px] focus:outline-none focus:border-red-400" />
              {q && (
                <button onClick={() => setQ("")} title="クリア"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-sm">✕</button>
              )}
            </div>

            <select value={lvFilter} onChange={(e) => setLvFilter(e.target.value as typeof lvFilter)}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] bg-white focus:outline-none focus:border-red-400">
              <option value="">階層：すべて</option>
              {levels.map((nm, i) => <option key={i} value={String(i)}>属性{LEVEL_KEYS[i]}（{nm}）</option>)}
            </select>

            <select value={visFilter} onChange={(e) => setVisFilter(e.target.value as VisFilter)}
              className="border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] bg-white focus:outline-none focus:border-red-400">
              <option value="all">表示状態：すべて</option>
              <option value="on">表示中のみ</option>
              <option value="off">非表示のみ</option>
            </select>

            <span className="text-[12px] text-gray-400 whitespace-nowrap">{rows.length} / {allRows.length} ノード</span>
          </>
        )}

        {view === "tree" && (
          <span className="text-xs text-gray-400 flex-1">
            {levels[0]} {roots.length} 件（表示 {rootVisible} ／ 非表示 {roots.length - rootVisible}）・全 {countNodes(roots)} ノード
          </span>
        )}

        <button onClick={addRoot}
          className="flex items-center gap-1 px-3 py-2 rounded-lg bg-red-600 text-white text-[12.5px] font-bold hover:bg-red-700 whitespace-nowrap shrink-0">
          ＋ {levels[0]}を追加
        </button>
      </div>

      {/* ═══ 一覧（表）ビュー：閲覧・検索専用 ═══ */}
      {view === "table" && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            {/* ★ 列幅を固定することで「＞」が縦に揃う（メンバー詳細の属性表と同じ方式） */}
            <colgroup>
              <col style={{ width: "22%" }} />
              <col style={{ width: 26 }} />
              <col style={{ width: "22%" }} />
              <col style={{ width: 26 }} />
              <col />
              <col style={{ width: 78 }} />
              <col style={{ width: 110 }} />
            </colgroup>
            <thead>
              <tr className="bg-gray-50 text-[11px] font-bold text-gray-500 text-left">
                <th className="px-3 py-2.5 border-b border-gray-200">属性A（{levels[0]}）</th>
                <th className="border-b border-gray-200" />
                <th className="px-3 py-2.5 border-b border-gray-200">属性B（{levels[1]}）</th>
                <th className="border-b border-gray-200" />
                <th className="px-3 py-2.5 border-b border-gray-200">属性C（{levels[2]}）</th>
                <th className="px-3 py-2.5 border-b border-gray-200">階層</th>
                <th className="px-3 py-2.5 border-b border-gray-200 text-right whitespace-nowrap">付与会員</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-10 text-center text-[13px] text-gray-400">
                    {allRows.length === 0
                      ? `属性がまだありません。「＋ ${levels[0]}を追加」から作成してください。`
                      : "該当する属性がありません"}
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const [a, b, c] = [r.segs[0], r.segs[1], r.segs[2]];
                const n = countOf(r.node.id);
                const Cell = ({ node }: { node: AttrNode | undefined }) =>
                  node ? (
                    <span className="inline-flex items-center gap-1.5 font-semibold text-gray-700">
                      <span className="w-2 h-2 rounded-[2px] shrink-0" style={{ background: node.color }} />
                      <Highlight text={node.name || "（無名）"} q={kw} />
                    </span>
                  ) : <span className="text-gray-300">—</span>;

                return (
                  <tr key={r.node.id}
                    className={`border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60 ${r.node.visible ? "" : "opacity-50"}`}>
                    <td className="px-3 py-2.5"><Cell node={a} /></td>
                    <td className={`text-center font-bold ${b ? "text-gray-300" : "text-gray-200"}`}>＞</td>
                    <td className="px-3 py-2.5"><Cell node={b} /></td>
                    <td className={`text-center font-bold ${c ? "text-gray-300" : "text-gray-200"}`}>＞</td>
                    <td className="px-3 py-2.5"><Cell node={c} /></td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full whitespace-nowrap ${LV_BADGE[r.level]}`}>
                        属性{LEVEL_KEYS[r.level]}
                      </span>
                      {!r.node.visible && <div className="text-[10px] text-gray-400 mt-1">非表示</div>}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {n > 0 ? (
                        // 人数はリンク。クリックで対象者一覧を開く。
                        <button onClick={() => setAudience(r.node)}
                          className="text-blue-600 font-bold hover:underline"
                          title="この属性が付与されている会員を表示">
                          {n} <span className="text-[11px] font-normal text-gray-400">名</span>
                        </button>
                      ) : (
                        <span className="text-gray-300">0 <span className="text-[11px]">名</span></span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <p className="text-[11px] text-gray-400 px-3 py-2.5 border-t border-gray-100 bg-gray-50/60">
            この表は<b className="text-gray-600">閲覧・検索専用</b>です。名前・色・並び順・表示/非表示の変更、追加・削除は
            <b className="text-gray-600">「ツリー編集」</b>で行います。
            付与会員は<b className="text-gray-600">下位階層の会員も含めた合計</b>です（例：「会員区分」＝有料＋無料の全員）。
          </p>
        </div>
      )}

      {/* ═══ ツリー編集ビュー（従来どおり）═══ */}
      {view === "tree" && (
        <>
          <div>
            {roots.length === 0 && <p className="text-center text-gray-300 py-8 text-sm">属性がまだありません。「＋ {levels[0]}を追加」から作成してください。</p>}
            {roots.map((n, i) => renderNode(n, 0, roots, i))}
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-200 pt-3">
            ▶ で子（下位属性）を開閉。<b className="text-gray-600">＋ 子を追加</b>で階層を作成（属性A→属性B→属性C、属性Cが末端）。
            各ノードは <b className="text-gray-600">▲▼</b> で同階層の並び替え、<b className="text-gray-600">パレット</b>で色・表示仕様、<b className="text-gray-600">目</b>アイコンで表示/非表示、<b className="text-gray-600">ゴミ箱</b>で削除（配下ごと）。
          </p>
        </>
      )}

      {/* ── 対象者一覧モーダル（人数リンクから）── */}
      {audience && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setAudience(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: audience.color }} />
              <div className="min-w-0">
                <h2 className="font-bold text-gray-800 text-[15px] truncate">{audience.name || "（無名）"}</h2>
                <p className="text-[11px] text-gray-400">
                  属性{LEVEL_KEYS[audience.level]}（{levels[audience.level]}）の付与会員　{audienceMembers.length} 名
                </p>
              </div>
              <button onClick={() => setAudience(null)} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto flex-1">
              {audienceMembers.length === 0 && (
                <p className="text-center text-[13px] text-gray-400 py-10">この属性が付与されている会員はいません。</p>
              )}
              {audienceMembers.map((m) => (
                <div key={m.id} className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-50 last:border-b-0 hover:bg-gray-50/60">
                  <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-600 grid place-items-center text-xs font-bold shrink-0">
                    {(m.name?.[0] ?? "?").toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-bold text-gray-800 truncate">{m.name}</div>
                    <div className="text-[11px] text-gray-400 truncate">{m.email || "—"}</div>
                  </div>
                  <span className="text-[10.5px] text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 shrink-0">{m.role}</span>
                  {/* メンバー詳細は別ウィンドウで開く（顧客詳細画面と同じ挙動） */}
                  <a href={`/ops/members/${m.id}`} target="_blank" rel="noopener noreferrer"
                    className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 shrink-0">
                    詳細
                  </a>
                </div>
              ))}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex">
              <span className="text-[11px] text-gray-400">下位階層の会員も含みます</span>
              <button onClick={() => setAudience(null)}
                className="ml-auto px-4 py-2 rounded-lg bg-neutral-800 text-white text-[12.5px] font-bold">閉じる</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 text-white px-4 py-2.5 rounded-lg text-sm shadow-lg z-50">{toast}</div>
      )}
    </div>
  );
}
