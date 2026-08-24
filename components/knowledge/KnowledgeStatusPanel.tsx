"use client";
// ============================================================
// 取り込み状況（ナレッジ管理画面の上段）
//   入口ごとの件数と最終同期を出し、その場で同期・評価を実行できるようにする。
//   ⚠️ 同期の実行導線はこの画面に一本化した（旧：ボット設定）。2か所に置かない。
//   brand.md：一覧の見出しは .tbl-head ／絵文字なし ／読み込み中は「…」でレイアウトを保つ。
// ============================================================
import { useCallback, useEffect, useState } from "react";
import {
  knowledgeStatus, syncKnowledge, runKnowledgeEval, fetchIndexHealth,
  type KnowledgeSource, type KnowledgeStatusRow, type IndexHealthRes,
} from "../../lib/bot/botAdmin";
import { SUCCESS_CONFIG } from "../../lib/constants";
import { fmtJst } from "../../lib/dateFmt";

/** 表示順と日本語名。ここに無い入口が来ても source_type をそのまま出す。 */
const LABEL: Record<string, string> = {
  content: "資料", news: "お知らせ", chat_bookmark: "ブックマーク", note: "note", x: "X",
};
const ORDER = ["content", "news", "chat_bookmark", "note", "x"];
const orderOf = (t: string) => { const i = ORDER.indexOf(t); return i < 0 ? 99 : i; };

const SYNC_ORDER: KnowledgeSource[] = ["content", "news", "chat_bookmark", "note", "x"];

const num = (n: number) => (n > 0 ? n.toLocaleString() : "—");

