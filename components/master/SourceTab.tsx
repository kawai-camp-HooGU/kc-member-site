"use client";
// ============================================================
// 設定 ＞ 流入経路（Phase 3：新設）
//
//   BEFORE：経路の定義は「設定 ＞ 初回メッセージ」タブの中の JSON 配列だった。
//           経路を1つ増やしたいだけなのにメッセージ設定を開く必要があり、
//           経路が第一級の概念になっていなかった。
//
//   AFTER ：ここが経路マスタ。初回メッセージ・一斉配信・シナリオ・フォームは
//           このマスタを参照するだけになる。
//
//   運用のポイント
//     ・「停止」は削除ではない。停止しても既存会員の紐付けは残り、
//       新規付与だけが止まる。削除すると「どこから来た会員か」が失われる。
//     ・経路キーは配布済みの QR / URL に埋め込まれるため、原則不変。
//       名前を変えたい場合は「複製」して新しいキーを作ること。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import type { Source, SourceCategory, FormAction } from "../../lib/models";
import { SOURCE_CATEGORIES, SOURCE_CATEGORY_LABEL, DEFAULT_SOURCE_COLOR } from "../../lib/models";
import {
  fetchSources, fetchSourceCounts, saveSource, deleteSource,
  sourceUrl, sourceLandingUrl, generateSourceKey,
} from "../../lib/sources";
import { loadAttributeTree } from "../../lib/attributes";
import type { AttrNode } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import type { AttrIndex } from "../../lib/members";
import { fetchScenarios } from "../../lib/scenario";
import { ActionEditor } from "../form/ActionEditor";
import type { ScenarioOpt } from "../form/ActionEditor";
import { InlineForm } from "../common/InlineForm";
import { ConfirmDialog } from "../common/ConfirmDialog";
import { useToast } from "../common/ToastProvider";
import { Icon } from "../common/Icon";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

const CAT_STYLE: Record<SourceCategory, string> = {
  ad:       "bg-blue-50 text-blue-600 border-blue-200",
  seminar:  "bg-amber-50 text-amber-700 border-amber-200",
  referral: "bg-violet-50 text-violet-700 border-violet-200",
  sns:      "bg-sky-50 text-sky-700 border-sky-200",
  organic:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  offline:  "bg-gray-100 text-gray-600 border-gray-200",
  other:    "bg-gray-100 text-gray-500 border-gray-200",
};

const EMPTY: Source = {
  id: 0, key: "", label: "", category: "other", landingPath: "/f/",
  utmSource: "", utmMedium: "", utmCampaign: "",
  color: DEFAULT_SOURCE_COLOR, memo: "", isActive: true, sortOrder: 0, createdAt: "",
  actions: [], fireOnce: true,
};

/** 経路キーに使える文字（URL に載るので英数・ハイフン・アンダースコアのみ） */
const KEY_RE = /^[a-z0-9_-]+$/i;

