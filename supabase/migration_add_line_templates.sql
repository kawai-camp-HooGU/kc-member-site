-- ============================================================
-- Phase P2-B：テンプレート（定型文・定型リッチメッセージ）
--   よく使う本文/リッチメッセージを保存して、配信・シナリオ・自動応答・手動トークから再利用。
--   内容は RichMessage(JSON) で保持（テキスト/画像/カード/カルーセルすべて対応）。
--   アカウント横断で共通利用（account_id は持たない）。
-- ============================================================
create table if not exists public.line_templates (
  id           bigint generated always as identity primary key,
  name         text    not null default '',
  message_json jsonb   not null default '{}'::jsonb,
  sort_order   integer not null default 0,
  is_deleted   boolean not null default false,
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

alter table public.line_templates enable row level security;
drop policy if exists "line_templates_ops" on public.line_templates;
create policy "line_templates_ops" on public.line_templates for all to authenticated
  using (public.is_ops()) with check (public.is_ops());
