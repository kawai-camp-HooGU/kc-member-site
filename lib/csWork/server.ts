// ============================================================
// CsWork：ドキュメントの保存・取得（REQ-028 → REQ-039 で拡張・サーバー専用）
//
//   本文は Storage（非公開バケット cswork）に置き、DB は台帳だけを持つ。
//     cswork_docs  … 1アップロード＝1行。is_current が現行版
//     cswork_audit … upload / activate / reveal / approve / run_ingest … の操作ログ
//
//   REQ-039 で扱う種別が増えた。
//     source   … 人が書いたラフmd（原本）
//     spec     … 整形された正規形（JSON）
//     settings … 運用設定値のスナップショット（YAML・秘密を含む）
//     runbook  … エージェント指示ファイル（md・runner ごとに現行版を1本）
//
//   ⚠️ このファイルは service_role（supabaseAdmin）で動く。呼び出し元で
//      必ず requireOps() / requireAdmin() を通してから使うこと。
//   ⚠️ database.types.ts は未再生成のため from() は文字列指定＋型を自前で持つ。
//      型を再生成したらキャストを外してよい。
//   ⚠️ runbook だけは runner ごとに現行版を持つ。現行版の一意制約も
//      (project, kind, coalesce(runner,'')) で張ってある（migration_add_cswork_loop.sql）。
// ============================================================
import { supabaseAdmin } from "../supabaseAdmin";
import { parseYaml } from "./parse";
import { buildOps, SETTINGS_HEADING } from "./build";

export const CSWORK_BUCKET = "cswork";
export const CSWORK_PROJECT = "kawai-camp";

export type CsWorkKind = "ops" | "design" | "watchlist" | "source" | "spec" | "settings" | "runbook";

export const CSWORK_KINDS: readonly CsWorkKind[] =
  ["ops", "design", "watchlist", "source", "spec", "settings", "runbook"];

/** 種別ごとの拡張子。Storage のパスと Content-Type に使う。 */
const EXT: Record<CsWorkKind, string> = {
  ops: "md", design: "md", watchlist: "csv",
  source: "md", spec: "json", settings: "yaml", runbook: "md",
};

const MIME: Record<string, string> = {
  md: "text/markdown; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  yaml: "text/yaml; charset=utf-8",
};

export type CsWorkAction =
  | "upload" | "activate" | "reveal" | "download"
  | "normalize" | "approve" | "generate_runbook" | "run_ingest" | "decide" | "close_issue";

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
  /** REQ-039：承認1回で source / spec / settings / runbook を束ねる版 */
  doc_version: string | null;
  parent_id: string | null;
  runner: string | null;
  approved_by: number | null;
  approved_at: string | null;
}

const db = () => supabaseAdmin as unknown as {
  from: (t: string) => any;
  storage: typeof supabaseAdmin.storage;
};

/** 種別ごとの現行版（無ければ null）。runbook は runner を指定する。 */
export async function fetchCurrent(kind: CsWorkKind, runner?: string): Promise<CsWorkDocRow | null> {
  let q = db()
    .from("cswork_docs")
    .select("*")
    .eq("project", CSWORK_PROJECT)
    .eq("kind", kind)
    .eq("is_current", true);
  if (runner) q = q.eq("runner", runner);

  const { data, error } = await q.order("uploaded_at", { ascending: false }).limit(1);
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
export async function readCurrentContent(
  kind: CsWorkKind,
  runner?: string,
): Promise<{ row: CsWorkDocRow; text: string } | null> {
  const row = await fetchCurrent(kind, runner);
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
  /** REQ-039 */
  docVersion?: string | null;
  parentId?: string | null;
  runner?: string | null;
  approvedBy?: number | null;
}

/** アップロードを1件保存する（検証を通ったものだけ makeCurrent = true で呼ぶ）。 */
export async function saveDoc(input: SaveInput): Promise<CsWorkDocRow> {
  const id = crypto.randomUUID();
  const ext = EXT[input.kind] ?? "md";
  const path = `${CSWORK_PROJECT}/${input.kind}/${id}.${ext}`;

  const up = await db().storage.from(CSWORK_BUCKET).upload(path, new Blob([input.text], {
    type: MIME[ext] ?? "text/plain; charset=utf-8",
  }), { upsert: false });
  if (up.error) throw new Error(up.error.message);

  const runner = input.kind === "runbook" ? (input.runner ?? null) : null;
  if (input.makeCurrent) await clearCurrent(input.kind, runner);

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
    doc_version: input.docVersion ?? null,
    parent_id: input.parentId ?? null,
    runner,
    approved_by: input.approvedBy ?? null,
    approved_at: input.approvedBy != null ? new Date().toISOString() : null,
  }).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsWorkDocRow;
}

