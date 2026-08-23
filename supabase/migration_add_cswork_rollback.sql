-- ============================================================
-- CsWork（REQ-028）のロールバック
--
--   ⚠️ バケット内のオブジェクトを消すと md / CSV の本文が失われる。
--      履歴ごと不要になったときだけ実行すること。
-- ============================================================

drop policy if exists cswork_docs_select_ops  on public.cswork_docs;
drop policy if exists cswork_audit_select_ops on public.cswork_audit;

drop table if exists public.cswork_audit;
drop table if exists public.cswork_docs;

delete from public.role_permissions where feature in ('cswork','cswork_secret');

-- 本文ごと消す場合のみ（先にオブジェクトを削除する）
-- delete from storage.objects where bucket_id = 'cswork';
-- delete from storage.buckets where id = 'cswork';
