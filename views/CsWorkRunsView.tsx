"use client";
// ============================================================
// CsWork ＞ 実行（REQ-039・ループ STEP 4・5）
//
//   タブ：実行状況／指示ファイル／実行履歴
//
//   ⚠️ 確定5：Phase 1 では専用 API 鍵を発行しない。エージェントが Drive へ
//      置いた result JSON を、この画面から貼り付けて取り込む。
//      1日3回 × 貼り付け1回＝日次3操作。**ここが面倒になった時点が
//      Phase 2 着手の合図**になる。
//   ⚠️ 実行されなかったことも記録する（skipped）。沈黙させない（設計書 R5）。
//   ⚠️ 管理者のみ（cswork_edit）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "../components/common/ToastProvider";
import { errMessage } from "../lib/errors";
import { fmtJst } from "../lib/dateFmt";
import {
  Chip, EmptyBox, Loading, runStatusCls, runStatusLabel, saveTextFile,
} from "../components/cswork/CsWorkParts";
import type { CsDocRow, CsRunView, CsWorkPayload } from "../lib/csWork/payload";

type Tab = "status" | "runbook" | "history";

const TABS: { key: Tab; label: string }[] = [
  { key: "status",  label: "実行状況" },
  { key: "runbook", label: "指示ファイル" },
  { key: "history", label: "実行履歴" },
];

