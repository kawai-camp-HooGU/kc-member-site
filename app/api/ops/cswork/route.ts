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
import { buildOps, buildDoc, buildFlow, buildWatchlist, maskSecrets } from "../../../../lib/csWork/build";
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
