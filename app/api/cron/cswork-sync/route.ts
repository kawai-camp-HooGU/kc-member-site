// ============================================================
// GET /api/cron/cswork-sync … 要監視顧客CSVをGoogle側から取り込む（REQ-039）
//
//   AIエージェントは Googleドライブの受け渡しファイル（スプレッドシート1枚 or CSV 1本）
//   を更新するだけでよい。ポータルは定刻にそれを読み、CsWork の要監視顧客へ反映する。
//   エージェントにポータルの書き込み権限を渡さずに済むのが、この形の目的。
//
//   ⚠️ fail-closed。CRON_SECRET・サービスアカウント・受け渡しファイルIDのいずれかが
//      未設定なら、素通りではなくエラーで止める。
//   ⚠️ **件数が大きく減った取り込みは現行版にしない。** CSVは丸ごと差し替えなので、
//      エージェントが取得に失敗した相手を落とすと台帳から消える。履歴には残し、
//      人が画面で中身を見てから「この版に戻す」で反映する。
//   ⚠️ 中身が前回と同じなら何もしない（同じ内容の履歴を毎回積まない）。
// ============================================================
import { NextResponse } from "next/server";
import { requireCron, errorResponse, HttpError } from "../../../../lib/authz";
import { errMessage } from "../../../../lib/errors";
import { googleReadCsv } from "../../../../lib/googleDriveServer";
import { validate } from "../../../../lib/csWork/build";
import { parseCsv } from "../../../../lib/csWork/parse";
import { saveDoc, audit, readCurrentContent } from "../../../../lib/csWork/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 前回より何割減ったら現行版にしないか（0.2 = 2割）。 */
const SHRINK_LIMIT = 0.2;
const MAX_BYTES = 5 * 1024 * 1024;

interface SyncResult {
  ran: string;
  source: { fileId: string; name: string; modifiedTime: string } | null;
  rows: number;
  prevRows: number | null;
  ok: boolean;
  activated: boolean;
  skipped: string | null;
  reasons: string[];
}

export async function GET(request: Request): Promise<Response> {
  try {
    requireCron(request);

    const fileId = (process.env.CSWORK_WATCHLIST_FILE_ID ?? "").trim();
    if (!fileId) throw new HttpError(500, "CSWORK_WATCHLIST_FILE_ID が未設定です（受け渡しファイルのIDを環境変数に入れてください）");

    const { meta, csv } = await googleReadCsv(fileId);
    if (!csv.trim()) throw new HttpError(422, "受け渡しファイルが空です");
    if (csv.length > MAX_BYTES) throw new HttpError(413, "受け渡しファイルが大きすぎます（5MBまで）");

    const rows = parseCsv(csv).length;
    const prev = await readCurrentContent("watchlist");
    const prevRows = prev ? parseCsv(prev.text).length : null;

    // 中身が同じなら履歴を積まない
    if (prev && prev.text.trim() === csv.trim()) {
      const same: SyncResult = {
        ran: new Date().toISOString(), rows, prevRows, ok: true, activated: false,
        source: { fileId, name: meta.name, modifiedTime: meta.modifiedTime },
        skipped: "前回と同じ内容のため取り込みませんでした", reasons: [],
      };
      return NextResponse.json(same);
    }

    const result = validate("watchlist", csv);
    const reasons = result.summary.filter((s) => s.status === "ng").map((s) => `${s.label}：${s.detail}`);

    // 安全弁：前回より大きく減っていたら現行版にしない
    let shrunk = false;
    if (prevRows !== null && prevRows > 0) {
      const lost = (prevRows - rows) / prevRows;
      if (lost >= SHRINK_LIMIT) {
        shrunk = true;
        reasons.push(`件数の急減：${prevRows}件 → ${rows}件（${Math.round(lost * 100)}%減）。取得漏れの可能性があるため現行版にしていません`);
      }
    }

    const makeCurrent = result.ok && !shrunk;
    const row = await saveDoc({
      kind: "watchlist",
      filename: meta.name,
      text: csv,
      title: meta.name,
      version: "",
      meta: {
        source: "google-drive",
        fileId,
        modifiedTime: meta.modifiedTime,
        rows,
        prevRows,
        shrunk,
        validation: result.summary,
      },
      memberId: null,          // エージェント取り込み。人の操作ではない
      makeCurrent,
    });

    await audit("upload", null, row.id, {
      kind: "watchlist", via: "cron", fileId, ok: result.ok, activated: makeCurrent, rows, prevRows, shrunk,
    });

    const out: SyncResult = {
      ran: new Date().toISOString(),
      source: { fileId, name: meta.name, modifiedTime: meta.modifiedTime },
      rows, prevRows,
      ok: result.ok,
      activated: makeCurrent,
      skipped: makeCurrent ? null : "履歴に残しました。画面で中身を確認してから反映してください",
      reasons,
    };
    return NextResponse.json(out);
  } catch (err: unknown) {
    if (err instanceof HttpError) return errorResponse(err);
    return NextResponse.json({ ok: false, error: errMessage(err) }, { status: 500 });
  }
}
