// ============================================================
// テンプレート（定型文）データアクセス（クライアント安全・Phase P2-B）
//   RichMessage を保存し、配信・シナリオ・自動応答・手動トークから再利用する。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { LineTemplate, RichMessage } from "./models";

export function toTemplate(r: Tables<"line_templates">): LineTemplate {
  return {
    id: r.id,
    name: r.name ?? "",
    message: (r.message_json as unknown as RichMessage) ?? { type: "text", text: "" },
    sortOrder: r.sort_order ?? 0,
  };
}

export async function fetchTemplates(): Promise<LineTemplate[]> {
  const { data } = await supabase
    .from("line_templates").select("*").eq("is_deleted", false)
    .order("sort_order", { ascending: true }).order("id", { ascending: true });
  return (data ?? []).map(toTemplate);
}

export async function saveTemplate(input: { id?: number; name: string; message: RichMessage; sortOrder?: number }): Promise<number | null> {
  const row = {
    name: input.name,
    message_json: (input.message ?? { type: "text", text: "" }) as unknown as Tables<"line_templates">["message_json"],
    sort_order: input.sortOrder ?? 0,
    updated_at: new Date().toISOString(),
  };
  if (input.id && input.id > 0) {
    const { error } = await supabase.from("line_templates").update(row).eq("id", input.id);
    return error ? null : input.id;
  }
  const { data, error } = await supabase.from("line_templates").insert(row).select("id").single();
  return error || !data ? null : data.id;
}

export async function deleteTemplate(id: number): Promise<void> {
  await supabase.from("line_templates").update({ is_deleted: true }).eq("id", id);
}
