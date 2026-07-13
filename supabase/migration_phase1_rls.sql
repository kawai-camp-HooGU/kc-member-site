-- ============================================================
-- Phase 1：RLS（Row Level Security）再設計
--
--   【背景】
--   これまで全テーブルのポリシーが
--       for all to authenticated using (true) with check (true)
--   ＝「ログインさえ通れば全テーブル・全行を読み書きできる」状態だった。
--   ロール制御はフロントの画面出し分け（canFor）のみで、DBには効いていない。
--   → 招待済みの一般メンバーが、ブラウザのコンソールから
--      全会員の個人情報・一斉配信の文面・権限マスタの改ざんまで可能だった。
--
--   【方針】
--   ・ロール判定は SECURITY DEFINER 関数で行う（RLS を迂回するため再帰しない）
--   ・テーブルを「運営専用」「本人＋運営」「担当PJのみ」「全員読取」に4分類
--   ・会員から members が見えなくなると担当者名の表示が壊れるため、
--     機微カラムをマスクした members_visible ビューを用意する
--
--   【適用方法】
--   Supabase ダッシュボード → SQL Editor に貼り付けて実行。
--   ロールバックは migration_phase1_rls_rollback.sql。
--
--   ⚠️ 必ずステージング環境で先に適用し、4ロール（管理者/オペレーター/
--      メンバー/外部）で疎通テストを行うこと。
--      手順は docs/Phase1_RLS再設計.md を参照。
-- ============================================================

begin;

-- ============================================================
-- 1. ヘルパー関数（SECURITY DEFINER = RLS を迂回して members を読む）
--
--    ⚠️ SECURITY DEFINER が必須。
--    これが無いと「members のポリシーが members を読む」→ 無限再帰になる。
-- ============================================================

-- 自分の members.id
create or replace function public.current_member_id()
returns int
language sql
stable
security definer
set search_path = public
as $$
  select id from public.members
   where user_id = auth.uid() and is_deleted = false
   limit 1
$$;

-- 自分のロール
create or replace function public.current_member_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.members
   where user_id = auth.uid() and is_deleted = false
   limit 1
$$;

-- 自分の表示名（projects.member_names / tasks.assignees が名前ベースのため必要）
create or replace function public.current_member_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select name from public.members
   where user_id = auth.uid() and is_deleted = false
   limit 1
$$;

-- 運営（管理者・オペレーター）か？
create or replace function public.is_ops()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() in ('管理者', 'オペレーター'), false)
$$;

-- 管理者か？
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() = '管理者', false)
$$;

-- 編集可能な会員ロールか？（メンバーは編集可 / 外部は閲覧のみ）
create or replace function public.is_editor_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_member_role() = 'メンバー', false)
$$;

-- 自分が担当しているプロジェクトの id 一覧
--   ⚠️ projects.member_names は「名前の配列」なので、改名すると権限が変わる。
--      Phase 3 以降で project_members(project_id, member_id) への正規化を推奨。
create or replace function public.my_project_ids()
returns setof int
language sql
stable
security definer
set search_path = public
as $$
  select p.id
    from public.projects p
   where p.is_deleted = false
     and public.current_member_name() = any(coalesce(p.member_names, '{}'))
$$;

grant execute on function public.current_member_id()   to authenticated;
grant execute on function public.current_member_role() to authenticated;
grant execute on function public.current_member_name() to authenticated;
grant execute on function public.is_ops()              to authenticated;
grant execute on function public.is_admin()            to authenticated;
grant execute on function public.is_editor_member()    to authenticated;
grant execute on function public.my_project_ids()      to authenticated;


