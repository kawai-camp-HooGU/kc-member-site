"use client";
// ============================================================
// ホーム設定（運営）— REQ-094
//
//   会員ホームのブロックを運営が組む画面。
//   ホームは2枚ある：メンバー用 と 外部用。上のタブで切り替えて、それぞれ別に組む。
//   1ブロックは必ずどちらか一方に属する（"両方" は無い）。
//
//   ・並べ替えは ▲▼（既存の SectionManager と同じ操作。ドラッグは導入しない）
//   ・公開ON/OFF は即時保存
//   ・公開対象属性は既存の AttrTable / canView 方式
//   ・掲載期間つき（ヒーロー・自由HTML・手動の棚は期限が必須）
//
//   ⚠️ 「表示する相手」はブロックの設定ではなくタブそのもの。
//      これはアクセス権の分離ではないので、その旨を画面にも出す。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  fetchHomeBlocks, saveHomeBlock, deleteHomeBlock, setHomeBlockPublished,
  saveHomeBlockOrder, copyHomeBlocks, newHomeBlock, needsDeadline, daysLeft,
} from "../../lib/homeBlocks";
import { fetchContentData, fetchContentSections, toImageUrl } from "../../lib/contents";
import { sanitizeDoorHtml, describeDoorSanitize, DOOR_HTML_MAX } from "../../lib/ai/sanitizeDoor";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { AttrTable } from "../master/AttrTable";
import { AttrChips } from "../master/AttrChips";
import { Icon } from "../common/Icon";
import { SaveButton } from "../common/SaveButton";
import { useConfirm } from "../common/ConfirmProvider";
import { useToast } from "../common/ToastProvider";
import { FIELD_INPUT, DANGER_CONFIG } from "../../lib/constants";
import { errMessage } from "../../lib/errors";
import type { AttrNode } from "../../lib/attributes";
import type {
  HomeBlock, HomeAudience, HomeBlockKind, PublishMode,
  ContentPage, ContentSection, CmsContent,
} from "../../lib/models";
import { HOME_AUDIENCE_LABEL, HOME_KIND_LABEL, HOME_KIND_DEFAULT_TITLE } from "../../lib/models";

const input = FIELD_INPUT;

const MODES: { v: PublishMode; l: string }[] = [
  { v: "any",   l: "選択したタグをいずれか1つ以上含む" },
  { v: "all",   l: "選択したタグをすべて含む" },
  { v: "exany", l: "いずれか1つ以上含む人を除外" },
  { v: "exall", l: "すべて含む人を除外" },
];

/** 追加できるブロックの並び（運営画面での提示順） */
const ADDABLE: HomeBlockKind[] =
  ["hero", "shelf", "continue", "ranking", "launcher", "news", "event", "html"];

/** 1枚のホームに置けるブロックの上限（UI で止めるだけ。DB には制約を入れない） */
const MAX_BLOCKS = 12;

const AUDIENCES: HomeAudience[] = ["member", "external"];

