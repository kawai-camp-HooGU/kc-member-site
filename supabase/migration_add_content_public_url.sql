-- ============================================================
-- コンテンツ：公開URL（一意トークン）＋ 外部公開
--
--   ① public_token … コンテンツごとに一意のランダムトークン。
--        ・新規 INSERT 時に DB 側で自動発行（アプリからは渡さない）
--        ・発行後は変更不可（トリガで UPDATE を拒否）
--        ・連番だと総当たりで非公開分まで探索できてしまうため、推測困難な乱数にする
--        ・16桁hex（≒64bit）。gen_random_uuid() は CSPRNG 由来なので md5 で畳んでも十分
--
--   ② is_external … 外部公開フラグ。
--        ・ON  … 公開URL /c/{token} を知っていれば誰でも（未ログインでも）閲覧可。
--                このとき公開対象属性・公開条件は「無視」される。
--        ・OFF … 従来どおり会員限定。属性＋公開条件で出し分ける。
--        ・published（公開トグル）が OFF の場合は is_external に関わらず 404。
--
--   ⚠️ 公開URLの参照はサーバー側（service role / lib/contentsServer.ts）で行う。
--      anon ロールに contents の SELECT 権限は与えない（＝RLSの穴を作らない）。
-- ============================================================

alter table public.contents
  add column if not exists public_token text,
  add column if not exists is_external  boolean not null default false;

-- 既存行へのバックフィル（トークン未発行の行に一括で発行）
update public.contents
   set public_token = substr(md5(gen_random_uuid()::text), 1, 16)
 where public_token is null;

-- 以降の INSERT は DB 側で自動発行（アプリは public_token を送らない）
alter table public.contents
  alter column public_token set default substr(md5(gen_random_uuid()::text), 1, 16);
alter table public.contents
  alter column public_token set not null;

create unique index if not exists contents_public_token_uidx
  on public.contents(public_token);

create index if not exists contents_external_idx
  on public.contents(is_external) where is_external;

-- ── 発行後は変更不可 ───────────────────────────────────────────
--    外部に共有済みのリンクが切れるのを防ぐため、UPDATE での変更を明示的に拒否する。
--    （アプリ側も public_token を UPDATE 文に含めないが、DBを最後の砦にしておく）
create or replace function public.contents_public_token_immutable()
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

drop trigger if exists contents_public_token_immutable on public.contents;
create trigger contents_public_token_immutable
  before update on public.contents
  for each row execute function public.contents_public_token_immutable();

comment on column public.contents.public_token is 'コンテンツ固有の公開URLトークン。新規登録時に自動発行・以後変更不可。/c/{public_token}';
comment on column public.contents.is_external  is '外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。publishedがOFFなら無効。';