-- ============================================================
-- 2. members_visible ビュー
--
--    members 本体は「本人の行のみ」に絞るため、そのままだと
--    タスクの担当者名・案件のリーダー名が表示できなくなる。
--    → 機微カラムを NULL でマスクしたビューを全員に公開する。
--
--    security_invoker = off（既定）なので、このビューは
--    members の RLS を迂回して読む。マスクは CASE 式で行う。
-- ============================================================
drop view if exists public.members_visible;
create view public.members_visible as
select
  m.id,
  m.name,                 -- 氏名は全員に公開（担当者名の表示に必要）
  m.role,
  m.is_deleted,
  m.created_at,
  -- ── ここから下は「本人」または「運営」にしか見せない ──
  case when public.is_ops() or m.user_id = auth.uid() then m.email        end as email,
  case when public.is_ops() or m.user_id = auth.uid() then m.company      end as company,
  case when public.is_ops() or m.user_id = auth.uid() then m.chat_id      end as chat_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.user_id      end as user_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.kana         end as kana,
  case when public.is_ops() or m.user_id = auth.uid() then m.tel          end as tel,
  case when public.is_ops() or m.user_id = auth.uid() then m.prefecture   end as prefecture,
  case when public.is_ops() or m.user_id = auth.uid() then m.source       end as source,
  case when public.is_ops() or m.user_id = auth.uid() then m.welcomed_at    end as welcomed_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.first_login_at end as first_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.last_login_at  end as last_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.login_count    end as login_count
from public.members m;

grant select on public.members_visible to authenticated;


-- ============================================================
-- 3. 旧ポリシーの一括削除
--    （"auth_users_all" 等、using(true) のものを全て落とす）
-- ============================================================
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


-- ============================================================
-- 4. RLS を全テーブルで有効化
-- ============================================================
alter table public.members                 enable row level security;
alter table public.projects                enable row level security;
alter table public.anken                   enable row level security;
alter table public.tasks                   enable row level security;
alter table public.templates               enable row level security;
alter table public.template_anken          enable row level security;
alter table public.template_tasks          enable row level security;
alter table public.app_settings            enable row level security;
alter table public.role_permissions        enable row level security;
alter table public.attributes              enable row level security;
alter table public.attribute_levels        enable row level security;
alter table public.member_attributes       enable row level security;
alter table public.member_memos            enable row level security;
alter table public.contents                enable row level security;
alter table public.content_pages           enable row level security;
alter table public.content_attributes      enable row level security;
alter table public.content_page_attributes enable row level security;
alter table public.content_views           enable row level security;
alter table public.news                    enable row level security;
alter table public.news_attributes         enable row level security;
alter table public.chat_conversations      enable row level security;
alter table public.chat_messages           enable row level security;
alter table public.chat_attachments        enable row level security;
alter table public.broadcasts              enable row level security;
alter table public.broadcast_links         enable row level security;
alter table public.broadcast_clicks        enable row level security;
alter table public.scenarios               enable row level security;
alter table public.scenario_steps          enable row level security;
alter table public.scenario_entries        enable row level security;
alter table public.scenario_links          enable row level security;
alter table public.scenario_clicks         enable row level security;
alter table public.forms                   enable row level security;
alter table public.form_sections           enable row level security;
alter table public.form_fields             enable row level security;
alter table public.form_submissions        enable row level security;
alter table public.form_answers            enable row level security;
alter table public.notify_settings         enable row level security;
alter table public.notification_settings   enable row level security;
alter table public.push_subscriptions      enable row level security;


