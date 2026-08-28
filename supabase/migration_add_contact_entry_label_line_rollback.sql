-- ============================================================
-- 切り戻し：contact_list_entries の label / line_display_name / line_user_id を撤去
--   REQ-049
--
--   ⚠️⚠️ 列を落とすと入力済みの値は復元できない。
--        実行前に必ず下のSQLで退避すること。
--
--   copy (
--     select id, list_id, label, line_display_name, line_user_id
--     from public.contact_list_entries
--     where label <> '' or line_display_name <> '' or line_user_id is not null
--   ) to stdout with csv header;
--
--   ⚠️ アプリを先に旧版へ戻してから実行する（順序は適用時と逆）。
-- ============================================================

drop function if exists public.contact_list_entry_labels(bigint);

drop index if exists public.idx_contact_entries_label;
drop index if exists public.idx_contact_entries_line_uid;

alter table public.contact_list_entries
  drop column if exists label,
  drop column if exists line_display_name,
  drop column if exists line_user_id;
