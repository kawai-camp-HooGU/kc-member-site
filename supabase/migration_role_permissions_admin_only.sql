-- ============================================================
-- 権限マスタ（role_permissions）の書き込みを「管理者のみ」に絞る
--
--   これまで：読み取り＝全員 / 書き込み＝is_ops()（管理者＋オペレーター）
--   これから：読み取り＝全員 / 書き込み＝is_admin()（管理者のみ）
--
--   理由：権限マスタは「誰が何を触れるか」を決める最上位の設定。
--         オペレーターが自分やメンバーの権限を書き換えられると、
--         権限設計そのものが崩れる（権限昇格の温床）。
--         画面（PermissionTab）は既に管理者専用だが、API を直接叩けば
--         is_ops() のままでは書けてしまうため、サーバー側も管理者限定にする。
--
--   ⚠️ 読み取り(read_all)はそのまま。全ユーザーが自分の can() を計算するのに必要。
-- ============================================================

drop policy if exists "write_ops"  on public.role_permissions;
drop policy if exists "update_ops" on public.role_permissions;
drop policy if exists "delete_ops" on public.role_permissions;

create policy "role_permissions_insert_admin" on public.role_permissions
  for insert to authenticated
  with check (public.is_admin());

create policy "role_permissions_update_admin" on public.role_permissions
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "role_permissions_delete_admin" on public.role_permissions
  for delete to authenticated
  using (public.is_admin());
