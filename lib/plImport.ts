// ============================================================
// 売上・経費の一括取込：解析と検証（純関数のみ）
//
//   設計書 §6。ファイル → 列マッピング → 検証・重複判定 → プレビュー、までを担う。
//   実際の書き込みは lib/plImportRun.ts。
//
//   ＜CSVの基本処理は流用する＞
//   文字コード判定・区切り推定・CSVパース・失敗CSV生成は、リスト取込の
//   lib/listImportParse.ts をそのまま使う。同じ処理を2つ持つと必ず片方だけ直される。
//
//   ＜MD（Markdown表）＞
//   「パイプ区切りのCSV」として同じ経路に載せる（設計書 §6-4）。専用の実装は持たない。
//
//   ＜重複判定は4段階＞
//     ① 外部取引ID一致    … 強制スキップ。決済サイト発番の一意IDで誤検知が起きない
//     ② 自然キー一致      … 警告。行ごとに「取り込む」へ変更できる
//     ③ ファイル内重複    … 警告。CSV作成時のコピペミス検出
//     ④ 同一ファイル再取込 … 呼び出し側でファイルハッシュを照合する
//
//   ⚠️ 要件の「メアド・商品・決済サイト」だけを自然キーにすると、月額課金が
//      2回目以降すべて重複になる。決済日時と金額を必ず含めること（設計書 §6-2）。
//
//   ⚠️ ここには DB アクセスも React も置かない。
// ============================================================
import { normalizeEmail } from "./emailNormalize";
import { DEFAULT_SITE_CONFIG, calcExpectedDate, calcFee } from "./paymentSites";
import type { ExpenseCategory, PaymentMaster } from "./models";

export type ImportTarget = "sales" | "expense";

export const TARGET_LABEL: Record<ImportTarget, string> = {
  sales: "売上", expense: "経費",
};

// ── 取り込み先の項目 ──────────────────────────────────────────
export type PlField =
  // 共通
  | "paidAt" | "accrualDate" | "expectedDate"
  | "amount" | "feeAmount" | "recognizedAmount"
  | "siteName" | "methodName" | "note" | "externalSource" | "externalTxnId"
  // 売上
  | "email" | "customerName" | "customerKana" | "customerTel" | "typeName"
  // 経費
  | "vendorName" | "categoryName" | "invoiceNo";

export interface PlFieldDef {
  key: PlField;
  label: string;
  required?: boolean;
  targets: ImportTarget[];
}

/** 列マッピングのプルダウンに出す項目（並び順もこのとおり） */
export const PL_FIELDS: PlFieldDef[] = [
  { key: "paidAt",           label: "決済日時・支払日時", required: true, targets: ["sales", "expense"] },
  { key: "email",            label: "メールアドレス",     required: true, targets: ["sales"] },
  { key: "customerName",     label: "顧客氏名",                           targets: ["sales"] },
  { key: "customerKana",     label: "顧客カナ",                           targets: ["sales"] },
  { key: "customerTel",      label: "顧客電話番号",                       targets: ["sales"] },
  { key: "typeName",         label: "商品種別",                           targets: ["sales"] },
  { key: "vendorName",       label: "支払先",             required: true, targets: ["expense"] },
  { key: "categoryName",     label: "経費科目",                           targets: ["expense"] },
  { key: "invoiceNo",        label: "インボイス登録番号",                 targets: ["expense"] },
  { key: "siteName",         label: "決済・支払サイト",                   targets: ["sales", "expense"] },
  { key: "methodName",       label: "決済・支払方法",                     targets: ["sales", "expense"] },
  { key: "amount",           label: "総額",               required: true, targets: ["sales", "expense"] },
  { key: "feeAmount",        label: "手数料",                             targets: ["sales", "expense"] },
  { key: "recognizedAmount", label: "計上金額",                           targets: ["sales", "expense"] },
  { key: "accrualDate",      label: "計上日",                             targets: ["sales", "expense"] },
  { key: "expectedDate",     label: "入出金予定日",                       targets: ["sales", "expense"] },
  { key: "externalSource",   label: "取得元",                             targets: ["sales", "expense"] },
  { key: "externalTxnId",    label: "外部取引ID",                         targets: ["sales", "expense"] },
  { key: "note",             label: "備考",                               targets: ["sales", "expense"] },
];

