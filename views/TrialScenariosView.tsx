"use client";
// ============================================================
// 体験シナリオ（運営）— 一覧 → 編集フォーム
//   ・develop.md §7 の画面パターン②（一覧 → 編集フォーム）。
//   ・★JSONを手で書かせない。ステップ・入力項目・観点は専用の欄で編む。
//   ・保存前に「実際にAIへ渡る全文」を見られる。試し生成もできる（費用が出る）。
//   ・権限は既存 bot_manage（新しい権限キーは作らない）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { sanitizeHtml } from "../lib/ai/sanitize";
import { SUCCESS_CONFIG } from "../lib/constants";
import { Icon } from "../components/common/Icon";
import {
  loadScenarios, loadScenarioFull, saveScenario, retireScenario,
  loadFormOptions, previewPrompt, validateScenario, warnScenario, emptyScenario,
  type ScenarioDraft, type StepDraft, type CriterionDraft, type TrialScenarioRow,
} from "../lib/bot/trial/trialAdmin";
import type { TrialInputDef, TrialOutputKind } from "../lib/bot/trial/types";

const IN = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800";
const KIND_LABEL: Record<TrialOutputKind, string> = {
  html: "HTML（一枚もの）", text: "テキスト", image: "画像", pdf: "PDF（印刷向けHTML）",
};

