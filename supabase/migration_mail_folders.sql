-- ============================================================
-- メール：フォルダ対応（Step 1）
--   INBOX だけでなく IMAP の全フォルダ（送信済み・ゴミ箱・カスタム等）を
--   同期できるようにする。
--   ・mail_messages … folder（所属フォルダのパス）と direction（in/out）を追加
--   ・UID の一意性は「フォルダ内で一意」なので (account_id, folder, uid) へ変更
--   ・mail_sync_state … 同期カーソルをフォルダ単位に（主キーを複合へ）
-- ============================================================

-- ── mail_messages：フォルダ・方向を追加 ──────────────────────
alter table public.mail_messages
  add column if not exists folder    text not null default 'INBOX',
  add column if not exists direction text not null default 'in';   -- in=受信 / out=送信

-- UID 一意を (account_id, folder, uid) に張り替える
drop index if exists mail_messages_uid_uq;
create unique index if not exists mail_messages_uid_uq
  on public.mail_messages(account_id, folder, uid);

-- フォルダ別・新しい順の一覧用
create index if not exists mail_messages_folder_idx
  on public.mail_messages(account_id, folder, received_at desc);

-- ── mail_sync_state：同期カーソルをフォルダ単位に ────────────
alter table public.mail_sync_state
  add column if not exists folder text not null default 'INBOX';

-- 主キーを (account_id) → (account_id, folder) に張り替える
alter table public.mail_sync_state drop constraint if exists mail_sync_state_pkey;
alter table public.mail_sync_state add constraint mail_sync_state_pkey
  primary key (account_id, folder);

comment on column public.mail_messages.folder    is 'IMAPフォルダのパス（INBOX / Sent / INBOX/対応中 など）';
comment on column public.mail_messages.direction is '方向：in=受信 / out=送信（送信済みフォルダは out）';
