-- ============================================================
-- ロードマップ：タスク権限キーの整備
--   1) task_create（タスクの新規作成）を新設し、role_permissions へ既定値を投入
--   2) task_edit（タスクの編集）を派生ロールにも行として持たせる
--
--   背景：
--     ・カンバンの「＋ タスクを追加」は bulk_register（一括登録）を流用していた。
--       一括登録を OFF にすると、通常のタスク追加まで巻き添えで消えていたため分離する。
--     ・task_edit はキー定義だけで enforcement 未配線だった。今回コード側へ配線したため、
--       派生ロール（ホルダー等）に行が無いと canFor() が false（安全側）に倒れて
--       編集できなくなる。取りこぼしを防ぐためここで明示的に行を作る。
--
--   ⚠️ 既存行は上書きしない（on conflict do nothing）。
--      すでに運用で OFF にしている設定を勝手に ON へ戻さないため。
--   ⚠️ role_permissions.role は public.roles(key) への FK（migration_add_roles_master.sql）。
--      派生ロールを含めるため roles マスタを基準に流し込む。
-- ============================================================

-- ── 1) システム固定4ロールの既定値（lib/permissions.ts の DEFAULT_PERMS と一致させること）──
--   管理者 / オペレーター / メンバー … ON、外部 … OFF
insert into public.role_permissions (role, feature, enabled) values
('管理者','task_create',true),
('オペレーター','task_create',true),
('メンバー','task_create',true),
('外部','task_create',false),
('管理者','task_edit',true),
('オペレーター','task_edit',true),
('メンバー','task_edit',true),
('外部','task_edit',false)
on conflict (role, feature) do nothing;

-- ── 2) 派生ロール（base_role = 'オペレーター'）にも行を持たせる ──
--   派生ロールは DEFAULT_PERMS を持たない（canFor は false へフォールバック）。
--   派生元＝オペレーターと同じ値で初期化する。
insert into public.role_permissions (role, feature, enabled)
select r.key, f.feature, true
  from public.roles r
 cross join (values ('task_create'), ('task_edit')) as f(feature)
 where r.is_system = false
on conflict (role, feature) do nothing;

-- ============================================================
-- 確認:
--   select role, feature, enabled from public.role_permissions
--    where feature in ('task_create','task_edit') order by feature, role;
--
-- ロールバック:
--   delete from public.role_permissions where feature = 'task_create';
--   （task_edit の行は旧 migration_add_permission_redesign.sql でも投入済みのため残す）
-- ============================================================
