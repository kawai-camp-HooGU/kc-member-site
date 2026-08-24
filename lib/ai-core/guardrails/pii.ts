// ⚠️ AI Core（Ph3）。PJ固有のテーブル（members / chat_messages / contents / news / attributes /
//    chat_bookmarks 等）をここから参照しないこと。参照が要るものは PJ 側から渡す。
// ============================================================
// 個人情報のマスキング（サーバー専用）
//
//   AIへ渡すテキストから、メールアドレスと電話番号を伏せる。
//   氏名・属性は渡す（返信提案の精度に直結するため）。
//   ⚠️ マスキングはプロンプト組み立ての最後・トレース保存の前に行う。
//      これにより ai_traces に残る値もマスク後になる。
//   ⚠️ 方針は将来 project_config.pii へ移す（Ph3）。それまではここが既定。
// ============================================================

export type PiiKind = "email" | "tel" | "name";

export interface PiiPolicy {
  /** 伏せる対象 */
  mask: PiiKind[];
  /** そのまま渡す対象 */
  keep: PiiKind[];
}

/** 既定：氏名・属性は渡し、メール・電話はマスクする（REQ-030 確認事項9a） */
export const DEFAULT_PII: PiiPolicy = { mask: ["email", "tel"], keep: ["name"] };

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** 日本の電話番号（ハイフンあり・なし・+81）をゆるく拾う */
const TEL_RE = /(?:\+81[-\s]?\d{1,4}|0\d{1,4})[-\s]?\d{1,4}[-\s]?\d{3,4}/g;

/** t***@example.com の形にする（ドメインは残す：同一性の手がかりを保つため） */
export function maskEmail(s: string): string {
  const at = s.indexOf("@");
  if (at <= 0) return "***";
  const head = s.slice(0, at);
  const domain = s.slice(at);
  return `${head.slice(0, 1)}***${domain}`;
}

/** 090-****-5678 の形にする（先頭と末尾4桁を残す） */
export function maskTel(s: string): string {
  const digits = s.replace(/[^\d]/g, "");
  if (digits.length < 7) return "***";
  const head = digits.slice(0, 3);
  const tail = digits.slice(-4);
  return `${head}-****-${tail}`;
}

/**
 * 自由記述のテキストからメール・電話を伏せる。
 * 顧客のチャット本文・メモ・データ検索の抽出結果に通す。
 */
export function maskText(s: string, policy: PiiPolicy = DEFAULT_PII): string {
  let out = s ?? "";
  if (policy.mask.includes("email")) out = out.replace(EMAIL_RE, (m) => maskEmail(m));
  if (policy.mask.includes("tel")) out = out.replace(TEL_RE, (m) => maskTel(m));
  return out;
}

/** 値が1件のメール/電話であることが分かっている場合に使う（列単位のマスク） */
export function maskValue(kind: PiiKind, v: string, policy: PiiPolicy = DEFAULT_PII): string {
  if (!policy.mask.includes(kind)) return v;
  if (kind === "email") return maskEmail(v);
  if (kind === "tel") return maskTel(v);
  return "***";
}
