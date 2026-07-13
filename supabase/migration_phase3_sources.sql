-- ============================================================
-- Phase 3：流入経路マスタの独立
--
--   BEFORE
--     ・経路の定義が app_settings.welcome_routes（JSON列）に埋没
--     ・members.source は自由テキスト（FK なし・タイポ検知不可・孤児レコード）
--     ・form_submissions.source は「送信チャネル」なのに同名（用語衝突）
--     ・配信/シナリオのターゲティングが単一キー完全一致のみ
--
--   AFTER
--     ・sources テーブル（第一級のマスタ。カテゴリ・誘導先・UTM・色を持つ）
--     ・members.source_id / last_source_id / source_at（FK）
--     ・welcome_messages（経路ごとの文面。定義とメッセージを分離）
--     ・form_submissions.source → channel にリネーム ＋ source_id を追加
--     ・broadcasts / scenarios に target_source_ids[] ＋ target_source_cats[]
--
--   ⚠️ 旧カラム（members.source / broadcasts.target_source / scenarios.target_source /
--      app_settings.welcome_routes）は **残したまま** にする。ロールバック用。
--      本番で数週間安定してから migration_phase3_sources_drop_legacy.sql で落とすこと。
--
--   ⚠️ 実行前に必ずバックアップを取ること。
--   ⚠️ Phase 1（RLS・is_ops()）が適用済みであることが前提。
-- ============================================================

begin;

-- ────────────────────────────────────────────────────────────
-- 1. sources — 流入経路マスタ
-- ────────────────────────────────────────────────────────────
create table if not exists public.sources (
  id            serial primary key,
  key           text not null unique,            -- URL に付ける識別子（例: seminar_0712）
  label         text not null,                   -- 表示名（例: 7月セミナー）
  category      text not null default 'other',   -- ad|seminar|referral|sns|organic|offline|other
  landing_path  text,                            -- 誘導先（例: /f/entry）。未指定なら /login
  utm_source    text,                            -- 広告連携用（任意）
  utm_medium    text,
  utm_campaign  text,
  color         text not null default '#6b6b73', -- 一覧・グラフでの色
  memo          text,
  is_active     boolean not null default true,   -- 停止しても既存会員の紐付けは残る
  sort_order    int     not null default 0,
  is_deleted    boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists sources_key_idx    on public.sources (key)      where is_deleted = false;
create index if not exists sources_active_idx on public.sources (is_active, sort_order);

comment on table  public.sources is '流入経路マスタ（Phase 3）。会員がどこから来たかの第一級の定義。';
comment on column public.sources.key      is 'URL の ?src= に載せる識別子。配布済み QR/URL が死ぬため原則不変。';
comment on column public.sources.category is 'カテゴリ単位のターゲティング（例：広告経由の全員）を可能にするための分類。';

-- ────────────────────────────────────────────────────────────
-- 2. welcome_messages — 経路ごとの初回メッセージ文面
--    （app_settings.welcome_routes から「文面」だけを切り出す）
-- ────────────────────────────────────────────────────────────
create table if not exists public.welcome_messages (
  source_id  int primary key references public.sources(id) on delete cascade,
  message    text not null default '',
  updated_at timestamptz not null default now()
);

comment on table public.welcome_messages is
  '経路別の初回メッセージ文面。既定文面は app_settings.welcome_default のまま。';

-- ────────────────────────────────────────────────────────────
-- 3. members — 経路の正規化
-- ────────────────────────────────────────────────────────────
alter table public.members
  add column if not exists source_id      int references public.sources(id),  -- 初回流入（メイン）
  add column if not exists last_source_id int references public.sources(id),  -- 最新流入
  add column if not exists source_at      timestamptz;                        -- 初回流入日時

create index if not exists members_source_id_idx on public.members (source_id);

-- ────────────────────────────────────────────────────────────
-- 4. データ移行：welcome_routes(JSON) + members.source(text) → sources
-- ────────────────────────────────────────────────────────────

-- 4-1. welcome_routes に定義済みの経路をマスタへ
insert into public.sources (key, label, category, sort_order)
select
  r->>'key'                          as key,
  coalesce(nullif(r->>'label',''), r->>'key') as label,
  'other'                            as category,
  (row_number() over ())::int        as sort_order
  from public.app_settings s,
       lateral jsonb_array_elements(coalesce(s.welcome_routes, '[]'::jsonb)) r
 where s.id = 1
   and coalesce(r->>'key','') <> ''
on conflict (key) do nothing;

-- 4-2. マスタに無いが members.source に入っている経路も救済（タイポ含め取りこぼさない）
insert into public.sources (key, label, category, memo)
select distinct
  m.source,
  m.source,
  'other',
  'members.source から自動移行（要確認：マスタ未定義の経路だった）'
  from public.members m
 where coalesce(m.source, '') <> ''
on conflict (key) do nothing;

-- 4-3. 文面を welcome_messages へ
insert into public.welcome_messages (source_id, message)
select sc.id, coalesce(r->>'message', '')
  from public.app_settings s,
       lateral jsonb_array_elements(coalesce(s.welcome_routes, '[]'::jsonb)) r
  join public.sources sc on sc.key = r->>'key'
 where s.id = 1
   and coalesce(r->>'message','') <> ''
on conflict (source_id) do update set message = excluded.message;

-- 4-4. members.source(text) → source_id(FK)
update public.members m
   set source_id      = s.id,
       last_source_id = s.id,
       source_at      = coalesce(m.created_at, now())
  from public.sources s
 where s.key = m.source
   and m.source_id is null;

-- ────────────────────────────────────────────────────────────
-- 5. 用語衝突の解消：form_submissions.source は「送信チャネル」
--    （direct|chat|broadcast|scenario|qr）であって流入経路ではない
-- ────────────────────────────────────────────────────────────
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'form_submissions' and column_name = 'source'
  ) and not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'form_submissions' and column_name = 'channel'
  ) then
    alter table public.form_submissions rename column source to channel;
  end if;
