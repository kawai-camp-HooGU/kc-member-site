// 一時的なデバッグ用エンドポイント。
// 公開ページのサーバー（supabaseAdmin / service_role）が実行時に
// 「どのSupabaseを、どんな内容で読んでいるか」を確認するためのもの。
// 原因特定後は必ず削除すること。
import { loadFormBySlug } from "../../../lib/formsServer";

export const dynamic = "force-dynamic";

export async function GET() {
  const slug = "010d3dae6e5ae930";
  const form = await loadFormBySlug(slug).catch((e) => ({ error: String(e) } as any));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  // service_role キーの ref（プロジェクトID）だけ復号して表示（秘密ではない）。
  let serviceKeyRef: string | null = null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const payload = key.split(".")[1] ?? "";
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    serviceKeyRef = (JSON.parse(json) as any).ref ?? null;
  } catch { /* ignore */ }

  return Response.json({
    runtime_NEXT_PUBLIC_SUPABASE_URL: url,
    service_role_key_ref: serviceKeyRef,
    form_title: (form as any)?.title ?? null,
    form_name: (form as any)?.name ?? null,
    form_status: (form as any)?.status ?? null,
    field_count: (form as any)?.sections
      ? (form as any).sections.reduce((n: number, s: any) => n + (s.fields?.length ?? 0), 0)
      : null,
    raw_error: (form as any)?.error ?? null,
  });
}
