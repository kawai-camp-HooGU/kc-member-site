// 一時的なデバッグ用エンドポイント。
// 公開ページのサーバー（supabaseAdmin / service_role）が実行時に
// 「どのSupabaseを、どんな内容で読んでいるか」を確認するためのもの。
// 原因特定後は必ず削除すること。
import { loadFormBySlug } from "../../../lib/formsServer";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const slug = "010d3dae6e5ae930";
  const form = await loadFormBySlug(slug).catch((e) => ({ error: String(e) } as any));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  let serviceKeyRef: string | null = null;
  try {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    const payload = key.split(".")[1] ?? "";
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    serviceKeyRef = (JSON.parse(json) as any).ref ?? null;
  } catch { /* ignore */ }

  // opcej（＝アプリの接続先）に実際に入っている forms を service_role で全件ダンプ
  const { data: allForms, error: formsErr } = await supabaseAdmin
    .from("forms")
    .select("id, slug, title, name, status, updated_at")
    .order("id");

  // slug=010d に一致する行を全部（重複がないか確認）
  const { data: bySlug } = await supabaseAdmin
    .from("forms")
    .select("id, slug, title, name, status")
    .eq("slug", slug);

  return Response.json({
    runtime_NEXT_PUBLIC_SUPABASE_URL: url,
    service_role_key_ref: serviceKeyRef,
    loadFormBySlug_result: {
      title: (form as any)?.title ?? null,
      name: (form as any)?.name ?? null,
      status: (form as any)?.status ?? null,
      field_count: (form as any)?.sections
        ? (form as any).sections.reduce((n: number, s: any) => n + (s.fields?.length ?? 0), 0)
        : null,
    },
    forms_matching_slug_010d: bySlug ?? null,
    all_forms_in_opcej: allForms ?? null,
    forms_error: formsErr ? String(formsErr.message) : null,
  });
}