export function SourceTab() {
  const toast = useToast();
  const [list, setList]       = useState<Source[]>([]);
  const [counts, setCounts]   = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [form, setForm]       = useState<Source | null>(null);
  const [confirm, setConfirm] = useState<Source | null>(null);
  /** アクション設定に必要なマスタ（属性ツリー・シナリオ一覧） */
  const [tree, setTree]           = useState<AttrNode[]>([]);
  const [scenarios, setScenarios] = useState<ScenarioOpt[]>([]);
  const attrIndex: AttrIndex = useMemo(() => buildAttrIndex(tree), [tree]);
  /** 新規作成かどうか（キー変更の警告を出し分ける） */
  const isNew = form != null && form.id === 0;

  const load = async () => {
    const [rows, c] = await Promise.all([fetchSources(), fetchSourceCounts()]);
    setList(rows); setCounts(c); setLoading(false);
  };
  useEffect(() => { load().catch(() => setLoading(false)); }, []);
  useEffect(() => {
    loadAttributeTree().then(setTree).catch(() => setTree([]));
    fetchScenarios()
      .then((s) => setScenarios(s.map((x) => ({ id: x.id, name: x.name }))))
      .catch(() => setScenarios([]));
  }, []);

  const siteUrl = useMemo(
    () => (typeof window !== "undefined" ? window.location.origin : ""),
    [],
  );

  const patch = (p: Partial<Source>) => setForm((f) => (f ? { ...f, ...p } : f));

  /** キーは新規作成時に自動発行する（人が考えない）。必要なら画面で書き換えられる。 */
  const openNew = () =>
    setForm({ ...EMPTY, key: generateSourceKey(), sortOrder: (list.at(-1)?.sortOrder ?? 0) + 1 });
  const openEdit = (s: Source) => setForm({ ...s });
  /** 複製：キーは変えられないので「新しい経路として作り直す」導線（キーは新規発行） */
  const duplicate = (s: Source) =>
    setForm({ ...s, id: 0, key: generateSourceKey(), label: `${s.label}（複製）`, sortOrder: (list.at(-1)?.sortOrder ?? 0) + 1 });

  /** 公開 URL をコピー（フォーム内・未保存でも押せる） */
  const copyText = async (text: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(msg);
    } catch {
      toast.error("コピーに失敗しました");
    }
  };

  const valid = (f: Source): string | null => {
    const key = f.key.trim();
    if (!key) return "経路キーは必須です";
    if (!KEY_RE.test(key)) return "経路キーは英数字・ハイフン・アンダースコアのみ使えます（URL に載るため）";
    if (list.some((s) => s.key === key && s.id !== f.id)) return "この経路キーは既に使われています";
    if (!f.label.trim()) return "流入経路名は必須です";
    return null;
  };

  const save = async () => {
    if (!form) return;
    const err = valid(form);
    if (err) { toast.error(err); return; }
    const id = await saveSource(form);
    if (id == null) { toast.error("保存に失敗しました（権限がない可能性があります）"); return; }
    setForm(null);
    await load();
    toast.success("保存しました");
  };

  const remove = async (s: Source) => {
    await deleteSource(s.id);
    setConfirm(null); setForm(null);
    await load();
    toast.success("削除しました（既存会員の紐付けは残ります）");
  };

  const copyUrl = (s: Source) => copyText(sourceUrl(s, siteUrl), "公開 URL をコピーしました");

  if (loading) return <div className="text-sm text-gray-400 py-8 text-center">読み込み中...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="text-xs text-gray-400 flex-1 min-w-[240px]">
          会員がどこから来たかを管理します。招待・フォーム（<code className="text-[11px]">?src=</code>）で付与され、
          初回メッセージ・一斉配信・シナリオの絞り込みに使われます。
        </p>
        <button onClick={openNew}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm hover:bg-red-700 whitespace-nowrap">
          ＋ 流入経路を追加
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {list.length === 0 && (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            まだ流入経路がありません。「＋ 流入経路を追加」から作成しましょう。
          </div>
        )}
        {list.map((s, i) => {
          const n = counts.get(s.id) ?? 0;
          return (
            <div key={s.id}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-gray-100" : ""} ${s.isActive ? "" : "opacity-55"}`}>
              <span className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-gray-800">{s.label}</span>
                  <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${CAT_STYLE[s.category]}`}>
                    {SOURCE_CATEGORY_LABEL[s.category]}
                  </span>
                  {!s.isActive && (
                    <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full border bg-gray-100 text-gray-500 border-gray-200">
                      停止中
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 font-mono truncate mt-0.5">
                  {sourceUrl(s, "")}　→　{sourceLandingUrl(s, "")}
                  {s.actions.length > 0 && (
                    <span className="ml-1.5 font-sans text-[10px] font-bold text-indigo-500">
                      ⚡ アクション {s.actions.length}
                    </span>
                  )}
                </p>
              </div>

              <div className="text-right shrink-0 w-16">
                <div className="text-sm font-bold text-gray-800">{n}</div>
                <div className="text-[10px] text-gray-400">会員</div>
              </div>

              <button onClick={() => copyUrl(s)} title="公開 URL をコピー"
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 border border-gray-200 rounded-md hover:bg-gray-50 whitespace-nowrap shrink-0">
                <Icon name="external" size={13} className="inline mr-0.5" />URL
              </button>
              <button onClick={() => duplicate(s)}
                className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 whitespace-nowrap shrink-0">複製</button>
              <button onClick={() => openEdit(s)}
                className="text-xs text-red-500 hover:text-red-700 px-2 py-1 whitespace-nowrap shrink-0">編集</button>
            </div>
          );
        })}
      </div>

      {form && (
        <InlineForm
          /* タイトル＝流入経路名の入力欄。見出しを名前そのものにして、入力を1つ減らす。 */
          title={
            <input
              className="w-full bg-transparent border-0 border-b border-transparent hover:border-gray-200 focus:border-red-400 focus:outline-none text-base font-bold text-gray-800 placeholder:text-gray-300 placeholder:font-normal py-0.5"
              value={form.label}
              placeholder="流入経路名（例：7月セミナー）"
              autoFocus={isNew}
              onChange={(e) => patch({ label: e.target.value })}
            />
          }
          onClose={() => setForm(null)}
          onSave={save}
          onDelete={!isNew ? () => setConfirm(form) : undefined}
          canSave={valid(form) == null}
        >
          {/* 公開 URL：LP・QR・広告に貼る URL。キーは自動発行なので新規でも即コピーできる。 */}
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1">
              公開 URL <span className="font-normal text-gray-400">LP・QR・広告に貼り付け</span>
            </label>
            <div className="flex items-center gap-2">
              <input readOnly value={sourceUrl(form, siteUrl)}
                onFocus={(e) => e.currentTarget.select()}
                className={`${inputCls} font-mono bg-gray-50 text-gray-600 text-[12px]`} />
              <button type="button" onClick={() => copyText(sourceUrl(form, siteUrl), "公開 URL をコピーしました")}
                className="shrink-0 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 whitespace-nowrap">
                コピー
              </button>
            </div>
            <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
              踏んだ人を計測してから誘導先へ転送します。<b className="text-gray-500">ログイン中の会員が踏むと、下のアクションが発火します。</b><br />
              転送先：<code className="text-[10.5px] break-all">{sourceLandingUrl(form, "")}</code>
            </p>
          </div>

          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">
                経路キー <span className="text-red-500">*</span> <span className="font-normal text-gray-400">自動発行</span>
              </label>
              <div className="flex items-center gap-2">
                <input className={`${inputCls} font-mono`} value={form.key} placeholder="src_xxxxxxxxxx"
                  onChange={(e) => patch({ key: e.target.value })} />
                <button type="button" onClick={() => patch({ key: generateSourceKey() })}
                  className="shrink-0 text-xs font-bold text-gray-600 border border-gray-300 rounded-lg px-3 py-2 hover:bg-gray-50 whitespace-nowrap">
                  再発行
                </button>
              </div>
              <p className="text-[11px] text-gray-400 mt-1">
                公開 URL の <code>?src=</code> に載る識別子。自動発行されますが、
                <code>seminar_0712</code> のような可読キーに書き換えても構いません（英数・ハイフン・アンダースコアのみ）。
              </p>
              {!isNew && (
                <p className="text-[11px] text-amber-600 mt-1">
                  ⚠️ キーを変えると、配布済みの QR・URL が無効になります。原則「複製」で新規作成してください。
                </p>
              )}
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">カテゴリ</label>
              <select className={`${inputCls} bg-white`} value={form.category}
                onChange={(e) => patch({ category: e.target.value as SourceCategory })}>
                {SOURCE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{SOURCE_CATEGORY_LABEL[c]}</option>
                ))}
              </select>
              <p className="text-[11px] text-gray-400 mt-1">
                「広告経由の全員」のようなカテゴリ単位の配信ができるようになります。
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">誘導先パス</label>
              <input className={`${inputCls} font-mono`} value={form.landingPath} placeholder="/f/entry"
                onChange={(e) => patch({ landingPath: e.target.value })} />
              <p className="text-[11px] text-gray-400 mt-1">
                未指定なら <code>/login</code>。公開フォームなら <code>/f/スラッグ</code>。
                公開 URL を踏んだ人は、ここへ転送されます。
              </p>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">色</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => patch({ color: e.target.value })}
                  className="w-10 h-9 border border-gray-300 rounded-lg cursor-pointer" />
                <input className={`${inputCls} font-mono`} value={form.color}
                  onChange={(e) => patch({ color: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1">状態</label>
              <button type="button" onClick={() => patch({ isActive: !form.isActive })}
                className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${
                  form.isActive ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-gray-300 bg-gray-50 text-gray-500"
                }`}>
                <span className="font-semibold">{form.isActive ? "有効" : "停止中"}</span>
                <span className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? "bg-emerald-500" : "bg-gray-300"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.isActive ? "translate-x-5" : ""}`} />
                </span>
              </button>
              <p className="text-[11px] text-gray-400 mt-1">停止しても既存会員の紐付けは残ります（新規付与だけ止まります）。</p>
            </div>
          </div>

          {/* UTM（広告連携・任意） */}
          <div className="border-t border-gray-100 pt-3 mt-1">
            <div className="text-xs font-bold text-gray-500 mb-2">UTM パラメータ <span className="font-normal text-gray-400">任意・広告の効果測定用</span></div>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
              <input className={`${inputCls} font-mono`} value={form.utmSource} placeholder="utm_source（例: google）"
                onChange={(e) => patch({ utmSource: e.target.value })} />
              <input className={`${inputCls} font-mono`} value={form.utmMedium} placeholder="utm_medium（例: cpc）"
                onChange={(e) => patch({ utmMedium: e.target.value })} />
              <input className={`${inputCls} font-mono`} value={form.utmCampaign} placeholder="utm_campaign"
                onChange={(e) => patch({ utmCampaign: e.target.value })} />
            </div>
          </div>

          {/* ── この経路から来た会員へのアクション ── */}
          <div className="border-t border-gray-100 pt-3 mt-1">
            <div className="text-xs font-bold text-gray-500 mb-1">
              この経路の会員へのアクション <span className="font-normal text-gray-400">任意</span>
            </div>
            <p className="text-[11px] text-gray-400 mb-2 leading-relaxed">
              発火するのは2つのタイミング。<b>① ログイン中の会員が公開 URL を踏んだ</b>とき（既存会員のクリック）、
              <b>② <code>?src=</code> 付きでフォームに回答した</b>とき（新規登録を含む）。
              未ログインのクリックは会員が特定できないため、回答時にまとめて実行されます。
            </p>

            <div className="mb-3">
              <label className="text-xs font-semibold text-gray-500 block mb-1">発火回数</label>
              <button type="button" onClick={() => patch({ fireOnce: !form.fireOnce })}
                className={`w-full flex items-center justify-between border rounded-lg px-3 py-2 text-sm ${
                  form.fireOnce ? "border-gray-300 bg-gray-50 text-gray-700" : "border-amber-300 bg-amber-50 text-amber-700"
                }`}>
                <span className="font-semibold">{form.fireOnce ? "1人1回だけ" : "踏むたびに毎回"}</span>
                <span className={`relative w-10 h-5 rounded-full transition-colors ${form.fireOnce ? "bg-gray-400" : "bg-amber-500"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${form.fireOnce ? "" : "translate-x-5"}`} />
                </span>
              </button>
              <p className="text-[11px] text-gray-400 mt-1">
                {form.fireOnce
                  ? "同じ会員が何度踏んでも1回だけ実行します（実行ログ action_events で担保）。"
                  : "⚠️ 踏むたびに実行します。属性付与は冪等ですが、チャットメッセージは毎回届きます。"}
              </p>
            </div>

            <ActionEditor
              actions={form.actions}
              onChange={(a: FormAction[]) => patch({ actions: a })}
              tree={tree} index={attrIndex} scenarios={scenarios}
              /* 会員登録アクションはフォーム専用（ここでは会員が既に特定できている） */
              allowSignup={false}
            />
          </div>

          <div className="border-t border-gray-100 pt-3">
            <label className="text-xs font-semibold text-gray-500 block mb-1">メモ</label>
            <textarea className={`${inputCls} min-h-[60px] resize-y`} value={form.memo}
              placeholder="施策の背景・担当者・期間など" onChange={(e) => patch({ memo: e.target.value })} />
          </div>

        </InlineForm>
      )}

      {confirm && (
        <ConfirmDialog
          message={`「${confirm.label}」を削除します。\n${counts.get(confirm.id) ?? 0} 名の会員が紐づいています。\n\n削除しても会員の記録自体は残りますが、経路名は表示できなくなります。\n分析を続けたい場合は「削除」ではなく「停止」を推奨します。`}
          onCancel={() => setConfirm(null)}
          onConfirm={() => remove(confirm)}
        />
      )}
    </div>
  );
}
