// ============================================================
// アクション実行エンジン（サーバー専用・service role）
//
//   「属性の自動更新」の中核。フォーム回答専用だった runFormActions() を
//   イベント汎用に開いたもの。
//
//   トリガー: 流入経路の付与 / 会員登録 / ログイン / URLクリック / フォーム回答
//   アクション: 属性付与・解除 / シナリオ開始・停止 / チャット送信（既存 FormAction と同型）
//
//   ⚠️ 設計上の約束
//   ① 本流を止めない。クリック計測やログインが、アクション実行の失敗で失敗してはならない。
//      → fireEvent() は例外を投げない（ログに残して握る）。
//   ② 二重付与しない。「claim（行を先に立てる）→ 実行 → 確定」の順にする。
//      実行してからログを書くと、同時リクエストで二重に走る。
//   ③ 無限ループを作らない。attr_add は新たなイベントを発火しない
//      （＝属性付与トリガーは提供しない）。開けると A付与→B付与→A付与 の循環ができる。
//
//   参照: docs/属性自動更新_実装案.md
// ============================================================
import { supabaseAdmin } from "./supabaseAdmin";
import { renderMessage } from "./broadcast";
import { sourceLabeler } from "./sourcesServer";
import { ensureConversation, postChatMessage } from "./chatServer";
import type { Json } from "./database.types";
import type { FormAction } from "./models";

/** アクション仕様（フォームと共通の型。将来 FormAction はこちらへ寄せる） */
export type ActionSpec = FormAction;

export type TriggerType =
  | "source_assigned"   // 会員に流入経路が紐づいた
  | "member_signup"     // 会員登録された
  | "login_first"       // 初回ログイン
  | "login_every"       // ログインのたび
  | "link_click"        // 配信／シナリオのURLがクリックされた
  | "form_submit";      // フォーム回答（既存）

export interface FireCtx {
  trigger: TriggerType;
  memberId: number;
  /** 冪等キー。例: 'source:12' / 'link:b:34' / 'login:first' / 'form:7' */
  refKey: string;
  /** 実行するアクション（解決は呼び出し側の責務） */
  actions: ActionSpec[];
  /** 1人1回だけ発火するか（既定 true） */
  once?: boolean;
}

// ── 発火 ──────────────────────────────────────────────────────

/**
 * イベント発火。該当アクションを実行し、必ずログを残す。
 * **例外を投げない**（呼び出し元の処理は必ず成功させる）。
 */
export async function fireEvent(ctx: FireCtx): Promise<void> {
  if (!ctx.actions?.length) return;
  const once = ctx.once ?? true;

  try {
    // ① claim：先に行を立てて発火権を取る。once の重複は一意インデックスが弾く。
    const { data: claimed, error } = await supabaseAdmin
      .from("action_events")
      .insert({
        member_id: ctx.memberId, trigger_type: ctx.trigger,
        ref_key: ctx.refKey, once, ok: false,
      })
      .select("id").single();

    if (error) {
      // 23505 = 一意違反 → 既に発火済み（正常系）。それ以外は記録だけして黙る。
      if ((error as { code?: string }).code !== "23505") {
        console.error("fireEvent: claim失敗", ctx.trigger, ctx.refKey, error);
      }
      return;
    }
    if (!claimed) return;

    // ② 実行
    try {
      const applied = await runActions(ctx.actions, ctx.memberId);
      await supabaseAdmin.from("action_events")
        .update({ ok: true, applied: applied as unknown as Json }).eq("id", claimed.id);
    } catch (e) {
      // 失敗を残す。once の行は残るが ok=false なので、運用側から再実行できる。
      await supabaseAdmin.from("action_events")
        .update({ ok: false, error: String(e) }).eq("id", claimed.id);
      console.error("fireEvent: 実行失敗", ctx.trigger, ctx.refKey, e);
    }
  } catch (e) {
    // ここまで来たら DB そのものが不調。本流は止めない。
    console.error("fireEvent: 例外", ctx.trigger, e);
  }
}

// ── アクション解決（クリック時：親の link_actions から URL で引く）──

type LinkKind = "broadcast" | "scenario";

/**
 * クリックされたリンクに紐づくアクションを引く。
 *
 * ⚠️ broadcast_links / scenario_links の行は送信のたびに削除→再作成されるため、
 *    アクションは親（broadcasts / scenario_steps）に **URLをキー** として持たせている。
 */
export async function resolveLinkActions(kind: LinkKind, linkId: number): Promise<ActionSpec[]> {
  try {
    if (kind === "broadcast") {
      const { data: link } = await supabaseAdmin
        .from("broadcast_links").select("url, broadcast_id").eq("id", linkId).maybeSingle();
      if (!link) return [];
      const { data: b } = await supabaseAdmin
        .from("broadcasts").select("link_actions").eq("id", link.broadcast_id).maybeSingle();
      return pickByUrl(b?.link_actions, link.url);
    }
    const { data: link } = await supabaseAdmin
      .from("scenario_links").select("url, step_id").eq("id", linkId).maybeSingle();
    if (!link) return [];
    const { data: st } = await supabaseAdmin
      .from("scenario_steps").select("link_actions").eq("id", link.step_id).maybeSingle();
    return pickByUrl(st?.link_actions, link.url);
  } catch (e) {
    console.error("resolveLinkActions", kind, linkId, e);
    return [];
  }
}

