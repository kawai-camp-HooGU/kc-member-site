// ============================================================
// POST /api/bot — 公開問い合わせボット（全入口共通）
//   ・未ログインでも動く公開エンドポイント（匿名OK）。
//   ・入口判定(anon/member/trial) → 回数/期限ゲート → スコープ →
//     ハイブリッド検索 → Claude生成 → 監査ログ。
//   ・service_role を使うが、公開へ出す値は限定する（botServer 側で担保）。
//   ⚠️ BOT_PUBLIC_ENABLED=true のときだけ稼働（本番有効化はオーナー承認後）。
// ============================================================
import { NextResponse } from "next/server";
import { requireUser, errorResponse, HttpError, type Caller } from "../../../lib/authz";
import {
  loadPolicy, loadShareLink, assertShareUsable, subjectKeyFor,
  bumpDailyUsage, bumpShareUsage, classifyInScope, retrieveForBot,
  searchWeb, generateAnswer, logPublic,
} from "../../../lib/bot/botServer";
import { resolveBotSession, appendBotTurn } from "../../../lib/bot/botSession";
import type { BotAskReq, BotAskRes, BotEntry, BotSource } from "../../../lib/bot/types";

export const runtime = "nodejs";

const REFUSE_ANSWER =
  "その質問にはお答えできません。KAWAI-CAMPの入会・料金・使い方などについてお聞きください。";

/** 分類そのものが失敗したとき（fail-closed）。誤答するより沈黙して人へ渡す。 */
const CLASSIFY_FAILED_ANSWER =
  "ただいま確認に時間がかかっています。お手数ですが、事務局までお問い合わせください。";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || (request.headers.get("x-real-ip") ?? "");
}

/** 1リクエスト内の複数のLLM呼び出し（スコープ分類・回答生成）を束ねるID */
function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = newRequestId();
  try {
    if (process.env.BOT_PUBLIC_ENABLED !== "true") {
      throw new HttpError(503, "チャットボットは現在準備中です。");
    }

    const body = (await request.json().catch(() => ({}))) as BotAskReq & { passcode?: string };
    const message = (body.message ?? "").trim();
    if (!message) throw new HttpError(400, "メッセージを入力してください。");

    // ── 入口判定 ──
    let entry: BotEntry;
    let memberId: number | null = null;
    let link = null;

    if (body.shareToken) {
      entry = "trial";
      link = await loadShareLink(body.shareToken);
      assertShareUsable(link);
      if (link.passcode && link.passcode !== (body.passcode ?? "")) {
        throw new HttpError(403, "パスコードが違います。");
      }
    } else {
      let caller: Caller | null = null;
      try { caller = await requireUser(request); } catch { caller = null; }
      if (caller && caller.memberId != null) { entry = "member"; memberId = caller.memberId; }
      else { entry = "anon"; }
    }

    const policy = await loadPolicy(entry);
    if (!policy.enabled) throw new HttpError(403, "現在ご利用いただけません。");

    const subjectKey = subjectKeyFor(entry, {
      memberId, token: body.shareToken ?? null,
      ip: clientIp(request), ua: request.headers.get("user-agent") ?? "",
    });

    // ── 回数ゲート（この1リクエストを1回として計上）──
    let remaining: number;
    if (entry === "trial" && link) remaining = await bumpShareUsage(link);
    else remaining = await bumpDailyUsage(entry, subjectKey, policy.daily_limit);

    // ── 会話セッション（S-5）──
    //   鍵はクライアントが持つ token。subject_key は「誰の分か」を残すためだけに渡す。
    const session = await resolveBotSession(body.sessionToken, { entry, subjectKey, memberId });

    const ctx = { requestId, entry, subjectKey, startedAt };

    // ── スコープ判定（この質問だけ答える）──
    //    分類に失敗した場合は fail-closed（答えずに人へ渡す）。
    const scope = await classifyInScope(message, policy.scope_genres, ctx);
    if (!scope.inScope) {
      const answerText = scope.failed ? CLASSIFY_FAILED_ANSWER : REFUSE_ANSWER;
      await logPublic({
        entry, subject_key: subjectKey, question: message,
        matched_bookmark_ids: [], used_web: false, refused: true,
        ok: !scope.failed,
        error: scope.failed ? "scope classify failed (fail-closed)" : null,
        answer: answerText, sources: [],
      });
      // 辞退はLLMを呼んでいないため traceId が無い（評価UIは出さない）
      const res: BotAskRes = {
        answer: answerText, sources: [], remaining, refused: true, traceId: null,
        sessionToken: session.token,
      };
      return NextResponse.json(res);
    }

    // ── 検索（フラグで Phase A/B 切替）→ （必要なら外部情報）→ 生成 ──
    const { knowledge, sources: kSources, styleGuide, retrieval, volatile } =
      await retrieveForBot(message, policy.scope_genres);

    const webAllowed =
      (entry === "trial" && link ? link.web_search : policy.web_search !== "off");
    const useWeb = webAllowed && (body.useWeb === true || policy.web_search === "always");
    const web = useWeb ? await searchWeb(message) : [];

    const { answer, sources, traceId, refused } = await generateAnswer({
      message, knowledge, sources: kSources, web, maxTokens: policy.max_tokens, memberId, styleGuide,
      retrieval, ctx, volatile,
      history: session.history, sessionId: session.id,
    });

    await logPublic({
      entry, subject_key: subjectKey, question: message,
      matched_bookmark_ids: sources.filter((s): s is Extract<BotSource, { type: "bookmark" }> => s.type === "bookmark").map((s) => s.id),
      used_web: web.length > 0, refused, ok: true,
      answer, sources, trace_id: traceId,
    });

    // 今回の往復を残す（次の質問で文脈として効く）
    await appendBotTurn(session.id, { question: message, answer, sources, traceId });

    const res: BotAskRes = {
      answer, sources, remaining, refused: false, traceId,
      sessionToken: session.token,
    };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
