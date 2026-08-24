"use client";
// ============================================================
// ⑥ データ検索（運営）  view = "datasearch"
//   自然文で聞くと、サーバー側の「許可済み集計/抽出関数」だけが動いて
//   要約＋表が返る。参照範囲は scope（タブ）で決まる。
//   feature = ai_data_search（運営のみ）。
//
//   ⚠️ 会員データ・決済データの scope は、サーバー側で個人情報を最大300件
//      プロンプトへ渡す。メール・電話は lib/ai/pii.ts でマスク済み（R2で適用）。
//      それでも氏名は渡るため、この画面の権限は絞って運用すること。
// ============================================================
import { useState } from "react";
import { aiDataSearch } from "../lib/aiClient";
import { SEARCH_SCOPE_LABEL } from "../lib/ai/types";
import type { SearchScope, DataSearchRes } from "../lib/ai/types";
import { downloadCsv } from "../lib/listExport";
import { SUCCESS_CONFIG } from "../lib/constants";

const SCOPES: SearchScope[] = ["members", "chat_stats", "contents", "payments"];

/** scope ごとの聞き方の例。空欄のまま固まらないように必ず出す。 */
const EXAMPLES: Record<SearchScope, string[]> = {
  members: ["今月入会した会員を一覧にして", "属性が「体験」のままの会員は何人いる", "都道府県ごとの会員数"],
  chat_stats: ["先月のトーク件数を週ごとに", "返信までの平均時間", "未返信のまま48時間を超えたトーク"],
  contents: ["公開中のコンテンツを新しい順に", "お知らせのカテゴリ別件数", "3か月更新されていない資料"],
  payments: ["今月の入金予定額", "未入金の件数と金額", "決済手段ごとの内訳"],
};

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

const csvCell = (v: string | number | null): string => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function DataSearchView() {
  const [scope, setScope] = useState<SearchScope>("members");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<DataSearchRes | null>(null);
  const [err, setErr] = useState("");

  const run = async (q?: string) => {
    const text = (q ?? query).trim();
    if (!text) { setErr("検索したい内容を入力してください"); return; }
    setBusy(true); setErr(""); setRes(null);
    try {
      setRes(await aiDataSearch({ scope, query: text }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!res || res.rows.length === 0) return;
    const head = res.columns.map(csvCell).join(",");
    const body = res.rows.map((r) => res.columns.map((c) => csvCell(r[c] ?? "")).join(","));
    // Excel が UTF-8 と判別できるよう BOM を付ける（lib/listExport.ts と同じ作法）
    const csv = `﻿${[head, ...body].join("\r\n")}\r\n`;
    const stamp = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
    downloadCsv(`データ検索_${SEARCH_SCOPE_LABEL[scope]}_${stamp}.csv`, csv);
  };

  const pickScope = (s: SearchScope) => { setScope(s); setRes(null); setErr(""); };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800 m-0">データ検索</h1>
        <p className="text-xs text-gray-400 mt-1">
          自然文で聞くと、選んだ範囲のデータだけを集計して返します。範囲外のデータは参照しません。
        </p>
      </div>

      {/* 参照範囲 */}
      <div className="flex flex-wrap gap-2">
        {SCOPES.map((s) => (
          <button key={s} type="button" onClick={() => pickScope(s)}
            className={`text-[12px] font-bold px-3.5 py-1.5 rounded-full border ${
              scope === s ? "bg-red-50 border-red-400 text-red-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
            {SEARCH_SCOPE_LABEL[s]}
          </button>
        ))}
      </div>

      {/* 入力 */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-2.5">
        <textarea className={`${input} min-h-[72px]`} value={query} placeholder={EXAMPLES[scope][0]}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void run(); } }} />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-gray-400">例：</span>
          {EXAMPLES[scope].map((ex) => (
            <button key={ex} type="button" onClick={() => { setQuery(ex); void run(ex); }} disabled={busy}
              className="text-[11.5px] border border-gray-300 bg-white text-gray-600 rounded-full px-2.5 py-1 hover:bg-gray-50 disabled:opacity-50">
              {ex}
            </button>
          ))}
          <div className="flex-1" />
          <button type="button" onClick={() => void run()} disabled={busy}
            className="text-sm bg-red-600 text-white rounded-lg px-5 py-1.5 font-bold hover:bg-red-700 disabled:opacity-50">
            {busy ? "検索中…" : "検索する"}
          </button>
        </div>
      </div>

      {err && (
        <div className="text-[12px] text-gray-700 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">{err}</div>
      )}

      {busy && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-10 text-center text-sm text-gray-400">…</div>
      )}

      {!busy && res && (
        <div className="space-y-3">
          {/* 要約 */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap m-0">{res.summary}</p>
            <p className="text-[11px] text-gray-400 mt-2">
              参照：{res.source}{res.period && ` ／ 期間：${res.period}`}
              {typeof res.remaining === "number" && ` ／ 本日の残り ${res.remaining} 回`}
            </p>
          </div>

          {/* 表 */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
              <span className="text-[12px] font-bold text-gray-700">
                {res.rows.length > 0 ? `${res.rows.length.toLocaleString()} 件` : "該当なし"}
              </span>
              <button type="button" onClick={exportCsv} disabled={res.rows.length === 0}
                className="text-[12px] font-bold px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-40">
                CSV出力
              </button>
            </div>
            {res.rows.length === 0 ? (
              <p className="text-sm text-gray-400 py-10 text-center m-0">
                条件に一致するデータはありませんでした。聞き方を変えて試してください。
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px] border-collapse">
                  <thead>
                    <tr className="tbl-head">
                      {res.columns.map((c) => (
                        <th key={c} className="text-left px-3 py-2 font-bold whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {res.rows.map((r, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        {res.columns.map((c) => (
                          <td key={c} className="px-3 py-2 text-gray-700 whitespace-nowrap">{r[c] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <p className={`text-[11px] ${SUCCESS_CONFIG.text}`}>
            数字は都度集計しています。会議資料などに使うときは、元データでも確認してください。
          </p>
        </div>
      )}

      {!busy && !res && !err && (
        <div className="bg-white border border-gray-200 rounded-xl px-4 py-12 text-center">
          <p className="text-sm text-gray-500 m-0">まだ検索していません。</p>
          <p className="text-[11.5px] text-gray-400 mt-1 m-0">上の例を押すか、聞きたいことを入力して「検索する」を押してください。</p>
        </div>
      )}
    </div>
  );
}
