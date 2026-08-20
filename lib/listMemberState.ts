// ============================================================
// リストのレコードと会員の関係（純ロジック・依存なし）
//
//   確定事項
//     A2 … 会員がメールを変更しても**リストの値は書き換えない**。
//          配信時は会員側の「現在の」アドレスへ送る（記録は当時のまま残す）。
//     A3 … 退会（論理削除）した会員は、レコードは残すが**配信対象から外す**。
//
//   ⚠️ 画面（予告件数）とサーバー（実送信）の両方から使う。
//      ここが分岐すると「予告と実績が食い違う」＝送りすぎ／送り漏れになる。
// ============================================================
import { normalizeEmail } from "./emailNormalize";

/** 配信の宛先解決に必要な会員の最小情報 */
export interface MemberContact {
  id: number;
  email: string;
  isDeleted: boolean;
}

/** レコード1件を配信宛先として解決した結果 */
export interface ResolvedContact {
  /** 実際に送るアドレス（会員に紐づくなら会員の現在のアドレス＝A2） */
  email: string;
  /** 重複判定・停止照合に使う正規化値 */
  emailNorm: string;
  /** 退会会員のため配信対象外（A3） */
  withdrawn: boolean;
  /** 会員の最新アドレスに差し替えたか（画面の説明用） */
  usedMemberEmail: boolean;
}

/**
 * レコードの宛先を解決する。
 *
 * @param entryEmail    リストに記録されている生のアドレス（取り込み当時の値）
 * @param entryNorm     その正規化値
 * @param member        紐づく会員（未紐づけなら null）
 *
 * ⚠️ 会員のアドレスが空・形式不正のときはリスト側の値にフォールバックする
 *    （会員側の不備でリストの宛先まで失うのを防ぐ）。
 */
export function resolveContact(
  entryEmail: string,
  entryNorm: string,
  member: MemberContact | null | undefined,
): ResolvedContact {
  if (member && member.isDeleted) {
    // 退会者は送らない。アドレスは記録のまま返す（画面表示用）
    return { email: entryEmail, emailNorm: entryNorm, withdrawn: true, usedMemberEmail: false };
  }
  if (member) {
    const raw = (member.email ?? "").trim();
    const norm = normalizeEmail(raw);
    if (raw && norm) {
      return { email: raw, emailNorm: norm, withdrawn: false, usedMemberEmail: norm !== entryNorm };
    }
  }
  return { email: entryEmail, emailNorm: entryNorm, withdrawn: false, usedMemberEmail: false };
}
