-- ============================================================
-- Phase 1 RLS 再設計：ロールバック（緊急切り戻し）
--
--   ⚠️ これを実行すると「認証済みなら全テーブル全操作OK」の
--      元の（危険な）状態に戻ります。
--      本番で重大な障害が出た場合の一時退避としてのみ使用し、
--      原因を直して速やかに migration_phase1_rls.sql を再適用してください。
--
--   適用方法：Supabase ダッシュボード → SQL Editor
-- ============================================================

begin;

-- 1. Phase 1 で作った全ポリシーを削除
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 2. 旧来の「認証済みなら全部OK」ポリシーを復元
do $$
declare t text;
begin
  foreach t in array array[
    'members', 'projects', 'anken', 'tasks',
    'templates', 'template_anken', 'template_tasks',
    'app_settings', 'role_permissions',
    'attributes', 'attribute_levels', 'member_attributes', 'member_memos',
    'contents', 'content_pages', 'content_attributes', 'content_page_attributes', 'content_views',
    'news', 'news_attributes',
    'chat_conversations', 'chat_messages', 'chat_attachments',
    'broadcasts', 'broadcast_links', 'broadcast_clicks',
    'scenarios', 'scenario_steps', 'scenario_entries', 'scenario_links', 'scenario_clicks',
    'forms', 'form_sections', 'form_fields', 'form_submissions', 'form_answers',
    'notify_settings', 'notification_settings', 'push_subscriptions'
  ]
  loop
    execute format(
      'create policy "auth_users_all" on public.%I for all to authenticated
         using (true) with check (true)', t);
  end loop;
end $$;

-- 3. members_visible ビューを削除
--    （フロントを Phase 1 版のまま戻し忘れると参照エラーになるため、
--      アプリ側も同時に切り戻すこと）
-- drop view if exists public.members_visible;

commit;
