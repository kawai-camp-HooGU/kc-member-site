"use client";
// ============================================================
// ボット設定（運営）
//   ・入口別ポリシー（回数 / スコープ / 外部情報）
//   ・ブックマーク索引の再構築
//   ・体験版URLの発行・失効
//   親メニュー「ボット」→ 子「ボット設定」。feature = bot_manage（運営のみ）。
// ============================================================
import { useEffect, useState, useCallback } from "react";
import { BOOKMARK_GENRES } from "../lib/bookmarks";
import type { BotEntry } from "../lib/bot/types";
import {
  loadPolicies, savePolicy, indexCount, rebuildIndex,
  loadShareLinks, createShareLink, revokeShareLink,
  type BotPolicyRow, type ShareLinkRow, type RebuildResult,
} from "../lib/bot/botAdmin";

const ENTRY_LABEL: Record<BotEntry, string> = { anon: "🌐 未ログイン", member: "🔑 会員", trial: "🎟️ 体験版" };
const WEB_LABEL: Record<string, string> = { off: "OFF", assist: "補助", always: "常時" };

export function BotSettingsView() {
  const [policies, setPolicies] = useState<BotPolicyRow[]>([]);
  const [idx, setIdx] = useState<number | null>(null);
  const [idxBusy, setIdxBusy] = useState(false);
  const [idxResult, setIdxResult] = useState<RebuildResult | null>(null);
  const [idxError, setIdxError] = useState<string>("");
  const [links, setLinks] = useState<ShareLinkRow[]>([]);
  const [msg, setMsg] = useState<string>("");

  const reload = useCallback(async () => {
    setPolicies(await loadPolicies());
    setIdx(await indexCount());
    setLinks(await loadShareLinks());
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const patchPolicy = (entry: BotEntry, patch: Partial<BotPolicyRow>) =>
    setPolicies((ps) => ps.map((p) => p.entry === entry ? { ...p, ...patch } : p));

  const onSavePolicy = async (p: BotPolicyRow) => {
    const ok = await savePolicy(p.entry, p);
    setMsg(ok ? `${ENTRY_LABEL[p.entry]} を保存しました` : "保存に失敗しました");
    setTimeout(() => setMsg(""), 2500);
  };

  const onRebuild = async () => {
    setIdxBusy(true); setIdxError(""); setIdxResult(null);
    try {
      const r = await rebuildIndex();
      setIdxResult(r);
      setIdx(await indexCount());
    } catch (e) {
      setIdxError((e as Error).message);
    } finally {
      setIdxBusy(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-bold text-gray-900">ボット設定</h1>
        <p className="text-xs text-gray-500">回数・スコープ・外部情報の制限、ナレッジ索引、体験版URLを管理します。</p>
      </div>

      {msg && <div className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2">{msg}</div>}

      {/* ── 入口別ポリシー ── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold text-gray-800">入口別ポリシー</h2>
        {policies.map((p) => (
          <div key={p.entry} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-white">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-gray-900">{ENTRY_LABEL[p.entry]}</span>
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                <input type="checkbox" checked={p.enabled}
                  onChange={(e) => patchPolicy(p.entry, { enabled: e.target.checked })} />
                有効
              </label>
            </div>
            <div className="flex flex-wrap gap-4 items-end">
              <label className="text-xs text-gray-600">
                <span className="block mb-1">1日の上限回数{p.entry === "trial" && "（累計）"}</span>
                <input type="number" min={0} value={p.daily_limit}
                  onChange={(e) => patchPolicy(p.entry, { daily_limit: Number(e.target.value) })}
                  className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
              </label>
              <label className="text-xs text-gray-600">
                <span className="block mb-1">外部情報(Web)</span>
                <select value={p.web_search}
                  onChange={(e) => patchPolicy(p.entry, { web_search: e.target.value as BotPolicyRow["web_search"] })}
                  className="border border-gray-300 rounded-lg px-2 py-1 text-sm">
                  {(["off", "assist", "always"] as const).map((w) => <option key={w} value={w}>{WEB_LABEL[w]}</option>)}
                </select>
              </label>
            </div>
            <div>
              <span className="block text-xs text-gray-600 mb-1">回答スコープ（チェックしたジャンルだけ答える。未選択＝全て）</span>
              <div className="flex flex-wrap gap-2">
                {BOOKMARK_GENRES.map((g) => {
                  const on = p.scope_genres.includes(g);
                  return (
                    <button key={g} type="button"
                      onClick={() => patchPolicy(p.entry, {
                        scope_genres: on ? p.scope_genres.filter((x) => x !== g) : [...p.scope_genres, g],
                      })}
                      className={`text-xs rounded-full px-2.5 py-1 border ${on ? "bg-red-600 text-white border-red-600" : "bg-white text-gray-600 border-gray-300"}`}>
                      {g}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="text-right">
              <button onClick={() => void onSavePolicy(p)}
                className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700">保存</button>
            </div>
          </div>
        ))}
      </section>

      {/* ── ナレッジ索引 ── */}
      <section className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
        <h2 className="text-sm font-bold text-gray-800">ナレッジ索引</h2>
        <p className="text-xs text-gray-500">
          有効なブックマーク（ai_enabled）を検索索引に反映します。現在の索引件数：
          <span className="font-bold text-gray-800">{idx ?? "…"}</span> 件
        </p>
        <div className="flex items-center gap-3">
          <button onClick={() => void onRebuild()} disabled={idxBusy}
            className="text-sm bg-gray-800 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-gray-900 disabled:opacity-50">
            {idxBusy ? "再構築中…" : "索引を再構築"}
          </button>
          {idxResult && (
            <span className="text-xs text-gray-600">
              走査 {idxResult.scanned} / 更新 {idxResult.upserted} / 変更なし {idxResult.unchanged} / 除去 {idxResult.pruned}
            </span>
          )}
          {idxError && <span className="text-xs text-red-600">{idxError}</span>}
        </div>
      </section>

      {/* ── 体験版URL ── */}
      <ShareLinkManager links={links} onChanged={reload} />
    </div>
  );
}

// ── 体験版URLの発行・一覧・失効 ──────────────────────────────
function ShareLinkManager({ links, onChanged }: { links: ShareLinkRow[]; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [totalLimit, setTotalLimit] = useState(10);
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [passcode, setPasscode] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string>("");

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlOf = (token: string) => `${origin}/try/${token}`;

  const onCreate = async () => {
    setBusy(true);
    await createShareLink({
      label: label || "体験版リンク",
      totalLimit, expiresInDays: expiresInDays > 0 ? expiresInDays : null,
      passcode: passcode || null, webSearch,
    });
    setLabel(""); setPasscode("");
    await onChanged();
    setBusy(false);
  };

  const onCopy = async (token: string) => {
    try { await navigator.clipboard.writeText(urlOf(token)); setCopied(token); setTimeout(() => setCopied(""), 1500); } catch { /* noop */ }
  };

  const onRevoke = async (token: string) => {
    if (await revokeShareLink(token)) await onChanged();
  };

  const isExpired = (l: ShareLinkRow) => l.expires_at != null && new Date(l.expires_at).getTime() < Date.now();
  const status = (l: ShareLinkRow) =>
    l.revoked ? "失効" : isExpired(l) ? "期限切れ" : l.used_count >= l.total_limit ? "上限到達" : "有効";

  return (
    <section className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
      <h2 className="text-sm font-bold text-gray-800">体験版URL</h2>

      {/* 発行フォーム */}
      <div className="flex flex-wrap gap-3 items-end bg-neutral-50 border border-gray-100 rounded-lg p-3">
        <label className="text-xs text-gray-600">
          <span className="block mb-1">ラベル</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：LP用"
            className="w-40 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">累計上限</span>
          <input type="number" min={1} value={totalLimit} onChange={(e) => setTotalLimit(Number(e.target.value))}
            className="w-20 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">有効日数（0=無期限）</span>
          <input type="number" min={0} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}
            className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="text-xs text-gray-600">
          <span className="block mb-1">パスコード（任意）</span>
          <input value={passcode} onChange={(e) => setPasscode(e.target.value)}
            className="w-28 border border-gray-300 rounded-lg px-2 py-1 text-sm" />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
          <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
          外部情報を許可
        </label>
        <button onClick={() => void onCreate()} disabled={busy}
          className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700 disabled:opacity-50">
          ＋ 発行
        </button>
      </div>

      {/* 一覧 */}
      {links.length === 0 ? (
        <p className="text-xs text-gray-400">発行済みのリンクはありません。</p>
      ) : (
        <div className="space-y-2">
          {links.map((l) => (
            <div key={l.token} className="flex flex-wrap items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 text-xs">
              <span className="font-bold text-gray-800">{l.label || "（無題）"}</span>
              <span className={`rounded-full px-2 py-0.5 font-bold ${
                status(l) === "有効" ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{status(l)}</span>
              <span className="text-gray-500">残 {Math.max(0, l.total_limit - l.used_count)}/{l.total_limit}</span>
              <span className="text-gray-400">{l.expires_at ? `〜${l.expires_at.slice(0, 10)}` : "無期限"}</span>
              {l.passcode && <span className="text-gray-400">🔒</span>}
              <code className="text-[11px] bg-neutral-100 rounded px-2 py-0.5 text-gray-500 truncate max-w-[220px]">{urlOf(l.token)}</code>
              <button onClick={() => void onCopy(l.token)} className="text-red-700 font-bold">{copied === l.token ? "コピー済" : "コピー"}</button>
              {!l.revoked && <button onClick={() => void onRevoke(l.token)} className="text-gray-400 hover:text-red-600">失効</button>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
