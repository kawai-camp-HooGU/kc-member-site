// ============================================================
// GET /api/ops/cswork  … CsWork のビューモデルを返す（REQ-028）
//
//   現行版の md / CSV を Storage から読み、画面が必要な形へ組み立てて返す。
//   md を差し替えれば次のリクエストからそのまま反映される（デプロイ不要）。
//
//   クエリ
//     reveal=1 … 設定値のパスワードを実値で返す（管理者のみ・監査ログに記録）
//
//   ⚠️ 画面（/ops/*）は middleware のゾーンガードで守られるが、API はここで
//      requireOps() を通す（middleware は API の関所ではない）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, requireAdmin, errorResponse } from "../../../../lib/authz";
import { buildOps, buildDoc, buildFlow, buildWatchlist, maskSecrets, MASK } from "../../../../lib/csWork/build";
import { readCurrentContent, fetchCurrent, audit } from "../../../../lib/csWork/server";

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

    const ops = opsDoc ? buildOps(opsDoc.text) : null;
    const flow = ops ? buildFlow(ops) : [];
    const watch = watchDoc && ops ? buildWatchlist(watchDoc.text, ops.settings) : [];

    if (reveal) {
      await audit("reveal", me.memberId, opsDoc?.row.id ?? null, { at: new Date().toISOString() });
    }

    const payload = {
      ops: ops ? {
        title: ops.title,
        version: ops.version,
        funnels: ops.funnels,
        intro: ops.intro,
        settingsSections: reveal ? ops.settingsSections : maskSecrets(ops.settingsSections),
      } : null,
      flow,
      // 「あのフォームのURLどこだっけ」を導線をまたいで探せるようにする（REQ-039 v2）。
      resources: ops ? buildResourceIndex(ops.settings, reveal) : { links: [], accounts: [] },
      design: design ? buildDoc(design.text) : null,
      watch,
      docs: {
        ops: opsDoc?.row ?? null,
        design: design?.row ?? null,
        watchlist: watchDoc?.row ?? await fetchCurrent("watchlist"),
      },
      reveal,
    };

    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * 運用設定値から「資料・Webページ」と「サイト・アカウント」の横断一覧を作る（REQ-039 v2）。
 *
 *   ⚠️ URL が空の項目は、それを参照するタスクが実行できない。画面で警告色にするため
 *      null のまま返す（空文字で潰さない）。
 *   ⚠️ パスワードは reveal のときだけ実値。既定は伏字。
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
