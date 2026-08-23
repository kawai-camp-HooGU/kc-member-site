-- ============================================================
-- メール検索の高速化（P1・全文検索）
--   件名・宛先・本文（キャッシュ済み）に対する部分一致検索（ILIKE %term%）を
--   pg_trgm の GIN 索引で高速化する。
--   ※ body_text は「開いた本文だけ」がキャッシュされるため、全文検索の対象は
--     取得済みメールに限られる（未取得は件名・差出などで従来どおりヒット）。
-- ============================================================
create extension if not exists pg_trgm;

create index if not exists mail_messages_subject_trgm
  on public.mail_messages using gin (subject gin_trgm_ops);
create index if not exists mail_messages_body_trgm
  on public.mail_messages using gin (body_text gin_trgm_ops);
create index if not exists mail_messages_to_trgm
  on public.mail_messages using gin (to_addr gin_trgm_ops);
