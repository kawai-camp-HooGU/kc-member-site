"use client";
import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  loadLevelNames, saveLevelName, loadAttributeTree,
  createAttribute, updateAttribute, deleteAttributes, saveOrder,
  collectIds, countNodes, loadAttrMemberLinks, buildAttrMemberMap,
  childColorOf, nextRootColor, ATTR_HUES, ATTR_STATUS_COLORS,
  DEFAULT_LEVEL_NAMES, LEVEL_KEYS, MAX_LEVEL, loadAttrUsage,
} from "../../lib/attributes";
import type { AttrNode, AttrPatch, AttrMemberLink, AttrUsageItem, AttrUsageKind } from "../../lib/attributes";
import { supabase, toMember } from "../../lib/supabase";
import type { Member } from "../../lib/models";
import { Icon } from "../common/Icon";
import { useConfirm } from "../common/ConfirmProvider";
import { openChildWindow } from "../../lib/childWindow";

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

  // ── ツリー編集（列一覧＝Millerカラム）の選択状態 ──
  //   a/b/c は選択中ノードのID。b/c は明示的に選んだときだけ入る（自動選択しない）。
  const [selPath, setSelPath] = useState<{ a: number | null; b: number | null; c: number | null }>({ a: null, b: null, c: null });

  // ── 使用箇所モーダル ──
  const [usageFor, setUsageFor] = useState<AttrNode | null>(null);
  const [usage, setUsage] = useState<AttrUsageItem[] | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);

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

  // 使用箇所モーダルを開いたら、その属性の付与／解除箇所を集める
  useEffect(() => {
    if (!usageFor) { setUsage(null); return; }
    let alive = true;
    setUsageLoading(true);
    loadAttrUsage(usageFor.id)
      .then((u) => { if (alive) setUsage(u); })
      .catch(() => { if (alive) setUsage([]); })
      .finally(() => { if (alive) setUsageLoading(false); });
    return () => { alive = false; };
  }, [usageFor]);

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

  // 配色ルール（案A）：色相は大分類が決め、配下は同じ色相の濃淡にする。
  //   → 追加時に親の色を1段淡くして継承する。運営は原則、色を選ばなくてよい。
  const addChild = async (parent: AttrNode) => {
    const lvl = parent.level + 1;
    const created = await createAttribute({
      level: lvl, parentId: parent.id,
      name: `新しい${levels[lvl]}`, sortOrder: parent.children.length,
      color: childColorOf(parent.color, lvl),
    });
    if (!created) { showToast("追加に失敗しました"); return; }
    // 追加した子自身も開いておく（そうしないと、その子に孫を追加できない）
    created.open = true;
    parent.children.push(created);
    parent.open = true;
    force();
    showToast(`${levels[lvl]}を追加しました`);
  };

  // 大分類は「まだ使われていない色相」を自動で割り当てる（赤・琥珀は状態用に予約）
  const addRoot = async () => {
    const created = await createAttribute({
      level: 0, parentId: null,
      name: `新しい${levels[0]}`, sortOrder: treeRef.current.length,
      color: nextRootColor(treeRef.current.map((n) => n.color)),
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

  // ── カラーコード入力＋パレット ────────────────────────
  //   カラーピッカー（OS の色選択）だけだと #534AB7 のような指定色を正確に入れられない。
  //   16進コードの直接入力と、配色ルール（案A）のワンクリック選択を用意する。
  const ColorField = ({ node }: { node: AttrNode }) => {
    // 入力途中（"#53" など）は不正な色なので、確定するまではローカルの文字列だけ更新する
    const [text, setText] = useState(node.color.toUpperCase());
    useEffect(() => { setText(node.color.toUpperCase()); }, [node.color]);

    const apply = (v: string) => {
      const hex = v.trim().replace(/^#?/, "#").toUpperCase();
      if (!/^#[0-9A-F]{6}$/.test(hex)) { setText(node.color.toUpperCase()); return; }  // 不正なら元に戻す
      patch(node, { color: hex });
    };

    const pick = (hex: string) => { setText(hex); patch(node, { color: hex }); };
    const swatches = ATTR_HUES.map((h) => h.tones[Math.min(node.level, 2)]);

    return (
      <div className="mt-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="w-6 h-6 rounded-md border border-gray-200 shrink-0" style={{ background: node.color }} />
          <input value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={(e) => apply(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            placeholder="#534AB7" maxLength={7} spellCheck={false}
            className="w-28 border border-gray-300 rounded-lg px-2 py-1.5 text-xs font-mono uppercase focus:outline-none focus:border-red-400" />
          <span className="text-[11px] text-gray-400">
            {node.level === 0 ? "大分類の色相が、配下の既定色になります" : "親の色相を淡くした色が既定です"}
          </span>
        </div>

        {/* 配色ルール（案A）のパレット。階層に応じた濃さを出す。 */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          {swatches.map((hex) => (
            <button key={hex} type="button" onClick={() => pick(hex)} title={hex}
              className={`w-6 h-6 rounded-md border ${node.color.toUpperCase() === hex ? "border-gray-800 ring-2 ring-gray-300" : "border-gray-200"}`}
              style={{ background: hex }} />
          ))}
          <span className="w-2" />
          {ATTR_STATUS_COLORS.map((s) => (
            <button key={s.color} type="button" onClick={() => pick(s.color)} title={`${s.name}（状態用の予約色）`}
              className={`w-6 h-6 rounded-md border ${node.color.toUpperCase() === s.color ? "border-gray-800 ring-2 ring-gray-300" : "border-gray-200"}`}
              style={{ background: s.color }} />
          ))}
          <span className="text-[10.5px] text-gray-400 ml-1">← 右2色は「要対応・保留」など状態用の予約色</span>
        </div>
      </div>
    );
  };

  // ── 列一覧（Millerカラム）の1行 ─────────────────────────
  //   選択中の列では、選択行以外の文字色を落として（グレーアウト）選択を目立たせる。
  const renderColItem = (
    node: AttrNode, siblings: AttrNode[], idx: number, level: number,
    selectedId: number | null, onPick: (id: number) => void,
  ): React.ReactNode => {
    const isSel = node.id === selectedId;
    const dim = selectedId != null && !isSel;   // 同じ列に選択済みがあり、自分は選択でない
    const selBg = ["bg-red-50 border-red-200", "bg-amber-50 border-amber-200", "bg-teal-50 border-teal-200"][level];
    return (
      <div key={node.id} onClick={() => onPick(node.id)}
        className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg mb-0.5 cursor-pointer border ${isSel ? selBg : "border-transparent hover:bg-gray-50"}`}>
        <span className="w-3 h-3 rounded-[3px] shrink-0" style={{ background: node.color, opacity: dim ? 0.4 : 1 }} />
        <span className={`flex-1 min-w-0 truncate text-[13.5px] font-bold ${
          dim ? "text-gray-400" : !node.visible ? "text-gray-400 line-through" : "text-gray-700"}`}>
          {node.name || "（無名）"}
        </span>
        {!node.visible && <Icon name="eyeOff" size={13} className={dim ? "text-gray-300" : "text-gray-400"} />}
        {/* 並び替え（ホバー時のみ） */}
        <span className="hidden group-hover:flex flex-col gap-0.5 shrink-0">
          <button onClick={(e) => { e.stopPropagation(); move(siblings, idx, -1); }} disabled={idx === 0}
            className="w-5 h-3.5 border border-gray-200 rounded text-gray-500 text-[8px] leading-none bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed" title="上へ">▲</button>
          <button onClick={(e) => { e.stopPropagation(); move(siblings, idx, 1); }} disabled={idx === siblings.length - 1}
            className="w-5 h-3.5 border border-gray-200 rounded text-gray-500 text-[8px] leading-none bg-white hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed" title="下へ">▼</button>
        </span>
        <span className={`text-[11px] shrink-0 ${dim ? "text-gray-300" : "text-gray-400"}`}>{countOf(node.id)}</span>
        {level < MAX_LEVEL && <span className={`shrink-0 text-xs ${isSel ? "text-gray-500" : "text-gray-300"}`}>›</span>}
      </div>
    );
  };

  if (loading) return <p className="text-sm text-gray-400 py-8 text-center">読み込み中…</p>;

  const roots = treeRef.current;
  const rootVisible = roots.filter((n) => n.visible).length;

  // ── ツリー編集（列一覧）の選択解決 ───────────────────────
  //   A は既定で先頭。B/C は明示選択のときだけ。削除された選択はフォールバック。
  const selA = roots.find((n) => n.id === selPath.a) ?? roots[0] ?? null;
  const colB = selA ? selA.children : [];
  const selB = colB.find((n) => n.id === selPath.b) ?? null;
  const colC = selB ? selB.children : [];
  const selC = colC.find((n) => n.id === selPath.c) ?? null;
  const selNode = selC ?? selB ?? selA;                    // 詳細に出す末端
  const pickA = (id: number) => setSelPath({ a: id, b: null, c: null });
  const pickB = (id: number) => setSelPath({ a: selA?.id ?? null, b: id, c: null });
  const pickC = (id: number) => setSelPath({ a: selA?.id ?? null, b: selB?.id ?? null, c: id });

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
              <tr className="tbl-head text-[11px] text-left">
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

      {/* ═══ ツリー編集ビュー（列一覧＝Millerカラム）═══ */}
      {view === "tree" && (
        roots.length === 0 ? (
          <p className="text-center text-gray-300 py-10 text-sm">属性がまだありません。「＋ {levels[0]}を追加」から作成してください。</p>
        ) : (
          <>
            <div className="grid md:grid-cols-3 border border-gray-200 rounded-2xl overflow-hidden bg-white">
              {/* 属性A */}
              <div className="flex flex-col border-b md:border-b-0 md:border-r border-gray-200">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${LV_BADGE[0]}`}>属性A</span>
                    <span className="text-[12px] font-bold text-gray-600 truncate">{levels[0]}</span>
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{roots.length}件</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 min-h-[280px] max-h-[440px]">
                  {roots.map((n, i) => renderColItem(n, roots, i, 0, selA?.id ?? null, pickA))}
                </div>
                <div className="p-2 border-t border-gray-100">
                  <button onClick={addRoot} className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-[12px] font-bold hover:bg-gray-50 hover:text-gray-700">＋ {levels[0]}を追加</button>
                </div>
              </div>

              {/* 属性B */}
              <div className="flex flex-col border-b md:border-b-0 md:border-r border-gray-200">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${LV_BADGE[1]}`}>属性B</span>
                    <span className="text-[12px] font-bold text-gray-600 truncate">{levels[1]}</span>
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{colB.length}件</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 min-h-[280px] max-h-[440px]">
                  {colB.length
                    ? colB.map((n, i) => renderColItem(n, colB, i, 1, selB?.id ?? null, pickB))
                    : <p className="text-center text-gray-400 text-[12.5px] px-3 py-12 leading-relaxed">{selA ? `「${selA.name || "（無名）"}」に${levels[1]}はありません` : `${levels[0]}を選択してください`}</p>}
                </div>
                <div className="p-2 border-t border-gray-100">
                  <button onClick={() => selA && addChild(selA)} disabled={!selA}
                    className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-[12px] font-bold hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">＋ {levels[1]}を追加</button>
                </div>
              </div>

              {/* 属性C */}
              <div className="flex flex-col">
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 bg-gray-50 border-b border-gray-200">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${LV_BADGE[2]}`}>属性C</span>
                    <span className="text-[12px] font-bold text-gray-600 truncate">{levels[2]}</span>
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{colC.length}件</span>
                </div>
                <div className="flex-1 overflow-y-auto p-2 min-h-[280px] max-h-[440px]">
                  {colC.length
                    ? colC.map((n, i) => renderColItem(n, colC, i, 2, selC?.id ?? null, pickC))
                    : <p className="text-center text-gray-400 text-[12.5px] px-3 py-12 leading-relaxed">{selB ? `「${selB.name || "（無名）"}」に${levels[2]}はありません` : `${levels[1]}を選択してください`}</p>}
                </div>
                <div className="p-2 border-t border-gray-100">
                  <button onClick={() => selB && addChild(selB)} disabled={!selB}
                    className="w-full py-2 border border-dashed border-gray-300 rounded-lg text-gray-500 text-[12px] font-bold hover:bg-gray-50 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed">＋ {levels[2]}を追加</button>
                </div>
              </div>
            </div>

            <p className="text-[11px] text-gray-400 mt-2">
              左の列で選ぶと右の列に下位属性が表示されます。行にカーソルを合わせると出る <b className="text-gray-600">▲▼</b> で並び替え。選択中の属性は下の詳細で名前・色・表示・削除を編集できます。
            </p>

            {/* 選択中ノードの詳細 */}
            {selNode && (() => {
              const sib = selC ? colC : selB ? colB : roots;
              const idx = sib.indexOf(selNode);
              const lvl = selNode.level;
              const pathSegs = [selA, lvl >= 1 ? selB : null, lvl >= 2 ? selC : null].filter(Boolean) as AttrNode[];
              const n = countOf(selNode.id);
              return (
                <div className="mt-3 bg-white border border-gray-200 rounded-2xl p-4">
                  <div className="flex items-center gap-2.5 flex-wrap mb-3">
                    <span className={`text-[10px] font-bold text-white px-2 py-0.5 rounded-full ${LV_BADGE[lvl]}`}>属性{LEVEL_KEYS[lvl]}</span>
                    <span className="text-[12px] text-gray-400 font-bold">
                      {pathSegs.map((s, i) => (
                        <span key={s.id}>{i > 0 && <span className="text-gray-300 mx-1">＞</span>}<span className="text-gray-700">{s.name || "（無名）"}</span></span>
                      ))}
                    </span>
                    <span className="flex-1" />
                    {/* ★ 使用箇所：この属性がどこで付与／解除されているか */}
                    <button onClick={() => setUsageFor(selNode)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-100">
                      🔗 使用箇所
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1">属性名</label>
                      <input value={selNode.name}
                        onChange={(e) => { selNode.name = e.target.value; force(); }}
                        onBlur={(e) => updateAttribute(selNode.id, { name: e.target.value })}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm font-bold text-gray-800 focus:outline-none focus:border-red-400" />
                      <ColorField node={selNode} />
                    </div>
                    <div>
                      <label className="text-[11px] font-bold text-gray-500 block mb-1">表示状態・付与会員</label>
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <button onClick={() => patch(selNode, { visible: !selNode.visible })}
                          className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold ${selNode.visible ? "border-green-200 bg-green-50 text-green-700" : "border-gray-200 bg-gray-50 text-gray-500"}`}>
                          <Icon name={selNode.visible ? "eye" : "eyeOff"} size={15} /> {selNode.visible ? "表示中" : "非表示"}
                        </button>
                        {n > 0 ? (
                          <button onClick={() => setAudience(selNode)} className="text-[13px] font-bold text-blue-600 hover:underline">付与会員 {n} 名 ▸</button>
                        ) : <span className="text-[13px] text-gray-400">付与会員 0 名</span>}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap mt-3">
                        <span className="text-[12px] font-bold text-gray-600">表示仕様</span>
                        <button onClick={() => patch(selNode, { bg: !selNode.bg })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${selNode.bg ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}><Icon name="palette" size={13} /> 背景色</button>
                        <button onClick={() => patch(selNode, { bold: !selNode.bold })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${selNode.bold ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}>𝐁 太字</button>
                        <button onClick={() => patch(selNode, { titleColor: !selNode.titleColor })}
                          className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-semibold ${selNode.titleColor ? "bg-gray-100 border-gray-300 text-gray-800" : "bg-white border-gray-200 text-gray-600 hover:bg-gray-50"}`}><Icon name="tag" size={13} /> タイトル色</button>
                      </div>
                      <Preview node={selNode} />
                    </div>
                  </div>

                  <div className="flex items-center mt-4 pt-3 border-t border-gray-100">
                    <span className="flex-1" />
                    <button onClick={() => idx >= 0 && del(sib, idx)}
                      className="inline-flex items-center gap-1.5 text-[12px] font-bold text-red-600 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-red-50">
                      <Icon name="trash" size={14} /> この属性を削除（配下ごと）
                    </button>
                  </div>
                </div>
              );
            })()}
          </>
        )
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
                  {/* メンバー詳細は別ウィンドウで開く（顧客詳細画面と同じ挙動）
                      ⚠️ rel="noopener" は付けない。子側で「呼び出し元へ戻る」ために
                         window.opener が必要（同一オリジンなので安全）。 */}
                  <button type="button" onClick={() => openChildWindow(`/ops/members/${m.id}`, `member-${m.id}`)}
                    className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2.5 py-1 hover:bg-gray-50 shrink-0">
                    詳細
                  </button>
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

      {/* ── 使用箇所モーダル（この属性がどこで付与／解除されるか）── */}
      {usageFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setUsageFor(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <span className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: usageFor.color }} />
              <div className="min-w-0">
                <h2 className="font-bold text-gray-800 text-[15px] truncate">🔗 使用箇所 — {usageFor.name || "（無名）"}</h2>
                <p className="text-[11px] text-gray-400">この属性を付与／解除するアクションが設定されている箇所</p>
              </div>
              <button onClick={() => setUsageFor(null)} className="ml-auto text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            <div className="overflow-y-auto flex-1 p-4">
              {usageLoading && <p className="text-center text-[13px] text-gray-400 py-10">読み込み中…</p>}
              {!usageLoading && usage && usage.length === 0 && (
                <p className="text-center text-[13px] text-gray-400 py-10 leading-relaxed">
                  この属性を自動で付与／解除している箇所はありません。<br />
                  <span className="text-[11px]">（会員へ手動で付与している分は含みません）</span>
                </p>
              )}
              {!usageLoading && usage && usage.length > 0 && (() => {
                const KIND: Record<AttrUsageKind, { label: string; cls: string }> = {
                  broadcast: { label: "一斉配信", cls: "bg-purple-600" },
                  scenario:  { label: "シナリオ配信", cls: "bg-cyan-600" },
                  form:      { label: "フォーム", cls: "bg-pink-600" },
                  source:    { label: "流入経路", cls: "bg-lime-600" },
                };
                const order: AttrUsageKind[] = ["broadcast", "scenario", "form", "source"];
                return (
                  <>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 bg-gray-50 rounded-lg px-3 py-2 mb-3 text-[12px] text-gray-500 font-bold">
                      <span>合計 <b className="text-gray-800">{usage.length}</b> 箇所</span>
                      {order.map((k) => { const c = usage.filter((u) => u.kind === k).length; return c ? <span key={k}>{KIND[k].label} <b className="text-gray-800">{c}</b></span> : null; })}
                    </div>
                    {order.map((k) => {
                      const items = usage.filter((u) => u.kind === k);
                      if (!items.length) return null;
                      return (
                        <div key={k} className="mb-4 last:mb-0">
                          <div className="flex items-center gap-2 mb-2">
                            <span className={`text-[10.5px] font-bold text-white px-2 py-0.5 rounded-full ${KIND[k].cls}`}>{KIND[k].label}</span>
                            <span className="text-[11px] text-gray-400">{items.length}件</span>
                          </div>
                          {items.map((u, i) => (
                            <div key={i} className="flex items-center gap-2.5 px-3 py-2.5 border border-gray-200 rounded-lg mb-1.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded shrink-0 whitespace-nowrap ${u.op === "add" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-orange-50 text-orange-700 border border-orange-200"}`}>
                                {u.where}{u.op === "add" ? " 付与" : " 解除"}
                              </span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-bold text-gray-700 truncate">{u.title}</div>
                                {u.detail && <div className="text-[11px] text-gray-400">{u.detail}</div>}
                              </div>
                              {u.href && (
                                <button onClick={() => openChildWindow(u.href!, `${u.kind}-${u.id}`)}
                                  className="text-[12px] font-bold text-blue-600 hover:underline shrink-0 whitespace-nowrap">開く ▸</button>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </>
                );
              })()}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center">
              <span className="text-[11px] text-gray-400">流入経路は設定内で編集できます</span>
              <button onClick={() => setUsageFor(null)} className="ml-auto px-4 py-2 rounded-lg bg-neutral-800 text-white text-[12.5px] font-bold">閉じる</button>
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
