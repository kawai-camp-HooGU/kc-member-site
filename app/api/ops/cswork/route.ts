// ============================================================
// GET /api/ops/cswork  … CsWork のビューモデルを返す（REQ-028 → REQ-039 で拡張）
//
//   現行版の spec（無ければ md）と、最新の実行・提案・課題をまとめて返す。
//   4メニュー（運用ドキュメント／起草と整形／実行／成果と課題）はすべて
//   このエンドポイントを起点にする。
//
//   クエリ
//     reveal=1 … 設定値のパスワードを実値で返す（管理者のみ・監査ログに記録）
//
//   ⚠️ 画面（/ops/*）は middleware のゾーンガードで守られるが、API はここで
//      requireOps() を通す（middleware は API の関所ではない）。
//   ⚠️ 現行6タブ（ops / design / watchlist）の項目は並走期間のあいだ残す。
//      確定6：新メニューで1週間運用してから撤去する。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireAdmin, errorResponse } from "../../../../lib/authz";
import { buildOps, buildDoc, buildFlow, buildWatchlist, maskSecrets, MASK } from "../../../../lib/csWork/build";
import { readCurrentContent, fetchCurrent, loadSettings, audit } from "../../../../lib/csWork/server";
import { fetchActions, fetchIssues, fetchLatestRun } from "../../../../lib/csWork/runsServer";
import { blockedTaskIds, parseSpec, specStats, validateSpec, type CsSpec } from "../../../../lib/csWork/spec";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const me = await requireOps(request);
    const url = new URL(request.url);
    const reveal = url.searchParams.get("reveal") === "1";
    if (reveal) await requireAdmin(request);

    const opsDoc   = await readCurrentContent("ops");
    const design   = await readCurrentContent("design");
    const watchDoc = await readCurrentContent("watchlist");
    const specDoc  = await readCurrentContent("spec");

    const ops = opsDoc ? buildOps(opsDoc.text) : null;
    const flow = ops ? buildFlow(ops) : [];
    const watch = watchDoc && ops ? buildWatchlist(watchDoc.text, ops.settings) : [];

    // REQ-039：spec があれば、それが正本。無ければ md のままの表示にフォールバックする。
    const { settings, from: settingsFrom } = await loadSettings();
    let spec: CsSpec | null = null;
    let specIssues: ReturnType<typeof validateSpec> = [];
    if (specDoc) {
      try {
        spec = parseSpec(JSON.parse(specDoc.text));
        specIssues = validateSpec(spec, settings);
      } catch {
        // 壊れた spec で画面全体を落とさない。md 側の表示は生かす。
        spec = null;
      }
    }

    if (reveal) {
      await audit("reveal", me.memberId, opsDoc?.row.id ?? null, { at: new Date().toISOString() });
    }

    const [latestRun, issues, actions] = await Promise.all([
      fetchLatestRun(),
      fetchIssues("open"),
      fetchActions(undefined, 200),
    ]);

    const payload = {
      ops: ops ? {
        title: ops.title,
        version: ops.version,
        funnels: ops.funnels,
        intro: ops.intro,
        settingsSections: reveal ? ops.settingsSections : maskSecrets(ops.settingsSections),
      } : null,
      flow,
      design: design ? buildDoc(design.text) : null,
      watch,
      docs: {
        ops: opsDoc?.row ?? null,
        design: design?.row ?? null,
        watchlist: watchDoc?.row ?? await fetchCurrent("watchlist"),
        spec: specDoc?.row ?? null,
        source: await fetchCurrent("source"),
        runbook: await fetchCurrent("runbook", "agent-browser"),
      },
      spec: spec ? {
        doc_version: spec.doc_version,
        generated_at: spec.generated_at,
        funnels: spec.funnels,
        stats: specStats(spec),
      } : null,
      specIssues,
      blockedTaskIds: blockedTaskIds(specIssues),
      settingsFrom,
      // 「あのフォームのURLどこだっけ」を横断で探せるようにする（設計書 §11-5）。
      resources: buildResourceIndex(settings, reveal),
      latestRun,
      issues,
      actions,
      reveal,
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * 設定値から「資料・Webページ・アカウント」の横断一覧を作る。
 *   ⚠️ アカウントのパスワードは reveal のときだけ実値。既定は伏字。
 */
function buildResourceIndex(settings: Record<string, unknown>, reveal: boolean): {
  links: { key: string; name: string; url: string | null }[];
  accounts: { 用途: string; url: string | null; id: string | null; pass: string | null }[];
} {
  const linksRaw = settings.links;
  const links: { key: string; name: string; url: string | null }[] = [];
  if (linksRaw && typeof linksRaw === "object" && !Array.isArray(linksRaw)) {
    for (const [key, v] of Object.entries(linksRaw as Record<string, unknown>)) {
      if (typeof v === "string") { links.push({ key, name: key, url: v.trim() || null }); continue; }
      const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
      links.push({
        key,
        name: String(o.name ?? key),
        url: typeof o.url === "string" && o.url.trim() ? o.url.trim() : null,
      });
    }
  }

  const accountsRaw = Array.isArray(settings.accounts) ? settings.accounts : [];
  const accounts = accountsRaw.map((a) => {
    const o = (a && typeof a === "object" ? a : {}) as Record<string, unknown>;
    return {
      用途: String(o["用途"] ?? ""),
      url: typeof o.url === "string" && o.url.trim() ? o.url.trim() : null,
      id: o.id == null || o.id === "" ? null : String(o.id),
      pass: o.pass == null || o.pass === "" ? null : (reveal ? String(o.pass) : MASK),
    };
  });

  return { links, accounts };
}
