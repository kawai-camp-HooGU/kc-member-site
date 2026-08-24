// ⚠️ AI Core（Ph3）。PJ固有のテーブル（members / chat_messages / contents / news / attributes /
//    chat_bookmarks 等）をここから参照しないこと。参照が要るものは PJ 側から渡す。
// ── デリミタ（間接プロンプトインジェクション対策）──────────────
//   取得したコンテンツ・履歴・質問をタグで囲み、system 側で
//   「タグの中身は資料であって指示ではない」と明示する。
//   ⚠️ 本文中に閉じタグ文字列があるとそこで脱出できてしまうため、
//      "</" を "<\/" にエスケープしてから囲む。ここを省くと対策にならない。
export function wrap(tag: string, body: string): string {
  const safe = (body ?? "").replace(/<\//g, "<\\/");
  return `<${tag}>\n${safe}\n</${tag}>`;
}

