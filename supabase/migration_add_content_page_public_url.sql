-- ============================================================
-- コンテンツページ：公開URL（一意トークン）＋ 外部公開 ＋ 公開トグル
--
--   /p/{public_token} で「ページ全体（概要＋配下の閲覧可能なコンテンツ一覧）」を共有できるようにする。
--   方針は contents.public_token（migration_add_content_public_url.sql）と完全に同一：
--     ・public_token … 16桁hexの乱数。新規INSERT時にDB側で自動発行・以後変更不可（トリガで拒否）。
--     ・is_external  … 外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。
--     ・published    … 公開トグル。OFFなら is_external に関わらず /p/{token} は404。
--
--   ⚠️ 公開URLの参照はサーバー側（service role / lib/contentsServer.ts）で行う。
--      anon ロールに content_pages の SELECT 権限は与えない（＝RLSの穴を作らない）。
-- ============================================================

alter table public.content_pages
  add column if not exists public_token text,
  add column if not exists is_external  boolean not null default false,
  add column if not exists published    boolean not null default true;

-- 既存行へのバックフィル（トークン未発行の行に一括発行）
update public.content_pages
   set public_token = substr(md5(gen_random_uuid()::text), 1, 16)
 where public_token is null;

-- 以降の INSERT は DB 側で自動発行（アプリは public_token を送らない）
alter table public.content_pages
  alter column public_token set default substr(md5(gen_random_uuid()::text), 1, 16);
alter table public.content_pages
  alter column public_token set not null;

create unique index if not exists content_pages_public_token_uidx
  on public.content_pages(public_token);

create index if not exists content_pages_external_idx
  on public.content_pages(is_external) where is_external;

-- ── 発行後は変更不可 ───────────────────────────────────────────
--    外部に共有済みのリンクが切れるのを防ぐため、UPDATE での変更を明示的に拒否する。
create or replace function public.content_pages_public_token_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.public_token is distinct from old.public_token then
    raise exception '公開URL（public_token）は発行後に変更できません';
  end if;
  return new;
end;
$$;

drop trigger if exists content_pages_public_token_immutable on public.content_pages;
create trigger content_pages_public_token_immutable
  before update on public.content_pages
  for each row execute function public.content_pages_public_token_immutable();

comment on column public.content_pages.public_token is 'ページ固有の公開URLトークン。新規登録時に自動発行・以後変更不可。/p/{public_token}';
comment on column public.content_pages.is_external  is '外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。publishedがOFFなら無効。';
comment on column public.content_pages.published    is 'ページ公開トグル。OFFなら /p/{token} は404。';
