"use client";
// ============================================================
// コンテンツ「セクション（入口）」管理（運営）
//
//   会員ポータルのコンテンツ入口（サイドバー項目＝ハブ）を運営が増減・編集する。
//   1セクション＝1入口。ページは編集画面で「所属セクション」を選んで振り分ける。
//
//   ・公開ON/OFF・並び順・公開対象属性（ページと同じ AttrTable/canView 方式）を設定可能
//   ・既定セクション（is_default）は削除不可（未所属ページの受け皿）
// ============================================================
import { useEffect, useMemo, useState } from "react";
import {
  fetchContentSections, saveSection, deleteSection, setSectionPublished, saveSectionOrder,
  fetchContentData,
} from "../../lib/contents";
import { sanitizeDoorHtml, describeDoorSanitize, DOOR_HTML_MAX } from "../../lib/ai/sanitizeDoor";
import { referencedSlugs } from "../../lib/doorPage";
import { DoorPage } from "./DoorPage";
import { AiDoorBar } from "./AiDoorBar";
import { useMaster } from "../../hooks/useMaster";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { AttrNode } from "../../lib/attributes";
import { AttrTable } from "../master/AttrTable";
import { AttrChips } from "../master/AttrChips";
import { Icon } from "../common/Icon";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT } from "../../lib/constants";
import type { ContentSection, ContentPage, PublishMode, DoorMode } from "../../lib/models";

