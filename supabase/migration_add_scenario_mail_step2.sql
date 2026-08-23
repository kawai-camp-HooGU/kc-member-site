-- ============================================================
-- STEP2: シナリオ配信を「実用ステップメール」に近づける
--   - ステップ件名（scenario_steps.mail_subject）
--   - 送信元メールアカウント（scenarios.mail_account_id）
--   - 属性抽出モード（scenarios.attr_mode） … 一斉配信と同じ any/all/exany/exall
--
--   既存データは既定値で補完され、挙動は変わりません
--   （件名は未設定=フォールバック、attr_mode=any、mail_account_id=NULL=既定SMTP）。
-- ============================================================

-- シナリオ：属性抽出モード（既定 any＝いずれか含む）
alter table public.scenarios
  add column if not exists attr_mode text not null default 'any';

-- シナリオ：送信元メールアカウント（mail_accounts.id。NULL=環境変数SMTP）
alter table public.scenarios
  add column if not exists mail_account_id bigint
  references public.mail_accounts(id) on delete set null;

-- ステップ：メール件名（NULL/空=フォールバック「シナリオ名＋ステップ番号」）
alter table public.scenario_steps
  add column if not exists mail_subject text;

-- 参考：ロールバック（必要な場合のみ）
-- alter table public.scenarios      drop column if exists attr_mode;
-- alter table public.scenarios      drop column if exists mail_account_id;
-- alter table public.scenario_steps drop column if exists mail_subject;
