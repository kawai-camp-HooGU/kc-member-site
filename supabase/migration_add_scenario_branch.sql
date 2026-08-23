-- ============================================================
-- STEP5: シナリオ配信 条件分岐
--   ステップの後で「本文URLのクリック有無」または「属性の有無」により
--   次のステップを出し分ける（分岐先＝指定ステップ or シナリオ終了）。
--   クリック判定は送信後に一定時間待ってから評価する（branch_wait_hours）。
-- ============================================================

-- ステップ：分岐設定
alter table public.scenario_steps
  add column if not exists branch_type text not null default 'none',       -- none / click / attr
  add column if not exists branch_attr_ids jsonb not null default '[]'::jsonb, -- attr条件で判定する属性ID
  add column if not exists branch_yes int,                                   -- 条件成立時の分岐先ステップ番号（0始まり）。-1=終了 / NULL=次へ
  add column if not exists branch_no  int,                                   -- 条件不成立時の分岐先
  add column if not exists branch_wait_hours int not null default 24;        -- クリック判定までの待ち時間（時間）

-- エントリー：送信済みステップの記録（分岐の二段階評価に使用）
alter table public.scenario_entries
  add column if not exists sent_step int not null default -1;               -- 送信済みの最大ステップ番号（-1=未送信）

comment on column public.scenario_steps.branch_type is
  'none=分岐なし / click=本文URLクリック有無 / attr=属性の有無';
comment on column public.scenario_entries.sent_step is
  '送信済みの最大ステップ番号。分岐ステップの「送信→待機→判定」の二段階制御に使用。';

-- ロールバック（必要時のみ）
-- alter table public.scenario_steps drop column if exists branch_type, drop column if exists branch_attr_ids,
--   drop column if exists branch_yes, drop column if exists branch_no, drop column if exists branch_wait_hours;
-- alter table public.scenario_entries drop column if exists sent_step;
