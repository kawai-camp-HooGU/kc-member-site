// ============================================================
// KAWAI CAMP 商品文脈（サーバー専用）
//   data/seed/kawai-camp-context.json を読み、システムプロンプト用の
//   「商品前提＋Human Gate＋禁止表現」ブロックを組み立てる。
//   ※ 価格・返金・日程・定員は seed しない（確定情報が無い→答えない）。
// ============================================================
import { readFileSync } from "fs";
import { join } from "path";

interface CampContext {
  product_name?: string;
  promise?: string;
  audience?: string;
  departments?: string[];
  workflow?: string;
  human_gate?: string[];
  do_not_claim?: string[];
}

let cached: string | null = null;

/** システムプロンプトへ差し込む商品文脈ブロック（無ければ空文字）。 */
export function campContextBlock(): string {
  if (cached !== null) return cached;
  try {
    const raw = readFileSync(join(process.cwd(), "data", "seed", "kawai-camp-context.json"), "utf8");
    const c = JSON.parse(raw) as CampContext;
    const lines: string[] = [];
    if (c.product_name || c.promise) lines.push(`【${c.product_name ?? "KAWAI CAMP"} の前提】`);
    if (c.promise) lines.push(`約束: ${c.promise}`);
    if (c.audience) lines.push(`対象: ${c.audience}`);
    if (c.departments?.length) lines.push(`仕組み: ${c.departments.join("・")} の4部門で${c.workflow ?? "1つの実務ループを分担する"}`);
    const gate = c.human_gate?.length ? c.human_gate.join("・") : "価格・約束・契約・公開・送信";
    lines.push(`【Human Gate】${gate} は確定せず、人（事務局）の承認・公式手続きへ案内する。`);
    if (c.do_not_claim?.length) lines.push(`【禁止表現】${c.do_not_claim.join("・")} などの誇大・保証表現は使わない。`);
    lines.push("価格・返金・日程・定員などの確定情報は持っていないため断定せず、事務局へ案内する。");
    cached = lines.join("\n");
  } catch {
    cached = "";
  }
  return cached;
}
