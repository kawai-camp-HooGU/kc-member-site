-- ロール改称: 「リーダー」→「オペレーター」
-- 既存DBに適用。制約を一旦外し→データ更新→新制約を付与。
alter table public.members drop constraint if exists members_role_check;
update public.members set role = 'オペレーター' where role = 'リーダー';
alter table public.members
  add constraint members_role_check
  check (role in ('管理者', 'オペレーター', 'メンバー', '外部'));
