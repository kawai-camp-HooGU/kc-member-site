-- ============================================================
-- LINE 送信メディア用の公開バケット（画像・動画の送信）
--   LINEのメディアメッセージは「公開HTTPS URL」を指定して送るため、
--   送信するファイルは公開バケットに置き、その公開URLをLINEへ渡す。
--   ・アップロードは運営（is_ops）のみ（クライアントから直接Supabaseへ）。
--   ・読み取りは公開（LINEプラットフォームが取得できる必要があるため）。
--   ・パスは friendId/uuid.ext（推測困難）。
-- ============================================================
insert into storage.buckets (id, name, public)
values ('line-outbound', 'line-outbound', true)
on conflict (id) do nothing;

-- アップロード（INSERT）は運営のみ
drop policy if exists "line_outbound_insert_ops" on storage.objects;
create policy "line_outbound_insert_ops" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'line-outbound' and public.is_ops());

-- 更新・削除も運営のみ（差し替え・掃除用）
drop policy if exists "line_outbound_modify_ops" on storage.objects;
create policy "line_outbound_modify_ops" on storage.objects
  for update to authenticated
  using (bucket_id = 'line-outbound' and public.is_ops())
  with check (bucket_id = 'line-outbound' and public.is_ops());

drop policy if exists "line_outbound_delete_ops" on storage.objects;
create policy "line_outbound_delete_ops" on storage.objects
  for delete to authenticated
  using (bucket_id = 'line-outbound' and public.is_ops());

-- 読み取りは公開バケットのため自動で誰でも可（/storage/v1/object/public/...）。
