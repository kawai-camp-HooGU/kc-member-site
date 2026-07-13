-- ============================================================
-- フォーム機能（Lステップ「回答フォーム」相当）
--   forms            … フォーム本体（公開設定・期限・回答後アクション・デザイン）
--   form_sections    … セクション（＝ページ）
--   form_fields      … 設問ブロック（8種＋見出し／選択時アクション）
--   form_submissions … 回答（1送信＝1レコード。会員 or 外部匿名）
--   form_answers     … 回答明細（設問ごと）
-- 公開フォーム（未ログイン）からの送信は /api/form/submit（service role）経由。
-- そのため anon 向けのポリシーは作らない（RLSは authenticated のみ許可）。
-- ============================================================

create table if not exists public.forms (
  id               bigint generated always as identity primary key,
  name             text    not null default '',            -- 管理用名称
  folder           text,                                   -- フォルダ（分類）
  slug             text    not null unique,                -- 公開URL /f/{slug}
  title            text    not null default '',            -- 回答画面タイトル
  description      text    not null default '',            -- 説明文（〜2000字）
  status           text    not null default 'draft',       -- draft | published | closed
  visibility       text    not null default 'both',        -- member（会員のみ）| both（会員＋外部）
  deadline_at      timestamptz,                            -- 回答期限
  deadline_message text    not null default '',            -- 期限後に表示する文章
  answer_limit     int     not null default 1,             -- 1人あたり回答回数（0=無制限）
  confirm_dialog   boolean not null default true,          -- 送信確認ダイアログ
  confirm_text     text    not null default 'この内容で送信します。よろしいですか？',
  thanks_url       text    not null default '',            -- サンクスページURL
  thanks_text      text    not null default 'ご回答ありがとうございました。',
  design           jsonb   not null default '{}'::jsonb,   -- {color,bgColor,headerImage,submitLabel,progress,customCss}
  after_actions    jsonb   not null default '[]'::jsonb,   -- 回答後アクション（FormAction[]）
  autofill_member  boolean not null default true,          -- ログイン会員の氏名/メールを初期表示
  notify_enabled   boolean not null default false,         -- 回答時に担当者へ通知
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create table if not exists public.form_sections (
  id         bigint generated always as identity primary key,
  form_id    bigint not null references public.forms(id) on delete cascade,
  name       text   not null default '',
  condition  jsonb,                                        -- 表示条件（分岐）
  sort_order int    not null default 0
);
create index if not exists idx_form_sections_fid on public.form_sections(form_id);

create table if not exists public.form_fields (
  id            bigint generated always as identity primary key,
  section_id    bigint  not null references public.form_sections(id) on delete cascade,
  type          text    not null default 'text',
  -- text | textarea | radio | checkbox | select | date | file | pref | number | heading
  label         text    not null default '',
  description   text    not null default '',
  placeholder   text    not null default '',
  default_value text    not null default '',
  required      boolean not null default false,
  rule          text,                                      -- email | tel | zip | numeric | kana
  min_len       int,
  max_len       int,
  max_select    int,                                       -- チェックボックスの選択数上限
  save_to       text,                                      -- 回答の登録先（members のカラム）
  options       jsonb   not null default '[]'::jsonb,      -- [{label, actions:[FormAction]}]
  condition     jsonb,                                     -- 表示条件（分岐）
  sort_order    int     not null default 0
);
create index if not exists idx_form_fields_sid on public.form_fields(section_id);

create table if not exists public.form_submissions (
  id           bigint generated always as identity primary key,
  form_id      bigint not null references public.forms(id) on delete cascade,
  member_id    bigint references public.members(id) on delete set null,  -- NULL=外部・未紐付け
  guest_name   text   not null default '',
  guest_email  text   not null default '',
  status       text   not null default 'new',   -- new（未対応）| doing（対応中）| done（完了）
  assignee_id  bigint references public.members(id) on delete set null,
  source       text   not null default 'direct',-- direct | chat | broadcast | scenario | qr
  submitted_at timestamptz not null default now()
);
create index if not exists idx_form_submissions_fid on public.form_submissions(form_id);
create index if not exists idx_form_submissions_mid on public.form_submissions(member_id);

create table if not exists public.form_answers (
  id            bigint generated always as identity primary key,
  submission_id bigint not null references public.form_submissions(id) on delete cascade,
  field_id      bigint references public.form_fields(id) on delete set null,
  label         text   not null default '',    -- 送信時点の設問名（設問削除後も残す）
  value         text   not null default '',    -- 単一値
  value_list    jsonb,                         -- 複数選択
  file_path     text                           -- Storage のパス（ファイル添付）
);
create index if not exists idx_form_answers_sid on public.form_answers(submission_id);

-- ── Storage（ファイル添付）────────────────────────────────
-- 添付のアップロードは /api/form/submit（service role）が行う。
-- 管理画面からの閲覧（署名付きURL発行）のみ authenticated に許可する。
insert into storage.buckets (id, name, public)
values ('form-uploads', 'form-uploads', false)
on conflict (id) do nothing;

drop policy if exists "form_uploads_read_auth" on storage.objects;
create policy "form_uploads_read_auth" on storage.objects
  for select to authenticated using (bucket_id = 'form-uploads');

-- ── RLS ──────────────────────────────────────────────────
alter table public.forms            enable row level security;
alter table public.form_sections    enable row level security;
alter table public.form_fields      enable row level security;
alter table public.form_submissions enable row level security;
alter table public.form_answers     enable row level security;

drop policy if exists "forms_auth"            on public.forms;
drop policy if exists "form_sections_auth"    on public.form_sections;
drop policy if exists "form_fields_auth"      on public.form_fields;
drop policy if exists "form_submissions_auth" on public.form_submissions;
drop policy if exists "form_answers_auth"     on public.form_answers;
create policy "forms_auth"            on public.forms            for all to authenticated using (true) with check (true);
create policy "form_sections_auth"    on public.form_sections    for all to authenticated using (true) with check (true);
create policy "form_fields_auth"      on public.form_fields      for all to authenticated using (true) with check (true);
create policy "form_submissions_auth" on public.form_submissions for all to authenticated using (true) with check (true);
create policy "form_answers_auth"     on public.form_answers     for all to authenticated using (true) with check (true);
