-- ============================================================
-- Phase 3 のロールバック
--
--   migration_phase3_sources.sql は旧カラム（members.source /
--   broadcasts.target_source / scenarios.target_source /
--   app_settings.welcome_routes）を残しているため、
--   新カラム・新テーブルを落とすだけで元の挙動に戻せる。
--
--   ⚠️ ただし Phase 3 適用後に「新規追加した経路」「編集した文面」は失われる。
--   ⚠️ form_submissions は channel → source に戻す（データは保持される）。
--   ⚠️ アプリ側のコードも Phase 3 前のリビジョンに戻すこと（DB だけ戻しても動かない）。
-- ============================================================

begin;

-- 1. 送信チャネルのカラム名を戻す
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'form_submissions' and column_name = 'channel'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'form_submissions' and column_name = 'source'
  ) then
    alter table public.form_submissions rename column channel to source;
  end if;
end $$;

alter table public.form_submissions drop column if exists source_id;

-- 2. ターゲティング拡張を撤去（旧 target_source は残っているのでそのまま効く）
alter table public.broadcasts
  drop column if exists target_source_ids,
  drop column if exists target_source_cats;

alter table public.scenarios
  drop column if exists target_source_ids,
  drop column if exists target_source_cats;

-- 3. members の新カラムを撤去（旧 source(text) は残っている）
drop index if exists public.members_source_id_idx;
alter table public.members
  drop column if exists source_id,
  drop column if exists last_source_id,
  drop column if exists source_at;

-- 4. ビュー・マスタを撤去
drop view  if exists public.v_source_member_counts;
drop table if exists public.welcome_messages;
drop table if exists public.sources;

-- 5. members_visible を migration_hide_member_names.sql の定義に戻す
--    ⚠️ Phase 1 の定義ではない。氏名マスク（他会員には '(非公開)'）を必ず維持すること。
drop view if exists public.members_visible;
create view public.members_visible as
select
  m.id,
  case when public.is_ops() or m.user_id = auth.uid() then m.name else '(非公開)' end as name,
  m.role,
  m.is_deleted,
  m.created_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.email          end as email,
  case when public.is_ops() or m.user_id = auth.uid() then m.company        end as company,
  case when public.is_ops() or m.user_id = auth.uid() then m.chat_id        end as chat_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.user_id        end as user_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.kana           end as kana,
  case when public.is_ops() or m.user_id = auth.uid() then m.tel            end as tel,
  case when public.is_ops() or m.user_id = auth.uid() then m.prefecture     end as prefecture,
  case when public.is_ops() or m.user_id = auth.uid() then m.source         end as source,
  case when public.is_ops() or m.user_id = auth.uid() then m.welcomed_at    end as welcomed_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.first_login_at end as first_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.last_login_at  end as last_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.login_count    end as login_count
from public.members m;

grant select on public.members_visible to authenticated;

commit;
