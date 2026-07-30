// ============================================================
// ボット管理（クライアント側 CRUD）
//   ・ポリシー / 体験版URL は RLS(運営) で直接 supabase。
//   ・索引の再構築だけはサーバー(/api/bot/index)経由（service_role + OpenAI）。
//   ⚠️ bot_* は生成型(database.types)に無いためクライアントをキャストして扱う。
// ============================================================
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase";
import { apiFetch } from "../apiClient";
import type { BotEntry } from "./types";

const sb = supabase as unknown as SupabaseClient;

export interface BotPolicyRow {
  entry: BotEntry;
  daily_limit: number;
  scope_genres: string[];
  web_search: "off" | "assist" | "always";
  max_tokens: number;
  enabled: boolean;
}

export interface ShareLinkRow {
  token: string;
  label: string;
  expires_at: string | null;
  total_limit: number;
  used_count: number;
  passcode: string | null;
  web_search: boolean;
  revoked: boolean;
  created_at: string;
}

// ── ポリシー ──────────────────────────────────────────────────
export async function loadPolicies(): Promise<BotPolicyRow[]> {
  const { data, error } = await sb.from("bot_policies").select("*").order("entry");
  if (error) { console.error("loadPolicies", error); return []; }
  return (data as BotPolicyRow[]) ?? [];
}

export async function savePolicy(entry: BotEntry, patch: Partial<BotPolicyRow>): Promise<boolean> {
  const row: Record<string, unknown> = {};
  if (patch.daily_limit !== undefined) row.daily_limit = patch.daily_limit;
  if (patch.scope_genres !== undefined) row.scope_genres = patch.scope_genres;
  if (patch.web_search !== undefined) row.web_search = patch.web_search;
  if (patch.max_tokens !== undefined) row.max_tokens = patch.max_tokens;
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  const { error } = await sb.from("bot_policies").update(row).eq("entry", entry);
  if (error) { console.error("savePolicy", error); return false; }
  return true;
}

// ── 体験版URL ────────────────────────────────────────────────
export interface CreateShareInput {
  label: string;
  totalLimit: number;
  expiresInDays: number | null;
  passcode: string | null;
  webSearch: boolean;
}

function genToken(): string {
  const uuid = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
  return uuid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 22);
}

export async function loadShareLinks(): Promise<ShareLinkRow[]> {
  const { data, error } = await sb.from("bot_share_links").select("*").order("created_at", { ascending: false });
  if (error) { console.error("loadShareLinks", error); return []; }
  return (data as ShareLinkRow[]) ?? [];
}

export async function createShareLink(input: CreateShareInput): Promise<ShareLinkRow | null> {
  const token = genToken();
  const expires_at = input.expiresInDays != null
    ? new Date(Date.now() + input.expiresInDays * 864e5).toISOString()
    : null;
  const { data, error } = await sb.from("bot_share_links").insert({
    token,
    label: input.label,
    total_limit: input.totalLimit,
    expires_at,
    passcode: input.passcode || null,
    web_search: input.webSearch,
  }).select().single();
  if (error) { console.error("createShareLink", error); return null; }
  return data as ShareLinkRow;
}

export async function revokeShareLink(token: string): Promise<boolean> {
  const { error } = await sb.from("bot_share_links").update({ revoked: true }).eq("token", token);
  if (error) { console.error("revokeShareLink", error); return false; }
  return true;
}

// ── 索引 ──────────────────────────────────────────────────────
export async function indexCount(): Promise<number> {
  const { count } = await sb.from("bot_bm_index").select("bookmark_id", { count: "exact", head: true });
  return count ?? 0;
}

export interface RebuildResult { scanned: number; upserted: number; unchanged: number; pruned: number }

export async function rebuildIndex(): Promise<RebuildResult> {
  const res = await apiFetch("/api/bot/index", { method: "POST" });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error((j as { error?: string }).error ?? "索引の再構築に失敗しました");
  }
  return (await res.json()) as RebuildResult;
}