async function clearCurrent(kind: CsWorkKind, runner: string | null): Promise<void> {
  let q = db()
    .from("cswork_docs")
    .update({ is_current: false })
    .eq("project", CSWORK_PROJECT)
    .eq("kind", kind)
    .eq("is_current", true);
  if (runner) q = q.eq("runner", runner);

  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** 指定の版を現行版にする（履歴からの復元もこれ）。 */
export async function activateDoc(id: string): Promise<CsWorkDocRow> {
  const { data: rows, error: e1 } = await db().from("cswork_docs").select("*").eq("id", id).limit(1);
  if (e1) throw new Error(e1.message);
  const row = rows?.[0] as CsWorkDocRow | undefined;
  if (!row) throw new Error("指定の版が見つかりません");

  await clearCurrent(row.kind, row.runner);
  const { data, error } = await db().from("cswork_docs")
    .update({ is_current: true }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as CsWorkDocRow;
}

/**
 * 次の doc_version を決める。現行 spec の版を 0.1 進める。
 *   ⚠️ 版はポータルが採番する。人が spec JSON に書いた doc_version は採用しない
 *      （外部で作られた spec が版を飛ばすと、run との紐づけが壊れるため）。
 */
export async function nextDocVersion(): Promise<string> {
  const cur = await fetchCurrent("spec");
  const base = (cur?.doc_version ?? "0.0").trim();
  const m = /^(\d+)\.(\d+)$/.exec(base);
  if (!m) return "1.0";
  return `${m[1]}.${Number(m[2]) + 1}`;
}

// ── 運用設定値の解決 ──────────────────────────────────────
/**
 * 運用設定値を1か所で解決する。
 *   1. settings 種別の現行版（REQ-039 で切り出した YAML）
 *   2. 無ければ導線種別md（REQ-028 の ops）の「# 運用設定値」から読む
 *
 *   ⚠️ 2 のフォールバックがあるおかげで、移行の途中でも設定値の再登録を
 *      待たずに新しい画面が動く。並走期間（確定6）を成立させるための橋。
 */
export async function loadSettings(): Promise<{ settings: Record<string, unknown>; yaml: string; from: "settings" | "ops" | "none" }> {
  const settingsDoc = await readCurrentContent("settings");
  if (settingsDoc) {
    const parsed = parseYaml(settingsDoc.text);
    return {
      settings: parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {},
      yaml: settingsDoc.text,
      from: "settings",
    };
  }

  const opsDoc = await readCurrentContent("ops");
  if (opsDoc) {
    return {
      settings: buildOps(opsDoc.text).settings as Record<string, unknown>,
      yaml: extractSettingsBlock(opsDoc.text),
      from: "ops",
    };
  }

  return { settings: {}, yaml: "", from: "none" };
}

/**
 * 導線種別md から「# 運用設定値」以降を切り出す。
 *   承認のたびに、その時点の設定値をスナップショットとして残すために使う。
 *   URLを直した後で過去の失敗を再現できるようにするのが目的（設計書 §5-2）。
 */
export function extractSettingsBlock(md: string): string {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((l) => new RegExp(`^\\s*#\\s+${SETTINGS_HEADING}\\s*$`).test(l));
  if (start < 0) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^\s*#\s+/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** 操作ログ。失敗しても本処理は止めない（記録の欠落より処理の完了を優先）。 */
export async function audit(
  action: CsWorkAction,
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
