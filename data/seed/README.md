# data/seed（初期設定シード）

ハンドオフリポジトリ `kawai-developer/bot` の `data/seed/` を取り込んだもの。
ボットの土台となる設定で、**ナレッジ原本ではない**（原本は KAWAI Mac 側）。

- `kawai-camp-context.json` … 商品文脈と Human Gate（価格・約束・契約・公開・送信は人が承認）。ボットのシステムプロンプトに反映。
- `topics.json` … 正規化トピック辞書。
- `retrieval-policy.json` … 権威・鮮度・可視性・context上限（検索ランキングの基準値。SQL側の重みと整合）。

※ persona / style-profiles は `supabase/migration_add_kawai_knowledge.sql` に seed 済み。
※ 価格・返金・日程・限定数・契約条件は seed しない（`commercial_terms` は null / KAWAI承認が必要）。
