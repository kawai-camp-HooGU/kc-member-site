"use client";
// ============================================================
// フォーム編集
//   タブ：フォーム内容 / オプション / カラー・デザイン / 分岐
//   右ペインにスマホ回答画面のプレビュー
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FieldEditor } from "./FieldEditor";
import { ActionEditor } from "./ActionEditor";
import type { ScenarioOpt } from "./ActionEditor";
import { AutoReplyEditor } from "./AutoReplyEditor";
import { FieldInput, BAND_REQUIRED } from "./PublicForm";
import { fetchForm, saveForm } from "../../lib/forms";
import { emptyForm, newField, newSection, isVisible, findContactFields, guestContactNeed } from "../../lib/formParse";
import { UrlField } from "../common/UrlField";
import { AiHtmlBar } from "../content/AiHtmlBar";
import { useMaster } from "../../hooks/useMaster";
import { renderBodyHtml } from "../../lib/richText";
import type { AnswerMap } from "../../lib/formParse";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { errMessage } from "../../lib/errors";
import type { FieldType, FormDef, FormField, FormSection, FormStatus, FormVisibility, ThanksMode } from "../../lib/models";
import { FIELD_TYPE_LABEL, FORM_STATUS_LABEL, FORM_VISIBILITY_LABEL, DEFAULT_GUEST_CONTACT } from "../../lib/models";
import { useConfirm } from "../common/ConfirmProvider";
import { SettingCard } from "../common/SettingCard";
import { CARD, FIELD_INPUT, FIELD_LABEL, STATE_CHIP } from "../../lib/constants";
const inputCls = FIELD_INPUT;
const lbl = FIELD_LABEL;
const card = CARD;

type Tab = "content" | "options" | "design" | "branch";
const TABS: { key: Tab; label: string }[] = [
  { key: "content", label: "フォーム内容" },
  { key: "options", label: "オプション" },
  { key: "design",  label: "カラー / デザイン" },
  { key: "branch",  label: "分岐" },
];