-- ============================================================
-- 5. 【分類A】運営専用テーブル
--     会員からは 1 行も見えない・書けない。
--     （サーバー側の service_role は RLS を無視するので、
--       公開フォームの受付・配信クリック計測・cron は従来どおり動く）
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    -- 一斉配信
    'broadcasts', 'broadcast_links', 'broadcast_clicks',
    -- シナリオ配信
    'scenarios', 'scenario_steps', 'scenario_entries', 'scenario_links', 'scenario_clicks',
    -- フォーム
    'forms', 'form_sections', 'form_fields', 'form_submissions', 'form_answers',
    -- 顧客メモ・テンプレート・プロジェクト通知設定・アプリ設定
    'member_memos', 'templates', 'template_anken', 'template_tasks',
    'notify_settings', 'app_settings'
  ]
  loop
    execute format(
      'create policy "ops_only" on public.%I for all to authenticated
         using (public.is_ops()) with check (public.is_ops())', t);
  end loop;
end $$;


-- ============================================================
-- 6. 【分類B】members ＝ 本人の行のみ / 運営は全件
--     ※ 他メンバーの氏名は members_visible ビューから読む
-- ============================================================
create policy "members_select" on public.members for select to authenticated
  using (public.is_ops() or user_id = auth.uid());

-- 本人はプロフィールを更新できる。ただしロールの自己昇格は防ぐ。
create policy "members_update" on public.members for update to authenticated
  using (public.is_ops() or user_id = auth.uid())
  with check (
    public.is_ops()
    or (user_id = auth.uid() and role = public.current_member_role())
  );

create policy "members_insert_ops" on public.members for insert to authenticated
  with check (public.is_ops());

create policy "members_delete_ops" on public.members for delete to authenticated
  using (public.is_ops());


-- ============================================================
-- 7. 【分類C】プロジェクト／案件／タスク ＝ 運営は全件、会員は担当PJのみ
-- ============================================================

-- ── projects ──
create policy "projects_select" on public.projects for select to authenticated
  using (public.is_ops() or id in (select public.my_project_ids()));

create policy "projects_write_ops" on public.projects for insert to authenticated
  with check (public.is_ops());
create policy "projects_update_ops" on public.projects for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "projects_delete_ops" on public.projects for delete to authenticated
  using (public.is_ops());

-- ── anken ──
create policy "anken_select" on public.anken for select to authenticated
  using (public.is_ops() or project_id in (select public.my_project_ids()));

create policy "anken_write_ops" on public.anken for insert to authenticated
  with check (public.is_ops());
create policy "anken_update_ops" on public.anken for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "anken_delete_ops" on public.anken for delete to authenticated
  using (public.is_ops());

-- ── tasks ──
--   参照：運営＝全件／会員＝担当PJのみ
--   編集：運営＝全件／メンバー＝担当PJ かつ 自分が担当者のタスクのみ
--         （外部ロールは閲覧のみ。usePermission.canEditTask と同じ規則）
create policy "tasks_select" on public.tasks for select to authenticated
  using (public.is_ops() or project_id in (select public.my_project_ids()));

create policy "tasks_insert" on public.tasks for insert to authenticated
  with check (
    public.is_ops()
    or (public.is_editor_member() and project_id in (select public.my_project_ids()))
  );

create policy "tasks_update" on public.tasks for update to authenticated
  using (
    public.is_ops()
    or (public.is_editor_member()
        and project_id in (select public.my_project_ids())
        and public.current_member_name() = any(coalesce(assignees, '{}')))
  )
  with check (
    public.is_ops()
    or (public.is_editor_member() and project_id in (select public.my_project_ids()))
  );

create policy "tasks_delete" on public.tasks for delete to authenticated
  using (
    public.is_ops()
    or (public.is_editor_member()
        and project_id in (select public.my_project_ids())
        and public.current_member_name() = any(coalesce(assignees, '{}')))
  );


-- ============================================================
-- 8. 【分類D】全員が読める（書き込みは運営のみ）
--     ※ role_permissions は全ユーザーが自分の can() を計算するのに必要
--     ※ attributes / attribute_levels はコンテンツの表示判定に必要
-- ============================================================
do $$
declare t text;
begin
  foreach t in array array[
    'role_permissions', 'attributes', 'attribute_levels',
    'content_attributes', 'content_page_attributes', 'news_attributes'
  ]
  loop
    execute format(
      'create policy "read_all" on public.%I for select to authenticated using (true)', t);
    execute format(
      'create policy "write_ops" on public.%I for insert to authenticated
         with check (public.is_ops())', t);
    execute format(
      'create policy "update_ops" on public.%I for update to authenticated
         using (public.is_ops()) with check (public.is_ops())', t);
    execute format(
      'create policy "delete_ops" on public.%I for delete to authenticated
         using (public.is_ops())', t);
  end loop;
end $$;

-- ── contents / content_pages / news ──
--   未公開（下書き）のものは運営にしか見せない
create policy "contents_select" on public.contents for select to authenticated
  using (public.is_ops() or (published = true and is_deleted = false));
create policy "contents_insert_ops" on public.contents for insert to authenticated
  with check (public.is_ops());
create policy "contents_update_ops" on public.contents for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "contents_delete_ops" on public.contents for delete to authenticated
  using (public.is_ops());

create policy "content_pages_select" on public.content_pages for select to authenticated
  using (public.is_ops() or is_deleted = false);
create policy "content_pages_insert_ops" on public.content_pages for insert to authenticated
  with check (public.is_ops());
create policy "content_pages_update_ops" on public.content_pages for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "content_pages_delete_ops" on public.content_pages for delete to authenticated
  using (public.is_ops());

create policy "news_select" on public.news for select to authenticated
  using (public.is_ops() or (published = true and is_deleted = false));
create policy "news_insert_ops" on public.news for insert to authenticated
  with check (public.is_ops());
create policy "news_update_ops" on public.news for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "news_delete_ops" on public.news for delete to authenticated
  using (public.is_ops());


-- ============================================================
-- 9. 【分類E】本人の行のみ（運営は全件）
-- ============================================================

-- ── member_attributes（会員の属性）──
create policy "member_attrs_select" on public.member_attributes for select to authenticated
  using (public.is_ops() or member_id = public.current_member_id());
create policy "member_attrs_write_ops" on public.member_attributes for insert to authenticated
  with check (public.is_ops());
create policy "member_attrs_update_ops" on public.member_attributes for update to authenticated
  using (public.is_ops()) with check (public.is_ops());
create policy "member_attrs_delete_ops" on public.member_attributes for delete to authenticated
  using (public.is_ops());

-- ── content_views（視聴ログ）──
--   書き込みは RPC record_content_view（SECURITY DEFINER）経由なので
--   ここでは参照だけ許可すればよい。
create policy "content_views_select" on public.content_views for select to authenticated
  using (public.is_ops() or member_id = public.current_member_id());
create policy "content_views_delete_ops" on public.content_views for delete to authenticated
  using (public.is_ops());

-- ── notification_settings（通知のON/OFF）──
create policy "notif_settings_all" on public.notification_settings for all to authenticated
  using (public.is_ops() or member_id = public.current_member_id())
  with check (public.is_ops() or member_id = public.current_member_id());

-- ── push_subscriptions（端末の購読情報）──
create policy "push_subs_all" on public.push_subscriptions for all to authenticated
  using (public.is_ops() or member_id = public.current_member_id())
  with check (public.is_ops() or member_id = public.current_member_id());


-- ============================================================
-- 10. 【分類F】チャット（従来の設計を踏襲）
--      運営＝全会話／会員＝自分の会話のみ
-- ============================================================
create policy "chat_conv" on public.chat_conversations for all to authenticated
  using (public.is_ops() or member_id = public.current_member_id())
  with check (public.is_ops() or member_id = public.current_member_id());

create policy "chat_msg" on public.chat_messages for all to authenticated
  using (
    public.is_ops()
    or conversation_id in (
         select id from public.chat_conversations
          where member_id = public.current_member_id())
  )
  with check (
    public.is_ops()
    or conversation_id in (
         select id from public.chat_conversations
          where member_id = public.current_member_id())
  );

create policy "chat_att" on public.chat_attachments for all to authenticated
  using (
    public.is_ops()
    or message_id in (
         select m.id from public.chat_messages m
           join public.chat_conversations c on c.id = m.conversation_id
          where c.member_id = public.current_member_id())
  )
  with check (
    public.is_ops()
    or message_id in (
         select m.id from public.chat_messages m
           join public.chat_conversations c on c.id = m.conversation_id
          where c.member_id = public.current_member_id())
  );


-- ============================================================
-- 11. 動作確認用クエリ（実行後に SQL Editor で確認）
-- ============================================================
-- ポリシーが using(true) のまま残っていないか（0件になるはず。
-- ただし分類Dの read_all は意図的に true なので除外して数える）
--
--   select tablename, policyname, qual
--     from pg_policies
--    where schemaname = 'public'
--      and qual = 'true'
--      and policyname <> 'read_all';
--
-- RLS が無効なテーブルが残っていないか（0件になるはず）
--
--   select relname from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relkind = 'r' and relrowsecurity = false;

commit;
