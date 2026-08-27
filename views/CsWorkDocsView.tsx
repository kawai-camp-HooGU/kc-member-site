"use client";
// ============================================================
// CsWork ＞ 運用ドキュメント（REQ-039・ループ STEP 3 の結果を読む画面）
//
//   タブ：導線種別／業務フロー／設定値／資料・アカウント
//
//   現行版の spec があればそれを正本として描く。無ければ導線種別md の
//   HTML をそのまま出す（REQ-028 の表示にフォールバック）。
//   これで移行の途中でも画面が空にならない。
//
//   ⚠️ spec 表示では、タスクごとに実行者・AI推定・実行不可のバッジを出す。
//      **推定を隠さないことが安全装置**（設計書 §7-3）。
//   ⚠️ 設定値のパスワードは既定で伏字。実値表示は cswork_secret を持つ
//      管理者のみで、表示のたびに監査ログに残る。
// ============================================================
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "../lib/apiClient";
import { useToast } from "../components/common/ToastProvider";
import { useMaster } from "../hooks/useMaster";
import { fmtJst } from "../lib/dateFmt";
import {
  Chip, EmptyBox, Html, Loading, Toggle,
  funnelCls, runnerCls, runnerLabel,
} from "../components/cswork/CsWorkParts";
import type { CsWorkPayload } from "../lib/csWork/payload";
import type { CsSpecFunnel, CsSpecTask } from "../lib/csWork/spec";

type Tab = "funnels" | "flow" | "config" | "resources";

const TABS: { key: Tab; label: string }[] = [
  { key: "funnels",   label: "導線種別" },
  { key: "flow",      label: "業務フロー" },
  { key: "config",    label: "設定値" },
  { key: "resources", label: "資料・アカウント" },
];

