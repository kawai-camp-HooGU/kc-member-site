-- ============================================================
-- 一斉配信 宛先設定の拡張
--   ② 属性ABCの抽出モード（いずれか含む/すべて含む/除外）を保持
--   ③ メールアドレス指定配信（貼り付けたメアド一覧）を保持
--
--   target_mode は既存 text カラム（all|filter）に 'email' を追加で受け付ける。
--   ※ 何度実行しても安全（add column if not exists）
-- ============================================================

alter table public.broadcasts
  -- ② 属性抽出モード： any | all | exany | exall（既定は従来挙動の any）
  add column if not exists attr_mode     text  not null default 'any',
  -- ③ メールアドレス指定配信の宛先（target_mode='email' のとき使用）
  add column if not exists target_emails text[] not null default '{}';

comment on column public.broadcasts.attr_mode is
  '属性ABCの抽出モード: any(いずれか含む) / all(すべて含む) / exany(いずれか含むを除外) / exall(すべて含むを除外)';
comment on column public.broadcasts.target_emails is
  'target_mode=email のときの配信先メールアドレス一覧（スプレッドシート等からの貼り付け）';
