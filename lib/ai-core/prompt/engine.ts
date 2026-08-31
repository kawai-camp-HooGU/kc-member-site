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
  /** {{part:key}} の既定本文。ai_prompt_parts に行が無いときのフォールバック */
  parts?: Record<string, string>;
}

/** {{part:key}} の解決オプション（呼び出し側が視点を渡す） */
export interface PartOpts {
  /** {{part:view}} を解決する実キー。未指定なら view_support */
  view?: string;
  /** DBに行が無いときのフォールバック（PJ側が渡す） */
  defaults?: Record<string, string>;
  /**
   * DBより優先する本文。管理画面のプレビューで「編集中のパーツ」を反映するために使う。
   * 解決順は overrides → DB → defaults。
   */
  overrides?: Record<string, string>;
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

// ── {{part:key}} の展開 ────────────────────────────────────────
//   役割・方針の本文に共通ブロックを差し込む。
//   ⚠️ 展開は1段だけ。展開結果に含まれる {{part:...}} は展開しない
//     （入れ子を許すと循環参照で止まらなくなる）。
const PART_RE = /\{\{part:([a-z0-9_]{1,32})\}\}/g;

interface PartRow {
  key: string;
  body: string | null;
  enabled: boolean | null;
}

/** {{part:view}} は別名。実キー（view_support / view_holder）へ解決する */
const resolveKey = (k: string, o: PartOpts): string =>
  k === "view" ? (o.view ?? "view_support") : k;

/** 本文に含まれる {{part:key}} を1段だけ展開する */
export async function expandParts(body: string, o: PartOpts = {}): Promise<string> {
  const keys = new Set<string>();
  for (const m of Array.from(body.matchAll(PART_RE))) keys.add(resolveKey(m[1], o));
  if (keys.size === 0) return body;   // ← 記法を含まない機能はここで素通り（クエリも増えない）

  const { data } = await coreDb()
    .from("ai_prompt_parts")
    .select("key, body, enabled")
    .in("key", Array.from(keys));     // ★ パーツが増えてもクエリは1回

  const rows = (data as PartRow[] | null) ?? [];
  const map = new Map<string, string>(
    rows.filter((r) => r.enabled !== false).map((r) => [r.key, (r.body ?? "").trim()]),
  );

  return body
    .replace(PART_RE, (_m, k: string) => {
      const key = resolveKey(k, o);
      // 未定義キーは空文字。プロンプトを壊さず動かし続ける（検知は保存時とプレビュー）
      return o.overrides?.[key] || map.get(key) || o.defaults?.[key] || "";
    })
    .replace(/\n{3,}/g, "\n\n");     // 空パーツが空行を作らないよう整える
}

/** 本文に含まれる {{part:key}} のうち、DBにも既定にも無いキーを返す（保存時の検知用） */
export async function unknownPartKeys(body: string, o: PartOpts = {}): Promise<string[]> {
  const keys = Array.from(new Set(
    Array.from(body.matchAll(PART_RE)).map((m) => resolveKey(m[1], o)),
  ));
  if (keys.length === 0) return [];

  const { data } = await coreDb()
    .from("ai_prompt_parts")
    .select("key, body, enabled")
    .in("key", keys);
  const rows = (data as PartRow[] | null) ?? [];
  const known = new Set(rows.filter((r) => r.enabled !== false).map((r) => r.key));

  return keys.filter(
    (k) => !known.has(k)
      && !(o.defaults?.[k] ?? "").trim()
      && !(o.overrides?.[k] ?? "").trim(),
  );
}

/**
 * 1クエリで system・model・temperature・version をまとめて返す。
 * ⚠️ 役割・方針と設定を別々に読むと ai_prompts を2回引くため、必ずこちらを使う。
 */
export async function loadBundle(
  feature: string,
  d: PromptDefaults,
  o: PartOpts = {},
): Promise<PromptBundle> {
  const row = await loadRow(feature);
  const dbBody = row?.enabled !== false ? (row?.body ?? "").trim() : "";
  // ★ 共通パーツを展開してから契約を連結する
  const body = await expandParts(dbBody || d.system, { ...o, defaults: d.parts });
  return {
    system: body + (d.inputHandling ?? INPUT_HANDLING) + (d.contract ?? ""),
    model: row?.model ?? null,
    temperature: row?.temperature ?? null,
    // 視点を含める。ai_logs から「どちらの視点で生成したか」を後から追える
    version: `${feature}@${row?.updated_at ?? "default"}${o.view ? `+${o.view}` : ""}`,
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
