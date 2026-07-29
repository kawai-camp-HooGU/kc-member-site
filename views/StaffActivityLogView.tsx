"use client";
// ============================================================
// スタッフ別 対応ログ 抽出（Staff Activity Log）
//   4つのデータソース（LINE送信 / メール送信 / ポータルトーク送信 / 決済登録・更新）を
//   スタッフ×日時で横断抽出する運営専用画面。
//     ・上部：スタッフ×種別の件数サマリー（集計用途）
//     ・下部：明細テーブル（監査用途）＋ CSV 出力
//   データは RPC get_staff_activity / _summary（運営のみ・security definer）。
//   ⚠️ 他スタッフの本文・会員個人情報を横断表示するため、staff_activity 権限で保護。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMaster } from "../hooks/useMaster";
import { isStaffRole } from "../lib/roles";
import { fmtJst } from "../lib/dateFmt";
import { Icon } from "../components/common/Icon";
import {
  ALL_KINDS, KIND_LABEL, buildActivityCsv, downloadCsv,
  fetchActivityAccounts, fetchStaffActivity, fetchStaffActivitySummary,
} from "../lib/staffActivity";
import type {
  AccountOption, ActivityFilters, ActivityKind, ActivityRow, ActivitySummaryRow,
} from "../lib/staffActivity";

const PAGE = 200;

// 種別ごとの配色（バー・チップ・アイコン）
const KIND_STYLE: Record<ActivityKind, { chip: string; bar: string; ic: string; short: string }> = {
  line: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", ic: "bg-emerald-500", short: "L" },
  mail: { chip: "bg-blue-50 text-blue-700 border-blue-200",          bar: "bg-blue-500",    ic: "bg-blue-500",    short: "M" },
  talk: { chip: "bg-violet-50 text-violet-700 border-violet-200",    bar: "bg-violet-500",  ic: "bg-violet-500",  short: "T" },
  pay:  { chip: "bg-amber-50 text-amber-700 border-amber-200",       bar: "bg-amber-500",   ic: "bg-amber-500",   short: "¥" },
};

// 操作バッジの色（登録=indigo / 更新・照合=amber / 削除=red / 送信系=emerald）
function actionBadge(action: string): string {
  const a = action.toLowerCase();
  if (a.startsWith("create")) return "bg-indigo-50 text-indigo-600 border-indigo-200";
  if (a === "delete")         return "bg-red-50 text-red-600 border-red-200";
  if (a === "update" || a === "match" || a === "restore") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-emerald-50 text-emerald-700 border-emerald-200";
}

// ── 期間プリセット（ローカル日付ベース） ─────────────────────
type Preset = "today" | "week" | "month" | "lastmonth" | "custom";
const PRESET_LABEL: Record<Preset, string> = {
  today: "今日", week: "今週", month: "今月", lastmonth: "先月", custom: "カスタム",
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function presetRange(p: Preset): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  if (p === "today") return { from: ymd(start), to: ymd(start) };
  if (p === "week") {
    const dow = (start.getDay() + 6) % 7; // 月曜起点
    const mon = new Date(start); mon.setDate(start.getDate() - dow);
    return { from: ymd(mon), to: ymd(start) };
  }
  if (p === "month") {
    return { from: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), to: ymd(start) };
  }
  // lastmonth
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const last = new Date(now.getFullYear(), now.getMonth(), 0);
  return { from: ymd(first), to: ymd(last) };
}

// 日付文字列 → ISO（from=その日00:00 / to=翌日00:00 の排他終端）
const fromIso = (d: string) => (d ? new Date(`${d}T00:00:00`).toISOString() : null);
const toIsoExcl = (d: string) => {
  if (!d) return null;
  const dt = new Date(`${d}T00:00:00`); dt.setDate(dt.getDate() + 1);
  return dt.toISOString();
};

