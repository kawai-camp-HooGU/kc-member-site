-- ============================================================
-- フォームの公開URL（slug）をランダムトークンの自動発行にする
--
--   これまで slug はフォーム名から生成する編集可能な文字列だった。
--   日本語のフォーム名だと slug も日本語になり、
--     ・URLが %E3%83%9D… と長大になる（メール・QRで事故る）
--     ・パーセントエンコードの扱いを間違えると 404 になる
--   ため、コンテンツの公開URL（contents.public_token）と同じ方式に統一する。
--
--     ・新規 INSERT 時に DB 側で自動発行（アプリからは渡さない）
--     ・発行後は変更不可（トリガで UPDATE を拒否）
--     ・16桁hex（≒64bit）。連番だと総当たりで下書きフォームまで探せてしまうため乱数にする
--
--   【適用方法】Supabase ダッシュボード → SQL Editor に貼り付けて実行。
-- ============================================================

begin;

-- 既存の「英数字・ハイフン・アンダースコア以外を含む slug」をトークンに置き換える
--   （日本語 slug のフォームが対象。配布済みのURLがある場合は事前に周知すること）
update public.forms
   set slug = substr(md5(gen_random_uuid()::text), 1, 16)
 where slug !~ '^[A-Za-z0-9_-]+$';

-- 以降の INSERT は DB 側で自動発行（アプリは slug を送らない）
alter table public.forms
  alter column slug set default substr(md5(gen_random_uuid()::text), 1, 16);

-- 念のため一意制約を確認（元々 unique 制約付きで作成済み）
create unique index if not exists forms_slug_uidx on public.forms(slug);

-- ── 発行後は変更不可 ───────────────────────────────────────────
--    配布済みのURLが切れるのを防ぐため、UPDATE での変更を拒否する。
create or replace function public.forms_slug_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception '公開URL（slug）は発行後に変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists forms_slug_immutable on public.forms;
create trigger forms_slug_immutable
  before update on public.forms
  for each row execute function public.forms_slug_immutable();

comment on column public.forms.slug is 'フォーム固有の公開URLトークン。新規登録時に自動発行・以後変更不可。/f/{slug}';

commit;
