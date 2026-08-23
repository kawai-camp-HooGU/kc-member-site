-- ============================================================
-- メール連携：アプリ内アカウント管理＋資格情報の暗号化保存（Phase 1.5）
--   env 方式（MAIL_* 環境変数）に加えて、管理画面から IMAP アカウントを
--   追加・編集できるようにする。パスワードは平文でDBに置かず、
--   アプリ側で AES-256-GCM 暗号化した文字列だけを保存する（lib/mailCrypto.ts）。
--
--   設計：
--     ・接続情報のうち **秘密でないもの**（ホスト/ポート/ユーザ）は mail_accounts に持つ
--       （運営が編集フォームで見えてよい。RLS で運営のみ）。
--     ・**パスワードだけ** を mail_account_secrets に暗号化して隔離する。
--       このテーブルは RLS ポリシーを一切作らない＝ authenticated からは
--       読めも書けもしない。service_role（サーバー）だけが触れる。
-- ============================================================

-- ── mail_accounts に IMAP 接続情報（非秘密）を追加 ──────────
alter table public.mail_accounts
  add column if not exists imap_host text not null default '',
  add column if not exists imap_port int  not null default 993,
  add column if not exists imap_user text not null default '';

-- DB作成アカウントは env 参照キー（auth_ref）を持たないため既定を空に
alter table public.mail_accounts alter column auth_ref set default '';

-- ── パスワード（暗号化）を隔離するテーブル ──────────────────
create table if not exists public.mail_account_secrets (
  account_id    bigint primary key references public.mail_accounts(id) on delete cascade,
  secret_cipher text not null,               -- AES-256-GCM（base64: iv|tag|ciphertext）
  updated_at    timestamptz not null default now()
);

comment on table public.mail_account_secrets is
  'IMAPパスワードの暗号化保管。RLSポリシー無し＝authenticatedは不可、service_roleのみ。';

-- ⚠️ RLS を有効化し、ポリシーは作らない。
--    これで authenticated（＝ブラウザからの anon/ログインユーザー）は
--    SELECT/INSERT/UPDATE/DELETE すべて拒否される。
--    service_role は RLS を迂回するので、サーバー側の同期・保存だけが可能。
alter table public.mail_account_secrets enable row level security;
