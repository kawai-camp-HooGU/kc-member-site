-- ============================================================
-- 一斉配信レポート：非会員（ポータル未登録）のクリックも集計できるように
--   broadcast_clicks に email 列を追加。
--   メールアドレス指定配信では、クリック記録に宛先メールを残し、
--   会員でなくても「訪問者一覧」にメアド単位で表示できるようにする。
-- ============================================================
alter table public.broadcast_clicks
  add column if not exists email text;

comment on column public.broadcast_clicks.email is
  '非会員クリックの宛先メール（メールアドレス指定配信の集計用）。会員クリックは member_id 側で識別。';

-- ロールバック（必要時のみ）
-- alter table public.broadcast_clicks drop column if exists email;
