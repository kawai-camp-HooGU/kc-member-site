// ============================================================
// リスト管理（配信先リスト）データアクセス＆共通ヘルパー
//   - 正規化（メール／電話 E.164）と重複キー … 手入力・一括取込の両方が必ずここを通る
//   - リスト枠の CRUD・手動並べ替え・件数の再集計
//   - レコードの取得（keyset ページング）・追加・更新・削除
//   - 重複チェック（ファイル内／同一リスト内 ＋ 配信停止リストの突合）
//
//   ⚠️ 重複判定は「ファイル内」と「同一リスト内」のみ。他リストは照合しない。
//      （同じ人が複数リストに居るのは正常。設計書 rev.2 §4-2）
//   ⚠️ クライアント安全な処理のみを置く（service_role には触れない）。
//      取込ジョブの実行はサーバー側（lib/contactListsServer.ts・Phase 2）。
// ============================================================
import { supabase } from "./supabase";
import type { Tables } from "./database.types";
import type { ContactList, ListEntry, EntryState, DupVerdict, DupCheckRow, EntryInput } from "./models";
import { isValidPhone } from "./validators";
import { normalizeEmail } from "./emailNormalize";

// 画面側が lib/contactLists から一括で import できるように再輸出する
export type { ContactList, ListEntry, EntryState, DupVerdict, DupCheckRow, EntryInput };

// ── 選択肢（画面と取込で共用）──────────────────────────────
export const AGE_GROUPS = [
  "10代", "20代", "30代", "40代", "50代", "60代", "70代", "80代以上", "不明",
] as const;

export const PREFECTURES = [
  "北海道", "青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県",
  "茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県",
  "新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県",
  "岐阜県", "静岡県", "愛知県", "三重県",
  "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県",
  "鳥取県", "島根県", "岡山県", "広島県", "山口県",
  "徳島県", "香川県", "愛媛県", "高知県",
  "福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県",
] as const;

/** 「東京」→「東京都」のように、都道府県の表記ゆれを正規のラベルへ寄せる（不一致は null） */
export function normalizePrefecture(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const hit = PREFECTURES.find((p) => p === v);
  if (hit) return hit;
  // 「都/道/府/県」が落ちている入力を救う（「東京」「北海」「大阪」など）
  const loose = PREFECTURES.find((p) => p.replace(/[都道府県]$/, "") === v.replace(/[都道府県]$/, ""));
  return loose ?? null;
}

/** 年代の表記ゆれを正規のラベルへ寄せる（「40」「40代」「40歳代」→「40代」／不一致は null） */
export function normalizeAgeGroup(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const hit = AGE_GROUPS.find((a) => a === v);
  if (hit) return hit;
  if (/^(80|80代|80歳|80以上|80代以上)$/.test(v)) return "80代以上";
  const m = v.match(/^(\d{1,2})\s*(代|歳)?/);
  if (m) {
    const decade = `${Math.floor(Number(m[1]) / 10) * 10}代`;
    return (AGE_GROUPS as readonly string[]).includes(decade) ? decade : null;
  }
  return null;
}

// ── 正規化 ────────────────────────────────────────────────────
/**
 * 重複判定用のメールアドレス正規化。
 * ⚠️ 実装は lib/emailNormalize.ts（依存なしの純関数）に置いている。
 *    サーバー専用モジュール（送信エンジン）からも同じ規則を使うため、
 *    supabase に依存するこのファイルには実装を置かない。
 */
export { normalizeEmail };

/**
 * 重複判定用の電話番号正規化（E.164）。形式不正・空欄は null。
 *   090-1234-5678 → +819012345678 ／ +81 90 1234 5678 → +819012345678
 */
export function normalizePhone(raw: string | null | undefined, countryCode = "81"): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  if (!isValidPhone(v)) return null;
  if (v.startsWith("+")) {
    const digits = v.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = v.replace(/\D/g, "");
  if (!digits) return null;
  // 国内表記の先頭 0 は国番号に置き換える
  return digits.startsWith("0") ? `+${countryCode}${digits.slice(1)}` : `+${countryCode}${digits}`;
}

/**
 * 同意日時の正規化（Phase 5）。空欄・解釈できない値は null（＝未記録）を返す。
 *
 * 受ける表記：`2026-07-20` / `2026/7/20` / `2026年7月20日` / `2026-07-20 14:30` / ISO8601
 *
 * ⚠️ 日付だけの表記は **JST の 0 時** として解釈する。
 *    `new Date("2026-07-20")` は UTC 0 時＝JST 9 時になり、日付だけを見ると
 *    1日ずれて見えることがあるため、ここで明示的に +09:00 を付ける。
 * ⚠️ 未来日は受け付けない（同意より先に日付が来ることは無い＝入力ミス）。
 *    ただし時計ずれを考慮して1日ぶんの余裕を持たせる。
 */
