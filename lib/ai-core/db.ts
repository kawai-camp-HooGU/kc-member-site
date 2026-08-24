// ============================================================
// AI Core が使う DB クライアントの受け口（Ph3）
//
//   ★ Core は「どのプロジェクトの Supabase か」を知らない。
//     PJ 側が起動時に setCoreDb() で1回渡す（lib/ai/bootstrap.ts）。
//     こうしておくと、別プロジェクトへ持ち出すとき Core を書き換えずに済む。
//
//   Core が読み書きしてよいのは AI 基盤自身のテーブルだけ：
//     ai_prompts / ai_traces / ai_logs / ai_usage / ai_usage_minute /
//     ai_model_prices / ai_projects / ai_project_configs /
//     ai_personas / knowledge_*
//   members / chat_messages / contents / news / attributes / chat_bookmarks など
//   PJ固有のテーブルは、PJ側で読んで Core に値として渡すこと。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "../authz";

let client: SupabaseClient | null = null;

/** PJ 側から1回だけ呼ぶ。2回目以降は上書き（テスト用に差し替えられる）。 */
export function setCoreDb(c: SupabaseClient): void {
  client = c;
}

/**
 * Core 内から DB を使うときの唯一の入口。
 * ⚠️ 未設定で呼ばれたら黙って動かず、原因が分かるエラーで止める。
 *    （PJ側の bootstrap を import し忘れたときに、無関係な例外で悩まないため）
 */
export function coreDb(): SupabaseClient {
  if (!client) {
    throw new HttpError(500,
      "AI Core の DB クライアントが未設定です。lib/ai/bootstrap.ts を import してください。");
  }
  return client;
}

/** 設定済みか（起動確認用） */
export const hasCoreDb = (): boolean => client !== null;
