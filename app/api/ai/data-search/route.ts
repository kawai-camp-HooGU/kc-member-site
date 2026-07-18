// ============================================================
// ⑥ データ検索（スタッフ向け）
//    呼び出し元の画面 scope に応じて、サーバーが用意した「許可済み」
//    データだけを収集し、AIは絞り込み・要約・表整形のみを行う。
//
//    ★ AIにSQL権限を渡さない。scope＝安全な集計/抽出関数の集合。
//    ★ 個人情報は scope が members / payments のときのみ含まれる（権限内）。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { callClaude, checkRateLimit, clampInput, parseJsonOrThrow } from "../../../../lib/ai/claude";
import { loadPrompt } from "../../../../lib/ai/prompts";
import { collectSearchData } from "../../../../lib/ai/context";
import { SEARCH_SCOPE_LABEL } from "../../../../lib/ai/types";
import type {
  DataSearchReq, DataSearchRes, DataSearchRow, SearchScope,
} from "../../../../lib/ai/types";

interface ModelOut {
  summary?: string;
  columns?: string[];
  rows?: DataSearchRow[];
  source?: string;
  period?: string;
}

const isScope = (v: unknown): v is SearchScope =>
  typeof v === "string" && v in SEARCH_SCOPE_LABEL;

export async function POST(request: Request) {
  try {
    const me = await requireOps(request);
    const body = (await request.json()) as DataSearchReq;

    const scope = body?.scope;
    if (!isScope(scope)) throw new HttpError(400, "検索範囲（scope）が不正です");

    const query = clampInput(body?.query ?? "", 1000);
    if (!query) throw new HttpError(400, "検索したい内容を入力してください");

    const remaining = await checkRateLimit(
      me.memberId, "data_search", Number(process.env.AI_DATA_SEARCH_DAILY_LIMIT ?? process.env.AI_OPS_DAILY_LIMIT ?? 200),
    );

    // ★ scope 別の許可済みデータのみを収集（任意SQLは不可）
    const dataset = await collectSearchData(scope, query);

    const raw = await callClaude({
      feature: "data_search",
      system: await loadPrompt("data_search"),
      messages: [{ role: "user", content: dataset }],
      maxTokens: 2000,
      temperature: 0.2,
      callerMemberId: me.memberId,
    });
    const out = parseJsonOrThrow<ModelOut>(raw);

    const columns = (out.columns ?? []).filter((c): c is string => typeof c === "string");
    const rows = (out.rows ?? []).filter((r): r is DataSearchRow => r != null && typeof r === "object");

    const res: DataSearchRes = {
      summary: (out.summary ?? "").trim(),
      columns,
      rows,
      source: (out.source ?? SEARCH_SCOPE_LABEL[scope]).toString(),
      period: (out.period ?? "").toString(),
      remaining,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
