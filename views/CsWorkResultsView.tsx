"use client";
// ============================================================
// CsWork ＞ 成果と課題（REQ-039・ループ STEP 6・7・8／1日3回開く画面）
//
//   タブ：件数集計／次アクション／要監視顧客／課題
//
//   ⚠️ 部分失敗でも取得できた分は消さない。上部に赤帯1本で欠損を告げる
//      （brand.md §4）。
//   ⚠️ 採用したものが「要対応一覧」になる。**送信は人が行う。**
//      この画面がやるのは判断の記録だけ。
//   ⚠️ 課題タブがループの接合部。「判断を記録」を押すと、判断内容を含んだ
//      ラフmd の下書きができ、それが次の起草になる（STEP 8 → STEP 1）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "../components/common/ToastProvider";
import { errMessage } from "../lib/errors";
import { fmtJst } from "../lib/dateFmt";
import {
  Chip, EmptyBox, Loading, PartialBar, funnelCls, levelCls, levelLabel,
  runStatusLabel, saveTextFile, staleCls,
} from "../components/cswork/CsWorkParts";
import type { CsActionView, CsIssueView, CsWatchRowView, CsWorkPayload } from "../lib/csWork/payload";

type Tab = "counts" | "actions" | "watch" | "issues";

export function CsWorkResultsView({ onGoRuns }: { onGoRuns?: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("actions");
  const [data, setData] = useState<CsWorkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [funnelFilter, setFunnelFilter] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const res = await apiFetch("/api/ops/cswork");
    if (!res.ok) { setLoading(false); toast.error("読み込みに失敗しました"); return; }
    setData(await res.json());
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const run = data?.latestRun ?? null;
  const openIssues = data?.issues ?? [];
  const pending = (data?.actions ?? []).filter((a) => a.decision === "pending");

  const TABS: { key: Tab; label: string; badge?: number }[] = [
    { key: "counts",  label: "件数集計" },
    { key: "actions", label: "次アクション", badge: pending.length },
    { key: "watch",   label: "要監視顧客" },
    { key: "issues",  label: "課題", badge: openIssues.length },
  ];

  const failedSteps = (run?.steps ?? []).filter((s) => s.status !== "success");

  const decide = async (id: number, decision: CsActionView["decision"], rejectReason?: string) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/ops/cswork/actions/${id}`, {
        method: "PATCH", body: { decision, rejectReason },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "記録できませんでした"); return; }
      await load();
    } catch (e: unknown) {
      toast.error(errMessage(e, "記録できませんでした"));
    } finally { setBusy(false); }
  };

  const resolveIssue = async (id: number, resolution: string, toDraft: boolean) => {
    setBusy(true);
    try {
      const res = await apiFetch(`/api/ops/cswork/issues/${id}`, {
        method: "PATCH", body: { status: "resolved", resolution, toDraft },
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) { toast.error(json?.error ?? "クローズできませんでした"); return; }
      if (toDraft && json?.draftMd) {
        saveTextFile(`${new Date().toISOString().slice(0, 10)}_判断の記録.md`, json.draftMd);
        toast.success("判断を記録し、次の起草mdの下書きを保存しました");
      } else {
        toast.success("課題をクローズしました");
      }
      await load();
    } catch (e: unknown) {
      toast.error(errMessage(e, "クローズできませんでした"));
    } finally { setBusy(false); }
  };

  const watchCounts = useMemo(() => {
    const c: Record<string, number> = { all: data?.watch.length ?? 0 };
    for (const r of data?.watch ?? []) c[r.導線種別] = (c[r.導線種別] ?? 0) + 1;
    return c;
  }, [data]);

  const visibleWatch = (data?.watch ?? []).filter((r) => {
    if (funnelFilter !== "all" && r.導線種別 !== funnelFilter) return false;
    if (!query.trim()) return true;
    return JSON.stringify(r).toLowerCase().includes(query.trim().toLowerCase());
  });

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-extrabold">成果と課題</h1>
          {run && <Chip cls={levelCls(run.status === "success" ? "info" : "warn")}>{runStatusLabel(run.status)}</Chip>}
          <span className="ml-auto text-[11px] text-gray-400">
            {run?.started_at ? `最新の実行 ${fmtJst(run.started_at)}／版 ${run.doc_version ?? "-"}` : "実行の記録がありません"}
          </span>
        </div>
        <div className="flex gap-1 mt-3 border-b border-gray-200 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-[12.5px] font-bold rounded-t-lg border border-b-0 flex items-center gap-1.5 ${
                tab === t.key ? "bg-white text-red-700 border-gray-200 shadow-[inset_0_3px_0_0_#dc2626]" : "bg-gray-50 text-gray-500 border-transparent"}`}>
              {t.label}
              {!!t.badge && <span className="bg-red-600 text-white text-[10px] font-extrabold px-1.5 rounded-full">{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 py-4">
        {loading && <Loading />}

        {!loading && failedSteps.length > 0 && (
          <PartialBar>
            <b>一部を取得できませんでした</b> —{" "}
            {failedSteps.slice(0, 3).map((s) => `${s.task_id ?? "（不明）"}${s.reason ? `（${s.reason}）` : ""}`).join("／")}
            {failedSteps.length > 3 && ` ほか${failedSteps.length - 3}件`}。
            <b>取得できた分は下に表示しています。</b>
          </PartialBar>
        )}

        {!loading && !run && (
          <EmptyBox kind="setup" title="まだ実行結果がありません"
            hint="「実行」画面で result.json を取り込むと、件数・次アクション・課題がここに出ます。"
            actionLabel={onGoRuns ? "実行を開く" : undefined} onAction={onGoRuns} />
        )}

        {/* 件数集計 */}
        {!loading && tab === "counts" && run && (
          Object.keys(run.counts ?? {}).length ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {Object.entries(run.counts).map(([k, v]) => (
                <div key={k} className="bg-white border border-gray-200 rounded-xl px-4 py-3">
                  <div className="text-[11px] text-gray-500">{k}</div>
                  <div className="text-[24px] font-extrabold text-gray-700 leading-9">
                    {v?.value == null ? <span className="text-[14px] text-amber-700">取得できませんでした</span> : v.value}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {v?.error
                      ? <span className="text-amber-700 font-bold">{v.error}</span>
                      : v?.delta != null
                        ? <span className={v.delta > 0 ? "text-emerald-700 font-bold" : ""}>前回比 {v.delta >= 0 ? "+" : ""}{v.delta}</span>
                        : "前回値なし"}
                    {v?.as_of && <span className="ml-1">／{v.as_of}</span>}
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyBox kind="none" title="この実行では件数を取得していません" />
        )}

        {/* 次アクション */}
        {!loading && tab === "actions" && (
          (data?.actions ?? []).length ? (
            <ActionTable actions={data?.actions ?? []} busy={busy} onDecide={decide} />
          ) : run ? (
            <EmptyBox kind="done" title="対応が必要な顧客はいません" hint="この実行では次アクションの提案はありませんでした。" />
          ) : null
        )}

        {/* 要監視顧客 */}
        {!loading && tab === "watch" && (
          <>
            <div className="flex gap-2 flex-wrap mb-3">
              <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="氏名・メモで絞り込む"
                className="flex-1 min-w-[180px] border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
            </div>
            <div className="flex gap-2 flex-wrap mb-3">
              {["all", ...Object.keys(watchCounts).filter((k) => k !== "all")].map((k) => (
                <button key={k} onClick={() => setFunnelFilter(k)}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold border ${
                    funnelFilter === k ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-gray-200 text-gray-500"}`}>
                  {k === "all" ? "すべて" : k}（{watchCounts[k] ?? 0}）
                </button>
              ))}
            </div>
            {visibleWatch.map((r) => <WatchCard key={`${r.氏名}-${r.最終アクション日}`} row={r} />)}
            {!visibleWatch.length && (
              <EmptyBox kind="setup" title="要監視顧客の台帳がありません"
                hint="Phase 1 の正本は Googleドライブです。最新の台帳CSVを取り込むとここに出ます。" />
            )}
          </>
        )}

        {/* 課題 */}
        {!loading && tab === "issues" && (
          openIssues.length
            ? <IssueTable issues={openIssues} busy={busy} onResolve={resolveIssue} />
            : <EmptyBox kind="done" title="未解消の課題はありません" hint="実行でつまずいた点があれば、ここに自動で起票されます。" />
        )}
      </div>
    </div>
  );
}

// ── 次アクション ──────────────────────────────────────────
function ActionTable({ actions, busy, onDecide }: {
  actions: CsActionView[];
  busy: boolean;
  onDecide: (id: number, decision: CsActionView["decision"], reason?: string) => void;
}) {
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [reason, setReason] = useState("");

  const top = actions.filter((a) => a.stale_level === "最優先").length;
  const follow = actions.filter((a) => a.stale_level === "要フォロー").length;
  const pending = actions.filter((a) => a.decision === "pending").length;

  return (
    <>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
        <Kpi label="提案" value={actions.length} sub={`未確認 ${pending}`} />
        <Kpi label="最優先" value={top} sub="7日以上" tone="danger" />
        <Kpi label="要フォロー" value={follow} sub="3営業日以上" tone="warn" />
        <Kpi label="採用済" value={actions.filter((a) => a.decision === "adopted").length} sub="要対応一覧へ" />
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="tbl-head">
            <th className="text-left px-4 py-2">優先</th><th className="text-left">顧客</th><th className="text-left">導線</th>
            <th className="text-left">滞留</th><th className="text-left">提案する次アクション</th>
            <th className="text-left">チャネル</th><th className="text-left">判断</th>
          </tr></thead>
          <tbody>
            {actions.map((a) => (
              <tr key={a.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Chip cls={staleCls(a.stale_level ?? "")}>{a.stale_level ?? "—"}</Chip>
                </td>
                <td className="py-2">
                  {a.customer_name ?? "—"}
                  {a.customer_id && <div className="text-[10.5px] text-gray-400">{a.customer_kind}／{a.customer_id}</div>}
                </td>
                <td className="py-2 whitespace-nowrap">
                  {a.funnel ? <Chip cls={funnelCls(a.funnel)}>{a.funnel}</Chip> : "—"}
                </td>
                <td className="py-2 text-gray-500 whitespace-nowrap">{a.stale_reason ?? "—"}</td>
                <td className="py-2">
                  {a.proposal}
                  <div className="text-[10.5px] mt-0.5">
                    {a.draft_ref
                      ? <span className="text-emerald-700 font-bold">下書きあり</span>
                      : <span className="text-amber-700">下書きなし</span>}
                    {a.task_id && <span className="text-gray-400 ml-2">{a.task_id}</span>}
                    {a.due && <span className="text-gray-400 ml-2">期限 {a.due}</span>}
                  </div>
                </td>
                <td className="py-2 whitespace-nowrap">{a.channel ?? "—"}</td>
                <td className="py-2 pr-4 whitespace-nowrap">
                  {a.decision === "pending" ? (
                    rejecting === a.id ? (
                      <div className="flex flex-col gap-1">
                        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="却下の理由"
                          className="border border-gray-200 rounded-lg px-2 py-1 text-[11.5px] w-40" />
                        <div className="flex gap-1">
                          <button disabled={busy || !reason.trim()}
                            onClick={() => { onDecide(a.id, "rejected", reason); setRejecting(null); setReason(""); }}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40">記録</button>
                          <button onClick={() => { setRejecting(null); setReason(""); }}
                            className="border border-gray-200 rounded-lg px-2 py-1 text-[11px]">やめる</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button disabled={busy} onClick={() => onDecide(a.id, "adopted")}
                          className="bg-red-600 text-white font-bold rounded-lg px-3 py-1 text-[11px] disabled:opacity-40">採用</button>
                        <button disabled={busy} onClick={() => setRejecting(a.id)}
                          className="border border-gray-200 rounded-lg px-3 py-1 text-[11px] disabled:opacity-40">却下</button>
                        <button disabled={busy} onClick={() => onDecide(a.id, "held")}
                          className="border border-gray-200 rounded-lg px-3 py-1 text-[11px] disabled:opacity-40">保留</button>
                      </div>
                    )
                  ) : (
                    <span className="text-[11px]">
                      <Chip cls={a.decision === "adopted" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500 border-gray-200"}>
                        {a.decision === "adopted" ? "採用済" : a.decision === "rejected" ? "却下" : "保留"}
                      </Chip>
                      {a.decided_at && <div className="text-gray-400 mt-0.5">{fmtJst(a.decided_at)}</div>}
                      {a.reject_reason && <div className="text-gray-500 mt-0.5 max-w-[180px] whitespace-normal">{a.reject_reason}</div>}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-500 mt-2">
        採用したものが「要対応一覧」になります。<b className="text-red-700">送信は人が行います。</b>却下の理由は次回の提案精度に反映されます。
      </p>
    </>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: number; sub?: string; tone?: "danger" | "warn" }) {
  const color = tone === "danger" ? "text-red-700" : tone === "warn" ? "text-amber-700" : "text-gray-700";
  return (
    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className={`text-[24px] font-extrabold leading-9 ${color}`}>{value}</div>
      {sub && <div className={`text-[11px] ${tone ? color : "text-gray-400"}`}>{sub}</div>}
    </div>
  );
}

// ── 課題 ──────────────────────────────────────────────────
function IssueTable({ issues, busy, onResolve }: {
  issues: CsIssueView[];
  busy: boolean;
  onResolve: (id: number, resolution: string, toDraft: boolean) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [text, setText] = useState("");

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead><tr className="tbl-head">
            <th className="text-left px-4 py-2">区分</th><th className="text-left">課題</th>
            <th className="text-left">影響</th><th className="text-left">発生</th>
            <th className="text-left">担当</th><th className="text-left">解消</th>
          </tr></thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id} className="border-t border-gray-100 align-top">
                <td className="px-4 py-2 whitespace-nowrap">
                  <Chip cls={levelCls(i.level)}>{i.category}</Chip>
                  <div className="text-[10.5px] text-gray-400 mt-0.5">{levelLabel(i.level)}</div>
                </td>
                <td className="py-2">
                  <b>{i.title}</b>
                  {i.detail && <div className="text-gray-500">{i.detail}</div>}
                  <div className="text-[10.5px] text-gray-400 mt-0.5">
                    <code>{i.code}</code>{i.task_id && <span className="ml-2">{i.task_id}</span>}{i.funnel && <span className="ml-2">{i.funnel}</span>}
                  </div>
                </td>
                <td className="py-2 whitespace-nowrap">
                  <span className={i.occurrences >= 3 ? "text-red-700 font-bold" : "text-amber-700"}>
                    {i.occurrences}回{i.occurrences >= 3 ? "連続" : ""}
                  </span>
                </td>
                <td className="py-2 whitespace-nowrap text-gray-500">{fmtJst(i.created_at)}</td>
                <td className="py-2 whitespace-nowrap">{i.assignee ?? <span className="text-gray-400">—</span>}</td>
                <td className="py-2 pr-4">
                  {editing === i.id ? (
                    <div className="flex flex-col gap-1 w-52">
                      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
                        placeholder="決めたこと・原因を書く"
                        className="border border-gray-200 rounded-lg px-2 py-1 text-[11.5px]" />
                      <div className="flex gap-1 flex-wrap">
                        <button disabled={busy || !text.trim()}
                          onClick={() => { onResolve(i.id, text, false); setEditing(null); setText(""); }}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px] disabled:opacity-40">クローズ</button>
                        <button disabled={busy || !text.trim()}
                          onClick={() => { onResolve(i.id, text, true); setEditing(null); setText(""); }}
                          title="判断内容を含んだ起草mdの下書きを保存します"
                          className="bg-red-600 text-white font-bold rounded-lg px-2 py-1 text-[11px] disabled:opacity-40">判断を記録</button>
                        <button onClick={() => { setEditing(null); setText(""); }}
                          className="border border-gray-200 rounded-lg px-2 py-1 text-[11px]">やめる</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setEditing(i.id)} disabled={busy}
                      className="border border-gray-200 rounded-lg px-3 py-1 text-[11px] disabled:opacity-40">解消を記録</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-2.5 text-[11.5px] mt-3">
        <b>「判断を記録」を押すと</b>、判断内容を含んだラフmd の下書きが保存されます。それを「起草と整形」に投入すると、
        <b>次からは AI がその判断を前提に動けます。</b>
      </div>
    </>
  );
}

// ── 要監視顧客 ────────────────────────────────────────────
function WatchCard({ row }: { row: CsWatchRowView }) {
  const portal = row.links.find((l) => l.name.includes("ポータル"));
  return (
    <details className="bg-white border border-gray-200 rounded-xl mb-2 overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap">
        <b className="text-[14px]">{row.氏名}</b>
        <span className="text-[11.5px] text-gray-500">（{row.現況 || "—"}）</span>
        <Chip cls={funnelCls(row.導線種別)}>{row.導線種別}</Chip>
        <Chip cls={staleCls(row.stale.level)}>{row.stale.level}</Chip>
        {portal?.url
          ? <a href={portal.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
               className="text-[10.5px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">ポータル顧客ページ{row.顧客種別 ? `（${row.顧客種別}）` : ""}</a>
          : <span className="text-[10.5px] px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">ポータル顧客ページ未登録</span>}
        <span className="ml-auto text-[11px] text-gray-400 font-mono">最終 {row.最終アクション日 || "—"}</span>
      </summary>
      <div className="px-4 pb-4 border-t border-gray-200 pt-3 grid md:grid-cols-2 gap-4 text-[12.5px]">
        <dl className="grid grid-cols-[92px_1fr] gap-y-1">
          <dt className="text-gray-500 font-bold">顧客情報</dt><dd />
          <dt className="text-gray-500">優先度</dt><dd>{row.優先度}</dd>
          <dt className="text-gray-500">LINE名</dt><dd>{row.LINE名 || <span className="text-gray-400">未登録</span>}</dd>
          <dt className="text-gray-500">メール</dt><dd>{row.メールアドレス || <span className="text-gray-400">未登録</span>}</dd>
          <dt className="text-gray-500">電話</dt><dd>{row.電話番号 || <span className="text-gray-400">未登録</span>}</dd>
          <dt className="text-gray-500">顧客種別</dt><dd>{row.顧客種別 || <span className="text-gray-400">未登録</span>}</dd>
          <dt className="text-gray-500">顧客ID</dt><dd>{row.顧客ID || <span className="text-gray-400">未登録</span>}</dd>
        </dl>
        <dl className="grid grid-cols-[110px_1fr] gap-y-1">
          <dt className="text-gray-500 font-bold">対応状況</dt><dd />
          <dt className="text-gray-500">監視要件</dt><dd>{row.監視要件}</dd>
          <dt className="text-gray-500">最終アクション</dt><dd><b>{row.最終アクション日}</b> {row.最終アクション内容}</dd>
          <dt className="text-gray-500">次アクション</dt><dd><b>{row.次アクション予定日}</b> {row.次アクション提案}</dd>
          <dt className="text-gray-500">予定日</dt><dd>{row.予定日 || <span className="text-gray-400">未登録</span>}</dd>
          <dt className="text-gray-500">滞留判定</dt><dd>{row.stale.level}<span className="text-gray-400 text-[11px]">（{row.stale.reason}・自動計算）</span></dd>
        </dl>
        <div className="md:col-span-2">
          <div className="text-[11px] font-bold text-red-700 mb-1">この顧客の関連URL</div>
          <div className="flex gap-2 flex-wrap">
            {row.links.length === 0 && <span className="text-[11.5px] text-gray-400">個人URL未登録</span>}
            {row.links.map((l, i) => l.url
              ? <a key={i} href={l.url} target="_blank" rel="noopener" className="text-[11.5px] px-3 py-1 rounded-full border border-blue-200 bg-blue-50 text-blue-700">{l.name}</a>
              : <span key={i} className="text-[11.5px] px-3 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700">{l.name}（URL未登録）</span>)}
          </div>
          {row.備考 && <div className="mt-2 text-[11.5px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">備考：{row.備考}</div>}
        </div>
      </div>
    </details>
  );
}
