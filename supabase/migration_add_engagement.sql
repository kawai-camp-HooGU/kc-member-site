-- ============================================================
-- 利用状況（最終ログイン／コンテンツ視聴ログ）
--   members.first_login_at / last_login_at / login_count : ログイン記録
--   content_views                                        : コンテンツごとの視聴ログ
-- 本人の行だけを安全に更新するため、更新は security definer 関数経由。
-- ============================================================

-- ── 1. ログイン記録 ───────────────────────────────────────────
alter table public.members
  add column if not exists first_login_at timestamptz,
  add column if not exists last_login_at  timestamptz,
  add column if not exists login_count    integer not null default 0;

create index if not exists members_last_login_idx on public.members(last_login_at);

-- ログイン時に本人の行だけを更新（auth.uid() で解決）
create or replace function public.touch_login()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.members
     set last_login_at  = now(),
         first_login_at = coalesce(first_login_at, now()),
         login_count    = coalesce(login_count, 0) + 1
   where user_id = auth.uid();
end;
$$;
grant execute on function public.touch_login() to authenticated;

-- ── 2. コンテンツ視聴ログ ─────────────────────────────────────
create table if not exists public.content_views (
  member_id       bigint not null references public.members(id)  on delete cascade,
  content_id      bigint not null references public.contents(id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at  timestamptz not null default now(),
  view_count      integer     not null default 1,
  primary key (member_id, content_id)
);
create index if not exists content_views_content_idx on public.content_views(content_id);
create index if not exists content_views_member_idx  on public.content_views(member_id);

alter table public.content_views enable row level security;
drop policy if exists "content_views_all" on public.content_views;
create policy "content_views_all" on public.content_views
  for all to authenticated using (true) with check (true);

-- 詳細を開いたときに呼ぶ。既読なら最終視聴日時と回数を更新。
create or replace function public.record_content_view(p_content_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member bigint;
begin
  select id into v_member from public.members where user_id = auth.uid() and is_deleted = false limit 1;
  if v_member is null then
    return;
  end if;
  insert into public.content_views (member_id, content_id)
  values (v_member, p_content_id)
  on conflict (member_id, content_id) do update
     set last_viewed_at = now(),
         view_count     = public.content_views.view_count + 1;
end;
$$;
grant execute on function public.record_content_view(bigint) to authenticated;