// ── 汎用：チェックボックス・ドロップダウン ───────────────────
function MultiSelect<T extends string | number>({
  label, options, selected, onChange, allLabel = "すべて", width = "w-56",
}: {
  label: string;
  options: { value: T; label: string; hint?: string }[];
  selected: T[];
  onChange: (v: T[]) => void;
  allLabel?: string;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const toggle = (v: T) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? allLabel
    : selected.length === 1 ? (options.find((o) => o.value === selected[0])?.label ?? `${selected.length}件`)
    : `${selected.length}件選択`;
  return (
    <div className="flex flex-col gap-1" ref={ref}>
      <label className="text-[10.5px] text-slate-400 font-bold tracking-wide">{label}</label>
      <div className="relative">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className={`${width} flex items-center gap-2 border border-slate-200 bg-white rounded-lg px-3 py-1.5 text-xs text-slate-700 hover:border-slate-300`}>
          <span className="truncate flex-1 text-left">{summary}</span>
          <span className="text-slate-400">▾</span>
        </button>
        {open && (
          <div className={`absolute z-20 mt-1 ${width} max-h-64 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1`}>
            <button type="button" onClick={() => onChange([])}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-50">
              {allLabel}（選択解除）
            </button>
            {options.map((o) => (
              <label key={String(o.value)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 cursor-pointer">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)}
                  className="accent-red-600" />
                <span className="truncate flex-1">{o.label}</span>
                {o.hint && <span className="text-[10px] text-slate-400">{o.hint}</span>}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// 種別チップ（アイコン＋短ラベル）
function KindChip({ kind }: { kind: ActivityKind }) {
  const s = KIND_STYLE[kind];
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded border ${s.chip}`}>
      <span className={`inline-flex items-center justify-center w-3.5 h-3.5 rounded text-[8px] font-black text-white ${s.ic}`}>{s.short}</span>
      {KIND_LABEL[kind]}
    </span>
  );
}

export function StaffActivityLogView() {
  const { members } = useMaster();

  // スタッフ候補（運営ロールのみ）
  const staffOptions = useMemo(
    () => members
      .filter((m) => !m.isDeleted && isStaffRole(m.role))
      .map((m) => ({ value: m.id, label: m.name, hint: m.role })),
    [members],
  );

  // ── フィルタ状態 ──
  const [preset, setPreset] = useState<Preset>("month");
  const [range, setRange] = useState(() => presetRange("month"));
  const [staffIds, setStaffIds] = useState<number[]>([]);
  const [kinds, setKinds] = useState<ActivityKind[]>([]);
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [includeAuto, setIncludeAuto] = useState(false);
  const [keyword, setKeyword] = useState("");

  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  useEffect(() => { fetchActivityAccounts().then(setAccounts).catch(() => setAccounts([])); }, []);

  // ── 結果状態 ──
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [summary, setSummary] = useState<ActivitySummaryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [ran, setRan] = useState(false);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p !== "custom") setRange(presetRange(p));
  };

  const buildFilters = useCallback((): ActivityFilters => ({
    from: fromIso(range.from),
    to: toIsoExcl(range.to),
    staffIds,
    kinds,
    accountIds,
    includeAuto,
    keyword,
  }), [range, staffIds, kinds, accountIds, includeAuto, keyword]);

  const run = useCallback(async () => {
    setLoading(true); setError(""); setRan(true);
    const f = buildFilters();
    const [list, sum] = await Promise.all([
      fetchStaffActivity(f, PAGE, 0),
      fetchStaffActivitySummary(f),
    ]);
    if (list.error) setError(list.error);
    else if (sum.error) setError(sum.error);
    setRows(list.rows);
    setSummary(sum.rows);
    setHasMore(list.rows.length >= PAGE);
    setLoading(false);
  }, [buildFilters]);

  const loadMore = useCallback(async () => {
    setLoading(true);
    const { rows: more } = await fetchStaffActivity(buildFilters(), PAGE, rows.length);
    setRows((prev) => [...prev, ...more]);
    setHasMore(more.length >= PAGE);
    setLoading(false);
  }, [buildFilters, rows.length]);

  // 初回自動抽出
  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const onCsv = () => {
    if (!rows.length) return;
    downloadCsv(`staff_activity_${range.from}_${range.to}.csv`, buildActivityCsv(rows));
  };

  // ── サマリー集計（KPI＋スタッフ別バー） ──
  const kpi = useMemo(() => {
    const m: Record<ActivityKind, number> = { line: 0, mail: 0, talk: 0, pay: 0 };
    for (const s of summary) m[s.kind] += s.cnt;
    return m;
  }, [summary]);

  const perStaff = useMemo(() => {
    const map = new Map<string, { name: string; total: number; k: Record<ActivityKind, number> }>();
    for (const s of summary) {
      const key = s.staffId == null ? "auto" : String(s.staffId);
      if (!map.has(key)) map.set(key, { name: s.staffName || "(自動/不明)", total: 0, k: { line: 0, mail: 0, talk: 0, pay: 0 } });
      const e = map.get(key)!;
      e.k[s.kind] += s.cnt; e.total += s.cnt;
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [summary]);

  const maxStaffTotal = Math.max(1, ...perStaff.map((p) => p.total));
  const accountOptions = accounts.map((a) => ({
    value: a.id, label: a.label, hint: a.kind === "line" ? "LINE" : "メール",
  }));

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col w-full">
      {/* 見出し */}
      <div className="shrink-0 mb-3">
        <div className="text-xs text-slate-500">運営メニュー › <span className="text-slate-700 font-medium">顧客</span> › 対応ログ</div>
        <h1 className="text-2xl font-bold text-slate-800 mt-1">スタッフ別 対応ログ</h1>
        <p className="text-sm text-slate-500">LINE・メール・ポータルトークの送信、決済の登録／更新をスタッフ単位で横断抽出します。</p>
      </div>

      {/* フィルタ */}
      <div className="shrink-0 bg-white border border-slate-200 rounded-xl px-3.5 py-3 mb-3">
        {/* 期間プリセット */}
        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          {(Object.keys(PRESET_LABEL) as Preset[]).map((p) => (
            <button key={p} onClick={() => applyPreset(p)}
              className={`text-xs font-bold px-3 py-1 rounded-full border ${preset === p ? "bg-red-600 text-white border-red-600" : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"}`}>
              {PRESET_LABEL[p]}
            </button>
          ))}
          <div className="flex items-center gap-1.5 ml-1">
            <input type="date" value={range.from}
              onChange={(e) => { setRange((r) => ({ ...r, from: e.target.value })); setPreset("custom"); }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700" />
            <span className="text-slate-400 text-xs">〜</span>
            <input type="date" value={range.to}
              onChange={(e) => { setRange((r) => ({ ...r, to: e.target.value })); setPreset("custom"); }}
              className="border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-700" />
          </div>
        </div>

        {/* 種別トグル＋各種フィルタ */}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] text-slate-400 font-bold tracking-wide">種別</label>
            <div className="flex items-center gap-1">
              {ALL_KINDS.map((k) => {
                const on = kinds.length === 0 || kinds.includes(k);
                return (
                  <button key={k} onClick={() => setKinds((prev) =>
                      prev.includes(k) ? prev.filter((x) => x !== k)
                      : prev.length === 0 ? ALL_KINDS.filter((x) => x !== k) // 全ON状態から1つ外す
                      : [...prev, k])}
                    className={`text-[11px] font-bold px-2 py-1 rounded border transition-opacity ${KIND_STYLE[k].chip} ${on ? "opacity-100" : "opacity-35"}`}>
                    {KIND_LABEL[k]}
                  </button>
                );
              })}
            </div>
          </div>

          <MultiSelect label="スタッフ" options={staffOptions} selected={staffIds} onChange={setStaffIds} allLabel="全員" />
          <MultiSelect label="アカウント" options={accountOptions} selected={accountIds} onChange={setAccountIds} />

          <div className="flex flex-col gap-1">
            <label className="text-[10.5px] text-slate-400 font-bold tracking-wide">キーワード</label>
            <div className="flex items-center gap-1.5 border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 w-48">
              <Icon name="search" size={13} className="text-slate-400" />
              <input value={keyword} onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") run(); }}
                placeholder="本文・相手名" className="text-xs text-slate-700 outline-none w-full bg-transparent" />
            </div>
          </div>

          <label className="flex items-center gap-1.5 text-xs text-slate-600 pb-1.5">
            <input type="checkbox" checked={includeAuto} onChange={(e) => setIncludeAuto(e.target.checked)} className="accent-red-600" />
            自動送信を含む
          </label>

          <div className="flex items-center gap-2 ml-auto pb-0.5">
            <button onClick={onCsv} disabled={!rows.length}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40">
              <Icon name="download" size={14} /> CSV
            </button>
            <button onClick={run} disabled={loading}
              className="inline-flex items-center gap-1.5 text-xs font-bold px-4 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60">
              {loading ? "抽出中…" : "抽出"}
            </button>
          </div>
        </div>
      </div>

      {/* 本文（スクロール） */}
      <div className="flex-1 min-h-0 overflow-auto -mx-1 px-1">
        {error && (
          <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            抽出に失敗しました：{error}
          </div>
        )}

        {/* サマリー */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-3">
          {ALL_KINDS.map((k) => (
            <div key={k} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-[11.5px] font-bold flex items-center gap-1.5">
                <span className={`inline-flex items-center justify-center w-4 h-4 rounded text-[9px] font-black text-white ${KIND_STYLE[k].ic}`}>{KIND_STYLE[k].short}</span>
                {KIND_LABEL[k]}
              </div>
              <div className="text-2xl font-extrabold text-slate-800 mt-1 tabular-nums">{kpi[k].toLocaleString("ja-JP")}<span className="text-xs font-semibold text-slate-400 ml-1">件</span></div>
            </div>
          ))}
        </div>

        {/* スタッフ別 件数バー */}
        <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 mb-3">
          <div className="text-[13px] font-bold text-slate-700 mb-2">スタッフ別 対応件数（種別内訳）</div>
          {perStaff.length === 0 ? (
            <div className="text-xs text-slate-400 py-3">該当データがありません。</div>
          ) : perStaff.map((p, i) => (
            <div key={i} className="flex items-center gap-3 py-1">
              <span className="w-24 text-xs font-bold text-slate-700 truncate">{p.name}</span>
              <div className="flex-1 h-5 bg-slate-100 rounded-md overflow-hidden flex">
                {ALL_KINDS.map((k) => p.k[k] > 0 && (
                  <span key={k} className={KIND_STYLE[k].bar} style={{ width: `${(p.k[k] / maxStaffTotal) * 100}%` }} title={`${KIND_LABEL[k]} ${p.k[k]}`} />
                ))}
              </div>
              <span className="w-12 text-right text-xs font-extrabold text-slate-700 tabular-nums">{p.total}</span>
            </div>
          ))}
          <div className="flex gap-3.5 flex-wrap mt-2 text-[11px] text-slate-500">
            {ALL_KINDS.map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-sm ${KIND_STYLE[k].bar}`} />{KIND_LABEL[k]}
              </span>
            ))}
          </div>
        </div>

        {/* 明細テーブル */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="bg-slate-700 text-white text-left">
                  <th className="px-3 py-2 font-semibold whitespace-nowrap">日時</th>
                  <th className="px-3 py-2 font-semibold">種別</th>
                  <th className="px-3 py-2 font-semibold">スタッフ</th>
                  <th className="px-3 py-2 font-semibold">アカウント</th>
                  <th className="px-3 py-2 font-semibold">相手</th>
                  <th className="px-3 py-2 font-semibold">操作</th>
                  <th className="px-3 py-2 font-semibold">内容</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && ran && !loading && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400 text-xs">該当する対応ログはありません。</td></tr>
                )}
                {rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-slate-500 tabular-nums">{fmtJst(r.at)}</td>
                    <td className="px-3 py-2"><KindChip kind={r.kind} /></td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-700">{r.staffName || <span className="text-slate-400">(自動/不明)</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600">{r.accountLabel || <span className="text-slate-300">—</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-slate-600 max-w-[160px] truncate" title={r.counterpart}>{r.counterpart || "—"}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${actionBadge(r.action)}`}>{r.action}</span></td>
                    <td className="px-3 py-2 text-slate-700 max-w-[360px] truncate" title={r.summary}>{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
            <span>{rows.length.toLocaleString("ja-JP")} 件を表示{hasMore ? "（続きあり）" : ""}</span>
            {hasMore && (
              <button onClick={loadMore} disabled={loading}
                className="text-xs font-bold px-3 py-1 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                さらに読み込む
              </button>
            )}
          </div>
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