export const PL_FIELD_LABEL: Record<PlField, string> =
  PL_FIELDS.reduce((a, f) => { a[f.key] = f.label; return a; }, {} as Record<PlField, string>);

export function fieldsFor(target: ImportTarget): PlFieldDef[] {
  return PL_FIELDS.filter((f) => f.targets.includes(target));
}

/** 列マッピング。配列の添字＝ファイルの列番号、値＝取り込み先（null＝取り込まない） */
export type PlColumnMap = (PlField | null)[];

// ヘッダ名から項目を推定するための手がかり（小文字化・記号除去して部分一致）
const HINTS: { field: PlField; words: string[] }[] = [
  // ⚠️ 「計上日」を「決済日」より先に置く。"日" を含む語の取り合いを避ける。
  { field: "accrualDate",      words: ["計上日", "売上計上日", "経費計上日", "accrualdate"] },
  { field: "expectedDate",     words: ["入金予定日", "出金予定日", "入出金予定日", "支払予定日", "payoutdate", "expecteddate"] },
  { field: "paidAt",           words: ["決済日時", "決済日", "支払日時", "支払日", "取引日", "created", "createdutc", "date", "日時"] },
  { field: "email",            words: ["mail", "メール", "メルアド", "customeremail", "アドレス"] },
  { field: "customerKana",     words: ["カナ", "かな", "フリガナ", "ふりがな", "kana"] },
  { field: "customerTel",      words: ["電話", "tel", "phone", "携帯"] },
  { field: "customerName",     words: ["顧客名", "顧客氏名", "氏名", "名前", "お名前", "customername", "name"] },
  { field: "typeName",         words: ["商品種別", "商品", "講座", "プラン", "product", "item", "種別"] },
  { field: "vendorName",       words: ["支払先", "取引先", "仕入先", "業者", "vendor", "payee", "supplier"] },
  { field: "categoryName",     words: ["経費科目", "科目", "勘定科目", "category", "費目"] },
  { field: "invoiceNo",        words: ["インボイス", "登録番号", "適格請求書", "invoiceno"] },
  { field: "siteName",         words: ["決済サイト", "支払サイト", "サイト", "決済代行", "gateway", "channel"] },
  { field: "methodName",       words: ["決済方法", "支払方法", "支払手段", "method", "paymentmethod", "決済手段"] },
  { field: "feeAmount",        words: ["手数料", "決済手数料", "支払手数料", "fee", "charge"] },
  { field: "recognizedAmount", words: ["計上金額", "計上額", "純額", "net", "差引"] },
  // ⚠️ 「総額」系は手数料・計上額より後ろ。"金額" が先に当たると fee を奪う。
  { field: "amount",           words: ["総額", "決済金額", "支払金額", "請求金額", "gross", "amount", "金額", "税込"] },
  { field: "externalSource",   words: ["取得元", "ソース", "source", "provider"] },
  { field: "externalTxnId",    words: ["外部取引id", "取引id", "決済id", "chargeid", "transactionid", "txnid", "id"] },
  { field: "note",             words: ["備考", "メモ", "摘要", "note", "memo", "description", "remarks"] },
];

