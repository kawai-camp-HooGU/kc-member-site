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
import { collectEmbedTokens } from "./embedToken";
import { isOpsRole } from "./zone";
import { loadStaffRoleKeys } from "./rolesServer";
import type { CmsContent, PublishMode } from "./models";
import type { AttrIndex } from "./members";

export type PublicContentStatus = "ok" | "notfound" | "login" | "denied";

/**
 * 本文HTMLの data-embed トークンから解決した「埋め込んでよいコンテンツ」（REQ-106）。
 *
 *   ⚠️ ここに入るのは**閲覧者基準の権限判定を通したものだけ**。
 *      本文に書いてあるからといって入れてはいけない（→ loadEmbedRefs）。
 */
export interface PublicEmbedRef {
  token: string;
  id: number; name: string; kind: string;
  url: string; noneMode: string; bodyText: string; bodyHtml: string;
  filePath: string; fileName: string; fileSize: number;
}

export interface PublicContentResult {
  status: PublicContentStatus;
  content: CmsContent | null;
  pageName: string;
  /** 外部公開として（未ログインでも）表示しているか */
  external: boolean;
  /** 本文に埋め込まれたコンテンツ（権限判定済み） */
  embeds: PublicEmbedRef[];
}

const asMode = (s: string | null | undefined): PublishMode =>
  (s === "all" || s === "exany" || s === "exall") ? s : "any";

const NOT_FOUND: PublicContentResult = { status: "notfound", content: null, pageName: "", external: false, embeds: [] };

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

  // ⚠️ この後の isOpsRole() が派生ロール（オペレーター派生）を認識できるよう、
  //    ロールマスタを読み込んで lib/zone.ts へ登録しておく。
  //    ここは contentsServer 内の全 isOpsRole 判定の唯一の入口なので、
  //    ここで一度呼べば以降の判定はすべて派生ロール対応になる。
  const [{ data: ma }] = await Promise.all([
    supabaseAdmin.from("member_attributes").select("attribute_id").eq("member_id", m.id),
    loadStaffRoleKeys(),
  ]);
  return { id: m.id, role: m.role ?? "", attrIds: (ma ?? []).map((r) => r.attribute_id) };
}

type Member = { id: number; role: string; attrIds: number[] };

/**
 * 本文HTML群に書かれた data-embed トークンを、閲覧者基準で解決する（REQ-106）。
 *
 *   ⚠️ ここが本要件で最も事故りやすい場所。
 *      本文のトークンは「運営がこれを埋め込みたい」という意思表示にすぎず、
 *      **閲覧者が見てよいかどうかとは無関係**。必ず下の3段を通すこと。
 *        1. コンテンツ自体が published かつ未削除か
 *        2. そのコンテンツが属するページが未削除か
 *           （/c は削除済みページを 404 にしている。本文経由だけ出ると食い違う）
 *        3. 閲覧者の権限：ページ側とコンテンツ側の canView を**両方**
 *
 *   ⚠️ 未ログイン（external）では、コンテンツとページの**両方が外部公開ON**のものだけ。
 *      /api/content/download は is_external=true のときページ判定を飛ばしているが、
 *      その穴をここへ持ち込まない。
 *
 *   参照先は page_id を問わない（別ページのコンテンツを参照できる＝確認事項5a）。
 */
