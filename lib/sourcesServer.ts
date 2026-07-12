// ============================================================
// 流入経路マスタ（サーバー専用・service role）
//
//   sources は運営専用テーブル（RLS: is_ops()）。
//   配信エンジン・シナリオエンジン・初回メッセージ API は
//   ユーザーのセッションを持たないため、service role で読む。
//
//   ⚠️ supabaseAdmin は RLS を無視する。呼び出し元の検証は
//      各 API Route の requireOps()/requireCron() 側で必ず行うこと。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { toSource, buildSourceIndex } from "./sources";
import type { SourceIndex } from "./sources";
import type { Source } from "./models";

export async function loadSources(): Promise<Source[]> {
  const { data } = await supabaseAdmin
    .from("sources")
    .select("*")
    .eq("is_deleted", false)
    .order("sort_order")
    .order("id");
  return (data ?? []).map(toSource);
}

export async function loadSourceIndex(): Promise<SourceIndex> {
  return buildSourceIndex(await loadSources());
}

/** sources.id → 表示名（本文の {{流入経路}} 差し込みに使う） */
export async function sourceLabeler(): Promise<(id: number | null | undefined) => string> {
  const index = await loadSourceIndex();
  return (id) => (id == null ? "" : index.get(id)?.label ?? "");
}

/** ?src=<key> → sources.id（見つからなければ utm_source でフォールバック） */
export async function resolveSourceId(
  srcKey: string | null | undefined,
  utmSource?: string | null,
): Promise<number | null> {
  const key = (srcKey ?? "").trim();
  if (key) {
    const { data } = await supabaseAdmin
      .from("sources").select("id")
      .eq("key", key).eq("is_deleted", false)
      .maybeSingle();
    if (data) return data.id;
  }
  const utm = (utmSource ?? "").trim();
  if (utm) {
    const { data } = await supabaseAdmin
      .from("sources").select("id")
      .eq("utm_source", utm).eq("is_deleted", false)
      .limit(1).maybeSingle();
    if (data) return data.id;
  }
  return null;
}
