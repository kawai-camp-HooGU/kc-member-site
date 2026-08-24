"use client";
// ============================================================
// 設定 ＞ AI回答トレース（管理者のみ）
//   ・トレース  … 1件ずつ「なぜこの回答になったか」を再現する
//   ・利用状況  … 機能別の回数・トークン・コスト・エラー率・p95
//
//   ⚠️ ai_traces は顧客の個人情報を含む。requireAdmin ＋ RLS（管理者のみ）。
//      スクリーンショットを配信フォルダへ置かないこと。
//   ⚠️ 単価が未設定のあいだ金額は「—」と出す（0 を「無料」と誤読させない）。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import { aiTraceList, aiTraceDetail, aiUsageSummary } from "../../lib/aiClient";
import { fmtJst } from "../../lib/dateFmt";
import { errMessage } from "../../lib/errors";
import { CARD, CARD_HEAD, FIELD_SELECT, SUCCESS_CONFIG } from "../../lib/constants";
import type {
  AiTraceRow, AiTraceDetail, AiTraceState, AiUsageSummaryRow, AiRetrievalItem,
} from "../../lib/ai/types";

type SubTab = "trace" | "usage";

const FEATURE_LABEL: Record<string, string> = {
  bot_public: "公開ボット",
  member_consult: "メンバー相談",
  reply_suggest: "返信提案",
  review: "添削",
  html_generate: "HTML生成",
  door_generate: "扉ページ生成",
  broadcast_draft: "配信原稿",
  data_search: "データ検索",
  bookmark_gen: "ブックマーク生成",
  summarize: "会話要約",
  payment_extract: "決済抽出",
  escalate: "引き継ぎ",
  adopt: "採用",
};
const featureLabel = (k: string): string => FEATURE_LABEL[k] ?? k;

const STATE_OPTIONS: { key: AiTraceState | ""; label: string }[] = [
  { key: "", label: "すべての状態" },
  { key: "refused", label: "該当なし・辞退" },
  { key: "error", label: "エラー" },
  { key: "needs_human", label: "人へ引き継ぎ" },
  { key: "retried", label: "再試行あり" },
  { key: "rated_bad", label: "評価が悪い" },
];
const DAY_OPTIONS = [
  { v: 1, label: "今日" }, { v: 7, label: "7日" }, { v: 30, label: "30日" },
];

const badge = "inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold border";
const badgeOk = `${badge} ${SUCCESS_CONFIG.bg} ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.text}`;
const badgeWarn = `${badge} bg-red-50 border-red-200 text-red-700`;
const badgeMuted = `${badge} bg-gray-100 border-gray-200 text-gray-500`;

const nf = (n: number): string => n.toLocaleString("ja-JP");
/** 単価未設定なら「—」。0 を「無料」と読ませない。 */
const money = (v: number, configured: boolean): string =>
  configured ? `¥${v.toLocaleString("ja-JP", { maximumFractionDigits: 1 })}` : "—";

/** 利用者の評価（A-8）。未評価は控えめに「—」。 */
function ratingBadge(rating: number | null): JSX.Element {
  if (rating === -1) return <span className={badgeWarn}>役に立たなかった</span>;
  if (rating === 1) return <span className={badgeOk}>役に立った</span>;
  return <span className="text-gray-300">—</span>;
}

function stateBadge(r: AiTraceRow | AiTraceDetail): JSX.Element {
  if (!r.ok) return <span className={badgeWarn}>エラー</span>;
  if (r.refused) return <span className={badgeWarn}>該当なし</span>;
  if (r.needsHuman) return <span className={badgeWarn}>要引き継ぎ</span>;
  if (r.retryCount > 0) return <span className={badgeMuted}>再試行 {r.retryCount}</span>;
  return <span className={badgeOk}>正常</span>;
}

// ── 詳細のブロック（等幅・スクロール） ─────────────────────
function Pre({ label, body }: { label: string; body: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1">{label}</div>
      <pre className="max-h-64 overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-3
                      text-[11px] leading-relaxed whitespace-pre-wrap break-words text-gray-800">
        {body || "（なし）"}
      </pre>
    </div>
  );
}

