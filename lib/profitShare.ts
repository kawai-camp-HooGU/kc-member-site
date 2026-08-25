// ============================================================
// 利益分配レポート：按分の計算（純関数のみ）
//
//   設計書 §11 P4／確認事項3a＋。この機能の最終目的。
//
//   ＜按分ベース＞
//     計上金額（総額 − 決済手数料）から返金を控除した額。
//     振込手数料は金額が小さいため按分せず、月次の共通経費として1本で計上する。
//     → **売上が確定した時点で分配額が出せる**（着金を待たないので支払いが遅れない）。
//
//   ＜返金の扱い＞
//     返金は「元決済に適用されたルールで按分し直してマイナス計上」する。
//     返金月に別のルールを当てると払い過ぎ・戻し過ぎが必ず起きる。
//     部分返金は「返金額 ÷ 元決済の総額」の比率で按分額を戻す。
//     この作りなら、戻す額が払った額を超えることが構造的に起きない。
//
//   ＜1つの売上を複数人で分ける＞
//     一致したルールは**パートナーごとに1本だけ**採用する（同じ人に二重に払わない）。
//     別々のパートナーのルールは同時に成立する（それが「分配」なので）。
//     率の合計が100%を超えていたら warnings で知らせる。止めはしない。
//
//   ⚠️ ここには DB アクセスも React も置かない。
//   ⚠️ 日付は "YYYY-MM-DD" の文字列比較で扱う（lib/ledger.ts と同じ方針）。
// ============================================================
import { normalizeEmail } from "./emailNormalize";
import type {
  Partner, Payment, Refund, ShareEntry, ShareRule, ShareTier,
} from "./models";

// ── 端数処理 ──────────────────────────────────────────────────
//   既定は切り捨て。分配は「払い過ぎない側」に寄せるのが揉めにくい。
function roundBy(v: number, mode: ShareRule["rounding"]): number {
  return mode === "ceil" ? Math.ceil(v) : mode === "round" ? Math.round(v) : Math.floor(v);
}

/** 1件あたりの分配額。ベースが0以下なら0 */
export function calcShare(base: number, rule: ShareRule): number {
  const b = Math.round(base) || 0;
  if (b <= 0) return 0;
  if (rule.calc === "fixed") {
    // 固定額がベースを超えることはない（元の売上以上を配らない）
    return Math.min(b, Math.max(0, Math.round(rule.fixedAmount) || 0));
  }
  const rate = Number(rule.rate) || 0;
  if (rate <= 0) return 0;
  return Math.min(b, Math.max(0, roundBy(b * (rate / 100), rule.rounding)));
}

/** 2ティア（親パートナー）への報酬。率のみ */
export function calcParentShare(base: number, rule: ShareRule): number {
  const b = Math.round(base) || 0;
  const rate = Number(rule.parentRate) || 0;
  if (b <= 0 || rate <= 0) return 0;
  return Math.min(b, Math.max(0, roundBy(b * (rate / 100), rule.rounding)));
}

// ── 初回／2回目以降の判定 ─────────────────────────────────────
/** 顧客の識別キー。会員IDが最優先、無ければ正規化メール */
export function customerKey(p: { memberId: number | null; customerEmail: string }): string {
  if (p.memberId != null) return `m${p.memberId}`;
  const e = normalizeEmail(p.customerEmail);
  return e ? `e${e}` : "";
}

/**
 * 「その顧客・その商品種別で最初の購入」である決済IDの集合を返す。
 *
 * ⚠️ **期間で絞る前の全決済**を渡すこと。当月分だけを渡すと、
 *    去年から続いている会員の当月分が「初回」と判定され、初回レートで払ってしまう。
 */
export function firstPurchaseIds(payments: Payment[]): Set<number> {
  const firstOf = new Map<string, { id: number; date: string }>();
  for (const p of payments) {
    const ck = customerKey(p);
    if (!ck) continue;                       // 顧客を特定できない決済は初回判定の対象外
    const key = `${ck}${p.typeId ?? ""}`;
    const date = p.accrualDate || (p.paidAt ? p.paidAt.slice(0, 10) : "");
    if (!date) continue;
    const cur = firstOf.get(key);
    // 同日が複数あるときは id の小さい方を初回とする（登録順＝実際の順）
    if (!cur || date < cur.date || (date === cur.date && p.id < cur.id)) {
      firstOf.set(key, { id: p.id, date });
    }
  }
  return new Set([...firstOf.values()].map((v) => v.id));
}

const tierMatches = (rule: ShareRule, isFirst: boolean): boolean =>
  rule.tier === "both" || (isFirst ? rule.tier === "first" : rule.tier === "repeat");