/** link_actions（URL→アクション配列のマップ）から該当URLの分を取り出す */
function pickByUrl(map: unknown, url: string): ActionSpec[] {
  if (!map || typeof map !== "object") return [];
  const v = (map as Record<string, unknown>)[url];
  return Array.isArray(v) ? (v as ActionSpec[]) : [];
}

/**
 * 流入経路に紐づくアクションと発火回数。
 *   once=true（既定）… 1人1経路につき1回だけ（action_events の一意インデックスで担保）
 *   once=false        … 踏むたびに発火（チャットは毎回届く）
 */
export async function resolveSourceActions(
  sourceId: number,
): Promise<{ actions: ActionSpec[]; once: boolean }> {
  const { data } = await supabaseAdmin
    .from("sources").select("actions, fire_once").eq("id", sourceId).maybeSingle();
  const v = (data as { actions?: unknown } | null)?.actions;
  return {
    actions: Array.isArray(v) ? (v as ActionSpec[]) : [],
    once: (data as { fire_once?: boolean } | null)?.fire_once ?? true,
  };
}

/**
 * 流入経路イベントを発火する（/s/{key} のクリック・フォーム回答の共通入口）。
 *
 *   ⚠️ once=false のときは refKey を毎回ユニークにする。
 *      同じ refKey のままだと action_events の一意インデックスに関係なく
 *      「1回しか実行されない」ように見えてしまうため（once=false の行は
 *      一意インデックスの対象外だが、ログの可読性のためにも分けておく）。
 */
export async function fireSourceEvent(memberId: number, sourceId: number): Promise<void> {
  const { actions, once } = await resolveSourceActions(sourceId);
  if (!actions.length) return;
  await fireEvent({
    trigger: "source_assigned",
    memberId,
    refKey: once ? `source:${sourceId}` : `source:${sourceId}:${Date.now()}`,
    actions,
    once,
  });
}

/** ログイン時アクション（初回 / 毎回） */
export async function resolveLoginActions(kind: "first" | "every"): Promise<ActionSpec[]> {
  const { data } = await supabaseAdmin
    .from("app_settings").select("login_actions").limit(1).maybeSingle();
  const m = (data as { login_actions?: unknown } | null)?.login_actions;
  if (!m || typeof m !== "object") return [];
  const v = (m as Record<string, unknown>)[kind];
  return Array.isArray(v) ? (v as ActionSpec[]) : [];
}

// ── アクション実行本体（旧 runFormActions）────────────────────

/**
 * アクションを順に実行し、**実際に適用できたもの**を返す（ログ用）。
 * 個々の失敗は握って次へ進む（1つのアクションの失敗で全体を落とさない）。
 */
export async function runActions(actions: ActionSpec[], memberId: number): Promise<ActionSpec[]> {
  const applied: ActionSpec[] = [];
  if (!actions?.length) return applied;

  const { data: mem } = await supabaseAdmin
    .from("members").select("*").eq("id", memberId).maybeSingle();

  for (const a of actions) {
    try {
      switch (a.type) {
        case "attr_add":
          if (a.attrId != null) {
            // 冪等：既にあれば入れない
            const { data: exists } = await supabaseAdmin
              .from("member_attributes").select("member_id")
              .eq("member_id", memberId).eq("attribute_id", a.attrId).maybeSingle();
            if (!exists) {
              await supabaseAdmin.from("member_attributes")
                .insert({ member_id: memberId, attribute_id: a.attrId });
            }
            applied.push(a);
          }
          break;

        case "attr_remove":
          if (a.attrId != null) {
            await supabaseAdmin.from("member_attributes")
              .delete().eq("member_id", memberId).eq("attribute_id", a.attrId);
            applied.push(a);
          }
          break;

        case "scenario_start":
          if (a.scenarioId != null) {
            const { data: e } = await supabaseAdmin
              .from("scenario_entries").select("id")
              .eq("scenario_id", a.scenarioId).eq("member_id", memberId).maybeSingle();
            if (!e) {
              await supabaseAdmin.from("scenario_entries").insert({
                scenario_id: a.scenarioId, member_id: memberId, next_step: 0, status: "active",
              });
            }
            applied.push(a);
          }
          break;

        case "scenario_stop":
          if (a.scenarioId != null) {
            await supabaseAdmin.from("scenario_entries").update({ status: "done" })
              .eq("scenario_id", a.scenarioId).eq("member_id", memberId);
            applied.push(a);
          }
          break;

        case "member_signup":
          // 会員登録は呼び出し側で先に実施済み（ここに来る時点で会員は存在する）
          break;

        case "chat_message":
          if (a.body?.trim() && mem) {
            const body = renderMessage(a.body, {
              name: mem.name, kana: mem.kana ?? "", company: mem.company ?? "",
              email: mem.email ?? "", prefecture: mem.prefecture ?? "", sourceId: mem.source_id ?? null,
            }, await sourceLabeler());
            await sendStaffChat(memberId, body);
            applied.push(a);
          }
          break;
      }
    } catch (e) {
      console.error("アクション実行エラー:", a.type, e);
    }
  }
  return applied;
}

/**
 * 運営（事務局）からのチャットメッセージを送る（自動アクション）。
 *   origin="action" で記録するので、運営画面では「人が書いた返信」と見分けられる。
 *   本文中のURLは chat_links に登録され、会員が踏んだかどうかを追える。
 */
export async function sendStaffChat(memberId: number, body: string): Promise<void> {
  const conversationId = await ensureConversation(memberId);
  if (conversationId == null) return;
  await postChatMessage(conversationId, body, "action");
}
