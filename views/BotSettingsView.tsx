"use client";
// ============================================================
// ボット設定（運営）
//   ・入口別ポリシー（回数 / スコープ / 外部情報）
//   ・旧索引（フェーズA・凍結中）の件数と切り戻し用の再構築
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
import {
  loadScenarios, buildTrialSettings, computeUrlLimits,
  IMAGE_COST_JPY, QUALITY_LABEL,
  type TrialScenarioRow, type ImageQuality,
} from "../lib/bot/trial/trialAdmin";
import { TRIAL_DEFAULTS } from "../lib/bot/trial/types";
import { Icon } from "../components/common/Icon";

const ENTRY_LABEL: Record<BotEntry, string> = { anon: "未ログイン", member: "会員", trial: "体験版" };
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

      {/* ── 旧索引（フェーズA・凍結中） ── */}
      <section className="border border-gray-200 rounded-xl p-4 bg-white space-y-2">
        <h2 className="text-sm font-bold text-gray-800">旧索引（凍結中）</h2>
        <p className="text-xs text-gray-500">
          検索は下の「ナレッジ同期」に一本化しました。こちらは切り戻し用に残しているだけで、
          通常は再構築しません。現在の件数：
          <span className="font-bold text-gray-800">{idx ?? "…"}</span> 件
        </p>
        <div className="flex items-center gap-3">
          <button onClick={() => void onRebuild()} disabled={idxBusy}
            className="text-sm bg-white border border-gray-300 text-gray-600 rounded-lg px-4 py-1.5 font-bold hover:bg-gray-50 disabled:opacity-50">
            {idxBusy ? "再構築中…" : "索引を再構築（切り戻し時のみ）"}
          </button>
          {idxResult && (
            <span className="text-xs text-gray-600">
              走査 {idxResult.scanned} / 更新 {idxResult.upserted} / 変更なし {idxResult.unchanged} / 除去 {idxResult.pruned}
            </span>
          )}
          {idxError && <span className="text-xs text-red-600">{idxError}</span>}
        </div>
      </section>

      {/* ── ナレッジ同期は「ナレッジ」画面へ移設した（導線を2か所に置かない） ── */}
      <section className="border border-gray-200 rounded-xl p-4 bg-white">
        <h2 className="text-sm font-bold text-gray-800 m-0">ナレッジ同期</h2>
        <p className="text-xs text-gray-500 mt-1">
          取り込み状況の確認と同期の実行は <b className="text-gray-700">サイドバーの「ナレッジ」</b> に移動しました。
          ブックマークの登録・編集と同じ画面にまとめてあります。
        </p>
      </section>

      {/* ── 体験版URL ── */}
      <ShareLinkManager links={links} onChanged={reload} />
    </div>
  );
}

