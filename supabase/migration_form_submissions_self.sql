-- ============================================================
-- 「自分の回答」は自分でも読めるようにする
--
--   form_submissions は Phase1 RLS で ops_only（運営のみ）になっている。
--   そのため会員側では「このフォームに回答済みか」が判定できず、
--   カレンダーのフォーム締切チップやホームの「未回答」表示が
--   常に "未回答" になってしまう。
--
--   ⚠️ permissive ポリシーは OR で合成されるため、既存の ops_only を
--      消さずに SELECT を1本足すだけでよい（運営は従来どおり全件見える）。
--   ⚠️ 追加するのは SELECT のみ。書き込みは引き続き /api/form/submit（service role）経由。
-- ============================================================

drop policy if exists "form_submissions_select_self" on public.form_submissions;
create policy "form_submissions_select_self" on public.form_submissions
  for select to authenticated
  using (member_id = public.current_member_id());

comment on table public.form_submissions is
  '回答（1送信＝1レコード）。運営は全件、会員は自分の回答のみ参照可。';
