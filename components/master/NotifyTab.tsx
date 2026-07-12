"use client";
import { useState } from "react";
import { CATEGORIES } from "../../lib/notifyCategories";
import { errMessage } from "../../lib/errors";
import { apiFetch } from "../../lib/apiClient";
import { NotifySettingsSection } from "./NotifySettingsSection";
import { useConfirm } from "../common/ConfirmProvider";

interface NotifyItem { project: string; roomId: string; assignee: string | null; category?: string; message: string; }
interface NotifySendResult { project: string; roomId: string; assignee: string | null; ok: boolean; error: string | null; }
interface NotifyRunResult {
  error?: string; dryRun?: boolean; count?: number; sample?: string; items?: NotifyItem[];
  sent?: number; total?: number; results?: NotifySendResult[];
}

export function NotifyTab() {
  const confirm = useConfirm();
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState<NotifyRunResult | null>(null);

  const CATS = CATEGORIES.map((c) => ({ key: c.key, label: c.tabLabel }));
  const DAILY = ["overdue3", "weekDue3", "todayDue3", "todayCp"];
  const IMP12 = ["overdue12", "weekDue12", "todayDue12"];
  const IMP0  = ["overdue0", "weekDue0", "todayDue0", "weekCp"];
  const PATTERNS = [
    { key: "daily", label: "毎日分（重要度Ⅲ＋本日CP）", cats: DAILY },
    { key: "mwf",   label: "月水金分（＋重要度Ⅰ〜Ⅱ）", cats: [...DAILY, ...IMP12] },
    { key: "mon",   label: "月曜分（全カテゴリ）",       cats: [...DAILY, ...IMP12, ...IMP0] },
  ];

  const run = async (cats: string[], dryRun: boolean) => {
    setBusy(true); setResult(null);
    try {
      const res = await apiFetch("/api/chatwork/notify", {
        method: "POST",
        body: { categories: cats, dryRun },
      });
      const json = (await res.json()) as NotifyRunResult;
      if (!res.ok) throw new Error(json.error ?? "失敗しました");
      setResult(json);
    } catch (err) {
      setResult({ error: errMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ label, cats }: { label: string; cats: string[] }) => (
    <div className="flex items-center gap-2 py-1.5 border-t border-gray-50 first:border-t-0">
      <span className="flex-1 text-sm text-gray-700">{label}</span>
      <button type="button" disabled={busy} onClick={() => run(cats, true)}
        className="px-3 py-1.5 text-xs rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">プレビュー</button>
      <button type="button" disabled={busy}
        onClick={async () => { if (await confirm({ title: "ChatWork送信", message: "ChatWork に実際に送信します。よろしいですか？", confirmLabel: "送信する" })) run(cats, false); }}
        className="px-3 py-1.5 text-xs rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-40">送信</button>
    </div>
  );

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">「プレビュー」は送信せず内容を表示します。「送信」は ChatWork に実際に投稿します（各プロジェクトの通知先ルームへ）。日付はサーバーの当日（JST）基準です。</p>

      <NotifySettingsSection />

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1.5">曜日パターン</p>
        {PATTERNS.map((p) => <Row key={p.key} label={p.label} cats={p.cats} />)}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-1.5">カテゴリ別</p>
        {CATS.map((c) => <Row key={c.key} label={c.label} cats={[c.key]} />)}
      </div>

      {busy && <p className="text-sm text-gray-400">処理中…</p>}

      {result && !busy && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          {result.error && <p className="text-sm text-red-500">エラー: {result.error}</p>}
          {!result.error && result.dryRun && (
            <>
              {result.sample && (
                <div className="border border-red-100 bg-blue-50/40 rounded-lg p-2">
                  <p className="text-xs text-red-700 font-semibold mb-1">送信フォーマット（サンプル）</p>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans m-0">{result.sample}</pre>
                </div>
              )}
              <p className="text-sm font-semibold text-gray-700">実際の対象（{result.count} プロジェクト）</p>
              {result.count === 0 && <p className="text-sm text-gray-400">現在、該当する対象タスクはありません（上のフォーマットで送信されます）。</p>}
              {(result.items ?? []).map((it, i) => (
                <div key={i} className="border border-gray-100 rounded-lg p-2">
                  <p className="text-xs text-gray-500 mb-1">▸ {it.project}{it.assignee ? `（担当: ${it.assignee}）` : ""}（ルーム: {it.roomId}）</p>
                  <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans m-0">{it.message}</pre>
                </div>
              ))}
            </>
          )}
          {!result.error && result.dryRun === false && (
            <>
              <p className="text-sm font-semibold text-gray-700">送信結果（{result.sent}/{result.total} 成功）</p>
              {result.total === 0 && <p className="text-sm text-gray-400">該当する通知はありませんでした。</p>}
              {(result.results ?? []).map((r, i) => (
                <p key={i} className={`text-xs ${r.ok ? "text-green-600" : "text-red-500"}`}>
                  {r.ok ? "✅" : "❌"} {r.project}{r.assignee ? `（担当: ${r.assignee}）` : ""}（ルーム: {r.roomId}）{r.error ? ` — ${r.error}` : ""}
                </p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
