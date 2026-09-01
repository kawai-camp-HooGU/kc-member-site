"use client";
// ============================================================
// 体験レーン（説明 → 起動 → 生成 → 調整 の司令塔）
//
//   ・scenario が null なら何も描画しない。
//     ＝ シナリオ未設定の体験版URLは、いままでとまったく同じQ&Aチャットになる（後方互換）。
//   ・生成は受付とポーリングに分かれる（設計 §7-5）。
//   ・エラーは errMessage で取り出した文言だけを赤帯1本で出し、
//     作れた成果物は消さない（brand.md §4）。
// ============================================================
import { useCallback, useEffect, useRef, useState } from "react";
import { errMessage } from "../../../lib/errors";
import {
  fetchTrialScenario, fetchTrialStatus, generateArtifact, startTrial,
} from "../../../lib/bot/trial/trialClient";
import type {
  TrialArtifact, TrialRevisionRef, TrialRun, TrialScenarioPublic,
} from "../../../lib/bot/trial/types";
import { IcWand } from "../icons";
import { ArtifactCard, ArtifactPlaceholder } from "./ArtifactCard";
import { IntroCard } from "./IntroCard";
import { StepForm } from "./StepForm";
import { SubmitPanel } from "./SubmitPanel";

/** ポーリング間隔と上限（2秒 × 60回 ＝ 2分で打ち切る） */
const POLL_MS = 2000;
const POLL_MAX = 60;

export interface TrialLaneProps {
  shareToken: string;
  passcode: string | null;
  /** 残り回数の表示をチャット側のメーターへ渡す */
  onRemainingChange?: (v: { gen: number; revise: number } | null) => void;
}

