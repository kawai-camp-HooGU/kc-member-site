-- ============================================================
-- メール：会話（送受信一貫）対応（Step 3）
--   受信・送信を「相手ごと」に時系列で束ねて表示するための列を追加。
--   ・counterpart … 会話の相手アドレス（受信=差出人 / 送信=宛先）。グルーピングの軸
--   ・in_reply_to … RFC In-Reply-To（将来の厳密スレッド化・補助用）
-- ============================================================
alter table public.mail_messages
  add column if not exists counterpart text not null default '',
  add column if not exists in_reply_to text not null default '';

-- 既存行の counterpart をバックフィル（受信=差出人 / 送信=宛先）
update public.mail_messages
  set counterpart = case when direction = 'out' then to_addr else from_addr end
  where counterpart = '';

-- 相手ごと・新しい順の会話取得用インデックス
create index if not exists mail_messages_conv_idx
  on public.mail_messages(account_id, counterpart, received_at desc);

comment on column public.mail_messages.counterpart is '会話の相手アドレス（受信=from / 送信=to）。会話ビューのグルーピング軸';
