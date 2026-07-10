import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { errMessage } from "../../../../lib/errors";

interface Body { conversationId?: number }

interface AnthropicTextBlock { type: string; text?: string }
interface AnthropicResponse {
  content?: AnthropicTextBlock[];
  error?: { message?: string };
}

// 顧客とのチャット履歴を時系列で要約する（AI: Anthropic Claude）
export async function POST(request: Request) {
  try {
    const { conversationId } = (await request.json()) as Body;
    if (conversationId == null) {
      return NextResponse.json({ error: "conversationId は必須です" }, { status: 400 });
    }

    // ── 権限チェック：スタッフ（管理者/オペレーター）のみ ──
    const authHeader = request.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
    }
    const { data: callerData, error: callerErr } = await supabaseAdmin.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return NextResponse.json({ error: "認証に失敗しました" }, { status: 401 });
    }
    const { data: meRows } = await supabaseAdmin
      .from("members").select("role").eq("user_id", callerData.user.id).eq("is_deleted", false).limit(1);
    const callerRole = meRows?.[0]?.role;
    if (callerRole !== "管理者" && callerRole !== "オペレーター") {
      return NextResponse.json({ error: "この操作の権限がありません" }, { status: 403 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY がサーバーに設定されていません" }, { status: 500 });
    }

    // ── メッセージを時系列で取得 ──
    const { data: msgs, error: msgErr } = await supabaseAdmin
      .from("chat_messages")
      .select("sender_side, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    if (msgErr) {
      return NextResponse.json({ error: msgErr.message }, { status: 500 });
    }
    if (!msgs || msgs.length === 0) {
      return NextResponse.json({ summary: "まだやり取りがありません。" });
    }

    const transcript = msgs.map((m) => {
      const who = m.sender_side === "staff" ? "事務局" : "顧客";
      const ts = (m.created_at ?? "").replace("T", " ").slice(0, 16);
      const body = (m.body ?? "").trim() || "（添付ファイル）";
      return `[${ts}] ${who}: ${body}`;
    }).join("\n");

    const prompt =
      "あなたはKAWAI CAMPのカスタマーサポート管理者を補助するアシスタントです。\n" +
      "以下は事務局スタッフと顧客（メンバー）のチャット履歴です。時系列に沿って、やり取りの流れと要点を日本語で簡潔に要約してください。\n\n" +
      "出力形式:\n" +
      "1) 冒頭に全体サマリを1〜2文\n" +
      "2) その後、時系列の箇条書き（「日付 時刻：出来事」の形式）\n" +
      "3) 未対応・要フォローがあれば最後に「要フォロー:」として明記（無ければ省略）\n\n" +
      "--- チャット履歴 ---\n" +
      transcript;

    const model = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest";
    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const json = (await aiRes.json()) as AnthropicResponse;
    if (!aiRes.ok) {
      return NextResponse.json(
        { error: json?.error?.message ?? `AI要約に失敗しました (${aiRes.status})` },
        { status: 502 },
      );
    }

    const summary = (json.content ?? [])
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string)
      .join("\n")
      .trim();

    return NextResponse.json({ summary: summary || "要約を生成できませんでした。" });
  } catch (err) {
    return NextResponse.json({ error: errMessage(err) }, { status: 500 });
  }
}
