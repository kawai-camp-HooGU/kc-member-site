-- ============================================================
-- 属性の自動更新（アクションルール）— 案B：各エンティティにアクションを持たせる
--
--   トリガー: 流入経路の付与 / 会員登録 / ログイン / URLクリック / フォーム回答
--   アクション: 属性付与・属性解除・シナリオ開始/停止・チャット送信（既存 FormAction と同型）
--
--   ⚠️ ルール表は作らない。設定画面（流入経路マスタ・配信編集・シナリオ・アプリ設定）が
--      そのまま保存先になる。新規テーブルは実行ログ（action_events）の1つだけ。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行（何度実行しても安全）
-- ============================================================

-- ── 1. 既存テーブルへアクション列を追加 ──────────────────────

-- 流入経路：この経路が会員に紐づいた時に実行するアクション（配列）
alter table public.sources
  add column if not exists actions jsonb not null default '[]'::jsonb;

-- 一斉配信：本文中のURLごとのアクション（URLをキーにしたマップ）
--   ⚠️ broadcast_links.id ではなく URL をキーにする。
--      リンク行は送信のたびに削除→再作成される（lib/broadcastSend.ts）ため、
--      下書き編集時点では行が存在せず、IDも安定しない。
--   例: { "https://example.com/price": [ {"type":"attr_add","attrId":3} ] }
alter table public.broadcasts
  add column if not exists link_actions jsonb not null default '{}'::jsonb;

-- シナリオ：ステップ本文中のURLごとのアクション（同上）
alter table public.scenario_steps
  add column if not exists link_actions jsonb not null default '{}'::jsonb;

-- ログイン：アプリ全体で1組。{ "first": [...], "every": [...] }
alter table public.app_settings
  add column if not exists login_actions jsonb not null default '{"first":[],"every":[]}'::jsonb;

comment on column public.sources.actions        is 'この流入経路が会員に紐づいた時に実行するアクション（FormAction[]と同型）';
comment on column public.broadcasts.link_actions is '本文URLごとのクリック時アクション。キーはURL文字列（link_idは送信毎に変わるため使えない）';
comment on column public.scenario_steps.link_actions is 'ステップ本文URLごとのクリック時アクション。キーはURL文字列';
comment on column public.app_settings.login_actions  is 'ログイン時アクション。{first:[初回のみ], every:[毎回]}';

-- ── 2. 実行ログ（唯一の新規テーブル）────────────────────────
--   ログと冪等キーを兼ねる。「なぜこの人にこのタグが付いたか」に答えられる。
create table if not exists public.action_events (
  id           bigint generated always as identity primary key,
  member_id    int    not null references public.members(id) on delete cascade,
  -- source_assigned | member_signup | login_first | login_every | link_click | form_submit
  trigger_type text   not null,
  -- 冪等キー。例: 'source:12' / 'link:b:34' / 'login:first' / 'form:7'
  ref_key      text   not null default '',
  once         boolean not null default true,   -- 1人1回だけ発火するか
  applied      jsonb  not null default '[]'::jsonb,  -- 実際に適用したアクション
  ok           boolean not null default false,  -- claim時はfalse、完了時にtrue
  error        text,
  created_at   timestamptz default now()
);

-- 「1人1回」の担保。claim（行を先に立てる）時点で重複を弾くため ok は条件に含めない。
--   ⚠️ ok=true だけを一意にすると、実行中（ok=false）の行が重複を防げず二重実行になる。
create unique index if not exists action_events_once_uidx
  on public.action_events(member_id, ref_key) where once;

create index if not exists action_events_member_idx
  on public.action_events(member_id, created_at desc);
create index if not exists action_events_trigger_idx
  on public.action_events(trigger_type, created_at desc);

-- RLS：運営のみ閲覧。書き込みは service_role（API Route）経由のみ。
alter table public.action_events enable row level security;
drop policy if exists "action_events_ops" on public.action_events;
create policy "action_events_ops" on public.action_events for select to authenticated
  using (public.is_ops());

comment on table public.action_events is '属性自動更新の実行ログ。冪等キー（member_id, ref_key）を兼ねる。';
