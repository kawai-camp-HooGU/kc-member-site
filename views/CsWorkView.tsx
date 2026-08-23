"use client";
// ============================================================
// CsWork（運営 ＞ CsWork）：CS運用ドキュメントの閲覧と差し替え（REQ-028）
//
//   タブ構成
//     導線種別   … 導線種別mdをそのまま投影（概要／資料一覧／タスク）
//     設定値     … 「運用設定値」をそのまま投影（パスワードは伏字）
//     業務フロー … 同じmdのタスクを、使うツール順に組み替えた作業手順
//     AI作業設計 … 委任範囲・制約・準備状況
//     要監視顧客 … 顧客ごとのトグル。滞留判定はサーバー側で自動計算
//     更新       … md / CSV の差し替えと履歴からの復元
//
//   ⚠️ 本文HTMLはサーバー（lib/csWork/parse.ts）でエスケープしてから組み立てている。
//      アップロードされた md をそのまま innerHTML に流していない。
//   ⚠️ md を差し替えれば次の読み込みから反映される。デプロイは不要。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "../components/common/ToastProvider";
import { useMaster } from "../hooks/useMaster";
import { fmtJst } from "../lib/dateFmt";

type Tab = "funnels" | "config" | "flow" | "design" | "watch" | "upload";
type Kind = "ops" | "design" | "watchlist";

interface Section { title: string; html: string; }
interface Task { funnel: string; name: string; tool: string; html: string; }
interface Funnel { name: string; summaryHtml: string; sections: Section[]; tasks: Task[]; }
interface FlowStep { tool: string; account: { 用途?: string; url?: string; id?: string } | null; tasks: Task[]; }
interface WatchRow {
  優先度: string; 導線種別: string; 氏名: string; 現況: string;
  LINE名: string; メールアドレス: string; 電話番号: string; 顧客ID: string; 予定日: string;
  監視要件: string; 最終アクション日: string; 最終アクション内容: string;
  次アクション予定日: string; 次アクション提案: string; 備考: string;
  stale: { level: string; reason: string };
  links: { name: string; url: string | null }[];
}
interface DocRow {
  id: string; kind: Kind; title: string | null; version: string | null;
  filename: string | null; is_current: boolean; uploaded_at: string; bytes: number | null;
  meta?: { validation?: { label: string; status: string; detail: string }[] } | null;
}
interface Payload {
  ops: { title: string; version: string; funnels: Funnel[]; intro: Section[]; settingsSections: Section[] } | null;
  flow: FlowStep[];
  design: { title: string; sections: Section[] } | null;
  watch: WatchRow[];
  docs: { ops: DocRow | null; design: DocRow | null; watchlist: DocRow | null };
  reveal: boolean;
}

const TABS: { key: Tab; label: string }[] = [
  { key: "funnels", label: "導線種別" },
  { key: "config",  label: "設定値" },
  { key: "flow",    label: "業務フロー" },
  { key: "design",  label: "AI作業設計" },
  { key: "watch",   label: "要監視顧客" },
  { key: "upload",  label: "更新" },
];

const KIND_LABEL: Record<Kind, string> = { ops: "導線種別（md）", design: "AI作業設計（md）", watchlist: "要監視顧客（CSV）" };

const funnelCls = (name: string) =>
  name === "個別面談" ? "bg-red-50 text-red-700 border-red-200"
  : name === "未購入者ウェビナー" ? "bg-blue-50 text-blue-700 border-blue-200"
  : name === "資料請求" ? "bg-amber-50 text-amber-700 border-amber-200"
  : "bg-gray-100 text-gray-500 border-gray-200";

const staleCls = (level: string) =>
  level === "最優先" ? "bg-red-600 text-white border-red-700"
  : level === "要フォロー" ? "bg-amber-50 text-amber-700 border-amber-200"
  : level === "対象外" ? "bg-gray-100 text-gray-500 border-gray-200"
  : level === "要確認" ? "bg-purple-50 text-purple-700 border-purple-200"
  : "bg-emerald-50 text-emerald-700 border-emerald-200";

