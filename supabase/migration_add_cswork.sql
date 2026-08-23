-- ============================================================
-- CsWork：CS運用ドキュメントのポータル組込（REQ-028）
--
--   ・cswork_docs   … アップロード1件＝1行。is_current が現行版（旧版は履歴として残す）
--   ・cswork_audit  … upload / activate / reveal / download の操作ログ
--   ・Storage バケット cswork（非公開）… md / CSV の本文
--   ・role_permissions … 画面キー cswork（運営）と認証情報キー cswork_secret（管理者）
--
--   ⚠️ 本文は Storage に置き、DB は台帳だけを持つ（差分・サイズ対策）。
--   ⚠️ 参照はサーバー側（service_role）経由。クライアントへ署名URLを出さない。
--      そのため RLS は「運営ロールのみ select」を最小限で張り、書き込みは
--      サーバー経由に限定する。
--   ⚠️ このファイルは冪等（再実行しても壊れない）。
-- ============================================================

-- ── 1) 台帳 ──────────────────────────────────────────────
create table if not exists public.cswork_docs (
  id            uuid primary key,
  project       text not null default 'kawai-camp',
  kind          text not null check (kind in ('ops','design','watchlist')),
  title         text,
  version       text,
  filename      text,
  storage_path  text not null,
  bytes         integer,
  meta          jsonb not null default '{}'::jsonb,
  is_current    boolean not null default false,
  uploaded_by   int references public.members(id) on delete set null,
  uploaded_at   timestamptz not null default now()
);

create index if not exists idx_cswork_docs_current
  on public.cswork_docs (project, kind, is_current, uploaded_at desc);

-- 現行版は種別ごとに1件だけ
create unique index if not exists uq_cswork_docs_current
  on public.cswork_docs (project, kind) where is_current;

-- ── 2) 操作ログ ──────────────────────────────────────────
create table if not exists public.cswork_audit (
  id         bigserial primary key,
  doc_id     uuid references public.cswork_docs(id) on delete set null,
  action     text not null check (action in ('upload','activate','reveal','download')),
  actor      int references public.members(id) on delete set null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_cswork_audit_created on public.cswork_audit (created_at desc);

-- ── 3) RLS ───────────────────────────────────────────────
alter table public.cswork_docs  enable row level security;
alter table public.cswork_audit enable row level security;

-- 運営ロール（管理者・オペレーター・その派生）だけが読める。
--   ⚠️ 書き込みポリシーは作らない。挿入・更新は service_role（API）経由のみ。
drop policy if exists cswork_docs_select_ops on public.cswork_docs;
create policy cswork_docs_select_ops on public.cswork_docs
  for select using (
    exists (
      select 1
        from public.members m
        left join public.roles r on r.key = m.role
       where m.user_id = auth.uid()
         and m.is_deleted = false
         and (m.role in ('管理者','オペレーター') or r.base_role = 'オペレーター')
    )
  );

drop policy if exists cswork_audit_select_ops on public.cswork_audit;
create policy cswork_audit_select_ops on public.cswork_audit
  for select using (
    exists (
      select 1 from public.members m
       where m.user_id = auth.uid() and m.is_deleted = false and m.role = '管理者'
    )
  );

-- ── 4) Storage バケット（非公開）──────────────────────────
insert into storage.buckets (id, name, public)
values ('cswork', 'cswork', false)
on conflict (id) do nothing;

-- クライアントからの直接アクセスは許可しない（ポリシーを作らない）。
-- 参照・書き込みは service_role のみ。

-- ── 5) 権限キー ──────────────────────────────────────────
--   cswork        … 画面（運営：管理者・オペレーター ON）
--   cswork_secret … 設定値の認証情報を実値表示（管理者のみ ON）
insert into public.role_permissions (role, feature, enabled) values
('管理者','cswork',true),
('オペレーター','cswork',true),
('メンバー','cswork',false),
('外部','cswork',false),
('管理者','cswork_secret',true),
('オペレーター','cswork_secret',false),
('メンバー','cswork_secret',false),
('外部','cswork_secret',false)
on conflict (role, feature) do nothing;

-- 派生ロール（base_role = 'オペレーター'）にも行を持たせる（canFor の安全側フォールバック対策）
insert into public.role_permissions (role, feature, enabled)
select r.key, 'cswork', true
  from public.roles r
 where r.is_system = false
on conflict (role, feature) do nothing;

insert into public.role_permissions (role, feature, enabled)
select r.key, 'cswork_secret', false
  from public.roles r
 where r.is_system = false
on conflict (role, feature) do nothing;

-- ============================================================
-- 確認:
--   select kind, version, is_current, uploaded_at from public.cswork_docs order by uploaded_at desc;
--   select role, feature, enabled from public.role_permissions where feature like 'cswork%';
--   select id, public from storage.buckets where id = 'cswork';
--
-- ロールバック: supabase/migration_add_cswork_rollback.sql
-- ============================================================
