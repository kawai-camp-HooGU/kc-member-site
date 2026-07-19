// ============================================================
// 資料（PDF等）のダウンロードURL発行
//
//   POST /api/content/download  { contentId }  →  { url }
//
//   ① 閲覧可否をサーバーで判定する（/c/[token] と同じルール）
//        ・published OFF                 → 404 相当
//        ・外部公開 ON                   → 誰でも可（未ログイン可）
//        ・外部公開 OFF ＋ 未ログイン    → 401
//        ・外部公開 OFF ＋ 属性が対象外  → 403（運営は素通し）
//   ② 期限付きの署名URL（5分）を発行する
//        download オプションを付けると Content-Disposition: attachment が付き、
//        ブラウザで開かずに保存される。元のファイル名（日本語可）で保存される。
//   ③ content_downloads に1行残す（誰がいつ何を落としたか）
//
//   ⚠️ バケットは public=false。署名URLの発行は service role だけができる。
//      ブラウザから直接 createSignedUrl を呼ばせないのは、このログを必ず通すため。
//   ⚠️ 署名URLは発行後の追跡ができない。ログは厳密には「ダウンロードを開始した」記録。
// ============================================================
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import { createSupabaseServer } from "../../../../lib/supabaseServer";
import { canView } from "../../../../lib/contents";
import { isOpsRole } from "../../../../lib/zone";
import { loadStaffRoleKeys } from "../../../../lib/rolesServer";
import type { PublishMode } from "../../../../lib/models";
import type { AttrIndex } from "../../../../lib/members";

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";

/** 属性の祖先インデックス（canView が要求する形） */
async function loadAttrIndex(): Promise<AttrIndex> {
  const { data } = await supabaseAdmin.from("attributes").select("id, parent_id");
  const parent = new Map<number, number | null>();
  (data ?? []).forEach((a) => parent.set(a.id, a.parent_id ?? null));
  const ancestors = new Map<number, Set<number>>();
  for (const id of parent.keys()) {
    const set = new Set<number>();
    let cur: number | null | undefined = id;
    while (cur != null && !set.has(cur)) { set.add(cur); cur = parent.get(cur) ?? null; }
    ancestors.set(id, set);
  }
  return { segsById: new Map(), ancestors };
}

async function currentMember(): Promise<{ id: number; role: string; attrIds: number[] } | null> {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: m } = await supabaseAdmin
    .from("members").select("id, role").eq("user_id", user.id).eq("is_deleted", false).maybeSingle();
  if (!m) return null;
  // ⚠️ 後段の isOpsRole() が派生ロールを認識できるようロールマスタを登録しておく
  const [{ data: ma }] = await Promise.all([
    supabaseAdmin.from("member_attributes").select("attribute_id").eq("member_id", m.id),
    loadStaffRoleKeys(),
  ]);
  return { id: m.id, role: m.role ?? "", attrIds: (ma ?? []).map((r) => r.attribute_id) };
}

export async function POST(request: Request) {
  try {
    const { contentId, mode } = (await request.json()) as { contentId?: number; mode?: "preview" | "download" };
    if (!contentId) return NextResponse.json({ error: "contentId は必須です" }, { status: 400 });
    // preview=画面表示用（インライン・ログなし）／ download=保存用（attachment・ログあり）
    const isDownload = mode !== "preview";

    const { data: c } = await supabaseAdmin
      .from("contents").select("*").eq("id", contentId).eq("is_deleted", false).maybeSingle();
    if (!c || !c.published || !c.file_path) {
      return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
    }

    const member = await currentMember();

    // ── 閲覧可否 ──
    if (!c.is_external) {
      if (!member) {
        return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });
      }
      if (!isOpsRole(member.role)) {
        const { data: pg } = await supabaseAdmin
          .from("content_pages").select("id, attr_mode, is_deleted").eq("id", c.page_id).maybeSingle();
        if (!pg || pg.is_deleted) {
          return NextResponse.json({ error: "ファイルが見つかりません" }, { status: 404 });
        }
        const index = await loadAttrIndex();
        const { data: pa } = await supabaseAdmin
          .from("content_page_attributes").select("attribute_id").eq("page_id", pg.id);
        const { data: ca } = await supabaseAdmin
          .from("content_attributes").select("attribute_id").eq("content_id", c.id);

        const okPage = canView((pa ?? []).map((x) => x.attribute_id), asMode(pg.attr_mode), member.attrIds, index);
        const okContent = canView((ca ?? []).map((x) => x.attribute_id), asMode(c.attr_mode), member.attrIds, index);
        if (!okPage || !okContent) {
          return NextResponse.json({ error: "このファイルを閲覧する権限がありません" }, { status: 403 });
        }
      }
    }

    // ── 署名URL（5分）──
    //   download=保存用：Content-Disposition: attachment（元のファイル名で保存される）
    //   preview =表示用：オプションなし＝インライン表示（iframe でそのまま見える）
    const fileName = c.file_name || "download.pdf";
    const { data: signed, error } = isDownload
      ? await supabaseAdmin.storage.from("content-files").createSignedUrl(c.file_path, 300, { download: fileName })
      : await supabaseAdmin.storage.from("content-files").createSignedUrl(c.file_path, 300);
    if (error || !signed?.signedUrl) {
      console.error("署名URLの発行に失敗:", error?.message);
      return NextResponse.json({ error: "ダウンロードURLを発行できませんでした" }, { status: 500 });
    }

    // ── ログ（ダウンロード押下時のみ。プレビュー表示では残さない）──
    if (isDownload) {
      await supabaseAdmin.from("content_downloads").insert({
        content_id: c.id,
        member_id: member?.id ?? null,
        file_name: fileName,
      }).then(({ error: e }) => { if (e) console.warn("ダウンロードログの記録に失敗:", e.message); });
    }

    return NextResponse.json({ url: signed.signedUrl, fileName });
  } catch (e) {
    console.error("/api/content/download:", e);
    return NextResponse.json({ error: "ダウンロードに失敗しました" }, { status: 500 });
  }
}
