# コンテンツページ固有URL（`/p/{token}`）実装案

## 目的
現状、公開URL（一意トークン）は **コンテンツ（`contents`）単位のみ**（`/c/{token}`）。
これを **コンテンツページ（`content_pages`）単位**にも拡張し、`/p/{token}` で
「そのページ全体（概要＋配下の閲覧可能なコンテンツ一覧）」を1つのURLで共有できるようにする。

設計方針は既存の `migration_add_content_public_url.sql` / `lib/contentsServer.ts:loadContentByToken` /
`app/c/[token]/page.tsx` を**そのまま踏襲**する（トークン発行方式・公開判定・service role参照）。

活用例: フォームの「サンクスURL」に `/p/{token}` を指定すれば、送信後にコンテンツページ全体へ着地できる。

---

## 全体像（追加/変更するファイル）

| # | 種別 | ファイル | 内容 |
|---|---|---|---|
| 1 | DB | `supabase/migration_add_content_page_public_url.sql`（新規） | `content_pages` に `public_token` / `is_external` /（必要なら）`published` を追加 |
| 2 | 型 | `lib/database.types.ts` | `content_pages` の Row/Insert/Update に列追加 |
| 3 | サーバ取得 | `lib/contentsServer.ts` | `loadPageByToken(token)` を追加（`loadContentByToken` のページ版） |
| 4 | 公開ルート | `app/p/[token]/page.tsx`（新規） | `/p/{token}` の公開ページ。`app/c/[token]/page.tsx` のミラー |
| 5 | 公開UI | `components/content/PublicPage.tsx`（新規） | ページ概要＋配下コンテンツ一覧を表示 |
| 6 | ゾーン | `lib/zone.ts` | `PUBLIC_PREFIXES` に `"/p/"` を追加 |
| 7 | クライアントUtil | `lib/contents.ts` | `pagePublicPath()` / `pagePublicUrl()` を追加 |
| 8 | ops管理UI | コンテンツページ編集画面（`views`/`components/content`） | ページの公開URL表示＋コピー、外部公開/公開トグル |

RLSは `content_pages_all`（authenticated, using true）が既にあり、公開参照は service role で行うため**追加ポリシー不要**。

---

## 1. DBマイグレーション（`supabase/migration_add_content_page_public_url.sql`）

`contents` 版と同じトークン方式（`substr(md5(gen_random_uuid()::text),1,16)`、発行後変更不可）。

```sql
-- ============================================================
-- コンテンツページ：公開URL（一意トークン）＋ 外部公開
--   /p/{public_token} で「ページ全体」を共有できるようにする。
--   方針は contents.public_token と完全に同一。
-- ============================================================

alter table public.content_pages
  add column if not exists public_token text,
  add column if not exists is_external  boolean not null default false,
  -- contents に合わせてページ単位の公開トグルも用意（OFFなら /p/{token} は404）
  add column if not exists published    boolean not null default true;

-- 既存行へのバックフィル（トークン未発行の行に一括発行）
update public.content_pages
   set public_token = substr(md5(gen_random_uuid()::text), 1, 16)
 where public_token is null;

-- 以降の INSERT は DB 側で自動発行（アプリは public_token を送らない）
alter table public.content_pages
  alter column public_token set default substr(md5(gen_random_uuid()::text), 1, 16);
alter table public.content_pages
  alter column public_token set not null;

create unique index if not exists content_pages_public_token_uidx
  on public.content_pages(public_token);

create index if not exists content_pages_external_idx
  on public.content_pages(is_external) where is_external;

-- 発行後は変更不可（共有済みリンクが切れるのを防ぐ）
create or replace function public.content_pages_public_token_immutable()
returns trigger language plpgsql as $$
begin
  if new.public_token is distinct from old.public_token then
    raise exception '公開URL（public_token）は発行後に変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists content_pages_public_token_immutable on public.content_pages;
create trigger content_pages_public_token_immutable
  before update on public.content_pages
  for each row execute function public.content_pages_public_token_immutable();

comment on column public.content_pages.public_token is 'ページ固有の公開URLトークン。新規登録時に自動発行・以後変更不可。/p/{public_token}';
comment on column public.content_pages.is_external  is '外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。publishedがOFFなら無効。';
comment on column public.content_pages.published    is 'ページ公開トグル。OFFなら /p/{token} は404。';
```

