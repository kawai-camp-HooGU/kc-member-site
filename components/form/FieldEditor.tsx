"use client";
// ============================================================
// 設問ブロックの編集（1件）
//   種類の変更 / 必須 / 入力規則 / 登録先 / 選択肢＋選択時アクション
// ============================================================
import { useState } from "react";
import { ActionEditor } from "./ActionEditor";
import type { ScenarioOpt } from "./ActionEditor";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import type { FieldRule, FieldType, FormField, FormOption, SaveTarget } from "../../lib/models";
import { FIELD_RULE_LABEL, FIELD_TYPE_LABEL, HAS_OPTIONS, SAVE_TARGET_LABEL } from "../../lib/models";
import { renderBodyHtml } from "../../lib/richText";
import { FIELD_INPUT, FIELD_LABEL } from "../../lib/constants";
const inputCls = FIELD_INPUT;
const lbl = FIELD_LABEL;

interface Props {
  f: FormField;
  open: boolean;
  onToggle: () => void;
  onChange: (f: FormField) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
  tree: AttrNode[];
  index: AttrIndex;
  scenarios: ScenarioOpt[];
}

export function FieldEditor({ f, open, onToggle, onChange, onRemove, onMove, tree, index, scenarios }: Props) {
  const [actOpt, setActOpt] = useState<number | null>(null);   // アクション編集中の選択肢
  const set = <K extends keyof FormField>(k: K, v: FormField[K]) => onChange({ ...f, [k]: v });
  const hasOpts = HAS_OPTIONS.includes(f.type);
  const isText = f.type === "text" || f.type === "textarea" || f.type === "number";
  const isDisplay = f.type === "heading";

  const setOpt = (i: number, patch: Partial<FormOption>) =>
    set("options", f.options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  const addOpt = () => set("options", [...f.options, { label: `選択肢${f.options.length + 1}`, actions: [] }]);
  const delOpt = (i: number) => set("options", f.options.filter((_, idx) => idx !== i));

  const actCount = f.options.reduce((n, o) => n + o.actions.length, 0);

  return (
    <div className={`border rounded-xl bg-white mb-2 ${open ? "border-red-400 ring-2 ring-red-50" : "border-gray-200"}`}>
      {/* ヘッダー行 */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer" onClick={onToggle}>
        <span className="text-[10.5px] font-bold text-blue-700 bg-blue-50 rounded px-1.5 py-0.5 whitespace-nowrap">
          {FIELD_TYPE_LABEL[f.type].replace(/（.*）/, "")}
        </span>
        <span className="text-[13px] font-bold flex-1 truncate">{f.label || <span className="text-gray-400">（項目名なし）</span>}</span>
        {f.required && <span className="text-[10px] font-bold text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">必須</span>}
        {actCount > 0 && <span className="text-[10px] font-bold text-purple-700 bg-purple-50 rounded-full px-2 py-0.5">🏷 {actCount}</span>}
        {f.saveTo && <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">→ {SAVE_TARGET_LABEL[f.saveTo as SaveTarget]}</span>}
        <span onClick={(e) => { e.stopPropagation(); onMove(-1); }} className="text-gray-300 hover:text-gray-600 text-xs px-1">▲</span>
        <span onClick={(e) => { e.stopPropagation(); onMove(1); }} className="text-gray-300 hover:text-gray-600 text-xs px-1">▼</span>
      </div>

      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-dashed border-gray-200 space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <span className={lbl}>項目名</span>
              <input className={inputCls} value={f.label} onChange={(e) => set("label", e.target.value)} />
            </div>
            <div>
              <span className={lbl}>質問タイプ</span>
              <select className={inputCls} value={f.type}
                onChange={(e) => {
                  const t = e.target.value as FieldType;
                  const needOpts = HAS_OPTIONS.includes(t) && f.options.length === 0;
                  onChange({
                    ...f, type: t,
                    options: needOpts ? [{ label: "選択肢1", actions: [] }, { label: "選択肢2", actions: [] }] : f.options,
                  });
                }}>
                {(Object.keys(FIELD_TYPE_LABEL) as FieldType[]).map((t) => (
                  <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10.5px] font-semibold text-gray-400 tracking-wider">説明文</span>
              {/* テキスト（改行保持）／HTML（サニタイズ表示）の切替 */}
              <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                {([["text", "テキスト"], ["html", "HTML"]] as const).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => set("descHtml", m === "html")}
                    className={`px-2.5 py-0.5 text-[11px] font-bold rounded-md ${
                      (f.descHtml ? "html" : "text") === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {/* textarea にして改行入力を可能に。表示側（PublicForm）はテキストなら改行保持、HTMLはサニタイズ描画。 */}
            <textarea className={`${inputCls} min-h-[72px] ${f.descHtml ? "font-mono text-[12px]" : ""}`}
              value={f.description} onChange={(e) => set("description", e.target.value)}
              placeholder={f.descHtml
                ? "<p>見出しの下の文章</p>\n<ul><li>箇条書き</li></ul>"
                : isDisplay ? "見出しの下に表示する文章（改行可）" : "回答欄の上に表示する補足（改行可）"} />
            {f.descHtml && (
              <>
                <p className="text-[10.5px] text-amber-600 mt-1 leading-relaxed">
                  表示時にサニタイズされます（&lt;script&gt;・on◯◯属性・javascript: は除去）。
                </p>
                {f.description.trim() && (
                  <div className="mt-1.5 border border-gray-200 rounded-lg overflow-hidden">
                    <p className="px-2.5 py-1 bg-gray-50 border-b border-gray-100 text-[10px] font-bold text-gray-500">表示プレビュー</p>
                    <div className="p-2.5 text-[12.5px] text-gray-600 rt-body"
                      dangerouslySetInnerHTML={{ __html: renderBodyHtml("html", "", f.description) }} />
                  </div>
                )}
              </>
            )}
          </div>

          {!isDisplay && (
            <>
              {isText && (
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <span className={lbl}>プレースホルダ</span>
                    <input className={inputCls} value={f.placeholder} onChange={(e) => set("placeholder", e.target.value)} />
                  </div>
                  <div>
                    <span className={lbl}>初期表示</span>
                    <input className={inputCls} value={f.defaultValue} onChange={(e) => set("defaultValue", e.target.value)} />
                  </div>
                </div>
              )}

              <div className="grid sm:grid-cols-3 gap-3">
                {isText && (
                  <div>
                    <span className={lbl}>入力規則</span>
                    <select className={inputCls} value={f.rule} onChange={(e) => set("rule", e.target.value as FieldRule | "")}>
                      <option value="">なし</option>
                      {(Object.keys(FIELD_RULE_LABEL) as FieldRule[]).map((r) => (
                        <option key={r} value={r}>{FIELD_RULE_LABEL[r]}</option>
                      ))}
                    </select>
                  </div>
                )}
                {isText && (
                  <div>
                    <span className={lbl}>文字数（下限 / 上限）</span>
                    <div className="flex gap-2">
                      <input type="number" className={inputCls} value={f.minLen}
                        onChange={(e) => set("minLen", e.target.value === "" ? "" : Number(e.target.value))} />
                      <input type="number" className={inputCls} value={f.maxLen}
                        onChange={(e) => set("maxLen", e.target.value === "" ? "" : Number(e.target.value))} />
                    </div>
                  </div>
                )}
                {f.type === "checkbox" && (
                  <div>
                    <span className={lbl}>選択数の上限</span>
                    <input type="number" className={inputCls} value={f.maxSelect}
                      onChange={(e) => set("maxSelect", e.target.value === "" ? "" : Number(e.target.value))} />
                  </div>
                )}
                <div>
                  <span className={lbl}>回答の登録先（会員情報）</span>
                  <select className={inputCls} value={f.saveTo} onChange={(e) => set("saveTo", e.target.value as SaveTarget | "")}>
                    <option value="">登録しない</option>
                    {(Object.keys(SAVE_TARGET_LABEL) as SaveTarget[]).map((s) => (
                      <option key={s} value={s}>会員情報：{SAVE_TARGET_LABEL[s]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {hasOpts && (
                <div>
                  <span className={lbl}>選択肢と「選択時のアクション」</span>
                  <div className="space-y-1.5">
                    {f.options.map((o, i) => (
                      <div key={i}>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 w-4">{i + 1}</span>
                          <input className={inputCls} value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })} />
                          <button type="button" onClick={() => setActOpt(actOpt === i ? null : i)}
                            className={`text-[11.5px] font-bold rounded-lg px-2.5 py-2 whitespace-nowrap border ${
                              o.actions.length
                                ? "border-purple-200 bg-purple-50 text-purple-700"
                                : "border-gray-200 bg-gray-50 text-gray-500"}`}>
                            🏷 {o.actions.length ? `アクション ${o.actions.length}` : "アクション設定"}
                          </button>
                          <button type="button" onClick={() => delOpt(i)} className="text-gray-300 hover:text-red-600 text-sm px-1">✕</button>
                        </div>
                        {actOpt === i && (
                          <div className="mt-2 mb-3 ml-6 p-3 bg-gray-50 rounded-xl border border-gray-200">
                            <ActionEditor actions={o.actions} onChange={(a) => setOpt(i, { actions: a })}
                              tree={tree} index={index} scenarios={scenarios} allowChat={false} />
                            <button type="button" onClick={() => setActOpt(null)}
                              className="mt-2 text-[11.5px] font-bold text-gray-500">閉じる</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={addOpt} className="mt-2 text-[12px] font-bold text-red-600">＋ 選択肢を追加</button>

                  {/* 選択肢の見せ方（ラジオ・チェックのみ）。カードは申込フォームのコース選択向け。 */}
                  {(f.type === "radio" || f.type === "checkbox") && (
                    <div className="mt-3">
                      <span className={lbl}>選択肢の見せ方</span>
                      <div className="inline-flex bg-gray-100 rounded-lg p-0.5">
                        {([["list", "リスト"], ["card", "カード"]] as const).map(([m, label]) => (
                          <button key={m} type="button" onClick={() => set("optionCards", m === "card")}
                            className={`px-3 py-1 text-[12px] font-bold rounded-md ${
                              (f.optionCards ? "card" : "list") === m ? "bg-white text-gray-800 shadow-sm" : "text-gray-500"}`}>
                            {label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10.5px] text-gray-400 mt-1 leading-relaxed">
                        カードは選択肢を大きく表示します。<b>「｜」（例：AI会社 構築コース｜¥605,000）</b>で区切ると、
                        右側が価格・補足として強調表示されます。
                      </p>
                    </div>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 text-[12.5px] font-bold text-gray-600">
                <input type="checkbox" checked={f.required} onChange={(e) => set("required", e.target.checked)} className="w-4 h-4 accent-red-600" />
                必須項目にする
              </label>
            </>
          )}

          <div className="flex justify-end">
            <button type="button" onClick={onRemove} className="text-[12px] font-bold text-red-600">この項目を削除</button>
          </div>
        </div>
      )}
    </div>
  );
}
