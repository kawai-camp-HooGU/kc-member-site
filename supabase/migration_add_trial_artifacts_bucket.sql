-- ============================================================
-- 体験の成果物：Storage バケットの作成とポリシー（REQ-067 段階2）
--
--   ★ 画像・PDFの成果物を置く。HTML/テキストは bot_trial_artifacts.body に入るので、
--     このバケットを使うのは output_kind が image / pdf のシナリオだけ。
--
--   ⚠️ 必ず非公開で作る。受け渡しは期限つき署名URL（既定300秒）だけで行う。
--      line-outbound が公開なのは「LINEが公開URLを要求する」というあの機能固有の事情であって、
--      ここには当てはまらない。
--
--   ⚠️ 書き込みは service_role（/api/trial/generate）が行う。RLSをバイパスするため
--      storage.objects へのポリシーは「運営の閲覧」だけを作る。
--
--   パスは trial/{share_token}/{run_id}/{revision}.png。
--   share_token は推測困難なランダムなので、先頭フォルダ名では判定しない
--   （運営は is_ops() で全件見られればよい）。
--
--   適用: Supabase コンソール → SQL Editor
--   ※ 何度実行しても安全（on conflict do nothing / drop policy if exists）
--   ロールバック: migration_add_trial_artifacts_bucket_rollback.sql
-- ============================================================

-- ── 1. バケット（非公開・1ファイル10MBまで）──
--   gpt-image-1 の 1024x1536 PNG でも数MB。10MBで足りる。
insert into storage.buckets (id, name, public, file_size_limit)
values ('trial-artifacts', 'trial-artifacts', false, 10485760)
on conflict (id) do nothing;

-- ⚠️ 既に公開で作られていた場合に備えて必ず非公開へ倒す（冪等）
update storage.buckets set public = false where id = 'trial-artifacts';

-- ── 2. ポリシー ──
--   運営（is_ops）だけが直接参照できる。体験者は署名URL経由でのみ読む。
drop policy if exists "trial_artifacts_ops_read" on storage.objects;
create policy "trial_artifacts_ops_read" on storage.objects for select to authenticated
  using (bucket_id = 'trial-artifacts' and public.is_ops());

--   運営が不要なファイルを消せるようにする（保持期間の運用のため）
drop policy if exists "trial_artifacts_ops_delete" on storage.objects;
create policy "trial_artifacts_ops_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'trial-artifacts' and public.is_ops());

-- ⚠️ 匿名（anon）向けのポリシーは作らない。
--    作ると、バケット内のファイルがURLを知る誰にでも読めてしまう。