export function CsWorkRunsView({ onGoDraft }: { onGoDraft?: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("status");
  const [data, setData] = useState<CsWorkPayload | null>(null);
  const [runs, setRuns] = useState<CsRunView[]>([]);
  const [runbook, setRunbook] = useState<{ doc: CsDocRow | null; content: string; message?: string } | null>(null);
  const [paste, setPaste] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, b, c] = await Promise.all([
      apiFetch("/api/ops/cswork"),
      apiFetch("/api/ops/cswork/runs?limit=50"),
      apiFetch("/api/ops/cswork/runbook?runner=agent-browser"),
    ]);
    if (a.ok) setData(await a.json());
    if (b.ok) setRuns((await b.json()).items ?? []);
    if (c.ok) setRunbook(await c.json());
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const regenerate = async () => {
    setBusy(true);
    try {
      const res = await apiFetch("/api/ops/cswork/runbook", { method: "POST", body: { runner: "agent-browser" } });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "作り直せませんでした"); return; }
      toast.success("指示ファイルを作り直しました");
      await load();
    } catch (e: unknown) {
      toast.error(errMessage(e, "作り直せませんでした"));
    } finally { setBusy(false); }
  };

  const ingest = async () => {
    if (!paste.trim()) { toast.error("実行結果の JSON を貼ってください"); return; }
    setBusy(true);
    try {
      const res = await apiFetch("/api/ops/cswork/runs", { method: "POST", body: JSON.parse(paste) });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "取り込めませんでした"); return; }
      toast.success("実行結果を取り込みました");
      setPaste("");
      await load();
    } catch (e: unknown) {
      toast.error(errMessage(e, "JSON として読めません"));
    } finally { setBusy(false); }
  };

  const latest = data?.latestRun ?? null;
  const blocked = data?.specIssues.filter((i) => i.level === "blocker") ?? [];

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-extrabold">実行</h1>
          {runbook?.doc
            ? <Chip cls="bg-emerald-50 text-emerald-700 border-emerald-200">指示ファイル v{runbook.doc.doc_version ?? runbook.doc.version ?? "-"} 生成済</Chip>
            : <Chip cls="bg-amber-50 text-amber-700 border-amber-200">指示ファイル未生成</Chip>}
          <span className="ml-auto text-[11px] text-gray-400">
            {latest?.started_at ? `最新の実行 ${fmtJst(latest.started_at)}` : "実行の記録がありません"}
          </span>
        </div>
        <div className="flex gap-1 mt-3 border-b border-gray-200">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[12.5px] font-bold rounded-t-lg border border-b-0 ${
                tab === t.key ? "bg-white text-red-700 border-gray-200 shadow-[inset_0_3px_0_0_#dc2626]" : "bg-gray-50 text-gray-500 border-transparent"}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {loading && <Loading />}

        {!loading && tab === "status" && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
              <div className="text-[13px] font-bold mb-2">実行前提のチェック</div>
              <ul className="text-[12.5px] leading-7">
                <Check ok={!!runbook?.doc} okText={`指示ファイル v${runbook?.doc?.doc_version ?? "-"} が生成されている`}
                  ngText="指示ファイルが未生成です。「起草と整形」で承認してください" />
                <Check ok={!!latest} okText={`前回の実行あり（${latest?.started_at ? fmtJst(latest.started_at) : "-"}）`}
                  ngText="前回スナップショットがありません。初回は基準値の作成だけになります" warn />
                <Check ok={blocked.length === 0} okText="実行不可のタスクはありません"
                  ngText={`実行不可のタスク ${blocked.length}件（${blocked.map((b) => b.task_id ?? "-").join("・")}）`} />
              </ul>
              <div className="text-[11.5px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                実行時刻の前後5分は UTAGE を開かないでください（同時ログインで切断されます）。
                <b className="ml-1">ブラウザ操作を伴うため、実行時刻に PC が起動している必要があります。</b>
              </div>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3">
              <div className="text-[13px] font-bold mb-1">実行結果の取り込み</div>
              <p className="text-[11.5px] text-gray-500 mb-2 leading-5">
                エージェントが作った <code>result.json</code> を貼って取り込みます。件数・次アクション提案・課題に展開され、「成果と課題」に出ます。
                <b>Phase 1 はこの貼り付けが唯一の投入口です</b>（API鍵の発行は Phase 2）。
              </p>
              <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={8}
                placeholder={'{ "run_id": "...", "status": "partial", "counts": { ... }, "next_actions": [ ... ], "issues": [ ... ] }'}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-[12px] font-mono leading-6" />
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setPaste("")} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">クリア</button>
                <button onClick={ingest} disabled={busy || !paste.trim()}
                  className="bg-red-600 text-white font-bold rounded-lg px-5 py-2 text-[12.5px] disabled:opacity-40">取り込む</button>
              </div>
            </div>

            {latest ? <RunCard run={latest} /> : (
              <EmptyBox kind="setup" title="まだ実行されていません"
                hint="指示ファイルを生成し、スケジュールタスクで実行してから、結果をここに貼り付けてください。"
                actionLabel={onGoDraft && !runbook?.doc ? "起草と整形を開く" : undefined}
                onAction={onGoDraft} />
            )}
          </>
        )}

        {!loading && tab === "runbook" && (
          runbook?.doc ? (
            <>
              <div className="flex gap-2 mb-2 flex-wrap items-center">
                <span className="text-[12px] text-gray-500">
                  runner: agent-browser／版 {runbook.doc.doc_version ?? "-"}／{fmtJst(runbook.doc.uploaded_at)}
                </span>
                <span className="ml-auto flex gap-2">
                  <button onClick={() => saveTextFile(runbook.doc?.filename ?? "runbook.md", runbook.content)}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">ダウンロード</button>
                  <button onClick={regenerate} disabled={busy}
                    className="border border-gray-200 rounded-lg px-3 py-2 text-[12px] disabled:opacity-40">作り直す</button>
                </span>
              </div>
              <div className="text-[11.5px] text-gray-500 mb-2">
                <code>{"{{ }}"}</code> は展開していません。実値は設定値スナップショットを見ます（指示ファイルが漏れても被害を限定するため）。
              </div>
              <pre className="bg-white border border-gray-200 rounded-xl p-4 text-[11.5px] leading-6 whitespace-pre-wrap overflow-auto">{runbook.content}</pre>
            </>
          ) : (
            <EmptyBox kind="setup" title="指示ファイルが未生成です"
              hint={runbook?.message ?? "「起草と整形」で整形結果を承認すると、自動で生成されます。"}
              actionLabel={onGoDraft ? "起草と整形を開く" : undefined} onAction={onGoDraft} />
          )
        )}

        {!loading && tab === "history" && (
          runs.length ? (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead><tr className="tbl-head">
                  <th className="text-left px-4 py-2">実行</th><th className="text-left">runner</th><th className="text-left">版</th>
                  <th className="text-left">結果</th><th className="text-left">ステップ</th><th className="text-left">成果</th>
                </tr></thead>
                <tbody>
                  {runs.map((r) => {
                    const ok = r.steps.filter((s) => s.status === "success").length;
                    const ng = r.steps.filter((s) => s.status === "failed").length;
                    const sk = r.steps.filter((s) => s.status === "skipped").length;
                    return (
                      <tr key={r.id} className="border-t border-gray-100">
                        <td className="px-4 py-2 whitespace-nowrap">{r.started_at ? fmtJst(r.started_at) : "—"}</td>
                        <td className="whitespace-nowrap">{r.runner}</td>
                        <td>{r.doc_version ?? "—"}</td>
                        <td><Chip cls={runStatusCls(r.status)}>{runStatusLabel(r.status)}</Chip></td>
                        <td className="whitespace-nowrap">成功 {ok}／失敗 {ng}／実行しない {sk}</td>
                        <td className="pr-4">
                          {r.artifacts.length
                            ? r.artifacts.map((a, i) => a.url
                                ? <a key={i} href={a.url} target="_blank" rel="noopener" className="text-blue-700 underline mr-2">{a.kind ?? a.name ?? "成果"}</a>
                                : <span key={i} className="text-gray-400 mr-2">{a.kind ?? "成果"}</span>)
                            : <span className="text-gray-400">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <EmptyBox kind="none" title="実行履歴がありません" hint="結果を取り込むと、ここに1回ずつ積み上がります。" />
        )}
      </div>
    </div>
  );
}

function Check({ ok, okText, ngText, warn }: { ok: boolean; okText: string; ngText: string; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={`font-bold w-10 shrink-0 ${ok ? "text-emerald-700" : warn ? "text-amber-700" : "text-red-700"}`}>
        {ok ? "OK" : warn ? "注意" : "NG"}
      </span>
      <span>{ok ? okText : ngText}</span>
    </li>
  );
}

function RunCard({ run }: { run: CsRunView }) {
  const entries = Object.entries(run.counts ?? {});
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <div className="text-[13px] font-bold">最新の実行</div>
        <Chip cls={runStatusCls(run.status)}>{runStatusLabel(run.status)}</Chip>
        <span className="text-[11px] text-gray-400">{run.started_at ? fmtJst(run.started_at) : "—"}／版 {run.doc_version ?? "—"}</span>
      </div>

      {entries.length > 0 && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
          {entries.map(([k, v]) => (
            <div key={k} className="border border-gray-200 rounded-lg px-3 py-2">
              <div className="text-[10.5px] text-gray-500">{k}</div>
              <div className="text-[19px] font-extrabold text-gray-700 leading-7">
                {v?.value == null ? <span className="text-[13px] text-amber-700 font-bold">取得失敗</span> : v.value}
              </div>
              <div className="text-[10.5px] text-gray-400">
                {v?.error ? v.error : v?.delta != null ? `前回比 ${v.delta >= 0 ? "+" : ""}${v.delta}` : ""}
              </div>
            </div>
          ))}
        </div>
      )}

      {run.steps.filter((s) => s.status !== "success").length > 0 && (
        <div className="text-[12px]">
          <div className="font-bold text-gray-600 mb-1">完了しなかったステップ</div>
          <ul className="list-disc pl-5 leading-6">
            {run.steps.filter((s) => s.status !== "success").map((s, i) => (
              <li key={i}>
                <b>{s.task_id ?? "（不明）"}</b>　{s.status === "failed" ? "失敗" : "実行しない"}
                {s.reason && <span className="text-gray-500">：{s.reason}</span>}
                {s.reason_code && <code className="ml-1 text-[11px] text-gray-400">{s.reason_code}</code>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {typeof run.notify?.body === "string" && run.notify.body.trim() && (
        <div className="mt-3">
          <div className="text-[12px] font-bold text-gray-600 mb-1">
            Chatwork 通知の本文（<span className="text-red-700">送信は人が行います</span>）
          </div>
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11.5px] whitespace-pre-wrap">{run.notify.body}</pre>
        </div>
      )}
    </div>
  );
}
