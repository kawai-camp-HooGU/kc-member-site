-- ============================================================
-- STEP4: シナリオ配信 外部メールリスト宛先
--   会員化されていないメールアドレスにもステップ配信できるようにする。
--   ・scenarios.audience_type … 'member'（会員から条件抽出）/ 'email'（外部リスト）
--   ・scenario_entries.member_id を任意化し、email 列を追加
--     （会員 or 外部アドレスのどちらでも 1 エントリーとして進捗管理する）
-- ============================================================

-- シナリオ：宛先タイプ（既定 member）
alter table public.scenarios
  add column if not exists audience_type text not null default 'member';

-- エントリー：非会員（外部アドレス）に対応
alter table public.scenario_entries alter column member_id drop not null;
alter table public.scenario_entries add column if not exists email text;

-- 外部アドレスの重複エントリー防止（同一シナリオ内で email は一意）
create unique index if not exists scenario_entries_email_uk
  on public.scenario_entries (scenario_id, lower(email))
  where email is not null;

comment on column public.scenarios.audience_type is
  'member=会員から条件抽出 / email=外部メールリスト';
comment on column public.scenario_entries.email is
  '外部メールリスト宛先（member_id が NULL のとき使用）';

-- ロールバック（必要時のみ）
-- drop index if exists public.scenario_entries_email_uk;
-- alter table public.scenario_entries drop column if exists email;
-- alter table public.scenarios drop column if exists audience_type;
-- ※ member_id の NOT NULL 復帰は既存 NULL 行を除去してから行うこと。
