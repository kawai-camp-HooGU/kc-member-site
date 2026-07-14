-- ============================================================
-- 流入経路アクション（sources.actions の有効化）
--
--   migration_add_action_rules.sql で sources.actions（jsonb）は追加済み。
--   ここでは「発火回数」を経路ごとに選べるようにする1列だけを足す。
--
--     fire_once = true  … 1人1経路につき1回だけ発火（既定）
--                          action_events(member_id, ref_key='source:{id}') の
--                          一意インデックスが重複を弾く。
--     fire_once = false … クリックのたびに発火（属性付与は冪等だが、
--                          チャット送信は毎回届く点に注意）
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

alter table public.sources
  add column if not exists actions jsonb not null default '[]'::jsonb;

alter table public.sources
  add column if not exists fire_once boolean not null default true;

comment on column public.sources.actions   is 'この流入経路が会員に紐づいた／会員が公開URLを踏んだ時に実行するアクション（FormAction[]と同型）';
comment on column public.sources.fire_once is 'true=1人1経路につき1回だけ発火／false=クリックのたびに発火';
