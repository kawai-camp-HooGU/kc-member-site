// ============================================================
// POST /api/bot/stream — 公開ボット（ストリーミング版・B-3）
//
//   ★ /api/bot と同じゲートを同じ順で通る。違うのは「返し方」だけ。
//     入口判定 → 回数ゲート → スコープ判定 → 検索 → 生成 → 監査ログ。
//     ここを別実装にすると、片方だけ制限が抜ける状態が生まれる。
//
//   ⚠️ AI_BOT_STREAM=true のときだけ有効。未設定なら 404 を返し、
//      クライアントは従来の /api/bot へ落ちる（既定は非ストリーミング）。
//
//   ⚠️ 出力は SSE。イベントは3種類だけ。
//        delta  … 生成された文字（複数回）
//        final  … 出典・traceId・sessionToken・残回数（1回・最後）
//        error  … 失敗（1回。delta のあとに来ることもある）
//
//   ⚠️ プロキシに溜め込ませない。Content-Type と X-Accel-Buffering を必ず付ける。
//      これが無いと全部書き終わってから一気に届き、ストリームにした意味が無くなる。
// ============================================================
import { requireUser, errorResponse, HttpError, type Caller } from "../../../../lib/authz";
import {
  loadPolicy, loadShareLink, assertShareUsable, subjectKeyFor,
  bumpDailyUsage, bumpShareUsage, classifyInScope, retrieveForBot,
  searchWeb, generateAnswer, logPublic, type BotPolicy,
} from "../../../../lib/bot/botServer";
import {
  resolveBotSession, appendBotTurn, type BotSessionCtx,
} from "../../../../lib/bot/botSession";
import type { BotAskReq, BotEntry, BotSource } from "../../../../lib/bot/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const REFUSE_ANSWER =
  "その質問にはお答えできません。KAWAI-CAMPの入会・料金・使い方などについてお聞きください。";
const CLASSIFY_FAILED_ANSWER =
  "ただいま確認に時間がかかっています。お手数ですが、事務局までお問い合わせください。";

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || (request.headers.get("x-real-ip") ?? "");
}
function newRequestId(): string {
  return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  // ⚠️ プロキシのバッファリング抑止。これが無いと逐次表示にならない
  "x-accel-buffering": "no",
} as const;

export async function POST(request: Request) {
  // ── ここは通常のレスポンスで返してよい部分（まだ1文字も出していない）──
  let entry: BotEntry;
  let memberId: number | null = null;
  let link = null;
  let message = "";
  let subjectKey = "";
  let remaining = 0;
  let policy: BotPolicy;
  let session: BotSessionCtx;

  const startedAt = Date.now();
  const requestId = newRequestId();
  let body: (BotAskReq & { passcode?: string }) | null = null;

  try {
    if (process.env.AI_BOT_STREAM !== "true") {
      // 無効時は 404。クライアントは黙って /api/bot へ落ちる
      throw new HttpError(404, "ストリーミングは無効です。");
    }
    if (process.env.BOT_PUBLIC_ENABLED !== "true") {
      throw new HttpError(503, "チャットボットは現在準備中です。");
    }

    body = (await request.json().catch(() => ({}))) as BotAskReq & { passcode?: string };
    message = (body.message ?? "").trim();
    if (!message) throw new HttpError(400, "メッセージを入力してください。");

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

    policy = await loadPolicy(entry);
    if (!policy.enabled) throw new HttpError(403, "現在ご利用いただけません。");

    subjectKey = subjectKeyFor(entry, {
      memberId, token: body.shareToken ?? null,
      ip: clientIp(request), ua: request.headers.get("user-agent") ?? "",
    });

    if (entry === "trial" && link) remaining = await bumpShareUsage(link);
    else remaining = await bumpDailyUsage(entry, subjectKey, policy.daily_limit);

    session = await resolveBotSession(body.sessionToken, { entry, subjectKey, memberId });
  } catch (err) {
    // ここまでの失敗は普通のJSONで返す。SSEを開く前なのでステータスを付けられる
    return errorResponse(err);
  }

  // ── ここから SSE ──
  const enc = new TextEncoder();
  const ctx = { requestId, entry, subjectKey, startedAt };
  const pol = policy;
  const ses = session;
  const ent = entry;
  const useWebFlag = body?.useWeb === true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown): void => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { /* 受け手が離れた */ }
      };

      try {
        // ── スコープ判定（fail-closed）──
        const scope = await classifyInScope(message, pol.scope_genres, ctx);
        if (!scope.inScope) {
          const answerText = scope.failed ? CLASSIFY_FAILED_ANSWER : REFUSE_ANSWER;
          await logPublic({
            entry: ent, subject_key: subjectKey, question: message,
            matched_bookmark_ids: [], used_web: false, refused: true,
            ok: !scope.failed,
            error: scope.failed ? "scope classify failed (fail-closed)" : null,
            answer: answerText, sources: [],
          });
          // 辞退はLLMを呼んでいないので一括で返す（traceId も無い）
          send("delta", { text: answerText });
          send("final", {
            sources: [], remaining, refused: true, traceId: null,
            sessionToken: ses.token,
          });
          return;
        }

        // ── 検索 → 生成 ──
        const { knowledge, sources: kSources, styleGuide, retrieval, volatile } =
          await retrieveForBot(message, pol.scope_genres);

        const webAllowed =
          (ent === "trial" && link ? link.web_search : pol.web_search !== "off");
        const useWeb = webAllowed && (useWebFlag || pol.web_search === "always");
        const web = useWeb ? await searchWeb(message) : [];

        const { answer, sources, traceId, refused } = await generateAnswer({
          message, knowledge, sources: kSources, web,
          maxTokens: pol.max_tokens, memberId, styleGuide,
          retrieval, ctx, volatile,
          history: ses.history, sessionId: ses.id,
          // ★ ここだけが /api/bot との違い
          onDelta: (t) => send("delta", { text: t }),
        });

        // 該当なしで定型を返した場合、onDelta は呼ばれていないので一括で送る
        if (refused && answer) send("delta", { text: answer });

        await logPublic({
          entry: ent, subject_key: subjectKey, question: message,
          matched_bookmark_ids: sources
            .filter((s): s is Extract<BotSource, { type: "bookmark" }> => s.type === "bookmark")
            .map((s) => s.id),
          used_web: web.length > 0, refused, ok: true,
          answer, sources, trace_id: traceId,
        });
        await appendBotTurn(ses.id, { question: message, answer, sources, traceId });

        send("final", { sources, remaining, refused, traceId, sessionToken: ses.token });
      } catch (e: unknown) {
        // ⚠️ すでに delta を出したあとかもしれない。画面は途中まで表示している前提で書く
        const msg = e instanceof Error ? e.message : "エラーが発生しました。";
        try {
          await logPublic({
            entry: ent, subject_key: subjectKey, question: message,
            matched_bookmark_ids: [], used_web: false, refused: false, ok: false,
            error: msg, answer: "", sources: [],
          });
        } catch { /* ログの失敗で握りつぶさない */ }
        send("error", { message: msg });
      } finally {
        // ⚠️ 必ず閉じる。閉じ忘れると関数が上限まで生き続ける
        try { controller.close(); } catch { /* noop */ }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
