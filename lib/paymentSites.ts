// ============================================================
// 決済サイトの入金サイクル・手数料の計算（純関数のみ）
//
//   ・入金予定日 … 決済日 ＋ 決済サイトマスタの設定から算出する。
//       none     … 自動計算しない（決済日と同日）
//       offset   … 決済から N 日後（暦日 / 営業日）
//       closing  … 締め日方式（◯日締め・翌月◯日払い）
//       periodic … 決済日以降、最初に到来する支払日（月次）
//     算出後、休業日（土日祝）にあたったら holidayShift で前/後の営業日へ寄せる。
//
//   ・手数料 … 総額 × 率 ＋ 固定額。端数は floor / round / ceil。
//     売上計上金額 ＝ 総額 − 手数料。
//
//   日付は「YYYY-MM-DD」の文字列で受け渡しする。内部計算は UTC の年月日で行い、
//   ローカルタイムゾーンに依存しない（JST 環境以外でも月初月末がズレない）。
//
//   ⚠️ このモジュールは DOM も Supabase も参照しない。単体でテストできる状態を保つこと。
// ============================================================

// ── 型 ───────────────────────────────────────────────────────
export type CycleType    = "none" | "offset" | "closing" | "periodic";
export type DayType      = "calendar" | "business";
export type HolidayShift = "none" | "before" | "after";
export type FeeRounding  = "floor" | "round" | "ceil";

/** 決済サイトマスタ（payment_sites）の入金サイクル・手数料設定 */
export interface PaymentSiteConfig {
  cycleType: CycleType;
  /** 締め日（1〜31 / 99＝末日）。cycleType="closing" で使う */
  closingDay: number;
  /** 締め月から何ヶ月後に支払われるか（0＝当月 / 1＝翌月 / 2＝翌々月） */
  monthOffset: number;
  /** 支払日（1〜31 / 99＝末日）。closing / periodic で使う */
  paymentDay: number;
  /** 決済から何日後か。cycleType="offset" で使う */
  offsetDays: number;
  /** offsetDays を暦日で数えるか営業日で数えるか */
  dayType: DayType;
  /** 算出日が休業日だった場合の寄せ方 */
  holidayShift: HolidayShift;
  /** 決済手数料率（%） */
  feeRate: number;
  /** 1件あたり固定手数料（円） */
  feeFixed: number;
  feeRounding: FeeRounding;
  /** 1回の着金あたりの振込手数料（円）。明細ではなく消込差額の期待値に使う */
  transferFee: number;
  /** false なら自動計算しない（手入力のみ） */
  autoCalc: boolean;
}

/** マイグレーション未適用でも動くよう、全項目に安全な既定値を持たせる */
export const DEFAULT_SITE_CONFIG: PaymentSiteConfig = {
  cycleType: "none",
  closingDay: 99,
  monthOffset: 1,
  paymentDay: 99,
  offsetDays: 0,
  dayType: "calendar",
  holidayShift: "none",
  feeRate: 0,
  feeFixed: 0,
  feeRounding: "floor",
  transferFee: 0,
  autoCalc: true,
};

/** 99 は「末日」を表す番兵。UIの選択肢もこの値を使う */
export const LAST_DAY = 99;

// ── 日付のユーティリティ（UTC固定・TZ非依存）─────────────────
const pad2 = (n: number) => String(n).padStart(2, "0");
const toIso = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;

/** "YYYY-MM-DD" / "YYYY-MM-DDTHH:mm" / ISO文字列 → [年,月,日]。読めなければ null */
export function parseYmd(s: string | null | undefined): [number, number, number] | null {
  const head = (s ?? "").trim().slice(0, 10);
  const m = head.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 2026-02-31 のような存在しない日を弾く
  if (d > lastDayOfMonth(y, mo)) return null;
  return [y, mo, d];
}

/** その年月の末日（1-31） */
export function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 99（末日）や月末超えの指定を、その月に実在する日へ丸める */
function clampDay(y: number, m: number, day: number): number {
  const last = lastDayOfMonth(y, m);
  if (day >= LAST_DAY) return last;
  return Math.min(Math.max(1, Math.floor(day)), last);
}

