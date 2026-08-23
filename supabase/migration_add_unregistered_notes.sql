-- ============================================================
-- 会員未登録メールアドレスの運営メモ
--
--   メンバー一覧 ＞「会員未登録」タブで使う。フォーム回答・決済情報に
--   出てくるのに members に登録が無いメールアドレスへ、運営がメモを残す。
--
--   ⚠️ 会員ではないので members には書けない。メールアドレスを主キーにする。
--   ⚠️ email は必ず小文字へ正規化して保存する（照合も lower 同士で行う）。
--      API 側（/api/ops/unregistered-notes）で trim + toLowerCase 済み。
--
--   その人が後から会員登録されても、この行は消さない。
--   一覧からは自動的に消える（＝members に居るので未登録ではなくなる）が、
--   再び未登録の状態が現れたときに過去のメモが復活する方が運用しやすい。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

create table if not exists public.unregistered_notes (
  email      text primary key,
  note       text not null default '',
  updated_by text,
  updated_at timestamptz not null default now()
);

comment on table  public.unregistered_notes            is '会員未登録メールアドレスへの運営メモ（メンバー一覧＞会員未登録タブ）';
comment on column public.unregistered_notes.email      is 'メールアドレス（小文字に正規化して保存）';
comment on column public.unregistered_notes.updated_by is '最終更新した運営メンバーの氏名（表示用のスナップショット）';

-- RLS：運営（管理者・オペレーター・その派生ロール）のみ。会員ゾーンからは一切見えない。
--   ⚠️ ロールのキーは日本語（'管理者' / 'オペレーター'）。派生ロールも拾えるよう
--      直接比較ではなく is_ops()（migration_add_roles_master.sql）を使う。
alter table public.unregistered_notes enable row level security;

drop policy if exists unregistered_notes_ops_all on public.unregistered_notes;
create policy unregistered_notes_ops_all on public.unregistered_notes
  for all to authenticated
  using (public.is_ops())
  with check (public.is_ops());
