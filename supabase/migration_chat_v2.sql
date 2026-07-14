-- ============================================================
-- チャット強化：送信元の判別 ／ リプライ ／ リンク訪問の計測
--
--   BEFORE
--     ・一斉配信もシナリオも手動返信も、すべて sender_side='staff' /
--       sender_member_id=null で入っていた → **事後的に区別できない**
--     ・本文中のURLはただのテキスト。会員が踏んだかどうか分からない
--
--   AFTER
--     ・chat_messages.origin      … staff / broadcast / scenario / action
--     ・chat_messages.reply_to_id … 引用返信（自己参照）
--     ・chat_links                … 本文から抽出したURL。訪問日時・回数を持つ
--
--   ⚠️ 既存メッセージの origin は 'staff' になる（過去分は区別できない）。
--   ⚠️ リンク訪問の計測は /api/chat/click を経由したときだけ記録される。
--      会員が本文のURLをコピーして直接開いた場合は記録されない。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. 送信元・リプライ ─────────────────────────────────────
alter table public.chat_messages
  add column if not exists origin text not null default 'staff',
  add column if not exists reply_to_id bigint references public.chat_messages(id) on delete set null;

-- 値の取り違えを防ぐ（member = 会員の発言。staff = 運営が手で書いた返信）
alter table public.chat_messages drop constraint if exists chat_messages_origin_check;
alter table public.chat_messages add constraint chat_messages_origin_check
  check (origin in ('member', 'staff', 'broadcast', 'scenario', 'action'));

comment on column public.chat_messages.origin is
  'member=会員 / staff=運営が手で送信 / broadcast=一斉配信 / scenario=シナリオ配信 / action=自動アクション';
comment on column public.chat_messages.reply_to_id is '引用返信の元メッセージ。削除されたら NULL（「削除されたメッセージ」と表示）';

-- ── 2. 本文中のURL（訪問計測）────────────────────────────────
--   1メッセージ＝1会話＝1会員なので、クリックログを別表にせず
--   「リンク行そのもの」に訪問日時と回数を持たせる（読み出しが1回で済む）。
create table if not exists public.chat_links (
  id           bigint generated always as identity primary key,
  message_id   bigint not null references public.chat_messages(id) on delete cascade,
  url          text   not null,
  clicked_at   timestamptz,          -- 最初に踏まれた日時（NULL＝未訪問）
  last_click_at timestamptz,         -- 最後に踏まれた日時
  click_count  int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists chat_links_message_idx on public.chat_links(message_id);

-- RLS
--   ・運営（is_ops）… 参照・作成（手動返信の送信時にクライアントから insert する）
--   ・会員          … 自分の会話にぶら下がるリンクだけ参照できる（本文の描画に必要）
--   ・訪問の記録（update）は service_role（/api/chat/click）だけが行う
alter table public.chat_links enable row level security;

drop policy if exists "chat_links_select" on public.chat_links;
create policy "chat_links_select" on public.chat_links for select to authenticated
  using (
    public.is_ops()
    or exists (
      select 1
        from public.chat_messages m
        join public.chat_conversations c on c.id = m.conversation_id
        join public.members mem on mem.id = c.member_id
       where m.id = chat_links.message_id
         and mem.user_id = auth.uid()
    )
  );

drop policy if exists "chat_links_insert_ops" on public.chat_links;
create policy "chat_links_insert_ops" on public.chat_links for insert to authenticated
  with check (public.is_ops());

comment on table public.chat_links is 'チャット本文中のURL。/api/chat/click 経由の訪問を記録する（未訪問なら clicked_at is null）';