function addCalendarDays(y: number, m: number, d: number, n: number): [number, number, number] {
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return [dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()];
}

function addMonths(y: number, m: number, n: number): [number, number] {
  const total = (y * 12 + (m - 1)) + n;
  return [Math.floor(total / 12), (total % 12) + 1];
}

/** 曜日（0=日 … 6=土） */
function dayOfWeek(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 営業日か（土日でなく、祝日集合にも含まれない） */
export function isBusinessDay(iso: string, holidays?: ReadonlySet<string>): boolean {
  const p = parseYmd(iso);
  if (!p) return false;
  const w = dayOfWeek(p[0], p[1], p[2]);
  if (w === 0 || w === 6) return false;
  return !(holidays?.has(iso) ?? false);
}

/** 営業日を n 日進める（n=0 ならその日のまま返す） */
export function addBusinessDays(iso: string, n: number, holidays?: ReadonlySet<string>): string {
  const p = parseYmd(iso);
  if (!p) return "";
  let [y, m, d] = p;
  let remain = Math.max(0, Math.floor(n));
  let guard = 0;
  while (remain > 0 && guard < 3650) {
    [y, m, d] = addCalendarDays(y, m, d, 1);
    guard++;
    if (isBusinessDay(toIso(y, m, d), holidays)) remain--;
  }
  return toIso(y, m, d);
}

/** 休業日にあたっていたら前/後の営業日へ寄せる */
export function shiftForHoliday(iso: string, mode: HolidayShift, holidays?: ReadonlySet<string>): string {
  if (mode === "none") return iso;
  const p = parseYmd(iso);
  if (!p) return iso;
  const step = mode === "before" ? -1 : 1;
  let [y, m, d] = p;
  let guard = 0;
  while (!isBusinessDay(toIso(y, m, d), holidays) && guard < 60) {
    [y, m, d] = addCalendarDays(y, m, d, step);
    guard++;
  }
  return toIso(y, m, d);
}

// ── 入金予定日 ───────────────────────────────────────────────
/**
 * 決済日と決済サイト設定から入金（出金）予定日を算出する。
 * @param paidAt   決済日時。"YYYY-MM-DD" でも "YYYY-MM-DDTHH:mm" でも可
 * @param site     決済サイト設定。null / autoCalc=false のときは決済日をそのまま返す
 * @param holidays 祝日の集合（"YYYY-MM-DD"）。省略時は土日のみ休業扱い
 * @returns "YYYY-MM-DD"。決済日が読めなければ ""
 */
export function calcExpectedDate(
  paidAt: string | null | undefined,
  site: PaymentSiteConfig | null | undefined,
  holidays?: ReadonlySet<string>,
): string {
  const p = parseYmd(paidAt);
  if (!p) return "";
  const base = toIso(p[0], p[1], p[2]);
  if (!site || !site.autoCalc || site.cycleType === "none") return base;

  let iso = base;

  if (site.cycleType === "offset") {
    iso = site.dayType === "business"
      ? addBusinessDays(base, site.offsetDays, holidays)
      : (() => { const [y, m, d] = addCalendarDays(p[0], p[1], p[2], Math.max(0, Math.floor(site.offsetDays))); return toIso(y, m, d); })();

  } else if (site.cycleType === "closing") {
    // 決済日が締め日以前なら当月締め、超えていれば翌月締め
    const closing = clampDay(p[0], p[1], site.closingDay);
    const [cy, cm] = p[2] <= closing ? [p[0], p[1]] : addMonths(p[0], p[1], 1);
    const [py, pm] = addMonths(cy, cm, Math.max(0, Math.floor(site.monthOffset)));
    iso = toIso(py, pm, clampDay(py, pm, site.paymentDay));

  } else if (site.cycleType === "periodic") {
    // 決済日以降で最初に到来する支払日（月次）
    const thisMonth = clampDay(p[0], p[1], site.paymentDay);
    if (p[2] <= thisMonth) {
      iso = toIso(p[0], p[1], thisMonth);
    } else {
      const [ny, nm] = addMonths(p[0], p[1], 1);
      iso = toIso(ny, nm, clampDay(ny, nm, site.paymentDay));
    }
  }

  return shiftForHoliday(iso, site.holidayShift, holidays);
}

// ── 手数料 ───────────────────────────────────────────────────
/** 決済手数料（円）。総額 × 率 ＋ 固定額を端数処理する */
export function calcFee(gross: number, site: PaymentSiteConfig | null | undefined): number {
  const g = Math.max(0, Math.floor(Number(gross) || 0));
  if (!site || !site.autoCalc) return 0;
  const rate = Number(site.feeRate) || 0;
  const fixed = Math.floor(Number(site.feeFixed) || 0);
  if (g <= 0 || (rate === 0 && fixed === 0)) return 0;
  const raw = g * (rate / 100) + fixed;
  const fee = site.feeRounding === "ceil" ? Math.ceil(raw)
            : site.feeRounding === "round" ? Math.round(raw)
            : Math.floor(raw);
  // 手数料が総額を超えることはない
  return Math.min(g, Math.max(0, fee));
}

/** 売上（経費）計上金額 ＝ 総額 − 手数料 */
export function calcNet(gross: number, site: PaymentSiteConfig | null | undefined): number {
  const g = Math.max(0, Math.floor(Number(gross) || 0));
  return Math.max(0, g - calcFee(g, site));
}

// ── 表示ヘルパー ─────────────────────────────────────────────
const dayLabel = (d: number) => (d >= LAST_DAY ? "末日" : `${d}日`);

/** 入金サイクルを1行で説明する（マスタ一覧・プレビュー用） */
export function describeCycle(site: PaymentSiteConfig | null | undefined): string {
  if (!site || site.cycleType === "none") return "自動計算なし";
  if (site.cycleType === "offset") {
    const unit = site.dayType === "business" ? "営業日" : "暦日";
    return `決済から${site.offsetDays}${unit}後`;
  }
  if (site.cycleType === "closing") {
    const mo = site.monthOffset === 0 ? "当月" : site.monthOffset === 1 ? "翌月" : `${site.monthOffset}ヶ月後`;
    return `${dayLabel(site.closingDay)}締め ${mo}${dayLabel(site.paymentDay)}払い`;
  }
  return `毎月${dayLabel(site.paymentDay)}`;
}

/** 休業日補正の説明 */
export function describeHolidayShift(mode: HolidayShift): string {
  return mode === "before" ? "前営業日に繰上" : mode === "after" ? "翌営業日に繰下" : "補正しない";
}

/** 手数料設定を1行で説明する */
export function describeFee(site: PaymentSiteConfig | null | undefined): string {
  if (!site) return "—";
  const rate = Number(site.feeRate) || 0;
  const fixed = Math.floor(Number(site.feeFixed) || 0);
  if (rate === 0 && fixed === 0) return "なし";
  const parts: string[] = [];
  if (rate !== 0) parts.push(`${rate}%`);
  if (fixed !== 0) parts.push(`${fixed.toLocaleString("ja-JP")}円/件`);
  return parts.join(" ＋ ");
}

/**
 * 設定のプレビュー用。サンプル決済日から入金予定日を求め、補正の有無つきで返す。
 * マスタ編集画面で「この設定だと◯月◯日入金」を出すのに使う。
 */
export function previewExpected(
  paidAt: string,
  site: PaymentSiteConfig,
  holidays?: ReadonlySet<string>,
): { raw: string; shifted: string; wasShifted: boolean } {
  const noShift = calcExpectedDate(paidAt, { ...site, holidayShift: "none" }, holidays);
  const shifted = calcExpectedDate(paidAt, site, holidays);
  return { raw: noShift, shifted, wasShifted: noShift !== shifted };
}

/** "YYYY-MM-DD" → "2026-09-30（水）"。空文字はそのまま返す */
export function fmtDateWithDow(iso: string): string {
  const p = parseYmd(iso);
  if (!p) return iso || "";
  const w = "日月火水木金土"[dayOfWeek(p[0], p[1], p[2])];
  return `${iso}（${w}）`;
}