export function CsWorkDocsView({ onGoDraft }: { onGoDraft?: () => void }) {
  const toast = useToast();
  const { can } = useMaster();
  const [tab, setTab] = useState<Tab>("funnels");
  const [data, setData] = useState<CsWorkPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [reveal, setReveal] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (withSecret = false) => {
    setLoading(true);
    const res = await apiFetch(`/api/ops/cswork${withSecret ? "?reveal=1" : ""}`);
    if (!res.ok) { setLoading(false); toast.error("読み込みに失敗しました"); return; }
    setData(await res.json());
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(false); }, [load]);

  const toggleReveal = async () => {
    const next = !reveal;
    setReveal(next);
    await load(next);
  };

  const setAllOpen = (open: boolean) => {
    bodyRef.current?.querySelectorAll("details").forEach((d) => { (d as HTMLDetailsElement).open = open; });
  };

  const blocked = useMemo(() => new Set(data?.blockedTaskIds ?? []), [data]);
  const spec = data?.spec ?? null;

  /** 業務フローの並び。md 由来の flow があればその順、無ければ spec の初出順。 */
  const flowSteps = useMemo(() => {
    if (data?.flow?.length) return data.flow.map((s) => ({ tool: s.tool, account: s.account, specTasks: [] as { funnel: string; task: CsSpecTask }[] }));
    if (!spec) return [];
    const order: string[] = [];
    const byTool = new Map<string, { funnel: string; task: CsSpecTask }[]>();
    for (const f of spec.funnels) {
      for (const t of f.tasks) {
        if (!byTool.has(t.tool)) { byTool.set(t.tool, []); order.push(t.tool); }
        byTool.get(t.tool)?.push({ funnel: f.name, task: t });
      }
    }
    return order.map((tool) => ({ tool, account: null, specTasks: byTool.get(tool) ?? [] }));
  }, [data, spec]);

  const hasContent = !!spec || !!data?.ops;

  return (
    <div className="h-full flex flex-col min-h-0 overflow-hidden">
      <div className="px-5 pt-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-lg font-extrabold">運用ドキュメント</h1>
          <span className="text-xs text-gray-500">導線・タスク・設定値・資料。起草mdを承認するとここに反映されます</span>
          <span className="ml-auto text-[11px] text-gray-400">
            {spec
              ? `版 ${spec.doc_version}／整形 ${fmtJst(spec.generated_at)}`
              : data?.docs.ops ? `md 版 ${data.docs.ops.version ?? "-"}／${fmtJst(data.docs.ops.uploaded_at)}` : ""}
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

        <div className="flex gap-2 py-3 flex-wrap">
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="キーワードで絞り込む（例：リマインド、報告、URL）"
            className="flex-1 min-w-[200px] border border-gray-200 rounded-lg px-3 py-2 text-[12.5px]" />
          <button onClick={() => setAllOpen(true)} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">すべて開く</button>
          <button onClick={() => setAllOpen(false)} className="border border-gray-200 rounded-lg px-3 py-2 text-[12px]">すべて閉じる</button>
          {can("cswork_secret") && (
            <button onClick={toggleReveal}
              className={`rounded-lg px-3 py-2 text-[12px] border ${reveal ? "bg-red-50 border-red-300 text-red-700 font-bold" : "border-gray-200"}`}>
              {reveal ? "認証情報を隠す" : "認証情報を表示"}
            </button>
          )}
        </div>
      </div>

      <div ref={bodyRef} className="flex-1 overflow-auto px-5 pb-8 cswork">
        {loading && <Loading />}

        {!loading && !hasContent && (
          <EmptyBox kind="setup"
            title="運用ドキュメントが未登録です"
            hint="「起草と整形」でラフmdを投入し、整形結果を承認すると、ここに導線とタスクが並びます。"
            actionLabel={onGoDraft ? "起草と整形を開く" : undefined}
            onAction={onGoDraft} />
        )}

        {!loading && tab === "funnels" && spec && spec.funnels.map((f) => (
          <SpecFunnel key={f.key} funnel={f} query={query} blocked={blocked} />
        ))}

        {!loading && tab === "funnels" && !spec && data?.ops && (
          <>
            {data.ops.intro.map((s) => (
              <Toggle key={s.title} title={s.title} query={query}><Html html={s.html} /></Toggle>
            ))}
            {data.ops.funnels.map((f) => (
              <div key={f.name} className="mt-6">
                <div className="flex items-center gap-2 border-b-2 border-gray-200 pb-2 mb-3">
                  <Chip cls={funnelCls(f.name)}>{f.name}</Chip>
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

        {!loading && tab === "flow" && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-4 mb-3 text-[12.5px]">
              <b>作業手順。</b>上から順に処理します。同じ画面で片づく作業をまとめてあるので、ログインと画面移動が1回ずつで済みます。
              <span className="text-red-700 font-bold">顧客への送信は人が行います。</span>
            </div>
            {data?.flow?.length
              ? data.flow.map((s, i) => (
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
                ))
              : flowSteps.map((s, i) => (
                  <Toggle key={s.tool} title={s.tool} query={query} step={i + 1} count={`${s.specTasks.length}タスク`} defaultOpen>
                    {s.specTasks.map(({ funnel, task }) => (
                      <Toggle key={task.id} title={`${task.id} ${task.name}`} sub query={query}
                        badge={<TaskBadges task={task} blocked={blocked.has(task.id)} />}>
                        <TaskBody task={task} />
                      </Toggle>
                    ))}
                  </Toggle>
                ))}
            {!data?.flow?.length && !flowSteps.length && (
              <EmptyBox kind="none" title="並べ替えるタスクがありません" hint="導線種別にタスクを登録すると、使うツール順の手順になります。" />
            )}
          </>
        )}

        {!loading && tab === "config" && (
          data?.ops?.settingsSections.length
            ? (
              <>
                <p className="text-[12px] text-gray-500 mb-3">
                  運用設定値。パスワードは伏字です。
                  {data.settingsFrom === "ops" && "（導線種別mdの「運用設定値」から読んでいます）"}
                </p>
                {data.ops.settingsSections.map((s) => (
                  <Toggle key={s.title} title={s.title} query={query}><Html html={s.html} /></Toggle>
                ))}
              </>
            )
            : <EmptyBox kind="setup" title="運用設定値が未登録です" hint="URL・アカウント・判定基準を登録すると、タスクの {{ }} が解決できるようになります。" />
        )}

        {!loading && tab === "resources" && <ResourceIndex data={data} query={query} />}
      </div>
    </div>
  );
}

// ── spec 由来の表示 ───────────────────────────────────────
function SpecFunnel({ funnel, query, blocked }: { funnel: CsSpecFunnel; query: string; blocked: Set<string> }) {
  const attrs: { label: string; value: string }[] = [
    { label: "対象", value: funnel.targets },
    { label: "ゴール", value: funnel.goal },
    { label: "入口", value: funnel.entry },
    { label: "滞留の考え方", value: funnel.stale_policy },
  ].filter((a) => a.value);

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 border-b-2 border-gray-200 pb-2 mb-3 flex-wrap">
        <Chip cls={funnelCls(funnel.name)}>{funnel.name}</Chip>
        {funnel.aliases.map((a) => <Chip key={a} cls="bg-gray-100 text-gray-500 border-gray-200">別名：{a}</Chip>)}
        {funnel.status === "archived" && <Chip cls="bg-gray-100 text-gray-500 border-gray-200">休止中</Chip>}
        <span className="text-[11px] text-gray-400">タスク {funnel.tasks.length}件</span>
      </div>

      {attrs.length > 0 && (
        <Toggle title="概要" query={query} defaultOpen>
          <dl className="grid grid-cols-[110px_1fr] gap-y-1 text-[12.5px]">
            {attrs.map((a) => (
              <div key={a.label} className="contents">
                <dt className="text-gray-500">{a.label}</dt><dd>{a.value}</dd>
              </div>
            ))}
          </dl>
        </Toggle>
      )}

      {funnel.resources.length > 0 && (
        <Toggle title={`資料・Webページ（${funnel.resources.length}件）`} query={query}>
          <ul className="text-[12.5px] leading-7">
            {funnel.resources.map((r, i) => (
              <li key={i}>
                {r["用途"]}
                {r.key && <code className="ml-2 text-[11.5px] bg-gray-50 border border-gray-200 rounded px-1.5">{`{{${r.key}}}`}</code>}
                {r["備考"] && <span className="text-gray-500 ml-2">{r["備考"]}</span>}
              </li>
            ))}
          </ul>
        </Toggle>
      )}

      <Toggle title={`タスク（${funnel.tasks.length}件）`} query={query} defaultOpen>
        {funnel.tasks.map((t) => (
          <Toggle key={t.id} title={`${t.id} ${t.name}`} sub query={query}
            badge={<TaskBadges task={t} blocked={blocked.has(t.id)} />}>
            <TaskBody task={t} />
          </Toggle>
        ))}
        {!funnel.tasks.length && (
          <EmptyBox kind="setup" title="この導線にはタスクがありません" hint="「起草と整形」でタスクを追記してください。" />
        )}
      </Toggle>
    </div>
  );
}

function TaskBadges({ task, blocked }: { task: CsSpecTask; blocked: boolean }) {
  return (
    <span className="inline-flex gap-1.5 flex-wrap">
      <Chip cls="bg-gray-100 text-gray-500 border-gray-200">{task.tool}</Chip>
      <Chip cls={runnerCls(task.runner)}>{runnerLabel(task.runner)}</Chip>
      {task.inferred.length > 0 && <Chip cls="bg-blue-50 text-blue-700 border-blue-200">AI推定 {task.inferred.length}</Chip>}
      {blocked && <Chip cls="bg-red-50 text-red-700 border-red-200">実行不可</Chip>}
    </span>
  );
}

function TaskBody({ task }: { task: CsSpecTask }) {
  return (
    <div className="text-[12.5px] leading-7">
      {task.detail && <p className="mb-2">{task.detail}</p>}

      <dl className="grid grid-cols-[110px_1fr] gap-y-1 mb-2">
        <dt className="text-gray-500">実行条件</dt>
        <dd>{task.trigger || <span className="text-gray-400">未設定</span>}</dd>
        <dt className="text-gray-500">実行者</dt>
        <dd>{runnerLabel(task.runner)}<span className="text-gray-400 text-[11px] ml-1">（{task.runner}）</span></dd>
        {task.human_gate && (<><dt className="text-gray-500">人の関門</dt><dd className="text-red-700 font-bold">{task.human_gate}</dd></>)}
        {task.outputs.length > 0 && (<><dt className="text-gray-500">成果の計上先</dt><dd>{task.outputs.join(" / ")}</dd></>)}
        {task.refs.length > 0 && (
          <><dt className="text-gray-500">参照</dt>
          <dd className="flex gap-1.5 flex-wrap">
            {task.refs.map((r) => <code key={r} className="text-[11.5px] bg-gray-50 border border-gray-200 rounded px-1.5">{`{{${r}}}`}</code>)}
          </dd></>
        )}
      </dl>

      {task.branches.length > 0 && (
        <div className="mb-2">
          <div className="text-[11px] font-bold text-gray-500 mb-1">実行条件・分岐</div>
          <ul className="list-disc pl-5">
            {task.branches.map((b, i) => <li key={i}>{b.if}{b.then ? ` → ${b.then}` : ""}</li>)}
          </ul>
        </div>
      )}

      {task.templates.map((t, i) => (
        <div key={i} className="mb-2">
          <div className="text-[11px] font-bold text-gray-500 mb-1">案内テンプレート{t.channel ? `（${t.channel}）` : ""}</div>
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-[11.5px] whitespace-pre-wrap">{t.body}</pre>
        </div>
      ))}

      {task.inferred.length > 0 && (
        <div className="text-[11.5px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          AIが推定した項目：{task.inferred.join("・")}。誤りがあれば「起草と整形」で直してください。
        </div>
      )}
    </div>
  );
}

// ── 資料・アカウント（横断一覧）────────────────────────────
function ResourceIndex({ data, query }: { data: CsWorkPayload | null; query: string }) {
  const q = query.trim().toLowerCase();
  const links = (data?.resources?.links ?? []).filter((l) => !q || `${l.key}${l.name}${l.url ?? ""}`.toLowerCase().includes(q));
  const accounts = (data?.resources?.accounts ?? []).filter((a) => !q || `${a["用途"]}${a.url ?? ""}`.toLowerCase().includes(q));

  if (!links.length && !accounts.length) {
    return <EmptyBox kind="none" title="該当する資料・アカウントがありません" hint="キーワードを変えるか、運用設定値に登録してください。" />;
  }

  return (
    <>
      <p className="text-[12px] text-gray-500 mb-3">
        タスクから <code className="text-[11.5px]">{"{{ }}"}</code> で参照される資料とアカウントの一覧です。URLが空の項目は、それを使うタスクが実行できません。
      </p>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden mb-4">
        <div className="px-4 py-2.5 text-[13px] font-bold text-gray-700 border-b border-gray-200">フォーム・Webページ（{links.length}）</div>
        <table className="w-full text-[12px]">
          <thead><tr className="tbl-head"><th className="text-left px-4 py-2">参照キー</th><th className="text-left">名称</th><th className="text-left">URL</th></tr></thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.key} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap"><code className="text-[11.5px]">{`{{${l.key}}}`}</code></td>
                <td>{l.name}</td>
                <td className="py-2 pr-4">
                  {l.url
                    ? <a href={l.url} target="_blank" rel="noopener" className="text-blue-700 underline break-all">{l.url}</a>
                    : <span className="text-amber-700 font-bold">URL未登録</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 text-[13px] font-bold text-gray-700 border-b border-gray-200">サイト・アカウント（{accounts.length}）</div>
        <table className="w-full text-[12px]">
          <thead><tr className="tbl-head"><th className="text-left px-4 py-2">用途</th><th className="text-left">URL</th><th className="text-left">ID</th><th className="text-left">パスワード</th></tr></thead>
          <tbody>
            {accounts.map((a, i) => (
              <tr key={i} className="border-t border-gray-100">
                <td className="px-4 py-2 whitespace-nowrap">{a["用途"]}</td>
                <td className="py-2">
                  {a.url ? <a href={a.url} target="_blank" rel="noopener" className="text-blue-700 underline break-all">{a.url}</a> : <span className="text-gray-400">—</span>}
                </td>
                <td>{a.id ?? <span className="text-gray-400">—</span>}</td>
                <td className="pr-4 font-mono">{a.pass ?? <span className="text-gray-400 font-sans">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