export function normalizeConsentAt(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;

  // 2026年7月20日 → 2026-7-20
  const jp = v.replace(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/, "$1-$2-$3");
  // ⚠️ 末尾に Z や +09:00 が付いている＝タイムゾーンが明示されている値は
  //    そのまま Date に渡す（勝手に JST を付け直すと時刻がずれる）。
  const hasTz = /(?:Z|[+-]\d{2}:?\d{2})$/.test(jp);
  // 区切りのスラッシュ・ドットをハイフンに寄せる（日付部分のみ）
  const m = hasTz ? null : jp.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let iso: string;
  if (m) {
    const [, y, mo, d, hh, mi, ss] = m;
    const p2 = (s: string | undefined, def = "00") => (s ?? def).padStart(2, "0");
    // 明示的に JST を付ける（付けないと日付だけの表記が UTC 解釈される）
    iso = `${y}-${p2(mo)}-${p2(d)}T${p2(hh)}:${p2(mi)}:${p2(ss)}+09:00`;
  } else {
    iso = v;   // ISO8601（オフセット付き）などはそのまま Date へ渡す
  }

  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const y = t.getUTCFullYear();
  if (y < 1990 || y > 2999) return null;
  if (t.getTime() > Date.now() + 86_400_000) return null;   // 未来日は入力ミスとみなす
  return t.toISOString();
}

/**
 * 保存済みの同意日時（ISO）を `<input type="date">` 用の `YYYY-MM-DD` に戻す。
 * ⚠️ JST に寄せてから日付を取り出す（UTC のまま切ると 9 時間ぶん前日になる）。
 */
