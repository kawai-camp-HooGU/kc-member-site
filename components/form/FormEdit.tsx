"use client";
// ============================================================
// フォーム編集
//   タブ：フォーム内容 / オプション / カラー・デザイン / 分岐
//   右ペインにスマホ回答画面のプレビュー
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { FieldEditor } from "./FieldEditor";
import { ActionEditor } from "./ActionEditor";
import type { ScenarioOpt } from "./ActionEditor";
import { FieldInput } from "./PublicForm";
import { fetchForm, saveForm, slugTaken } from "../../lib/forms";
import { emptyForm, newField, newSection, slugify, isVisible } from "../../lib/formParse";
import type { AnswerMap } from "../../lib/formParse";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { errMessage } from "../../lib/errors";
import type { FieldType, FormDef, FormField, FormSection, FormStatus, FormVisibility } from "../../lib/models";
import { FIELD_TYPE_LABEL, FORM_STATUS_LABEL, FORM_VISIBILITY_LABEL } from "../../lib/models";
import { useConfirm } from "../common/ConfirmProvider";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const lbl = "text-[11.5px] font-bold text-gray-600 mb-1 block";
const card = "bg-white rounded-xl border border-gray-200";

type Tab = "content" | "options" | "design" | "branch";
const TABS: { key: Tab; label: string }[] = [
  { key: "content", label: "フォーム内容" },
  { key: "options", label: "オプション" },
  { key: "design",  label: "カラー / デザイン" },
  { key: "branch",  label: "分岐" },
];

interface Props {
  id: number | null;
  tree: AttrNode[];
  index: AttrIndex;
  scenarios: ScenarioOpt[];
  onClose: () => void;
}

