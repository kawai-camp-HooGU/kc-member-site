// ============================================================
// 入出金（着金・送金）の一括取込：解析と検証（純関数のみ）
//
//   決済サイトの入金明細CSVを取り込み、P3b の外部ID消込へそのまま流す。
//   ここが繋がると、月次の突合が「差額を確認してOKを押す」だけになる。
//
//   ＜2つの取込方式＞
//     ① 着金モード（1行＝1着金）
//        通帳CSV／payouts.csv。cash_entries を作るだけ。消込は画面で行う。
//     ② 入金内訳モード（1行＝1決済）
//        Stripe の入金内訳レポートなど。入金ID（po_…）でグループ化して
//        cash_entries を1件作り、各行の決済ID（ch_…）で**消込まで自動で作る**。
//
//   ⚠️ どちらのモードかは**画面で明示的に選ばせる**。列の有無から推測すると、
//      取り違えたときに「実着金額が1決済ぶんの入出金」が大量に出来てしまう。
//
//   ＜実着金額と差額＞
//     内訳モードでは「実着金額」列があればそれを使い、無ければ内訳の合計を実着金額とする。
//     後者は差額が必ず0になるため、**振込手数料が捕まらない**。その旨を警告に出す。
//     差額の区分提案は lib/cash.ts の suggestAdjustment をそのまま使う。
//
//   ⚠️ ここには DB アクセスも React も置かない。
// ============================================================
import { parseAmount, parseDate, sha256Hex } from "./plImport";
import {
  DEFAULT_TOLERANCE, allocKey, remainOf, suggestAdjustment,
  type AllocCandidate,
} from "./cash";
import type { CashAdjustment, CashEntry, PaymentMaster } from "./models";

/** 取込方式 */
export type CashImportMode = "entry" | "breakdown";

export const MODE_LABEL: Record<CashImportMode, string> = {
  entry: "1行＝1着金（通帳・入金一覧）",
  breakdown: "1行＝1決済（入金内訳）",
};

export const MODE_HINT: Record<CashImportMode, string> = {
  entry: "着金・送金をそのまま登録します。消込は「入金出金」タブで行います。",
  breakdown: "入金IDでまとめて着金1件にし、決済IDで消込まで自動で作ります。",
};

// ── 取り込み先の項目 ──────────────────────────────────────────
export type CashField =
  | "entryDate" | "direction" | "siteName" | "accountName"
  | "amount" | "description" | "externalPayoutId"
  | "externalTxnId" | "payoutAmount";

export interface CashFieldDef {
  key: CashField;
  label: string;
  required?: boolean;
  modes: CashImportMode[];
  hint?: string;
}

export const CASH_FIELDS: CashFieldDef[] = [
  { key: "entryDate",        label: "入出金日",     required: true, modes: ["entry", "breakdown"] },
  { key: "amount",           label: "金額",         required: true, modes: ["entry", "breakdown"],
    hint: "着金モードは実着金額、内訳モードは決済1件ぶんの金額" },
  { key: "externalPayoutId", label: "入金ID",       modes: ["entry", "breakdown"],
    hint: "内訳モードでは必須。この値でまとめて着金1件にする" },
  { key: "externalTxnId",    label: "決済ID",       required: true, modes: ["breakdown"],
    hint: "ch_… など。これで売上明細に消し込む" },
  { key: "payoutAmount",     label: "実着金額",     modes: ["breakdown"],
    hint: "各行に着金総額が入っている場合に指定。無ければ内訳の合計を使う" },
  { key: "direction",        label: "区分（入金/出金）", modes: ["entry"],
    hint: "未指定なら画面で選んだ区分を全行に使う" },
  { key: "siteName",         label: "経路（サイト）", modes: ["entry", "breakdown"] },
  { key: "accountName",      label: "口座",         modes: ["entry"] },
  { key: "description",      label: "摘要",         modes: ["entry", "breakdown"] },
];

export const CASH_FIELD_LABEL: Record<CashField, string> =
  CASH_FIELDS.reduce((a, f) => { a[f.key] = f.label; return a; }, {} as Record<CashField, string>);

export function cashFieldsFor(mode: CashImportMode): CashFieldDef[] {
  return CASH_FIELDS.filter((f) => f.modes.includes(mode));
}

export type CashColumnMap = (CashField | null)[];

