-- ============================================================
-- REQ-067 画像モデル世代更新の切り戻し
--
--   ⚠️ 行を消すだけ。列やテーブルには触らない。
--   ⚠️ コード側も戻すこと（OPENAI_IMAGE_MODEL、または image.ts の既定値）。
--      単価行だけ消してコードが 1.5 のままだと、cost_jpy が 0 になる。
-- ============================================================
delete from public.ai_model_prices where model like 'gpt-image-1.5:%';
delete from public.ai_model_prices where model = 'gpt-5.6-luna';

-- 旧モデルの単価は残す（消すと切り戻し先で 0 になる）。
-- 0 に戻したい場合だけ、下を外して実行する。
-- update public.ai_model_prices set image_jpy_per_unit = 0, note = '要設定'
--   where model like 'gpt-image-1:%';