export function FormEdit({ id, tree, index, scenarios, onClose }: Props) {
  const confirm = useConfirm();
  const [form, setForm] = useState<FormDef>(emptyForm());
  const [loading, setLoading] = useState(id != null);
  const [tab, setTab] = useState<Tab>("content");
  const [openField, setOpenField] = useState<number | null>(null);
  const [paletteFor, setPaletteFor] = useState<number | null>(null); // セクションID
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (id == null) { setForm(emptyForm()); setLoading(false); return; }
    fetchForm(id).then((f) => { if (f) setForm(f); setLoading(false); });
  }, [id]);

  const set = <K extends keyof FormDef>(k: K, v: FormDef[K]) => setForm((f) => ({ ...f, [k]: v }));

  // ── セクション / 設問の操作 ──
  const setSection = (sid: number, patch: Partial<FormSection>) =>
    setForm((f) => ({ ...f, sections: f.sections.map((s) => (s.id === sid ? { ...s, ...patch } : s)) }));

  const addSection = () =>
    setForm((f) => ({ ...f, sections: [...f.sections, newSection(`セクション${f.sections.length + 1}`)] }));

  const delSection = async (sid: number) => {
    if (form.sections.length <= 1) { alert("セクションは1つ以上必要です"); return; }
    if (!(await confirm({ title: "セクションを削除", message: "このセクション（と中の設問）を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    setForm((f) => ({ ...f, sections: f.sections.filter((s) => s.id !== sid) }));
  };

  const addField = (sid: number, type: FieldType) => {
    const f2 = newField(type);
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s) => (s.id === sid ? { ...s, fields: [...s.fields, f2] } : s)),
    }));
    setOpenField(f2.id);
    setPaletteFor(null);
  };

  const setField = (sid: number, field: FormField) =>
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s) =>
        s.id === sid ? { ...s, fields: s.fields.map((x) => (x.id === field.id ? field : x)) } : s),
    }));

  const delField = (sid: number, fid: number) =>
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s) => (s.id === sid ? { ...s, fields: s.fields.filter((x) => x.id !== fid) } : s)),
    }));

  const moveField = (sid: number, fid: number, dir: -1 | 1) =>
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s) => {
        if (s.id !== sid) return s;
        const i = s.fields.findIndex((x) => x.id === fid);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.fields.length) return s;
        const arr = [...s.fields];
        [arr[i], arr[j]] = [arr[j], arr[i]];
        return { ...s, fields: arr };
      }),
    }));

  // ── 保存 ──
  const save = async (status?: FormStatus) => {
    const next: FormDef = { ...form, status: status ?? form.status };
    if (!next.name.trim() && !next.title.trim()) { setErr("フォーム名を入力してください"); return; }
    if (!next.name.trim()) next.name = next.title;
    if (!next.slug.trim()) next.slug = slugify(next.name);
    setSaving(true); setErr("");
    try {
      if (await slugTaken(next.slug, next.id)) { setErr("この公開URL（slug）は既に使われています"); setSaving(false); return; }
      const fid = await saveForm(next);
      if (!fid) { setErr("保存に失敗しました"); setSaving(false); return; }
      onClose();
    } catch (e) {
      setErr(errMessage(e));
      setSaving(false);
    }
  };

  const publicUrl = useMemo(
    () => (typeof window !== "undefined" && form.slug ? `${window.location.origin}/f/${form.slug}` : ""),
    [form.slug],
  );
  const copyUrl = useCallback(() => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    alert("公開URLをコピーしました");
  }, [publicUrl]);

  // 分岐の対象になれる設問（選択式のみ）
  const branchTargets = form.sections.flatMap((s) =>
    s.fields.filter((f) => ["radio", "select", "checkbox", "pref"].includes(f.type)));

  if (loading) return <div className="text-sm text-gray-400 py-10 text-center">読み込み中...</div>;

  return (
    <div className="space-y-4">
      <button onClick={onClose} className="text-sm font-bold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
        ← フォーム一覧へ戻る
      </button>

      {/* ヘッダー */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="フォーム名（管理用）"
          className="text-lg font-extrabold text-gray-800 bg-transparent border-b-2 border-gray-200 focus:outline-none focus:border-red-400 py-1 flex-1 min-w-[240px]" />
        <select value={form.status} onChange={(e) => set("status", e.target.value as FormStatus)}
          className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs font-bold bg-white">
          {(Object.keys(FORM_STATUS_LABEL) as FormStatus[]).map((s) => (
            <option key={s} value={s}>{FORM_STATUS_LABEL[s]}</option>
          ))}
        </select>
        {publicUrl && (
          <button onClick={copyUrl} className="text-[11.5px] font-mono bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-gray-600 hover:bg-gray-100">
            {publicUrl} 📋
          </button>
        )}
      </div>

      {/* タブ */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-3.5 py-2.5 text-[13px] font-bold border-b-2 -mb-px ${
              tab === t.key ? "text-red-600 border-red-600" : "text-gray-400 border-transparent hover:text-gray-600"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_320px] gap-4 items-start">
        <div>
          {/* ── フォーム内容 ── */}
          {tab === "content" && (
            <div className="space-y-3">
              <div className={`${card} p-4 space-y-3`}>
                <div>
                  <span className={lbl}>フォームタイトル（回答画面の最上部）</span>
                  <input className={inputCls} value={form.title} onChange={(e) => set("title", e.target.value)} />
                </div>
                <div>
                  <span className={lbl}>説明文（最大2,000文字）</span>
                  <textarea className={`${inputCls} min-h-[90px]`} maxLength={2000} value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                    placeholder="所要時間 約2分／全5問です。" />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <span className={lbl}>フォルダ（分類）</span>
                    <input className={inputCls} value={form.folder} onChange={(e) => set("folder", e.target.value)} placeholder="例）申込 / アンケート" />
                  </div>
                  <div>
                    <span className={lbl}>公開URL（/f/◯◯）</span>
                    <input className={inputCls} value={form.slug} onChange={(e) => set("slug", e.target.value)}
                      onBlur={(e) => set("slug", slugify(e.target.value || form.name))} placeholder="taiken-2608" />
                  </div>
                </div>
              </div>

              {form.sections.map((s, si) => (
                <div key={s.id} className={card}>
                  <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-50 border-b border-gray-200 rounded-t-xl">
                    <span className="w-5 h-5 rounded bg-neutral-800 text-white text-[10px] font-bold flex items-center justify-center">{si + 1}</span>
                    <input value={s.name} onChange={(e) => setSection(s.id, { name: e.target.value })}
                      placeholder={`セクション${si + 1}`}
                      className="text-[13px] font-bold bg-transparent focus:outline-none flex-1" />
                    <span className="text-[11px] text-gray-400">{si + 1}ページ目</span>
                    <button onClick={() => delSection(s.id)} className="text-[11.5px] font-bold text-gray-400 hover:text-red-600">削除</button>
                  </div>
                  <div className="p-3">
                    {s.fields.map((f) => (
                      <FieldEditor key={f.id} f={f} open={openField === f.id}
                        onToggle={() => setOpenField(openField === f.id ? null : f.id)}
                        onChange={(nf) => setField(s.id, nf)}
                        onRemove={() => delField(s.id, f.id)}
                        onMove={(d) => moveField(s.id, f.id, d)}
                        tree={tree} index={index} scenarios={scenarios} />
                    ))}
                    <button onClick={() => setPaletteFor(s.id)}
                      className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-[13px] font-bold text-gray-500 hover:border-red-300 hover:text-red-600">
                      ＋ ブロックを追加
                    </button>
                  </div>
                </div>
              ))}

              <button onClick={addSection}
                className="w-full border-2 border-dashed border-gray-400 rounded-xl py-2.5 text-[13px] font-bold text-gray-600 hover:border-red-400 hover:text-red-600">
                ＋ セクションを追加（ページ分割）
              </button>
            </div>
          )}

          {/* ── オプション ── */}
          {tab === "options" && (
            <div className="space-y-3">
              <div className={`${card} p-4 space-y-3`}>
                <p className="text-[13px] font-extrabold text-gray-700">公開設定</p>
                <div>
                  <span className={lbl}>公開範囲</span>
                  <div className="flex gap-2">
                    {(Object.keys(FORM_VISIBILITY_LABEL) as FormVisibility[]).map((v) => (
                      <button key={v} onClick={() => set("visibility", v)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold border ${
                          form.visibility === v ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-gray-200 text-gray-500"}`}>
                        {FORM_VISIBILITY_LABEL[v]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1.5">
                    会員がログイン状態で開くと自動で本人に紐付きます。「会員＋外部」では未ログインの方も氏名・メールを入力して回答できます。
                  </p>
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <span className={lbl}>回答期限（空欄＝期限なし）</span>
                    <input type="datetime-local" className={inputCls} value={form.deadlineAt}
                      onChange={(e) => set("deadlineAt", e.target.value)} />
                  </div>
                  <div>
                    <span className={lbl}>回答回数の上限（1人あたり・0＝無制限）</span>
                    <input type="number" min={0} className={inputCls} value={form.answerLimit}
                      onChange={(e) => set("answerLimit", Number(e.target.value))} />
                  </div>
                </div>
                <div>
                  <span className={lbl}>期限後・受付終了時に表示する文章</span>
                  <input className={inputCls} value={form.deadlineMessage} onChange={(e) => set("deadlineMessage", e.target.value)} />
                </div>
                <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600">
                  <input type="checkbox" checked={form.autofillMember} onChange={(e) => set("autofillMember", e.target.checked)}
                    className="w-4 h-4 accent-red-600" />
                  ログイン会員の氏名・メールを自動入力する
                </label>
              </div>

              <div className={`${card} p-4 space-y-3`}>
                <p className="text-[13px] font-extrabold text-gray-700">送信・完了時の挙動</p>
                <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600">
                  <input type="checkbox" checked={form.confirmDialog} onChange={(e) => set("confirmDialog", e.target.checked)}
                    className="w-4 h-4 accent-red-600" />
                  送信確認ダイアログを表示する
                </label>
                {form.confirmDialog && (
                  <div>
                    <span className={lbl}>確認テキスト</span>
                    <input className={inputCls} value={form.confirmText} onChange={(e) => set("confirmText", e.target.value)} />
                  </div>
                )}
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <span className={lbl}>サンクスページURL（任意）</span>
                    <input className={inputCls} value={form.thanksUrl} onChange={(e) => set("thanksUrl", e.target.value)}
                      placeholder="https://…（未設定なら下の文章を表示）" />
                  </div>
                  <div>
                    <span className={lbl}>回答後に表示する文章</span>
                    <input className={inputCls} value={form.thanksText} onChange={(e) => set("thanksText", e.target.value)} />
                  </div>
                </div>
              </div>

              <div className={`${card} p-4 space-y-3`}>
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-extrabold text-gray-700">回答後アクション</p>
                  <span className="text-[11px] text-gray-400">回答完了時に自動実行（会員として回答された場合）</span>
                </div>
                <ActionEditor actions={form.afterActions} onChange={(a) => set("afterActions", a)}
                  tree={tree} index={index} scenarios={scenarios} allowChat />
                <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600">
                  <input type="checkbox" checked={form.notifyEnabled} onChange={(e) => set("notifyEnabled", e.target.checked)}
                    className="w-4 h-4 accent-red-600" />
                  回答が届いたら担当者（管理者・オペレーター）へ通知する
                </label>
              </div>
            </div>
          )}

          {/* ── デザイン ── */}
          {tab === "design" && (
            <div className={`${card} p-4 space-y-3`}>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <span className={lbl}>メインカラー</span>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={form.design.color}
                      onChange={(e) => set("design", { ...form.design, color: e.target.value })}
                      className="w-10 h-9 rounded border border-gray-200" />
                    <input className={inputCls} value={form.design.color}
                      onChange={(e) => set("design", { ...form.design, color: e.target.value })} />
                  </div>
                </div>
                <div>
                  <span className={lbl}>背景カラー</span>
                  <div className="flex gap-2 items-center">
                    <input type="color" value={form.design.bgColor}
                      onChange={(e) => set("design", { ...form.design, bgColor: e.target.value })}
                      className="w-10 h-9 rounded border border-gray-200" />
                    <input className={inputCls} value={form.design.bgColor}
                      onChange={(e) => set("design", { ...form.design, bgColor: e.target.value })} />
                  </div>
                </div>
              </div>
              <div>
                <span className={lbl}>ヘッダー画像URL（任意）</span>
                <input className={inputCls} value={form.design.headerImage}
                  onChange={(e) => set("design", { ...form.design, headerImage: e.target.value })} placeholder="https://…" />
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <span className={lbl}>送信ボタン文言</span>
                  <input className={inputCls} value={form.design.submitLabel}
                    onChange={(e) => set("design", { ...form.design, submitLabel: e.target.value })} />
                </div>
                <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600 mt-6">
                  <input type="checkbox" checked={form.design.progress}
                    onChange={(e) => set("design", { ...form.design, progress: e.target.checked })}
                    className="w-4 h-4 accent-red-600" />
                  プログレスバーを表示する
                </label>
              </div>
              <div>
                <span className={lbl}>カスタムCSS（任意）</span>
                <textarea className={`${inputCls} min-h-[90px] font-mono text-[12px]`} value={form.design.customCss}
                  onChange={(e) => set("design", { ...form.design, customCss: e.target.value })} />
              </div>
            </div>
          )}

          {/* ── 分岐 ── */}
          {tab === "branch" && (
            <div className={`${card} p-4 space-y-4`}>
              <p className="text-[13px] font-extrabold text-gray-700">条件分岐</p>
              <p className="text-[11.5px] text-gray-500">
                選択式の設問の回答に応じて、セクション（ページ）や設問の表示・非表示を切り替えます。
              </p>
              {branchTargets.length === 0 && (
                <p className="text-[12px] text-gray-400">分岐の条件に使える選択式の設問がまだありません。</p>
              )}
              {form.sections.map((s, si) => (
                <div key={s.id} className="border border-gray-200 rounded-xl p-3">
                  <p className="text-[12.5px] font-bold text-gray-700 mb-2">
                    {si + 1}. {s.name || `セクション${si + 1}`}
                  </p>
                  <CondRow cond={s.condition} targets={branchTargets} disabled={si === 0}
                    onChange={(c) => setSection(s.id, { condition: c })} />
                  <div className="mt-3 space-y-2 pl-3 border-l-2 border-gray-100">
                    {s.fields.map((f) => (
                      <div key={f.id}>
                        <p className="text-[11.5px] font-bold text-gray-500 mb-1">{f.label || "（項目名なし）"}</p>
                        <CondRow cond={f.condition} targets={branchTargets.filter((t) => t.id !== f.id)}
                          onChange={(c) => setField(s.id, { ...f, condition: c })} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── プレビュー ── */}
        <Preview form={form} />
      </div>

      {err && <p className="text-[12.5px] text-red-600">{err}</p>}

      <div className="flex gap-2 justify-end sticky bottom-0 bg-gradient-to-t from-gray-50 via-gray-50 to-transparent py-3">
        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-600">キャンセル</button>
        <button onClick={() => save("draft")} disabled={saving}
          className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-bold text-gray-600 disabled:opacity-50">下書き保存</button>
        <button onClick={() => save("published")} disabled={saving}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-50">
          {saving ? "保存中…" : "保存して公開"}
        </button>
      </div>

      {/* ブロック追加パレット */}
      {paletteFor != null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setPaletteFor(null)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-extrabold mb-3">ブロックを追加</p>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                <button key={t} onClick={() => addField(paletteFor, t)}
                  className="border border-gray-200 rounded-xl px-3 py-2.5 text-[12.5px] font-bold text-gray-700 text-left hover:border-red-300 hover:text-red-600">
                  {FIELD_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">追加後にタイプ変更できます（ラジオ⇄プルダウン等）。選択式には「選択時のアクション」を設定できます。</p>
            <button onClick={() => setPaletteFor(null)} className="mt-3 w-full py-2 rounded-lg border border-gray-200 text-[12.5px] font-bold text-gray-600">閉じる</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 条件（分岐）1行 ──────────────────────────────────────────
function CondRow({
  cond, targets, onChange, disabled,
}: {
  cond: FormDef["sections"][number]["condition"];
  targets: FormField[];
  onChange: (c: FormDef["sections"][number]["condition"]) => void;
  disabled?: boolean;
}) {
  const target = targets.find((t) => t.id === cond?.fieldId);
  const sel = "border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] bg-white focus:outline-none focus:border-red-400";
  if (disabled) return <p className="text-[11.5px] text-gray-400">最初のセクションは常に表示されます</p>;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select className={sel} value={cond?.fieldId ?? ""}
        onChange={(e) => {
          const fid = Number(e.target.value);
          if (!fid) { onChange(null); return; }
          onChange({ fieldId: fid, op: cond?.op ?? "eq", value: cond?.value ?? "" });
        }}>
        <option value="">条件なし（常に表示）</option>
        {targets.map((t) => <option key={t.id} value={t.id}>{t.label || "（項目名なし）"}</option>)}
      </select>
      {cond && (
        <>
          <select className={sel} value={cond.value}
            onChange={(e) => onChange({ ...cond, value: e.target.value })}>
            <option value="">（選択肢）</option>
            {(target?.options ?? []).map((o, i) => <option key={i} value={o.label}>{o.label}</option>)}
          </select>
          <select className={sel} value={cond.op}
            onChange={(e) => onChange({ ...cond, op: e.target.value as "eq" | "neq" })}>
            <option value="eq">のとき表示</option>
            <option value="neq">以外のとき表示</option>
          </select>
        </>
      )}
    </div>
  );
}

// ── スマホプレビュー ─────────────────────────────────────────
function Preview({ form }: { form: FormDef }) {
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [page, setPage] = useState(0);
  const color = form.design.color || "#dc2626";
  const sections = form.sections.filter((s) => isVisible(s.condition, answers));
  const sec = sections[Math.min(page, Math.max(sections.length - 1, 0))];
  const pct = sections.length > 1 ? Math.round(((page + 1) / sections.length) * 100) : 100;

  return (
    <aside className="lg:sticky lg:top-4">
      <p className="text-[11.5px] font-bold text-gray-500 mb-1.5">回答画面プレビュー</p>
      <div className="bg-neutral-900 rounded-[26px] p-2 shadow-xl">
        <div className="bg-white rounded-[19px] overflow-hidden h-[560px] flex flex-col">
          <div className="px-4 py-4 text-white" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}>
            <p className="text-[14px] font-extrabold">{form.title || form.name || "（タイトル未設定）"}</p>
            {form.description && <p className="text-[10.5px] opacity-90 mt-1 whitespace-pre-wrap leading-relaxed">{form.description}</p>}
          </div>
          <div className="flex-1 overflow-y-auto p-3" style={{ background: form.design.bgColor || "#f7f7f8" }}>
            {form.design.progress && sections.length > 1 && (
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden mb-3">
                <div className="h-full" style={{ width: `${pct}%`, background: color }} />
              </div>
            )}
            <div className="space-y-2">
              {sec?.fields.filter((f) => isVisible(f.condition, answers)).map((f) => (
                <div key={f.id} className="scale-[0.94] origin-top">
                  <FieldInput f={f} value={answers[f.id]} color={color}
                    onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))}
                    onCheck={(l) => setAnswers((a) => {
                      const cur = Array.isArray(a[f.id]) ? (a[f.id] as string[]) : [];
                      return { ...a, [f.id]: cur.includes(l) ? cur.filter((x) => x !== l) : [...cur, l] };
                    })}
                    onFile={() => undefined} />
                </div>
              ))}
              {(!sec || sec.fields.length === 0) && (
                <p className="text-[11.5px] text-gray-400 text-center py-8">設問がまだありません</p>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              {page > 0 && (
                <button onClick={() => setPage((p) => p - 1)}
                  className="px-3 py-2.5 rounded-lg border border-gray-300 bg-white text-[12px] font-bold text-gray-600">戻る</button>
              )}
              <div className="flex-1 text-center text-white rounded-lg py-2.5 text-[13px] font-bold cursor-pointer"
                style={{ background: color }}
                onClick={() => { if (page < sections.length - 1) setPage((p) => p + 1); }}>
                {page < sections.length - 1 ? "次へ進む" : (form.design.submitLabel || "送信する")}
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
        会員がログイン状態で開くと氏名・メールが自動入力され、回答は本人に紐付きます。
      </p>
    </aside>
  );
}