async function loadEmbedRefs(
  htmls: (string | null | undefined)[],
  external: boolean,
  member: Member | null,
): Promise<PublicEmbedRef[]> {
  const tokens = [...new Set(htmls.flatMap((h) => collectEmbedTokens(h)))];
  if (tokens.length === 0) return [];                      // 余計なクエリを打たない
  if (!external && !member) return [];                     // 保険

  const { data: refs } = await supabaseAdmin
    .from("contents").select("*")
    .in("public_token", tokens)
    .eq("published", true).eq("is_deleted", false);
  if (!refs || refs.length === 0) return [];

  // 参照先が属するページ（削除済みは除外）
  const pageIds = [...new Set(refs.map((c) => c.page_id))];
  const { data: refPages } = await supabaseAdmin
    .from("content_pages").select("id, attr_mode, is_external, published, is_deleted")
    .in("id", pageIds.length ? pageIds : [-1]).eq("is_deleted", false);
  const pageOf = new Map((refPages ?? []).map((p) => [p.id, p]));

  const ops = !!member && isOpsRole(member.role);

  // 属性と祖先インデックスは、必要なときだけ引く
  const attrsByContent = new Map<number, number[]>();
  const attrsByPage = new Map<number, number[]>();
  let index: AttrIndex | null = null;
  if (!external && member && !ops) {
    const [{ data: ca }, { data: pa }] = await Promise.all([
      supabaseAdmin.from("content_attributes").select("content_id, attribute_id")
        .in("content_id", refs.map((c) => c.id)),
      supabaseAdmin.from("content_page_attributes").select("page_id, attribute_id")
        .in("page_id", pageIds.length ? pageIds : [-1]),
    ]);
    (ca ?? []).forEach((r) => {
      const a = attrsByContent.get(r.content_id) ?? []; a.push(r.attribute_id); attrsByContent.set(r.content_id, a);
    });
    (pa ?? []).forEach((r) => {
      const a = attrsByPage.get(r.page_id) ?? []; a.push(r.attribute_id); attrsByPage.set(r.page_id, a);
    });
    index = await loadAttrIndex();
  }

  const allowed = refs.filter((c) => {
    const pg = pageOf.get(c.page_id);
    if (!pg || !pg.published) return false;                // ページが削除済み／非公開
    if (external) return (c.is_external ?? false) && (pg.is_external ?? false);
    if (!member) return false;
    if (ops) return true;                                  // 運営は全部
    const okPage = canView(attrsByPage.get(pg.id) ?? [], asMode(pg.attr_mode), member.attrIds, index!);
    const okContent = canView(attrsByContent.get(c.id) ?? [], asMode(c.attr_mode), member.attrIds, index!);
    return okPage && okContent;                            // ページ・コンテンツの両方
  });

  return allowed.map((c) => ({
    token: String(c.public_token ?? "").toLowerCase(),
    id: c.id, name: c.name ?? "", kind: (c.kind as string) ?? "none",
    url: c.url ?? "", noneMode: (c.none_mode as string) ?? "text",
    bodyText: c.body_text ?? "", bodyHtml: c.body_html ?? "",
    filePath: c.file_path ?? "", fileName: c.file_name ?? "", fileSize: c.file_size ?? 0,
  }));
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
  //    ⚠️ 本文の埋め込みは「未ログイン相当」で解決する（外部公開のものだけ出る）。
  //       このコンテンツが外部公開でも、埋め込み先まで外部公開とは限らない。
  if (content.isExternal) {
    const embeds = await loadEmbedRefs([content.bodyHtml], true, null);
    return { status: "ok", content, pageName, external: true, embeds };
  }

  // 4. 会員限定 → ログイン必須
  const member = await currentMember();
  if (!member) return { status: "login", content: null, pageName: "", external: false, embeds: [] };

  // 運営（管理者・オペレーター）は属性条件によらず閲覧可
  if (isOpsRole(member.role)) {
    const embeds = await loadEmbedRefs([content.bodyHtml], false, member);
    return { status: "ok", content, pageName, external: false, embeds };
  }

  // 5/6. 公開対象属性の判定（ページ・コンテンツの両方を満たすこと＝会員ポータルと同じ挙動）
  const index = await loadAttrIndex();
  const { data: pa } = await supabaseAdmin
    .from("content_page_attributes").select("attribute_id").eq("page_id", pg.id);
  const pageAttrIds = (pa ?? []).map((x) => x.attribute_id);

  const okPage = canView(pageAttrIds, asMode(pg.attr_mode), member.attrIds, index);
  const okContent = canView(content.attrIds, content.attrMode, member.attrIds, index);
  if (!okPage || !okContent) return { status: "denied", content: null, pageName: "", external: false, embeds: [] };

  const embeds = await loadEmbedRefs([content.bodyHtml], false, member);
  return { status: "ok", content, pageName, external: false, embeds };
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
  // ── layout='embed'（1カラム埋め込み）でのインライン描画に使う。cards では未使用 ──
  url: string; noneMode: string; bodyText: string; bodyHtml: string;
  filePath: string; fileName: string; fileSize: number; createdAt: string;
}
export interface PublicPageResult {
  status: PublicContentStatus;
  /** layout: 'cards'（カード一覧・既定）／'embed'（1カラム埋め込み） */
  page: { id: number; name: string; overview: string; layout: string } | null;
  contents: PublicPageContent[];
  external: boolean;
  /** 配下コンテンツの本文に埋め込まれたコンテンツ（権限判定済み） */
  embeds: PublicEmbedRef[];
}

const PAGE_NOT_FOUND: PublicPageResult = { status: "notfound", page: null, contents: [], external: false, embeds: [] };

export async function loadPageByToken(token: string): Promise<PublicPageResult> {
  noStore();   // 公開URLは常に最新のDB状態で判定する（編集がキャッシュで反映されない事故を防ぐ）
  if (!token || !/^[0-9a-f]{8,64}$/i.test(token)) return PAGE_NOT_FOUND;

  const { data: p } = await supabaseAdmin
    .from("content_pages").select("*").eq("public_token", token).eq("is_deleted", false).maybeSingle();

  // 1. 存在しない／削除済み  2. 公開トグルOFF → 404（存在を伏せる）
  if (!p) return PAGE_NOT_FOUND;
  if (!p.published) return PAGE_NOT_FOUND;

  const pageInfo = { id: p.id, name: p.name ?? "", overview: p.overview ?? "", layout: p.layout === "embed" ? "embed" : "cards" };

  // 閲覧者の判定
  let external = false;
  let member: Awaited<ReturnType<typeof currentMember>> = null;
  if (p.is_external) {
    // 3. 外部公開ON → 属性条件は無視して誰でも閲覧可
    external = true;
  } else {
    // 4. 会員限定 → ログイン必須
    member = await currentMember();
    if (!member) return { status: "login", page: null, contents: [], external: false, embeds: [] };
    // 運営（管理者・オペレーター）は属性条件によらず閲覧可
    if (!isOpsRole(member.role)) {
      const index = await loadAttrIndex();
      const { data: pa } = await supabaseAdmin
        .from("content_page_attributes").select("attribute_id").eq("page_id", p.id);
      const pageAttrIds = (pa ?? []).map((x) => x.attribute_id);
      // 5/6. 公開対象属性の判定
      if (!canView(pageAttrIds, asMode(p.attr_mode), member.attrIds, index))
        return { status: "denied", page: null, contents: [], external: false, embeds: [] };
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
    url: c.url ?? "", noneMode: (c.none_mode as string) ?? "text",
    bodyText: c.body_text ?? "", bodyHtml: c.body_html ?? "",
    filePath: c.file_path ?? "", fileName: c.file_name ?? "", fileSize: c.file_size ?? 0,
    createdAt: c.created_at ?? "",
  }));

  // 本文（記事コンテンツ）に書かれた埋め込みトークンを、閲覧者基準で解決する。
  //   ⚠️ 対象は visible を通ったコンテンツの本文だけ。
  //      見えないコンテンツの本文から参照をかき集めない。
  const embeds = await loadEmbedRefs(contents.map((c) => c.bodyHtml), external, member);

  return { status: "ok", page: pageInfo, contents, external, embeds };
}