export function CsWorkView() {
  const toast = useToast();
  const { can } = useMaster();
  const [tab, setTab] = useState<Tab>("funnels");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [reveal, setReveal] = useState(false);
  const [funnelFilter, setFunnelFilter] = useState("all");
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (withSecret = false) => {
    setLoading(true);
    const res = await apiFetch(`/api/ops/cswork${withSecret ? "?reveal=1" : ""}`);
    if (!res.ok) { setLoading(false); toast.error("読み込みに失敗しました"); return; }
    setData(await res.json());
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(false); }, [load]);

  // 認証情報の表示は明示操作のみ。ページを離れたら伏字へ戻す。
  const toggleReveal = async () => {
    const next = !reveal;
    setReveal(next);
    await load(next);
  };

  const funnels = data?.ops?.funnels ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: data?.watch.length ?? 0 };
    for (const r of data?.watch ?? []) c[r.導線種別] = (c[r.導線種別] ?? 0) + 1;
    return c;
  }, [data]);

  const visibleWatch = (data?.watch ?? []).filter((r) => {
    if (funnelFilter !== "all" && r.導線種別 !== funnelFilter) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return JSON.stringify(r).toLowerCase().includes(q);
  });

  const setAllOpen = (open: boolean) => {
    bodyRef.current?.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = open; });
  };

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      {/* ヘッダ */}
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-extrabold">CsWork</h1>
          <span className="text-xs text-gray-500">CS運用のドキュメント。md を差し替えるとこの画面に反映されます</span>
          <span className="ml-auto text-[11px] text-gray-400">
            {data?.docs.ops ? `最終更新 ${fmtJst(data.docs.ops.uploaded_at)}／版 ${data.docs.ops.version ?? "-"}` : ""}
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

        {tab !== "upload" && (
          <div className="flex gap-2 py-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="キーワードで絞り込む（例：リマインド、報告、URL）"
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
            <button onClick={() => setAllOpen(true)} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">すべて開く</button>
            <button onClick={() => setAllOpen(false)} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">すべて閉じる</button>
            {can("cswork_secret") && (
              <button onClick={toggleReveal}
                className={`rounded-lg px-3 py-2 text-[12px] border ${reveal ? "bg-red-50 border-red-300 text-red-700 font-bold" : "border-gray-200"}`}>
                {reveal ? "認証情報を隠す" : "認証情報を表示"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* 本文 */}
      <div ref={bodyRef} className="flex-1 overflow-auto px-5 pb-8 cswork">
        {loading && <div className="text-center text-sm text-gray-400 py-16">読み込み中…</div>}

        {!loading && !data?.ops && tab !== "upload" && (
          <EmptyState onGo={() => setTab("upload")} />
        )}

        {!loading && tab === "funnels" && data?.ops && (
          <>
            {data.ops.intro.map((s) => (
              <Toggle key={s.title} title={s.title} query={query}><Html html={s.html} /></Toggle>
            ))}
            {funnels.map((f) => (
              <div key={f.name} className="mt-6">
                <div className="flex items-center gap-2 border-b-2 border-gray-200 pb-2 mb-3">
                  <span className={`text-[12px] font-bold px-3 py-1 rounded-full border ${funnelCls(f.name)}`}>{f.name}</span>
                  <span className="text-[11px] text-gray-400">タスク {f.tasks.length}件</span>
                </div>
                {f.summaryHtml && <Toggle title="概要" query={query}><Html html={f.summaryHtml} /></Toggle>}
                {f.sections.filter((s) => !s.title.startsWith("タスク")).map((s) => (
                  <Toggle key={s.title} title={s.title} query={query}><Html html={s.html} /></Toggle>
                ))}
                <Toggle title={`タスク（${f.tasks.length}件）`} query={query}>
                  {f.tasks.map((t) => (
                    <Toggle key={t.name} title={t.name} sub query={query} badge={t.tool}>
                      <Html html={t.html} />
                    </Toggle>
                  ))}
                </Toggle>
              </div>
            ))}
          </>
        )}

        {!loading && tab === "config" && data?.ops && (
          <>
            <p className="text-[12px] text-gray-500 mb-3">
              運用設定値（mdの内容をそのまま表示）。パスワードは伏字です。
            </p>
            {data.ops.settingsSections.map((s) => (
              <Toggle key={s.title} title={s.title} query={query}><Html html={s.html} /></Toggle>
            ))}
          </>
        )}

        {!loading && tab === "flow" && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 text-[12.5px]">
              <b>作業手順。</b>上から順に処理します。同じ画面で片づく作業をまとめてあるので、ログインと画面移動が1回ずつで済みます。
              各タスクを開くと、導線種別mdの内容（タスク詳細・実行条件と分岐・案内テンプレート）がそのまま出ます。
              <span className="text-red-700 font-bold">顧客への送信は人が行います。</span>
            </div>
            {data?.flow.map((s, i) => (
              <Toggle key={s.tool} title={s.tool} query={query} step={i + 1} count={`${s.tasks.length}タスク`} defaultOpen>
                <div className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-[11.5px] mb-2">
                  開く画面：
                  {s.account?.url
                    ? <a href={s.account.url} target="_blank" rel="noopener" className="text-blue-700 underline">{s.account["用途"] ?? s.tool}</a>
                    : <span className="text-gray-400">画面操作なし</span>}
                  {s.account?.id && <span className="ml-2 text-gray-500">ID：{s.account.id}</span>}
                </div>
                {s.tasks.map((t) => (
                  <Toggle key={`${t.funnel}-${t.name}`} title={t.name} sub query={query} badge={t.funnel} badgeCls={funnelCls(t.funnel)}>
                    <Html html={t.html} />
                  </Toggle>
                ))}
              </Toggle>
            ))}
          </>
        )}

        {!loading && tab === "design" && (
          data?.design
            ? data.design.sections.map((s, i) => (
                s.title
                  ? <Toggle key={s.title + i} title={s.title} query={query}><Html html={s.html} /></Toggle>
                  : <div key={i} className="bg-white border border-gray-200 rounded-xl p-4 mb-3"><Html html={s.html} /></div>
              ))
            : <EmptyState onGo={() => setTab("upload")} label="AI作業設計のmdが未登録です" />
        )}

        {!loading && tab === "watch" && (
          <>
            <div className="flex gap-2 flex-wrap mb-3">
              {["all", ...Object.keys(counts).filter((k) => k !== "all")].map((k) => (
                <button key={k} onClick={() => setFunnelFilter(k)}
                  className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold border ${
                    funnelFilter === k ? "bg-red-50 border-red-300 text-red-700" : "bg-white border-gray-200 text-gray-500"}`}>
                  {k === "all" ? "すべて" : k}（{counts[k] ?? 0}）
                </button>
              ))}
            </div>
            {visibleWatch.map((r) => <WatchCard key={`${r.氏名}-${r.最終アクション日}`} row={r} />)}
            {!visibleWatch.length && <div className="text-center text-sm text-gray-400 py-12">該当する顧客がいません。</div>}
          </>
        )}

        {!loading && tab === "upload" && <UploadPanel docs={data?.docs} onDone={() => load(reveal)} />}
      </div>
    </div>
  );
}

// ── 部品 ──────────────────────────────────────────────────
function Html({ html }: { html: string }) {
  // サーバー側でエスケープ済みのHTML（lib/csWork/parse.ts）。
  return <div className="cw-body text-[12.5px] leading-7" dangerouslySetInnerHTML={{ __html: html }} />;
}

function Toggle({ title, children, sub, badge, badgeCls, step, count, defaultOpen, query }: {
  title: string; children: React.ReactNode; sub?: boolean; badge?: string; badgeCls?: string;
  step?: number; count?: string; defaultOpen?: boolean; query?: string;
}) {
  const hit = !!query?.trim() && title.toLowerCase().includes(query.trim().toLowerCase());
  return (
    <details open={defaultOpen || hit} className={`${sub ? "bg-gray-50 border-gray-200 my-2" : "bg-white border-gray-200 mb-2"} border rounded-xl overflow-hidden`}>
      <summary className={`flex items-center gap-2 cursor-pointer ${sub ? "px-3 py-2 text-[12.5px] font-bold text-red-700" : "px-4 py-3 text-[13px] font-bold text-gray-700"}`}>
        {step != null && <span className="bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full">STEP {step}</span>}
        <span>{title}</span>
        {badge && <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeCls ?? "bg-gray-100 text-gray-500 border-gray-200"}`}>{badge}</span>}
        {count && <span className="ml-auto text-[11px] font-normal text-gray-400">{count}</span>}
      </summary>
      <div className={`${sub ? "px-3 pb-3 bg-white" : "px-4 pb-4"} border-t border-gray-200 pt-3`}>{children}</div>
    </details>
  );
}

function WatchCard({ row }: { row: WatchRow }) {
  const portal = row.links.find((l) => l.name.includes("ポータル"));
  return (
    <details className="bg-white border border-gray-200 rounded-xl mb-2 overflow-hidden">
      <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap">
        <b className="text-[14px]">{row.氏名}</b>
        <span className="text-[11.5px] text-gray-500">（{row.現況 || "—"}）</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${funnelCls(row.導線種別)}`}>{row.導線種別}</span>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${staleCls(row.stale.level)}`}>{row.stale.level}</span>
        {portal?.url
          ? <a href={portal.url} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}
               className="text-[10.5px] px-2 py-0.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700">ポータル顧客ページ</a>
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

function EmptyState({ onGo, label = "ドキュメントが未登録です" }: { onGo: () => void; label?: string }) {
  return (
    <div className="bg-white border border-dashed border-gray-300 rounded-xl px-6 py-12 text-center">
      <div className="text-sm text-gray-500 mb-3">{label}</div>
      <button onClick={onGo} className="bg-red-600 text-white font-bold text-[12.5px] rounded-lg px-5 py-2">md をアップロードする</button>
    </div>
  );
}

// ── 更新タブ ──────────────────────────────────────────────
function UploadPanel({ docs, onDone }: { docs: Payload["docs"] | undefined; onDone: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; activated: boolean; validation: { label: string; status: string; detail: string }[] } | null>(null);
  const [historyKind, setHistoryKind] = useState<Kind | null>(null);
  const [history, setHistory] = useState<DocRow[]>([]);

  const upload = async (kind: Kind, file: File) => {
    if (file.size > 5 * 1024 * 1024) { toast.error("5MBを超えています"); return; }
    setBusy(true); setResult(null);
    const content = await file.text();
    const res = await apiFetch("/api/ops/cswork/upload", { method: "POST", body: { kind, filename: file.name, content } });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) { toast.error(json?.error ?? "アップロードに失敗しました"); return; }
    setResult(json);
    if (json.activated) toast.success("現行版を差し替えました");
    else toast.error("検証NGのため現行版は据え置きです");;
    onDone();
  };

  const openHistory = async (kind: Kind) => {
    setHistoryKind(kind);
    const res = await apiFetch(`/api/ops/cswork/history?kind=${kind}`);
    setHistory(res.ok ? (await res.json()).items : []);
  };

  const restore = async (id: string) => {
    setBusy(true);
    const res = await apiFetch("/api/ops/cswork/history", { method: "POST", body: { id } });
    setBusy(false);
    if (!res.ok) { toast.error("復元に失敗しました"); return; }
    toast.success("この版を現行版にしました");
    onDone();
    if (historyKind) openHistory(historyKind);
  };

  return (
    <div className="max-w-4xl">
      <div className="grid md:grid-cols-3 gap-3">
        {(["ops", "design", "watchlist"] as Kind[]).map((kind) => {
          const cur = docs?.[kind === "watchlist" ? "watchlist" : kind] ?? null;
          return (
            <div key={kind} className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="text-[13px] font-bold mb-1">{KIND_LABEL[kind]}</div>
              <div className="text-[11.5px] text-gray-500 mb-3">
                {cur ? <>現行版 {cur.version ? `v${cur.version}` : ""}<br />{fmtJst(cur.uploaded_at)}</> : "未登録"}
              </div>
              <label className={`block text-center text-[12px] font-bold rounded-lg px-3 py-2 cursor-pointer ${busy ? "bg-gray-200 text-gray-400" : "bg-red-600 text-white"}`}>
                ファイルを選ぶ
                <input type="file" accept={kind === "watchlist" ? ".csv" : ".md"} disabled={busy} className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(kind, f); e.currentTarget.value = ""; }} />
              </label>
              <button onClick={() => openHistory(kind)} className="w-full mt-2 border border-gray-200 rounded-lg px-3 py-1.5 text-[12px]">履歴</button>
            </div>
          );
        })}
      </div>

      {result && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
          <div className="text-[13px] font-bold mb-2">
            検証結果：{result.ok ? <span className="text-emerald-700">OK</span> : <span className="text-red-700">NG（現行版は据え置き）</span>}
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {result.validation.map((v, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="py-1.5 pr-3 font-bold text-gray-600 whitespace-nowrap">{v.label}</td>
                  <td className={`py-1.5 pr-3 font-bold whitespace-nowrap ${v.status === "ok" ? "text-emerald-700" : v.status === "warn" ? "text-amber-700" : "text-red-700"}`}>
                    {v.status === "ok" ? "OK" : v.status === "warn" ? "警告" : "NG"}
                  </td>
                  <td className="py-1.5">{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {historyKind && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mt-4">
          <div className="flex items-center gap-2 mb-2">
            <div className="text-[13px] font-bold">履歴：{KIND_LABEL[historyKind]}</div>
            <button onClick={() => setHistoryKind(null)} className="ml-auto text-[12px] border border-gray-200 rounded-lg px-3 py-1">閉じる</button>
          </div>
          <table className="w-full text-[12px]">
            <thead><tr className="text-gray-500"><th className="text-left py-1">版</th><th className="text-left">ファイル名</th><th className="text-left">更新日時</th><th className="text-left">状態</th><th /></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-gray-100">
                  <td className="py-1.5">{h.version ?? "-"}</td>
                  <td>{h.filename ?? "-"}</td>
                  <td>{fmtJst(h.uploaded_at)}</td>
                  <td>{h.is_current ? <span className="text-emerald-700 font-bold">現行版</span> : "—"}</td>
                  <td className="text-right">
                    {!h.is_current && <button onClick={() => restore(h.id)} disabled={busy} className="border border-gray-200 rounded-lg px-3 py-1">この版に戻す</button>}
                  </td>
                </tr>
              ))}
              {!history.length && <tr><td colSpan={5} className="py-6 text-center text-gray-400">履歴がありません</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11.5px] text-gray-500 mt-4 leading-6">
        ・検証に1件でもNGがあると<b>現行版は切り替わりません</b>（アップロード自体は履歴に残ります）。<br />
        ・書式は導線種別mdの「ファイル書式（入力契約）」が正本です。front matter・見出し・タスクの4項目・運用設定値のyamlブロックを崩さないでください。<br />
        ・要監視顧客CSVの滞留判定は列に持たせません（最終アクション日・予定日・判定基準から自動計算）。
      </div>
    </div>
  );
}
