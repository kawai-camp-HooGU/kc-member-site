// ============================================================
// コンテンツ：サーバー専用（公開URL /c/[token] の解決）
//
//   コンテンツごとに発行される一意トークンから、閲覧可否を判定して返す。
//
//   判定の順序（この順で評価すること）
//     1. トークンが存在しない／削除済み                       → notfound（404）
//     2. published が OFF                                     → notfound（404）
//        ※ 外部公開ONでも、公開トグルOFFなら見せない
//     3. is_external が ON                                    → ok（誰でも・未ログインでOK。属性条件は無視）
//     4. is_external が OFF ＋ 未ログイン                     → login（ログイン導線を出す）
//     5. is_external が OFF ＋ ログイン済み ＋ 公開対象に合致  → ok
//     6. is_external が OFF ＋ ログイン済み ＋ 対象外          → denied
//
//   ⚠️ 参照は service role（supabaseAdmin）で行い、anon には contents の SELECT 権限を与えない。
//      「外部公開ONだけ読める」という判定をこのサーバー層に一本化するため。
// ============================================================
import { unstable_noStore as noStore } from "next/cache";
import { supabaseAdmin } from "./supabaseAdmin";
import { createSupabaseServer } from "./supabaseServer";
import { canView } from "./contents";
import { isOpsRole } from "./zone";
import type { CmsContent, PublishMode } from "./models";
import type { AttrIndex } from "./members";

export type PublicContentStatus = "ok" | "notfound" | "login" | "denied";

export interface PublicContentResult {
  status: PublicContentStatus;
  content: CmsContent | null;
  pageName: string;
  /** 外部公開として（未ログインでも）表示しているか */
  external: boolean;
}

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";

const NOT_FOUND: PublicContentResult = { status: "notfound", content: null, pageName: "", external: false };

/** attributes 全件から祖先インデックスを組む（canView が要求する形） */
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

/** ログイン中の会員（未ログインなら null） */
async function currentMember(): Promise<{ id: number; role: string; attrIds: number[] } | null> {
  const supabase = createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: m } = await supabaseAdmin
    .from("members").select("id, role").eq("user_id", user.id).eq("is_deleted", false).maybeSingle();
  if (!m) return null;

  const { data: ma } = await supabaseAdmin
    .from("member_attributes").select("attribute_id").eq("member_id", m.id);
  return { id: m.id, role: m.role ?? "", attrIds: (ma ?? []).map((r) => r.attribute_id) };
}

/**
 * 公開URLトークンからコンテンツを解決する。
 * @param token /c/[token] のトークン
 */
export async function loadContentByToken(token: string): Promise<PublicContentResult> {
  noStore();   // 公開URLは常に最新のDB状態で判定する（編集がキャッシュで反映されない事故を防ぐ）
  if (!token || !/^[0-9a-f]{8,64}$/i.test(token)) return NOT_FOUND;

  const { data: r } = await supabaseAdmin
    .from("contents").select("*").eq("public_token", token).eq("is_deleted", false).maybeSingle();

  // 1. 存在しない／削除済み
  if (!r) return NOT_FOUND;
  // 2. 公開トグルOFF は外部公開ONでも 404（＝存在を伏せる）
  if (!r.published) return NOT_FOUND;

  const { data: ca } = await supabaseAdmin
    .from("content_attributes").select("attribute_id").eq("content_id", r.id);
  const { data: pg } = await supabaseAdmin
    .from("content_pages").select("id, name, attr_mode, is_deleted").eq("id", r.page_id).maybeSingle();
  if (!pg || pg.is_deleted) return NOT_FOUND;

  const content: CmsContent = {
    id: r.id, pageId: r.page_id, name: r.name ?? "", createdAt: r.created_at ?? "",
    publicToken: r.public_token ?? "", isExternal: r.is_external ?? false,
    sortOrder: r.sort_order ?? 0, published: r.published ?? true,
    kind: (r.kind as CmsContent["kind"]) ?? "none", url: r.url ?? "",
    noneMode: (r.none_mode as CmsContent["noneMode"]) ?? "text",
    bodyText: r.body_text ?? "", bodyHtml: r.body_html ?? "", thumbUrl: r.thumb_url ?? "",
    attrMode: asMode(r.attr_mode), attrIds: (ca ?? []).map((x) => x.attribute_id),
    filePath: r.file_path ?? "", fileName: r.file_name ?? "", fileSize: r.file_size ?? 0,
  };
  const pageName = pg.name ?? "";

  // 3. 外部公開ON → 属性条件は無視して誰でも閲覧可
  if (content.isExternal) return { status: "ok", content, pageName, external: true };

  // 4. 会員限定 → ログイン必須
  const member = await currentMember();
  if (!member) return { status: "login", content: null, pageName: "", external: false };

  // 運営（管理者・オペレーター）は属性条件によらず閲覧可
  if (isOpsRole(member.role)) return { status: "ok", content, pageName, external: false };

  // 5/6. 公開対象属性の判定（ページ・コンテンツの両方を満たすこと＝会員ポータルと同じ挙動）
  const index = await loadAttrIndex();
  const { data: pa } = await supabaseAdmin
    .from("content_page_attributes").select("attribute_id").eq("page_id", pg.id);
  const pageAttrIds = (pa ?? []).map((x) => x.attribute_id);

  const okPage = canView(pageAttrIds, asMode(pg.attr_mode), member.attrIds, index);
  const okContent = canView(content.attrIds, content.attrMode, member.attrIds, index);
  if (!okPage || !okContent) return { status: "denied", content: null, pageName: "", external: false };

  return { status: "ok", content, pageName, external: false };
}

