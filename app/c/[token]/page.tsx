// ============================================================
// 公開URL /c/[token]
//
//   コンテンツごとに自動発行される一意トークンでアクセスする。
//     外部公開ON  … 未ログインでも閲覧可（公開対象属性は無視）
//     外部公開OFF … 会員のみ。未ログインならログイン導線、対象外なら閲覧不可
//     公開トグルOFF … 外部公開ONでも 404
//
//   判定は lib/contentsServer.ts に集約（service role で参照）。
// ============================================================
import type { Metadata } from "next";
import { loadContentByToken } from "../../../lib/contentsServer";
import { PublicContent, PublicContentNotice } from "../../../components/content/PublicContent";

export const dynamic = "force-dynamic";

interface Props { params: { token: string } }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const r = await loadContentByToken(params.token).catch(() => null);
  // 外部公開のときだけ検索エンジンに載せてよい（会員限定・404は noindex）
  const indexable = r?.status === "ok" && r.external;
  return {
    title: r?.status === "ok" && r.content ? `${r.content.name}｜KAWAI CAMP` : "コンテンツ｜KAWAI CAMP",
    robots: indexable ? undefined : { index: false, follow: false },
  };
}

export default async function PublicContentPage({ params }: Props) {
  const r = await loadContentByToken(params.token).catch(() => null);

  if (!r || r.status === "notfound") {
    return (
      <PublicContentNotice
        title="コンテンツが見つかりません"
        message={"URLをご確認ください。\n公開が終了している場合もあります。"}
      />
    );
  }

  if (r.status === "login") {
    return (
      <PublicContentNotice
        title="会員限定のコンテンツです"
        message={"閲覧するにはログインが必要です。\nログイン後、公開対象に含まれる場合のみ表示されます。"}
        action={{ href: `/login?next=${encodeURIComponent(`/c/${params.token}`)}`, label: "ログイン" }}
      />
    );
  }

  if (r.status === "denied") {
    return (
      <PublicContentNotice
        title="このコンテンツは閲覧できません"
        message={"公開対象に含まれていないため表示できません。\nご不明な点は事務局までお問い合わせください。"}
        action={{ href: "/", label: "ポータルへ戻る" }}
      />
    );
  }

  return <PublicContent c={r.content!} pageName={r.pageName} external={r.external} />;
}
