-- ============================================================
-- Phase P2：リッチメニュー タップ計測＋A/Bテスト
--   ・ab_group：同じグループ＋同条件の複数メニューを、友だちごとに安定分割して出し分け（A/B）。
--   ・line_rich_menu_taps：URL/LIFFボタンのタップを計測（計測リダイレクト経由）。
--     タップ→ /api/line/rmtap?m=<menuId>&i=<cellIndex> が記録して本来のURLへ転送。
-- ============================================================
alter table public.line_rich_menus add column if not exists ab_group text not null default '';

create table if not exists public.line_rich_menu_taps (
  id          bigint generated always as identity primary key,
  menu_id     integer not null references public.line_rich_menus(id) on delete cascade,
  cell_index  integer not null,
  tapped_at   timestamptz default now()
);
create index if not exists line_rich_menu_taps_menu_idx
  on public.line_rich_menu_taps(menu_id, tapped_at desc);

-- RLS：運営のみ参照（記録は service_role のAPI経由）。
alter table public.line_rich_menu_taps enable row level security;
drop policy if exists "line_rich_menu_taps_ops" on public.line_rich_menu_taps;
create policy "line_rich_menu_taps_ops" on public.line_rich_menu_taps for select to authenticated
  using (public.is_ops());
