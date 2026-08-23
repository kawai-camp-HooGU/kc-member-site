-- ============================================================
-- 権限マスタ（role_permissions）の書き込みを運営ロールへ限定開放する
--
--   これまで：読み取り＝全員 / 書き込み＝is_admin()（管理者のみ）
--             （migration_role_permissions_admin_only.sql）
--   これから：読み取り＝全員
--             書き込み＝管理者は全ロール
--                       運営ロール（オペレーター・その派生）は
--                       「会員側ロールの行」だけ
--
--   【背景】
--   権限タブを運営ロールにも開放する要望に対応する。
--   ただし migration_role_permissions_admin_only.sql で
--   「オペレーターが自分やメンバーの権限を書き換えられると
--     権限設計そのものが崩れる（権限昇格の温床）」として
--   管理者限定に絞った経緯がある。
--
--   【方針】
--   その懸念は「自分の属する運営ロールを書き換えられること」に起因する。
--   そこで運営ロールには "会員側ロールの行のみ" を許可し、
--   自己昇格の経路だけを塞いだうえで開放する。
--
--   ⚠️ 画面側（lib/permissions.ts の canEditRoleColumn）と
--      必ず同じ条件にすること。画面だけ絞ってもAPIを直接叩けば通ってしまう。
--
--   ⚠️ 「管理者」行は運営ロールから一切触れない。
--      画面でも管理者列は非表示（visibleRoleColumns）。
-- ============================================================

-- 対象ロールが運営側（管理者・オペレーター・その派生）か
--   ⚠️ SECURITY DEFINER。roles は全員 select 可だが、
--      ポリシー内から参照するため関数に切り出して再帰を避ける。
create or replace function public.is_staff_role(target_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select r.key in ('管理者', 'オペレーター')
        or r.base_role = 'オペレーター'
      from public.roles r
     where r.key = target_role
  ), false)
$$;

grant execute on function public.is_staff_role(text) to authenticated;

-- ── 既存ポリシーを差し替え ──────────────────────────────────
drop policy if exists "role_permissions_insert_admin" on public.role_permissions;
drop policy if exists "role_permissions_update_admin" on public.role_permissions;
drop policy if exists "role_permissions_delete_admin" on public.role_permissions;

-- 管理者は全ロール、運営ロールは「会員側ロールの行」のみ書き込める
create policy "role_permissions_insert_ops" on public.role_permissions
  for insert to authenticated
  with check (
    public.is_admin()
    or (public.is_ops() and not public.is_staff_role(role))
  );

create policy "role_permissions_update_ops" on public.role_permissions
  for update to authenticated
  using (
    public.is_admin()
    or (public.is_ops() and not public.is_staff_role(role))
  )
  with check (
    public.is_admin()
    or (public.is_ops() and not public.is_staff_role(role))
  );

create policy "role_permissions_delete_ops" on public.role_permissions
  for delete to authenticated
  using (
    public.is_admin()
    or (public.is_ops() and not public.is_staff_role(role))
  );

-- ⚠️ roles テーブル（ロールの追加・削除）は管理者限定のまま据え置く。
--    ロールそのものを作れると base_role 経由で運営権限を生成できてしまうため。
