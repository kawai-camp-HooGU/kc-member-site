-- ============================================================
-- Phase 4：一斉配信・シナリオ配信に LINE チャネルを追加
--   既存の配信基盤（宛先・変数・予約・cron）を流用し、送信先を切り替える。
--   ・broadcasts … channel_line / line_account_id / line_audience / line_sent_count
--   ・scenario_steps … channel_line（ステップ単位でLINE送信）
--   ・scenarios … line_account_id（どのLINE公式アカウントから送るか）
--   宛先モード（line_audience）:
--     'linked' … 属性・流入経路で絞った会員のうち、連携済みの友だち
--     'all'    … そのアカウントの友だち全員（未連携含む。属性は無視）
-- ============================================================
alter table public.broadcasts
  add column if not exists channel_line boolean not null default false;
alter table public.broadcasts
  add column if not exists line_account_id int references public.line_accounts(id) on delete set null;
alter table public.broadcasts
  add column if not exists line_audience text not null default 'linked'
    check (line_audience in ('linked', 'all'));
alter table public.broadcasts
  add column if not exists line_sent_count int not null default 0;

alter table public.scenario_steps
  add column if not exists channel_line boolean not null default false;

alter table public.scenarios
  add column if not exists line_account_id int references public.line_accounts(id) on delete set null;
