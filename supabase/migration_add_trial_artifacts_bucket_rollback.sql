-- ============================================================
-- 体験の成果物バケット（REQ-067 段階2）の切り戻し
--
--   ⚠️ 危険：バケットを消すと、利用者が作った画像がすべて消える。
--      bot_trial_artifacts の行だけ残り、storage_path が宙に浮く。
--      残す必要がないことを確認してから実行すること。
--
--   ⚠️ 中身が入っているバケットは delete できない。先にオブジェクトを消す必要がある。
--      「もう画像を作らせたくない」だけなら、バケットは残したまま
--      シナリオの output_kind を html に戻すか、体験版URLの scenario_id を null にする。
-- ============================================================

drop policy if exists "trial_artifacts_ops_read"   on storage.objects;
drop policy if exists "trial_artifacts_ops_delete" on storage.objects;

-- ⚠️ 下の2行は本当に消してよいときだけコメントを外す。
-- delete from storage.objects where bucket_id = 'trial-artifacts';
-- delete from storage.buckets where id = 'trial-artifacts';
