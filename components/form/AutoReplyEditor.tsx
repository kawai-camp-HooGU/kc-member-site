"use client";
// ============================================================
// 自動返信メールの設定（フォーム編集 ＞ オプションタブ）
//   本文は「ブロックの配列」で持つ。各ブロックに表示条件を複数付けられ、
//   条件を満たしたブロックだけを上から連結したものが本文になる。
//   ⚠️ 条件の型は設問の分岐（FieldCondition）と同じものを使い回している。
//      分岐UIと挙動を揃えるため（isVisible を共用）。
//   ⚠️ 条件は配列（conditions）＋ AND/OR（condMatch）で持つ。旧データの
//      単体 condition は formParse の toDesign が読込時に畳んでくれるので、
//      ここでは配列だけを見ればよい。
// ============================================================
import { useMemo, useRef, useState } from "react";
import { buildAutoReply, isVisibleAll } from "../../lib/formParse";
import { apiFetch } from "../../lib/apiClient";
import { errMessage } from "../../lib/errors";
import { TokenText } from "./TokenText";
import type { TokenTextHandle } from "./TokenText";
import type { AnswerMap } from "../../lib/formParse";
import type { AutoReply, AutoReplyBlock, CondMatch, FieldCondition, FormDef, FormField } from "../../lib/models";
import { AUTO_REPLY_VARIABLES, COND_MATCH_LABEL, IS_DISPLAY_ONLY } from "../../lib/models";

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

  const addBlock = () => set("blocks", [...value.blocks, { conditions: [], condMatch: "all", body: "" }]);
  const delBlock = (i: number) => set("blocks", value.blocks.filter((_, idx) => idx !== i));
  const moveBlock = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= value.blocks.length) return;
    const arr = [...value.blocks];
    [arr[i], arr[j]] = [arr[j], arr[i]];
    set("blocks", arr);
  };

  // 入力欄への差し込みはカーソル位置に入れる（末尾固定だと書き直しが面倒）
  const subjectRef = useRef<TokenTextHandle | null>(null);
  const bodyRefs = useRef<Record<number, TokenTextHandle | null>>({});
  const insertToBlock = (i: number, token: string) => {
    const h = bodyRefs.current[i];
    if (h) h.insert(token);
    else setBlock(i, { body: (value.blocks[i]?.body ?? "") + token });
  };

  /**
   * 紫でハイライトする「既知の変数」。
   * ここに無いトークン（閉じ忘れ・設問名の変更で外れたもの）は赤く出る。
   */
  const knownTokens = useMemo(
    () => new Set([...AUTO_REPLY_VARIABLES.map((v) => v.token), ...answerable.map((f) => `{{Q:${f.label}}}`)]),
    [answerable],
  );

  if (!value.enabled) {
    return (
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input type="checkbox" className="mt-0.5 w-4 h-4 accent-red-600"
          checked={false} onChange={() => onChange({ ...value, enabled: true, blocks: value.blocks.length ? value.blocks : [{ conditions: [], condMatch: "all", body: "" }] })} />
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
            <button key={v.token} type="button"
              onClick={() => (subjectRef.current ? subjectRef.current.insert(v.token) : set("subject", value.subject + v.token))}
              className="text-[11px] border border-purple-200 bg-purple-50 text-purple-700 rounded px-1.5 py-0.5 font-semibold">
              {v.token}
            </button>
          ))}
        </div>
        <TokenText ref={subjectRef} multiline={false} knownTokens={knownTokens}
          value={value.subject} onChange={(v) => set("subject", v)}
          placeholder="【KAWAI CAMP】{{氏名}} 様　お申込みを受け付けました" />
      </div>

      {/* 本文ブロック */}
      <div className="border border-gray-200 rounded-xl p-3 bg-white space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[12px] font-extrabold text-gray-700">本文</span>
          <span className="text-[10.5px] text-gray-400">上から順に、条件を満たしたブロックだけが連結されます</span>
          <span className="flex-1" />
          {/* 入力欄のハイライトの読み方。赤は打ち間違いのサイン */}
          <span className="text-[10px] text-gray-400 flex items-center gap-1">
            <span className="tok px-1">{"{{変数}}"}</span>差し込まれます
            <span className="tok-bad px-1 ml-1">{"{{未定義}}"}</span>そのまま出ます
          </span>
        </div>

        {value.blocks.length === 0 && (
          <p className="text-[11.5px] text-gray-400">本文ブロックがありません。下のボタンから追加してください。</p>
        )}

        {value.blocks.map((b, i) => (
          <div key={i} className={`rounded-xl overflow-hidden border ${b.conditions.length ? "border-amber-200" : "border-gray-200"}`}>
            <div className={`flex items-center gap-2 px-3 py-2 border-b ${
              b.conditions.length ? "bg-amber-50 border-amber-200" : "bg-gray-50 border-gray-200"}`}>
              <span className={`w-5 h-5 rounded text-white text-[10px] font-bold grid place-items-center ${
                b.conditions.length ? "bg-amber-500" : "bg-neutral-800"}`}>{i + 1}</span>
              <span className={`text-[10.5px] font-bold rounded-full px-2 py-0.5 ${
                b.conditions.length ? "bg-amber-200 text-amber-800" : "bg-gray-200 text-gray-500"}`}>
                {b.conditions.length === 0 ? "条件なし（常に表示）"
                  : b.conditions.length === 1 ? "条件つき"
                  : `条件つき ${b.conditions.length}件・${b.condMatch === "any" ? "OR" : "AND"}`}
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
              <CondList conditions={b.conditions} match={b.condMatch} targets={branchTargets}
                onChange={(conditions, condMatch) => setBlock(i, { conditions, condMatch })} />
              <div className="flex flex-wrap gap-1 my-1.5">
                {AUTO_REPLY_VARIABLES.map((v) => (
                  <button key={v.token} type="button" onClick={() => insertToBlock(i, v.token)}
                    className="text-[11px] border border-purple-200 bg-purple-50 text-purple-700 rounded px-1.5 py-0.5 font-semibold">
                    {v.token}
                  </button>
                ))}
                {answerable.slice(0, 8).map((f) => (
                  <button key={f.id} type="button" onClick={() => insertToBlock(i, `{{Q:${f.label}}}`)}
                    className="text-[11px] border border-gray-200 bg-gray-50 text-gray-600 rounded px-1.5 py-0.5 font-semibold">
                    {`{{Q:${f.label}}}`}
                  </button>
                ))}
              </div>
              <TokenText ref={(h) => { bodyRefs.current[i] = h; }} knownTokens={knownTokens}
                value={b.body} onChange={(v) => setBlock(i, { body: v })}
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
      <TestSend form={form} value={value} />
    </div>
  );
}

// ── プレビュー／テスト送信用の仮の回答 ────────────────────────
/**
 * 条件つきブロックがなるべく全部出るような「仮の回答」を組み立てる。
 *   eq 条件の値を素直に置くだけ。同じ設問に複数の値が要る場合は配列で持つ
 *   （isVisible が配列を includes で見るので、複数選択の設問と同じ扱いになる）。
 *   neq 条件は「未回答＝その値ではない」で自然に満たされるので何も置かない。
 */
function sampleAnswers(blocks: AutoReplyBlock[]): AnswerMap {
  const a: AnswerMap = {};
  for (const b of blocks) {
    for (const c of b.conditions) {
      if (c.op !== "eq" || !c.value) continue;
      const cur = a[c.fieldId];
      if (cur === undefined) a[c.fieldId] = c.value;
      else {
        const list = Array.isArray(cur) ? cur : [cur];
        if (!list.includes(c.value)) a[c.fieldId] = [...list, c.value];
      }
    }
  }
  return a;
}

// ── テスト送信 ────────────────────────────────────────────────
/**
 * 「届かない」ときの切り分け用。編集中（未保存）の内容のまま送れる。
 * SMTP未設定・本文空・条件不成立は、それぞれ別のメッセージが返る。
 */
function TestSend({ form, value }: { form: FormDef; value: AutoReply }) {
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const send = async () => {
    setBusy(true); setMsg(null);
    try {
      // 条件つきブロックがすべて出るように仮の回答を組み立てる（プレビューと同じ）
      const answers = sampleAnswers(value.blocks);
      const res = await apiFetch("/api/form/auto-reply/test", {
        method: "POST",
        body: { email: to, form: { ...form, design: { ...form.design, autoReply: value } }, answers },
      });
      const json = (await res.json()) as { success?: boolean; error?: string };
      setMsg(res.ok && json.success
        ? { ok: true, text: `${to} へテスト送信しました。数分たっても届かない場合は迷惑メールフォルダもご確認ください。` }
        : { ok: false, text: json.error ?? "送信に失敗しました" });
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    }
    setBusy(false);
  };

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-white">
      <span className={lbl}>テスト送信 <span className="text-gray-400 font-normal">保存しなくても試せます</span></span>
      <div className="flex gap-2 flex-wrap">
        <input className={`${inputCls} flex-1 min-w-[200px]`} value={to} type="email"
          onChange={(e) => setTo(e.target.value)} placeholder="送信先メールアドレス" />
        <button type="button" onClick={send} disabled={busy || !to.includes("@")}
          className="px-4 py-2 rounded-lg bg-neutral-800 text-white text-[12.5px] font-bold whitespace-nowrap disabled:opacity-40">
          {busy ? "送信中…" : "テスト送信"}
        </button>
      </div>
      {msg && (
        <p className={`text-[11.5px] mt-2 leading-relaxed ${msg.ok ? "text-emerald-700" : "text-red-600"}`}>
          {msg.text}
        </p>
      )}
    </div>
  );
}