end $$;

alter table public.form_submissions
  add column if not exists source_id int references public.sources(id);  -- 流入経路（?src= 由来）

comment on column public.form_submissions.channel   is '送信チャネル（direct|chat|broadcast|scenario|qr）。流入経路ではない。';
comment on column public.form_submissions.source_id is '流入経路（sources.id）。?src= から解決する。';

-- ────────────────────────────────────────────────────────────
-- 6. 配信・シナリオのターゲティング拡張（複数選択 ＋ カテゴリ一括）
-- ────────────────────────────────────────────────────────────
alter table public.broadcasts
  add column if not exists target_source_ids  int[]  not null default '{}',
  add column if not exists target_source_cats text[] not null default '{}';

alter table public.scenarios
  add column if not exists target_source_ids  int[]  not null default '{}',
  add column if not exists target_source_cats text[] not null default '{}';

-- 旧 target_source(text) → target_source_ids[]
update public.broadcasts b
   set target_source_ids = array[s.id]
  from public.sources s
 where s.key = b.target_source
   and coalesce(array_length(b.target_source_ids, 1), 0) = 0;

update public.scenarios sc
   set target_source_ids = array[s.id]
  from public.sources s
 where s.key = sc.target_source
   and coalesce(array_length(sc.target_source_ids, 1), 0) = 0;

-- ────────────────────────────────────────────────────────────
-- 7. RLS（Phase 1 の方針に合わせる）
--    sources / welcome_messages は運営専用。会員からは一切見えない。
--
--    ⚠️ 会員の画面では「自分の流入経路」を表示しない設計にしていること。
--       もし表示が必要になったら、id と label だけの公開ビューを別途用意する。
-- ────────────────────────────────────────────────────────────
alter table public.sources          enable row level security;
alter table public.welcome_messages enable row level security;

drop policy if exists "ops_only" on public.sources;
create policy "ops_only" on public.sources
  for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "ops_only" on public.welcome_messages;
create policy "ops_only" on public.welcome_messages
  for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

grant select, insert, update, delete on public.sources          to authenticated;
grant select, insert, update, delete on public.welcome_messages to authenticated;
grant usage, select on sequence public.sources_id_seq to authenticated;

-- ────────────────────────────────────────────────────────────
-- 8. members_visible ビューの再作成（source_id 等を追加）
--    フロントは members 本体ではなくこのビューを読む。
--
--    ⚠️ ベースは migration_hide_member_names.sql の定義（最新）。
--       Phase 1 の定義ではない。氏名マスク（他会員には '(非公開)'）を
--       絶対に外さないこと。ここを Phase 1 の定義で上書きすると、
--       他会員の実名が見えるようになる＝セキュリティ後退になる。
--
--    ⚠️ security_invoker は **付けない**（既定 = off）。
--       members の RLS は「本人の行のみ」なので、invoker にすると
--       担当者名・リーダー名の表示が壊れる。マスクは CASE 式で行う。
--
--    追加点：source_id / last_source_id / source_at（いずれも運営のみ）
-- ────────────────────────────────────────────────────────────
drop view if exists public.members_visible;
create view public.members_visible as
select
  m.id,
  -- 氏名：運営 or 本人のみ実名。他会員には '(非公開)'（migration_hide_member_names.sql 踏襲）
  case when public.is_ops() or m.user_id = auth.uid() then m.name else '(非公開)' end as name,
  m.role,
  m.is_deleted,
  m.created_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.email          end as email,
  case when public.is_ops() or m.user_id = auth.uid() then m.company        end as company,
  case when public.is_ops() or m.user_id = auth.uid() then m.chat_id        end as chat_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.user_id        end as user_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.kana           end as kana,
  case when public.is_ops() or m.user_id = auth.uid() then m.tel            end as tel,
  case when public.is_ops() or m.user_id = auth.uid() then m.prefecture     end as prefecture,
  -- 流入経路は運営の管理情報。本人にも返さない（会員画面では使わない）
  case when public.is_ops() then m.source         end as source,          -- 旧・互換用
  case when public.is_ops() then m.source_id      end as source_id,       -- Phase 3
  case when public.is_ops() then m.last_source_id end as last_source_id,  -- Phase 3
  case when public.is_ops() then m.source_at      end as source_at,       -- Phase 3
  case when public.is_ops() or m.user_id = auth.uid() then m.welcomed_at    end as welcomed_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.first_login_at end as first_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.last_login_at  end as last_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.login_count    end as login_count
  from public.members m;

grant select on public.members_visible to authenticated;

-- ────────────────────────────────────────────────────────────
-- 9. 経路別サマリー（マスタ画面の「会員数」列用）
--    重い集計はフロントで回さずビューで用意する。
-- ────────────────────────────────────────────────────────────
create or replace view public.v_source_member_counts
with (security_invoker = true)
as
select
  s.id   as source_id,
  s.key,
  s.label,
  s.category,
  count(m.id) filter (where m.is_deleted = false) as member_count
  from public.sources s
  left join public.members m on m.source_id = s.id
 where s.is_deleted = false
 group by s.id, s.key, s.label, s.category;

grant select on public.v_source_member_counts to authenticated;

commit;

-- ============================================================
-- 確認クエリ（実行後に流すと移行結果が見える）
-- ============================================================
-- select key, label, category, is_active from public.sources order by sort_order, id;
-- select s.label, count(*) from public.members m join public.sources s on s.id = m.source_id group by 1;
-- select count(*) as 未設定 from public.members where source_id is null and is_deleted = false;
