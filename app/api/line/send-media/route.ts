// ============================================================
// LINE メディア送信（POST）：画像・動画（Push）
//   運営のみ。ファイル本体は事前にクライアントが公開バケット line-outbound へ
//   直接アップロード済み。ここでは path を受け取り、公開URLを組み立てて
//   LINEへ画像/動画メッセージを送る（Vercelの本文サイズ制限を回避するため）。
//   ⚠️ LINEはPDF等の任意ファイル送信に非対応。画像(JPEG/PNG)・動画(mp4)のみ。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse, HttpError } from "../../../../lib/authz";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { pushImage, pushVideo } from "../../../../lib/lineClient";
import { getFriendById, insertOutMedia } from "../../../../lib/lineServer";
import { getAccessToken } from "../../../../lib/lineAccountsServer";

const BUCKET = "line-outbound";

interface Body { friendId?: number; path?: string; kind?: "image" | "video"; mime?: string }

export async function POST(request: Request): Promise<Response> {
  try {
    const me = await requireOps(request);
    const b = (await request.json()) as Body;

    const friendId = b.friendId;
    const path = (b.path ?? "").trim();
    const kind = b.kind;
    if (friendId == null) throw new HttpError(400, "friendId は必須です");
    if (!path) throw new HttpError(400, "path は必須です");
    if (kind !== "image" && kind !== "video") throw new HttpError(400, "kind が不正です");

    const friend = await getFriendById(friendId);
    if (!friend) throw new HttpError(404, "友だちが見つかりません");
    if (friend.status !== "friend") throw new HttpError(409, "ブロック等のため送信できません");
    if (friend.account_id == null) throw new HttpError(409, "この友だちのアカウントが特定できません");

    const accessToken = await getAccessToken(friend.account_id);
    if (!accessToken) throw new HttpError(409, "アカウントの認証情報が未登録です");

    // 公開URLはサーバー側で path から組み立てる（クライアントのURLは信用しない）
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path);
    const publicUrl = pub?.publicUrl;
    if (!publicUrl) throw new HttpError(500, "公開URLの取得に失敗しました");

    if (kind === "image") {
      await pushImage(accessToken, friend.line_user_id, publicUrl, publicUrl);
    } else {
      // 動画はプレビュー画像URLが必須。汎用プレースホルダを使う。
      const preview = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/line-video-thumb.png`;
      await pushVideo(accessToken, friend.line_user_id, publicUrl, preview);
    }

    const msg = await insertOutMedia(friend.account_id, friendId, kind, b.mime ?? "", publicUrl, me.memberId);
    if (!msg) throw new HttpError(500, "送信は成功しましたが保存に失敗しました");

    return NextResponse.json({ ok: true, id: msg.id });
  } catch (err) {
    return errorResponse(err);
  }
}
