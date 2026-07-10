-- ============================================================
-- サンプルデータ：AIエージェントの作成ノウハウ講座
--   投入先: content_pages / contents / news （公開対象は全員 = attr_mode 'any' + 属性なし）
--   ★ members / member_attributes / member_memos は一切変更しません（現行維持）
--   ★ 属性マスタ（attributes / attribute_levels）にも触れません
--   前提: migration_add_content.sql / migration_add_news.sql 実行済み
--   使い方: Supabase SQL Editor に貼り付けて Run（1回だけ実行）
-- ============================================================

-- 【再投入したい場合のみ】下記の DELETE を先に実行（このサンプルのみ削除／他データは残ります）
-- delete from public.contents where page_id in
--   (select id from public.content_pages where name in ('コース案内','基礎編','実装編','応用・運用編','資料・リンク'));
-- delete from public.content_pages where name in ('コース案内','基礎編','実装編','応用・運用編','資料・リンク');
-- delete from public.news where title in (
--   'AIエージェント作成ノウハウ講座 開講のお知らせ',
--   '第1回 ライブQ&Aセッションを開催します',
--   '動画配信システム メンテナンスのお知らせ',
--   '新レッスン「マルチエージェント設計」を追加しました',
--   '修了課題の提出について');

begin;

-- ── コンテンツページ（掲載画面のタブ）──
insert into public.content_pages (name, abbr, attr_mode, sort_order) values
  ('コース案内',     '案内', 'any', 0),
  ('基礎編',         '基礎', 'any', 1),
  ('実装編',         '実装', 'any', 2),
  ('応用・運用編',   '応用', 'any', 3),
  ('資料・リンク',   '資料', 'any', 4);

-- ── コンテンツ（レッスン）──
-- kind: video=動画(URL埋め込み) / doc=資料(URL埋め込み) / none=記事(text|html)
insert into public.contents
  (page_id, sort_order, name, kind, url, none_mode, body_text, body_html, thumb_url, published, attr_mode)
values
-- ▼ コース案内
((select id from public.content_pages where name='コース案内'), 0,
 'コースガイダンス（はじめに見る動画）', 'video', 'https://www.youtube.com/watch?v=aircAruvnKk', 'text',
 'このコースの全体像と進め方を10分で解説します。まずはこの動画からご覧ください。', '', '', true, 'any'),
((select id from public.content_pages where name='コース案内'), 1,
 '受講の進め方', 'none', '', 'text',
 E'本コースは「基礎 → 実装 → 応用・運用」の順に進むと理解しやすい構成です。\n\n・各レッスンは動画・資料・記事のいずれかで提供します。\n・週に2〜3レッスンのペースを推奨します。\n・質問は月1回のライブQ&Aで受け付けます（お知らせを確認）。\n参考: https://example.com/ai-agent-course/guide', '', '', true, 'any'),

-- ▼ 基礎編
((select id from public.content_pages where name='基礎編'), 0,
 'AIエージェントとは？基本概念', 'video', 'https://www.youtube.com/watch?v=ODaHJzOyVCQ', 'text',
 'LLMを「頭脳」として、目標に向かって自律的に考え・道具を使い・行動する仕組み＝AIエージェントの全体像を掴みます。', '', '', true, 'any'),
((select id from public.content_pages where name='基礎編'), 1,
 'LLMとプロンプト設計の基礎', 'none', '', 'html',
 '', '<h3>プロンプト設計の型</h3><p>エージェントの品質はプロンプト設計で大きく変わります。まずは次の3点を押さえましょう。</p><ul><li><b>役割（Role）</b>：何者として振る舞うか</li><li><b>手順（Steps）</b>：どう考え、どう出力するか</li><li><b>制約（Guardrails）</b>：やってはいけないこと</li></ul><p>詳細な用語は <a href="https://example.com/ai-agent-course/prompt" target="_blank" rel="noopener">プロンプト設計ガイド</a> を参照してください。</p>', '', true, 'any'),
((select id from public.content_pages where name='基礎編'), 2,
 'エージェント構成要素（用語集）', 'doc', 'https://drive.google.com/file/d/EXAMPLE_GLOSSARY_ID/preview', 'text',
 'モデル / ツール / メモリ / プランナー / オーケストレーション など、頻出用語をまとめた資料です。', '', '', true, 'any'),

-- ▼ 実装編
((select id from public.content_pages where name='実装編'), 0,
 '最初のエージェントを作る（ハンズオン）', 'video', 'https://www.youtube.com/watch?v=mR7wSj4Wb2Q', 'text',
 'シンプルな「質問に答えて必要なら検索する」エージェントを、手を動かしながら作ります。', '', '', true, 'any'),
((select id from public.content_pages where name='実装編'), 1,
 'ツール利用（Function Calling）の実装', 'none', '', 'html',
 '', '<h3>ツール連携の基本</h3><p>エージェントに「道具」を持たせると一気に実用的になります。</p><ul><li>ツールの入出力を明確な型で定義する</li><li>失敗時のリトライ／フォールバックを用意する</li><li>実行ログを残して後から検証できるようにする</li></ul><p>サンプルは次のレッスン「サンプルコード集」を参照。</p>', '', true, 'any'),