export function consentAtToDateInput(iso: string | null | undefined): string {
  const v = (iso ?? "").trim();
  if (!v) return "";
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return "";
  return new Date(t.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * 重複キー。メールを第一、無ければ電話。両方 null は登録不可（null を返す）。
 *
 * ⚠️ 「メールは違うが電話が同じ」は別レコードとして扱う（家族・法人の代表電話を
 *    共有するケースで別人を統合してしまう事故を防ぐ）。
 */
export function dupKey(emailNorm: string | null, phoneE164: string | null): string | null {
  if (emailNorm) return `e:${emailNorm}`;
  if (phoneE164) return `p:${phoneE164}`;
  return null;
}

/** 代表アドレス（info@ / sales@ など）か。除外はせず画面で注意表示するだけ。 */
const ROLE_LOCALS = ["info", "sales", "support", "contact", "office", "admin", "inquiry", "webmaster", "help"];
export function isRoleAddress(emailNorm: string | null): boolean {
  if (!emailNorm) return false;
  return ROLE_LOCALS.includes(emailNorm.split("@")[0]);
}

/**
 * レコードの状態（一覧の「状態」列）。
 * @param suppressed  配信停止の正規化メール集合
 * @param withdrawn   退会（論理削除）した会員IDの集合（確定事項 A3）
 */
export function entryState(
  e: ListEntry,
  suppressed: ReadonlySet<string>,
  withdrawn: ReadonlySet<number> = new Set(),
): EntryState {
  // ⚠️ 退会は最優先で出す。「配信可」に見えているのに実際は送られない、を防ぐ
  if (e.memberId != null && withdrawn.has(e.memberId)) return "withdrawn";
  if (!e.emailNorm) return "phone_only";
  if (suppressed.has(e.emailNorm)) return "suppressed";
  if (isRoleAddress(e.emailNorm)) return "role_address";
  return "ok";
}

export const ENTRY_STATE_LABEL: Record<EntryState, string> = {
  withdrawn:    "退会",
  ok:           "配信可",
  phone_only:   "電話のみ",
  suppressed:   "配信停止",
  bounced:      "バウンス",
  role_address: "代表アドレス",
};

/** 状態チップの色クラス（意味で色を固定する／brand.md）。 */
export const ENTRY_STATE_CLS: Record<EntryState, string> = {
  withdrawn:    "bg-gray-100 text-gray-600 border-gray-300",
  ok:           "bg-emerald-50 text-emerald-700 border-emerald-300",
  phone_only:   "bg-amber-50 text-amber-700 border-amber-300",
  suppressed:   "bg-red-50 text-red-700 border-red-300",
  bounced:      "bg-red-50 text-red-700 border-red-300",
  role_address: "bg-amber-50 text-amber-700 border-amber-300",
};

// ── 変換 ──────────────────────────────────────────────────────
export function toContactList(r: Tables<"contact_lists">): ContactList {
  return {
    id: r.id,
    name: r.name ?? "",
    description: r.description ?? "",
    note1: r.note1 ?? "",
    note2: r.note2 ?? "",
    folderId: r.folder_id ?? null,
    entryCount: r.entry_count ?? 0,
    emailableCount: r.emailable_count ?? 0,
    phoneOnlyCount: r.phone_only_count ?? 0,
    sortOrder: r.sort_order ?? 0,
    allowDelivery: r.allow_delivery ?? true,
    consentNote: r.consent_note ?? "",
    isArchived: r.is_archived ?? false,
    isDeleted: r.is_deleted ?? false,
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

export function toListEntry(r: Tables<"contact_list_entries">): ListEntry {
  const mb = r.matched_by;
  return {
    id: r.id,
    listId: r.list_id,
    memberId: r.member_id ?? null,
    matchedBy: mb === "member_id" || mb === "email" ? mb : "",
    email: r.email ?? "",
    emailNorm: r.email_norm ?? "",
    phone: r.phone ?? "",
    phoneE164: r.phone_e164 ?? "",
    name: r.name ?? "",
    ageGroup: r.age_group ?? "",
    prefecture: r.prefecture ?? "",
    note1: r.note1 ?? "",
    note2: r.note2 ?? "",
    sourceKind: r.source_kind === "csv" ? "csv" : r.source_kind === "md" ? "md" : r.source_kind === "api" ? "api" : "manual",
    importId: r.import_id ?? null,
    consentAt: r.consent_at ?? "",
    consentSrc: r.consent_src ?? "",
    createdAt: r.created_at ?? "",
    updatedAt: r.updated_at ?? "",
  };
}

// ── リスト枠：読み取り ────────────────────────────────────────
/** リスト枠の一覧（既定＝手動並べ替え順）。アーカイブ済みも含めて返す（画面で出し分ける）。 */
export async function fetchContactLists(): Promise<ContactList[]> {
  const { data, error } = await supabase
    .from("contact_lists")
    .select("*")
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });
  if (error || !data) return [];
  return data.map(toContactList);
}

export async function fetchContactList(id: number): Promise<ContactList | null> {
  const { data } = await supabase.from("contact_lists").select("*").eq("id", id).maybeSingle();
  return data ? toContactList(data) : null;
}

// ── リスト枠：書き込み ────────────────────────────────────────
export interface ContactListInput {
  name: string;
  description: string;
  note1: string;
  note2: string;
  folderId: number | null;
  allowDelivery: boolean;
  consentNote: string;
}

/**
 * リスト枠の新規作成。作ったリストは先頭に入れる
 * （作った直後に一覧の下の方にあって見つからない、を防ぐ）。
 */
export async function createContactList(input: ContactListInput): Promise<number | null> {
  const { data: head } = await supabase
    .from("contact_lists")
    .select("sort_order")
    .eq("is_deleted", false)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();
  const topOrder = head?.sort_order ?? 10;
  const { data, error } = await supabase
    .from("contact_lists")
    .insert({
      name: input.name.trim(),
      description: input.description,
      note1: input.note1,
      note2: input.note2,
      folder_id: input.folderId,
      allow_delivery: input.allowDelivery,
      consent_note: input.consentNote,
      sort_order: topOrder - 10,
    })
    .select("id")
    .single();
  return error || !data ? null : data.id;
}

export async function updateContactList(id: number, input: ContactListInput): Promise<boolean> {
  const { error } = await supabase
    .from("contact_lists")
    .update({
      name: input.name.trim(),
      description: input.description,
      note1: input.note1,
      note2: input.note2,
      folder_id: input.folderId,
      allow_delivery: input.allowDelivery,
      consent_note: input.consentNote,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  return !error;
}

/**
 * アーカイブ / 解除。
 * ⚠️ 物理削除はしない（配信履歴が壊れるため）。設計書 決定事項 No.14。
 */
export async function setContactListArchived(id: number, archived: boolean): Promise<boolean> {
  const { error } = await supabase
    .from("contact_lists")
    .update({ is_archived: archived, updated_at: new Date().toISOString() })
    .eq("id", id);
  return !error;
}

/**
 * 取得元・同意メモをリストに記録する（取り込み時に入力された場合）。
 * ⚠️ 既に入っている内容は上書きしない（過去の同意記録を消さない）。
 */
export async function setListConsentNoteIfEmpty(id: number, note: string): Promise<void> {
  const n = note.trim();
  if (!n) return;
  const { data } = await supabase.from("contact_lists").select("consent_note").eq("id", id).maybeSingle();
  if ((data?.consent_note ?? "").trim() !== "") return;
  await supabase
    .from("contact_lists")
    .update({ consent_note: n, updated_at: new Date().toISOString() })
    .eq("id", id);
}

/** 手動並べ替え。渡した id の順に sort_order を 10 刻みで振り直す。 */
export async function reorderContactLists(orderedIds: number[]): Promise<boolean> {
  if (orderedIds.length === 0) return true;
  const { error } = await supabase.rpc("reorder_contact_lists", { p_ids: orderedIds });
  return !error;
}

/** 件数キャッシュの再集計（冪等）。取込・削除の直後に呼ぶ。 */
export async function recountContactList(id: number): Promise<void> {
  await supabase.rpc("recount_contact_list", { p_list_id: id });
}

/** リストを複製（枠のみ／レコードも含める）。名前は「〜 のコピー」。 */
export async function duplicateContactList(src: ContactList, withEntries: boolean): Promise<number | null> {
  const newId = await createContactList({
    name: `${src.name} のコピー`,
    description: src.description,
    note1: src.note1,
    note2: src.note2,
    folderId: src.folderId,
    allowDelivery: src.allowDelivery,
    consentNote: src.consentNote,
  });
  if (newId == null || !withEntries) return newId;

  // レコードはページングしながら写す（数万件でも1回のクエリで抱えない）
  let cursor: number | null = null;
  for (;;) {
    let q = supabase
      .from("contact_list_entries")
      .select("*")
      .eq("list_id", src.id)
      .order("id", { ascending: false })
      .limit(500);
    if (cursor != null) q = q.lt("id", cursor);
    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    const rows = data.map((r) => ({
      list_id: newId,
      member_id: r.member_id,
      matched_by: r.matched_by,
      email: r.email,
      email_norm: r.email_norm,
      phone: r.phone,
      phone_e164: r.phone_e164,
      name: r.name,
      age_group: r.age_group,
      prefecture: r.prefecture,
      note1: r.note1,
      note2: r.note2,
      source_kind: r.source_kind,
      consent_at: r.consent_at,
      consent_src: r.consent_src,
    }));
    await supabase.from("contact_list_entries").insert(rows);
    cursor = data[data.length - 1].id;
    if (data.length < 500) break;
  }
  await recountContactList(newId);
  return newId;
}

// ── レコード：読み取り ────────────────────────────────────────
export interface EntryFilter {
  /** メール・電話・氏名の部分一致 */
  keyword?: string;
  prefecture?: string;
  ageGroup?: string;
  /** "all" | "emailable"（メールあり）| "phone_only"（メールなし） */
  contact?: "all" | "emailable" | "phone_only";
}

export const ENTRY_PAGE_SIZE = 50;

export interface EntryPage {
  rows: ListEntry[];
  /** 次ページの起点（null＝最終ページ） */
  nextCursor: number | null;
}

/** 絞り込みが1つでも掛かっているか（エクスポートの「範囲」表示に使う） */
export function isFiltered(f: EntryFilter): boolean {
  return (f.keyword ?? "").trim() !== "" || !!f.prefecture || !!f.ageGroup
    || (f.contact != null && f.contact !== "all");
}

/**
 * レコード一覧の絞り込みをクエリへ適用する。
 *
 * ⚠️ 画面（fetchListEntries）とエクスポート（listExport）で**必ず同じ関数**を通すこと。
 *    ここが分岐すると「絞ったつもりで全件を書き出す」＝個人情報の過剰持ち出しになる。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyEntryFilter<T>(q: T, filter: EntryFilter): T {
  // supabase-js のクエリビルダはメソッド毎に型が変わるため、この関数の中だけ any で扱う
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let x = q as any;
  if (filter.prefecture) x = x.eq("prefecture", filter.prefecture);
  if (filter.ageGroup) x = x.eq("age_group", filter.ageGroup);
  if (filter.contact === "emailable") x = x.not("email_norm", "is", null);
  if (filter.contact === "phone_only") x = x.is("email_norm", null);

  const kw = (filter.keyword ?? "").trim();
  if (kw) {
    // ⚠️ PostgREST の or() はカンマ・括弧で式を区切るため、その文字は必ず落とす
    //    （残すとフィルタ式が壊れて 400 になる）
    const esc = kw.replace(/[%,()*"\\]/g, "");
    if (esc) x = x.or(`email.ilike.%${esc}%,phone.ilike.%${esc}%,name.ilike.%${esc}%`);
  }
  return x as T;
}

/**
 * レコードの取得（keyset ページング）。
 * ⚠️ OFFSET は使わない（数万件で後ろのページが遅くなるため）。id 降順で辿る。
 */
export async function fetchListEntries(
  listId: number,
  filter: EntryFilter = {},
  cursor: number | null = null,
): Promise<EntryPage> {
  let q = supabase
    .from("contact_list_entries")
    .select("*")
    .eq("list_id", listId)
    .order("id", { ascending: false })
    .limit(ENTRY_PAGE_SIZE + 1);

  if (cursor != null) q = q.lt("id", cursor);
  q = applyEntryFilter(q, filter);

  const { data, error } = await q;
  if (error || !data) return { rows: [], nextCursor: null };

  const hasMore = data.length > ENTRY_PAGE_SIZE;
  const page = hasMore ? data.slice(0, ENTRY_PAGE_SIZE) : data;
  return {
    rows: page.map(toListEntry),
    nextCursor: hasMore ? page[page.length - 1].id : null,
  };
}

/** 配信停止リスト（正規化メールの集合）。状態表示・重複チェックの両方で使う。 */
export async function fetchSuppressedSet(): Promise<Set<string>> {
  const { data, error } = await supabase.from("email_suppressions").select("email");
  if (error || !data) return new Set();
  const s = new Set<string>();
  for (const r of data) {
    const n = normalizeEmail(r.email);
    if (n) s.add(n);
    else s.add((r.email ?? "").trim().toLowerCase());  // 形式不正でも突合できるようにする
  }
  return s;
}

// ── 分割（大量件数の取り扱い）──────────────────────────────
/**
 * in() に並べる値の上限。PostgREST はクエリ文字列に値を展開するため、
 * 大きすぎるとURL長の上限に当たって 414 / 400 になる。
 * メール1件あたり約30字なので 200 件で約6KB。安全側に振っている。
 */
export const IN_CHUNK = 200;
/** 1回の insert に載せる行数 */
export const INSERT_CHUNK = 500;

export function chunked<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── レコード：重複チェック ────────────────────────────────────
export const EMPTY_ENTRY_INPUT: EntryInput = {
  email: "", phone: "", name: "", ageGroup: "", prefecture: "", note1: "", note2: "",
  consentAt: "", consentSrc: "",
};

/**
 * 登録候補を検証し、行ごとの判定（新規／スキップ／エラー）と理由を返す。
 *
 *   ① ファイル（入力）内の重複 … 最後の1行を採用し、前の行はスキップ
 *   ② 同一リスト内の既存      … スキップ
 *   ＋ 配信停止リスト          … スキップ
 *
 * ⚠️ 他リストは照合しない（設計書 決定事項 No.4）。
 */
export async function checkEntries(
  listId: number,
  inputs: EntryInput[],
  opts: { skipSuppressed?: boolean } = {},
): Promise<DupCheckRow[]> {
  const skipSuppressed = opts.skipSuppressed ?? true;

  // 正規化しつつ、形式エラーを先に確定させる
  const norm = inputs.map((v) => {
    const emailRaw = v.email.trim();
    const phoneRaw = v.phone.trim();
    const emailNorm = normalizeEmail(emailRaw);
    const phoneE164 = normalizePhone(phoneRaw);
    let error = "";
    if (!emailRaw && !phoneRaw) error = "メールアドレス・電話番号のどちらも空です（どちらか一方が必須）";
    else if (emailRaw && !emailNorm) error = "メールアドレスの形式が正しくありません";
    else if (phoneRaw && !phoneE164) error = "電話番号の形式が正しくありません（数字10〜15桁）";
    return { input: v, emailNorm, phoneE164, error };
  });

  // ① 入力内の重複：後の行を優先するため、後ろから見て初出だけを残す
  const seen = new Set<string>();
  const dupInInput = new Array<number | null>(norm.length).fill(null);
  for (let i = norm.length - 1; i >= 0; i -= 1) {
    const n = norm[i];
    if (n.error) continue;
    const key = dupKey(n.emailNorm, n.phoneE164);
    if (!key) continue;
    if (seen.has(key)) {
      // 後ろに同じキーがある＝この行は捨てる。採用される行番号を探す
      for (let j = norm.length - 1; j > i; j -= 1) {
        const k2 = dupKey(norm[j].emailNorm, norm[j].phoneE164);
        if (!norm[j].error && k2 === key) { dupInInput[i] = j + 1; break; }
      }
    } else {
      seen.add(key);
    }
  }

  // ② 同一リスト内の既存レコード
  //   ⚠️ in() はクエリ文字列に値が並ぶため、5万件を1回で投げるとURL長で壊れる。
  //      IN_CHUNK 件ずつに分割して引く（一括取り込みでもここが破綻しない）。
  const emails = Array.from(new Set(norm.map((n) => n.emailNorm).filter((v): v is string => !!v)));
  const phones = Array.from(new Set(norm.map((n) => n.phoneE164).filter((v): v is string => !!v)));

  const existing = new Map<string, ListEntry>();
  for (const chunk of chunked(emails, IN_CHUNK)) {
    const { data } = await supabase
      .from("contact_list_entries").select("*")
      .eq("list_id", listId).in("email_norm", chunk);
    for (const r of data ?? []) {
      const e = toListEntry(r);
      if (e.emailNorm) existing.set(`e:${e.emailNorm}`, e);
    }
  }
  for (const chunk of chunked(phones, IN_CHUNK)) {
    const { data } = await supabase
      .from("contact_list_entries").select("*")
      .eq("list_id", listId).in("phone_e164", chunk);
    for (const r of data ?? []) {
      const e = toListEntry(r);
      if (e.phoneE164) existing.set(`p:${e.phoneE164}`, e);
    }
  }

  const suppressed = skipSuppressed ? await fetchSuppressedSet() : new Set<string>();

  return norm.map((n, i) => {
    const row: DupCheckRow = {
      no: i + 1,
      input: n.input,
      emailNorm: n.emailNorm,
      phoneE164: n.phoneE164,
      verdict: "insert" as DupVerdict,
      reason: "",
      existingId: null,
    };
    if (n.error) { row.verdict = "error"; row.reason = n.error; return row; }

    const dupAt = dupInInput[i];
    if (dupAt != null) {
      row.verdict = "skip";
      row.reason = `入力内で重複しています（${dupAt} 行目が採用されます）`;
      return row;
    }
    if (skipSuppressed && n.emailNorm && suppressed.has(n.emailNorm)) {
      row.verdict = "skip";
      row.reason = "配信停止リストに登録されています";
      return row;
    }
    const key = dupKey(n.emailNorm, n.phoneE164);
    const hit = key ? existing.get(key) : undefined;
    if (hit) {
      row.verdict = "skip";
      row.existingId = hit.id;
      row.reason = n.emailNorm && hit.emailNorm === n.emailNorm
        ? "このリストに同じメールアドレスが既に登録されています"
        : "このリストに同じ電話番号が既に登録されています";
      return row;
    }
    if (isRoleAddress(n.emailNorm)) {
      row.reason = "注意：代表アドレスの可能性があります（取り込みます）";
    }
    // 同意日時が解釈できない場合は**弾かずに知らせる**（連絡先自体は正しいため）。
    // ⚠️ 黙って捨てると「同意日時を入れたのに空のまま」に気づけない。
    if ((n.input.consentAt ?? "").trim() && !normalizeConsentAt(n.input.consentAt)) {
      const warn = "注意：同意日時を解釈できないため空欄で取り込みます";
      row.reason = row.reason ? `${row.reason} ／ ${warn}` : warn;
    }
    return row;
  });
}

/**
 * 貼り付けテキストの解析（メール・電話が混在してよい）。
 * 区切りはカンマ・セミコロン・タブ・改行・空白。
 * ⚠️ 既存 lib/broadcast.ts の parseEmailList() と同じ発想だが、電話番号も拾う。
 */
export function parseContactPaste(raw: string): EntryInput[] {
  return raw
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({
      ...EMPTY_ENTRY_INPUT,
      // @ を含めばメール、含まなければ電話として扱う（形式検証は checkEntries 側）
      ...(t.includes("@") ? { email: t } : { phone: t }),
    }));
}

// ── レコード：書き込み ────────────────────────────────────────
/**
 * 正規化メールで会員を引き当てる（名寄せ）。emailNorm → members.id のマップを返す。
 *
 * ⚠️ 1件ずつ問い合わせない（貼り付け100件で100往復してしまう）。
 * ⚠️ members 側に正規化列が無いため、生の値と正規化値の両方で引いてから
 *    アプリ側で正規化して突き合わせる。これで Gmail のドット表記
 *    （john.doe@gmail.com ⇔ johndoe@gmail.com）も拾える。
 */
export async function resolveMemberIds(
  pairs: { raw: string; norm: string }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const wanted = new Set(pairs.map((p) => p.norm).filter(Boolean));
  if (wanted.size === 0) return map;

  const candidates = Array.from(new Set(pairs.flatMap((p) => [p.raw, p.norm]).filter(Boolean)));
  const { data } = await supabase
    .from("members")
    .select("id, email")
    .eq("is_deleted", false)
    .in("email", candidates);

  for (const m of data ?? []) {
    const n = normalizeEmail(m.email);
    if (n && wanted.has(n) && !map.has(n)) map.set(n, m.id);
  }
  return map;
}

/** 1件分の名寄せ（手入力の編集用）。見つからなければ null。 */
export async function findMemberIdByEmail(emailRaw: string, emailNorm: string | null): Promise<number | null> {
  if (!emailNorm) return null;
  const map = await resolveMemberIds([{ raw: emailRaw.trim(), norm: emailNorm }]);
  return map.get(emailNorm) ?? null;
}

export interface EntryRow {
  list_id: number;
  member_id: number | null;
  matched_by: string | null;
  email: string | null;
  email_norm: string | null;
  phone: string | null;
  phone_e164: string | null;
  name: string;
  age_group: string | null;
  prefecture: string | null;
  note1: string;
  note2: string;
  source_kind: string;
  /** 同意日時（ISO）。未記録は null（Phase 5） */
  consent_at: string | null;
  /** 同意の取得元。未記録は null（Phase 5） */
  consent_src: string | null;
}

export function buildEntryRow(
  listId: number, v: EntryInput, sourceKind: string, memberId: number | null,
): EntryRow | null {
  const emailNorm = normalizeEmail(v.email);
  const phoneE164 = normalizePhone(v.phone);
  if (!emailNorm && !phoneE164) return null;
  return {
    list_id: listId,
    member_id: memberId,
    matched_by: memberId != null ? "email" : null,
    email: v.email.trim() || null,
    email_norm: emailNorm,
    phone: v.phone.trim() || null,
    phone_e164: phoneE164,
    name: v.name.trim(),
    age_group: normalizeAgeGroup(v.ageGroup),
    prefecture: normalizePrefecture(v.prefecture),
    note1: v.note1,
    note2: v.note2,
    source_kind: sourceKind,
    consent_at: normalizeConsentAt(v.consentAt),
    consent_src: v.consentSrc.trim() || null,
  };
}

/**
 * レコードの追加。判定が insert の行だけを入れる。
 * 戻り値は実際に入った件数（UNIQUE 制約で弾かれた分は含まない）。
 */
export async function addListEntries(
  listId: number,
  rows: DupCheckRow[],
  sourceKind: "manual" | "csv" = "manual",
): Promise<number> {
  const targets = rows.filter((r) => r.verdict === "insert");
  if (targets.length === 0) return 0;

  // 会員の名寄せは一括で解決してから行を組む（1件ずつ問い合わせない）
  const memberMap = await resolveMemberIds(
    targets
      .filter((t) => t.emailNorm)
      .map((t) => ({ raw: t.input.email.trim(), norm: t.emailNorm as string })),
  );

  const built = targets
    .map((t) => buildEntryRow(listId, t.input, sourceKind, t.emailNorm ? memberMap.get(t.emailNorm) ?? null : null))
    .filter((r): r is EntryRow => r != null);
  if (built.length === 0) return 0;

  const inserted = await insertEntriesTolerant(built);
  if (inserted > 0) await recountContactList(listId);
  return inserted;
}

/**
 * まとめて insert し、UNIQUE 違反が出たら1件ずつに落として入るものだけ入れる。
 *
 * ⚠️ upsert(onConflict) は使えない。重複防止に使っている索引が
 *    「email_norm is not null」の部分UNIQUEで、PostgreSQL は
 *    ON CONFLICT (list_id, email_norm) からこれを推論できず 42P10 になる。
 * ⚠️ 画面のプレビューと実行の間に他の運営が同じアドレスを入れていた場合に
 *    全件が失敗するのを防ぐのが目的（取り込めた分は活かす）。
 */
export async function insertEntriesTolerant(rows: EntryRow[]): Promise<number> {
  let total = 0;
  for (const chunk of chunked(rows, INSERT_CHUNK)) {
    const { data, error } = await supabase.from("contact_list_entries").insert(chunk).select("id");
    if (!error) { total += data?.length ?? 0; continue; }
    // このチャンクのどこかが競合した。1件ずつに落として入る分だけ入れる
    for (const r of chunk) {
      const { error: e1 } = await supabase.from("contact_list_entries").insert(r);
      if (!e1) total += 1;
    }
  }
  return total;
}

/**
 * 1件更新（メール・電話を変えた場合は正規化もやり直す）。
 * 失敗時は理由を返す（同一リスト内の重複は UNIQUE 違反で弾かれる）。
 */
export async function updateListEntry(
  id: number, listId: number, v: EntryInput,
): Promise<{ ok: boolean; error: string }> {
  const emailNorm = normalizeEmail(v.email);
  const memberId = await findMemberIdByEmail(v.email, emailNorm);
  const row = buildEntryRow(listId, v, "manual", memberId);
  if (!row) return { ok: false, error: "メールアドレス・電話番号のどちらか一方は必須です" };

  const { list_id: _listId, source_kind: _srcKind, ...patch } = row;
  void _listId; void _srcKind;
  const { error } = await supabase
    .from("contact_list_entries")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    // 23505 = unique_violation（同じメール/電話がこのリストに既にある）
    const dup = error.code === "23505";
    return { ok: false, error: dup ? "このリストに同じメールアドレス（または電話番号）が既に登録されています" : "更新に失敗しました" };
  }
  await recountContactList(listId);
  return { ok: true, error: "" };
}

/**
 * 既存レコードを取り込み値で更新する（重複時の動作＝「更新」用）。
 *
 * ⚠️ 更新するのは「対応づけした列」だけ。マッピングしていない列は触らない
 *    （HubSpot と同じ挙動。取り込みファイルに無い項目を消さない）。
 * ⚠️ blankOverwrite が false（既定）なら、CSVが空欄の列は既存値を残す。
 *    ここを重複挙動と一緒にしてしまうと顧客データ消失事故に直結する。
 */
export async function updateExistingEntries(
  listId: number,
  targets: { existingId: number; input: EntryInput }[],
  fields: readonly (keyof EntryInput)[],
  blankOverwrite: boolean,
): Promise<number> {
  if (targets.length === 0) return 0;

  const COL: Record<keyof EntryInput, string> = {
    email: "email", phone: "phone", name: "name",
    ageGroup: "age_group", prefecture: "prefecture", note1: "note1", note2: "note2",
    consentAt: "consent_at", consentSrc: "consent_src",
  };

  let n = 0;
  for (const t of targets) {
    const patch: Record<string, string | null> = {};
    for (const f of fields) {
      const raw = (t.input[f] ?? "").trim();
      if (!raw && !blankOverwrite) continue;     // 空欄は既定で無視する
      if (f === "email") {
        const en = normalizeEmail(raw);
        if (raw && !en) continue;                // 形式不正は触らない
        patch.email = raw || null;
        patch.email_norm = en;
      } else if (f === "phone") {
        const pe = normalizePhone(raw);
        if (raw && !pe) continue;
        patch.phone = raw || null;
        patch.phone_e164 = pe;
      } else if (f === "ageGroup") {
        patch.age_group = normalizeAgeGroup(raw);
      } else if (f === "prefecture") {
        patch.prefecture = normalizePrefecture(raw);
      } else if (f === "consentAt") {
        const ca = normalizeConsentAt(raw);
        // ⚠️ timestamptz 列に空文字は入れられない。解釈できない値は触らない
        //    （同意の記録を入力ミスで消さないため）。
        if (raw && !ca) continue;
        patch.consent_at = ca;
      } else if (f === "consentSrc") {
        patch.consent_src = raw || null;
      } else {
        patch[COL[f]] = raw;
      }
    }
    if (Object.keys(patch).length === 0) continue;
    const { error } = await supabase
      .from("contact_list_entries")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", t.existingId);
    if (!error) n += 1;
  }
  if (n > 0) await recountContactList(listId);
  return n;
}

/** レコードの削除（レコードは物理削除。リスト枠はアーカイブのみ）。 */
export async function deleteListEntries(listId: number, ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const { error } = await supabase.from("contact_list_entries").delete().in("id", ids);
  if (error) return false;
  await recountContactList(listId);
  return true;
}

/** 選択したレコードを別のリストへコピー（重複はスキップ）。戻り値はコピーできた件数。 */
export async function copyEntriesToList(destListId: number, entries: ListEntry[]): Promise<number> {
  if (entries.length === 0) return 0;
  const rows = entries.map((e) => ({
    list_id: destListId,
    member_id: e.memberId,
    matched_by: e.matchedBy || null,
    email: e.email || null,
    email_norm: e.emailNorm || null,
    phone: e.phone || null,
    phone_e164: e.phoneE164 || null,
    name: e.name,
    age_group: e.ageGroup || null,
    prefecture: e.prefecture || null,
    note1: e.note1,
    note2: e.note2,
    source_kind: e.sourceKind,
    // ⚠️ 同意の記録はコピー先にも引き継ぐ（落とすと同意の根拠が消える）
    consent_at: e.consentAt || null,
    consent_src: e.consentSrc || null,
  }));
  const n = await insertEntriesTolerant(rows);
  if (n > 0) await recountContactList(destListId);
  return n;
}

// ── 所属リスト（顧客情報詳細／要件R9）────────────────────────
/** 会員がどのリストに属しているか */
export interface MemberListMembership {
  listId: number;
  listName: string;
  isArchived: boolean;
  /** そのリストでの登録日時 */
  createdAt: string;
  /** 紐づけの根拠。'member_id'=会員IDで一致 / 'email'=正規化メールで名寄せ */
  matchedBy: "member_id" | "email";
  entryId: number;
}

/**
 * 会員が属しているリストの一覧。
 *
 *   ⚠️ 2通りの引き方を **or でまとめない**。
 *      「会員IDで一致した」のか「メールで名寄せした結果」なのかは
 *      画面で区別して見せる必要がある（名寄せは推定なので、根拠が
 *      見えないと運用側が信用できない）。
 *   ⚠️ 会員マスタは書き換えない（確定事項 No.12=a）。ここは参照のみ。
 */
export async function fetchMemberLists(
  memberId: number,
  memberEmail: string,
): Promise<MemberListMembership[]> {
  const norm = normalizeEmail(memberEmail);

  const byId = supabase
    .from("contact_list_entries")
    .select("id, list_id, created_at, member_id, email_norm")
    .eq("member_id", memberId);
  const byEmail = norm
    ? supabase
        .from("contact_list_entries")
        .select("id, list_id, created_at, member_id, email_norm")
        .eq("email_norm", norm)
    : null;

  const [r1, r2] = await Promise.all([byId, byEmail ?? Promise.resolve({ data: [] as never[] })]);
  const rows = [...(r1.data ?? []), ...(("data" in r2 ? r2.data : []) ?? [])];
  if (rows.length === 0) return [];

  // リスト名は1回でまとめて引く
  const listIds = Array.from(new Set(rows.map((r) => r.list_id)));
  const nameMap = new Map<number, { name: string; isArchived: boolean }>();
  for (const chunk of chunked(listIds, IN_CHUNK)) {
    const { data } = await supabase
      .from("contact_lists").select("id, name, is_archived").in("id", chunk).eq("is_deleted", false);
    for (const l of data ?? []) nameMap.set(l.id, { name: l.name ?? "", isArchived: l.is_archived ?? false });
  }

  // 同じレコードが両方の引き方でヒットするので entryId で1件にまとめる。
  // 根拠は「会員IDで一致」を優先（そちらのほうが確実な情報）。
  const merged = new Map<number, MemberListMembership>();
  for (const r of rows) {
    const meta = nameMap.get(r.list_id);
    if (!meta) continue;   // 論理削除されたリストは出さない
    const matchedBy: "member_id" | "email" = r.member_id === memberId ? "member_id" : "email";
    const cur = merged.get(r.id);
    if (cur && cur.matchedBy === "member_id") continue;
    merged.set(r.id, {
      entryId: r.id, listId: r.list_id, listName: meta.name, isArchived: meta.isArchived,
      createdAt: r.created_at ? String(r.created_at) : "", matchedBy,
    });
  }
  return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 名寄せの再実行：member_id が空のレコードを、正規化メールで会員に紐づける。
 *
 *   ⚠️ 会員マスタ側は**一切書き換えない**（確定事項 No.12=a）。
 *      更新するのは contact_list_entries.member_id / matched_by だけ。
 *   ⚠️ 冪等。何度実行しても、既に紐づいている行は触らない。
 *
 * @param listId 対象リスト（null なら全リスト）
 * @returns 新たに紐づいた件数
 */
export async function rematchListMembers(listId: number | null): Promise<number> {
  let matched = 0;
  let cursor: number | null = null;

  for (;;) {
    let q = supabase
      .from("contact_list_entries")
      .select("id, email, email_norm")
      .is("member_id", null)
      .not("email_norm", "is", null)
      .order("id", { ascending: false })
      .limit(500);
    if (listId != null) q = q.eq("list_id", listId);
    if (cursor != null) q = q.lt("id", cursor);

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;

    const map = await resolveMemberIds(
      data.map((r) => ({ raw: (r.email ?? "").trim(), norm: r.email_norm ?? "" }))
        .filter((p) => p.norm),
    );

    for (const r of data) {
      const mid = map.get(r.email_norm ?? "");
      if (mid == null) continue;
      const { error: e1 } = await supabase
        .from("contact_list_entries")
        .update({ member_id: mid, matched_by: "email", updated_at: new Date().toISOString() })
        .eq("id", r.id);
      if (!e1) matched += 1;
    }

    cursor = data[data.length - 1].id;
    if (data.length < 500) break;
  }
  return matched;
}