const norm = (s: string): string =>
  s.trim().toLowerCase().replace(/[\s　_\-.'"（）()［］[\]]/g, "");

/**
 * ヘッダ行から列を自動推定する。
 * 同じ項目に複数列が当たった場合は最初の列だけ採用する（残りは「取り込まない」）。
 */
export function autoMapPlColumns(header: string[], target: ImportTarget): PlColumnMap {
  const allowed = new Set(fieldsFor(target).map((f) => f.key));
  const used = new Set<PlField>();
  const map: PlColumnMap = header.map(() => null);

  // 完全一致を優先し、その後に部分一致で埋める
  header.forEach((h, i) => {
    const n = norm(h);
    const exact = PL_FIELDS.find((f) => allowed.has(f.key) && norm(f.label) === n);
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

/** 必須項目がすべて対応づけ済みか（未対応づけなら次へ進めない） */
export function hasRequiredPlMapping(map: PlColumnMap, target: ImportTarget): boolean {
  return fieldsFor(target).filter((f) => f.required).every((f) => map.includes(f.key));
}

/** 未対応づけの必須項目（画面に「あと何が要るか」を出すため） */
export function missingRequired(map: PlColumnMap, target: ImportTarget): string[] {
  return fieldsFor(target).filter((f) => f.required && !map.includes(f.key)).map((f) => f.label);
}

// ── Markdown 表 ───────────────────────────────────────────────
export interface MdTable {
  /** 表の直前の見出し・キャプション（無ければ ""） */
  caption: string;
  /** ヘッダ行を含む全行 */
  rows: string[][];
  /** セル内に | が含まれていた可能性（誤分割の警告用） */
  hasEscapedPipe: boolean;
}

const isSeparatorRow = (cells: string[]): boolean =>
  cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));

/**
 * Markdown 中の表をすべて取り出す。
 *
 * ⚠️ セル内の `\|`（エスケープしたパイプ）は誤分割の原因になる。
 *    ここでは一旦プレースホルダに退避して分割し、戻したうえで
 *    hasEscapedPipe を立てて画面に警告を出させる（設計書 §6-4）。
 */
export function parseMarkdownTables(text: string): MdTable[] {
  // 値に現れない制御文字を退避先にする。エスケープで書く（直接埋めるとソースがバイナリ扱いになる）
  const PH = "\u0000PIPE\u0000";
  const lines = text.split(/\r?\n/);
  const out: MdTable[] = [];

  let cur: string[][] | null = null;
  let caption = "";
  let lastText = "";
  let escaped = false;

  const flush = () => {
    if (cur && cur.length >= 2 && isSeparatorRow(cur[1])) {
      out.push({ caption, rows: [cur[0], ...cur.slice(2)], hasEscapedPipe: escaped });
    }
    cur = null; escaped = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.includes("|")) {
      if (!cur) { cur = []; caption = lastText; }
      if (line.includes("\\|")) escaped = true;
      const body = line.replace(/\\\|/g, PH).replace(/^\|/, "").replace(/\|$/, "");
      cur.push(body.split("|").map((c) => c.replace(new RegExp(PH, "g"), "|").trim()));
      continue;
    }
    flush();
    if (line) lastText = line.replace(/^#+\s*/, "");
  }
  flush();
  return out;
}

// ── 値の変換 ──────────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
/** この製品は日本時間で運用する。タイムゾーン付きの値はここへ寄せる */
const JST_MIN = 9 * 60;

const DT_RE = /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(Z|z|[+-]\d{1,2}:?\d{2})?$/;

/**
 * 日時を "YYYY-MM-DDTHH:mm" にする。読めなければ ""。
 *
 * ⚠️ タイムゾーンが明示されている値（Stripe の `2026-08-17T05:32:11Z` など）は
 *    日本時間へ直す。ここを素通しすると、深夜・early morning の決済が
 *    前日の売上として計上され、月初月末で月がまるごとズレる。
 *    タイムゾーンが無い値は日本時間とみなす。
 */
export function parseDateTime(raw: string): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const m = DT_RE.exec(s);
  if (!m) return "";
  const [, ys, ms, ds, hs, mins, , tz] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const h = hs === undefined ? 0 : Number(hs);
  const mi = mins === undefined ? 0 : Number(mins);
  if (h > 23 || mi > 59) return "";

  if (!tz) return `${y}-${pad2(mo)}-${pad2(d)}T${pad2(h)}:${pad2(mi)}`;

  // 明示タイムゾーン → JST へ
  let offMin = 0;
  if (tz !== "Z" && tz !== "z") {
    const sign = tz[0] === "-" ? -1 : 1;
    const body = tz.slice(1).replace(":", "");
    offMin = sign * (Number(body.slice(0, body.length - 2)) * 60 + Number(body.slice(-2)));
  }
  const ms2 = Date.UTC(y, mo - 1, d, h, mi) - offMin * 60000 + JST_MIN * 60000;
  const t = new Date(ms2);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`
    + `T${pad2(t.getUTCHours())}:${pad2(t.getUTCMinutes())}`;
}

/** 日付を "YYYY-MM-DD" にする。読めなければ "" */
export function parseDate(raw: string): string {
  const dt = parseDateTime(raw);
  return dt ? dt.slice(0, 10) : "";
}

/**
 * 金額を整数（円）にする。読めなければ null。
 * "¥165,000" / "165,000円" / "△1,980" / "(1,980)" / "-1980" / "1980.00" を受ける。
 */
export function parseAmount(raw: string): number | null {
  let s = (raw ?? "").trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (/^[-−▲△]/.test(s)) { neg = true; s = s.slice(1); }
  // 全角数字を半角へ
  s = s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  s = s.replace(/[¥￥,、\s　]/g, "").replace(/円$/, "");
  if (!s || !/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s));
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ── 重複判定用のハッシュ ──────────────────────────────────────
//   crypto.subtle が使える環境（https / localhost / Node18+）では SHA-256。
//   使えない環境では非暗号ハッシュへ落ちるが、**接頭辞で区別する**ので
//   別方式のハッシュ同士が偶然一致して誤って重複扱いになることはない。
const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

const subtle = (): SubtleCrypto | null => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  return c && c.subtle ? c.subtle : null;
};

/** 現在使えるハッシュ方式（画面に出して、環境差を隠さない） */
export const hashAlgo = (): "sha-256" | "fallback" => (subtle() ? "sha-256" : "fallback");

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `f1:${h.toString(16).padStart(8, "0")}:${s.length.toString(16)}`;
}

export async function sha256Hex(s: string): Promise<string> {
  const sub = subtle();
  if (!sub) return fnv1a(s);
  return `s2:${hex(await sub.digest("SHA-256", new TextEncoder().encode(s)))}`;
}

export async function fileHash(bytes: Uint8Array): Promise<string> {
  const sub = subtle();
  if (!sub) return fnv1a(`len${bytes.length}`);
  const copy = new Uint8Array(bytes);
  return `s2:${hex(await sub.digest("SHA-256", copy.buffer as ArrayBuffer))}`;
}

// ── 行の値 ────────────────────────────────────────────────────
export interface PlRowValue {
  paidAt: string;
  accrualDate: string;
  expectedDate: string;
  email: string;
  emailNorm: string | null;
  customerName: string;
  customerKana: string;
  customerTel: string;
  vendorName: string;
  invoiceNo: string;
  typeId: number | null;
  categoryId: number | null;
  siteId: number | null;
  methodId: number | null;
  memberId: number | null;
  amount: number;
  feeAmount: number;
  recognizedAmount: number;
  note: string;
  externalSource: string;
  externalTxnId: string;
}

export type PlVerdict = "ok" | "dup_ext" | "dup_key" | "dup_file" | "error";

export const VERDICT_LABEL: Record<PlVerdict, string> = {
  ok: "取込", dup_ext: "重複", dup_key: "重複", dup_file: "重複", error: "エラー",
};

export interface PlImportRow {
  /** 1始まりの行番号（ヘッダを除いたデータ行の番号） */
  no: number;
  /** 元の行（失敗CSVに戻すため保持する） */
  raw: string[];
  verdict: PlVerdict;
  /** 画面と失敗CSVに出す理由。複数出る */
  reasons: string[];
  /** 重複を「やっぱり取り込む」に変えられるか。外部ID一致は変更不可 */
  canOverride: boolean;
  /** ユーザーが「取り込む」に変えたか */
  override: boolean;
  /** 重複相手の既存レコードID */
  existingId: number | null;
  dedupHash: string;
  value: PlRowValue;
}

/** この行を実際に書き込むか */
export const willImport = (r: PlImportRow): boolean =>
  r.verdict === "ok" || (r.verdict !== "error" && r.canOverride && r.override);

// ── 自然キー ──────────────────────────────────────────────────
/**
 * 自然キーの文字列を作る（SHA-256 にかける前の素材）。
 *
 * ⚠️ 決済日時は**分まで**。秒まで含めると、同じ取引が別ファイルで
 *    秒が丸められていた場合に別物と判定されてしまう。
 * ⚠️ 金額を含めるのは、要件の3項目（メール・商品・サイト）だけだと
 *    月額課金の2回目以降が全部重複になるため（設計書 §6-2）。
 */
/**
 * キーの区切り。値に現れない制御文字（US: Unit Separator）を使う。
 * 区切り無しで連結すると ("ab","c") と ("a","bc") が同じキーになり、
 * 別の取引が重複と判定されてしまう。
 */
const SEP = "\u001f";

export function naturalKey(target: ImportTarget, v: PlRowValue): string {
  const parts = target === "sales"
    ? ["sales", v.paidAt, v.emailNorm ?? v.email.trim().toLowerCase(), String(v.typeId ?? ""), String(v.siteId ?? ""), String(v.amount)]
    : ["expense", v.paidAt, v.vendorName.trim().toLowerCase(), String(v.categoryId ?? ""), String(v.siteId ?? ""), String(v.amount)];
  return parts.join(SEP);
}

/** 外部取引IDのキー。取得元が空でも決済IDだけで一意とみなす */
export const extKey = (source: string, txnId: string): string =>
  `${(source ?? "").trim().toLowerCase()}${SEP}${(txnId ?? "").trim()}`;

// ── 検証 ──────────────────────────────────────────────────────
export interface PlMasters {
  types: PaymentMaster[];
  sites: PaymentMaster[];
  methods: PaymentMaster[];
  categories: ExpenseCategory[];
}

export interface ValidateInput {
  target: ImportTarget;
  dataRows: string[][];
  map: PlColumnMap;
  masters: PlMasters;
  /** 既存の外部取引ID → レコードID */
  existingExt?: ReadonlyMap<string, number>;
  /** 既存の dedup_hash → レコードID */
  existingKey?: ReadonlyMap<string, number>;
  /** 正規化メール → 会員ID（売上の会員照合） */
  members?: ReadonlyMap<string, number>;
  /** サイト設定から予定日・手数料を自動計算するか（既定 true） */
  autoCalc?: boolean;
  holidays?: ReadonlySet<string>;
}

const nameIndex = (list: { id: number; name: string }[]): Map<string, number> => {
  const m = new Map<string, number>();
  for (const x of list) {
    const k = norm(x.name);
    if (k && !m.has(k)) m.set(k, x.id);
  }
  return m;
};

/**
 * データ行を検証し、重複判定まで済ませる。**DBには一切書かない。**
 *
 * 判定の優先順位は 外部ID > 自然キー（既存） > ファイル内重複。
 * エラーは重複判定より強く、エラー行は取込対象から必ず外れる。
 */
export async function validateRows(i: ValidateInput): Promise<PlImportRow[]> {
  const { target, dataRows, map, masters } = i;
  const autoCalc = i.autoCalc !== false;

  const typeIdx = nameIndex(masters.types.filter((t) => !t.isDeleted));
  const siteIdx = nameIndex(masters.sites.filter((s) => !s.isDeleted));
  const methodIdx = nameIndex(masters.methods.filter((m) => !m.isDeleted));
  const catIdx = nameIndex(masters.categories.filter((c) => !c.isDeleted));
  const siteById = new Map(masters.sites.map((s) => [s.id, s]));

  // 列番号の索引（同じ項目に複数列が当たっていたら最初の列）
  const col = {} as Record<PlField, number>;
  map.forEach((f, idx) => { if (f != null && col[f] === undefined) col[f] = idx; });
  const pick = (row: string[], f: PlField): string => {
    const idx = col[f];
    return idx === undefined ? "" : (row[idx] ?? "").trim();
  };
  const mapped = (f: PlField): boolean => col[f] !== undefined;

  const seenKey = new Map<string, number>();   // ファイル内重複：自然キー → 先に出た行番号
  const seenExt = new Map<string, number>();
  const out: PlImportRow[] = [];

  for (let n = 0; n < dataRows.length; n += 1) {
    const row = dataRows[n];
    const reasons: string[] = [];

    // ── 値の変換 ──
    const paidRaw = pick(row, "paidAt");
    const paidAt = parseDateTime(paidRaw);
    if (!paidAt) {
      reasons.push(paidRaw
        ? `決済日時の形式が読めません（${paidRaw}）`
        : "決済日時が空です");
    }

    const email = pick(row, "email");
    const emailNorm = normalizeEmail(email);
    if (target === "sales") {
      if (!email) reasons.push("メールアドレスが空です（顧客を特定できません）");
      else if (!emailNorm) reasons.push(`メールアドレスの形式が不正です（${email}）`);
    }

    const vendorName = pick(row, "vendorName");
    if (target === "expense" && !vendorName) reasons.push("支払先が空です");

    const amountRaw = pick(row, "amount");
    const amountParsed = parseAmount(amountRaw);
    if (amountParsed == null) {
      reasons.push(amountRaw ? `総額が数値として読めません（${amountRaw}）` : "総額が空です");
    } else if (amountParsed <= 0) {
      reasons.push(`総額が0円以下です（${amountRaw}）`);
    }
    const amount = Math.max(0, amountParsed ?? 0);

    // マスタ照合。存在しない名称はエラーにして、画面から追加・読み替えできるようにする
    const resolve = (f: PlField, idx: Map<string, number>, label: string): number | null => {
      const raw = pick(row, f);
      if (!raw) return null;
      const id = idx.get(norm(raw));
      if (id === undefined) { reasons.push(`${label}「${raw}」がマスタに存在しません`); return null; }
      return id;
    };
    const typeId = target === "sales" ? resolve("typeName", typeIdx, "商品種別") : null;
    const categoryId = target === "expense" ? resolve("categoryName", catIdx, "経費科目") : null;
    const siteId = resolve("siteName", siteIdx, "決済・支払サイト");
    const methodId = resolve("methodName", methodIdx, "決済・支払方法");

    // 手数料・計上額・予定日。ファイルに列があればそれを優先し、無ければサイト設定から
    const site = siteId != null ? siteById.get(siteId)?.site ?? DEFAULT_SITE_CONFIG : DEFAULT_SITE_CONFIG;
    let feeAmount = 0;
    if (mapped("feeAmount")) {
      const f = parseAmount(pick(row, "feeAmount"));
      // 手数料は控除額なので、ファイルに −1,980 と入っていても 1,980 として扱う
      feeAmount = f == null ? 0 : Math.abs(f);
    } else if (autoCalc) {
      feeAmount = calcFee(amount, site);
    }
    if (feeAmount > amount) {
      reasons.push(`手数料（${feeAmount}）が総額（${amount}）を超えています`);
      feeAmount = amount;
    }

    let recognizedAmount = Math.max(0, amount - feeAmount);
    if (mapped("recognizedAmount")) {
      const r = parseAmount(pick(row, "recognizedAmount"));
      if (r != null) recognizedAmount = Math.abs(r);
    }

    const accrualDate = (mapped("accrualDate") ? parseDate(pick(row, "accrualDate")) : "")
      || (paidAt ? paidAt.slice(0, 10) : "");
    let expectedDate = mapped("expectedDate") ? parseDate(pick(row, "expectedDate")) : "";
    if (!expectedDate && autoCalc && paidAt) {
      expectedDate = calcExpectedDate(paidAt.slice(0, 10), site, i.holidays);
    }

    const externalTxnId = pick(row, "externalTxnId");
    const externalSource = pick(row, "externalSource");

    const value: PlRowValue = {
      paidAt, accrualDate, expectedDate,
      email, emailNorm,
      customerName: pick(row, "customerName"),
      customerKana: pick(row, "customerKana"),
      customerTel: pick(row, "customerTel"),
      vendorName,
      invoiceNo: pick(row, "invoiceNo"),
      typeId, categoryId, siteId, methodId,
      memberId: emailNorm ? i.members?.get(emailNorm) ?? null : null,
      amount, feeAmount, recognizedAmount,
      note: pick(row, "note"),
      externalSource, externalTxnId,
    };

    const dedupHash = await sha256Hex(naturalKey(target, value));

    // ── 判定 ──
    let verdict: PlVerdict = "ok";
    let canOverride = false;
    let existingId: number | null = null;

    if (reasons.length) {
      verdict = "error";
    } else {
      const ek = externalTxnId ? extKey(externalSource, externalTxnId) : "";
      const exExt = ek ? i.existingExt?.get(ek) : undefined;
      const fileExt = ek ? seenExt.get(ek) : undefined;

      if (exExt !== undefined) {
        verdict = "dup_ext"; existingId = exExt;
        reasons.push(`外部取引ID が既存データ（ID ${exExt}）と一致します`);
      } else if (fileExt !== undefined) {
        verdict = "dup_ext";
        reasons.push(`外部取引ID がこのファイルの ${fileExt} 行目と重複しています`);
      } else {
        const exKey = i.existingKey?.get(dedupHash);
        const fileKey = seenKey.get(dedupHash);
        if (exKey !== undefined) {
          verdict = "dup_key"; existingId = exKey; canOverride = true;
          reasons.push(`決済日時・${target === "sales" ? "メール・商品" : "支払先・科目"}・サイト・金額が既存データ（ID ${exKey}）と一致します`);
        } else if (fileKey !== undefined) {
          verdict = "dup_file"; canOverride = true;
          reasons.push(`このファイルの ${fileKey} 行目と内容が同じです`);
        }
      }

      if (ek && fileExt === undefined) seenExt.set(ek, n + 1);
      if (!seenKey.has(dedupHash)) seenKey.set(dedupHash, n + 1);
    }

    // 会員照合できなかった売上は、エラーではなく未照合のまま取り込む
    if (verdict === "ok" && target === "sales" && emailNorm && value.memberId == null && i.members) {
      reasons.push("メール一致する会員が見つかりません。未照合のまま取り込みます");
    }

    out.push({
      no: n + 1, raw: row, verdict, reasons, canOverride,
      override: false, existingId, dedupHash, value,
    });
  }

  return out;
}

// ── 集計 ──────────────────────────────────────────────────────
export interface PlImportSummary {
  total: number;
  ok: number;
  dup: number;
  error: number;
  /** 取り込む行の総額合計 */
  amount: number;
  /** 取り込む行の計上額合計 */
  recognized: number;
}

export function summarizePl(rows: PlImportRow[]): PlImportSummary {
  let ok = 0, dup = 0, error = 0, amount = 0, recognized = 0;
  for (const r of rows) {
    if (r.verdict === "error") error += 1;
    else if (willImport(r)) ok += 1;
    else dup += 1;
    if (willImport(r)) { amount += r.value.amount; recognized += r.value.recognizedAmount; }
  }
  return { total: rows.length, ok, dup, error, amount, recognized };
}

/** マスタに無かった名称を集める（「マスタに追加」の導線に使う） */
export function unknownMasterNames(rows: PlImportRow[]): string[] {
  const out = new Set<string>();
  for (const r of rows) {
    for (const m of r.reasons) {
      const hit = /^(.+?)「(.+?)」がマスタに存在しません$/.exec(m);
      if (hit) out.add(`${hit[1]}：${hit[2]}`);
    }
  }
  return [...out];
}
