-- ロール権限マスタ（ロール × 機能 の表示/利用可否）
create table if not exists public.role_permissions (
  role    text not null check (role in ('管理者','オペレーター','メンバー','外部')),
  feature text not null,
  enabled boolean not null default false,
  primary key (role, feature)
);
alter table public.role_permissions enable row level security;
drop policy if exists "role_permissions_all" on public.role_permissions;
create policy "role_permissions_all" on public.role_permissions
  for all to authenticated using (true) with check (true);

-- 既定値（管理者/オペレーター=ほぼ全て、メンバー/外部=閲覧系のみ）
insert into public.role_permissions (role, feature, enabled) values
 ('管理者','dashboard',true),('管理者','kanban',true),('管理者','gantt',true),('管理者','calendar',true),('管理者','content',true),('管理者','content_manage',true),('管理者','bulk_register',true),('管理者','chatwork',true),('管理者','chat',true),('管理者','master',true),
 ('オペレーター','dashboard',true),('オペレーター','kanban',true),('オペレーター','gantt',true),('オペレーター','calendar',true),('オペレーター','content',true),('オペレーター','content_manage',true),('オペレーター','bulk_register',true),('オペレーター','chatwork',true),('オペレーター','chat',true),('オペレーター','master',true),
 ('メンバー','dashboard',false),('メンバー','kanban',true),('メンバー','gantt',true),('メンバー','calendar',true),('メンバー','content',true),('メンバー','content_manage',false),('メンバー','bulk_register',false),('メンバー','chatwork',false),('メンバー','chat',true),('メンバー','master',false),
 ('外部','dashboard',false),('外部','kanban',true),('外部','gantt',true),('外部','calendar',true),('外部','content',true),('外部','content_manage',false),('外部','bulk_register',false),('外部','chatwork',false),('外部','chat',false),('外部','master',false)
on conflict (role, feature) do nothing;
