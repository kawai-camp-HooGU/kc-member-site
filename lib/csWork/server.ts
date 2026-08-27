// ============================================================
// CsWork：ドキュメントの保存・取得（REQ-028・サーバー専用）
//
//   本文は Storage（非公開バケット cswork）に置き、DB は台帳だけを持つ。
//     cswork_docs  … 1アップロード＝1行。is_current が現行版
//     cswork_audit … upload / activate / reveal の操作ログ
//
//   ⚠️ このファイルは service_role（supabaseAdmin）で動く。呼び出し元で
//      必ず requireOps() / requireAdmin() を通してから使うこと。
//   ⚠️ database.types.ts は未再生成のため from() は文字列指定＋型を自前で持つ。
//      型を再生成したらキャストを外してよい。
// ============================================================
import { supabaseAdmin } from "../supabaseAdmin";

export const CSWORK_BUCKET = "cswork";
export const CSWORK_PROJECT = "kawai-camp";

export type CsWorkKind = "ops" | "design" | "watchlist";

export interface CsWorkDocRow {
  id: string;
  project: string;
  kind: CsWorkKind;
  title: string | null;
  version: string | null;
  filename: string | null;
  storage_path: string;
  bytes: number | null;
  meta: Record<string, unknown> | null;
  is_current: boolean;
  uploaded_by: number | null;
  uploaded_by_name?: string | null;
  uploaded_at: string;
}

const db = () => supabaseAdmin as unknown as {
  from: (t: string) => any;
  storage: typeof supabaseAdmin.storage;
};

/** 種別ごとの現行版（無ければ null）。 */
export async function fetchCurrent(kind: CsWorkKind): Promise<CsWorkDocRow | null> {
  const { data, error } = await db()
    .from("cswork_docs")
    .select("*")
    .eq("project", CSWORK_PROJECT)
    .eq("kind", kind)
    .eq("is_current", true)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.[0] as CsWorkDocRow) ?? null;
}

/** 種別ごとの履歴（新しい順）。 */
export async function fetchHistory(kind: CsWorkKind, limit = 30): Promise<CsWorkDocRow[]> {
  const { data, error } = await db()
    .from("cswork_docs")
    .select("*")
    .eq("project", CSWORK_PROJECT)
    .eq("kind", kind)
    .order("uploaded_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as CsWorkDocRow[];
}

/** Storage から本文を読む。 */
export async function readContent(path: string): Promise<string> {
  const { data, error } = await db().storage.from(CSWORK_BUCKET).download(path);
  if (error || !data) throw new Error(error?.message ?? "本文を取得できませんでした");
  return await data.text();
}

/** 現行版の本文（無ければ null）。 */
export async function readCurrentContent(kind: CsWorkKind): Promise<{ row: CsWorkDocRow; text: string } | null> {
  const row = await fetchCurrent(kind);
  if (!row) return null;
  return { row, text: await readContent(row.storage_path) };
}

interface SaveInput {
  kind: CsWorkKind;
  filename: string;
  text: string;
  title: string;
  version: string;
  meta: Record<string, unknown>;
  memberId: number | null;
  makeCurrent: boolean;
}

/** アップロードを1件保存する（検証を通ったものだけ makeCurrent = true で呼ぶ）。 */
export async function saveDoc(input: SaveInput): Promise<CsWorkDocRow> {
  const id = crypto.randomUUID();
  const ext = input.kind === "watchlist" ? "csv" : "md";
  const path = `${CSWORK_PROJECT}/${input.kind}/${id}.${ext}`;

  const up = await db().storage.from(CSWORK_BUCKET).upload(path, new Blob([input.text], {
    type: ext === "csv" ? "text/csv; charset=utf-8" : "text/markdown; charset=utf-8",
  }), { upsert: false });
  if (up.error) throw new Error(up.error.message);

  if (input.makeCurrent) await clearCurrent(input.kind);

  const { data, error } = await db().from("cswork_docs").insert({
    id,
    project: CSWORK_PROJECT,
    kind: input.kind,
    title: input.title || null,
    version: input.version || null,
    filename: input.filename || null,
    storage_path: path,
    bytes: input.text.length,
    meta: input.meta,
    is_current: input.makeCurrent,
    uploaded_by: input.memberId,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsWorkDocRow;
}

async function clearCurrent(kind: CsWorkKind): Promise<void> {
  const { error } = await db()
    .from("cswork_docs")
    .update({ is_current: false })
    .eq("project", CSWORK_PROJECT)
    .eq("kind", kind)
    .eq("is_current", true);
  if (error) throw new Error(error.message);
}

/** 指定の版を現行版にする（履歴からの復元もこれ）。 */
export async function activateDoc(id: string): Promise<CsWorkDocRow> {
  const { data: rows, error: e1 } = await db().from("cswork_docs").select("*").eq("id", id).limit(1);
  if (e1) throw new Error(e1.message);
  const row = rows?.[0] as CsWorkDocRow | undefined;
  if (!row) throw new Error("指定の版が見つかりません");

  await clearCurrent(row.kind);
  const { data, error } = await db().from("cswork_docs")
    .update({ is_current: true }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsWorkDocRow;
}

/** 操作ログ。失敗しても本処理は止めない（記録の欠落より処理の完了を優先）。 */
export async function audit(
  action: "upload" | "activate" | "reveal" | "download",
  memberId: number | null,
  docId: string | null,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db().from("cswork_audit").insert({
      doc_id: docId, action, actor: memberId, detail,
    });
  } catch {
    // 記録できなくても操作自体は完了させる
  }
}