// ── 表示条件（複数）────────────────────────────────────────────
/**
 * 1ブロックの表示条件をまとめて編集する。
 *   条件0件＝常に表示。1件目は「条件なし」を選ぶと丸ごと外れる（従来の操作感）。
 *   2件以上になったときだけ AND/OR の切替を出す（1件のときは意味が無く、
 *   出すと逆に「何か設定しないといけないのか」と迷わせるため）。
 */
function CondList({
  conditions, match, targets, onChange,
}: {
  conditions: FieldCondition[];
  match: CondMatch;
  targets: FormField[];
  onChange: (conditions: FieldCondition[], match: CondMatch) => void;
}) {
  const setAt = (i: number, c: FieldCondition | null) =>
    onChange(c ? conditions.map((x, idx) => (idx === i ? c : x)) : conditions.filter((_, idx) => idx !== i), match);
  const add = () =>
    onChange([...conditions, { fieldId: targets[0]?.id ?? 0, op: "eq", value: "" }], match);

  if (conditions.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <CondRow cond={null} targets={targets} onChange={(c) => onChange(c ? [c] : [], match)} />
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {conditions.length > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10.5px] font-bold text-amber-700">複数条件</span>
          <select className={sel} value={match}
            onChange={(e) => onChange(conditions, e.target.value as CondMatch)}>
            {(Object.keys(COND_MATCH_LABEL) as CondMatch[]).map((m) => (
              <option key={m} value={m}>{COND_MATCH_LABEL[m]}</option>
            ))}
          </select>
        </div>
      )}
      {conditions.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          {conditions.length > 1 && (
            <span className="text-[10px] font-bold text-amber-600 w-8 shrink-0">
              {i === 0 ? "" : match === "any" ? "または" : "かつ"}
            </span>
          )}
          <CondRow cond={c} targets={targets} onChange={(next) => setAt(i, next)} />
          {conditions.length > 1 && (
            <button type="button" onClick={() => setAt(i, null)}
              className="text-[11px] font-bold text-gray-400 hover:text-red-600 px-1">×</button>
          )}
        </div>
      ))}
      <button type="button" onClick={add} disabled={targets.length === 0}
        className="text-[11px] font-bold text-amber-700 hover:text-amber-900 disabled:opacity-40">
        ＋ 条件を追加
      </button>
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
  const answers = useMemo<AnswerMap>(() => sampleAnswers(value.blocks), [value.blocks]);

  const built = useMemo(
    () => buildAutoReply({ ...form, design: { ...form.design, autoReply: value } }, answers, {
      formName: form.name || form.title || "フォーム",
      name: "山田 太郎",
      email: "taro@example.com",
      answeredAt: new Date(),
    }),
    [form, value, answers],
  );

  // 仮の回答でどのブロックが出たか＝この文面がどの条件のときのものか
  const hitLabels = value.blocks
    .flatMap((b) => b.conditions)
    .filter((c) => c.op === "eq")
    .map((c) => {
      const t = targets.find((x) => x.id === c.fieldId);
      return `${t?.label || "設問"}＝${c.value || "（未選択）"}`;
    });
  const shownNos = value.blocks
    .map((b, i) => (isVisibleAll(b.conditions, b.condMatch, answers) ? i + 1 : null))
    .filter((n): n is number => n !== null);

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2 flex-wrap">
        <span className="text-[11.5px] font-bold text-gray-600">プレビュー</span>
        {hitLabels.length > 0 && (
          <span className="text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
            条件：{hitLabels.join(" / ")} を満たした場合
          </span>
        )}
        {shownNos.length > 0 && value.blocks.length > 1 && (
          <span className="text-[10.5px] text-gray-500 bg-gray-100 border border-gray-200 rounded px-1.5 py-0.5">
            出力ブロック：{shownNos.join("・")}
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
