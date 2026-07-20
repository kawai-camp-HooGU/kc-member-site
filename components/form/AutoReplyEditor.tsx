"use client";
// ============================================================
// 自動返信メールの設定（フォーム編集 ＞ オプションタブ）
//   本文は「ブロックの配列」で持つ。各ブロックに表示条件を付けられ、
//   条件を満たしたブロックだけを上から連結したものが本文になる。
//   ⚠️ 条件の型は設問の分岐（FieldCondition）と同じものを使い回している。
//      分岐UIと挙動を揃えるため（isVisible を共用）。
// ============================================================
import { useMemo } from "react";
import { buildAutoReply } from "../../lib/formParse";
import type { AnswerMap } from "../../lib/formParse";
import type { AutoReply, AutoReplyBlock, FieldCondition, FormDef, FormField } from "../../lib/models";
import { AUTO_REPLY_VARIABLES, IS_DISPLAY_ONLY } from "../../lib/models";

const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";
const lbl = "text-[11.5px] font-bold text-gray-600 mb-1 block";
const sel = "border border-gray-200 rounded-lg px-2 py-1.5 text-[12px] bg-white focus:outline-none focus:border-red-400";

interface Props {
  form: FormDef;
  value: AutoReply;
  onChange: (a: AutoReply) => void;
  /** 宛先の取得元として表示する設問（登録先＝メール）。無ければご連絡先欄。 */
  emailSourceLabel: string;
}

