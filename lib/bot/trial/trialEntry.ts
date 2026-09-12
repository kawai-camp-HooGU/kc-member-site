// ============================================================
// /api/trial/* の共通処理（サーバー専用）
//   入口の検証（体験版URL・パスコード・シナリオ）と主体キーの解決を1か所に集める。
//   ⚠️ 未ログインで到達する公開エンドポイント。ここが認可そのものになる。
// ============================================================
import { HttpError } from "../../authz";
import { assertShareUsable } from "../botServer";
import {
  loadScenario, loadTrialLink, resolveSettings,
  readVisitorId, newVisitorId, deviceSubjectKey, ipSubjectKey,
  type ScenarioRow, type TrialSettings, type TrialShareLink,
} from "./trialServer";

export interface TrialCtx {
  link: TrialShareLink;
  scenario: ScenarioRow;
  settings: TrialSettings;
  deviceKey: string;
  ipKey: string;
  /** Cookie を新規発行したか（レスポンスに Set-Cookie を足す） */
  visitorId: string;
  isNewVisitor: boolean;
}

function clientIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for") ?? "";
  return fwd.split(",")[0].trim() || (request.headers.get("x-real-ip") ?? "");
}

/**
 * 体験版URL → シナリオ → 主体キー まで解決する。
 * ⚠️ scenario_id が null の体験版URLは体験レーンを持たない（後方互換）。
 *    従来のQ&Aボットとして動かすため、ここでは 404 相当を返す。
 */
export async function resolveTrialCtx(request: Request, input: {
  shareToken: string; passcode?: string | null;
}): Promise<TrialCtx> {
  if (process.env.BOT_PUBLIC_ENABLED !== "true") {
    throw new HttpError(503, "体験版は現在準備中です。");
  }
  const token = (input.shareToken ?? "").trim();
  if (!token) throw new HttpError(400, "体験版URLが正しくありません。");

  const link = await loadTrialLink(token);
  assertShareUsable(link);
  if (link.passcode && link.passcode !== (input.passcode ?? "")) {
    throw new HttpError(403, "パスコードが違います。");
  }

  const scenario = await loadScenario(link.scenario_id);
  if (!scenario) throw new HttpError(404, "この体験版URLには体験が設定されていません。");

  const settings = resolveSettings(link, scenario);

  const existing = readVisitorId(request);
  const visitorId = existing ?? newVisitorId();

  return {
    link, scenario, settings,
    deviceKey: deviceSubjectKey(visitorId),
    ipKey: ipSubjectKey(clientIp(request), request.headers.get("user-agent") ?? ""),
    visitorId,
    isNewVisitor: existing == null,
  };
}