// ============================================================
// コンテンツページ：公開URL /p/[token] の解決
//   loadContentByToken と同じ6状態で「ページ」への閲覧可否を判定し、
//   ok のときは配下の「閲覧可能なコンテンツ一覧」を返す。
//   ⚠️ ページURLはコンテンツ単位の公開制限をバイパスしない（各コンテンツで再判定）。
// ============================================================
export interface PublicPageContent {
  id: number; name: string; kind: string; thumbUrl: string;
  /** 各コンテンツの個別公開URL（/c/{token}） */
  href: string;
}
export interface PublicPageResult {
  status: PublicContentStatus;
  page: { id: number; name: string; overview: string } | null;
  contents: PublicPageContent[];
  external: boolean;
}

const PAGE_NOT_FOUND: PublicPageResult = { status: "notfound", page: null, contents: [], external: false };

export async function loadPageByToken(token: string): Promise<PublicPageResult> {
  noStore();   // 公開URLは常に最新のDB状態で判定する（編集がキャッシュで反映されない事故を防ぐ）
  if (!token || !/^[0-9a-f]{8,64}$/i.test(token)) return PAGE_NOT_FOUND;

  const { data: p } = await supabaseAdmin
    .from("content_pages").select("*").eq("public_token", token).eq("is_deleted", false).maybeSingle();

  // 1. 存在しない／削除済み  2. 公開トグルOFF → 404（存在を伏せる）
  if (!p) return PAGE_NOT_FOUND;
  if (!p.published) return PAGE_NOT_FOUND;

  const pageInfo = { id: p.id, name: p.name ?? "", overview: p.overview ?? "" };

  // 閲覧者の判定
  let external = false;
  let member: Awaited<ReturnType<typeof currentMember>> = null;
  if (p.is_external) {
    // 3. 外部公開ON → 属性条件は無視して誰でも閲覧可
    external = true;
  } else {
    // 4. 会員限定 → ログイン必須
    member = await currentMember();
    if (!member) return { status: "login", page: null, contents: [], external: false };
    // 運営（管理者・オペレーター）は属性条件によらず閲覧可
    if (!isOpsRole(member.role)) {
      const index = await loadAttrIndex();
      const { data: pa } = await supabaseAdmin
        .from("content_page_attributes").select("attribute_id").eq("page_id", p.id);
      const pageAttrIds = (pa ?? []).map((x) => x.attribute_id);
      // 5/6. 公開対象属性の判定
      if (!canView(pageAttrIds, asMode(p.attr_mode), member.attrIds, index))
        return { status: "denied", page: null, contents: [], external: false };
    }
  }

  // 配下コンテンツ（公開・未削除・sort順）を取得し、閲覧者基準でさらに絞る
  const { data: cs } = await supabaseAdmin
    .from("contents").select("*")
    .eq("page_id", p.id).eq("published", true).eq("is_deleted", false)
    .order("sort_order");

  const attrsByContent = new Map<number, number[]>();
  let index: AttrIndex | null = null;
  if (!external && member && !isOpsRole(member.role)) {
    const ids = (cs ?? []).map((c) => c.id);
    const { data: ca } = await supabaseAdmin
      .from("content_attributes").select("content_id, attribute_id")
      .in("content_id", ids.length ? ids : [-1]);
    (ca ?? []).forEach((r) => {
      const a = attrsByContent.get(r.content_id) ?? []; a.push(r.attribute_id); attrsByContent.set(r.content_id, a);
    });
    index = await loadAttrIndex();
  }

  const visible = (cs ?? []).filter((c) => {
    if (external) return c.is_external ?? false;                 // 未ログイン閲覧者は外部公開コンテンツのみ
    if (!member) return false;                                   // 保険（通常ここには来ない）
    if (isOpsRole(member.role)) return true;                     // 運営は全部
    return canView(attrsByContent.get(c.id) ?? [], asMode(c.attr_mode), member.attrIds, index!);
  });

  const contents: PublicPageContent[] = visible.map((c) => ({
    id: c.id, name: c.name ?? "", kind: (c.kind as string) ?? "none",
    thumbUrl: c.thumb_url ?? "", href: `/c/${c.public_token}`,
  }));

  return { status: "ok", page: pageInfo, contents, external };
}
