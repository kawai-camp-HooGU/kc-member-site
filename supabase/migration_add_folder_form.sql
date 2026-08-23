-- ============================================================
-- フォルダ管理：フォーム への展開（既存テキスト folder からの移行つき）
--   forms.folder_id を追加し、既存の forms.folder（テキスト分類）を
--   新しい folders テーブル（scope='form'）へ移行する。
--   ・既存の各 folder 文字列を1件の folders 行に変換（全運営に公開＝public）
--   ・forms.folder_id をその行に紐づける
--   旧 forms.folder 列は互換のため残す（UI では今後 folder_id を使う）。
-- ============================================================
alter table public.forms
  add column if not exists folder_id bigint references public.folders(id) on delete set null;
create index if not exists idx_forms_folder on public.forms(folder_id);
comment on column public.forms.folder_id is '所属フォルダ（null=未分類）。旧 folder(テキスト)から移行';

-- 既存テキスト folder → folders 行へ移行（未実行時のみ効果あり。二重実行しても既存 folder_id は上書きしない）
do $$
declare rec record; fid bigint;
begin
  for rec in
    select distinct folder
    from public.forms
    where folder is not null and btrim(folder) <> ''
  loop
    -- 同名（scope=form）の既存フォルダがあれば流用、なければ作成
    select id into fid from public.folders
      where scope = 'form' and name = rec.folder and is_deleted = false
      limit 1;
    if fid is null then
      insert into public.folders(scope, name, visibility, owner_role)
        values ('form', rec.folder, 'public', '管理者')
        returning id into fid;
    end if;
    update public.forms
      set folder_id = fid
      where folder = rec.folder and folder_id is null;
  end loop;
end $$;