// ── ルールの一致 ──────────────────────────────────────────────
export interface MatchContext {
  typeId: number | null;
  /** 計上日（"YYYY-MM-DD"） */
  accrualDate: string;
  isFirst: boolean;
}

function applies(rule: ShareRule, ctx: MatchContext): boolean {
  if (rule.isDeleted) return false;
  if (rule.scope === "type" && rule.typeId !== ctx.typeId) return false;
  if (!tierMatches(rule, ctx.isFirst)) return false;
  if (rule.validFrom && ctx.accrualDate && ctx.accrualDate < rule.validFrom) return false;
  if (rule.validTo && ctx.accrualDate && ctx.accrualDate > rule.validTo) return false;
  return true;
}

/**
 * 具体的なルールほど優先する。
 *   商品種別を指定している > 全商品
 *   初回／2回目以降を指定している > 両方
 * 同点なら priority、それも同じなら後から作った方（id が大きい方）。
 */
const specificity = (r: ShareRule): number =>
  (r.scope === "type" ? 2 : 0) + (r.tier !== "both" ? 1 : 0);

/** パートナーごとに1本だけ採用する（同じ人に二重に払わないため） */
export function matchRules(rules: ShareRule[], ctx: MatchContext): ShareRule[] {
  const best = new Map<number, ShareRule>();
  for (const r of rules) {
    if (!applies(r, ctx)) continue;
    const cur = best.get(r.partnerId);
    if (!cur) { best.set(r.partnerId, r); continue; }
    const a = specificity(r), b = specificity(cur);
    if (a > b || (a === b && (r.priority > cur.priority
      || (r.priority === cur.priority && r.id > cur.id)))) best.set(r.partnerId, r);
  }
  return [...best.values()].sort((x, y) => x.partnerId - y.partnerId);
}

// ── エントリの組み立て ────────────────────────────────────────
export interface ShareInput {
  /** 集計する期間（計上日ベース。"YYYY-MM-DD"） */
  from: string;
  to: string;
  /** ⚠️ 期間で絞る前の**全決済**。初回判定と返金の元決済引き当てに使う */
  payments: Payment[];
  refunds: Refund[];
  /** 完了扱いの返金ステータスID */
  refundDoneIds: ReadonlySet<number>;
  partners: Partner[];
  rules: ShareRule[];
}

export interface ShareResult {
  entries: ShareEntry[];
  warnings: string[];
}

const inRange = (d: string, from: string, to: string): boolean =>
  !!d && (!from || d >= from) && (!to || d <= to);

/**
 * 期間内の分配エントリを組み立てる。
 *
 * 売上 … 計上日が期間内の決済に、その時点のルールを当てる
 * 返金 … 返金完了日が期間内の返金に、**元決済の計上日時点のルール**を当ててマイナス計上
 */
