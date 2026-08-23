-- ============================================================
-- Phase 5b：リッチメニュー（LINEトーク下部の固定メニュー）
--   アプリで作成・画像アップロード・タップ領域（レイアウト＋アクション）を管理し、
--   「公開」でLINEに反映（作成→画像アップロード→デフォルト設定）する。
--   ・画像は既存の公開バケット line-outbound に置く（公開時にサーバーが取得してLINEへ）。
--   ・cells：セルごとの {label, actionType, actionValue}。bounds は size×layout から計算。
-- ============================================================
create table if not exists public.line_rich_menus (
  id            bigserial primary key,
  account_id    bigint not null references public.line_accounts(id) on delete cascade,
  name          text not null default '',
  chat_bar_text text not null default 'メニュー',
  size          text not null default 'full'  check (size in ('full', 'compact')),
  layout        text not null default '2x1',                 -- colsxrows プリセットキー
  image_path    text,                                        -- line-outbound 上のパス
  cells         jsonb not null default '[]'::jsonb,          -- [{label, actionType, actionValue}]
  rich_menu_id  text,                                        -- LINE採番（公開後）
  is_default    boolean not null default false,              -- LINEのデフォルト表示に設定済み
  status        text not null default 'draft' check (status in ('draft', 'published')),
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_line_rich_menus_account on public.line_rich_menus(account_id) where is_deleted = false;

comment on table public.line_rich_menus is 'LINEリッチメニュー。公開でLINEに反映（rich_menu_id 採番）。';

alter table public.line_rich_menus enable row level security;
drop policy if exists "line_rich_menus_ops" on public.line_rich_menus;
create policy "line_rich_menus_ops" on public.line_rich_menus
  for all to authenticated using (public.is_ops()) with check (public.is_ops());