export function TrialScenariosView() {
  const [rows, setRows] = useState<TrialScenarioRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<ScenarioDraft | null>(null);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await loadScenarios());
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  if (draft) {
    return (
      <ScenarioEditor
        initial={draft}
        onClose={() => { setDraft(null); void reload(); }}
        onMessage={setMsg}
      />
    );
  }

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-gray-900">体験シナリオ</h1>
          <p className="text-xs text-gray-500">
            体験版チャットで何を作るかを決めます。ここで設定したプロンプトが、体験版URLから使われます。
          </p>
        </div>
        <button
          onClick={() => setDraft(emptyScenario())}
          className="shrink-0 text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700"
        >
          ＋ 新しい体験
        </button>
      </div>

      {msg && (
        <div className={`text-sm ${SUCCESS_CONFIG.bg} border ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.text} rounded-lg px-3 py-2`}>{msg}</div>
      )}

      {loading ? (
        <div className="border border-gray-200 rounded-xl bg-white px-4 py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        // 空状態②：前提が未設定 → 次の1手のボタンを置く（brand.md §4）
        <div className="border border-gray-200 rounded-xl bg-white px-4 py-8 text-center">
          <p className="text-sm font-bold text-gray-800 mb-1">体験シナリオがまだありません</p>
          <p className="text-xs text-gray-500 mb-4">
            体験版URLを発行しても、シナリオが無いと従来の質問応答だけになります。
          </p>
          <button
            onClick={() => setDraft(emptyScenario())}
            className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700"
          >
            最初の体験をつくる
          </button>
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="tbl-head">
                <th className="text-left px-3 py-2 font-semibold">体験名</th>
                <th className="text-left px-3 py-2 font-semibold">識別子</th>
                <th className="text-left px-3 py-2 font-semibold">成果物</th>
                <th className="text-left px-3 py-2 font-semibold">調整</th>
                <th className="text-left px-3 py-2 font-semibold">提出</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-100">
                  <td className="px-3 py-2 text-gray-800 font-bold">{r.title}</td>
                  <td className="px-3 py-2 text-gray-400"><code className="text-[11px]">{r.slug}</code></td>
                  <td className="px-3 py-2 text-gray-600">{KIND_LABEL[r.output_kind]}</td>
                  <td className="px-3 py-2 text-gray-500">{r.revise_limit} 回</td>
                  <td className="px-3 py-2 text-gray-500">
                    {r.form_timing === "none" ? "なし" : r.form_timing === "entry" ? "入口" : "出口"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => void loadScenarioFull(r.id).then((d) => { if (d) setDraft(d); })}
                      className="text-sm text-red-700 font-bold"
                    >
                      編集
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 編集フォーム ──────────────────────────────────────────────
function ScenarioEditor({
  initial, onClose, onMessage,
}: {
  initial: ScenarioDraft;
  onClose: () => void;
  onMessage: (s: string) => void;
}) {
  const [d, setD] = useState<ScenarioDraft>(initial);
  const [forms, setForms] = useState<{ id: number; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => { void loadFormOptions().then(setForms); }, []);

  const warns = useMemo(() => warnScenario(d), [d]);
  const patch = (p: Partial<ScenarioDraft>) => setD((s) => ({ ...s, ...p }));
  const patchStep = (i: number, p: Partial<StepDraft>) =>
    setD((s) => ({ ...s, steps: s.steps.map((st, j) => (j === i ? { ...st, ...p } : st)) }));

  const onSave = async () => {
    const errs = validateScenario(d);
    setErrors(errs);
    if (errs.length > 0) return;
    setBusy(true);
    const r = await saveScenario(d);
    setBusy(false);
    if (r.error) { setErrors([r.error]); return; }
    onMessage(d.id == null ? "体験を作成しました" : "体験を保存しました");
    onClose();
  };

  const onRetire = async () => {
    if (d.id == null) return;
    // ⚠️ 物理削除しない。過去の体験の履歴が参照している
    if (!window.confirm("この体験を使わないようにします。過去の提出の記録は残ります。よろしいですか？")) return;
    setBusy(true);
    const ok = await retireScenario(d.id);
    setBusy(false);
    if (ok) { onMessage("体験を停止しました"); onClose(); }
  };

  return (
    <div className="max-w-4xl space-y-4">
      <button onClick={onClose} className="text-sm text-gray-500 hover:text-gray-800">← 一覧へ戻る</button>

      <h1 className="text-lg font-bold text-gray-900">
        {d.id == null ? "新しい体験" : `体験を編集：${d.title || "（無題）"}`}
      </h1>

      {errors.length > 0 && (
        <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">
          <ul className="list-disc pl-4 m-0 space-y-0.5">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}
      {warns.length > 0 && (
        <div className="text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          <ul className="list-disc pl-4 m-0 space-y-0.5">
            {warns.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* ── 基本 ── */}
      <section className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <h2 className="text-sm font-bold text-gray-800 m-0">基本</h2>
        <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">体験名（利用者に見えます）</span>
            <input value={d.title} onChange={(e) => patch({ title: e.target.value })} className={IN} />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">識別子（管理用・半角英小文字）</span>
            <input value={d.slug} onChange={(e) => patch({ slug: e.target.value })}
              placeholder="lp-outline" className={IN} disabled={d.id != null} />
            {d.id != null && <span className="block text-[11px] text-gray-400 mt-1">作成後は変更できません</span>}
          </label>
        </div>
        <label className="block text-xs text-gray-600">
          <span className="block mb-1">説明文（体験を開いたとき最初に出ます）</span>
          <textarea value={d.intro} onChange={(e) => patch({ intro: e.target.value })} rows={3} className={IN} />
          <span className="block text-[11px] text-gray-400 mt-1">
            発行するURLごとに差し替えられます（体験版URLの発行画面）。
          </span>
        </label>
        <div className="grid grid-cols-3 gap-3 max-[700px]:grid-cols-1">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">はじめるボタンの文言</span>
            <input value={d.cta_label} onChange={(e) => patch({ cta_label: e.target.value })} className={IN} />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">つくるもの</span>
            <select value={d.output_kind}
              onChange={(e) => patch({ output_kind: e.target.value as TrialOutputKind })} className={IN}>
              {(Object.keys(KIND_LABEL) as TrialOutputKind[]).map((k) =>
                <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">調整できる回数</span>
            <input type="number" min={0} value={d.revise_limit}
              onChange={(e) => patch({ revise_limit: Number(e.target.value) })} className={IN} />
          </label>
        </div>
      </section>

      {/* ── ステップ（プロンプト本体） ── */}
      <section className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800 m-0">つくり方（プロンプト）</h2>
          <button
            onClick={() => patch({
              steps: [...d.steps, { key: `step${d.steps.length + 1}`, label: "", prompt: "", inputs: [] }],
            })}
            className="text-xs text-gray-600 border border-gray-300 rounded-lg px-3 py-1 font-bold hover:bg-gray-50"
          >
            ＋ ステップを足す
          </button>
        </div>

        {d.steps.map((st, i) => (
          <StepEditor
            key={i}
            index={i}
            step={st}
            draft={d}
            canRemove={d.steps.length > 1}
            onChange={(p) => patchStep(i, p)}
            onRemove={() => patch({ steps: d.steps.filter((_, j) => j !== i) })}
          />
        ))}
      </section>

      {/* ── 講評の観点 ── */}
      <section className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-gray-800 m-0">講評の観点</h2>
          <button
            onClick={() => patch({ criteria: [...d.criteria, { key: `c${d.criteria.length + 1}`, label: "" }] })}
            className="text-xs text-gray-600 border border-gray-300 rounded-lg px-3 py-1 font-bold hover:bg-gray-50"
          >
            ＋ 観点を足す
          </button>
        </div>
        <p className="text-xs text-gray-500 m-0">
          担当者が講評を書くときの記入欄の見出しになります。AIが自動で採点することはありません。
        </p>
        {d.criteria.length === 0 ? (
          <p className="text-xs text-gray-400 m-0">観点なし（講評は自由記述だけになります）</p>
        ) : d.criteria.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <input value={c.key} onChange={(e) => patch({
              criteria: d.criteria.map((x, j) => j === i ? { ...x, key: e.target.value } : x),
            })} placeholder="キー" className={`${IN} w-32 shrink-0`} />
            <input value={c.label} onChange={(e) => patch({
              criteria: d.criteria.map((x, j) => j === i ? { ...x, label: e.target.value } : x),
            })} placeholder="見出し（例：言いたいことが1つに絞れているか）" className={IN} />
            <button onClick={() => patch({ criteria: d.criteria.filter((_, j) => j !== i) })}
              className="shrink-0 text-gray-400 hover:text-red-600" title="削除">
              <Icon name="trash" size={16} />
            </button>
          </div>
        ))}
        <label className="block text-xs text-gray-600">
          <span className="block mb-1">書き方のメモ（記入欄のプレースホルダになります）</span>
          <input value={d.tone} onChange={(e) => patch({ tone: e.target.value })}
            placeholder="褒めてから、直すと良くなる点を2つだけ挙げる。専門用語を使わない。" className={IN} />
        </label>
      </section>

      {/* ── 提出 ── */}
      <section className="border border-gray-200 rounded-xl bg-white p-4 space-y-3">
        <h2 className="text-sm font-bold text-gray-800 m-0">提出</h2>
        <div className="grid grid-cols-2 gap-3 max-[700px]:grid-cols-1">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">フォームを挟むタイミング</span>
            <select value={d.form_timing}
              onChange={(e) => patch({ form_timing: e.target.value as ScenarioDraft["form_timing"] })} className={IN}>
              <option value="exit">出口（提出するとき）</option>
              <option value="entry">入口（はじめる前）</option>
              <option value="none">挟まない（提出ボタンを出さない）</option>
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">使うフォーム</span>
            <select value={d.form_id ?? ""} disabled={d.form_timing === "none"}
              onChange={(e) => patch({ form_id: e.target.value ? Number(e.target.value) : null })}
              className={`${IN} disabled:bg-gray-50`}>
              <option value="">（未設定）</option>
              {forms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </label>
        </div>
        <p className="text-xs text-gray-500 m-0">
          講評を返す宛先を取るために使います。フォーム側に「会員登録」の回答後アクションが要ります。
          必須設問があると提出できません。
        </p>
      </section>

      {/* ── 詳細 ── */}
      <details className="border border-gray-200 rounded-xl bg-white p-4">
        <summary className="text-sm font-bold text-gray-800 cursor-pointer">詳しい設定</summary>
        <div className="grid grid-cols-2 gap-3 mt-3 max-[700px]:grid-cols-1">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">生成の上限（トークン）</span>
            <input type="number" min={200} max={8000} value={d.max_tokens}
              onChange={(e) => patch({ max_tokens: Number(e.target.value) })} className={IN} />
            <span className="block text-[11px] text-gray-400 mt-1">大きいほど長く書けますが、費用も上がります。</span>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">モデルの上書き（空なら既定）</span>
            <input value={d.model} onChange={(e) => patch({ model: e.target.value })}
              placeholder="（既定を使う）" className={IN} />
          </label>
        </div>
      </details>

      {/* ── 保存 ── */}
      <div className="flex items-center gap-2 pb-8">
        <button onClick={() => void onSave()} disabled={busy}
          className="text-sm bg-red-600 text-white rounded-lg px-5 py-2 font-bold hover:bg-red-700 disabled:opacity-50">
          {busy ? "保存中…" : "保存する"}
        </button>
        <button onClick={onClose} disabled={busy}
          className="text-sm bg-white border border-gray-300 text-gray-600 rounded-lg px-4 py-2 hover:bg-gray-50">
          キャンセル
        </button>
        {d.id != null && (
          <button onClick={() => void onRetire()} disabled={busy}
            className="ml-auto text-sm text-gray-400 hover:text-red-600">
            この体験を停止する
          </button>
        )}
      </div>
    </div>
  );
}

// ── ステップ1つぶん ──────────────────────────────────────────
function StepEditor({
  index, step, draft, canRemove, onChange, onRemove,
}: {
  index: number;
  step: StepDraft;
  draft: ScenarioDraft;
  canRemove: boolean;
  onChange: (p: Partial<StepDraft>) => void;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState<{ system: string; user: string; output?: string } | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const runPreview = async (run: boolean) => {
    setBusy(true); setErr("");
    try {
      const r = await previewPrompt({ draft, stepIndex: index, values, run });
      setPreview(r);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "プレビューできませんでした");
    } finally {
      setBusy(false);
    }
  };

  const insertVar = (key: string) => onChange({ prompt: `${step.prompt}{{${key}}}` });

  return (
    <div className="border border-gray-200 rounded-lg p-3 space-y-3 bg-neutral-50">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-gray-500 shrink-0">ステップ {index + 1}</span>
        <input value={step.key} onChange={(e) => onChange({ key: e.target.value })}
          placeholder="キー" className={`${IN} w-28 shrink-0 bg-white`} />
        <input value={step.label} onChange={(e) => onChange({ label: e.target.value })}
          placeholder="見出し（例：たたき台をつくる）" className={`${IN} bg-white`} />
        {canRemove && (
          <button onClick={onRemove} className="shrink-0 text-gray-400 hover:text-red-600" title="削除">
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>

      {/* 聞く項目 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-600 font-bold">利用者に聞くこと</span>
          <button
            onClick={() => onChange({
              inputs: [...step.inputs, { key: `v${step.inputs.length + 1}`, label: "", type: "select", options: [""] }],
            })}
            className="text-xs text-gray-600 border border-gray-300 rounded-lg px-2.5 py-1 bg-white hover:bg-gray-50"
          >
            ＋ 項目を足す
          </button>
        </div>
        {step.inputs.length === 0 ? (
          <p className="text-xs text-gray-400 m-0">なし（質問せずにいきなり作ります）</p>
        ) : step.inputs.map((inp, j) => (
          <InputDefEditor
            key={j}
            def={inp}
            onChange={(p) => onChange({ inputs: step.inputs.map((x, k) => (k === j ? { ...x, ...p } : x)) })}
            onRemove={() => onChange({ inputs: step.inputs.filter((_, k) => k !== j) })}
          />
        ))}
      </div>

      {/* プロンプト本体 */}
      <div>
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className="text-xs text-gray-600 font-bold">AIへの指示（プロンプト）</span>
          {step.inputs.map((inp) => (
            <button key={inp.key} onClick={() => insertVar(inp.key)}
              className="text-[11px] bg-white border border-gray-300 rounded-full px-2.5 py-0.5 text-gray-600 hover:border-red-400 hover:text-red-700">
              {`{{${inp.key}}}`} を挿す
            </button>
          ))}
        </div>
        <textarea value={step.prompt} onChange={(e) => onChange({ prompt: e.target.value })}
          rows={8} className={`${IN} bg-white font-mono text-[12.5px] leading-6`}
          placeholder={"あなたは〇〇に詳しい編集者です。次の条件で…\n\n業種：{{industry}}"} />
        <p className="text-[11px] text-gray-400 mt-1 m-0">
          {"{{キー}}"} と書くと、上で聞いた答えがそこに入ります。
          出力の形（HTMLだけ返す等）と注入対策はシステム側で自動的に付くので、ここには書かなくて構いません。
        </p>
      </div>

      {/* プレビュー */}
      <div className="border-t border-gray-200 pt-3">
        <div className="flex items-center gap-2 flex-wrap">
          {step.inputs.map((inp) => (
            <label key={inp.key} className="text-[11px] text-gray-500">
              <span className="block mb-0.5">{inp.label || inp.key}</span>
              {inp.type === "select" ? (
                <select value={values[inp.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white">
                  {(inp.options ?? []).map((o) => <option key={o} value={o}>{o || "（空）"}</option>)}
                </select>
              ) : (
                <input value={values[inp.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-xs bg-white" />
              )}
            </label>
          ))}
          <button onClick={() => void runPreview(false)} disabled={busy}
            className="text-xs bg-white border border-gray-300 text-gray-700 rounded-lg px-3 py-1.5 font-bold hover:bg-gray-50 disabled:opacity-50 self-end">
            渡る内容を見る
          </button>
          <button
            onClick={() => {
              // ⚠️ 実際にAIを呼ぶ＝費用が出る。押す前に一言置く
              if (window.confirm("実際にAIを1回呼びます（費用が発生します）。よろしいですか？")) void runPreview(true);
            }}
            disabled={busy}
            className="text-xs bg-white border border-red-300 text-red-700 rounded-lg px-3 py-1.5 font-bold hover:bg-red-50 disabled:opacity-50 self-end">
            {busy ? "実行中…" : "試しに作ってみる"}
          </button>
        </div>

        {err && <div className="text-xs text-red-600 mt-2">{err}</div>}

        {preview && (
          <div className="mt-3 space-y-2">
            <details className="bg-white border border-gray-200 rounded-lg p-2">
              <summary className="text-xs font-bold text-gray-600 cursor-pointer">AIへ渡る全文</summary>
              <div className="mt-2">
                <div className="text-[11px] text-gray-400 mb-1">system（自動で付く部分）</div>
                <pre className="text-[11px] bg-neutral-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap m-0">{preview.system}</pre>
                <div className="text-[11px] text-gray-400 mt-2 mb-1">user（あなたが書いた指示＋答え）</div>
                <pre className="text-[11px] bg-neutral-50 border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap m-0">{preview.user}</pre>
              </div>
            </details>
            {preview.output != null && (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                <div className="text-xs font-bold text-gray-600 px-2 py-1.5 border-b border-gray-100">できあがったもの</div>
                {draft.output_kind === "html" || draft.output_kind === "pdf" ? (
                  <div className="p-3 text-[13px] leading-7 text-gray-800 max-h-[320px] overflow-y-auto"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(preview.output).html }} />
                ) : (
                  <pre className="p-3 text-[12.5px] leading-6 whitespace-pre-wrap m-0 max-h-[320px] overflow-y-auto">{preview.output}</pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── 入力項目1つぶん ──────────────────────────────────────────
function InputDefEditor({
  def, onChange, onRemove,
}: {
  def: TrialInputDef;
  onChange: (p: Partial<TrialInputDef>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-2 space-y-2">
      <div className="flex items-center gap-2">
        <input value={def.key} onChange={(e) => onChange({ key: e.target.value })}
          placeholder="キー" className={`${IN} w-24 shrink-0 text-xs`} />
        <input value={def.label} onChange={(e) => onChange({ label: e.target.value })}
          placeholder="見出し（例：業種）" className={`${IN} text-xs`} />
        <select value={def.type} onChange={(e) => onChange({ type: e.target.value as TrialInputDef["type"] })}
          className={`${IN} w-32 shrink-0 text-xs`}>
          <option value="select">選択肢から選ぶ</option>
          <option value="text">自由に書く</option>
        </select>
        <button onClick={onRemove} className="shrink-0 text-gray-400 hover:text-red-600" title="削除">
          <Icon name="trash" size={15} />
        </button>
      </div>

      {def.type === "select" ? (
        <div className="flex items-center gap-2 flex-wrap pl-1">
          <span className="text-[11px] text-gray-400">選択肢</span>
          {(def.options ?? []).map((o, i) => (
            <span key={i} className="inline-flex items-center gap-1">
              <input value={o}
                onChange={(e) => onChange({ options: (def.options ?? []).map((x, j) => (j === i ? e.target.value : x)) })}
                className="border border-gray-300 rounded-lg px-2 py-1 text-xs w-32" />
              <button onClick={() => onChange({ options: (def.options ?? []).filter((_, j) => j !== i) })}
                className="text-gray-300 hover:text-red-600 text-xs">×</button>
            </span>
          ))}
          <button onClick={() => onChange({ options: [...(def.options ?? []), ""] })}
            className="text-[11px] text-gray-600 border border-gray-300 rounded-lg px-2 py-1 hover:bg-gray-50">
            ＋ 追加
          </button>
          <span className="text-[11px] text-gray-400">先頭が初期値になります</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 pl-1">
          <label className="text-[11px] text-gray-400">
            文字数の上限
            <input type="number" min={1} max={500} value={def.maxLength ?? 40}
              onChange={(e) => onChange({ maxLength: Number(e.target.value) })}
              className="ml-1 border border-gray-300 rounded-lg px-2 py-1 text-xs w-20" />
          </label>
          <input value={def.placeholder ?? ""} onChange={(e) => onChange({ placeholder: e.target.value })}
            placeholder="入力例（例：無料相談の申込を増やしたい）"
            className="flex-1 border border-gray-300 rounded-lg px-2 py-1 text-xs" />
        </div>
      )}
    </div>
  );
}