// ── 体験版URLの発行・一覧・失効 ──────────────────────────────
//   ★ 回数は「1人あたり」で数える（REQ-067 決定12）。
//     URL全体の上限は費用の安全弁として残し、想定人数から自動計算する（決定13）。
function ShareLinkManager({ links, onChanged }: { links: ShareLinkRow[]; onChanged: () => Promise<void> }) {
  const [label, setLabel] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(14);
  const [passcode, setPasscode] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string>("");

  // ── 体験シナリオ ──
  const [scenarios, setScenarios] = useState<TrialScenarioRow[]>([]);
  const [scenarioId, setScenarioId] = useState<number | null>(null);
  const [perUserChat, setPerUserChat] = useState<number>(TRIAL_DEFAULTS.perUserChatLimit);
  const [perUserGen, setPerUserGen] = useState<number>(TRIAL_DEFAULTS.perUserGenLimit);
  const [assumedUsers, setAssumedUsers] = useState<number>(TRIAL_DEFAULTS.assumedUsers);
  const [intro, setIntro] = useState("");
  // ⚠️ 既定は high。medium 以下だと日本語の文字が崩れる（2026-09-01 実測）
  const [quality, setQuality] = useState<ImageQuality>("high");
  const [showAdv, setShowAdv] = useState(false);

  useEffect(() => { void loadScenarios().then(setScenarios); }, []);

  const limits = computeUrlLimits({
    perUserChatLimit: perUserChat, perUserGenLimit: perUserGen, assumedUsers,
  });
  // 選んだシナリオが画像を作るものかどうかで、概算の単価が変わる
  const scenario = scenarios.find((x) => x.id === scenarioId) ?? null;
  const isImage = scenario?.output_kind === "image";
  // ⚠️ 目安。実測は ai_traces.cost_jpy を見る（設計 §10-2）
  const unitJpy = isImage ? IMAGE_COST_JPY[quality] : 5;
  const estimateJpy = scenarioId != null ? limits.genLimit * unitJpy : 0;

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const urlOf = (token: string) => `${origin}/try/${token}`;

  const onCreate = async () => {
    setBusy(true);
    try {
      const useTrial = scenarioId != null;
      await createShareLink({
        label: label || "体験版リンク",
        totalLimit: useTrial ? limits.totalLimit : perUserChat,
        expiresInDays: expiresInDays > 0 ? expiresInDays : null,
        passcode: passcode || null,
        webSearch,
        scenarioId,
        settings: useTrial
          ? buildTrialSettings({
              scenarioId, perUserChatLimit: perUserChat, perUserGenLimit: perUserGen,
              assumedUsers, genLimit: null, reviseLimit: null,
              intro, quality, ctaUrl: "",
            })
          : null,
        genLimit: useTrial ? limits.genLimit : null,
        assumedUsers: useTrial ? assumedUsers : null,
      });
      setLabel(""); setPasscode(""); setIntro("");
      await onChanged();
    } finally {
      setBusy(false);
    }
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
  const scenarioName = (l: ShareLinkRow) =>
    scenarios.find((s) => s.id === l.scenario_id)?.title ?? null;

  const IN = "border border-gray-300 rounded-lg px-2 py-1 text-sm";

  return (
    <section className="border border-gray-200 rounded-xl p-4 bg-white space-y-3">
      <h2 className="text-sm font-bold text-gray-800">体験版URL</h2>

      {/* 発行フォーム */}
      <div className="bg-neutral-50 border border-gray-100 rounded-lg p-3 space-y-3">
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">ラベル（管理用）</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="例：2026-09 ウェビナー A班"
              className={`w-52 ${IN}`} />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">体験シナリオ</span>
            <select value={scenarioId ?? ""} onChange={(e) => setScenarioId(e.target.value ? Number(e.target.value) : null)}
              className={IN}>
              <option value="">使わない（従来のQ&amp;Aボット）</option>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">有効日数（0=無期限）</span>
            <input type="number" min={0} value={expiresInDays} onChange={(e) => setExpiresInDays(Number(e.target.value))}
              className={`w-24 ${IN}`} />
          </label>
          <label className="text-xs text-gray-600">
            <span className="block mb-1">パスコード（任意）</span>
            <input value={passcode} onChange={(e) => setPasscode(e.target.value)} className={`w-28 ${IN}`} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-600 pb-1.5">
            <input type="checkbox" checked={webSearch} onChange={(e) => setWebSearch(e.target.checked)} />
            外部情報を許可
          </label>
        </div>

        {/* 回数（1人あたり）。シナリオを使うときだけ意味を持つ */}
        <div className="flex flex-wrap gap-3 items-end">
          <label className="text-xs text-gray-600">
            <span className="block mb-1">1人あたり　会話できる回数</span>
            <input type="number" min={1} value={perUserChat} onChange={(e) => setPerUserChat(Number(e.target.value))}
              className={`w-24 ${IN}`} />
          </label>
          {scenarioId != null && (
            <>
              {isImage && (
                <label className="text-xs text-gray-600">
                  <span className="block mb-1">画像の画質</span>
                  <select value={quality} onChange={(e) => setQuality(e.target.value as ImageQuality)}
                    className={IN}>
                    {(Object.keys(QUALITY_LABEL) as ImageQuality[]).map((q) =>
                      <option key={q} value={q}>{QUALITY_LABEL[q]}</option>)}
                  </select>
                </label>
              )}
              <label className="text-xs text-gray-600">
                <span className="block mb-1">1人あたり　作成できる回数</span>
                <input type="number" min={1} value={perUserGen} onChange={(e) => setPerUserGen(Number(e.target.value))}
                  className={`w-24 ${IN}`} />
              </label>
              <label className="text-xs text-gray-600">
                <span className="block mb-1">配る人数（想定）</span>
                <input type="number" min={1} value={assumedUsers} onChange={(e) => setAssumedUsers(Number(e.target.value))}
                  className={`w-24 ${IN}`} />
              </label>
              <div className="text-xs text-gray-600 pb-1">
                <span className="block mb-1">このURL全体の上限（安全弁）</span>
                <span className="inline-block border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-gray-700">
                  会話 {limits.totalLimit} 回 ／ 作成 {limits.genLimit} 回
                </span>
              </div>
            </>
          )}
        </div>

        {scenarioId != null && (
          <>
            <div>
              <button type="button" onClick={() => setShowAdv((v) => !v)}
                className="text-xs text-gray-600 font-bold">
                {showAdv ? "この発行だけの設定を閉じる" : "この発行だけの設定を開く"}
              </button>
              {showAdv && (
                <label className="block text-xs text-gray-600 mt-2">
                  <span className="block mb-1">説明文の差し替え（空ならシナリオの既定）</span>
                  <textarea value={intro} onChange={(e) => setIntro(e.target.value)} rows={2}
                    placeholder="例：ウェビナーにご参加いただいた方限定の体験です。"
                    className={`w-full max-w-xl ${IN}`} />
                </label>
              )}
            </div>

            {/* ⚠️ 費用に直結する設定なので、発行する前に金額を出す */}
            <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
              この設定での費用の上限は、およそ <b>{estimateJpy.toLocaleString()} 円</b>です
              （作成 {limits.genLimit} 回 × {isImage ? `画質${quality} 約${unitJpy}円` : `1回 約${unitJpy}円`}）。
              1人が使えるのは「会話{perUserChat}回・作成{perUserGen}回」まで。
              URLが想定外に広まっても、全体で作成{limits.genLimit}回に達した時点で止まります。
            </div>
          </>
        )}

        <div className="text-right">
          <button onClick={() => void onCreate()} disabled={busy}
            className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700 disabled:opacity-50">
            ＋ 発行
          </button>
        </div>
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
              {scenarioName(l)
                ? <span className="rounded-full px-2 py-0.5 bg-red-50 text-red-700 font-bold">{scenarioName(l)}</span>
                : <span className="rounded-full px-2 py-0.5 bg-gray-100 text-gray-500">URL累計</span>}
              <span className="text-gray-500">会話 残 {Math.max(0, l.total_limit - l.used_count)}/{l.total_limit}</span>
              {l.scenario_id != null && (
                <span className="text-gray-500">作成 {l.gen_used_count ?? 0}/{l.gen_limit ?? 0}</span>
              )}
              <span className="text-gray-400">{l.expires_at ? `〜${l.expires_at.slice(0, 10)}` : "無期限"}</span>
              {l.passcode && <Icon name="lock" size={14} className="text-gray-400" />}
              <code className="text-[11px] bg-neutral-100 rounded px-2 py-0.5 text-gray-500 truncate max-w-[220px]">{urlOf(l.token)}</code>
              <button onClick={() => void onCopy(l.token)} className="text-red-700 font-bold">{copied === l.token ? "コピー済" : "コピー"}</button>
              {!l.revoked && <button onClick={() => void onRevoke(l.token)} className="text-gray-400 hover:text-red-600">失効</button>}
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-gray-400">
        「URL累計」の行は、体験シナリオを使っていない従来のリンクです。挙動は変わりません。
      </p>
    </section>
  );
}