> 適用は opcej（本番）Supabase の SQL Editor で実行。`is_deleted` / `attr_mode` は既存カラムを流用。

---

## 2. 型定義（`lib/database.types.ts`）

`content_pages` の Row/Insert/Update に追加（`contents` の記述に倣う）。

```ts
content_pages: {
  Row: {
    id: number; name: string; abbr: string; overview: string | null; attr_mode: string;
    sort_order: number; is_deleted: boolean; created_at: string | null;
    public_token: string; is_external: boolean; published: boolean;   // ← 追加
  };
  Insert: {
    id?: number; name?: string; abbr?: string; overview?: string | null; attr_mode?: string;
    sort_order?: number; is_deleted?: boolean; created_at?: string | null;
    public_token?: never;               // ← DB自動発行（アプリから渡さない）
    is_external?: boolean; published?: boolean;
  };
  Update: Partial<Database["public"]["Tables"]["content_pages"]["Insert"]>;
  Relationships: [];
};
```

---

## 3. サーバー取得（`lib/contentsServer.ts` に `loadPageByToken`）

`loadContentByToken` と同じ6状態の公開判定を、ページに適用する。
`ok` のときは配下コンテンツ一覧も返し、**各コンテンツはそのコンテンツ自身の公開判定でさらに絞る**
（ページURLはあくまで“箱”への入口で、コンテンツ単位の制限はバイパスしない）。

```ts
export type PublicPageResult =
  | { status: "notfound" }
  | { status: "login" }
  | { status: "denied" }
  | { status: "ok"; external: boolean; page: PublicPage; contents: PublicContentCard[] };

export async function loadPageByToken(token: string): Promise<PublicPageResult> {
  noStore(); // ← 今回のキャッシュ不具合対策。DBを常に最新で読む
  const { data: p } = await supabaseAdmin
    .from("content_pages")
    .select("*").eq("public_token", token).eq("is_deleted", false).maybeSingle();
  if (!p) return { status: "notfound" };
  if (!p.published) return { status: "notfound" };      // publishedがOFF → 404

  // ページの公開対象属性
  const { data: pa } = await supabaseAdmin
    .from("content_page_attributes").select("attribute_id").eq("page_id", p.id);
  const pageAttrIds = (pa ?? []).map((x) => x.attribute_id);

  // 閲覧者の判定（loadContentByToken と同じ分岐）
  const member = await memberFromToken(/* token渡し */);
  let external = false;
  if (p.is_external) {
    external = true;                                     // 誰でもOK（属性無視）
  } else {
    if (!member) return { status: "login" };             // 会員限定・未ログイン
    if (!canView(pageAttrIds, asMode(p.attr_mode), member.attrIds /*, index */))
      return { status: "denied" };                       // 対象外
  }

  // 配下コンテンツ（published・未削除・sort順）。各コンテンツを閲覧者基準で絞る
  const { data: cs } = await supabaseAdmin
    .from("contents").select("*")
    .eq("page_id", p.id).eq("published", true).eq("is_deleted", false)
    .order("sort_order");

  const visible = (cs ?? []).filter((c) =>
    external ? c.is_external                              // 未ログイン閲覧者は外部公開コンテンツのみ
             : /* member の属性で canView 判定 */ true
  );

  return {
    status: "ok",
    external,
    page: { id: p.id, name: p.name, overview: p.overview ?? "" },
    contents: visible.map((c) => ({
      name: c.name, kind: c.kind, thumbUrl: c.thumb_url,
      href: `/c/${c.public_token}`,                      // 各コンテンツは既存の /c/{token} へ
    })),
  };
}
```

> `memberFromToken` はサーバーで Cookie/Bearer からメンバー解決（既存関数）。`canView` / `asMode` は
> `contentsServer.ts` 内の既存ヘルパをそのまま利用。

---

## 4. 公開ルート（`app/p/[token]/page.tsx`）

`app/c/[token]/page.tsx` のミラー。`force-dynamic` 必須。

