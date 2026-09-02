-- ============================================================
-- REQ-067 画像モデルの世代更新（gpt-image-1 → gpt-image-1.5）と、
--         書き直し層のOpenAI移管にともなう単価行の追加
--
--   ⚠️ 何度実行しても壊れないこと（upsert で書く）。
--   ⚠️ 単価はコードに書かない決まり（develop.md §9）。ここが正本。
--
--   ・gpt-image-1 は OpenAI 側で「移行期間の後方互換のため」の扱いになった。
--     指示への追従性が上がった gpt-image-1.5 へ移す。
--     エンドポイントも size / quality の形も同じ。1枚いくらの課金も同じ。
--   ・書き直し層（trial_image_refine）を Claude から OpenAI へ移した。
--     その言語モデルの単価行も要る。無いと cost_jpy が 0 になる
--     （0 は「未設定」であって「無料」ではない）。
--
--   為替：1 USD ≒ 160 円で換算（2026-09-01 時点の実勢 約159.8円）。
--   ⚠️ 為替が動いたらこの表を更新すること。実測は ai_traces.cost_jpy を見る。
-- ============================================================

-- ── ① 画像 gpt-image-1.5（1枚あたり）─────────────────────────
--   OpenAI 公式価格（2026-09-02 確認）。**横長 1536x1024 の値**を入れる。
--     low    $0.013 → 2.08 円
--     medium $0.050 → 8.00 円
--     high   $0.200 → 32.00 円
--   ⚠️ 正方形 1024x1024 はこれより安い（low $0.009 / medium $0.034 / high $0.133）。
--      単価表は品質別までしか持たないため、体験の既定である横長で入れている。
--      正方形を多用するようになったら、行を size 別に割ること。
insert into public.ai_model_prices
  (model, input_jpy_per_1k, output_jpy_per_1k, image_jpy_per_unit, note) values
  ('gpt-image-1.5:low',    0, 0,  2.08, 'OpenAI $0.013/枚（1536x1024）× 160円/USD'),
  ('gpt-image-1.5:medium', 0, 0,  8.00, 'OpenAI $0.050/枚（1536x1024）× 160円/USD'),
  ('gpt-image-1.5:high',   0, 0, 32.00, 'OpenAI $0.200/枚（1536x1024）× 160円/USD')
on conflict (model) do update set
  image_jpy_per_unit = excluded.image_jpy_per_unit,
  note               = excluded.note;

-- ── ② 旧モデルの単価も入れておく（切り戻したときに 0 にしない）──
--   gpt-image-1 の公式価格（1536x1024）：low $0.016 / medium $0.063 / high $0.25
update public.ai_model_prices set image_jpy_per_unit =  2.56,
  note = 'OpenAI $0.016/枚（1536x1024）× 160円/USD。旧世代（移行期間の後方互換）'
  where model = 'gpt-image-1:low'    and image_jpy_per_unit = 0;
update public.ai_model_prices set image_jpy_per_unit = 10.08,
  note = 'OpenAI $0.063/枚（1536x1024）× 160円/USD。旧世代（移行期間の後方互換）'
  where model = 'gpt-image-1:medium' and image_jpy_per_unit = 0;
update public.ai_model_prices set image_jpy_per_unit = 40.00,
  note = 'OpenAI $0.250/枚（1536x1024）× 160円/USD。旧世代（移行期間の後方互換）'
  where model = 'gpt-image-1:high'   and image_jpy_per_unit = 0;

-- ── ③ 書き直し層の言語モデル（トークン課金）──────────────────
--   gpt-5.6-luna：入力 $0.20 ／ 出力 $1.20 per 1M tokens
--     入力 1k あたり $0.0002 → 0.032 円
--     出力 1k あたり $0.0012 → 0.192 円
--   1回の書き直しで概ね 0.3〜0.5 円。画像 high の 32 円に対して誤差。
insert into public.ai_model_prices
  (model, input_jpy_per_1k, output_jpy_per_1k, image_jpy_per_unit, note) values
  ('gpt-5.6-luna', 0.032, 0.192, 0, 'OpenAI $0.20/$1.20 per 1M × 160円/USD。画像指示の書き直し用')
on conflict (model) do update set
  input_jpy_per_1k  = excluded.input_jpy_per_1k,
  output_jpy_per_1k = excluded.output_jpy_per_1k,
  note              = excluded.note;

-- ── 確認 ─────────────────────────────────────────────────────
-- select model, input_jpy_per_1k, output_jpy_per_1k, image_jpy_per_unit, note
--   from public.ai_model_prices
--  where model like 'gpt-image-%' or model like 'gpt-5%'
--  order by model;
