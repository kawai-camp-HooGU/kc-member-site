-- ============================================================
-- LINE公式アカウント 複数アカウント対応（Phase 1.5）
--   Phase 1 は単一アカウント（環境変数）前提だったが、画面から
--   複数アカウントを 追加/確認/削除 できるようにする。
--
--   設計（メール連携 migration_add_mail_secrets.sql と同じ流儀）:
--     ・非秘密のメタ情報は line_accounts（運営が編集フォームで見えてよい。RLS=運営）
--     ・チャネルシークレット/アクセストークンは line_account_secrets に
--       AES-256-GCM で暗号化して隔離（RLSポリシー無し＝service_roleのみ）。
--       暗号鍵はサーバー環境変数 LINE_SECRET_KEY（lib/lineCrypto.ts）。
--     ・友だち／メッセージ／あいさつに account_id を付与し、アカウント単位で管理。
-- ============================================================

-- ── アカウント（非秘密メタ）─────────────────────────────────
create table if not exists public.line_accounts (
  id                 bigserial primary key,
  name               text not null default '',              -- アプリ内の表示名
  channel_id         text not null,                         -- チャネルID（Webhook URLの識別子）
  basic_id           text not null default '',              -- ベーシックID（@〜。接続テストで取得）
  bot_user_id        text not null default '',              -- ボットのuserId（Webhookの destination）
  env                text not null default 'prod' check (env in ('prod','test')),
  status             text not null default 'needs_action'
                       check (status in ('connected','needs_action','paused')),
  status_detail      text not null default '',              -- 直近の接続テスト結果など
  webhook_verified_at timestamptz,
  last_test_at       timestamptz,
  last_received_at   timestamptz,
  sort_order         int not null default 0,
  is_deleted         boolean not null default false,
  created_at         timestamptz not null default now()
);
create unique index if not exists uq_line_accounts_channel
  on public.line_accounts(channel_id) where is_deleted = false;

comment on table public.line_accounts is
  'LINE公式アカウント（非秘密メタ）。シークレット/トークンは line_account_secrets に暗号化保管。';

-- ── シークレット（暗号化・隔離）────────────────────────────
--   RLS を有効化し、ポリシーを一切作らない＝ authenticated からは触れない。
--   service_role（サーバー）だけがアクセスできる。
create table if not exists public.line_account_secrets (
  account_id           bigint primary key references public.line_accounts(id) on delete cascade,
  channel_secret_cipher text not null,   -- AES-256-GCM（base64: iv|tag|ciphertext）
  access_token_cipher   text not null,   -- 同上
  updated_at           timestamptz not null default now()
);
comment on table public.line_account_secrets is
  'LINEチャネルシークレット/アクセストークンの暗号化保管。RLSポリシー無し＝service_roleのみ。';
alter table public.line_account_secrets enable row level security;

-- ── アカウント本体の RLS（運営のみ・非秘密メタ）─────────────
alter table public.line_accounts enable row level security;
drop policy if exists "line_accounts_ops" on public.line_accounts;
create policy "line_accounts_ops" on public.line_accounts
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- ── 既存テーブルへ account_id を付与 ────────────────────────
alter table public.line_friends   add column if not exists account_id bigint references public.line_accounts(id) on delete cascade;
alter table public.line_messages  add column if not exists account_id bigint references public.line_accounts(id) on delete cascade;
alter table public.line_greetings add column if not exists account_id bigint references public.line_accounts(id) on delete cascade;

-- 友だちの一意性を「line_user_id 単独」→「アカウント×line_user_id」に変更
alter table public.line_friends drop constraint if exists line_friends_line_user_id_key;
create unique index if not exists uq_line_friends_acct_user
  on public.line_friends(account_id, line_user_id);

create index if not exists idx_line_friends_account  on public.line_friends(account_id);
create index if not exists idx_line_messages_account on public.line_messages(account_id);

-- あいさつは「アカウント×流入経路」で一意（既定＝source_id null）
drop index if exists uq_line_greetings_source;
create unique index if not exists uq_line_greetings_acct_source
  on public.line_greetings(coalesce(account_id, -1), coalesce(source_id, -1));
