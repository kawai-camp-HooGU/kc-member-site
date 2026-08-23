-- ============================================================
-- メール本文の遅延DBキャッシュ（Phase 1.7）
--   ハイブリッド型を維持しつつ、「一度開いて取得に成功した本文だけ」を
--   DBに書き戻すレイジーキャッシュを導入する。
--   ・同期(cron)は従来どおり見出しのみ取得＝負荷は変えない。
--   ・本文は初回オープン時にIMAP取得し、その結果をDBへ保存する。
--   ・以後はサーバー側から本文が消えても、DBキャッシュで表示できる（①の対策）。
--
--   カラムはすべて nullable。body_cached_at IS NULL＝未キャッシュ。
--   （空メールと「未取得」を区別するため、default '' は使わない）
-- ============================================================
alter table public.mail_messages
  add column if not exists body_text      text,
  add column if not exists body_html      text,
  add column if not exists body_cached_at timestamptz;

comment on column public.mail_messages.body_text      is '本文テキスト（初回オープン時にIMAPから取得してキャッシュ）。NULL=未取得。';
comment on column public.mail_messages.body_html      is '本文HTML（生。表示時はサニタイズ前提）。NULL=未取得。';
comment on column public.mail_messages.body_cached_at is '本文をDBへキャッシュした日時。NULL=未キャッシュ。';

comment on table public.mail_messages is
  '受信メールの見出し・状態＋本文の遅延キャッシュ（ハイブリッド型。本文は初回オープン時にIMAP取得しDB保存）。';
