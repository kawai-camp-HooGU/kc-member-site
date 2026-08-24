// ============================================================
// AI Core の初期化（PJ 側・サーバー専用）
//
//   Core は Supabase クライアントを知らないので、ここで1回渡す。
//   ⚠️ Core を使うファイルは、直接でも間接でもこのファイルを import すること。
//      lib/ai/claude.ts などの再輸出シムが import しているため、
//      既存の import パス（lib/ai/*）を使っているかぎり自動的に通る。
//
//   import されるだけで実行される（副作用モジュール）。関数呼び出しは不要。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "../supabaseAdmin";
import { setCoreDb } from "../ai-core/db";

// ai_traces / ai_usage / knowledge_* は生成型(database.types)に無いためキャストして渡す。
setCoreDb(supabaseAdmin as unknown as SupabaseClient);

/** import 順の都合で明示的に呼びたいとき用（通常は不要）。 */
export function ensureAiCore(): void {
  setCoreDb(supabaseAdmin as unknown as SupabaseClient);
}