/** オプションタブの目次（案5）。id は SettingCard 側と合わせる */
const OPTION_NAV: { id: string; label: string }[] = [
  { id: "opt-public", label: "公開設定" },
  { id: "opt-submit", label: "送信・完了時の挙動" },
  { id: "opt-mail",   label: "自動返信メール" },
  { id: "opt-action", label: "回答後アクション" },
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
  const { can } = useMaster();
  const [form, setForm] = useState<FormDef>(emptyForm());
  const [loading, setLoading] = useState(id != null);
  const [tab, setTab] = useState<Tab>("content");
  const [openField, setOpenField] = useState<number | null>(null);
  const [paletteFor, setPaletteFor] = useState<number | null>(null); // セクションID
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  // ── ④ AI HTML生成（回答後に表示する画面＝HTMLモード）──────────
  //   生成そのものは別ウィンドウのAIチャットが担当。ここは起動と受け取りだけ。
  //   コンテンツ編集・お知らせ編集と同じ作法に揃えてある（AiHtmlBar を共用）。
  const thanksHtmlRef = useRef<HTMLTextAreaElement>(null);
  const [thanksSel, setThanksSel] = useState<{ start: number; end: number } | null>(null);
  const [thanksUndo, setThanksUndo] = useState<string | null>(null);
  /** 選択範囲を拾ってAIへ渡す（部分修正のヒントになる。未選択なら null） */
  const syncThanksSel = () => {
    const ta = thanksHtmlRef.current;
    if (!ta) return;
    const { selectionStart: s, selectionEnd: e } = ta;
    setThanksSel(e > s ? { start: s, end: e } : null);
  };
  /**
   * AIチャットからの反映。上書き前の内容を1手だけ持っておく。
   * ⚠️ 退避元は textarea の現値。この関数は「AIチャットを開いた時点」の
   *    クロージャから呼ばれるため、state を直接読むと開いた後の手編集を
   *    取りこぼす（＝元に戻すと古い内容に戻ってしまう）。
   */
  const applyThanksHtml = (next: string) => {
    setThanksUndo(thanksHtmlRef.current?.value ?? null);
    setForm((f) => ({ ...f, design: { ...f.design, thanksHtml: next } }));
    setThanksSel(null);
  };

  useEffect(() => {
    if (id == null) { setForm(emptyForm()); setLoading(false); return; }
    fetchForm(id).then((f) => { if (f) setForm(f); setLoading(false); });
  }, [id]);

  const set = <K extends keyof FormDef>(k: K, v: FormDef[K]) => setForm((f) => ({ ...f, [k]: v }));

  // 会員登録アクションが1つでもあるか（あればメールは自動で必須になる）
  const wantsSignup = [
    ...form.afterActions,
    ...form.sections.flatMap((s) => s.fields.flatMap((f) => (f.options ?? []).flatMap((o) => o.actions ?? []))),
  ].some((a) => a.type === "member_signup");

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
    setSaving(true); setErr("");
    try {
      // 公開URL（slug）はDBが自動発行するランダムトークン。ここでは何もしない。
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
              <SettingCard title="基本情報" desc="管理用・回答画面の見出し">
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
                    <span className={lbl}>公開URL <span className="text-gray-400 font-normal">自動発行・編集不可</span></span>
                    <input className={`${inputCls} bg-gray-100 text-gray-600 font-mono`}
                      value={form.slug ? `/f/${form.slug}` : "保存すると自動で発行されます"} readOnly
                      onFocus={(e) => e.currentTarget.select()} />
                  </div>
                </div>
              </SettingCard>

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
            /* オプションは縦に長い。左に目次（xl以上のみ）を出して現在地を失わないようにする */
            <div className="grid xl:grid-cols-[164px_1fr] gap-4 items-start">
              <OptionNav />
              <div className="space-y-3 min-w-0">
              <SettingCard id="opt-public" no={1} title="公開設定" sticky>
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

                {/* ご連絡先欄の設定（会員＋外部のときだけ意味を持つ） */}
                {form.visibility === "both" && (() => {
                  const gc = form.design.guestContact ?? DEFAULT_GUEST_CONTACT;
                  const setGc = (p: Partial<typeof gc>) =>
                    set("design", { ...form.design, guestContact: { ...gc, ...p } });
                  // 登録先＝氏名／メールの設問。分岐条件は「回答なし」の状態で評価する
                  const contact = findContactFields(form, {});
                  // ご連絡先欄のラベル設定が実際に使われるか（両方とも設問で賄えていれば使われない）
                  const guestFieldsUsed = guestContactNeed(form, {}).show;
                  return (
                    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3.5">
                      <p className="text-[12.5px] font-bold text-gray-700">ご連絡先欄の設定</p>
                      <p className="text-[11px] text-gray-400 mb-3">未ログインの方に表示される欄です。「氏名」だけにしたい場合はラベルを「氏名」に変えてください。</p>

                      {/* ① 氏名・メールの取得元。設問と重複して2回聞かないための設定。 */}
                      <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50/60 p-3 mb-3">
                        <p className="text-[12px] font-extrabold text-emerald-900 mb-2">氏名・メールの取得元</p>
                        <div className="space-y-2">
                          {([
                            ["auto", "フォーム内容の設問を優先する（自動）",
                              "「登録先＝氏名／メール」の設問があればそれを使い、この欄には出しません。片方だけある場合は、足りない方だけ出します。"],
                            ["always", "常にご連絡先欄を表示する",
                              "設問とは別に、確認用として必ず入力させます（従来の挙動）。"],
                          ] as const).map(([m, title, desc]) => (
                            <label key={m} className="flex items-start gap-2.5 cursor-pointer">
                              <input type="radio" className="mt-0.5 w-4 h-4 accent-emerald-600"
                                checked={(gc.mode ?? "auto") === m}
                                onChange={() => setGc({ mode: m })} />
                              <span>
                                <span className="text-[12.5px] font-bold text-gray-800">{title}</span>
                                <span className="block text-[11px] text-gray-600 mt-0.5 leading-relaxed">{desc}</span>
                              </span>
                            </label>
                          ))}
                        </div>

                        {/* 現在の紐付け状況：どの設問から取っているかを明示する */}
                        <div className="mt-3 rounded-lg bg-white border border-emerald-200 p-3">
                          <p className="text-[11px] font-extrabold text-gray-500 mb-2">現在の紐付け状況</p>
                          {([["氏名", contact.nameField], ["メール", contact.emailField]] as const).map(([label, f]) => (
                            <div key={label} className="flex items-center gap-2 py-1 text-[11.5px] border-b border-gray-100 last:border-0">
                              <span className="w-16 text-gray-500 font-bold shrink-0">{label}</span>
                              {f ? (
                                <>
                                  <span className="font-bold text-gray-800 truncate">{f.label || "（項目名なし）"}</span>
                                  {/* 緑＝効いている／グレー＝今は使われていない（STATE_CHIP の意味を固定） */}
                                  <span className={`${STATE_CHIP[(gc.mode ?? "auto") === "auto" ? "on" : "off"]} shrink-0`}>
                                    {(gc.mode ?? "auto") === "auto" ? "連動中" : "設問あり（未使用）"}
                                  </span>
                                </>
                              ) : (
                                <span className="text-gray-400">設問なし（ご連絡先欄で入力）</span>
                              )}
                            </div>
                          ))}
                          <p className="text-[10.5px] text-gray-400 mt-2 leading-relaxed">
                            ※ 設問の「登録先」は フォーム内容タブ ＞ 各設問の詳細 で設定します。<br />
                            ※ 分岐でその設問が非表示になったときは、自動的にご連絡先欄が出ます。
                          </p>
                        </div>
                      </div>

                      {/* 使われない設定は「薄い文章」ではなくチップ＋カードごと沈めて示す。
                          薄い注記は読み飛ばされ、「設定したのに効かない」の原因になるため。 */}
                      <div className={`relative rounded-xl ${!guestFieldsUsed ? "border border-gray-200 bg-gray-50 p-3.5 pt-5 mt-3" : ""}`}>
                        {!guestFieldsUsed && (
                          <span className={`${STATE_CHIP.off} absolute -top-2 left-3.5`}>
                            この設定は今は使われません
                          </span>
                        )}
                        <div className={`space-y-2.5 ${!guestFieldsUsed ? "opacity-45" : ""}`}>
                        <div>
                          <span className={lbl}>見出し</span>
                          <input className={inputCls} value={gc.title} onChange={(e) => setGc({ title: e.target.value })} placeholder="ご連絡先" />
                        </div>
                        <div>
                          <span className={lbl}>説明文 <span className="text-gray-400 font-normal">空欄で非表示</span></span>
                          <input className={inputCls} value={gc.note} onChange={(e) => setGc({ note: e.target.value })} placeholder="ご回答の確認・ご連絡に使用します。" />
                        </div>

                        <div className="border-t border-gray-200 pt-2.5">
                          <span className={lbl}>お名前の欄のラベル</span>
                          <input className={inputCls} value={gc.nameLabel} onChange={(e) => setGc({ nameLabel: e.target.value })} placeholder="お名前・ニックネーム" />
                          <label className="flex items-center gap-2 mt-1.5 cursor-pointer">
                            <input type="checkbox" className="w-4 h-4 accent-red-600" checked={gc.nameRequired}
                              onChange={(e) => setGc({ nameRequired: e.target.checked })} />
                            <span className="text-[12px] text-gray-600">お名前の欄を必須にする</span>
                          </label>
                        </div>

                        <div className="border-t border-gray-200 pt-2.5">
                          <span className={lbl}>メールアドレスの欄のラベル</span>
                          <input className={inputCls} value={gc.emailLabel} onChange={(e) => setGc({ emailLabel: e.target.value })} placeholder="メールアドレス" />
                          <label className={`flex items-center gap-2 mt-1.5 ${wantsSignup ? "opacity-50" : "cursor-pointer"}`}>
                            <input type="checkbox" className="w-4 h-4 accent-red-600"
                              checked={gc.emailRequired || wantsSignup} disabled={wantsSignup}
                              onChange={(e) => setGc({ emailRequired: e.target.checked })} />
                            <span className="text-[12px] text-gray-600">メールアドレスの欄を必須にする</span>
                          </label>
                          {wantsSignup && (
                            <p className="text-[10.5px] text-amber-600 mt-1">会員登録アクションを使うため、メールは自動で必須になっています。</p>
                          )}
                        </div>
                        </div>
                      </div>
                    </div>
                  );
                })()}
                {/* 発行済みの公開URL（未ログインでも開ける） */}
                <UrlField label="公開URL" hint="未ログインでも開けます（/f/◯◯）"
                  path={form.slug ? `/f/${form.slug}` : ""}
                  emptyText="公開URL（slug）を入力すると発行されます" />

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

                {/* カレンダー連携：回答期限の日にチップを出す */}
                <div className="rounded-xl border-2 border-teal-200 bg-teal-50/50 p-3.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input type="checkbox" className="mt-0.5 w-4 h-4 accent-teal-600"
                      checked={form.showOnCalendar}
                      onChange={(e) => set("showOnCalendar", e.target.checked)} />
                    <span>
                      <span className="text-sm font-bold text-teal-900">カレンダーに表示する</span>
                      <span className="block text-[11px] text-teal-700 mt-0.5">
                        回答期限の日にフォームのチップを表示します（公開中・期限ありのフォームのみ）。
                        自分が未回答なら赤枠、回答済なら薄く表示されます。
                      </span>
                    </span>
                  </label>
                  {form.showOnCalendar && (
                    <div className="mt-3 pl-6">
                      <span className={lbl}>カレンダー表示名（空欄ならフォーム名）</span>
                      <input className={inputCls} value={form.calendarLabel}
                        placeholder={form.name || "フォーム名"}
                        onChange={(e) => set("calendarLabel", e.target.value)} />
                    </div>
                  )}
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
              </SettingCard>

              <SettingCard id="opt-submit" no={2} title="送信・完了時の挙動" sticky>
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
                {/* ③ 回答後に表示する画面：テキスト / HTML / URLへ遷移 の3モード。
                    旧「サンクスページURL」は url モードに統合し、優先関係の曖昧さを解消した。 */}
                <div>
                  <span className={lbl}>回答後に表示する画面</span>
                  <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit mb-2.5">
                    {([
                      ["text", "テキスト"], ["html", "HTML"], ["url", "URLへ遷移"],
                    ] as const).map(([m, label]) => (
                      <button key={m} type="button"
                        onClick={() => set("design", { ...form.design, thanksMode: m as ThanksMode })}
                        className={`px-3 py-1.5 rounded-md text-[12px] font-bold ${
                          form.design.thanksMode === m ? "bg-white shadow-sm text-neutral-900" : "text-gray-500 hover:text-gray-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>

                  {form.design.thanksMode === "text" && (
                    <>
                      <textarea className={`${inputCls} min-h-[110px]`} value={form.thanksText}
                        onChange={(e) => set("thanksText", e.target.value)}
                        placeholder={"ご回答ありがとうございました。\n\n3営業日以内にご連絡いたします。"} />
                      <p className="text-[10.5px] text-gray-400 mt-1">改行はそのまま反映されます。HTMLタグは文字として表示されます。</p>
                    </>
                  )}

                  {form.design.thanksMode === "html" && (
                    <>
                      {/* ④ AIでHTMLを生成 / 修正。コンテンツ編集・お知らせ編集と同じ入口 */}
                      {can("ai_html") && (
                        <AiHtmlBar html={form.design.thanksHtml} selection={thanksSel}
                          onApply={applyThanksHtml} sourceScreen="フォーム編集（完了画面HTML）" />
                      )}
                      <textarea ref={thanksHtmlRef} className={`${inputCls} min-h-[130px] font-mono text-[12px]`}
                        value={form.design.thanksHtml}
                        onChange={(e) => set("design", { ...form.design, thanksHtml: e.target.value })}
                        onSelect={syncThanksSel} onKeyUp={syncThanksSel} onMouseUp={syncThanksSel} onBlur={syncThanksSel}
                        placeholder={'<h2>お申込みありがとうございます</h2>\n<p>確認メールをお送りしました。</p>'} />
                      {thanksUndo != null && (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10.5px] text-red-600 font-bold">✦ AIの生成結果を反映しました</span>
                          <button type="button"
                            onClick={() => { set("design", { ...form.design, thanksHtml: thanksUndo }); setThanksUndo(null); }}
                            className="text-[10.5px] text-gray-500 underline hover:text-gray-700">元に戻す</button>
                        </div>
                      )}
                      <p className="text-[10.5px] text-amber-600 mt-1 leading-relaxed">
                        保存時と表示時にサニタイズされます（&lt;script&gt;・on◯◯属性・javascript: は除去）。
                      </p>
                      <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                        <p className="px-2.5 py-1.5 bg-gray-50 border-b border-gray-200 text-[10.5px] font-bold text-gray-500">表示プレビュー</p>
                        <div className="p-3 text-[13px] leading-relaxed text-gray-700"
                          dangerouslySetInnerHTML={{ __html: renderBodyHtml("html", "", form.design.thanksHtml) }} />
                      </div>
                    </>
                  )}

                  {form.design.thanksMode === "url" && (
                    <>
                      <input className={inputCls} value={form.thanksUrl} onChange={(e) => set("thanksUrl", e.target.value)}
                        placeholder="https://…" />
                      <p className="text-[10.5px] text-gray-400 mt-1">
                        送信完了と同時にこのURLへ遷移します。外部ロールの自動ログインがある場合は、ログイン後にここへ着地します。
                      </p>
                    </>
                  )}
                </div>
              </SettingCard>

              {/* ④ 自動返信メール */}
              <SettingCard id="opt-mail" no={3} title="自動返信メール"
                desc="回答者本人へ送信（メールが取得できた場合のみ）" sticky
                right={<span className={STATE_CHIP[form.design.autoReply.enabled ? "on" : "off"]}>
                  {form.design.autoReply.enabled ? "送信する" : "送信しない"}
                </span>}>
                <AutoReplyEditor
                  form={form}
                  value={form.design.autoReply}
                  onChange={(a) => set("design", { ...form.design, autoReply: a })}
                  emailSourceLabel={
                    findContactFields(form, {}).emailField?.label
                      ? `設問「${findContactFields(form, {}).emailField?.label}」の回答`
                      : "ご連絡先欄のメールアドレス"
                  }
                />
              </SettingCard>

              <SettingCard id="opt-action" no={4} title="回答後アクション"
                desc="回答完了時に自動実行（会員として回答された場合）" sticky
                right={<span className={STATE_CHIP[form.afterActions.length > 0 ? "on" : "off"]}>
                  {form.afterActions.length > 0 ? `${form.afterActions.length}件` : "未設定"}
                </span>}>
                <ActionEditor actions={form.afterActions} onChange={(a) => set("afterActions", a)}
                  tree={tree} index={index} scenarios={scenarios} allowChat />
                <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600">
                  <input type="checkbox" checked={form.notifyEnabled} onChange={(e) => set("notifyEnabled", e.target.checked)}
                    className="w-4 h-4 accent-red-600" />
                  回答が届いたら担当者（管理者・オペレーター）へ通知する
                </label>
              </SettingCard>
              </div>
            </div>
          )}

          {/* ── デザイン ── */}
          {tab === "design" && (
            <SettingCard title="カラー / デザイン" desc="回答画面の見た目">
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
            </SettingCard>
          )}

          {/* ── 分岐 ── */}
          {tab === "branch" && (
            <SettingCard title="条件分岐" desc="選択式の回答で表示を切り替える">
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
            </SettingCard>
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

// ── オプションタブの目次（案5：現在地）──────────────────────
/**
 * 縦に長いオプションタブで「今どの設定を触っているか」を見失わないための目次。
 *   ・現在地は IntersectionObserver で判定する（スクロール毎の再計算より軽い）。
 *   ・rootMargin の下側を大きく削り、画面上部に来たカードだけを現在地と見なす。
 *   ⚠️ 右に回答画面プレビューがあるため、幅が足りない環境では丸ごと隠す（xl 未満）。
 */
function OptionNav() {
  const [active, setActive] = useState(OPTION_NAV[0]?.id ?? "");

  useEffect(() => {
    const els = OPTION_NAV
      .map((n) => document.getElementById(n.id))
      .filter((e): e is HTMLElement => e !== null);
    if (els.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top) setActive(top.target.id);
      },
      { rootMargin: "0px 0px -70% 0px", threshold: 0 },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);

  return (
    <nav className="hidden xl:block sticky top-4">
      <div className="bg-white border border-gray-200 rounded-xl p-2">
        <p className="text-[9.5px] font-extrabold text-gray-400 tracking-widest px-2 py-1">オプション</p>
        {OPTION_NAV.map((n, i) => (
          <button key={n.id} type="button"
            onClick={() => document.getElementById(n.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
            className={`w-full text-left text-[11.5px] px-2.5 py-1.5 rounded-md ${
              active === n.id
                ? "font-bold bg-red-50 text-red-600 border-l-2 border-red-500"
                : "text-gray-500 hover:bg-gray-50"}`}>
            {i + 1} {n.label}
          </button>
        ))}
      </div>
    </nav>
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
  const isLast = page >= sections.length - 1;

  /**
   * 「会員＋外部」では、見え方が2通りある。
   *   ・ログイン会員   … 氏名・メールは自動入力。連絡先の入力欄は出ない
   *   ・未ログイン(外部) … 最終ページに「ご連絡先」の入力欄が出る
   * プレビューはこの2つを切り替えて確認できるようにする。
   */
  const allowGuest = form.visibility === "both";
  const [asGuest, setAsGuest] = useState(true);
  const showGuest = allowGuest && asGuest && isLast;

  return (
    <aside className="lg:sticky lg:top-4">
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <p className="text-[11.5px] font-bold text-gray-500">回答画面プレビュー</p>
        {allowGuest && (
          <div className="ml-auto flex rounded-lg border border-gray-200 overflow-hidden">
            {([[false, "会員"], [true, "未ログイン（外部）"]] as const).map(([g, l]) => (
              <button key={l} onClick={() => setAsGuest(g)}
                className={`px-2 py-1 text-[10.5px] font-bold ${
                  asGuest === g ? "bg-neutral-800 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                {l}
              </button>
            ))}
          </div>
        )}
      </div>
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

              {/* 未ログイン（外部）の最終ページに出る連絡先。設定した見出し・ラベルを反映。
                  設問で賄っている項目は実画面と同じく出さない。 */}
              {showGuest && (() => {
                const gc = form.design.guestContact ?? DEFAULT_GUEST_CONTACT;
                const ws = [
                  ...form.afterActions,
                  ...form.sections.flatMap((s) => s.fields.flatMap((f) => (f.options ?? []).flatMap((o) => o.actions ?? []))),
                ].some((a) => a.type === "member_signup");
                const need = guestContactNeed(form, answers);
                if (!need.show) {
                  return (
                    <div className="bg-white rounded-xl border border-emerald-200 p-3 scale-[0.94] origin-top">
                      <p className="text-[10px] font-bold text-emerald-700 mb-1">✓ 設問の入力をそのまま使います</p>
                      <p className="text-[10px] text-gray-500 leading-relaxed">
                        氏名・メールの設問があるため、ご連絡先欄は表示されません。
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="bg-white rounded-xl border border-gray-200 overflow-hidden scale-[0.94] origin-top">
                    <div className={`px-3 py-1.5 ${BAND_REQUIRED}`}>
                      <span className="text-[11px] font-bold tracking-wide text-white">{gc.title}</span>
                    </div>
                    <div className="p-3">
                      {gc.note && <p className="text-[10px] text-gray-500 mb-2">{gc.note}</p>}
                      <div className="space-y-1.5">
                        {need.showName && (
                          <div className="border border-gray-300 rounded-lg px-2.5 py-2 text-[11.5px] text-gray-400">{gc.nameLabel}{gc.nameRequired ? "（必須）" : ""}</div>
                        )}
                        {need.showEmail && (
                          <div className="border border-gray-300 rounded-lg px-2.5 py-2 text-[11.5px] text-gray-400">{gc.emailLabel}{(gc.emailRequired || ws) ? "（必須）" : ""}</div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* 会員（ログイン中）の最終ページに出る本人確認カード。実画面（PublicForm）と同じ。 */}
              {allowGuest && !asGuest && isLast && (
                <div className="bg-white rounded-xl border border-gray-200 p-3 scale-[0.94] origin-top">
                  <p className="text-[10px] font-bold text-emerald-600 mb-2">✓ このアカウントとして回答します</p>
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-full bg-red-100 text-red-700 text-[11px] font-bold grid place-items-center shrink-0">佐</span>
                    <div className="min-w-0">
                      <div className="text-[12px] font-bold text-gray-800">佐藤 要</div>
                      <div className="text-[10px] text-gray-500 font-mono truncate">office@topweb.jp</div>
                    </div>
                  </div>
                </div>
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
        {allowGuest
          ? (asGuest
              ? "未ログインの方には、最終ページに「ご連絡先」の入力欄が出ます。見出し・ラベルは上の設定で変えられます。"
              : "会員には、送信ボタンの手前に本人のアカウント（氏名・メール）が確認用に表示され、回答は本人に紐付きます。")
          : "「会員のみ」のため、未ログインの方は開けません。会員には本人のアカウントが確認用に表示されます。"}
      </p>
    </aside>
  );
}