export function buildShareEntries(i: ShareInput): ShareResult {
  const warnings: string[] = [];
  const entries: ShareEntry[] = [];

  const activePartners = new Map(i.partners.filter((p) => !p.isDeleted).map((p) => [p.id, p]));
  const partnerName = (id: number): string =>
    i.partners.find((p) => p.id === id)?.name ?? `不明(#${id})`;

  // 削除済みパートナーに生きたルールがぶら下がっていないか
  for (const r of i.rules) {
    if (r.isDeleted) continue;
    if (!activePartners.has(r.partnerId)) {
      warnings.push(`ルール #${r.id} の分配先「${partnerName(r.partnerId)}」は無効です。このルールは適用されません`);
    }
  }
  const rules = i.rules.filter((r) => !r.isDeleted && activePartners.has(r.partnerId));

  const firsts = firstPurchaseIds(i.payments);
  const byId = new Map(i.payments.map((p) => [p.id, p]));

  /** 1つの決済が生む分配（売上・返金の両方で使う） */
  const sharesOf = (p: Payment): { rule: ShareRule; direct: number; parent: number; parentId: number | null }[] => {
    const accrual = p.accrualDate || (p.paidAt ? p.paidAt.slice(0, 10) : "");
    const base = Math.max(0, Math.round(p.recognizedAmount) || 0);
    const ctx: MatchContext = { typeId: p.typeId, accrualDate: accrual, isFirst: firsts.has(p.id) };
    return matchRules(rules, ctx).map((rule) => {
      const partner = activePartners.get(rule.partnerId);
      const parentId = partner?.parentPartnerId ?? null;
      const parentOk = parentId != null && activePartners.has(parentId);
      return {
        rule,
        direct: calcShare(base, rule),
        parent: parentOk ? calcParentShare(base, rule) : 0,
        parentId: parentOk ? parentId : null,
      };
    });
  };

  // ── 売上 ──
  for (const p of i.payments) {
    const accrual = p.accrualDate || (p.paidAt ? p.paidAt.slice(0, 10) : "");
    if (!inRange(accrual, i.from, i.to)) continue;
    const base = Math.max(0, Math.round(p.recognizedAmount) || 0);
    const shares = sharesOf(p);
    if (!shares.length) continue;

    // 率の合計が100%を超えていないか（止めはしないが必ず知らせる）
    const sum = shares.reduce((s, x) => s + x.direct + x.parent, 0);
    if (base > 0 && sum > base) {
      warnings.push(`決済 #${p.id}（${p.customerName || p.customerEmail || "顧客不明"}）の分配合計 ${sum.toLocaleString("ja-JP")}円 が計上額 ${base.toLocaleString("ja-JP")}円 を超えています`);
    }

    for (const s of shares) {
      if (s.direct > 0) {
        entries.push({
          uid: `sale:${p.id}:${s.rule.partnerId}:direct`,
          partnerId: s.rule.partnerId, ruleId: s.rule.id,
          kind: "sale", tierKind: "direct",
          sourceType: "payment", sourceId: p.id,
          accrualDate: accrual, baseAmount: base, amount: s.direct,
          note: p.customerName || p.customerEmail || "",
        });
      }
      if (s.parent > 0 && s.parentId != null) {
        entries.push({
          uid: `sale:${p.id}:${s.parentId}:parent`,
          partnerId: s.parentId, ruleId: s.rule.id,
          kind: "sale", tierKind: "parent",
          sourceType: "payment", sourceId: p.id,
          accrualDate: accrual, baseAmount: base, amount: s.parent,
          note: `${partnerName(s.rule.partnerId)} の紹介元`,
        });
      }
    }
  }

  // ── 返金（マイナス計上）──
  for (const r of i.refunds) {
    if (r.statusId == null || !i.refundDoneIds.has(r.statusId)) continue;   // 未完了の返金はまだ確定していない
    const done = r.refundedAt ? r.refundedAt.slice(0, 10) : "";
    if (!inRange(done, i.from, i.to)) continue;

    const amount = Math.max(0, Math.round(r.refundAmount) || 0);
    if (amount <= 0) continue;

    if (r.paymentId == null) {
      warnings.push(`返金 #${r.id}（${r.customerName || r.customerEmail || "顧客不明"}・${amount.toLocaleString("ja-JP")}円）に元決済が紐付いていないため、分配を戻せません`);
      continue;
    }
    const p = byId.get(r.paymentId);
    if (!p) {
      warnings.push(`返金 #${r.id} の元決済 #${r.paymentId} が見つかりません`);
      continue;
    }

    // 「返金額 ÷ 元決済の総額」の比率で戻す。全額返金なら 1.0
    const gross = Math.max(0, Math.round(p.amount) || 0);
    const ratio = gross > 0 ? Math.min(1, amount / gross) : 1;

    const shares = sharesOf(p);
    if (!shares.length) continue;

    for (const s of shares) {
      const push = (partnerId: number, tierKind: "direct" | "parent", paid: number, tag: string) => {
        if (paid <= 0) return;
        // 戻す額は「払った額 × 比率」。切り上げないので払った以上は戻さない
        const back = Math.min(paid, roundBy(paid * ratio, s.rule.rounding));
        if (back <= 0) return;
        entries.push({
          uid: `refund:${r.id}:${partnerId}:${tierKind}`,
          partnerId, ruleId: s.rule.id,
          kind: "refund", tierKind,
          sourceType: "refund", sourceId: r.id,
          accrualDate: done,
          baseAmount: -Math.round(Math.max(0, p.recognizedAmount) * ratio),
          amount: -back,
          note: `決済 #${p.id} の返金${ratio < 1 ? `（一部 ${Math.round(ratio * 100)}%）` : ""}${tag}`,
        });
      };
      push(s.rule.partnerId, "direct", s.direct, "");
      if (s.parentId != null) push(s.parentId, "parent", s.parent, "・紹介元分");
    }
  }

  return { entries, warnings };
}

// ── 集計 ──────────────────────────────────────────────────────
export interface PartnerTotal {
  partnerId: number;
  name: string;
  /** 売上ぶんの分配（正） */
  sale: number;
  /** 返金ぶんの戻し（負） */
  refund: number;
  /** 差引の支払額 */
  net: number;
  /** 2ティア報酬（net の内数） */
  parent: number;
  count: number;
}

