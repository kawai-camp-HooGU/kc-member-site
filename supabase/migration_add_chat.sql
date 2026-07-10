-- チャット（社内スタッフ ↔ メンバー〈顧客〉）
create table if not exists public.chat_conversations (
  id                bigserial primary key,
  member_id         int not null unique references public.members(id) on delete cascade,
  assigned_to       int references public.members(id) on delete set null,
  last_message_at   timestamptz,
  last_message_snip text,
  staff_last_read_at  timestamptz,
  member_last_read_at timestamptz,
  created_at        timestamptz default now()
);
create table if not exists public.chat_messages (
  id               bigserial primary key,
  conversation_id  bigint not null references public.chat_conversations(id) on delete cascade,
  sender_member_id int references public.members(id) on delete set null,
  sender_side      text not null check (sender_side in ('member','staff')),
  body             text default '',
  created_at       timestamptz default now()
);
create table if not exists public.chat_attachments (
  id           bigserial primary key,
  message_id   bigint not null references public.chat_messages(id) on delete cascade,
  file_name    text not null,
  storage_path text not null,
  mime_type    text,
  size_bytes   bigint,
  created_at   timestamptz default now()
);
create index if not exists idx_chat_messages_conv on public.chat_messages(conversation_id, created_at);
create index if not exists idx_chat_conv_last on public.chat_conversations(last_message_at desc);

alter table public.chat_conversations enable row level security;
alter table public.chat_messages     enable row level security;
alter table public.chat_attachments  enable row level security;

-- 自分の member.id / role を引くヘルパー
create or replace function public.current_member_id() returns int language sql stable as $$
  select id from public.members where user_id = auth.uid() and is_deleted = false limit 1
$$;
create or replace function public.current_member_role() returns text language sql stable as $$
  select role from public.members where user_id = auth.uid() and is_deleted = false limit 1
$$;

-- スタッフ（管理者/オペレーター）＝全件、メンバー＝自分の会話のみ
drop policy if exists "chat_conv_staff" on public.chat_conversations;
create policy "chat_conv_staff" on public.chat_conversations for all to authenticated
  using (public.current_member_role() in ('管理者','オペレーター') or member_id = public.current_member_id())
  with check (public.current_member_role() in ('管理者','オペレーター') or member_id = public.current_member_id());

drop policy if exists "chat_msg_staff" on public.chat_messages;
create policy "chat_msg_staff" on public.chat_messages for all to authenticated
  using (public.current_member_role() in ('管理者','オペレーター')
     or conversation_id in (select id from public.chat_conversations where member_id = public.current_member_id()))
  with check (public.current_member_role() in ('管理者','オペレーター')
     or conversation_id in (select id from public.chat_conversations where member_id = public.current_member_id()));

drop policy if exists "chat_att_staff" on public.chat_attachments;
create policy "chat_att_staff" on public.chat_attachments for all to authenticated
  using (public.current_member_role() in ('管理者','オペレーター')
     or message_id in (select m.id from public.chat_messages m join public.chat_conversations c on c.id=m.conversation_id where c.member_id = public.current_member_id()))
  with check (true);

-- Realtime
alter publication supabase_realtime add table public.chat_conversations;
alter publication supabase_realtime add table public.chat_messages;