export function AutoReplyEditor({ form, value, onChange, emailSourceLabel }: Props) {
  const set = <K extends keyof AutoReply>(k: K, v: AutoReply[K]) => onChange({ ...value, [k]: v });

  // 条件に使える設問（選択式のみ）と、差し込みに使える設問
  const branchTargets = useMemo(
    () => form.sections.flatMap((s) => s.fields.filter((f) => ["radio", "select", "checkbox", "pref"].includes(f.type))),
    [form.sections],
  );
  const answerable = useMemo(
    () => form.sections.flatMap((s) => s.fields.filter((f) => !IS_DISPLAY_ONLY(f.type) && f.label.trim() !== "")),
    [form.sections],
  );

  const setBlock = (i: number, patch: Partial<AutoReplyBlock>) =>
    set("blocks", value.blocks.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  const addBlock = () => set("blocks", [...value.blocks, { condition: null, body: "" }]);
  const delBlock = (i: number) => set("blocks", value.blocks.filter((_, idx) => idx !== i));
  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.blocks.length) return;
    const arr = [...value.blocks];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("blocks", arr);
  };

  /** カーソル位置は取らず、末尾に足すだけの簡易挿入 */
  const appendToBlock = (i: number, token: string) =>
    setBlock(i, { body: (value.blocks[i]?.body ?? "") + token });

  if (!value.enabled) {
    return (
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" className="mt-0.5 w-4 h-4 accent-red-600"
          checked={false} onChange={() => onChange({ ...value, enabled: true, blocks: value.blocks.length ? value.blocks : [{ condition: null, body: "" }] })} />
        <span>
          <span className="text-[12.5px] font-bold text-gray-800">自動返信メールを送る</span>
          <span className="block text-[11px] text-gray-500 mt-0.5 leading-relaxed">
            回答者本人へ、送信完了と同時に自動でメールを送ります。メールアドレスが取得できない回答ではスキップされます。
          </span>
        </span>
      </label>
    );
  }

  return (
    <div className="space-y-3">
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" className="mt-0.5 w-4 h-4 accent-red-600"
          checked onChange={() => set("enabled", false)} />
        <span className="text-[12.5px] font-bold text-gray-800">自動返信メールを送る</span>
      </label>

      {/* 宛先・差出人 */}
      <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <span className={lbl}>宛先 <span className="text-gray-400 font-normal">自動</span></span>
            <div className="w-full border border-gray-200 bg-gray-50 rounded-lg px-3 py-2 text-[12.5px] text-gray-600">
              {emailSourceLabel}
            </div>
          </div>
          <div>
            <span className={lbl}>差出人名 <span className="text-gray-400 font-normal">空欄で既定</span></span>
            <input className={inputCls} value={value.fromName}
              onChange={(e) => set("fromName", e.target.value)} placeholder="KAWAI CAMP 事務局" />
          </div>
        </div>
        <label className="flex items-center gap-2 text-[12px] font-bold text-gray-600 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-red-600"
            checked={value.bccStaff} onChange={(e) => set("bccStaff", e.target.checked)} />
          運営（管理者・オペレーター）にも控えを送る
        </label>
      </div>

      {/* 件名 */}
      <div className="border border-gray-200 rounded-xl p-3 bg-white">
        <span className={lbl}>件名</span>
        <div className="flex flex-wrap gap-1 mb-1.5">
          {AUTO_REPLY_VARIABLES.filter((v) => v.token !== "{{回答内容ぜんぶ}}").map((v) => (
            <button key={v.token} type="button" onClick={() => set("subject", value.subject + v.token)}
              className="text-[11px] border border-purple-200 bg-purple-50 text-purple-700 rounded px-1.5 py-0.5 font-semibold">
              {v.token}
            </button>
          ))}
        </div>
        <input className={inputCls} value={value.subject} onChange={(e) => set("subject", e.target.value)}
          placeholder="【KAWAI CAMP】{{氏名}} 様　お申込みを受け付けました" />
      </div>

      {/* 本文ブロック */}
      <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-extrabold text-gray-700">本文</span>
          <span className="text-[10.5px] text-gray-400">上から順に、条件を満たしたブロックだけが連結されます</span>
        </div>

        {value.blocks.length === 0 && (
          <p className="text-[11.5px] text-gray-400">本文ブロックがありません。下のボタンから追加してください。</p>
        )}

        {value.blocks.map((b, i) => (
          <div key={i} className={`rounded-xl overflow-hidden border ${b.condition ? "border-amber-200" : "border-gray-200"}`}>
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${
              b.condition ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
              <span className={`w-5 h-5 rounded text-white text-[10px] font-bold grid place-items-center ${
                b.condition ? "bg-amber-500" : "bg-neutral-800"}`}>{i + 1}</span>
              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                b.condition ? "bg-amber-200 text-amber-800" : "bg-gray-200 text-gray-500"}`}>
                {b.condition ? "条件つき" : "条件なし（常に表示）"}
              </span>
              <span className="flex-1" />
              <button type="button" onClick={() => moveBlock(i, -1)} disabled={i === 0}
                className="text-[12px] text-gray-400 hover:text-gray-700 disabled:opacity-30">↑</button>
              <button type="button" onClick={() => moveBlock(i, 1)} disabled={i === value.blocks.length - 1}
                className="text-[12px] text-gray-400 hover:text-gray-700 disabled:opacity-30">↓</button>
              <button type="button" onClick={() => delBlock(i)}
                className="text-[11.5px] font-bold text-gray-400 hover:text-red-600">削除</button>
            </div>
            <div className="p-3">
              <CondRow cond={b.condition} targets={branchTargets}
                onChange={(c) => setBlock(i, { condition: c })} />
              <div className="flex flex-wrap gap-1 my-1.5">
                {AUTO_REPLY_VARIABLES.map((v) => (
                  <button key={v.token} type="button" onClick={() => appendToBlock(i, v.token)}
                    className="text-[11px] border border-purple-200 bg-purple-50 text-purple-700 rounded px-1.5 py-0.5 font-semibold">
                    {v.token}
                  </button>
                ))}
                {answerable.slice(0, 8).map((f) => (
                  <button key={f.id} type="button" onClick={() => appendToBlock(i, `{{Q:${f.label}}}`)}
                    className="text-[11px] border border-gray-200 bg-gray-50 text-gray-600 rounded px-1.5 py-0.5 font-semibold">
                    {`{{Q:${f.label}}}`}
                  </button>
                ))}
              </div>
              <textarea className={`${inputCls} min-h-[90px]`} value={b.body}
                onChange={(e) => setBlock(i, { body: e.target.value })}
                placeholder={"{{氏名}} 様\n\nこのたびはお申込みいただきありがとうございます。\n\n{{回答内容ぜんぶ}}"} />
            </div>
          </div>
        ))}

        <button type="button" onClick={addBlock}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl py-2.5 text-[12.5px] font-bold text-gray-500 hover:border-red-300 hover:text-red-600">
          ＋ 本文ブロックを追加
        </button>
      </div>

      <MailPreview form={form} value={value} targets={branchTargets} />
    </div>
  );
}

// ── 条件1行（分岐タブの CondRow と同じ操作感に揃える）────────
function CondRow({
  cond, targets, onChange,
}: {
  cond: FieldCondition | null;
  targets: FormField[];
  onChange: (c: FieldCondition | null) => void;
}) {
  const target = targets.find((t) => t.id === cond?.fieldId);
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

// ── プレビュー ────────────────────────────────────────────────
/**
 * 条件つきブロックを含めた「実際に送られる文面」を出す。
 * 条件は最初のブロックの条件を満たす回答を仮に置いて評価する
 * （設定画面で分岐の結果を確かめられるようにするため）。
 */
function MailPreview({
  form, value, targets,
}: {
  form: FormDef; value: AutoReply; targets: FormField[];
}) {
  // 条件つきブロックの条件をすべて満たす仮の回答を組み立てる
  const answers = useMemo<AnswerMap>(() => {
    const a: AnswerMap = {};
    for (const b of value.blocks) {
      if (b.condition?.op === "eq") a[b.condition.fieldId] = b.condition.value;
    }
    return a;
  }, [value.blocks]);

  const built = useMemo(
    () => buildAutoReply({ ...form, design: { ...form.design, autoReply: value } }, answers, {
      formName: form.name || form.title || "フォーム",
      name: "山田 太郎",
      email: "taro@example.com",
      answeredAt: new Date(),
    }),
    [form, value, answers],
  );

  const hitLabels = value.blocks
    .filter((b) => b.condition?.op === "eq")
    .map((b) => {
      const t = targets.find((x) => x.id === b.condition?.fieldId);
      return `${t?.label || "設問"}＝${b.condition?.value || "（未選択）"}`;
    });

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] font-bold text-gray-600">プレビュー</span>
        {hitLabels.length > 0 && (
          <span className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            条件：{hitLabels.join(" / ")} を満たした場合
          </span>
        )}
      </div>
      {built ? (
        <div>
          <div className="px-3.5 py-2.5 bg-neutral-900 text-white">
            <p className="text-[10px] opacity-60">FROM　{value.fromName || "KAWAI CAMP 事務局"}</p>
            <p className="text-[12.5px] font-bold mt-0.5">{built.subject}</p>
          </div>
          <pre className="px-3.5 py-3 text-[12px] leading-relaxed text-gray-700 whitespace-pre-wrap font-sans">
            {built.text}
          </pre>
        </div>
      ) : (
        <p className="px-3.5 py-4 text-[11.5px] text-gray-400">
          本文が空のため送信されません。ブロックに本文を入力してください。
        </p>
      )}
    </div>
  );
}
