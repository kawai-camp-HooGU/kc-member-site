-- ============================================================
-- アカウント単位権限 enforcement（Phase 2b）── RLS
--
--   LINE/メールの「そのロールでは非表示（access='none'/'off'）」を
--   サーバー側（RLS）でも実効化する。
--
--   ★方針：「デフォルト許可・明示的拒否のみ」
--     account_role_access に access='none'（アクセス系）/'off'（通知系）の
--     行が明示的に存在するロール×アカウントの組み合わせだけを拒否する。
--     行が無ければ従来どおり全て見える（＝適用しても既存挙動は変わらない）。
--     管理者は常に全て見える。
--
--   ⚠️ 前提：migration_add_permission_redesign.sql（account_role_access 作成）を先に適用。
--   ⚠️ RESTRICTIVE ポリシーとして追加するため、既存の許可ポリシーと AND される。
--      拒否行が無い間は NOT denied = true となり、何も制限しない（安全なロールアウト）。
--   ⚠️ service_role（/api の管理系ルート）は RLS を迂回する。UI 側の絞り込みは
--      hooks/useAccountAccess.ts（canSeeAccount）で別途行う（多層防御）。
-- ============================================================

-- 指定アカウントが「現在のロールで明示的に拒否されているか」
--   feature 別（line_chat / line_friends / mailbox / mailthreads）に判定する。
create or replace function public.account_access_denied(
  p_feature text, p_type text, p_account_id bigint
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_admin() then false
    else exists (
      select 1
        from public.account_role_access a
       where a.account_type = p_type
         and a.account_id   = p_account_id
         and a.role_key     = public.current_role_key()
         and a.feature      = p_feature
         and a.access in ('none', 'off')
    )
  end
$$;
grant execute on function public.account_access_denied(text, text, bigint) to authenticated;

-- ── LINE トーク（line_messages）: feature 'line_chat' ──────────
drop policy if exists "line_messages_acc_deny" on public.line_messages;
create policy "line_messages_acc_deny" on public.line_messages
  as restrictive for select to authenticated
  using ( not public.account_access_denied('line_chat', 'line', account_id) );

-- ── LINE 友だち（line_friends）: feature 'line_friends' ────────
drop policy if exists "line_friends_acc_deny" on public.line_friends;
create policy "line_friends_acc_deny" on public.line_friends
  as restrictive for select to authenticated
  using ( not public.account_access_denied('line_friends', 'line', account_id) );

-- ── メール（mail_messages）: feature 'mailbox' ────────────────
drop policy if exists "mail_messages_acc_deny" on public.mail_messages;
create policy "mail_messages_acc_deny" on public.mail_messages
  as restrictive for select to authenticated
  using ( not public.account_access_denied('mailbox', 'mail', account_id) );

-- ============================================================
-- ロールバック:
--   drop policy if exists "line_messages_acc_deny"  on public.line_messages;
--   drop policy if exists "line_friends_acc_deny"   on public.line_friends;
--   drop policy if exists "mail_messages_acc_deny"  on public.mail_messages;
--   drop function if exists public.account_access_denied(text, text, bigint);
-- ============================================================
