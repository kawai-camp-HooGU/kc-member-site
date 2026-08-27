// ============================================================
// GET  /api/ops/cswork/runbook  … 現行版の指示ファイル本文を返す（REQ-039）
// POST /api/ops/cswork/runbook  … 現行 spec から指示ファイルを作り直す
//
//   クエリ / body: runner（既定 agent-browser）
//
//   エージェント（Claude スケジュールタスク）はここから手順を取得する。
//   ⚠️ {{ }} は展開されていない。実値は設定値スナップショットを見る。
//   ⚠️ 指示ファイルは実値を持たないが、運用の全体像が読み取れるため管理者のみ。
// ============================================================
import { NextResponse } from "next/server";
import { requireAdmin, requireSameOrigin, errorResponse, HttpError } from "../../../../../lib/authz";
import { buildRunbook } from "../../../../../lib/csWork/runbook";
import {
  audit, fetchCurrent, loadSettings, readCurrentContent, saveDoc,
} from "../../../../../lib/csWork/server";
import { parseSpec, validateSpec, type CsRunner } from "../../../../../lib/csWork/spec";

export const dynamic = "force-dynamic";

const RUNNERS: readonly CsRunner[] = ["agent-browser", "portal-cron", "human"];

function asRunner(v: string | null): CsRunner {
  return RUNNERS.includes((v ?? "") as CsRunner) ? (v as CsRunner) : "agent-browser";
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requireAdmin(request);
    const runner = asRunner(new URL(request.url).searchParams.get("runner"));

    const doc = await readCurrentContent("runbook", runner);
    if (!doc) {
      return NextResponse.json(
        { doc: null, content: "", message: "指示ファイルが未生成です。先に整形結果を承認してください" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { doc: doc.row, content: doc.text },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const me = await requireAdmin(request);
    const body = await request.json().catch(() => null) as { runner?: string } | null;
    const runner = asRunner(body?.runner ?? null);

    const specDoc = await readCurrentContent("spec");
    if (!specDoc) throw new HttpError(400, "現行版の spec がありません。先に整形結果を承認してください");

    const spec = parseSpec(JSON.parse(specDoc.text));
    const { settings } = await loadSettings();
    const settingsRow = await fetchCurrent("settings");
    const issues = validateSpec(spec, settings);

    const row = await saveDoc({
      kind: "runbook",
      filename: `runbook_${runner}_v${spec.doc_version}.md`,
      text: buildRunbook({
        spec, settings, runner, issues,
        settingsPath: settingsRow?.storage_path ?? null,
        generatedAt: new Date().toISOString(),
      }),
      title: `指示ファイル ${spec.doc_version}`,
      version: spec.doc_version,
      meta: { runner, regenerated: true },
      memberId: me.memberId,
      makeCurrent: true,
      docVersion: spec.doc_version,
      parentId: specDoc.row.id,
      runner,
    });

    await audit("generate_runbook", me.memberId, row.id, { runner, doc_version: spec.doc_version });
    return NextResponse.json({ doc: row });
  } catch (err) {
    return errorResponse(err);
  }
}
