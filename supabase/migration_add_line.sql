-- ============================================================
-- LINE公式アカウント連携 Phase 1（受信基盤＋トーク）
--   既存 chat_* とは別系統。運営（管理者・オペレーター）専用。
--   ・line_friends   … 友だち1人＝1行（LINEのuserIdが正本）
--   ・line_messages  … 送受信メッセージ（line_message_id で冪等）
--   ・line_greetings … 友だち追加あいさつ（流入経路ごとに出し分け／既定行あり）
--   ・members に line_user_id / line_linked_at を追加（Phase2の名寄せ用。今は未使用）
--
--   ⚠️ 受信・送信の書き込みはサーバー（service_role / lib/lineServer.ts）で行う。
--      RLS は画面（クライアント）からの読み書きを運営限定にするためのもの。
-- ============================================================

-- ── 友だち（1人＝1行）───────────────────────────────────────
create table if not exists public.line_friends (
  id                 bigserial primary key,
  line_user_id       text not null unique,                       -- LINEのuserId（正本）
  member_id          int references public.members(id) on delete set null,  -- Phase2で名寄せ。Phase1は常にnull
  display_name       text,                                       -- プロフィールAPI取得値（cronで後追い）
  picture_url        text,
  status             text not null default 'friend'
                       check (status in ('friend','blocked','unfollowed')),
  followed_at        timestamptz,
  unfollowed_at      timestamptz,
  last_message_at    timestamptz,                                -- 並び替え用（新着を上に）
  last_message_snip  text,                                       -- 一覧プレビュー
  staff_last_read_at timestamptz,                                -- 既読位置（「確認済」で now）
  assigned_to        int references public.members(id) on delete set null,   -- 担当スタッフ
  source_id          int references public.sources(id) on delete set null,   -- 流入経路（Phase1は未使用）
  tag_ids            int[] not null default '{}',                -- 既存タグ運用（Phase1は未使用）
  created_at         timestamptz not null default now()
);
create index if not exists idx_line_friends_last   on public.line_friends(last_message_at desc);
create index if not exists idx_line_friends_status on public.line_friends(status);
create index if not exists idx_line_friends_member on public.line_friends(member_id);

comment on table public.line_friends is 'LINE友だち（1人＝1行）。line_user_id が正本。運営専用。';

-- ── メッセージ（送受信）─────────────────────────────────────
create table if not exists public.line_messages (
  id               bigserial primary key,
  friend_id        bigint not null references public.line_friends(id) on delete cascade,
  line_message_id  text unique,                                  -- LINE採番ID。UNIQUEで冪等（再送の二重登録防止）
  direction        text not null check (direction in ('in','out')),
  msg_type         text not null default 'text'
                     check (msg_type in ('text','image','video','audio','file','sticker','location','flex','other')),
  body             text not null default '',                     -- テキスト本文 or 種別の説明文
  media_status     text not null default 'none'
                     check (media_status in ('none','pending','stored','failed')),
  media_path       text,                                         -- Storage退避先（line-media バケット）
  media_mime       text,
  sent_by          int references public.members(id) on delete set null,  -- outの送信スタッフ。自動送信はnull
  send_kind        text check (send_kind in ('reply','push','multicast','narrowcast')),
  reply_token      text,                                         -- 受信時のみ一時保持（任意）
  raw              jsonb,                                         -- Webhook生ペイロード（仕様追随用）
  created_at       timestamptz not null default now()            -- LINEのtimestampを採用（無ければnow）
);
create index if not exists idx_line_messages_friend on public.line_messages(friend_id, created_at);
create index if not exists idx_line_messages_media_pending
  on public.line_messages(media_status) where media_status = 'pending';

comment on table public.line_messages is 'LINE送受信メッセージ。line_message_id UNIQUE で冪等。運営専用。';

-- ── 友だち追加あいさつ（流入経路ごとの出し分け）─────────────
--   source_id is null の行が「既定」。Phase1 は経路未検出のため既定行のみ使う。
create table if not exists public.line_greetings (
  id         bigserial primary key,
  source_id  int references public.sources(id) on delete cascade,  -- null = 既定（全員向け）
  message    text not null,
  is_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
-- source_id ごと（既定含む）に1行に制限。null は -1 に畳んで一意化。
create unique index if not exists uq_line_greetings_source
  on public.line_greetings(coalesce(source_id, -1));

comment on table public.line_greetings is 'LINE友だち追加あいさつ。source_id null=既定。運営専用。';

-- ── members への追加（Phase2の名寄せ用。Phase1では書き込まない）──
alter table public.members add column if not exists line_user_id  text;
alter table public.members add column if not exists line_linked_at timestamptz;
create unique index if not exists uq_members_line_user_id
  on public.members(line_user_id) where line_user_id is not null;

-- ── RLS（運営のみ。既存 is_ops() を流用）───────────────────
alter table public.line_friends   enable row level security;
alter table public.line_messages  enable row level security;
alter table public.line_greetings enable row level security;

drop policy if exists "line_friends_ops" on public.line_friends;
create policy "line_friends_ops" on public.line_friends
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

drop policy if exists "line_messages_ops" on public.line_messages;
create policy "line_messages_ops" on public.line_messages
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

drop policy if exists "line_greetings_ops" on public.line_greetings;
create policy "line_greetings_ops" on public.line_greetings
  for all to authenticated using (public.is_ops()) with check (public.is_ops());

-- ── Storage（受信メディアの退避先。非公開）────────────────
insert into storage.buckets (id, name, public)
values ('line-media', 'line-media', false)
on conflict (id) do nothing;

-- 退避は /api/cron/line-sync（service role）が行う。閲覧（署名URL発行）のみ運営に許可。
drop policy if exists "line_media_read_ops" on storage.objects;
create policy "line_media_read_ops" on storage.objects
  for select to authenticated using (bucket_id = 'line-media' and public.is_ops());

-- ── Realtime ────────────────────────────────────────────
alter publication supabase_realtime add table public.line_friends;
alter publication supabase_realtime add table public.line_messages;

-- ── seed：既定あいさつ（source_id = null）を1件だけ用意 ──────
--   文面は後日差し替え可（line_greetings を編集）。
insert into public.line_greetings (source_id, message, is_enabled)
values (
  null,
  'はじめまして！KAWAI CAMP事務局です。' || chr(10) ||
  'ご登録ありがとうございます。' || chr(10) ||
  'ご質問はこのトークにお送りください。担当者が順次ご返信します。',
  true
)
on conflict (coalesce(source_id, -1)) do nothing;