export function totalizeByPartner(entries: ShareEntry[], partners: Partner[]): PartnerTotal[] {
  const m = new Map<number, PartnerTotal>();
  const nameOf = (id: number) => partners.find((p) => p.id === id)?.name ?? `不明(#${id})`;
  for (const e of entries) {
    let t = m.get(e.partnerId);
    if (!t) {
      t = { partnerId: e.partnerId, name: nameOf(e.partnerId), sale: 0, refund: 0, net: 0, parent: 0, count: 0 };
      m.set(e.partnerId, t);
    }
    if (e.kind === "sale") t.sale += e.amount; else t.refund += e.amount;
    if (e.tierKind === "parent") t.parent += e.amount;
    t.net += e.amount;
    t.count += 1;
  }
  return [...m.values()].sort((a, b) => b.net - a.net);
}

export interface ShareTotals {
  /** 按分ベースの合計（重複を除いた売上の計上額 − 返金分） */
  base: number;
  /** 分配額の合計 */
  share: number;
  /** 分配後に会社に残る額 */
  remain: number;
  partners: number;
  entries: number;
}

/**
 * 全体の合計。
 * ⚠️ ベースは**明細単位で重複を除く**。1つの売上を3人で分けたら
 *    エントリは3件でもベースは1件ぶん。ここを足し込むと基準額が3倍に見える。
 */
export function totalizeShare(entries: ShareEntry[]): ShareTotals {
  const seen = new Map<string, number>();
  let share = 0;
  const partners = new Set<number>();
  for (const e of entries) {
    seen.set(`${e.sourceType}:${e.sourceId}`, e.baseAmount);
    share += e.amount;
    partners.add(e.partnerId);
  }
  let base = 0;
  for (const v of seen.values()) base += v;
  return { base, share, remain: base - share, partners: partners.size, entries: entries.length };
}

/** 支払額がマイナスになったパートナー（返金が分配を上回った）*/
export function negativePartners(totals: PartnerTotal[]): PartnerTotal[] {
  return totals.filter((t) => t.net < 0);
}

// ── ルールの説明 ──────────────────────────────────────────────
export const TIER_LABEL: Record<ShareTier, string> = {
  first: "初回のみ", repeat: "2回目以降のみ", both: "初回・2回目以降とも",
};

export function describeRule(r: ShareRule, typeName?: string): string {
  const target = r.scope === "type" ? (typeName ?? `商品種別#${r.typeId}`) : "全商品";
  const how = r.calc === "fixed"
    ? `${(Math.round(r.fixedAmount) || 0).toLocaleString("ja-JP")}円`
    : `${r.rate}%`;
  const tier = r.tier === "both" ? "" : `・${TIER_LABEL[r.tier]}`;
  const parent = r.parentRate > 0 ? `・紹介元へ ${r.parentRate}%` : "";
  const term = r.validFrom || r.validTo ? `・${r.validFrom || "…"}〜${r.validTo || "…"}` : "";
  return `${target}：${how}${tier}${parent}${term}`;
}

// ── CSV ───────────────────────────────────────────────────────
const BOM = "﻿";
const cell = (v: string | number): string => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** パートナー別の集計（支払一覧として使う） */
export function toPartnerCsv(totals: PartnerTotal[]): string {
  const head = ["分配先", "売上ぶん", "返金の戻し", "差引支払額", "うち紹介元報酬", "件数"];
  const body = totals.map((t) => [t.name, t.sale, t.refund, t.net, t.parent, t.count].map(cell).join(","));
  return BOM + [head.join(","), ...body].join("\r\n");
}

/** パートナー向けの明細（開示用）。金額の根拠が追える形にする */
export function toEntryCsv(entries: ShareEntry[], partners: Partner[]): string {
  const nameOf = (id: number) => partners.find((p) => p.id === id)?.name ?? `不明(#${id})`;
  const head = ["計上日", "分配先", "区分", "種別", "対象", "按分ベース", "分配額", "備考"];
  const body = entries.map((e) => [
    e.accrualDate, nameOf(e.partnerId),
    e.kind === "sale" ? "売上" : "返金",
    e.tierKind === "parent" ? "紹介元報酬" : "分配",
    `${e.sourceType === "payment" ? "決済" : "返金"} #${e.sourceId}`,
    e.baseAmount, e.amount, e.note,
  ].map(cell).join(","));
  return BOM + [head.join(","), ...body].join("\r\n");
}

/** 期間文字列 "YYYY-MM" → 月初・月末 */
export function monthRange(period: string): { from: string; to: string } {
  const [ys, ms] = period.split("-");
  const y = Number(ys), m = Number(ms);
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return { from: "", to: "" };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}