const HINTS: { field: CashField; words: string[] }[] = [
  { field: "payoutAmount",     words: ["実着金額", "着金額", "入金総額", "payoutamount", "payoutgross", "payoutnet"] },
  { field: "externalPayoutId", words: ["入金id", "payoutid", "payout", "振込id", "送金id"] },
  { field: "externalTxnId",    words: ["決済id", "取引id", "chargeid", "transactionid", "balancetransaction", "sourceid"] },
  { field: "entryDate",        words: ["入出金日", "入金日", "出金日", "着金日", "取引日", "日付", "date", "arrival", "paidout"] },
  { field: "direction",        words: ["区分", "入出金区分", "種別", "direction", "type"] },
  { field: "siteName",         words: ["経路", "決済サイト", "サイト", "決済代行", "gateway", "channel"] },
  { field: "accountName",      words: ["口座", "銀行", "account", "bank"] },
  { field: "description",      words: ["摘要", "備考", "内容", "description", "memo", "note", "narrative"] },
  { field: "amount",           words: ["金額", "入金額", "出金額", "net", "amount", "gross", "額"] },
];

const norm = (s: string): string =>
  s.trim().toLowerCase().replace(/[\s　_\-.'"（）()［］[\]]/g, "");

export function autoMapCashColumns(header: string[], mode: CashImportMode): CashColumnMap {
  const allowed = new Set(cashFieldsFor(mode).map((f) => f.key));
  const used = new Set<CashField>();
  const map: CashColumnMap = header.map(() => null);

  header.forEach((h, i) => {
    const n = norm(h);
    const exact = CASH_FIELDS.find((f) => allowed.has(f.key) && norm(f.label) === n);
    if (exact && !used.has(exact.key)) { map[i] = exact.key; used.add(exact.key); }
  });
  header.forEach((h, i) => {
    if (map[i] != null) return;
    const n = norm(h);
    if (!n) return;
    for (const { field, words } of HINTS) {
      if (!allowed.has(field) || used.has(field)) continue;
      if (words.some((w) => n.includes(norm(w)))) { map[i] = field; used.add(field); return; }
    }
  });
  return map;
}

/** 内訳モードは入金IDが無いとグループ化できない（必須扱いにする） */
export function cashRequired(mode: CashImportMode): CashField[] {
  const base = cashFieldsFor(mode).filter((f) => f.required).map((f) => f.key);
  return mode === "breakdown" ? [...base, "externalPayoutId"] : base;
}

export function hasRequiredCashMapping(map: CashColumnMap, mode: CashImportMode): boolean {
  return cashRequired(mode).every((k) => map.includes(k));
}

export function missingCashRequired(map: CashColumnMap, mode: CashImportMode): string[] {
  return cashRequired(mode).filter((k) => !map.includes(k)).map((k) => CASH_FIELD_LABEL[k]);
}

// ── 判定結果 ──────────────────────────────────────────────────
export type CashVerdict = "ok" | "dup_payout" | "dup_file" | "error";

export const CASH_VERDICT_LABEL: Record<CashVerdict, string> = {
  ok: "取込", dup_payout: "重複", dup_file: "重複", error: "エラー",
};

/** 消込1件ぶん（内訳モード） */
export interface PlannedAlloc {
  /** 元のファイル行番号（1始まり） */
  rowNo: number;
  externalTxnId: string;
  /** 引き当てた売上・経費（見つからなければ null） */
  sourceType: "payment" | "expense" | null;
  sourceId: number | null;
  amount: number;
  reason: string;
}

/** 取り込む入出金1件 */
export interface CashImportGroup {
  /** 表示用の連番（1始まり） */
  no: number;
  /** もとになったファイル行の番号 */
  rowNos: number[];
  verdict: CashVerdict;
  reasons: string[];
  /** 重複を「やはり取り込む」に変えられるか */
  canOverride: boolean;
  override: boolean;
  /** 重複相手の既存 cash_entries.id */
  existingId: number | null;
  dedupHash: string;
  entry: CashEntry;
  /** 内訳モードで作る消込 */
  allocations: PlannedAlloc[];
  /** 充当額の合計 − 実着金額 */
  diff: number;
  /** 差額から提案した調整（1件） */
  adjustment: CashAdjustment | null;
  /** 差額を自動で確定してよいか。false は人の確認が要る */
  autoAdjust: boolean;
  adjustReason: string;
}

export const willImportCash = (g: CashImportGroup): boolean =>
  g.verdict === "ok" || (g.verdict !== "error" && g.canOverride && g.override);

// ── 検証 ──────────────────────────────────────────────────────
export interface CashValidateInput {
  mode: CashImportMode;
  dataRows: string[][];
  map: CashColumnMap;
  /** 画面で選んだ既定の区分（direction 列が無いとき全行に使う） */
  defaultDirection: "in" | "out";
  sites: PaymentMaster[];
  /** 既定の経路。siteName 列が無いときに使う */
  defaultSiteId: number | null;
  /** 既存の入金ID → cash_entries.id */
  existingPayouts?: ReadonlyMap<string, number>;
  /** 既存の入出金の自然キー → cash_entries.id */
  existingKeys?: ReadonlyMap<string, number>;
  /** 消込の相手候補（lib/cash.ts の buildCandidates）*/
  candidates?: AllocCandidate[];
  tolerance?: number;
}

/** キーの区切り。値に現れない制御文字を使う（区切り無しだと別の入出金が同じキーになる）*/
const SEP = "\u001f";
const emptyEntry = (direction: "in" | "out"): CashEntry => ({
  id: 0, direction, entryDate: "", siteId: null, accountName: "",
  amount: 0, description: "", adjustments: [], externalPayoutId: "",
  createdAt: "", allocations: [],
});

/** 「入金」「出金」「in」「out」「+」「-」を区分に寄せる */
function parseDirection(raw: string, fallback: "in" | "out"): "in" | "out" {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (/(出金|支払|送金|out|debit|withdraw|払出)/.test(s)) return "out";
  if (/(入金|着金|受取|in|credit|deposit|振込)/.test(s)) return "in";
  return fallback;
}

/**
 * ファイルを「取り込む入出金の集合」に変換する。**DBには一切書かない。**
 *
 * 内訳モードでは入金IDでグループ化し、各行の決済IDで消込候補を引き当てる。
 * 引き当てられなかった行は、その理由を残したまま**取込対象から外す**
 * （黙って0円で消し込むと、あとから差額の原因が追えなくなる）。
 */
export async function validateCashRows(i: CashValidateInput): Promise<CashImportGroup[]> {
  const tolerance = i.tolerance ?? DEFAULT_TOLERANCE;
  const siteIdx = new Map(
    i.sites.filter((s) => !s.isDeleted).map((s) => [norm(s.name), s.id]),
  );
  const siteById = new Map(i.sites.map((s) => [s.id, s]));

  const col = {} as Record<CashField, number>;
  i.map.forEach((f, idx) => { if (f != null && col[f] === undefined) col[f] = idx; });
  const pick = (row: string[], f: CashField): string => {
    const idx = col[f];
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };
  const mapped = (f: CashField): boolean => col[f] !== undefined;

  /** 決済ID → 候補 */
  const byTxn = new Map<string, AllocCandidate>();
  for (const c of i.candidates ?? []) {
    const t = (c.externalTxnId ?? "").trim();
    if (t && !byTxn.has(t)) byTxn.set(t, c);
  }
  /** このファイル内で既に充当した額（同じ決済を2度消し込まない） */
  const usedInFile = new Map<string, number>();

  const groups: CashImportGroup[] = [];
  const seenPayout = new Map<string, number>();
  const seenKey = new Map<string, number>();

  // ── 行 → 素の入出金へ ──
  interface Raw {
    rowNo: number;
    entry: CashEntry;
    reasons: string[];
    txnId: string;
    payoutAmount: number | null;
    rowAmount: number;
  }
  const raws: Raw[] = [];

  for (let n = 0; n < i.dataRows.length; n += 1) {
    const row = i.dataRows[n];
    const reasons: string[] = [];

    const dateRaw = pick(row, "entryDate");
    const entryDate = parseDate(dateRaw);
    if (!entryDate) reasons.push(dateRaw ? `入出金日の形式が読めません（${dateRaw}）` : "入出金日が空です");

    const amtRaw = pick(row, "amount");
    const amt = parseAmount(amtRaw);
    if (amt == null) reasons.push(amtRaw ? `金額が数値として読めません（${amtRaw}）` : "金額が空です");
    else if (amt === 0) reasons.push("金額が0円です");

    // 出金がマイナス表記のファイルもある。符号で区分を決め、金額は絶対値で持つ
    let direction = parseDirection(pick(row, "direction"), i.defaultDirection);
    if (!mapped("direction") && amt != null && amt < 0) direction = "out";
    const amount = Math.abs(amt ?? 0);

    let siteId = i.defaultSiteId;
    const siteRaw = pick(row, "siteName");
    if (siteRaw) {
      const hit = siteIdx.get(norm(siteRaw));
      if (hit === undefined) reasons.push(`経路「${siteRaw}」がマスタに存在しません`);
      else siteId = hit;
    }

    const txnId = pick(row, "externalTxnId");
    if (i.mode === "breakdown" && !txnId) reasons.push("決済IDが空です（消し込む相手を特定できません）");

    const payoutId = pick(row, "externalPayoutId");
    if (i.mode === "breakdown" && !payoutId) reasons.push("入金IDが空です（着金にまとめられません）");

    const pa = mapped("payoutAmount") ? parseAmount(pick(row, "payoutAmount")) : null;

    raws.push({
      rowNo: n + 1,
      entry: {
        ...emptyEntry(direction),
        entryDate, siteId, amount,
        accountName: pick(row, "accountName"),
        description: pick(row, "description"),
        externalPayoutId: payoutId,
      },
      reasons, txnId,
      payoutAmount: pa == null ? null : Math.abs(pa),
      rowAmount: amount,
    });
  }

  // ── 着金モード：1行＝1件 ──
  const finish = async (g: Omit<CashImportGroup, "dedupHash" | "diff" | "adjustment" | "autoAdjust" | "adjustReason">): Promise<CashImportGroup> => {
    const e = g.entry;
    const key = [e.direction, e.entryDate, String(e.siteId ?? ""), String(e.amount), e.description.trim().toLowerCase()].join(SEP);
    const dedupHash = await sha256Hex(key);

    const allocated = g.allocations.reduce((s, a) => s + (a.sourceId != null ? a.amount : 0), 0);
    const diff = g.allocations.length ? allocated - e.amount : 0;
    const site = e.siteId != null ? siteById.get(e.siteId)?.site : undefined;
    const sug = diff === 0
      ? { adjustment: null, auto: true, reason: "差額はありません" }
      : suggestAdjustment(diff, site ? { transferFee: site.transferFee } : null, tolerance);

    return {
      ...g, dedupHash, diff,
      adjustment: sug.adjustment, autoAdjust: sug.auto, adjustReason: sug.reason,
    };
  };

  const judge = (g: CashImportGroup): CashImportGroup => {
    if (g.reasons.length && g.verdict === "error") return g;
    const pid = g.entry.externalPayoutId.trim();

    if (pid) {
      const ex = i.existingPayouts?.get(pid);
      if (ex !== undefined) {
        return { ...g, verdict: "dup_payout", existingId: ex, canOverride: false,
          reasons: [...g.reasons, `入金ID「${pid}」は既に登録済みです（入出金 #${ex}）`] };
      }
      const inFile = seenPayout.get(pid);
      if (inFile !== undefined) {
        return { ...g, verdict: "dup_payout", canOverride: false,
          reasons: [...g.reasons, `入金ID「${pid}」がこのファイルの ${inFile} 件目と重複しています`] };
      }
      seenPayout.set(pid, g.no);
    }

    const exKey = i.existingKeys?.get(g.dedupHash);
    if (exKey !== undefined) {
      return { ...g, verdict: "dup_file", existingId: exKey, canOverride: true,
        reasons: [...g.reasons, `日付・区分・経路・金額・摘要が既存データ（入出金 #${exKey}）と一致します`] };
    }
    const inFileKey = seenKey.get(g.dedupHash);
    if (inFileKey !== undefined) {
      return { ...g, verdict: "dup_file", canOverride: true,
        reasons: [...g.reasons, `このファイルの ${inFileKey} 件目と内容が同じです`] };
    }
    seenKey.set(g.dedupHash, g.no);
    return g;
  };

  if (i.mode === "entry") {
    for (const r of raws) {
      const base = await finish({
        no: groups.length + 1, rowNos: [r.rowNo],
        verdict: r.reasons.length ? "error" : "ok",
        reasons: r.reasons, canOverride: false, override: false, existingId: null,
        entry: r.entry, allocations: [],
      });
      groups.push(judge(base));
    }
    return groups;
  }

  // ── 内訳モード：入金IDでまとめる ──
  const order: string[] = [];
  const byPayout = new Map<string, Raw[]>();
  for (const r of raws) {
    const pid = r.entry.externalPayoutId || `__row${r.rowNo}`;
    const arr = byPayout.get(pid);
    if (arr) arr.push(r); else { byPayout.set(pid, [r]); order.push(pid); }
  }

  for (const pid of order) {
    const rows = byPayout.get(pid) ?? [];
    const reasons: string[] = [];
    // 行ごとのエラーは、どの行かが分かる形でまとめる
    for (const r of rows) for (const m of r.reasons) reasons.push(`${r.rowNo}行目：${m}`);

    const head = rows[0];
    const allocations: PlannedAlloc[] = [];

    for (const r of rows) {
      const txn = r.txnId.trim();
      const cand = txn ? byTxn.get(txn) : undefined;
      if (!cand) {
        allocations.push({
          rowNo: r.rowNo, externalTxnId: txn, sourceType: null, sourceId: null,
          amount: 0,
          reason: txn ? `決済ID「${txn}」に一致する売上・経費が見つかりません` : "決済IDが空です",
        });
        continue;
      }
      const k = allocKey(cand.sourceType === "expense" ? "expense" : "payment", cand.sourceId);
      const already = usedInFile.get(k) ?? 0;
      const remain = Math.max(0, remainOf(cand) - already);
      if (remain <= 0) {
        allocations.push({
          rowNo: r.rowNo, externalTxnId: txn,
          sourceType: cand.sourceType === "expense" ? "expense" : "payment",
          sourceId: cand.sourceId, amount: 0,
          reason: `決済ID「${txn}」は既に全額消込済みです`,
        });
        continue;
      }
      // ファイルの金額を優先しつつ、残額は超えさせない
      const want = r.rowAmount > 0 ? r.rowAmount : remain;
      const amount = Math.min(want, remain);
      usedInFile.set(k, already + amount);
      allocations.push({
        rowNo: r.rowNo, externalTxnId: txn,
        sourceType: cand.sourceType === "expense" ? "expense" : "payment",
        sourceId: cand.sourceId, amount,
        reason: amount < want ? `残額 ${remain.toLocaleString("ja-JP")}円 まで充当しました` : "",
      });
    }

    const matched = allocations.filter((a) => a.sourceId != null && a.amount > 0);
    const unmatched = allocations.filter((a) => a.sourceId == null || a.amount <= 0);
    for (const u of unmatched) reasons.push(`${u.rowNo}行目：${u.reason}`);

    // 実着金額：列があればそれ、無ければ内訳の合計
    const declared = rows.map((r) => r.payoutAmount).find((v) => v != null) ?? null;
    const sum = matched.reduce((s, a) => s + a.amount, 0);
    const amount = declared ?? sum;
    const noDeclared = declared == null;

    const entry: CashEntry = {
      ...head.entry,
      amount,
      externalPayoutId: pid.startsWith("__row") ? "" : pid,
      description: head.entry.description || `入金 ${pid.startsWith("__row") ? "" : pid}`.trim(),
    };

    const hardError = !entry.entryDate || amount <= 0 || matched.length === 0;
    if (matched.length === 0) reasons.push("消し込める明細が1件も見つかりませんでした");

    let g = await finish({
      no: groups.length + 1,
      rowNos: rows.map((r) => r.rowNo),
      verdict: hardError ? "error" : "ok",
      reasons, canOverride: false, override: false, existingId: null,
      entry, allocations,
    });
    if (noDeclared && !hardError) {
      g = {
        ...g,
        reasons: [...g.reasons,
          "実着金額の列が無いため、内訳の合計を実着金額としています。振込手数料は差額として出ません"],
      };
    }
    groups.push(judge(g));
  }

  return groups;
}

// ── 集計 ──────────────────────────────────────────────────────
export interface CashImportSummary {
  total: number;
  ok: number;
  dup: number;
  error: number;
  /** 取り込む入出金の金額合計 */
  amount: number;
  /** 作られる消込の件数 */
  allocations: number;
  /** 人の確認が要る差額の件数 */
  needsReview: number;
}

export function summarizeCash(groups: CashImportGroup[]): CashImportSummary {
  let ok = 0, dup = 0, error = 0, amount = 0, allocations = 0, needsReview = 0;
  for (const g of groups) {
    if (g.verdict === "error") error += 1;
    else if (willImportCash(g)) ok += 1;
    else dup += 1;
    if (!willImportCash(g)) continue;
    amount += g.entry.amount;
    allocations += g.allocations.filter((a) => a.sourceId != null && a.amount > 0).length;
    if (g.diff !== 0 && !g.autoAdjust) needsReview += 1;
  }
  return { total: groups.length, ok, dup, error, amount, allocations, needsReview };
}
