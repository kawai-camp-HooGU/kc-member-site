// ============================================================
// プロンプト組み立てエンジン（Ph3・AI Core）
//
//   ai_prompts（AI基盤自身のテーブル）から1機能ぶんを読み、
//   「役割・方針 ＋ 入力の扱い ＋ 出力契約」の順に組み立てて返す。
//
//   ★ 既定の役割・方針と、機能ごとの出力契約は PJ 側から渡す（PromptDefaults）。
//     Core は「どう組み立てるか」だけを持ち、「何を書くか」は持たない。
//     この線引きを守らないと、新PJのたびに Core を直すことになる。
//
//   ⚠️ AI Core。PJ固有のテーブルをここから参照しないこと。
// ============================================================
import { coreDb } from "../db";
import { INPUT_HANDLING } from "./contracts";

export interface PromptRow {
  feature: string;
  body: string | null;
  enabled: boolean | null;
  model: string | null;
  temperature: number | null;
  updated_at: string | null;
}

/** PJ 側が用意する既定値 */
export interface PromptDefaults {
  /** ai_prompts に行が無い／無効のときに使う役割・方針 */
  system: string;
  /** 機能ごとの固定の出力契約（画面から編集させない部分） */
  contract?: string;
  /** 入力の扱いの宣言。既定は Core の INPUT_HANDLING */
  inputHandling?: string;
}

export interface PromptBundle {
  /** 役割・方針 ＋ 入力の扱い ＋ 出力契約 */
  system: string;
  /** ai_prompts.model（未設定なら null。呼び出し側でコード既定へフォールバック） */
  model: string | null;
  temperature: number | null;
  /** 例 "member_consult@2026-08-11T09:12:00Z" / "member_consult@default" */
  version: string;
}

/** ai_prompts の1行を取得（型未生成テーブルのため汎用クライアントで読む） */
export async function loadRow(feature: string): Promise<PromptRow | null> {
  const { data } = await coreDb()
    .from("ai_prompts")
    .select("feature, body, enabled, model, temperature, updated_at")
    .eq("feature", feature)
    .maybeSingle();
  return (data as PromptRow | null) ?? null;
}

/**
 * 1クエリで system・model・temperature・version をまとめて返す。
 * ⚠️ 役割・方針と設定を別々に読むと ai_prompts を2回引くため、必ずこちらを使う。
 */
export async function loadBundle(feature: string, d: PromptDefaults): Promise<PromptBundle> {
  const row = await loadRow(feature);
  const dbBody = row?.enabled !== false ? (row?.body ?? "").trim() : "";
  const body = dbBody || d.system;
  return {
    system: body + (d.inputHandling ?? INPUT_HANDLING) + (d.contract ?? ""),
    model: row?.model ?? null,
    temperature: row?.temperature ?? null,
    version: `${feature}@${row?.updated_at ?? "default"}`,
  };
}

/** 役割・方針の本文だけ（出力契約は含まない） */
export async function loadBody(feature: string, defaultSystem: string): Promise<string> {
  const row = await loadRow(feature);
  const dbBody = row?.enabled !== false ? (row?.body ?? "").trim() : "";
  return dbBody || defaultSystem;
}

/** 機能別のモデル／温度の上書き（未設定なら null） */
export async function loadConfig(
  feature: string,
): Promise<{ model: string | null; temperature: number | null }> {
  const row = await loadRow(feature);
  return { model: row?.model ?? null, temperature: row?.temperature ?? null };
}