export function HomeManager({ onChanged }: { onChanged?: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();

  const [audience, setAudience] = useState<HomeAudience>("member");
  const [blocks, setBlocks] = useState<HomeBlock[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [sections, setSections] = useState<ContentSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [edit, setEdit] = useState<HomeBlock | null>(null);
  const [publishAll, setPublishAll] = useState(false);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);

  const reload = async (): Promise<void> => {
    try {
      setLoadError("");
      const b = await fetchHomeBlocks();
      setBlocks(b);
    } catch (e) {
      setBlocks([]);
      setLoadError(errMessage(e, "ホームのブロックを取得できませんでした"));
    }
  };

  useEffect(() => {
    (async () => {
      const [t, cd, sec] = await Promise.allSettled([
        loadAttributeTree(), fetchContentData(), fetchContentSections(),
      ]);
      if (t.status === "fulfilled") setTree(t.value);
      if (cd.status === "fulfilled") { setPages(cd.value.pages); setContents(cd.value.contents); }
      if (sec.status === "fulfilled") setSections(sec.value);
      await reload();
      setLoading(false);
    })();
  }, []);

  const ofAudience = (a: HomeAudience): HomeBlock[] =>
    blocks.filter((b) => b.audience === a).sort((x, y) => x.sortOrder - y.sortOrder || x.id - y.id);
  const sorted = useMemo(() => ofAudience(audience), [blocks, audience]);
  const publishedCount = (a: HomeAudience): number =>
    blocks.filter((b) => b.audience === a && b.published).length;

  // ── 並べ替え（▲▼。押した時点で保存する）───────────────
  const move = async (i: number, dir: number): Promise<void> => {
    const to = i + dir;
    if (to < 0 || to >= sorted.length) return;
    const arr = [...sorted];
    [arr[i], arr[to]] = [arr[to], arr[i]];
    const updates = arr.map((b, n) => ({ id: b.id, sortOrder: n }));
    setBlocks((prev) => prev.map((b) => {
      const u = updates.find((x) => x.id === b.id);
      return u ? { ...b, sortOrder: u.sortOrder } : b;
    }));
    try { await saveHomeBlockOrder(updates); onChanged?.(); }
    catch (e) { toast.error(errMessage(e, "並び順を保存できませんでした")); await reload(); }
  };

  // ── 公開ON/OFF（即時保存）──────────────────────────────
  const togglePub = async (b: HomeBlock): Promise<void> => {
    // ONにするときだけ、会員全員のホームが変わることを知らせる（誤爆させない）
    if (!b.published) {
      const ok = await confirm({
        title: "このブロックを公開しますか",
        message: `${HOME_AUDIENCE_LABEL[b.audience]}ホームに表示されます。`,
        confirmLabel: "公開する",
      });
      if (!ok) return;
    }
    try {
      await setHomeBlockPublished(b.id, !b.published);
      setBlocks((prev) => prev.map((x) => (x.id === b.id ? { ...x, published: !x.published } : x)));
      onChanged?.();
    } catch (e) { toast.error(errMessage(e, "公開状態を変更できませんでした")); }
  };

  // ── 追加・保存・削除 ─────────────────────────────────
  const add = (kind: HomeBlockKind): void => {
    if (sorted.length >= MAX_BLOCKS) {
      toast.error(`1枚のホームに置けるブロックは ${MAX_BLOCKS} 件までです`);
      return;
    }
    setEdit(newHomeBlock(kind, audience, sorted.length, HOME_KIND_DEFAULT_TITLE[kind]));
    setPublishAll(true);
  };

  const openEdit = (b: HomeBlock): void => {
    setEdit({ ...b });
    setPublishAll(!!b.id && b.attrIds.length === 0);
  };

  const doSave = async (): Promise<void> => {
    if (!edit) return;
    // 公開対象は「全員」か「属性1つ以上」のどちらか必須（既存のページ／コンテンツと同じ作法）
    if (!publishAll && edit.attrIds.length === 0) {
      toast.error("属性を1つ以上指定するか、「全員に公開する」にチェックしてください");
      return;
    }
    if (needsDeadline(edit) && !edit.displayUntil) {
      toast.error("この種類のブロックは掲載終了日が必須です");
      return;
    }
    if (edit.kind === "html" && edit.bodyHtml.length > DOOR_HTML_MAX) {
      toast.error(`HTMLが長すぎます（${DOOR_HTML_MAX} 文字まで）`);
      return;
    }
    const body = edit.kind === "html" ? sanitizeDoorHtml(edit.bodyHtml) : null;

    const r = await saveHomeBlock({ ...edit, attrIds: publishAll ? [] : edit.attrIds });
    if (r.id == null) { toast.error(r.error); return; }

    if (body) {
      const msgs = describeDoorSanitize(body.info);
      if (msgs.length) toast.error(`保存しましたが、一部を除去しました：${msgs.join(" / ")}`);
    }
    toast.success("保存しました");
    setEdit(null);
    await reload();
    onChanged?.();
  };

  const doDelete = async (): Promise<void> => {
    if (!edit || edit.id <= 0) { setEdit(null); return; }
    const ok = await confirm({
      title: "このブロックを削除しますか",
      message: "会員のホームから消えます。あとから戻すことはできません。",
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteHomeBlock(edit.id);
      toast.success("削除しました");
      setEdit(null);
      await reload();
      onChanged?.();
    } catch (e) { toast.error(errMessage(e, "削除できませんでした")); }
  };

  const doCopy = async (): Promise<void> => {
    const to: HomeAudience = audience === "member" ? "external" : "member";
    const ok = await confirm({
      title: `${HOME_AUDIENCE_LABEL[to]}ホームへコピーしますか`,
      message: `${HOME_AUDIENCE_LABEL[audience]}ホームのブロックを ${HOME_AUDIENCE_LABEL[to]}ホームの末尾に複製します。`
        + "1回きりの複製で、以後は自動で同期しません。",
      confirmLabel: "コピーする",
    });
    if (!ok) return;
    try {
      const n = await copyHomeBlocks(audience, to);
      toast.success(`${n} 件コピーしました`);
      await reload();
      onChanged?.();
    } catch (e) { toast.error(errMessage(e, "コピーできませんでした")); }
  };

  // ── 描画 ──────────────────────────────────────────────
  if (loading) return <div className="text-sm text-gray-400 py-10 text-center">…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="home" size={18} /></span>
        <p className="leading-relaxed m-0">
          会員ホームに出すものを組みます。ホームは<b className="text-red-600">メンバー用</b>と
          <b className="text-red-600">外部用</b>の2枚で、それぞれ別の並びです。
          <b>これは表示の出し分けであって、コンテンツ自体の公開範囲ではありません</b>
          （URLを知っていれば開けます。見せたくないものは公開対象属性で弾いてください）。
        </p>
      </div>

      {loadError && (
        <div className="rounded-lg border border-red-200 bg-red-50 text-red-700 text-sm font-bold px-4 py-2.5">
          {loadError}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 items-start lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* ── 左：タブ＋ブロックの並び ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-3">
          <div className="flex border-b-2 border-gray-200 mb-3">
            {AUDIENCES.map((a) => {
              const on = audience === a;
              const n = publishedCount(a);
              return (
                <button key={a} type="button" onClick={() => { setAudience(a); setEdit(null); }}
                  className={`relative px-3.5 pt-2 pb-2.5 -mb-0.5 text-[13px] font-bold whitespace-nowrap
                              border-b-2 transition-colors
                              ${on ? "text-red-700 border-red-700" : "text-gray-400 border-transparent hover:text-gray-600"}`}>
                  {HOME_AUDIENCE_LABEL[a]}
                  <span className="ml-1.5 text-[11px] font-bold text-gray-400">{ofAudience(a).length}</span>
                  {n === 0 && (
                    <span className="ml-1.5 inline-block rounded-full bg-red-600 text-white
                                     text-[10px] font-black px-1.5 py-px align-middle">公開0</span>
                  )}
                </button>
              );
            })}
          </div>

          <p className="text-[11px] font-bold text-gray-400 tracking-wider m-0 mb-2">
            {HOME_AUDIENCE_LABEL[audience]}ホームのブロック
          </p>

          {publishedCount(audience) === 0 && (
            <p className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-2">
              公開中のブロックが1件もありません。この状態だと
              {HOME_AUDIENCE_LABEL[audience]}のホームは空になります。
            </p>
          )}

          {sorted.length === 0 ? (
            <p className="text-[13px] text-gray-400 text-center py-6 m-0">ブロックがありません</p>
          ) : sorted.map((b, i) => {
            const left = daysLeft(b);
            const on = edit?.id === b.id;
            return (
              <div key={b.id}
                className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 mb-1.5 cursor-pointer
                            ${on ? "border-red-600 bg-red-50" : "border-gray-200 bg-white hover:border-gray-300"}`}
                onClick={() => openEdit(b)}>
                <span className="flex flex-col shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button type="button" aria-label="上へ" onClick={() => move(i, -1)}
                    className="text-gray-300 hover:text-gray-600 leading-none text-[10px]">▲</button>
                  <button type="button" aria-label="下へ" onClick={() => move(i, 1)}
                    className="text-gray-300 hover:text-gray-600 leading-none text-[10px]">▼</button>
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-bold text-gray-800 leading-snug">
                    {b.title || HOME_KIND_LABEL[b.kind]}
                    {left != null && (
                      <span className={`ml-1.5 text-[11px] font-bold ${left <= 3 ? "text-red-600" : "text-gray-400"}`}>
                        {left >= 0 ? `残り${left}日` : "掲載終了"}
                      </span>
                    )}
                  </span>
                  <span className="block text-[11px] text-gray-400 font-mono">{b.kind}</span>
                </span>
                <button type="button" aria-label="公開切替"
                  onClick={(e) => { e.stopPropagation(); void togglePub(b); }}
                  className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors
                              ${b.published ? "bg-red-600" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-all
                                    ${b.published ? "right-0.5" : "left-0.5"}`} />
                </button>
              </div>
            );
          })}

          <div className="flex gap-1.5 flex-wrap pt-2.5 mt-2 border-t border-dashed border-gray-200">
            {ADDABLE.map((k) => (
              <button key={k} type="button" onClick={() => add(k)}
                className="text-[11px] font-bold text-red-700 bg-white border border-red-200
                           rounded-md px-2.5 py-1 hover:bg-red-50">
                ＋ {HOME_KIND_LABEL[k]}
              </button>
            ))}
          </div>
          <button type="button" onClick={doCopy}
            className="mt-2.5 text-[11px] font-bold text-gray-600 bg-white border border-gray-200
                       rounded-md px-2.5 py-1.5 hover:bg-gray-50">
            {audience === "member" ? "外部用" : "メンバー用"}へこの構成をコピー
          </button>
        </div>

        {/* ── 右：選択中ブロックの設定 ── */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          {!edit ? (
            <p className="text-[13px] text-gray-400 text-center py-16 m-0">
              左でブロックを選ぶか、追加してください
            </p>
          ) : (
            <BlockEditor
              edit={edit} setEdit={setEdit}
              publishAll={publishAll} setPublishAll={setPublishAll}
              tree={tree} index={index}
              pages={pages} contents={contents} sections={sections}
              onSave={doSave} onDelete={doDelete}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── ブロック1件の設定フォーム ─────────────────────────────
interface EditorProps {
  edit: HomeBlock;
  setEdit: (b: HomeBlock) => void;
  publishAll: boolean;
  setPublishAll: (v: boolean) => void;
  tree: AttrNode[];
  index: ReturnType<typeof buildAttrIndex>;
  pages: ContentPage[];
  contents: CmsContent[];
  sections: ContentSection[];
  onSave: () => Promise<void>;
  onDelete: () => Promise<void>;
}

function BlockEditor({
  edit, setEdit, publishAll, setPublishAll, tree, index,
  pages, contents, sections, onSave, onDelete,
}: EditorProps) {
  const set = (patch: Partial<HomeBlock>): void => setEdit({ ...edit, ...patch });
  const setCfg = (patch: Partial<HomeBlock["config"]>): void =>
    setEdit({ ...edit, config: { ...edit.config, ...patch } });

  const usesSource = ["hero", "shelf"].includes(edit.kind);
  const usesLimit = ["continue", "shelf", "ranking", "news", "event"].includes(edit.kind);
  const usesMore = ["continue", "shelf", "ranking"].includes(edit.kind);
  const usesRail = ["news", "event"].includes(edit.kind);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap mb-1">
        <span className="text-[11px] font-bold text-gray-500 bg-gray-100 rounded-full px-2.5 py-0.5">
          {HOME_AUDIENCE_LABEL[edit.audience]}ホーム
        </span>
        <b className="text-[15px] text-gray-900">{edit.title || HOME_KIND_LABEL[edit.kind]}</b>
        <span className="text-[11px] font-mono text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">
          {edit.kind}
        </span>
      </div>

      <Field label="見出し（空にすると見出しを出さない）">
        <input className={`${input} w-full`} value={edit.title}
          onChange={(e) => set({ title: e.target.value })} />
      </Field>

      {edit.kind === "hero" && (
        <>
          <Field label="小見出し（画像の左上に出す赤いラベル。空なら「トピック」）">
            <input className={`${input} w-full`} value={edit.config.kicker ?? ""}
              placeholder="トピック" onChange={(e) => setCfg({ kicker: e.target.value })} />
          </Field>
          <Field label="説明文（スマホでは表示しません）">
            <textarea className={`${input} w-full h-16`} value={edit.config.lead ?? ""}
              onChange={(e) => setCfg({ lead: e.target.value })} />
          </Field>
          <Field label="ボタンの文言">
            <input className={`${input} w-full`} value={edit.config.ctaLabel ?? ""}
              placeholder="見る" onChange={(e) => setCfg({ ctaLabel: e.target.value })} />
          </Field>
          <Field label="背景画像のURL（空なら対象のサムネイルを使います）">
            <input className={`${input} w-full`} value={edit.config.imageUrl ?? ""}
              onChange={(e) => setCfg({ imageUrl: e.target.value })} />
          </Field>
          <HeroFocus edit={edit} setCfg={setCfg} contents={contents} />
        </>
      )}

      {usesSource && (
        <Field label="並べる元">
          <select className={`${input} w-full bg-white`} value={edit.sourceMode}
            onChange={(e) => set({
              sourceMode: e.target.value as HomeBlock["sourceMode"],
              sourceSectionId: null, sourcePageId: null, sourceContentId: null, contentIds: [],
            })}>
            <option value="auto">自動（{edit.kind === "hero" ? "未視聴の先頭1件" : "新着順"}）</option>
            <option value="section">セクションを指定</option>
            <option value="page">ページを指定</option>
            {edit.kind === "hero" && <option value="content">コンテンツを1件指定</option>}
            {edit.kind === "shelf" && <option value="manual">手動で選ぶ</option>}
          </select>
        </Field>
      )}

      {usesSource && edit.sourceMode === "section" && (
        <Field label="セクション">
          <select className={`${input} w-full bg-white`} value={edit.sourceSectionId ?? ""}
            onChange={(e) => set({ sourceSectionId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">選択してください</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}
      {usesSource && edit.sourceMode === "page" && (
        <Field label="ページ">
          <select className={`${input} w-full bg-white`} value={edit.sourcePageId ?? ""}
            onChange={(e) => set({ sourcePageId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">選択してください</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      )}
      {edit.kind === "hero" && edit.sourceMode === "content" && (
        <Field label="コンテンツ">
          <select className={`${input} w-full bg-white`} value={edit.sourceContentId ?? ""}
            onChange={(e) => set({ sourceContentId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">選択してください</option>
            {contents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {edit.kind === "shelf" && edit.sourceMode === "manual" && (
        <Field label="並べるコンテンツ（選んだ順に並びます）">
          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg p-2">
            {contents.map((c) => {
              const at = edit.contentIds.indexOf(c.id);
              return (
                <label key={c.id} className="flex items-center gap-2 text-[13px] py-0.5 cursor-pointer">
                  <input type="checkbox" checked={at >= 0} onChange={() => set({
                    contentIds: at >= 0
                      ? edit.contentIds.filter((x) => x !== c.id)
                      : [...edit.contentIds, c.id],
                  })} />
                  <span className="truncate">{c.name}</span>
                  {at >= 0 && <span className="ml-auto text-[11px] font-bold text-red-600">{at + 1}</span>}
                </label>
              );
            })}
          </div>
        </Field>
      )}

      {["continue", "ranking"].includes(edit.kind) && (
        <Field label="対象セクションで絞る（任意）">
          <select className={`${input} w-full bg-white`}
            value={edit.sourceMode === "section" ? (edit.sourceSectionId ?? "") : ""}
            onChange={(e) => set(
              e.target.value
                ? { sourceMode: "section", sourceSectionId: Number(e.target.value) }
                : { sourceMode: "auto" as const, sourceSectionId: null },
            )}>
            <option value="">絞らない（すべてのセクション）</option>
            {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
      )}

      {edit.kind === "ranking" && (
        <Field label="集計期間">
          <select className={`${input} bg-white`} value={edit.config.period ?? "week"}
            onChange={(e) => setCfg({ period: e.target.value === "month" ? "month" : "week" })}>
            <option value="week">今週（月曜起点）</option>
            <option value="month">今月</option>
          </select>
          <span className="ml-2 text-[12px] text-gray-500">
            期間内に見た<b>人数</b>で並べます（同じ人が何回見ても1人）
          </span>
        </Field>
      )}

      {usesLimit && (
        <Field label="表示件数">
          <input type="number" min={1} max={20} className={`${input} w-24`}
            value={edit.config.limit ?? (edit.kind === "ranking" ? 5 : edit.kind === "news" ? 5 : edit.kind === "event" ? 1 : 8)}
            onChange={(e) => setCfg({ limit: Number(e.target.value) || undefined })} />
        </Field>
      )}

      {usesMore && (
        <Field label="「すべて見る」を出す">
          <select className={`${input} bg-white`} value={(edit.config.showMore ?? true) ? "1" : "0"}
            onChange={(e) => setCfg({ showMore: e.target.value === "1" })}>
            <option value="1">出す</option>
            <option value="0">出さない</option>
          </select>
        </Field>
      )}

      {usesRail && (
        <Field label="置き場所">
          <select className={`${input} w-full bg-white`} value={edit.config.rail ? "rail" : "main"}
            onChange={(e) => setCfg({ rail: e.target.value === "rail" })}>
            <option value="main">本文（左）</option>
            <option value="rail">右レール</option>
          </select>
        </Field>
      )}

      {edit.kind === "html" && (
        <Field label={`HTML（${DOOR_HTML_MAX} 文字まで。危険なタグは保存時に除去します）`}>
          <textarea className={`${input} w-full h-40 font-mono text-[12px]`} value={edit.bodyHtml}
            onChange={(e) => set({ bodyHtml: e.target.value })} />
        </Field>
      )}

      <Field label={`掲載期間${needsDeadline(edit) ? "（この種類は終了日が必須です）" : "（任意）"}`}>
        <div className="flex items-center gap-2 flex-wrap">
          <input type="datetime-local" className={input} value={edit.displayFrom}
            onChange={(e) => set({ displayFrom: e.target.value })} />
          <span className="text-gray-400">〜</span>
          <input type="datetime-local" className={input} value={edit.displayUntil}
            onChange={(e) => set({ displayUntil: e.target.value })} />
        </div>
        <p className="text-[12px] text-gray-500 mt-1 m-0">
          終了日を過ぎると、会員側のホームから自動で降ります。
        </p>
      </Field>

      <Field label="公開対象">
        <label className="flex items-center gap-2 text-[13px] font-bold text-gray-700 mb-2 cursor-pointer">
          <input type="checkbox" checked={publishAll}
            onChange={(e) => setPublishAll(e.target.checked)} />
          全員に公開する
        </label>
        {!publishAll && (
          <>
            <AttrTable tree={tree} index={index} value={edit.attrIds}
              onChange={(ids) => set({ attrIds: ids })} addLabel="＋ 公開対象の属性を追加" />
            <div className="mt-2">
              <label className="text-[12px] font-bold text-gray-500 block mb-1">公開条件</label>
              <select className={`${input} bg-white`} value={edit.attrMode}
                onChange={(e) => set({ attrMode: e.target.value as PublishMode })}>
                {MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}
              </select>
            </div>
            {edit.attrIds.length === 0 && (
              <p className="text-[12px] text-red-600 mt-1.5 m-0">
                属性を1つ以上指定するか、「全員に公開する」にチェックしてください
              </p>
            )}
          </>
        )}
        {publishAll && <AttrChips index={index} ids={[]} emptyLabel="全員" />}
      </Field>

      <div className="flex items-center gap-2 pt-2">
        <SaveButton onSave={onSave} />
        {edit.id > 0 && (
          <button type="button" onClick={onDelete}
            className={`text-sm py-2 px-4 rounded-lg ${DANGER_CONFIG.outlineBtn}`}>
            このブロックを削除
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * ヒーロー画像の「どこを見せるか」を決める。
 *
 *   会員側は高さ固定＋cover なので、画像は必ず切り抜かれる。
 *   どこが切れるかを文字で説明するのは無理なので、
 *   実物と同じ比率のプレビューを出して、運営が目で合わせられるようにする。
 *
 *   ⚠️ プレビューの高さ・backgroundSize・backgroundPosition は
 *      HeroBlock.tsx と必ず同じにすること。ここがずれると調整が無意味になる。
 */
function HeroFocus({
  edit, setCfg, contents,
}: {
  edit: HomeBlock;
  setCfg: (patch: Partial<HomeBlock["config"]>) => void;
  contents: CmsContent[];
}) {
  // 運営が URL を入れていればそれ、無ければ指定コンテンツのサムネイル
  const target = edit.sourceContentId != null
    ? contents.find((c) => c.id === edit.sourceContentId)
    : undefined;
  const img = toImageUrl(edit.config.imageUrl || target?.thumbUrl || "");

  const fx = edit.config.focusX ?? 50;
  const fy = edit.config.focusY ?? 50;

  /** 3×3 のよく使う位置。ラベルは日本語にする（brand.md §3） */
  const PRESETS: { label: string; x: number; y: number }[] = [
    { label: "左上", x: 0,   y: 0   }, { label: "上",   x: 50,  y: 0   }, { label: "右上", x: 100, y: 0   },
    { label: "左",   x: 0,   y: 50  }, { label: "中央", x: 50,  y: 50  }, { label: "右",   x: 100, y: 50  },
    { label: "左下", x: 0,   y: 100 }, { label: "下",   x: 50,  y: 100 }, { label: "右下", x: 100, y: 100 },
  ];

  return (
    <Field label="画像の見せる位置（会員側は高さを固定して切り抜きます）">
      {!img ? (
        <p className="text-[13px] text-gray-400 m-0">
          画像URLを入れるか、コンテンツを指定するとプレビューが出ます。
        </p>
      ) : (
        <>
          {/* 会員側のヒーローと同じ見え方。文字の位置まで合わせて、隠れる範囲が分かるようにする */}
          <div className="relative overflow-hidden rounded-xl border border-gray-200
                          min-h-[160px] sm:min-h-[200px] flex items-end px-4 py-3 text-white"
            style={{
              backgroundImage:
                `linear-gradient(180deg,rgba(10,10,12,.15) 0%,rgba(10,10,12,.66) 55%,rgba(10,10,12,.90) 100%), url("${img.replace(/"/g, "%22")}")`,
              backgroundSize: "cover",
              backgroundPosition: `${fx}% ${fy}%`,
            }}>
            <span className="relative z-10">
              <span className="inline-block rounded bg-red-600 text-white text-[10px] font-black
                               tracking-widest px-2 py-0.5 mb-1.5">
                {edit.config.kicker || "トピック"}
              </span>
              <span className="block text-[17px] font-black leading-snug"
                style={{ textShadow: "0 2px 14px rgba(0,0,0,.35)" }}>
                {edit.title || "（見出し）"}
              </span>
              <span className="inline-block mt-2 rounded-lg bg-white text-red-700
                               text-[12px] font-black px-4 py-1.5">
                {edit.config.ctaLabel || "見る"}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 mt-2.5 items-start">
            <div className="space-y-2">
              <label className="block">
                <span className="text-[12px] font-bold text-gray-500">
                  横位置 <span className="tabular-nums text-gray-700">{fx}%</span>
                  <span className="ml-1.5 text-gray-400">（0＝左端 / 100＝右端）</span>
                </span>
                <input type="range" min={0} max={100} step={1} value={fx} className="w-full accent-red-600"
                  onChange={(e) => setCfg({ focusX: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="text-[12px] font-bold text-gray-500">
                  縦位置 <span className="tabular-nums text-gray-700">{fy}%</span>
                  <span className="ml-1.5 text-gray-400">（0＝上端 / 100＝下端）</span>
                </span>
                <input type="range" min={0} max={100} step={1} value={fy} className="w-full accent-red-600"
                  onChange={(e) => setCfg({ focusY: Number(e.target.value) })} />
              </label>
            </div>

            {/* よく使う位置。細かく合わせたいときは上のスライダーで */}
            <div className="grid grid-cols-3 gap-1 shrink-0">
              {PRESETS.map((p) => {
                const on = fx === p.x && fy === p.y;
                return (
                  <button key={p.label} type="button" title={p.label}
                    onClick={() => setCfg({ focusX: p.x, focusY: p.y })}
                    className={`w-11 h-8 rounded border text-[11px] font-bold transition-colors
                                ${on ? "border-red-600 bg-red-50 text-red-700"
                                     : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50"}`}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </Field>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[12px] font-bold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  );
}
