// ============================================================
// 体験シナリオ 管理（クライアント側 CRUD）
//   ・RLS(運営) で直接 supabase を触る。既存 botAdmin.ts と同じ作法。
//   ・権限は既存 bot_manage の範囲（新しい権限キーは作らない）。
//   ⚠️ bot_trial_* は生成型(database.types)に無いためクライアントをキャストして扱う。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../../supabase";
import { errMessage } from "../../errors";
import { apiFetch } from "../../apiClient";
import { TRIAL_DEFAULTS, type TrialInputDef, type TrialOutputKind } from "./types";

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

// ============================================================
// シナリオの編集（プロンプトを画面から設定する）
//   ⚠️ JSONを手で書かせない。steps / review は専用のエディタで編み、
//      保存する直前にここで jsonb の形へ組み立てる。
// ============================================================

/** 編集画面が扱うステップ（DBの steps[] の1要素と同じ形） */
export interface StepDraft {
  key: string;
  label: string;
  prompt: string;
  inputs: TrialInputDef[];
}

export interface CriterionDraft { key: string; label: string }

/** 編集画面が扱うシナリオ1件（DBの1行と1対1） */
export interface ScenarioDraft {
  id: number | null;          // null なら新規
  slug: string;
  title: string;
  intro: string;
  cta_label: string;
  output_kind: TrialOutputKind;
  step_limit: number;
  revise_limit: number;
  form_timing: "none" | "entry" | "exit";
  form_id: number | null;
  steps: StepDraft[];
  criteria: CriterionDraft[];
  tone: string;
  model: string;
  max_tokens: number;
}

export function emptyScenario(): ScenarioDraft {
  return {
    id: null, slug: "", title: "", intro: "", cta_label: "はじめる",
    output_kind: "html", step_limit: 1, revise_limit: 3,
    form_timing: "exit", form_id: null,
    steps: [{ key: "draft", label: "つくる", prompt: "", inputs: [] }],
    criteria: [], tone: "", model: "", max_tokens: 1800,
  };
}

interface ScenarioFullRow {
  id: number; slug: string; title: string; intro: string; cta_label: string;
  output_kind: TrialOutputKind; step_limit: number; revise_limit: number;
  form_timing: string; form_id: number | null;
  steps: StepDraft[] | null;
  review: { criteria?: CriterionDraft[]; tone?: string } | null;
  model: string | null; max_tokens: number;
}

export async function loadScenarioFull(id: number): Promise<ScenarioDraft | null> {
  const { data, error } = await sb
    .from("bot_trial_scenarios").select("*").eq("id", id).maybeSingle();
  if (error || !data) { if (error) console.error("loadScenarioFull", error); return null; }
  const r = data as ScenarioFullRow;
  return {
    id: r.id, slug: r.slug, title: r.title, intro: r.intro, cta_label: r.cta_label,
    output_kind: r.output_kind,
    step_limit: r.step_limit, revise_limit: r.revise_limit,
    form_timing: r.form_timing === "entry" || r.form_timing === "none" ? r.form_timing : "exit",
    form_id: r.form_id,
    steps: (r.steps ?? []).map((st) => ({
      key: st.key ?? "", label: st.label ?? "", prompt: st.prompt ?? "",
      inputs: st.inputs ?? [],
    })),
    criteria: r.review?.criteria ?? [],
    tone: r.review?.tone ?? "",
    model: r.model ?? "",
    max_tokens: r.max_tokens,
  };
}

/**
 * 保存できる形か調べる。
 * ⚠️ 保存を止める理由だけを返す。警告（差し込み変数の未使用など）は別に出す。
 */
export function validateScenario(d: ScenarioDraft): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9-]{2,40}$/.test(d.slug)) {
    errs.push("識別子は半角英小文字・数字・ハイフンで2〜40文字にしてください");
  }
  if (!d.title.trim()) errs.push("体験名を入力してください");
  if (d.steps.length === 0) errs.push("ステップが1つもありません");

  const stepKeys = new Set<string>();
  d.steps.forEach((st, i) => {
    const n = i + 1;
    if (!/^[a-z0-9_]{1,30}$/.test(st.key)) errs.push(`ステップ${n}：キーは半角英小文字・数字・_ にしてください`);
    if (stepKeys.has(st.key)) errs.push(`ステップ${n}：キー「${st.key}」が重複しています`);
    stepKeys.add(st.key);
    if (!st.prompt.trim()) errs.push(`ステップ${n}：プロンプトが空です`);

    const inputKeys = new Set<string>();
    st.inputs.forEach((inp, j) => {
      const m = j + 1;
      if (!/^[A-Za-z0-9_]{1,30}$/.test(inp.key)) errs.push(`ステップ${n}の項目${m}：キーは半角英数字と _ にしてください`);
      if (inputKeys.has(inp.key)) errs.push(`ステップ${n}の項目${m}：キー「${inp.key}」が重複しています`);
      inputKeys.add(inp.key);
      if (!inp.label.trim()) errs.push(`ステップ${n}の項目${m}：見出しが空です`);
      if (inp.type === "select" && (inp.options ?? []).length === 0) {
        errs.push(`ステップ${n}の項目${m}：選択肢が1つもありません`);
      }
    });
  });

  const critKeys = new Set<string>();
  d.criteria.forEach((c, i) => {
    if (!/^[A-Za-z0-9_]{1,30}$/.test(c.key)) errs.push(`観点${i + 1}：キーは半角英数字と _ にしてください`);
    if (critKeys.has(c.key)) errs.push(`観点${i + 1}：キー「${c.key}」が重複しています`);
    critKeys.add(c.key);
    if (!c.label.trim()) errs.push(`観点${i + 1}：見出しが空です`);
  });

  if (d.max_tokens < 200 || d.max_tokens > 8000) errs.push("生成の上限は 200〜8000 の範囲にしてください");
  return errs;
}

