-- ============================================================
-- メール保存方式：キャッシュ型 → ハイブリッド型へ変更（Phase 1.6）
--   本文（body）をDBに常設しない方針へ切り替える。
--   ・DBに残すのは「見出し・状態」だけ（差出人・件名・日時・会員照合・
--     既読/スター/フラグ・UID など）。
--   ・本文は画面で開いた瞬間に IMAP から都度取得する（保存しない）。
--
--   よって本文・プレビュー用のカラムを削除する。
--     - body_text / body_html … 本文（削除＝以後DBに保存しない）
--     - snippet               … 本文先頭のプレビュー（本文由来のため削除）
--   ⚠️ 既存行に保存済みの本文・プレビューも、この削除で消える（＝目的どおり）。
-- ============================================================
alter table public.mail_messages
  drop column if exists body_text,
  drop column if exists body_html,
  drop column if exists snippet;

comment on table public.mail_messages is
  '受信メールの見出し・状態（本文は保存しない＝ハイブリッド型。本文は都度IMAP取得）。';
