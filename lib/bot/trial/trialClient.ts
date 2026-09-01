// ============================================================
// 体験シナリオ クライアント（画面から呼ぶ薄い層）
//   ・自前APIは必ず apiFetch を経由する（生 fetch にしない：develop.md §12）。
//   ・未ログインでも動く。apiFetch はトークンが無ければ付けずに送る。
// ============================================================
import { apiFetch } from "../../apiClient";
import { errMessage } from "../../errors";
import type {
  TrialGenerateRes, TrialScenarioPublic, TrialStartRes, TrialStatusRes,
} from "./types";

export interface TrialScenarioRes {
  scenario: TrialScenarioPublic;
  remainingGen: number;
  remainingRevise: number;
}

interface ApiError { error?: string }

async function unwrap<T>(res: Response, fallback: string): Promise<T> {
  const json = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) throw new Error(json.error ?? fallback);
  return json;
}

/**
 * 体験の説明だけを取る（run は作らない）。
 * シナリオが設定されていない体験版URLでは 404 が返る。呼び出し側は null 扱いにする。
 */
export async function fetchTrialScenario(input: {
  shareToken: string; passcode: string | null;
}): Promise<TrialScenarioRes | null> {
  const q = new URLSearchParams({ shareToken: input.shareToken });
  if (input.passcode) q.set("passcode", input.passcode);
  const res = await apiFetch(`/api/trial/scenario?${q.toString()}`);
  if (res.status === 404 || res.status === 503) return null;
  return await unwrap<TrialScenarioRes>(res, "体験の情報を取得できませんでした。");
}

export async function startTrial(input: {
  shareToken: string; passcode: string | null;
}): Promise<TrialStartRes> {
  try {
    const res = await apiFetch("/api/trial/start", { method: "POST", body: input });
    return await unwrap<TrialStartRes>(res, "体験を開始できませんでした。");
  } catch (e: unknown) {
    throw new Error(errMessage(e, "体験を開始できませんでした。"));
  }
}

export async function generateArtifact(input: {
  runId: number; shareToken: string; passcode: string | null;
  inputs?: Record<string, string> | null; instruction?: string | null;
}): Promise<TrialGenerateRes> {
  try {
    const res = await apiFetch("/api/trial/generate", { method: "POST", body: input });
    return await unwrap<TrialGenerateRes>(res, "作成できませんでした。");
  } catch (e: unknown) {
    throw new Error(errMessage(e, "作成できませんでした。"));
  }
}

export async function fetchTrialStatus(input: {
  runId: number; shareToken: string; passcode: string | null;
}): Promise<TrialStatusRes> {
  const q = new URLSearchParams({
    runId: String(input.runId),
    shareToken: input.shareToken,
  });
  if (input.passcode) q.set("passcode", input.passcode);
  const res = await apiFetch(`/api/trial/status?${q.toString()}`);
  return await unwrap<TrialStatusRes>(res, "状態を取得できませんでした。");
}
