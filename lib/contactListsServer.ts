// ============================================================
// リスト管理：サーバー専用の夜間メンテナンス（Phase 5）
//   ① 取込の失敗行（error_rows）の 30 日パージ
//   ② 会員との名寄せ（member_id が空のレコードを正規化メールで紐づける）
//
//   ⚠️ このファイルは **service role** を使うためサーバー専用。
//      クライアント（"use client"）から import してはいけない。
//   ⚠️ 正規化規則は lib/emailNormalize.ts に集約している（画面と同じ規則を使う）。
//      ここで別実装を書くと「画面では紐づくのに夜間バッチでは紐づかない」が起きる。
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { normalizeEmail } from "./emailNormalize";

/** 失敗行の保持日数（設計書：30日）。環境変数で上書きできる。 */
export const ERROR_ROWS_RETENTION_DAYS = 30;

/** 1回のページング件数 */
const PAGE = 500;
/** in() はURL長の制限があるため分割して引く（クライアント側と同じ 200） */
const IN_CHUNK = 200;

function chunked<T>(arr: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size) as T[]);
  return out;
}

/**
 * 取込ジョブの失敗行を保持期間を過ぎたものから空にする。
 *
 * ⚠️ ジョブ自体（件数・実行者・結果）は消さない。消すのは
 *    **個人情報を含む失敗行の中身だけ**（error_rows）。
 *    取込履歴が消えると「いつ何件入れたか」が追えなくなるため。
 * ⚠️ 何度実行しても同じ結果になる（既に空の行は対象外）。
 */
export async function purgeImportErrorRows(days?: number): Promise<{ purged: number }> {
  const keep = Number(process.env.LIST_ERROR_ROWS_RETENTION_DAYS) || days || ERROR_ROWS_RETENTION_DAYS;
  const cut = new Date(Date.now() - keep * 86_400_000).toISOString();

  // ⚠️ jsonb の「空配列でない」を PostgREST の neq で書くと表現がぶれるため、
  //    候補を id と error_rows で読んでからアプリ側で判定する（確実で安全）。
  const { data, error } = await supabaseAdmin
    .from("contact_list_imports")
    .select("id, error_rows")
    .lt("created_at", cut)
    .limit(5000);
  if (error || !data) return { purged: 0 };

  const targets = data
    .filter((r) => Array.isArray(r.error_rows) && (r.error_rows as unknown[]).length > 0)
    .map((r) => r.id);
  if (targets.length === 0) return { purged: 0 };

  let purged = 0;
  for (const chunk of chunked(targets, IN_CHUNK)) {
    const { data: done, error: e1 } = await supabaseAdmin
      .from("contact_list_imports")
      .update({ error_rows: [] as unknown as never })
      .in("id", chunk)
      .select("id");
    if (!e1) purged += done?.length ?? 0;
  }
  return { purged };
}

/**
 * 名寄せの夜間バッチ（全リスト）。
 *
 *   ⚠️ 会員マスタ側は**一切書き換えない**（確定事項 No.12=a）。
 *      更新するのは contact_list_entries.member_id / matched_by だけ。
 *   ⚠️ 冪等。既に紐づいている行（member_id が入っている行）は読まない。
 *   ⚠️ 退会（is_deleted）した会員には紐づけない。紐づけてしまうと
 *      配信時に A3（退会除外）で落ちて、件数の内訳が実態とずれる。
 *
 * @param maxRows 1回の実行で処理する上限（関数タイムアウト対策）
 */
export async function rematchAllListMembers(maxRows = 5000): Promise<{ scanned: number; matched: number }> {
  let scanned = 0;
  let matched = 0;
  let cursor: number | null = null;

  for (;;) {
    if (scanned >= maxRows) break;

    let q = supabaseAdmin
      .from("contact_list_entries")
      .select("id, email, email_norm")
      .is("member_id", null)
      .not("email_norm", "is", null)
      .order("id", { ascending: false })
      .limit(PAGE);
    if (cursor != null) q = q.lt("id", cursor);

    const { data, error } = await q;
    if (error || !data || data.length === 0) break;
    scanned += data.length;

    const map = await resolveMemberIdsServer(
      data.map((r) => ({ raw: (r.email ?? "").trim(), norm: r.email_norm ?? "" })).filter((p) => p.norm),
    );

    for (const r of data) {
      const mid = map.get(r.email_norm ?? "");
      if (mid == null) continue;
      const { error: e1 } = await supabaseAdmin
        .from("contact_list_entries")
        .update({ member_id: mid, matched_by: "email", updated_at: new Date().toISOString() })
        .eq("id", r.id);
      if (!e1) matched += 1;
    }

    cursor = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return { scanned, matched };
}

/**
 * 正規化メール → members.id。
 * ⚠️ members 側に正規化列が無いため、生の値と正規化値の両方で引いてから
 *    アプリ側で正規化して突き合わせる（Gmail のドット表記も拾うため）。
 *    クライアントの resolveMemberIds() と同じ規則。
 */
async function resolveMemberIdsServer(
  pairs: { raw: string; norm: string }[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const wanted = new Set(pairs.map((p) => p.norm).filter(Boolean));
  if (wanted.size === 0) return map;

  const candidates = Array.from(new Set(pairs.flatMap((p) => [p.raw, p.norm]).filter(Boolean)));
  for (const chunk of chunked(candidates, IN_CHUNK)) {
    const { data } = await supabaseAdmin
      .from("members")
      .select("id, email")
      .eq("is_deleted", false)
      .in("email", chunk);
    for (const m of data ?? []) {
      const n = normalizeEmail(m.email);
      if (n && wanted.has(n) && !map.has(n)) map.set(n, m.id);
    }
  }
  return map;
}

/** 夜間メンテナンスの一括実行（cron から呼ぶ） */
export async function runListMaintenance(): Promise<{
  purgedErrorRows: number;
  rematchScanned: number;
  rematchMatched: number;
}> {
  const { purged } = await purgeImportErrorRows();
  const { scanned, matched } = await rematchAllListMembers();
  return { purgedErrorRows: purged, rematchScanned: scanned, rematchMatched: matched };
}