export function AiTraceTab(): JSX.Element {
  const [sub, setSub] = useState<SubTab>("trace");

  // ── トレース ──
  const [rows, setRows] = useState<AiTraceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [days, setDays] = useState(1);
  const [feature, setFeature] = useState<string>("");
  const [state, setState] = useState<AiTraceState | "">("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [selId, setSelId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AiTraceDetail | null>(null);
  const [detailErr, setDetailErr] = useState("");

  // ── 利用状況 ──
  const [usage, setUsage] = useState<AiUsageSummaryRow[]>([]);
  const [usageDays, setUsageDays] = useState(30);
  const [priceConfigured, setPriceConfigured] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageErr, setUsageErr] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const r = await aiTraceList({ days, feature: feature || null, state: state || null, limit: 200 });
      setRows(r.rows);
      setTotal(r.total);
    } catch (e: unknown) {
      setErr(errMessage(e, "トレースを取得できませんでした"));
    } finally {
      setLoading(false);
    }
  }, [days, feature, state]);

  useEffect(() => { void reload(); }, [reload]);

  const openDetail = async (id: number): Promise<void> => {
    setSelId(id);
    setDetail(null);
    setDetailErr("");
    try {
      setDetail(await aiTraceDetail(id));
    } catch (e: unknown) {
      setDetailErr(errMessage(e, "詳細を取得できませんでした"));
    }
  };

  const loadUsage = useCallback(async () => {
    setUsageLoading(true);
    setUsageErr("");
    try {
      const r = await aiUsageSummary(usageDays);
      setUsage(r.rows);
      setPriceConfigured(r.priceConfigured);
    } catch (e: unknown) {
      setUsageErr(errMessage(e, "利用状況を取得できませんでした"));
    } finally {
      setUsageLoading(false);
    }
  }, [usageDays]);

  useEffect(() => { if (sub === "usage") void loadUsage(); }, [sub, loadUsage]);

  // 一覧に出ている機能キー（絞り込みの選択肢）
  const featureKeys = Array.from(new Set(rows.map((r) => r.feature))).sort();

  const totalCalls = usage.reduce((s, u) => s + u.calls, 0);
  const totalCost = usage.reduce((s, u) => s + u.costJpy, 0);
  const totalRefused = usage.reduce((s, u) => s + u.refused, 0);
  const refusedRate = totalCalls > 0 ? (totalRefused / totalCalls) * 100 : 0;

  return (
    <div className="space-y-4">
      {/* サブタブ */}
      <div className="flex gap-1 border-b border-gray-200">
        {([["trace", "トレース"], ["usage", "利用状況"]] as [SubTab, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setSub(k)}
            className={`px-4 py-2 text-[12.5px] font-semibold rounded-t-lg border border-b-0 -mb-px ${
              sub === k ? "bg-white border-gray-200 text-red-700" : "border-transparent text-gray-500 hover:text-gray-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {sub === "trace" ? (
        <>
          {/* 絞り込み */}
          <div className={`${CARD} p-3 flex flex-wrap items-center gap-2`}>
            <select className={FIELD_SELECT} value={days} onChange={(e) => setDays(Number(e.target.value))}>
              {DAY_OPTIONS.map((d) => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
            <select className={FIELD_SELECT} value={feature} onChange={(e) => setFeature(e.target.value)}>
              <option value="">すべての機能</option>
              {featureKeys.map((k) => <option key={k} value={k}>{featureLabel(k)}</option>)}
            </select>
            <select className={FIELD_SELECT} value={state} onChange={(e) => setState(e.target.value as AiTraceState | "")}>
              {STATE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <button type="button" onClick={() => void reload()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50">
              更新
            </button>
            <span className="ml-auto text-[11.5px] text-gray-500">
              {loading ? "…" : `${nf(rows.length)} 件表示／該当 ${nf(total)} 件`}
            </span>
          </div>

          {/* 取得できた分は表示を維持し、失敗は赤帯1本で知らせる（brand.md §4） */}
          {err && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{err}</div>
          )}

          {/* 一覧 */}
          <div className={`${CARD} overflow-hidden`}>
            <div className={CARD_HEAD}>
              <span className="text-[12.5px] font-semibold text-gray-100">回答ログ</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="tbl-head">
                    <th className="px-3 py-2 text-left whitespace-nowrap">日時</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">機能</th>
                    <th className="px-3 py-2 text-left">入力</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">出典</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">tok in/out</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">ms</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">状態</th>
                    <th className="px-3 py-2 text-left whitespace-nowrap">評価</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">…</td></tr>
                  )}
                  {!loading && rows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center">
                      <div className="text-[12.5px] text-gray-600 mb-2">この条件に該当する記録はありません。</div>
                      <button type="button" onClick={() => { setDays(30); setFeature(""); setState(""); }}
                        className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-red-700 hover:bg-red-50">
                        条件を広げる（30日・すべて）
                      </button>
                      <div className="mt-3 text-[11px] text-gray-400">
                        マイグレーション未適用、または AI_TRACE_ENABLED=false のときも0件になります。
                      </div>
                    </td></tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.id}
                      className={`border-b border-gray-100 ${selId === r.id ? "bg-red-50" : "hover:bg-gray-50"}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-500">{fmtJst(r.createdAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{featureLabel(r.feature)}</td>
                      <td className="px-3 py-2 text-gray-800">{r.userInput || "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">{r.sourceCount || "—"}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-500">
                        {nf(r.tokensIn)} / {nf(r.tokensOut)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-500">{nf(r.latencyMs)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{stateBadge(r)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{ratingBadge(r.rating)}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <button type="button" onClick={() => void openDetail(r.id)}
                          className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-[11.5px] font-semibold text-gray-600 hover:bg-gray-50">
                          詳細
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 詳細 */}
          {selId != null && (
            <div className={`${CARD} overflow-hidden`}>
              <div className={`${CARD_HEAD} justify-between`}>
                <span className="text-[12.5px] font-semibold text-gray-100">詳細　#{selId}</span>
                <button type="button" onClick={() => { setSelId(null); setDetail(null); }}
                  className="text-[11.5px] text-gray-300 hover:text-white">閉じる</button>
              </div>
              <div className="p-4">
                {detailErr && (
                  <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{detailErr}</div>
                )}
                {!detail && !detailErr && <div className="text-gray-400 text-[12.5px]">…</div>}
                {detail && (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-3">
                      <div className={`${CARD} p-3 text-[12px] space-y-1`}>
                        <div><span className="text-gray-400">機能</span>　{featureLabel(detail.feature)}
                          {detail.entry && <span className="text-gray-400">（{detail.entry}）</span>}</div>
                        <div><span className="text-gray-400">request_id</span>　<code className="text-[11px]">{detail.requestId || "—"}</code></div>
                        <div><span className="text-gray-400">prompt版</span>　<code className="text-[11px]">{detail.promptVersion || "—"}</code></div>
                        <div><span className="text-gray-400">model</span>　{detail.model}
                          {detail.temperature != null && <> / temp {detail.temperature}</>}
                          {detail.maxTokens != null && <> / max {detail.maxTokens}</>}</div>
                        <div><span className="text-gray-400">計測</span>　LLM {nf(detail.latencyMs)}ms ／ 全体 {nf(detail.totalMs)}ms ／ 再試行 {detail.retryCount}</div>
                        <div><span className="text-gray-400">トークン</span>　in {nf(detail.tokensIn)} / out {nf(detail.tokensOut)}
                          <span className="text-gray-400">　コスト</span>　{money(detail.costJpy, priceConfigured)}
                          {!priceConfigured && <span className="text-[11px] text-gray-400">（単価未設定）</span>}</div>
                        {detail.error && <div className="text-red-700">エラー：{detail.error}</div>}
                      </div>

                      <div>
                        <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1">検索の候補と採点</div>
                        {detail.retrieval.length === 0 ? (
                          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12px] text-gray-500">
                            記録なし（この機能は検索を行わない、または検索が0件）
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border border-gray-200">
                            <table className="w-full text-[11.5px]">
                              <thead><tr className="tbl-head">
                                <th className="px-2 py-1.5 text-left">出典</th>
                                <th className="px-2 py-1.5 text-right">vec</th>
                                <th className="px-2 py-1.5 text-right">kw</th>
                                <th className="px-2 py-1.5 text-right">score</th>
                                <th className="px-2 py-1.5 text-left">採用</th>
                              </tr></thead>
                              <tbody>
                                {(detail.retrieval as AiRetrievalItem[]).map((it, i) => (
                                  <tr key={i} className="border-b border-gray-100">
                                    <td className="px-2 py-1.5">[{it.src ?? "?"}] {it.title || it.id}</td>
                                    <td className="px-2 py-1.5 text-right">{(it.vec ?? 0).toFixed(2)}</td>
                                    <td className="px-2 py-1.5 text-right">{(it.kw ?? 0).toFixed(2)}</td>
                                    <td className="px-2 py-1.5 text-right">{(it.score ?? 0).toFixed(2)}</td>
                                    <td className="px-2 py-1.5">{it.used ? "○" : "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        <div className="mt-1 text-[11px] text-gray-400">
                          vec / kw の内訳は Ph2（検索SQL v2）で記録されます。現在は score のみ。
                        </div>
                      </div>

                      <Pre label="入力" body={detail.userInput} />
                      <Pre label="回答" body={detail.answer} />
                      {detail.feedback.length > 0 && (
                        <div className="text-[12px]">
                          <span className="text-gray-400">評価</span>　
                          {detail.feedback.map((f, i) => (
                            <span key={i} className={f.rating > 0 ? badgeOk : badgeWarn}>
                              {f.rating > 0 ? "良い" : "悪い"}{f.reason ? `：${f.reason}` : ""}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="space-y-3">
                      <Pre label="LLMへ送った system（全文）" body={detail.systemPrompt} />
                      <Pre label="LLMへ送った messages（全文）"
                        body={JSON.stringify(detail.messagesJson, null, 2)} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={`${CARD} p-3 flex flex-wrap items-center gap-2`}>
            <select className={FIELD_SELECT} value={usageDays} onChange={(e) => setUsageDays(Number(e.target.value))}>
              <option value={7}>直近7日</option>
              <option value={30}>直近30日</option>
              <option value={90}>直近90日</option>
            </select>
            <button type="button" onClick={() => void loadUsage()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 hover:bg-gray-50">
              更新
            </button>
            {!priceConfigured && (
              <span className="ml-auto text-[11.5px] text-red-700">
                単価が未設定のため金額は表示しません（ai_model_prices）
              </span>
            )}
          </div>

          {usageErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{usageErr}</div>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${CARD} p-3`}>
              <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider">呼び出し</div>
              <div className="text-[20px] font-bold text-gray-700 leading-snug">
                {usageLoading ? "…" : nf(totalCalls)}<span className="text-[12px] text-gray-500"> 回</span>
              </div>
            </div>
            <div className={`${CARD} p-3`}>
              <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider">推定コスト</div>
              <div className="text-[20px] font-bold text-gray-700 leading-snug">
                {usageLoading ? "…" : money(totalCost, priceConfigured)}
              </div>
            </div>
            <div className={`${CARD} p-3`}>
              <div className="text-[10.5px] font-semibold text-gray-400 tracking-wider">該当なし率</div>
              <div className={`text-[20px] font-bold leading-snug ${refusedRate >= 20 ? "text-red-700" : "text-gray-700"}`}>
                {usageLoading ? "…" : `${refusedRate.toFixed(1)}%`}
              </div>
            </div>
          </div>

          <div className={`${CARD} overflow-hidden`}>
            <div className={CARD_HEAD}>
              <span className="text-[12.5px] font-semibold text-gray-100">機能別</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="tbl-head">
                    <th className="px-3 py-2 text-left">機能</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">回数</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">入力tok</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">出力tok</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">平均ms</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">p95 ms</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">エラー</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">該当なし</th>
                    <th className="px-3 py-2 text-right whitespace-nowrap">コスト</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLoading && usage.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-6 text-center text-gray-400">…</td></tr>
                  )}
                  {!usageLoading && usage.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-8 text-center">
                      <div className="text-[12.5px] text-gray-600">この期間の記録はありません。</div>
                      <div className="mt-2 text-[11px] text-gray-400">
                        マイグレーション未適用、または AI_TRACE_ENABLED=false のときも0件になります。
                      </div>
                    </td></tr>
                  )}
                  {usage.map((u) => (
                    <tr key={u.feature} className="border-b border-gray-100">
                      <td className="px-3 py-2">{featureLabel(u.feature)}</td>
                      <td className="px-3 py-2 text-right">{nf(u.calls)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{nf(u.tokensIn)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{nf(u.tokensOut)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{nf(u.avgMs)}</td>
                      <td className="px-3 py-2 text-right text-gray-500">{nf(u.p95Ms)}</td>
                      <td className={`px-3 py-2 text-right ${u.errors > 0 ? "text-red-700 font-semibold" : "text-gray-500"}`}>
                        {u.errors > 0 ? nf(u.errors) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right ${u.refused > 0 ? "text-red-700" : "text-gray-500"}`}>
                        {u.refused > 0 ? nf(u.refused) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-gray-500">{money(u.costJpy, priceConfigured)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
