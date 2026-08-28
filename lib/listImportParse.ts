// ============================================================
// リスト一括取り込み：ファイル解析（純関数のみ）
//   ・文字コードの自動判定（UTF-8 / UTF-8 BOM / Shift_JIS(CP932)）
//   ・区切り文字の推定（カンマ / セミコロン / タブ）
//   ・CSV パース（RFC 4180：引用符・埋め込み改行・"" エスケープに対応）
//   ・ヘッダ行の推定と列の自動マッピング
//   ・失敗行CSVの生成（元の全列 ＋ 末尾に「失敗理由」列）
//
//   ⚠️ ここには DB アクセスも React も置かない。テストしやすい純関数だけにする。
//   ⚠️ Markdown（テーブル記法）は Phase 5。受け皿だけ用意し、今は弾く。
// ============================================================
import type { EntryInput, DupCheckRow } from "./models";
import { EMPTY_ENTRY_INPUT } from "./contactLists";

// ── 上限（決定事項 No.9）────────────────────────────────────
export const IMPORT_MAX_ROWS = 50000;
export const IMPORT_MAX_BYTES = 20 * 1024 * 1024;
/** プレビューに出す行数 */
export const IMPORT_PREVIEW_ROWS = 20;

// ── 文字コード ────────────────────────────────────────────────
export type ImportEncoding = "utf-8" | "utf-8-bom" | "cp932";

export const ENCODING_LABEL: Record<ImportEncoding, string> = {
  "utf-8": "UTF-8",
  "utf-8-bom": "UTF-8 (BOM付き)",
  cp932: "Shift_JIS (CP932)",
};

/**
 * 文字コードを判定する。
 *
 * ⚠️ 日本のExcel由来のCSVは CP932 が多数。ここを外すと氏名・備考が
 *    文字化けしたまま大量に入る（後から直すのが極めて面倒）。
 *    判定結果は画面に出し、ユーザーが手で上書きできるようにする。
 */
export function detectEncoding(bytes: Uint8Array): ImportEncoding {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return "utf-8-bom";
  }
  // ASCII のみなら UTF-8 として扱ってよい（CP932 と解釈が一致する）
  let hasHighByte = false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (bytes[i] > 0x7f) { hasHighByte = true; break; }
  }
  if (!hasHighByte) return "utf-8";

  // 厳密モードの UTF-8 デコードが通れば UTF-8、落ちれば CP932 と判定する
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "utf-8";
  } catch {
    return "cp932";
  }
}

/** 判定した文字コードで文字列化する（BOM は落とす）。 */
export function decodeBytes(bytes: Uint8Array, encoding: ImportEncoding): string {
  if (encoding === "cp932") {
    // WHATWG Encoding の "shift_jis" は CP932（Windows拡張）として解釈される
    return new TextDecoder("shift_jis").decode(bytes);
  }
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

// ── 区切り文字 ────────────────────────────────────────────────
export type Delimiter = "," | ";" | "\t";

export const DELIMITER_LABEL: Record<Delimiter, string> = {
  ",": "カンマ",
  ";": "セミコロン",
  "\t": "タブ",
};

/**
 * 区切り文字を推定する。1行目に最も多く現れる候補を採る。
 * ⚠️ Mailchimp はセミコロン区切りをユーザーに手で置換させているが、
 *    それは失敗要因になるので自動で判定する（Brevo と同じ方針）。
 */
export function detectDelimiter(text: string): Delimiter {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string): number => firstLine.split(ch).length - 1;
  const cands: Delimiter[] = [",", ";", "\t"];
  let best: Delimiter = ",";
  let bestN = -1;
  for (const c of cands) {
    const n = count(c);
    if (n > bestN) { bestN = n; best = c; }
  }
  return bestN <= 0 ? "," : best;
}

// ── CSV パース ────────────────────────────────────────────────
/**
 * CSV を2次元配列にする（RFC 4180）。
 *   ・引用符で囲まれたフィールド内の改行・区切り文字はそのまま値にする
 *   ・"" は引用符1つにする
 *   ・CRLF / LF / CR のどれでも行区切りとして扱う
 *   ・空行は捨てる（末尾の改行で空行が1つできるのを防ぐ）
 */
