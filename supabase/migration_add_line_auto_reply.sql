-- ============================================================
-- Phase 7③：キーワード自動応答（簡易チャットボット）
--   受信メッセージのキーワードに一致したら、Reply（無料）で自動返信し、
--   既存のアクション基盤（属性付与・シナリオ開始・メッセージ送信）を発火する。
--     keywords   : 一致キーワード（いずれか一致で成立）
--     match_type : partial=部分一致 / exact=完全一致 / regex=正規表現
--     is_fallback: true=キーワード不一致時のフォールバック（その他すべて）
--     reply_json : 返信するリッチメッセージ（null=返信なし・アクションのみ）
--     actions    : 発火するアクション（FormAction[] と同型）
--     priority   : 大きいほど先に評価
-- ============================================================
create table if not exists public.line_auto_replies (
  id          bigint generated always as identity primary key,
  account_id  integer not null references public.line_accounts(id) on delete cascade,
  name        text    not null default '',
  keywords    text[]  not null default '{}',
  match_type  text    not null default 'partial',
  is_fallback boolean not null default false,
  reply_json  jsonb,
  actions     jsonb   not null default '[]'::jsonb,
  priority    integer not null default 0,
  is_enabled  boolean not null default true,
  is_deleted  boolean not null default false,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists line_auto_replies_acct_idx
  on public.line_auto_replies(account_id, is_deleted, is_enabled, priority desc);

-- RLS：運営のみ参照・編集。書き込みは service_role(API)経由が基本だが、
--   下書き編集は運営RLSで直接更新できるようにする（他のLINE系テーブルと同様）。
alter table public.line_auto_replies enable row level security;
drop policy if exists "line_auto_replies_ops" on public.line_auto_replies;
create policy "line_auto_replies_ops" on public.line_auto_replies for all to authenticated
  using (public.is_ops()) with check (public.is_ops());
