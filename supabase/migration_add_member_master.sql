-- ============================================================
-- メンバーマスタ拡張
--   members に 氏名カナ・電話・都道府県・登録日時を追加。
--   属性ABC（多対多）と メモ明細（1対多）を新設。
-- ============================================================

-- members 拡張列
alter table public.members add column if not exists kana        text;
alter table public.members add column if not exists tel         text;
alter table public.members add column if not exists prefecture  text;
alter table public.members add column if not exists created_at  timestamptz default now();

-- メンバー × 属性（多対多）。attribute_id は選択した最も深いノード（末端）。
create table if not exists public.member_attributes (
  member_id    bigint not null references public.members(id) on delete cascade,
  attribute_id bigint not null references public.attributes(id) on delete cascade,
  primary key (member_id, attribute_id)
);
create index if not exists member_attributes_member_idx on public.member_attributes(member_id);
create index if not exists member_attributes_attr_idx   on public.member_attributes(attribute_id);
alter table public.member_attributes enable row level security;
drop policy if exists "member_attributes_all" on public.member_attributes;
create policy "member_attributes_all" on public.member_attributes
  for all to authenticated using (true) with check (true);

-- メンバーのメモ明細（タイトル・本文・更新日時）
create table if not exists public.member_memos (
  id         bigint generated always as identity primary key,
  member_id  bigint not null references public.members(id) on delete cascade,
  title      text not null default '',
  body       text not null default '',
  sort_order int  not null default 0,
  updated_at timestamptz default now()
);
create index if not exists member_memos_member_idx on public.member_memos(member_id);
alter table public.member_memos enable row level security;
drop policy if exists "member_memos_all" on public.member_memos;
create policy "member_memos_all" on public.member_memos
  for all to authenticated using (true) with check (true);