export function TrialLane({ shareToken, passcode, onRemainingChange }: TrialLaneProps) {
  const [scenario, setScenario] = useState<TrialScenarioPublic | null>(null);
  const [run, setRun] = useState<TrialRun | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [artifact, setArtifact] = useState<TrialArtifact | null>(null);
  const [history, setHistory] = useState<TrialRevisionRef[]>([]);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [remainingGen, setRemainingGen] = useState<number | null>(null);
  const [remainingRevise, setRemainingRevise] = useState<number | null>(null);

  const pollRef = useRef<number | null>(null);
  const pollCount = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current != null) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    pollCount.current = 0;
  }, []);

  // 画面を離れたらポーリングを必ず止める
  useEffect(() => stopPolling, [stopPolling]);

  useEffect(() => {
    if (!onRemainingChange) return;
    onRemainingChange(
      remainingGen == null ? null : { gen: remainingGen, revise: remainingRevise ?? 0 },
    );
  }, [remainingGen, remainingRevise, onRemainingChange]);

  // ── 進行の取得（ポーリングの1回ぶん）──
  const poll = useCallback(async (runId: number) => {
    try {
      const st = await fetchTrialStatus({ runId, shareToken, passcode });
      setRun(st.run);
      setArtifact(st.artifact);
      setHistory(st.history);
      setRemainingGen(st.remainingGen);
      setRemainingRevise(st.remainingRevise);

      if (st.run.status !== "running") {
        stopPolling();
        setBusy(false);
        if (st.run.status === "failed" && st.run.error) setError(st.run.error);
      }
    } catch (e: unknown) {
      stopPolling();
      setBusy(false);
      setError(errMessage(e, "状態を取得できませんでした。"));
    }
  }, [shareToken, passcode, stopPolling]);

  const beginPolling = useCallback((runId: number) => {
    stopPolling();
    pollRef.current = window.setInterval(() => {
      pollCount.current += 1;
      if (pollCount.current > POLL_MAX) {
        stopPolling();
        setBusy(false);
        setError("作成に時間がかかっています。お手数ですが、もう一度お試しください。");
        return;
      }
      void poll(runId);
    }, POLL_MS);
  }, [poll, stopPolling]);

  // ── ①→② はじめる ──
  const onStart = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await startTrial({ shareToken, passcode });
      setScenario(res.scenario);
      setRun(res.run);
      setRemainingGen(res.remainingGen);
      setRemainingRevise(res.remainingRevise);
      // select は先頭を初期値にする（空のプルダウンを出さない）
      const first = res.scenario.steps[0];
      const init: Record<string, string> = {};
      for (const d of first?.inputs ?? []) {
        init[d.key] = d.type === "select" ? (d.options?.[0] ?? "") : "";
      }
      setInputs(init);
    } catch (e: unknown) {
      setError(errMessage(e, "体験を開始できませんでした。"));
    } finally {
      setBusy(false);
    }
  }, [shareToken, passcode]);

  // ①「体験の説明が表示されている」状態を先に作る。
  //   ⚠️ ここでは run を作らない（画面を開いただけで空の run を量産しない）。
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetchTrialScenario({ shareToken, passcode });
        if (!alive || !res) return;
        setScenario(res.scenario);
        setRemainingGen(res.remainingGen);
        setRemainingRevise(res.remainingRevise);
      } catch (e: unknown) {
        // 説明が出せなくても、下のQ&Aチャットは使える。体験の入口を塞がない。
        if (alive) setError(errMessage(e, "体験の情報を取得できませんでした。"));
      }
    })();
    return () => { alive = false; };
  }, [shareToken, passcode]);

  // ── ②→③ 作る ──
  const onGenerate = useCallback(async (opts: { instruction?: string }) => {
    if (!run) return;
    setBusy(true);
    setError("");
    try {
      const res = await generateArtifact({
        runId: run.id, shareToken, passcode,
        inputs: opts.instruction ? null : inputs,
        instruction: opts.instruction ?? null,
      });
      setRemainingGen(res.remainingGen);
      setRun((r) => (r ? { ...r, status: "running" } : r));
      setInstruction("");
      beginPolling(run.id);
    } catch (e: unknown) {
      setBusy(false);
      setError(errMessage(e, "作成できませんでした。"));
    }
  }, [run, shareToken, passcode, inputs, beginPolling]);

  // ── 描画 ──
  //   ⚠️ scenario も run も無いあいだは「はじめる」だけを出す。
  //      体験版URLにシナリオが無ければ、そもそもこのコンポーネントは使われない。
  const step = scenario?.steps[0] ?? null;
  const canRevise = (remainingRevise ?? 0) > 0 && (remainingGen ?? 0) > 0;
  const isRunning = run?.status === "running";

  return (
    <div className="shrink-0 px-5 pt-4 space-y-3">
      {error && (
        <div className="bg-[#241f16] border border-[#4a3f22] text-[#e0b45a] rounded-lg px-3 py-2 text-[11.5px]">
          {error}
        </div>
      )}

      {!run && scenario && (
        <IntroCard scenario={scenario} busy={busy} onStart={() => void onStart()} />
      )}

      {run && !artifact && !isRunning && step && (
        <StepForm
          label={step.label}
          defs={step.inputs}
          values={inputs}
          busy={busy}
          onChange={(k, v) => setInputs((s) => ({ ...s, [k]: v }))}
          onSubmit={() => void onGenerate({})}
          onBack={() => { setRun(null); setArtifact(null); setError(""); }}
        />
      )}

      {isRunning && <ArtifactPlaceholder note="内容を考えています。20秒ほどかかります" />}

      {artifact && !isRunning && scenario && (
        <>
          {/* 1つ前の版は消さない（見える化） */}
          {history.length > 1 && (
            <div className="text-[10.5px] text-[#736e66] px-1">
              調整の履歴：{history.map((h) => `rev.${h.revision}`).join(" → ")}
            </div>
          )}
          <ArtifactCard
            artifact={artifact}
            title={scenario.title}
            isLatest
            canRevise={canRevise && run?.status !== "submitted"}
          />
          {/* ⑤提出。フォームが設定されているときだけ出す（無いのに出すと出せない状態になる） */}
          {scenario.hasForm && run && run.status !== "submitted" && (
            <SubmitPanel
              runId={run.id}
              shareToken={shareToken}
              passcode={passcode}
              onDone={() => setRun((r) => (r ? { ...r, status: "submitted" } : r))}
            />
          )}

          {canRevise && run?.status !== "submitted" && (
            <div className="flex items-center gap-2">
              <input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && instruction.trim() && !busy) {
                    e.preventDefault();
                    void onGenerate({ instruction: instruction.trim() });
                  }
                }}
                maxLength={256}
                placeholder="直してほしいところを書いてください（例：もっと短く）"
                className="flex-1 min-w-0 bg-[#100f0e] border border-[#37342f] rounded-lg px-3 py-2 text-[12px] text-[#f3efe8] placeholder-[#5a564e] focus:outline-none focus:border-[#ee1c25]"
              />
              <button
                type="button"
                disabled={busy || !instruction.trim()}
                onClick={() => void onGenerate({ instruction: instruction.trim() })}
                className="shrink-0 inline-flex items-center gap-1.5 bg-[#ee1c25] text-white rounded-lg px-4 py-2 text-[12px] font-bold hover:brightness-110 disabled:opacity-40"
              >
                <IcWand className="w-3.5 h-3.5" />調整する
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
