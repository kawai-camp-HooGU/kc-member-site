// ============================================================
// リッチメッセージ → LINE Messaging API のメッセージオブジェクト変換（Phase 7①）
//   ・text / image / buttons(テンプレート) / carousel(テンプレート) に対応。
//   ・ボタンのアクションはリッチメニューと同じ種別（liff / liff_mypage / uri / message）。
//   ・クイックリプライは text/buttons/carousel に付与できる。
//   ⚠️ サーバー/クライアント両用の純関数（DB・秘密に触れない）。送信は lineClient が行う。
// ============================================================
import type { RichMessage, RichMsgButton } from "./models";

/** ボタン1つを LINE の action オブジェクトへ。無効なら null（呼び出し側で除外）。 */
function actionObj(b: RichMsgButton, liffId: string): Record<string, unknown> | null {
  const label = (b.label || "開く").slice(0, 20);
  const v = (b.actionValue || "").trim();
  switch (b.actionType) {
    case "liff":        return liffId ? { type: "uri", label, uri: `https://liff.line.me/${liffId}` } : null;
    case "liff_mypage": return liffId ? { type: "uri", label, uri: `https://liff.line.me/${liffId}/mypage` } : null;
    case "uri":         return v ? { type: "uri", label, uri: v } : null;
    case "message": {
      const text = v || b.label.trim();
      return text ? { type: "message", label, text } : null;
    }
    default: return null;
  }
}

/** テンプレートには最低1アクションが必要。無ければダミーを1つ返す。 */
function actionsOrDummy(buttons: RichMsgButton[], liffId: string, max: number): Record<string, unknown>[] {
  const acts = buttons.map((b) => actionObj(b, liffId)).filter((x): x is Record<string, unknown> => x != null).slice(0, max);
  return acts.length ? acts : [{ type: "message", label: "OK", text: "OK" }];
}

/** 送信前チェック：中身が空か。 */
export function isRichMessageEmpty(m: RichMessage | null | undefined): boolean {
  if (!m) return true;
  switch (m.type) {
    case "text":     return !(m.text && m.text.trim());
    case "image":    return !(m.imageUrl && m.imageUrl.trim());
    case "buttons":  return !m.card || (!m.card.title.trim() && !m.card.text.trim() && !m.card.imageUrl);
    case "carousel": return !m.cards || m.cards.length === 0;
    default:         return true;
  }
}

/** 履歴・一覧に残すテキスト表現（altText 相当）。 */
export function richMessageSummary(m: RichMessage): string {
  switch (m.type) {
    case "text":     return (m.text ?? "").slice(0, 200);
    case "image":    return "[画像]";
    case "buttons":  return `[カード] ${(m.card?.title || m.card?.text || "").slice(0, 60)}`;
    case "carousel": return `[カルーセル] ${m.cards?.length ?? 0}枚`;
    default:         return "[メッセージ]";
  }
}

/** RichMessage → LINE messages 配列（push/multicast の messages にそのまま渡す）。 */
export function toLineMessages(m: RichMessage, liffId: string): unknown[] {
  const quickReply = (m.quickReplies && m.quickReplies.length)
    ? {
        items: m.quickReplies.slice(0, 13).map((q) => ({
          type: "action",
          action: { type: "message", label: (q.label || q.text || "選択").slice(0, 20), text: (q.text || q.label || "").slice(0, 300) },
        })),
      }
    : undefined;

  if (m.type === "text") {
    const msg: Record<string, unknown> = { type: "text", text: (m.text || " ").slice(0, 5000) };
    if (quickReply) msg.quickReply = quickReply;
    return [msg];
  }

  if (m.type === "image") {
    const url = (m.imageUrl || "").trim();
    if (!url) return [{ type: "text", text: " " }];
    const msg: Record<string, unknown> = { type: "image", originalContentUrl: url, previewImageUrl: url };
    if (quickReply) msg.quickReply = quickReply;
    return [msg];
  }

  if (m.type === "buttons" && m.card) {
    const c = m.card;
    const tmpl: Record<string, unknown> = {
      type: "buttons",
      text: ((c.text || c.title || " ").slice(0, 60)) || " ",
      actions: actionsOrDummy(c.buttons, liffId, 4),
    };
    if (c.title.trim()) tmpl.title = c.title.slice(0, 40);
    if (c.imageUrl) tmpl.thumbnailImageUrl = c.imageUrl;
    const msg: Record<string, unknown> = { type: "template", altText: (m.altText || c.title || "メッセージ").slice(0, 400), template: tmpl };
    if (quickReply) msg.quickReply = quickReply;
    return [msg];
  }

  if (m.type === "carousel" && m.cards) {
    const columns = m.cards.slice(0, 10).map((c) => {
      const col: Record<string, unknown> = {
        text: ((c.text || c.title || " ").slice(0, 60)) || " ",
        actions: actionsOrDummy(c.buttons, liffId, 3),
      };
      if (c.title.trim()) col.title = c.title.slice(0, 40);
      if (c.imageUrl) col.thumbnailImageUrl = c.imageUrl;
      return col;
    });
    const msg: Record<string, unknown> = { type: "template", altText: (m.altText || "メッセージ").slice(0, 400), template: { type: "carousel", columns } };
    if (quickReply) msg.quickReply = quickReply;
    return [msg];
  }

  return [{ type: "text", text: (m.text || " ").slice(0, 5000) }];
}