// ── 索引の確認（B-11）───────────────────────────────────────
//   ⚠️ HNSW索引は pgvector 非対応環境で「握り潰して」作成をスキップする実装になっている。
//      索引が無くても SQL は成功するので、全走査のまま誰も気づかない。
//      件数が増えた時点で急に遅くなり、原因の特定に時間を取られる。
//   正常なときは何も出さない（常時出す注意書きは読まれなくなるため）。
function IndexHealth() {
  const [res, setRes] = useState<IndexHealthRes | null>(null);
  useEffect(() => { void fetchIndexHealth().then(setRes); }, []);
  if (!res) return null;

  const missing = res.available ? res.rows.filter((r) => !r.present || !r.valid) : [];
  if (res.available && missing.length === 0) return null;

  return (
    <section className="border border-amber-200 bg-amber-50 rounded-xl p-4 space-y-2">
      <h2 className="text-sm font-bold text-amber-900 m-0">索引の確認</h2>
      {!res.available ? (
        <p className="text-xs text-amber-800 m-0">{res.reason}</p>
      ) : (
        <>
          <p className="text-xs text-amber-800 m-0">
            次の索引がありません。<b>検索は動きますが、件数が増えると急に遅くなります。</b>
          </p>
          <ul className="text-xs text-amber-800 space-y-1 m-0">
            {missing.map((r) => (
              <li key={r.name}>
                <code className="font-bold">{r.name}</code>
                {!r.present ? "：未作成" : "：無効な状態"} — {r.note}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-amber-700 m-0">
            作成手順は「N-gram索引の有効化可否確認 手順書」を参照してください。
          </p>
        </>
      )}
    </section>
  );
}

export function KnowledgeStatusPanel() {
  const [rows, setRows] = useState<KnowledgeStatusRow[] | null>(null);
  const [unavailable, setUnavailable] = useState("");
  const [cronEnabled, setCronEnabled] = useState(false);
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [evalMsg, setEvalMsg] = useState("");
  const [err, setErr] = useState("");

  const reload = useCallback(async () => {
    try {
      const s = await knowledgeStatus();
      setRows([...s.rows].sort((a, b) => orderOf(a.sourceType) - orderOf(b.sourceType)));
      setUnavailable(s.unavailable ?? "");
      setCronEnabled(s.cronEnabled ?? false);
    } catch (e) {
      setRows([]);
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const syncAll = async (mode: "full" | "dry_run") => {
    setBusy(mode); setErr(""); setEvalMsg(""); setLog([]);
    const out: string[] = [];
    for (const src of SYNC_ORDER) {
      try {
        const r = await syncKnowledge(src, mode);
        const off = r.deactivated ? ` / 対象外 ${r.deactivated}` : "";
        out.push(`${LABEL[src] ?? src}：走査 ${r.scanned} / 更新 ${r.upserted} / 変更なし ${r.unchanged} / 断片 ${r.chunks}${off}`);
      } catch (e) {
        // 1つ落ちても残りは続ける（develop.md §9：失敗時は本処理を止めない）
        out.push(`${LABEL[src] ?? src}：失敗 — ${(e as Error).message}`);
      }
      setLog([...out]);
    }
    setBusy("");
    await reload();
  };

  const doEval = async () => {
    setBusy("eval"); setErr(""); setEvalMsg("");
    try {
      const s = await runKnowledgeEval();
      const ng = s.results.filter((r) => !r.pass).map((r) => r.id);
      setEvalMsg(`${s.passed} / ${s.total} 合格` + (ng.length ? `（不合格: ${ng.join(", ")}）` : ""));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy("");
    }
  };

  // 未取り込みの入口を拾って、次にやることを1行で示す
  const notIngested = (rows ?? []).filter((r) => r.documents === 0 && r.lastSyncedAt == null);

  return (
    <div className="space-y-3">
    <IndexHealth />
    <section className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-gray-800 m-0">取り込み状況</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            ここに入っているものだけがAIの回答の根拠になります。
            {cronEnabled ? "資料・お知らせ・ブックマークは15分ごとに自動で追従します。" : "自動更新は停止中です。"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void syncAll("dry_run")} disabled={busy !== ""}
            className="text-sm bg-white border border-gray-300 text-gray-700 rounded-lg px-3.5 py-1.5 font-bold hover:bg-gray-50 disabled:opacity-50">
            {busy === "dry_run" ? "確認中…" : "件数だけ確認"}
          </button>
          <button onClick={() => void syncAll("full")} disabled={busy !== ""}
            className="text-sm bg-gray-800 text-white rounded-lg px-3.5 py-1.5 font-bold hover:bg-gray-900 disabled:opacity-50">
            {busy === "full" ? "同期中…" : "いま同期する"}
          </button>
          <button onClick={() => void doEval()} disabled={busy !== ""}
            className="text-sm bg-white border border-gray-300 text-gray-700 rounded-lg px-3.5 py-1.5 font-bold hover:bg-gray-50 disabled:opacity-50">
            {busy === "eval" ? "評価中…" : "評価を実行"}
          </button>
        </div>
      </div>

      {unavailable && (
        <div className="text-[11.5px] text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{unavailable}</div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-[12px] border-collapse">
          <thead>
            <tr className="tbl-head">
              <th className="text-left px-3 py-2 font-bold">入口</th>
              <th className="text-right px-3 py-2 font-bold">文書</th>
              <th className="text-right px-3 py-2 font-bold">断片</th>
              <th className="text-right px-3 py-2 font-bold">検索対象</th>
              <th className="text-right px-3 py-2 font-bold">埋め込み</th>
              <th className="text-right px-3 py-2 font-bold">対象外</th>
              <th className="text-left px-3 py-2 font-bold">最終同期</th>
              <th className="text-left px-3 py-2 font-bold">更新</th>
            </tr>
          </thead>
          <tbody>
            {rows === null ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="px-3 py-6 text-center text-gray-400">
                取り込み元がまだ登録されていません。
              </td></tr>
            ) : rows.map((r) => (
              <tr key={r.sourceType} className="border-t border-gray-100">
                <td className="px-3 py-2 font-bold text-gray-800">{LABEL[r.sourceType] ?? r.sourceType}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(r.documents)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(r.chunks)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num(r.retrievable)}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${r.chunks > 0 && r.embedded < r.retrievable ? "text-amber-700 font-bold" : ""}`}>
                  {num(r.embedded)}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-gray-400">{num(r.inactive)}</td>
                <td className="px-3 py-2 text-gray-500">
                  {r.lastSyncedAt ? fmtJst(r.lastSyncedAt) : "未実施"}
                  {r.lastStatus && r.lastStatus !== "succeeded" && (
                    <span className="ml-1.5 text-amber-700 font-bold">（{r.lastStatus}）</span>
                  )}
                </td>
                <td className="px-3 py-2 text-gray-500">{r.auto ? (cronEnabled ? "自動 15分" : "自動（停止中）") : "手動"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {notIngested.length > 0 && (
        <div className="text-[11.5px] text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {notIngested.map((r) => LABEL[r.sourceType] ?? r.sourceType).join("・")}
          が未取り込みです。まず「件数だけ確認」で対象件数を見てから同期してください。
        </div>
      )}

      {log.length > 0 && (
        <ul className="text-[11.5px] text-gray-600 space-y-0.5">
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
      {evalMsg && (
        <div className={`text-[11.5px] font-bold ${SUCCESS_CONFIG.text}`}>評価：{evalMsg}</div>
      )}
      {err && <div className="text-[11.5px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{err}</div>}
    </section>
    </div>
  );
}