export function parseCsv(text: string, delimiter: Delimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    // 全セルが空の行は捨てる
    if (row.some((c) => c !== "")) rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }

    if (ch === '"' && field === "") { inQuotes = true; i += 1; continue; }
    if (ch === delimiter) { endField(); i += 1; continue; }
    if (ch === "\r") {
      endRow();
      i += text[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    if (ch === "\n") { endRow(); i += 1; continue; }
    field += ch; i += 1;
  }
  // 最終行（末尾に改行が無い場合）
  if (field !== "" || row.length > 0) endRow();
  return rows;
}

// ── 取り込み先の項目 ──────────────────────────────────────────
export type ListField =
  | "email" | "phone" | "name" | "ageGroup" | "prefecture" | "note1" | "note2"
  | "consentAt" | "consentSrc"
  | "label" | "lineDisplayName" | "lineUserId";

export interface ListFieldDef { key: ListField; label: string; required?: boolean }

/** 列マッピングのプルダウンに出す項目（並び順もこのとおり） */
export const LIST_FIELDS: ListFieldDef[] = [
  { key: "email",      label: "メールアドレス", required: true },
  { key: "phone",      label: "電話番号",       required: true },
  { key: "name",       label: "氏名" },
  { key: "ageGroup",   label: "年代" },
  { key: "prefecture", label: "都道府県" },
  { key: "note1",      label: "備考1" },
  { key: "note2",      label: "備考2" },
  { key: "consentAt",  label: "同意日時" },
  { key: "consentSrc", label: "同意取得元" },
  { key: "label",           label: "ラベル" },
  { key: "lineDisplayName", label: "LINEアカウント名" },
  { key: "lineUserId",      label: "LINE ID" },
];

export const LIST_FIELD_LABEL: Record<ListField, string> = {
  email: "メールアドレス", phone: "電話番号", name: "氏名",
  ageGroup: "年代", prefecture: "都道府県", note1: "備考1", note2: "備考2",
  consentAt: "同意日時", consentSrc: "同意取得元",
  label: "ラベル", lineDisplayName: "LINEアカウント名", lineUserId: "LINE ID",
};

/** 列マッピング。配列の添字＝CSVの列番号、値＝取り込み先（null＝取り込まない） */
export type ColumnMap = (ListField | null)[];

// ヘッダ名から項目を推定するための手がかり（小文字化・記号除去して部分一致）
const HINTS: { field: ListField; words: string[] }[] = [
  { field: "email",      words: ["mail", "eメール", "メール", "メルアド", "アドレス", "address", "mailaddress"] },
  { field: "phone",      words: ["tel", "phone", "電話", "携帯", "けいたい", "mobile", "telno"] },
  // ⚠️ LINE 系は name より**前**に置く（REQ-049）。
  //    完全一致で拾えるヘッダ（「LINEアカウント名」等）は安全だが、
  //    "DisplayName" のような英語ヘッダは正規化すると "name" を含むため、
  //    順序を誤ると氏名列に吸われて氏名が壊れる。
  //    lineUserId をさらに前に置き、"LINE ID" 系を先に確定させる。
  { field: "lineUserId",      words: ["lineid", "lineuserid", "userid", "ラインid", "lineユーザーid"] },
  { field: "lineDisplayName", words: ["line名", "lineアカウント", "line表示名", "displayname", "ライン名", "lineネーム"] },
  { field: "name",       words: ["氏名", "名前", "onamae", "おなまえ", "お名前", "name", "担当者", "会社名", "法人名"] },
  { field: "ageGroup",   words: ["年代", "年齢", "age", "世代"] },
  { field: "prefecture", words: ["都道府県", "県", "府県", "pref", "地域", "住所"] },
  { field: "note1",      words: ["備考1", "備考", "メモ", "note1", "note", "memo", "remarks"] },
  { field: "note2",      words: ["備考2", "note2", "memo2"] },
  // ⚠️ 同意日時を先に置く。「同意…」で始まるヘッダを取得元側に取られないため。
  { field: "consentAt",  words: ["同意日時", "同意日", "同意取得日", "consentat", "consentdate", "オプトイン日"] },
  { field: "consentSrc", words: ["同意取得元", "同意元", "取得元", "同意文言", "consentsrc", "consentsource", "オプトイン元"] },
  { field: "label",      words: ["ラベル", "label", "タグ", "tag", "区分"] },
];

