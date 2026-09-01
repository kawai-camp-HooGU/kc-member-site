// ============================================================
// 体験シナリオ 管理（クライアント側 CRUD）
//   ・RLS(運営) で直接 supabase を触る。既存 botAdmin.ts と同じ作法。
//   ・権限は既存 bot_manage の範囲（新しい権限キーは作らない）。
//   ⚠️ bot_trial_* は生成型(database.types)に無いためクライアントをキャストして扱う。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { TRIAL_DEFAULTS, type TrialOutputKind } from "./types";

const sb = supabase as unknown as SupabaseClient;

/** 発行画面のプルダウンに出すぶんだけ。steps / review は編集画面で扱う。 */
export interface TrialScenarioRow {
  id: number;
  slug: string;
  title: string;
  output_kind: TrialOutputKind;
  revise_limit: number;
  form_timing: string;
  is_deleted: boolean;
}

export async function loadScenarios(): Promise<TrialScenarioRow[]> {
  const { data, error } = await sb
    .from("bot_trial_scenarios")
    .select("id, slug, title, output_kind, revise_limit, form_timing, is_deleted")
    .eq("is_deleted", false)
    .order("id");
  if (error) { console.error("loadScenarios", error); return []; }
  return (data as TrialScenarioRow[]) ?? [];
}

// ── 発行時の独自設定（bot_share_links.settings）──────────────
/**
 * 画面の入力から settings(jsonb) を組み立てる。
 * ⚠️ 1人あたりの上限は settings、URL全体の上限は列（gen_limit）に持つ。
 *    URL全体は費用の集計対象になるため列に出す（develop.md §4）。
 */
export interface TrialIssueInput {
  scenarioId: number | null;
  perUserChatLimit: number;
  perUserGenLimit: number;
  assumedUsers: number;
  /** 空なら perUserGenLimit × assumedUsers を使う */
  genLimit: number | null;
  reviseLimit: number | null;
  intro: string;
  quality: string;
  ctaUrl: string;
}

export function buildTrialSettings(input: TrialIssueInput): Record<string, unknown> {
  const s: Record<string, unknown> = {
    per_user_chat_limit: input.perUserChatLimit,
    per_user_gen_limit: input.perUserGenLimit,
    ip_multiplier: TRIAL_DEFAULTS.ipMultiplier,
    quality: input.quality,
  };
  if (input.reviseLimit != null) s.revise_limit = input.reviseLimit;
  if (input.intro.trim()) s.intro = input.intro.trim();
  if (input.ctaUrl.trim()) s.cta_url = input.ctaUrl.trim();
  return s;
}

/** URL全体の上限＝1人あたり × 想定人数（運営が手で下げられる） */
export function computeUrlLimits(input: { perUserChatLimit: number; perUserGenLimit: number; assumedUsers: number }): {
  totalLimit: number; genLimit: number;
} {
  const users = Math.max(1, input.assumedUsers);
  return {
    totalLimit: Math.max(1, input.perUserChatLimit * users),
    genLimit: Math.max(1, input.perUserGenLimit * users),
  };
}