```ts
import type { Metadata } from "next";
import { loadPageByToken } from "../../../lib/contentsServer";
import { PublicPage } from "../../../components/content/PublicPage";
import { PublicContentNotice } from "../../../components/content/PublicContent";

export const dynamic = "force-dynamic";

interface Props { params: { token: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await loadPageByToken(params.token).catch(() => null);
  const indexable = r?.status === "ok" && r.external;
  return {
    title: r?.status === "ok" ? `${r.page.name}｜KAWAI CAMP` : "コンテンツ｜KAWAI CAMP",
    robots: indexable ? undefined : { index: false, follow: false },
  };
}

export default async function PublicPageRoute({ params }: Props) {
  const r = await loadPageByToken(params.token).catch(() => null);
  if (!r || r.status === "notfound")
    return <PublicContentNotice title="コンテンツが見つかりません"
      message={"URLをご確認ください。\n公開が終了している場合もあります。"} />;
  if (r.status === "login")
    return <PublicContentNotice title="会員限定のコンテンツです"
      message={"閲覧するにはログインが必要です。"}
      action={{ href: `/login?next=${encodeURIComponent(`/p/${params.token}`)}`, label: "ログイン" }} />;
  if (r.status === "denied")
    return <PublicContentNotice title="このコンテンツは閲覧できません"
      message={"公開対象に含まれていないため表示できません。"}
      action={{ href: "/", label: "ポータルへ戻る" }} />;

  return <PublicPage page={r.page} contents={r.contents} />;
}
```

---

## 5. 公開UI（`components/content/PublicPage.tsx`）

ページ名＋概要＋コンテンツカード一覧。各カードは `/c/{token}` へリンク（既存のコンテンツ表示を再利用）。
未ログイン閲覧者にはログイン導線を邪魔しないシンプルなカードにする。デザインは `PublicContent` に合わせる。

---

## 6. ゾーン（`lib/zone.ts`）

```ts
const PUBLIC_PREFIXES = ["/f/", "/c/", "/p/", "/s/"]; // ← "/p/" を追加
```
これで `/p/{token}` は middleware で「公開ゾーン」となり、未ログインでも通過できる。

---

## 7. クライアントUtil（`lib/contents.ts`）

```ts
export const pagePublicPath = (token: string): string => (token ? `/p/${token}` : "");
export function pagePublicUrl(token: string): string {
  if (!token) return "";
  const base = (process.env.NEXT_PUBLIC_SITE_URL ??
    (typeof window !== "undefined" ? window.location.origin : "")).replace(/\/$/, "");
  return `${base}${pagePublicPath(token)}`;
}
```

---

## 8. ops管理UI（コンテンツページ編集）

- ページ編集フォームに、コンテンツと同様の項目を追加:
  - **公開URL**（`/p/{token}`）を表示＋コピー（`UrlField` を流用）
  - **外部公開**（`is_external`）トグル
  - **公開**（`published`）トグル
  - 公開対象（`attr_mode` / `content_page_attributes`）は既存
- 保存系（`lib/contents.ts` のページ保存）で `is_external` / `published` を更新対象に追加
  （`public_token` は**渡さない**＝DB自動発行・変更不可）。

---

## 9. 設計上の注意 / 判断ポイント

- **Data Cache**: `loadPageByToken` の先頭で `noStore()` を必ず呼ぶ（今回の「編集が反映されない」不具合の再発防止）。
- **トークン不変**: 発行後変更不可（共有済みリンクが切れないように）。トリガで担保。
- **多層の公開判定**: ページURLはコンテンツ単位の制限をバイパスしない。ページ通過後も各コンテンツで再判定。
- **noindex**: 外部公開＋ok以外は `robots: noindex`。
- **published列の是非**: `content_pages` に `published` を新設するかは任意。運用上「ページ非公開」を使わないなら
  省略し、`is_external` と `attr_mode` のみでも可（その場合マイグレーションから `published` を外す）。
- **外部ロールへの公開範囲**: 受取フロー等で外部に見せる場合、対象ページ/コンテンツの公開対象に「外部」属性を含める。

---

## 10. 適用手順

1. `supabase/migration_add_content_page_public_url.sql` を opcej の SQL Editor で実行。
2. `lib/database.types.ts` に列追加。
3. `lib/contentsServer.ts`（`loadPageByToken`）、`app/p/[token]/page.tsx`、`components/content/PublicPage.tsx`、
   `lib/zone.ts`、`lib/contents.ts`、ops編集UI を実装。
4. main に push → デプロイ。
5. コンテンツページ編集画面で公開URL（`/p/{token}`）が出ることを確認。
   フォームのサンクスURL等に活用。
```