const norm = (s: string): string =>
  s.trim().toLowerCase().replace(/[\s　_\-.'"（）()［］[\]]/g, "");

/**
 * ヘッダ行から列を自動推定する。
 * 同じ項目に複数列が当たった場合は最初の列だけ採用する（残りは「取り込まない」）。
 */
export function autoMapColumns(header: string[]): ColumnMap {
  const used = new Set<ListField>();
  const map: ColumnMap = header.map(() => null);

  // 完全一致を優先し、その後に部分一致で埋める
  header.forEach((h, i) => {
    const n = norm(h);
    const exact = LIST_FIELDS.find((f) => norm(f.label) === n);
    if (exact && !used.has(exact.key)) { map[i] = exact.key; used.add(exact.key); }
  });
  header.forEach((h, i) => {
    if (map[i] != null) return;
    const n = norm(h);
    if (!n) return;
    for (const { field, words } of HINTS) {
      if (used.has(field)) continue;
      if (words.some((w) => n.includes(norm(w)))) { map[i] = field; used.add(field); return; }
    }
  });
  return map;
}

/**
 * 1行目をヘッダとみなすか。
 * ⚠️ 1行目にメール形式・電話形式の値が入っていたら、それはデータ行。
 *    ヘッダとして捨ててしまうと1件が黙って消える。
 */
export function looksLikeHeader(firstRow: string[]): boolean {
  const hasEmail = firstRow.some((c) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.trim()));
  if (hasEmail) return false;
  const hasPhoneish = firstRow.some((c) => {
    const d = c.replace(/\D/g, "");
    return d.length >= 10 && d.length <= 15 && /^[0-9+\-() 　]+$/.test(c.trim());
  });
  return !hasPhoneish;
}

/** 列マッピングに従ってデータ行を EntryInput へ変換する。 */
export function rowsToEntryInputs(dataRows: string[][], map: ColumnMap): EntryInput[] {
  const idx = {} as Record<ListField, number>;
  map.forEach((f, i) => { if (f != null && idx[f] === undefined) idx[f] = i; });
  const pick = (row: string[], f: ListField): string => {
    const i = idx[f];
    return i === undefined ? "" : (row[i] ?? "").trim();
  };
  return dataRows.map((row) => ({
    ...EMPTY_ENTRY_INPUT,
    email: pick(row, "email"),
    phone: pick(row, "phone"),
    name: pick(row, "name"),
    ageGroup: pick(row, "ageGroup"),
    prefecture: pick(row, "prefecture"),
    note1: pick(row, "note1"),
    note2: pick(row, "note2"),
    consentAt: pick(row, "consentAt"),
    consentSrc: pick(row, "consentSrc"),
    label: pick(row, "label"),
    lineDisplayName: pick(row, "lineDisplayName"),
    lineUserId: pick(row, "lineUserId"),
  }));
}

/** メール・電話のどちらかが対応づけ済みか（未対応づけなら次へ進めない） */
export function hasRequiredMapping(map: ColumnMap): boolean {
  return map.includes("email") || map.includes("phone");
}

/** 実際に対応づけた項目（重複時の「更新」で、どの列を上書きするか決めるのに使う） */
export function mappedFields(map: ColumnMap): ListField[] {
  return Array.from(new Set(map.filter((f): f is ListField => f != null)));
}

// ── 失敗行CSV ─────────────────────────────────────────────────
const csvCell = (v: string): string =>
  /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/**
 * 失敗した行だけのCSVを作る。元の全列 ＋ 末尾に「失敗理由」列。
 * ⚠️ 修正してそのまま再アップロードできる形にすること（配配メールと同じ方針）。
 *    Mailchimp は結果の閲覧が24時間で切れるが、こちらはDBに残して30日DL可にする。
 */
export function buildErrorCsv(
  header: string[],
  failed: { values: string[]; reason: string }[],
): string {
  const head = [...header, "失敗理由"].map(csvCell).join(",");
  const body = failed.map((f) => [...f.values, f.reason].map(csvCell).join(","));
  // ⚠️ Excel が UTF-8 と判別できるよう BOM を付ける（付けないと日本語が化ける）
  return `﻿${[head, ...body].join("\r\n")}\r\n`;
}

/** 検証結果から失敗行（error）だけを取り出し、元の行の値と突き合わせる。 */
export function collectFailedRows(
  dataRows: string[][],
  results: DupCheckRow[],
): { values: string[]; reason: string }[] {
  const out: { values: string[]; reason: string }[] = [];
  results.forEach((r) => {
    if (r.verdict !== "error") return;
    out.push({ values: dataRows[r.no - 1] ?? [], reason: r.reason });
  });
  return out;
}