const MODES: { v: PublishMode; l: string }[] = [
  { v: "any", l: "選択したタグをいずれか1つ以上含む" },
  { v: "all", l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];
const input = FIELD_INPUT;

const newSection = (sortOrder: number): ContentSection => ({
  id: 0, name: "", nameEn: "", icon: "", overview: "", sortOrder, published: true,
  attrMode: "any", attrIds: [], isDefault: false,
  doorMode: "auto", doorHtml: "",
});

// ── 扉ページ ────────────────────────────────────────────────
const DOOR_MODES: { v: DoorMode; l: string; d: string }[] = [
  { v: "auto",   l: "カード一覧（自動）", d: "配下ページをカードで自動的に並べます（既定）" },
  { v: "html",   l: "扉ページ（HTML）",   d: "下のHTMLをハブ本体として表示します" },
  { v: "hybrid", l: "扉ページ＋カード一覧", d: "扉ページの下にカード一覧も出します（載せ忘れ対策）" },
];

/** 編集画面のトークン早見表。ここと lib/doorPage.ts の実装は必ず対応させる */
const TOKEN_HELP: { t: string; d: string }[] = [
  { t: 'data-page="C00"',        d: "そのページへの入口。権限が無い会員には要素ごと非表示" },
  { t: 'data-page-cover="C00"',  d: "ページのカバー画像を背景に敷く（値を省くと親のページ）" },
  { t: "data-resume",            d: "未読が残る先頭ページへ（＝続きから）。全部読了なら非表示" },
  { t: "data-name",              d: "中身をページ名に差し替え（値を省くと親のページ）。続きから内で使う" },
  { t: 'data-progress="C00"',    d: "中身を「4 / 10」に差し替え" },
  { t: 'data-progress-bar="C00"', d: "進捗バーを挿入" },
  { t: "{{count:C00}}",          d: "そのページの公開コンテンツ本数" },
  { t: "{{name:C00}}",           d: "ページ名" },
];

// ============================================================
// 扉ページ編集タブ
//   左：表示方式 ＋ HTMLエディタ（またはプレビュー）
//   右：トークン早見表 ＋ ページ一覧（slugのコピー元・掲載漏れ検出）
// ============================================================
interface DoorEditorProps {
  edit: ContentSection;
  setEdit: (s: ContentSection) => void;
  sectionPages: ContentPage[];
  doorCheck: { html: string; info: { removedTags: string[]; removedAttrs: string[] } } | null;
  missingPages: ContentPage[];
  unknownSlugs: string[];
  preview: boolean;
  setPreview: (b: boolean) => void;
  counts: Map<number, number> | null;
  /** ⑧扉ページAI：起動ボタンを出すか（権限 ai_html） */
  canAi: boolean;
  /** ⑧扉ページAI：生成結果の反映 */
  onApplyAi: (html: string) => void;
  /** ⑧扉ページAI：直前の状態（null なら未反映） */
  aiUndo: string | null;
  onUndoAi: () => void;
}

function DoorEditor({
  edit, setEdit, sectionPages, doorCheck, missingPages, unknownSlugs, preview, setPreview, counts,
  canAi, onApplyAi, aiUndo, onUndoAi,
}: DoorEditorProps) {
  const removed = doorCheck ? describeDoorSanitize({ ...doorCheck.info, externalLinks: [] }) : [];
  const refs = referencedSlugs(edit.doorHtml);
  const over = edit.doorHtml.length > DOOR_HTML_MAX;

  return (
    <div className="px-5 py-4 overflow-y-auto grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
      {/* ── 左：方式＋エディタ ── */}
      <div className="min-w-0 space-y-3">
        <div>
          <label className="text-xs font-bold text-gray-500 block mb-1.5">ハブの表示方式</label>
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
            {DOOR_MODES.map((m) => (
              <button key={m.v} onClick={() => setEdit({ ...edit, doorMode: m.v })}
                className={`px-3.5 py-1.5 text-[12px] border-r border-gray-200 last:border-r-0 ${edit.doorMode === m.v ? "bg-neutral-800 text-white font-bold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                {m.l}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-1.5">
            {DOOR_MODES.find((m) => m.v === edit.doorMode)?.d}
          </p>
        </div>

        {/* ⑧ AIで扉ページを生成 / 修正（扉HTMLを使う方式のときだけ） */}
        {edit.doorMode !== "auto" && canAi && (
          <div>
            <AiDoorBar html={edit.doorHtml} sectionId={edit.id} pages={sectionPages} onApply={onApplyAi} />
            {aiUndo != null && (
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[10.5px] text-red-600 font-bold">✦ AIの生成結果を反映しました</span>
                <span className="text-[10.5px] text-gray-400">— プレビューを確認してから保存してください</span>
                <button onClick={onUndoAi}
                  className="ml-auto text-[10.5px] px-2 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">
                  ↶ 元に戻す
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-gray-500">扉ページHTML</label>
          <span className={`text-[11px] ${over ? "text-red-600 font-bold" : "text-gray-400"}`}>
            {edit.doorHtml.length.toLocaleString()} / {DOOR_HTML_MAX.toLocaleString()}字
          </span>
          <span className="flex-1" />
          <button onClick={() => setPreview(!preview)}
            className={`text-[11px] font-bold px-3 py-1 rounded-lg border ${preview ? "bg-neutral-800 text-white border-neutral-800" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {preview ? "HTMLに戻る" : "プレビュー"}
          </button>
        </div>

        {preview ? (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 min-h-[340px] max-h-[46vh] overflow-y-auto">
            <p className="text-[11px] text-gray-400 mb-3">
              運営プレビュー：全ページが見える状態で描画しています。進捗は 0 件として表示されます。
            </p>
            <DoorPage
              html={edit.doorHtml}
              ctx={{
                pages: sectionPages,
                statOf: (pid) => ({ total: counts?.get(pid) ?? 0, viewed: 0 }),
                resume: sectionPages[0] ?? null,
                hrefOf: () => "#",
              }}
              onOpenPage={() => { /* プレビューでは遷移しない */ }}
            />
          </div>
        ) : (
          <textarea
            className="w-full min-h-[340px] max-h-[46vh] rounded-xl border border-gray-300 bg-neutral-900 text-gray-100 p-3 font-mono text-[11.5px] leading-relaxed"
            spellCheck={false}
            value={edit.doorHtml}
            onChange={(e) => setEdit({ ...edit, doorHtml: e.target.value })}
            placeholder={'<div class="door-lv">\n  <div class="door-lv-hd">\n    <span class="door-lv-no">LEVEL 1</span>\n    <span class="door-lv-t">AIを使う</span>\n  </div>\n  <div class="door-grid">\n    <a class="door-card" data-page="C00">\n      <span class="cv" data-page-cover="C00"></span>\n      <span class="bd">\n        <span class="t">AI仕事術スターター</span>\n        <span class="m">{{count:C00}}レッスン</span>\n        <span data-progress-bar="C00"></span>\n      </span>\n    </a>\n  </div>\n</div>'}
          />
        )}

        {/* 安全チェック・掲載漏れ */}
        {over && (
          <p className="text-[11.5px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            HTMLが上限を超えています。このままでは保存できません。
          </p>
        )}
        {removed.length > 0 && (
          <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <b className="block mb-1">保存時に除去されるものがあります</b>
            <ul className="list-disc pl-4 space-y-0.5 m-0">{removed.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        )}
        {unknownSlugs.length > 0 && (
          <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 m-0">
            存在しないページを参照しています（会員には表示されません）：<b>{unknownSlugs.join(" / ")}</b>
          </p>
        )}
        {edit.doorMode !== "auto" && missingPages.length > 0 && (
          <p className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 m-0">
            扉ページに載っていないページが {missingPages.length} 件あります
            {edit.doorMode === "html"
              ? "。この設定では会員から到達できません。「扉ページ＋カード一覧」にするか、扉HTMLへ追加してください。"
              : "。カード一覧側に表示されます。"}
          </p>
        )}
      </div>

      {/* ── 右：トークン早見表＋ページ一覧 ── */}
      <div className="space-y-3 min-w-0">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3">
          <p className="text-[11px] font-bold text-gray-600 m-0 mb-2">使えるトークン</p>
          <dl className="m-0 space-y-1.5">
            {TOKEN_HELP.map((t) => (
              <div key={t.t}>
                <dt className="font-mono text-[10.5px] text-red-700 break-all">{t.t}</dt>
                <dd className="m-0 text-[10.5px] text-gray-500 leading-relaxed">{t.d}</dd>
              </div>
            ))}
          </dl>
          <p className="text-[10.5px] text-gray-400 mt-2 mb-0 leading-relaxed">
            ⚠ カードは全体を <span className="font-mono">&lt;a data-page&gt;</span> で囲んでください。
            囲まないと、権限が無い会員に空のカードが残ります。
          </p>
          <p className="text-[10.5px] text-gray-400 mt-1.5 mb-0 leading-relaxed">
            使えるclass：<span className="font-mono">.door-lv .door-lv-hd .door-lv-no .door-lv-t .door-lv-d
            .door-lv-goal .door-grid .door-card .door-routes .door-route .door-h2 .door-sec .door-resume</span>
          </p>
          <p className="text-[10.5px] text-gray-400 mt-1.5 mb-0">
            <span className="font-mono">&lt;style&gt;</span> タグは使えません（配色は上のclassに集約しています）。
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <p className="text-[11px] font-bold text-gray-600 m-0 px-3 py-2 border-b border-gray-100">
            このセクションのページ（{sectionPages.length}件）
          </p>
          <ul className="divide-y divide-gray-100 max-h-[240px] overflow-y-auto m-0 p-0 list-none">
            {sectionPages.length === 0 && (
              <li className="px-3 py-4 text-[11px] text-gray-300 text-center">所属ページがありません</li>
            )}
            {sectionPages.map((p) => (
              <li key={p.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className={`font-mono text-[10.5px] shrink-0 ${p.slug ? "text-gray-700" : "text-gray-300"}`}>
                  {p.slug || "—"}
                </span>
                <span className="text-[11px] text-gray-500 truncate flex-1">{p.name || "（無題）"}</span>
                {!p.slug
                  ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-400 shrink-0">slug未設定</span>
                  : refs.has(p.slug)
                    ? <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 shrink-0">掲載済</span>
                    : <span className="text-[9.5px] font-bold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">未掲載</span>}
              </li>
            ))}
          </ul>
          <p className="text-[10.5px] text-gray-400 m-0 px-3 py-2 border-t border-gray-100 leading-relaxed">
            slug は「ページ管理」→ページ編集で設定します。未設定のページは扉から参照できません。
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * @param pages 所属ページ数の表示に使う（会員に見えるかとは無関係の総数）
 * @param onChanged セクションが増減・改名されたら親（＋サイドバー）を更新するために呼ぶ
 */
export function SectionManager({ pages, onChanged }: { pages: ContentPage[]; onChanged?: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const { can } = useMaster();
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState<ContentSection | null>(null);
  const [publishAll, setPublishAll] = useState(false);
  const [tab, setTab] = useState<"basic" | "door">("basic");
  const [preview, setPreview] = useState(false);
  /** プレビュー用のページ別コンテンツ本数。開いたときに一度だけ取る */
  const [counts, setCounts] = useState<Map<number, number> | null>(null);
  /** ⑧扉ページAI：反映直前の doorHtml（「元に戻す」用。null なら未反映） */
  const [doorUndo, setDoorUndo] = useState<string | null>(null);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);
  const sorted = useMemo(() => [...sections].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id), [sections]);
  const pageCount = (sid: number) => pages.filter((p) => p.sectionId === sid).length;

  const reload = async () => { setSections(await fetchContentSections()); onChanged?.(); };

  useEffect(() => {
    (async () => {
      try {
        const [secs, t] = await Promise.all([fetchContentSections(), loadAttributeTree()]);
        setSections(secs); setTree(t);
      } catch (e) { console.error("セクション読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  const openEdit = (s: ContentSection) => {
    setEdit({ ...s });
    setPublishAll(!!s.id && s.attrIds.length === 0);
    setTab("basic"); setPreview(false); setDoorUndo(null);
  };

  // ── ⑧ 扉ページAI（生成は別ウィンドウのAIチャット。ここは受け取りだけ）──
  const applyAiDoor = (next: string) => {
    if (!edit) return;
    setDoorUndo(edit.doorHtml);
    setEdit({ ...edit, doorHtml: next });
  };
  const undoAiDoor = () => {
    if (!edit || doorUndo == null) return;
    setEdit({ ...edit, doorHtml: doorUndo });
    setDoorUndo(null);
  };

  // ── 扉ページ編集の派生値 ──────────────────────────────────
  /** このセクションに所属するページ（運営は権限に関係なく全件見える） */
  const sectionPages = useMemo(
    () => (edit?.id ? pages.filter((p) => p.sectionId === edit.id) : []),
    [pages, edit?.id],
  );
  /** 扉HTMLの安全チェック結果 */
  const doorCheck = useMemo(
    () => (edit ? sanitizeDoorHtml(edit.doorHtml) : null),
    [edit?.doorHtml],  // eslint-disable-line react-hooks/exhaustive-deps
  );
  /** 扉HTMLに載っていないページ（＝会員から到達できないページ）の検出 */
  const missingPages = useMemo(() => {
    if (!edit || edit.doorMode === "auto") return [];
    const refs = referencedSlugs(edit.doorHtml);
    return sectionPages.filter((p) => !p.slug || !refs.has(p.slug));
  }, [edit?.doorHtml, edit?.doorMode, sectionPages]);  // eslint-disable-line react-hooks/exhaustive-deps
  /** 扉HTMLが参照しているのに存在しない slug */
  const unknownSlugs = useMemo(() => {
    if (!edit) return [];
    const have = new Set(sectionPages.map((p) => p.slug).filter(Boolean));
    return Array.from(referencedSlugs(edit.doorHtml)).filter((s) => !have.has(s));
  }, [edit?.doorHtml, sectionPages]);  // eslint-disable-line react-hooks/exhaustive-deps

  // プレビューを初めて開いたときだけ、本数の実データを取りに行く
  useEffect(() => {
    if (!preview || counts) return;
    (async () => {
      try {
        const { contents } = await fetchContentData();
        const m = new Map<number, number>();
        for (const c of contents) if (c.published) m.set(c.pageId, (m.get(c.pageId) ?? 0) + 1);
        setCounts(m);
      } catch (e) { console.error("プレビュー用データ取得エラー:", e); setCounts(new Map()); }
    })();
  }, [preview, counts]);

  const move = async (idx: number, dir: number) => {
    const to = idx + dir;
    if (to < 0 || to >= sorted.length) return;
    const arr = [...sorted];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    const updates = arr.map((s, i) => ({ id: s.id, sortOrder: i }));
    setSections((prev) => prev.map((s) => { const u = updates.find((x) => x.id === s.id); return u ? { ...s, sortOrder: u.sortOrder } : s; }));
    await saveSectionOrder(updates);
    onChanged?.();
  };

  const togglePub = async (s: ContentSection) => {
    await setSectionPublished(s.id, !s.published);
    setSections((prev) => prev.map((x) => x.id === s.id ? { ...x, published: !x.published } : x));
    onChanged?.();
  };

  const doSave = async () => {
    if (!edit) return;
    if (!edit.name.trim()) { toast.error("セクション名を入力してください"); return; }
    if (!publishAll && edit.attrIds.length === 0) { toast.error("公開対象の属性を指定するか「全員に公開」にしてください"); return; }
    if (edit.doorHtml.length > DOOR_HTML_MAX) {
      toast.error(`扉ページHTMLが大きすぎます（${edit.doorHtml.length.toLocaleString()}字／上限 ${DOOR_HTML_MAX.toLocaleString()}字）`);
      return;
    }
    const res = await saveSection(edit);
    if (res.id == null) { toast.error(res.error ?? "保存できませんでした"); return; }

    // 除去が起きていたら、何がなぜ落ちたかを運営へ伝える（保存自体はブロックしない）
    const removed = doorCheck ? describeDoorSanitize(doorCheck.info) : [];
    if (removed.length) toast.error(`保存しましたが一部を除去しました：${removed[0]}`);
    else toast.success("保存しました");

    setEdit(null);
    await reload();
  };

  const doDelete = async () => {
    if (!edit || !edit.id) return;
    if (edit.isDefault) { toast.error("既定セクションは削除できません"); return; }
    const n = pageCount(edit.id);
    const ok = await confirm({
      title: "セクションを削除",
      message: n > 0
        ? `このセクションには ${n} 件のページが所属しています。削除するとサイドバーから消えます（ページは残りますが、別セクションへ移すまで会員から見えなくなります）。よろしいですか？`
        : "このセクションを削除します。よろしいですか？",
      confirmLabel: "削除する", danger: true,
    });
    if (!ok) return;
    const res = await deleteSection(edit.id);
    if (!res.ok) { toast.error(res.error ?? "削除できませんでした"); return; }
    toast.success("削除しました");
    setEdit(null);
    await reload();
  };

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="grid" size={18} /></span>
        <p className="leading-relaxed m-0">
          <b className="text-red-600">セクション</b>＝会員ポータルの「コンテンツ入口」です。増やすとサイドバーに入口（コンテンツ2・3…）が増えます。
          各ページは「ページ管理」→ページ編集の<b>所属セクション</b>で振り分けます。
        </p>
      </div>

      <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
          <span className="text-sm font-bold text-gray-700">セクション一覧</span>
          <span className="flex-1" />
          <button onClick={() => openEdit(newSection(sections.length))}
            className="inline-flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700">
            <span className="text-base leading-none">＋</span>セクションを追加
          </button>
        </div>

        {sorted.length === 0 ? (
          <div className="text-center text-gray-300 py-12 text-sm">セクションがありません</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {sorted.map((s, i) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} disabled={i === 0}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[11px] leading-none">▲</button>
                  <button onClick={() => move(i, 1)} disabled={i === sorted.length - 1}
                    className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[11px] leading-none mt-0.5">▼</button>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-800 truncate">{s.name || "（無題）"}</span>
                    {s.isDefault && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">既定</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-gray-400">{pageCount(s.id)}ページ</span>
                    <AttrChips index={index} ids={s.attrIds} mode={s.attrIds.length ? s.attrMode : undefined} emptyLabel="全員" />
                  </div>
                </div>
                {/* 公開トグル */}
                <button onClick={() => togglePub(s)} title={s.published ? "公開中" : "非公開"}
                  className={`relative w-10 h-[21px] rounded-full shrink-0 ${s.published ? "bg-green-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${s.published ? "left-[21px]" : "left-0.5"}`} />
                </button>
                <button onClick={() => openEdit(s)}
                  className="text-sm font-semibold px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">編集</button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 編集モーダル */}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center bg-black/40 p-4" onClick={() => setEdit(null)}>
          <div className={`bg-white rounded-2xl w-full max-h-[88vh] flex flex-col shadow-2xl transition-[max-width] ${tab === "door" ? "max-w-5xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-100">
              <span className="text-base font-bold">{edit.id ? "セクションを編集" : "セクションを追加"}</span>
              <span className="flex-1" />
              <button onClick={() => setEdit(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* タブ（扉ページは保存済みセクションのみ。新規は先に保存させる） */}
            <div className="flex px-5 border-b border-gray-100">
              {([["basic", "基本情報・公開対象"], ["door", "扉ページ"]] as const).map(([v, l]) => (
                <button key={v} onClick={() => { if (v === "door" && !edit.id) { toast.error("先に保存してから扉ページを設定してください"); return; } setTab(v); }}
                  className={`px-4 py-2.5 text-sm border-b-2 -mb-px ${tab === v ? "border-red-600 text-red-700 font-bold" : "border-transparent text-gray-500 hover:text-gray-700"} ${v === "door" && !edit.id ? "opacity-40" : ""}`}>
                  {l}
                </button>
              ))}
            </div>

            {tab === "door" ? (
              <DoorEditor
                edit={edit} setEdit={setEdit}
                sectionPages={sectionPages}
                doorCheck={doorCheck}
                missingPages={missingPages}
                unknownSlugs={unknownSlugs}
                preview={preview} setPreview={setPreview}
                counts={counts}
                canAi={can("ai_html")}
                onApplyAi={applyAiDoor}
                aiUndo={doorUndo}
                onUndoAi={undoAiDoor}
              />
            ) : (
            <div className="px-5 py-4 space-y-4 overflow-y-auto">
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">セクション名（日本語）<span className="text-red-500">*</span> <span className="text-gray-400 font-normal">サイドバー下段・ハブ見出しに表示</span></label>
                <input className={input} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="例：講座 / 特典 / コンテンツ2" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">セクション名（英語）<span className="text-gray-400 font-normal">任意・サイドバー上段に表示。未設定なら "Content"</span></label>
                <input className={input} value={edit.nameEn} onChange={(e) => setEdit({ ...edit, nameEn: e.target.value })} placeholder="例：Course / Bonus / Content" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">概要 <span className="text-gray-400 font-normal">任意・ハブ上部に表示</span></label>
                <textarea className={`${input} min-h-[64px]`} value={edit.overview} onChange={(e) => setEdit({ ...edit, overview: e.target.value })} placeholder="この入口の説明（例：受講生向けの講座をまとめています）" />
              </div>

              <div>
                <label className="text-xs font-bold text-gray-500 block mb-1">公開対象 <span className="text-gray-400 font-normal">この入口を誰に見せるか</span></label>
                <label className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 cursor-pointer transition-colors ${publishAll ? "border-emerald-300 bg-emerald-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}>
                  <input type="checkbox" className="mt-0.5 w-4 h-4 accent-emerald-600" checked={publishAll}
                    onChange={(e) => { const on = e.target.checked; setPublishAll(on); if (on) setEdit({ ...edit, attrIds: [] }); }} />
                  <span className="min-w-0">
                    <span className={`text-sm font-bold ${publishAll ? "text-emerald-800" : "text-gray-700"}`}>全員に公開する</span>
                    <span className={`block text-[11px] leading-relaxed mt-0.5 ${publishAll ? "text-emerald-700" : "text-gray-500"}`}>属性の指定なしで、全会員のサイドバーに入口を出します。</span>
                  </span>
                </label>
                {!publishAll && (
                  <div className="mt-2.5">
                    <AttrTable tree={tree} index={index} value={edit.attrIds}
                      onChange={(ids) => setEdit({ ...edit, attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
                    <div className="mt-2">
                      <label className="text-[11px] font-bold text-gray-500 block mb-1">公開条件</label>
                      <select className={`${input} bg-white`} value={edit.attrMode} onChange={(e) => setEdit({ ...edit, attrMode: e.target.value as PublishMode })}>
                        {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
                      </select>
                    </div>
                    {edit.attrIds.length === 0 && (
                      <p className="text-[11px] text-red-600 mt-1.5">⚠ 属性を1つ以上指定するか、「全員に公開する」にチェックしてください</p>
                    )}
                  </div>
                )}
              </div>

              {edit.isDefault && (
                <p className="text-[11px] text-gray-400">これは既定セクションです（削除不可。所属セクション未設定のページの受け皿になります）。</p>
              )}
            </div>
            )}
            <div className="flex items-center gap-3 px-5 py-4 border-t border-gray-100">
              {edit.id && !edit.isDefault ? (
                <button onClick={doDelete} className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50">削除</button>
              ) : null}
              <div className="flex-1" />
              <button onClick={() => setEdit(null)} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <SaveButton onSave={doSave} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
