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
import type { BotAskReq, BotAskRes, BotEntry, BotSource } from "../../../lib/bot/types";

export const runtime = "nodejs";

const REFUSE_ANSWER =
  "その質問にはお答えできません。KAWAI-CAMPの入会・料金・使い方などについてお聞きください。";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || (request.headers.get("x-real-ip") ?? "");
}

export async function POST(request: Request) {
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

    // ── スコープ判定（この質問だけ答える）──
    const inScope = await classifyInScope(message, policy.scope_genres);
    if (!inScope) {
      await logPublic({
        entry, subject_key: subjectKey, question: message,
        matched_bookmark_ids: [], used_web: false, refused: true, ok: true,
      });
      const res: BotAskRes = { answer: REFUSE_ANSWER, sources: [], remaining, refused: true };
      return NextResponse.json(res);
    }

    // ── 検索（フラグで Phase A/B 切替）→ （必要なら外部情報）→ 生成 ──
    const { knowledge, sources: kSources, styleGuide } = await retrieveForBot(message, policy.scope_genres);

    const webAllowed =
      (entry === "trial" && link ? link.web_search : policy.web_search !== "off");
    const useWeb = webAllowed && (body.useWeb === true || policy.web_search === "always");
    const web = useWeb ? await searchWeb(message) : [];

    const { answer, sources } = await generateAnswer({
      message, knowledge, sources: kSources, web, maxTokens: policy.max_tokens, memberId, styleGuide,
    });

    await logPublic({
      entry, subject_key: subjectKey, question: message,
      matched_bookmark_ids: sources.filter((s): s is Extract<BotSource, { type: "bookmark" }> => s.type === "bookmark").map((s) => s.id),
      used_web: web.length > 0, refused: false, ok: true,
    });

    const res: BotAskRes = { answer, sources, remaining, refused: false };
    return NextResponse.json(res);
  } catch (err) {
    return errorResponse(err);
  }
}
