# fixtures（フェーズB 開発用・架空/公開データ）

出典: ハンドオフリポジトリ `kawai-developer/bot` の `fixtures/` を取り込んだもの。
公開情報または検証用の架空データのみ。顧客情報・analytics・secret・有料本文・メディアバイナリは含まない。

- `note/` … published 3件（DX / タスクばらし / ユーザビリティ）＋ draft 1件（除外検証用・架空）
- `x/` … single-marketing（CTA・価格・販売文脈）／ single-time-sensitive（時点依存＝鮮度警告対象）／ series-roadmap（Day分割・共通CTA）
- `chat/bookmarks.json` … app/LINEのQ&A。`ai_enabled:false` の無効行を含む（検索除外の検証用）
- `eval/retrieval-cases.json` … 受け入れ評価ケース（ブックマーク優先・note命中・draft除外・鮮度警告・シリーズ分割・無効行除外）

実データ（note/X 全量）は KAWAI Mac 側にあり、このリポジトリには入れない。ここでの開発・検証は本 fixtures のみで行う。
