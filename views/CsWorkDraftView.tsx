"use client";
// ============================================================
// CsWork ＞ 起草と整形（REQ-039・ループ STEP 1・2・3）
//
//   STEP 1 投入　　ラフmd を貼るか、ファイルを選ぶ
//   STEP 2 整形結果　現行 spec との差分・充足チェック・AI推定バッジ
//   STEP 3 承認　　採用する変更を選んで確定する
//
//   ⚠️ 承認するまで現行版は切り替わらない。整形は提案であって確定ではない。
//   ⚠️ **投入mdに無いものは消さない。** 「保持 N件」を必ず表示して、
//      1タスク追記したつもりで既存が消えていないことを見せる（設計書 R2）。
//   ⚠️ 送信を伴うタスクに人の関門が無い（MISSING_HUMAN_GATE）間は、
//      承認ボタンを押せない。ここに抜け道を作らない。
//   ⚠️ 管理者のみ（cswork_edit）。
// ============================================================
import { useMemo, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "../components/common/ToastProvider";
import { errMessage } from "../lib/errors";
import { Chip, EmptyBox, levelCls, levelLabel, runnerCls, runnerLabel, saveTextFile } from "../components/cswork/CsWorkParts";
import type { CsDraftOutcome } from "../lib/csWork/payload";
import type { CsSpecTask } from "../lib/csWork/spec";

const SAMPLE = `# 個別面談（販促アプローチ①）
  ## 対象者
    - ウェビナー参加アンケートへの登録者
  ## タスク
    ### 申込チェック
      - フォームへの新規問い合わせの有無を確認
    ### 個別案内送信
      - メール及びLINEにて案内を送信
      - ★[output]へ"要監視顧客（販促）"、"要対応一覧"へ計上。
`;

export function CsWorkDraftView({ onApproved }: { onApproved?: () => void }) {
  const toast = useToast();
  const [sourceMd, setSourceMd] = useState("");
  const [specJson, setSpecJson] = useState("");
  const [filename, setFilename] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<CsDraftOutcome | null>(null);
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<{ docVersion: string; opened: number; autoClosed: number } | null>(null);

  const step = done ? 3 : outcome ? 2 : 1;

  /** 採用する変更の識別子。未採用に落としたものだけ除く。 */
  const accept = useMemo(() => {
    if (!outcome) return [] as string[];
    const ids = new Set<string>();
    for (const c of outcome.changes) {
      if (c.kind === "kept") continue;
      const key = c.task_id ?? `funnel:${c.funnel}`;
      if (!rejected.has(key)) ids.add(key);
    }
    return Array.from(ids);
  }, [outcome, rejected]);

  const readFile = async (file: File, into: "source" | "spec") => {
    if (file.size > 5 * 1024 * 1024) { toast.error("5MBを超えています"); return; }
    const text = await file.text();
    if (into === "source") { setSourceMd(text); setFilename(file.name); }
    else setSpecJson(text);
  };

  const runDraft = async () => {
    if (!sourceMd.trim()) { toast.error("起草mdを入れてください"); return; }
    setBusy(true); setDone(null);
    try {
      const res = await apiFetch("/api/ops/cswork/draft", {
        method: "POST",
        body: { sourceMd, specJson: specJson.trim() || undefined, filename },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "整形に失敗しました"); return; }
      setOutcome(json as CsDraftOutcome);
      setRejected(new Set());
    } catch (e: unknown) {
      toast.error(errMessage(e, "整形に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!outcome?.canApprove) return;
    setBusy(true);
    try {
      const res = await apiFetch("/api/ops/cswork/approve", {
        method: "POST",
        body: { sourceMd, specJson: specJson.trim() || undefined, filename, accept },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "承認に失敗しました"); return; }
      setDone({
        docVersion: json.docVersion,
        opened: json.issueSync?.opened ?? 0,
        autoClosed: json.issueSync?.autoClosed ?? 0,
      });
      toast.success(`v${json.docVersion} を現行版にしました`);
      onApproved?.();
    } catch (e: unknown) {
      toast.error(errMessage(e, "承認に失敗しました"));
    } finally {
      setBusy(false);
    }
  };

  const toggleChange = (key: string) => {
    setRejected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const blockers = outcome?.issues.filter((i) => i.level === "blocker") ?? [];
  const warns = outcome?.issues.filter((i) => i.level === "warn") ?? [];
  const fatal = blockers.filter((i) => i.code === "MISSING_HUMAN_GATE");

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-extrabold">起草と整形</h1>
          <span className="text-xs text-gray-500">ラフなmdを入れると整形されます。承認するまで現行版は切り替わりません</span>
        </div>
        <div className="flex gap-2 items-center mt-3 text-[11.5px]">
          <StepChip n={1} label="投入" on={step >= 1} />
          <span className="text-gray-300">›</span>
          <StepChip n={2} label="整形結果" on={step >= 2} />
          <span className="text-gray-300">›</span>
          <StepChip n={3} label="承認" on={step >= 3} />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {/* STEP 1 */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
          <div className="text-[13px] font-bold mb-2">STEP 1　投入</div>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] font-bold text-gray-600">起草md（必須）</span>
                <label className="text-[11.5px] border border-gray-200 rounded-lg px-2 py-1 cursor-pointer">
                  ファイルを選ぶ
                  <input type="file" accept=".md,.txt" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, "source"); e.currentTarget.value = ""; }} />
                </label>
                <button onClick={() => setSourceMd(SAMPLE)} className="text-[11.5px] border border-gray-200 rounded-lg px-2 py-1">書き方の例</button>
              </div>
              <textarea value={sourceMd} onChange={(e) => setSourceMd(e.target.value)} rows={12}
                placeholder={"# 導線種別\n  ## タスク\n    ### タスク名\n      - やること"}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] font-mono leading-6" />
              <div className="text-[11px] text-gray-500 mt-1 leading-5">
                守るのは3つだけ。<b>#</b>＝導線種別、<b>###</b>＝タスク（行頭の空白は気にしなくて構いません）／送る文面は ``` で囲む／URL・アカウントは <code>{"{{ }}"}</code> で参照する。
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[12px] font-bold text-gray-600">spec JSON（任意）</span>
                <label className="text-[11.5px] border border-gray-200 rounded-lg px-2 py-1 cursor-pointer">
                  ファイルを選ぶ
                  <input type="file" accept=".json" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f, "spec"); e.currentTarget.value = ""; }} />
                </label>
                {specJson && <button onClick={() => setSpecJson("")} className="text-[11.5px] border border-gray-200 rounded-lg px-2 py-1">外す</button>}
              </div>
              <textarea value={specJson} onChange={(e) => setSpecJson(e.target.value)} rows={12}
                placeholder="Claude セッションで整形した spec JSON があれば貼ってください。無ければ空のままで構いません（ポータル側の規則で整形します）"
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] font-mono leading-6" />
              <div className="text-[11px] text-gray-500 mt-1 leading-5">
                貼らなければポータルが規則ベースで整形します。貼れば、その内容が優先されます。<b>どちらでも検証・差分・承認は同じです。</b>
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3 justify-end">
            <button onClick={() => { setSourceMd(""); setSpecJson(""); setOutcome(null); setDone(null); }}
              className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">クリア</button>
            <button onClick={runDraft} disabled={busy || !sourceMd.trim()}
              className="bg-red-600 text-white font-bold rounded-lg px-5 py-2 text-[12.5px] disabled:opacity-40">
              {busy ? "整形中…" : "整形する"}
            </button>
          </div>
        </div>

        {/* STEP 2 */}
        {outcome && (
          <>
            <div className={`rounded-xl px-4 py-2.5 text-[12px] mb-3 border ${
              fatal.length ? "bg-red-50 border-red-200 text-red-700"
              : blockers.length ? "bg-amber-50 border-amber-200 text-amber-800"
              : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
              <b>
                充足チェック：実行不可 {blockers.length}件／要確認 {warns.length}件／AI推定 {outcome.stats.inferred}件
              </b>
              {fatal.length > 0
                ? <> — 送信を伴うタスクに人の関門がありません。<b>このままでは承認できません。</b></>
                : blockers.length > 0
                  ? <> — 実行不可を残したまま承認できます。該当タスクは実行されず、課題として起票されます。</>
                  : <> — 承認できます。</>}
              <span className="ml-2 text-gray-500">
                （整形：{outcome.normalizedBy === "spec-json" ? "投入された spec JSON" : "ポータルの規則"}／設定値：{
                  outcome.settingsFrom === "settings" ? "設定値ファイル" : outcome.settingsFrom === "ops" ? "導線種別md" : "未登録"}）
              </span>
            </div>

            <div className="grid lg:grid-cols-2 gap-3 mb-3">
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 text-[13px] font-bold text-gray-700 border-b border-gray-200 flex items-center gap-2 flex-wrap">
                  現行 spec との差分
                  <Chip cls="bg-emerald-50 text-emerald-700 border-emerald-200">追加 {outcome.summary.added}</Chip>
                  <Chip cls="bg-blue-50 text-blue-700 border-blue-200">更新 {outcome.summary.updated}</Chip>
                  <Chip cls="bg-gray-100 text-gray-500 border-gray-200">保持 {outcome.summary.kept}</Chip>
                </div>
                <div className="p-3 max-h-[380px] overflow-auto">
                  {outcome.changes.filter((c) => c.kind !== "kept").length === 0 && (
                    <div className="text-[12px] text-gray-500 py-6 text-center">現行版と変わりません。</div>
                  )}
                  {outcome.changes.filter((c) => c.kind !== "kept").map((c) => {
                    const key = c.task_id ?? `funnel:${c.funnel}`;
                    const off = rejected.has(key);
                    return (
                      <label key={`${c.kind}-${key}`} className="flex items-start gap-2 py-1.5 border-b border-dashed border-gray-100 text-[12px] cursor-pointer">
                        <input type="checkbox" checked={!off} onChange={() => toggleChange(key)} className="mt-1 accent-red-600" />
                        <span className={off ? "opacity-40" : ""}>
                          <span className={`font-bold mr-1 ${c.kind.startsWith("funnel") ? "text-gray-600" : c.kind === "added" ? "text-emerald-700" : "text-blue-700"}`}>
                            {c.kind === "added" ? "＋追加" : c.kind === "updated" ? "更新" : c.kind === "funnel-added" ? "＋導線" : "導線更新"}
                          </span>
                          {c.label}
                          {c.fields.length > 0 && <span className="text-gray-400 ml-1">（{c.fields.join("・")}）</span>}
                          <span className="text-gray-400 ml-1">{c.funnel}</span>
                        </span>
                      </label>
                    );
                  })}
                  <div className="text-[11px] text-gray-500 mt-2 leading-5">
                    チェックを外した項目は採用しません。<b>投入mdに出てこなかった既存タスク {outcome.summary.kept} 件はそのまま保持されます</b>（差分投入で消えることはありません）。
                  </div>
                </div>
              </div>

              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 text-[13px] font-bold text-gray-700 border-b border-gray-200">充足チェックの内訳</div>
                <div className="p-3 max-h-[380px] overflow-auto">
                  {outcome.issues.length === 0 && (
                    <EmptyBox kind="done" title="不足はありません" hint="このまま承認できます。" />
                  )}
                  {outcome.issues.map((i, idx) => (
                    <div key={idx} className="py-2 border-b border-dashed border-gray-100 text-[12px]">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Chip cls={levelCls(i.level)}>{levelLabel(i.level)}</Chip>
                        <code className="text-[11px] text-gray-500">{i.code}</code>
                        <b>{i.title}</b>
                      </div>
                      <div className="text-gray-600 mt-0.5">{i.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-3">
              <div className="px-4 py-2.5 text-[13px] font-bold text-gray-700 border-b border-gray-200">
                整形後のタスク（{outcome.stats.tasks}件／導線 {outcome.stats.funnels}区分）
              </div>
              <div className="p-3 max-h-[420px] overflow-auto">
                {outcome.spec.funnels.map((f) => (
                  <div key={f.key} className="mb-3">
                    <div className="text-[12.5px] font-bold text-gray-700 mb-1">
                      {f.name}
                      {f.aliases.length > 0 && <span className="text-[11px] text-gray-400 ml-2">別名：{f.aliases.join("・")}</span>}
                    </div>
                    {f.tasks.map((t: CsSpecTask) => (
                      <details key={t.id} className="bg-gray-50 border border-gray-200 rounded-lg mb-1.5">
                        <summary className="px-3 py-2 text-[12px] cursor-pointer flex items-center gap-2 flex-wrap">
                          <b>{t.id}</b> {t.name}
                          <Chip cls="bg-white text-gray-500 border-gray-200">{t.tool}</Chip>
                          <Chip cls={runnerCls(t.runner)}>{runnerLabel(t.runner)}</Chip>
                          {t.inferred.length > 0 && <Chip cls="bg-blue-50 text-blue-700 border-blue-200">AI推定 {t.inferred.length}</Chip>}
                        </summary>
                        <div className="px-3 pb-3 text-[12px] bg-white border-t border-gray-200 pt-2 leading-6">
                          {t.detail && <p>{t.detail}</p>}
                          <div className="text-gray-500">実行条件：{t.trigger || "未設定"}</div>
                          {t.human_gate && <div className="text-red-700 font-bold">人の関門：{t.human_gate}</div>}
                          {t.outputs.length > 0 && <div className="text-gray-500">計上先：{t.outputs.join(" / ")}</div>}
                          {t.branches.map((b, i) => <div key={i} className="text-gray-600">分岐：{b.if}{b.then ? ` → ${b.then}` : ""}</div>)}
                          {t.inferred.length > 0 && (
                            <div className="text-blue-700 mt-1">推定した項目：{t.inferred.join("・")}</div>
                          )}
                        </div>
                      </details>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            {/* STEP 3 */}
            <div className="flex gap-2 justify-end items-center flex-wrap mb-6">
              {fatal.length > 0 && (
                <span className="text-[12px] text-red-700 font-bold mr-auto">
                  {fatal.map((f) => f.title).join(" / ")}　→ 起草mdに <code>- @gate: 送信は人が実施する</code> を足してください
                </span>
              )}
              <button onClick={() => saveTextFile(`spec_draft.json`, JSON.stringify(outcome.spec, null, 2))}
                className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">spec JSON を書き出す</button>
              <button onClick={runDraft} disabled={busy} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">整形をやり直す</button>
              <button onClick={approve} disabled={busy || !outcome.canApprove}
                title={outcome.canApprove ? "現行版を切り替え、指示ファイルを作り直します" : "人の関門が無いタスクがあるため承認できません"}
                className="bg-red-600 text-white font-bold rounded-lg px-5 py-2 text-[12.5px] disabled:opacity-40">
                この内容で承認する
              </button>
            </div>
          </>
        )}

        {done && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-[12.5px] mb-6">
            <b>v{done.docVersion} を現行版にしました。</b>
            指示ファイルを作り直し、課題を {done.opened}件 起票／{done.autoClosed}件 自動クローズしました。
            「実行」画面で指示ファイルを確認できます。
          </div>
        )}
      </div>
    </div>
  );
}

function StepChip({ n, label, on }: { n: number; label: string; on: boolean }) {
  return (
    <span className={`px-2.5 py-1 rounded-full font-bold border ${
      on ? "bg-red-600 text-white border-red-600" : "bg-gray-50 text-gray-400 border-gray-200"}`}>
      STEP {n} {label}
    </span>
  );
}