((select id from public.content_pages where name='実装編'), 2,
 'サンプルコード集', 'doc', 'https://drive.google.com/file/d/EXAMPLE_SAMPLECODE_ID/preview', 'text',
 'ハンズオンで使うサンプルコード一式（最小構成〜ツール連携まで）。', '', '', true, 'any'),

-- ▼ 応用・運用編
((select id from public.content_pages where name='応用・運用編'), 0,
 'マルチエージェント設計パターン', 'video', 'https://www.youtube.com/watch?v=k7VO1nb8h3E', 'text',
 '役割分担（プランナー／実行者／レビュアー）で協調させる設計パターンを紹介します。', '', '', true, 'any'),
((select id from public.content_pages where name='応用・運用編'), 1,
 '評価・テスト・改善の回し方', 'none', '', 'text',
 E'エージェントは「作って終わり」ではなく、評価→改善のループが重要です。\n\n1. 代表的なタスクを評価用データセットにする\n2. 期待する振る舞いをチェック項目にする\n3. プロンプト／ツールを1つずつ変えて比較する\nテンプレート: https://example.com/ai-agent-course/eval', '', '', true, 'any'),
((select id from public.content_pages where name='応用・運用編'), 2,
 '本番運用とコスト最適化', 'none', '', 'html',
 '', '<h3>運用で効くポイント</h3><ul><li><b>キャッシュ</b>：同じ入力の再計算を避ける</li><li><b>モデル使い分け</b>：軽い処理は小さいモデルへ</li><li><b>監視</b>：遅延・失敗率・トークン消費を可視化</li></ul><p>コストの考え方は <a href="https://example.com/ai-agent-course/cost" target="_blank" rel="noopener">運用コストガイド</a> を参照。</p>', '', true, 'any'),

-- ▼ 資料・リンク
((select id from public.content_pages where name='資料・リンク'), 0,
 '講座スライド一式（PDF）', 'doc', 'https://drive.google.com/file/d/EXAMPLE_SLIDES_ID/preview', 'text',
 '全レッスンのスライドをまとめたPDFです。復習にご利用ください。', '', '', true, 'any'),
((select id from public.content_pages where name='資料・リンク'), 1,
 '参考リンク集', 'none', '', 'html',
 '', '<h3>参考リンク</h3><ul><li>公式ドキュメント：https://example.com/docs</li><li>コミュニティ：<a href="https://example.com/community" target="_blank" rel="noopener">example.com/community</a></li><li>用語集（本講座）：https://example.com/ai-agent-course/glossary</li></ul>', '', true, 'any');

-- ── お知らせ（ホーム掲載）──
insert into public.news
  (category, title, body_mode, body_text, body_html, important, published, published_at, attr_mode, sort_order)
values
('notice', 'AIエージェント作成ノウハウ講座 開講のお知らせ', 'html', '',
 '<h3>本日より開講しました</h3><p>「AIエージェントの作成ノウハウ講座」を開講しました。まずは<b>コース案内</b>のガイダンス動画からご覧ください。</p><p>お問い合わせ：<a href="https://example.com/contact" target="_blank" rel="noopener">サポート窓口</a></p>',
 true, true, '2026-07-01 09:00+09', 'any', 0),

('event', '第1回 ライブQ&Aセッションを開催します', 'text',
 E'受講中の疑問にその場で回答するライブQ&Aを開催します。\n日時：7/25(金) 20:00〜21:00（オンライン）\n参加URL：https://example.com/ai-agent-course/qa\n事前質問も受付中です。',
 '', false, true, '2026-07-08 10:00+09', 'any', 1),

('maint', '動画配信システム メンテナンスのお知らせ', 'text',
 E'下記日程で動画配信システムのメンテナンスを実施します。\n日時：7/15(火) 2:00〜4:00\n対象：講座内の動画レッスン再生\nご不便をおかけしますがよろしくお願いします。',
 '', false, true, '2026-07-12 09:00+09', 'any', 2),

('notice', '新レッスン「マルチエージェント設計」を追加しました', 'text',
 E'応用・運用編に新レッスン「マルチエージェント設計パターン」を追加しました。\n複数のエージェントを役割分担で協調させる実践的な内容です。ぜひご覧ください。',
 '', false, true, '2026-07-18 12:00+09', 'any', 3),

('notice', '修了課題の提出について', 'html', '',
 '<h3>修了課題のご案内</h3><p>全レッスン受講後、以下の修了課題を提出いただくと修了証を発行します。</p><ul><li>お題：任意のテーマで小さなAIエージェントを1つ作成</li><li>提出先：<a href="https://example.com/ai-agent-course/assignment" target="_blank" rel="noopener">提出フォーム</a></li><li>締切：8/31まで</li></ul>',
 false, true, '2026-07-20 09:00+09', 'any', 4);

commit;

-- 確認用（任意）:
-- select name, abbr, sort_order from public.content_pages order by sort_order;
-- select p.abbr, c.sort_order, c.name, c.kind from public.contents c join public.content_pages p on p.id=c.page_id order by p.sort_order, c.sort_order;
-- select sort_order, category, important, title from public.news order by sort_order;
