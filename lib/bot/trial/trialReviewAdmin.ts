// ============================================================
// 体験の提出と講評（運営側 CRUD・クライアント）
//   ・RLS(運営) で直接 supabase を読む。既存 botAdmin.ts と同じ作法。
//   ・講評の「送信」だけはサーバー（/api/trial/review）を通す。
//     利用者へメールが飛ぶ＝外向きの作用があるため。
//   ・権限は既存 bot_manage の範囲（新しい権限キーは作らない）。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { apiFetch } from "../../apiClient";
import { errMessage } from "../../errors";
import type { TrialOutputKind, TrialStatus } from "./types";

const sb = supabase as unknown as SupabaseClient;

export interface SubmissionRow {
  id: number;
  share_token: string;
  scenario_id: number;
  status: TrialStatus;
  submitted_at: string | null;
  member_id: number | null;
  submission_id: number | null;
  gen_count: number;
  revise_count: number;
  inputs: Record<string, string>;
  /** 結合して埋める */
  scenarioTitle: string;
  linkLabel: string;
  memberName: string;
  /** 講評が送信済みか */
  reviewed: boolean;
}

export interface ArtifactRow {
  id: number;
  revision: number;
  kind: TrialOutputKind;
  body: string;
  storage_path: string | null;
  instruction: string;
  created_at: string;
}

export interface ReviewRow {
  id: number;
  run_id: number;
  artifact_id: number;
  reviewer_id: number | null;
  scores: Record<string, number>;
  comment: string;
  sent_at: string | null;
}

export interface ReviewCriterion { key: string; label: string }

/**
 * 提出の一覧。
 * ⚠️ 未講評を先頭にする（運営が見るべきものが上にある状態を既定にする）。
 */
export async function loadSubmissions(limit = 100): Promise<SubmissionRow[]> {
  const { data, error } = await sb
    .from("bot_trial_runs")
    .select("id, share_token, scenario_id, status, submitted_at, member_id, submission_id, gen_count, revise_count, inputs")
    .not("submitted_at", "is", null)
    .order("submitted_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("loadSubmissions", error); return []; }
  const runs = (data as Omit<SubmissionRow, "scenarioTitle" | "linkLabel" | "memberName" | "reviewed">[]) ?? [];
  if (runs.length === 0) return [];

  // 参照を1回ずつ引いて突き合わせる（件数が少ないので N+1 にしない）
  const scenarioIds = Array.from(new Set(runs.map((r) => r.scenario_id)));
  const tokens = Array.from(new Set(runs.map((r) => r.share_token)));
  const memberIds = Array.from(new Set(runs.map((r) => r.member_id).filter((v): v is number => v != null)));
  const runIds = runs.map((r) => r.id);

  const [scen, links, members, reviews] = await Promise.all([
    sb.from("bot_trial_scenarios").select("id, title").in("id", scenarioIds),
    sb.from("bot_share_links").select("token, label").in("token", tokens),
    memberIds.length ? sb.from("members").select("id, name").in("id", memberIds) : Promise.resolve({ data: [] }),
    sb.from("bot_trial_reviews").select("run_id, sent_at").in("run_id", runIds),
  ]);

  const titleOf = new Map((scen.data as { id: number; title: string }[] ?? []).map((r) => [r.id, r.title]));
  const labelOf = new Map((links.data as { token: string; label: string }[] ?? []).map((r) => [r.token, r.label]));
  const nameOf = new Map((members.data as { id: number; name: string }[] ?? []).map((r) => [r.id, r.name]));
  const sentOf = new Set(
    ((reviews.data as { run_id: number; sent_at: string | null }[]) ?? [])
      .filter((r) => r.sent_at != null).map((r) => r.run_id),
  );

  const rows = runs.map((r) => ({
    ...r,
    scenarioTitle: titleOf.get(r.scenario_id) ?? "（削除されたシナリオ）",
    linkLabel: labelOf.get(r.share_token) ?? "",
    memberName: r.member_id != null ? (nameOf.get(r.member_id) ?? "") : "",
    reviewed: sentOf.has(r.id),
  }));
  // 未講評を先頭へ。同じ区分の中は提出が新しい順のまま。
  return [...rows.filter((r) => !r.reviewed), ...rows.filter((r) => r.reviewed)];
}

/** 1件ぶんの成果物（全リビジョン。調整の履歴が見える） */
export async function loadArtifacts(runId: number): Promise<ArtifactRow[]> {
  const { data, error } = await sb
    .from("bot_trial_artifacts")
    .select("id, revision, kind, body, storage_path, instruction, created_at")
    .eq("run_id", runId)
    .order("revision", { ascending: true });
  if (error) { console.error("loadArtifacts", error); return []; }
  return (data as ArtifactRow[]) ?? [];
}

/** 画像の署名URL（非公開バケットなので毎回作る） */
export async function signArtifactUrl(path: string): Promise<string | null> {
  const { data } = await sb.storage.from("trial-artifacts").createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}

export async function loadReview(runId: number): Promise<ReviewRow | null> {
  const { data } = await sb
    .from("bot_trial_reviews")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as ReviewRow | null) ?? null;
}

/** シナリオが持つ講評の観点（記入欄の見出しになる） */
export async function loadCriteria(scenarioId: number): Promise<ReviewCriterion[]> {
  const { data } = await sb
    .from("bot_trial_scenarios")
    .select("review")
    .eq("id", scenarioId)
    .maybeSingle();
  const review = (data as { review?: { criteria?: ReviewCriterion[] } } | null)?.review;
  return review?.criteria ?? [];
}

/**
 * 講評の下書きを保存する（送信はしない）。
 * ⚠️ 送信前は何度でも直せる。sent_at は触らない。
 */
export async function saveReviewDraft(input: {
  runId: number; artifactId: number; scores: Record<string, number>; comment: string;
}): Promise<boolean> {
  const existing = await loadReview(input.runId);
  if (existing && existing.sent_at == null) {
    const { error } = await sb.from("bot_trial_reviews")
      .update({ artifact_id: input.artifactId, scores: input.scores, comment: input.comment })
      .eq("id", existing.id);
    if (error) { console.error("saveReviewDraft", error); return false; }
    return true;
  }
  if (existing && existing.sent_at != null) {
    console.warn("送信済みの講評は書き換えない");
    return false;
  }
  const { error } = await sb.from("bot_trial_reviews").insert({
    run_id: input.runId, artifact_id: input.artifactId,
    scores: input.scores, comment: input.comment,
  });
  if (error) { console.error("saveReviewDraft", error); return false; }
  return true;
}

/**
 * 講評を送信する。
 * ⚠️ 利用者へメールが飛ぶ＝外向きの作用。必ずサーバー経由（requireOps）で行う。
 */
export async function sendReview(runId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await apiFetch("/api/trial/review", { method: "POST", body: { runId } });
    const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok) return { ok: false, error: json.error ?? "送信できませんでした" };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: errMessage(e, "送信できませんでした") };
  }
}