/**
 * 保存を止めるほどではないが、気づいた方がよいこと。
 * ⚠️ いちばん多い事故は「差し込み変数を宣言したのにプロンプトで使っていない」。
 *    利用者に質問だけさせて、答えが生成に反映されない状態になる。
 */
export function warnScenario(d: ScenarioDraft): string[] {
  const warns: string[] = [];
  d.steps.forEach((st, i) => {
    const used = new Set(Array.from(st.prompt.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)).map((m) => m[1]));
    for (const inp of st.inputs) {
      if (!used.has(inp.key)) {
        warns.push(`ステップ${i + 1}：項目「${inp.label || inp.key}」を聞いていますが、プロンプトで {{${inp.key}}} を使っていません`);
      }
    }
    for (const u of used) {
      if (!st.inputs.some((inp) => inp.key === u)) {
        warns.push(`ステップ${i + 1}：プロンプトの {{${u}}} に対応する項目がありません（空文字に置き換わります）`);
      }
    }
  });
  if (d.form_timing !== "none" && d.form_id == null) {
    warns.push("提出のフォームが未設定です。このままだと提出ボタンが出ません");
  }
  if (d.output_kind === "image") {
    warns.push("画像は1生成あたりの費用がテキストより高くつきます。発行時の回数設定に注意してください");
  }
  return warns;
}

/** 新規作成／更新。戻り値は保存後の id。 */
export async function saveScenario(d: ScenarioDraft): Promise<{ id: number | null; error?: string }> {
  const row = {
    slug: d.slug.trim(),
    title: d.title.trim(),
    intro: d.intro,
    cta_label: d.cta_label.trim() || "はじめる",
    output_kind: d.output_kind,
    step_limit: Math.max(1, d.step_limit),
    revise_limit: Math.max(0, d.revise_limit),
    form_timing: d.form_timing,
    form_id: d.form_id,
    steps: d.steps.map((st) => ({
      key: st.key, label: st.label, prompt: st.prompt,
      inputs: st.inputs.map((i) => ({
        key: i.key, label: i.label, type: i.type,
        ...(i.type === "select" ? { options: i.options ?? [] } : {}),
        ...(i.maxLength ? { maxLength: i.maxLength } : {}),
        ...(i.placeholder ? { placeholder: i.placeholder } : {}),
      })),
    })),
    review: { criteria: d.criteria, tone: d.tone },
    model: d.model.trim() || null,
    max_tokens: d.max_tokens,
    updated_at: new Date().toISOString(),
  };

  if (d.id == null) {
    const { data, error } = await sb.from("bot_trial_scenarios").insert(row).select("id").single();
    if (error) return { id: null, error: error.message };
    return { id: (data as { id: number }).id };
  }
  const { error } = await sb.from("bot_trial_scenarios").update(row).eq("id", d.id);
  if (error) return { id: null, error: error.message };
  return { id: d.id };
}

/**
 * 使わなくなったシナリオを片づける。
 * ⚠️ 物理削除しない（develop.md §2-2「マスタは論理削除する」）。
 *    過去の体験の履歴が参照しているため、消すと辿れなくなる。
 */
export async function retireScenario(id: number): Promise<boolean> {
  const { error } = await sb.from("bot_trial_scenarios")
    .update({ is_deleted: true, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) { console.error("retireScenario", error); return false; }
  return true;
}

/** 提出フォームの候補（公開中のフォームだけ出す） */
export async function loadFormOptions(): Promise<{ id: number; name: string }[]> {
  const { data, error } = await sb
    .from("forms").select("id, name, status").eq("status", "published").order("id", { ascending: false });
  if (error) { console.error("loadFormOptions", error); return []; }
  return ((data as { id: number; name: string }[]) ?? []).map((f) => ({ id: f.id, name: f.name }));
}

// ── プレビューと試し生成 ──────────────────────────────────────
export interface PreviewRes {
  /** 実際にAIへ渡る system 全文 */
  system: string;
  /** 実際にAIへ渡る user 全文（差し込み済み・タグ包み済み） */
  user: string;
  /** run=true のときだけ。試しに生成した結果 */
  output?: string;
}

/**
 * 組み立て結果を見る。run=true なら実際に1回だけ生成する。
 * ⚠️ 試し生成は費用がかかる。運営のみ・レート制限つき（サーバー側で担保）。
 */
export async function previewPrompt(input: {
  draft: ScenarioDraft; stepIndex: number; values: Record<string, string>; run: boolean;
}): Promise<PreviewRes> {
  try {
    const res = await apiFetch("/api/trial/preview", { method: "POST", body: input });
    const json = (await res.json().catch(() => ({}))) as PreviewRes & { error?: string };
    if (!res.ok) throw new Error(json.error ?? "プレビューを取得できませんでした");
    return json;
  } catch (e: unknown) {
    throw new Error(errMessage(e, "プレビューを取得できませんでした"));
  }
}
