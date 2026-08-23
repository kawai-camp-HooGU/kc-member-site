-- ============================================================
-- 顧客情報：LINE顧客（会員未連携）を会員と同じUIで管理
--   member_memos / member_attributes を「会員 or LINE友だち」どちらにも
--   紐づけられるよう一般化する。
--     ・member_id を NULL 許容にし、friend_id を追加。
--     ・どちらか一方だけがセットされる（排他）ことを CHECK で保証。
--   LINE顧客の共通プロフィール（氏名・フリガナ・メール・電話・表示名）は
--   既存 line_friends（collected_* / display_name）をそのまま保存先に使う。
--
--   前提：LINE Phase 2（line_friends）＋ member_master（member_memos / member_attributes）適用済み。
-- ============================================================

-- ── member_memos：会員 or LINE友だち ─────────────────────────
alter table public.member_memos
  add column if not exists friend_id bigint references public.line_friends(id) on delete cascade;
alter table public.member_memos alter column member_id drop not null;
-- 排他：どちらか一方だけがセット（両方 null / 両方セットは禁止）
alter table public.member_memos drop constraint if exists member_memos_owner_ck;
alter table public.member_memos
  add constraint member_memos_owner_ck
  check ((member_id is not null)::int + (friend_id is not null)::int = 1);
create index if not exists member_memos_friend_idx on public.member_memos(friend_id);

-- ── member_attributes：会員 or LINE友だち ────────────────────
alter table public.member_attributes
  add column if not exists friend_id bigint references public.line_friends(id) on delete cascade;
-- 旧 PK (member_id, attribute_id) を外し、member_id を NULL 許容に
alter table public.member_attributes drop constraint if exists member_attributes_pkey;
alter table public.member_attributes alter column member_id drop not null;
alter table public.member_attributes drop constraint if exists member_attributes_owner_ck;
alter table public.member_attributes
  add constraint member_attributes_owner_ck
  check ((member_id is not null)::int + (friend_id is not null)::int = 1);
-- 一意性を所有者別に張り直す（会員×属性 / LINE×属性 で重複しない）
create unique index if not exists uq_member_attr_member
  on public.member_attributes(member_id, attribute_id) where member_id is not null;
create unique index if not exists uq_member_attr_friend
  on public.member_attributes(friend_id, attribute_id) where friend_id is not null;
create index if not exists member_attributes_friend_idx on public.member_attributes(friend_id);
