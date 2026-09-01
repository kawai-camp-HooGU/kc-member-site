-- ============================================================
-- 体験シナリオ基盤（REQ-067 / 段階1）
--
--   ★ 何をするものか
--     体験版URL（/try/[token]）のチャットを「質問に答えるボット」から
--     「決まった手順で成果物を作って渡す体験」へ拡張する。
--     体験の中身はコードではなくデータ（体験シナリオ）として持ち、
--     企画が変わってもシナリオを1行足すだけで立つようにする。
--
--   ⚠️ 追加のみ。既存テーブルを壊す変更はしない。
--      既存の体験版URL（scenario_id が null）は挙動が一切変わらない。
--
--   ⚠️ subject_key の設計に注意（bot_trial_usage のコメントを読むこと）
--      現行の botServer.subjectKeyFor() は体験版のとき t:{token}、つまり
--      「体験版トークンそのもの」を返す。誰が使っても同じカウンタを減らすため、
--      1本のURLを複数人に配ると先着で枠が尽きる。この表で人ごとに数える。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ※ 何度実行しても安全（if not exists / drop policy if exists / on conflict do nothing）
--   ⚠️ 本番適用はオーナー承認後に行う。切り戻しは migration_add_trial_scenarios_rollback.sql
-- ============================================================

-- ── ① 体験シナリオ（マスタ）────────────────────────────────
--   ここだけが論理削除の対象（develop.md §2-2「マスタは論理削除する」）。
--   以降の runs / artifacts / reviews / usage は履歴・カウンタなので
--   is_deleted を持たず、保持期間で物理削除する（bot_usage / bot_messages と同じ）。
create table if not exists public.bot_trial_scenarios (
  id           bigint generated always as identity primary key,
  slug         text not null unique,             -- 'webinar-lp' など。管理用の識別子
  title        text not null default '',         -- 画面に出す体験名
  intro        text not null default '',         -- ①体験の説明（プレーンテキスト。HTMLを入れない）
  cta_label    text not null default 'はじめる',

  -- ★検索・集計の対象になるものは列に出す（develop.md §4）
  output_kind  text not null default 'html'
               check (output_kind in ('text','html','image','pdf')),
  step_limit   int  not null default 1,          -- ステップ数の上限
  revise_limit int  not null default 3,          -- 調整の既定回数

  -- ★フォーム連携（段階3で使う。段階1では form_timing='none' 相当で動く）
  form_timing  text not null default 'exit'
               check (form_timing in ('none','entry','exit')),
  form_id      bigint references public.forms(id) on delete set null,

  -- ★スキーマが企画ごとに変わるものは jsonb（フォーム定義と同じ扱い・develop.md §4）
  steps        jsonb not null default '[]'::jsonb,
  review       jsonb not null default '{}'::jsonb,   -- 運営が講評を書くときの観点テンプレート

  model        text,                             -- 任意：モデル上書き
  max_tokens   int  not null default 1500,

  is_deleted   boolean not null default false,
  created_by   bigint references public.members(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bot_trial_scenarios_live_idx
  on public.bot_trial_scenarios(is_deleted, id);
comment on table public.bot_trial_scenarios is
  '体験シナリオ。体験版チャットの手順・テンプレプロンプト・成果物の種類を持つマスタ。';
comment on column public.bot_trial_scenarios.steps is
  'ステップ配列。[{key,label,prompt,inputs:[{key,label,type,options,maxLength}]}]。promptは公開APIへ出さない。';

-- ── ② 体験版URLへの列追加（既存テーブル・追加のみ）──────────
alter table public.bot_share_links
  -- どの体験シナリオを使うか。null なら従来どおりのQ&Aボット（後方互換）
  add column if not exists scenario_id bigint
    references public.bot_trial_scenarios(id) on delete set null,
  -- 発行時の独自設定。1人あたりの上限もここに持つ
  add column if not exists settings jsonb not null default '{}'::jsonb,
  -- ③ URL全体の生成上限（費用の絶対上限）。会話は既存の total_limit / used_count
  add column if not exists gen_limit      int not null default 300,
  add column if not exists gen_used_count int not null default 0,
  -- 発行時に運営が入れた想定人数。上限を自動計算した根拠を残す（見える化）
  add column if not exists assumed_users  int not null default 30;

comment on column public.bot_share_links.scenario_id is
  '体験シナリオ。null なら従来どおりのQ&Aボット（後方互換）。';
comment on column public.bot_share_links.settings is
  '発行時の独自設定。per_user_chat_limit / per_user_gen_limit / ip_multiplier / intro / quality / cta_url など。空 {} なら既定のまま。';
comment on column public.bot_share_links.gen_limit is
  'このURL全体で作成できる回数の上限。1人あたり×想定人数から自動計算する。費用の絶対上限。';

-- ── ③ 体験1回（進行）────────────────────────────────────────
create table if not exists public.bot_trial_runs (
  id           bigint generated always as identity primary key,
  share_token  text   not null references public.bot_share_links(token) on delete cascade,
  scenario_id  bigint not null references public.bot_trial_scenarios(id) on delete cascade,
  session_id   bigint references public.bot_sessions(id) on delete set null,
  subject_key  text   not null default '',       -- 端末キー。氏名等は保存しない

  -- ★段階3（フォーム連携）で埋まる。ここで初めて人と結びつく
  member_id     bigint references public.members(id) on delete set null,
  submission_id bigint references public.form_submissions(id) on delete set null,
  -- ★どの版を提出したか。運営が見るものと利用者が出したものを必ず一致させる
  --   （FK は bot_trial_artifacts の作成後に付ける。下の do $$ ブロック参照）
  submitted_artifact_id bigint,
  submitted_at  timestamptz,

  step_key     text not null default '',
  status       text not null default 'intro'
               check (status in ('intro','input','running','ready','submitted','reviewed','failed')),
  gen_count    int  not null default 0,
  revise_count int  not null default 0,
  inputs       jsonb not null default '{}'::jsonb,   -- 利用者が入れた差し込み変数
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists bot_trial_runs_token_idx  on public.bot_trial_runs(share_token, created_at desc);
create index if not exists bot_trial_runs_status_idx on public.bot_trial_runs(status, created_at desc);
create index if not exists bot_trial_runs_subject_idx on public.bot_trial_runs(share_token, subject_key, created_at desc);

-- ⚠️⚠️ 既存テーブルへの「追い付き」。ここを飛ばすと再実行で必ず壊れる。
--
--   create table if not exists は、テーブルが既にあると
--   **中身（列）を一切更新せずに丸ごとスキップする**。
--   そのため、いちど適用したあとに上の定義へ列を足しても、
--   再実行では列が増えず、後段の FK 追加が
--     ERROR 42703: column "..." referenced in foreign key constraint does not exist
--   で落ちる（2026-09-01 実際に発生）。
--
--   → このマイグレーションに列を足すときは、必ずここにも1行足すこと。
alter table public.bot_trial_runs
  add column if not exists member_id             bigint,
  add column if not exists submission_id         bigint,
  add column if not exists submitted_artifact_id bigint,
  add column if not exists submitted_at          timestamptz;

-- 追い付きで足した列に FK を補う。
--   ⚠️ 「制約名が重複したら無視」では足りない。create table 側で作られた FK は
--      bot_trial_runs_member_id_fkey のような自動命名なので名前が衝突せず、
--      同じ列に同じ FK が二重に付いてしまう。
--      そこで「その列に FK が1つも無いとき」だけ足す。
--   ⚠️ declare 付きの do ブロックは Supabase の SQL Editor で
--      "relation \"has_fk\" does not exist" になる（2026-09-01 実測）。
--      変数を使わず if not exists (...) で書くこと。
do $$ begin
  if not exists (
    select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.conrelid = 'public.bot_trial_runs'::regclass
       and c.contype  = 'f'
       and a.attname  = 'member_id'
  ) then
    alter table public.bot_trial_runs
      add constraint bot_trial_runs_member_fk
      foreign key (member_id) references public.members(id) on delete set null;
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.conrelid = 'public.bot_trial_runs'::regclass
       and c.contype  = 'f'
       and a.attname  = 'submission_id'
  ) then
    alter table public.bot_trial_runs
      add constraint bot_trial_runs_submission_fk
      foreign key (submission_id) references public.form_submissions(id) on delete set null;
  end if;
end $$;

-- ── ④ 成果物（調整のたびに revision を積む）─────────────────
create table if not exists public.bot_trial_artifacts (
  id           bigint generated always as identity primary key,
  run_id       bigint not null references public.bot_trial_runs(id) on delete cascade,
  revision     int  not null default 1,          -- 調整のたびに +1。過去版は消さない
  kind         text not null default 'html',
  -- html/text は本文をそのまま持つ。image/pdf は Storage のパスを持つ（段階2）
  body         text not null default '',
  storage_path text,
  mime         text not null default '',
  bytes        int  not null default 0,
  instruction  text not null default '',         -- そのrevを生んだ調整指示（見える化）
  trace_id     bigint,                           -- ai_traces.id（FKは後段で任意に付ける）
  cost_jpy     numeric not null default 0,
  created_at   timestamptz not null default now(),
  unique (run_id, revision)
);
create index if not exists bot_trial_artifacts_run_idx on public.bot_trial_artifacts(run_id, revision desc);

-- ── ⑤ 提出と講評（段階4で使う）──────────────────────────────
--   ⚠️ 講評は運営が人で書く（決定6b）。AIの自動採点は行わないため trace_id を持たない。
create table if not exists public.bot_trial_reviews (
  id          bigint generated always as identity primary key,
  run_id      bigint not null references public.bot_trial_runs(id) on delete cascade,
  artifact_id bigint not null references public.bot_trial_artifacts(id) on delete cascade,
  reviewer_id bigint references public.members(id) on delete set null,
  scores      jsonb  not null default '{}'::jsonb,
  comment     text   not null default '',
  sent_at     timestamptz,                       -- 送るまでは下書き
  created_at  timestamptz not null default now()
);
create index if not exists bot_trial_reviews_run_idx on public.bot_trial_reviews(run_id, created_at desc);

-- ── ⑥ 1人あたりの回数（3層のうち ①端末キー と ②IP+UA）──────
--
--   ★ なぜ bot_usage を使わないか
--     bot_usage は (entry, subject_key, day) の「日次」カウンタで、
--     体験版に必要な「このURLでの累計」を表せない。
--     列の意味が違うものを同じ表に押し込むと、どちらの上限も読めなくなる。
--
--   ★ subject_key の形
--     'd:{visitorId}' … 端末キー（httpOnly Cookie）。1人あたりの上限に使う
--     'i:{sha256}'    … IP+UA のハッシュ。端末キーのリセット逃れを止める歯止め
--     判定は「①②とURL全体のうち、いちばん厳しいもの」で行う。
--
--   ⚠️ 端末キーはシークレットウィンドウ等でリセットできる。
--      だから ②IP と bot_share_links.gen_limit（③）を必ず併走させる。
create table if not exists public.bot_trial_usage (
  id          bigint generated always as identity primary key,
  share_token text not null references public.bot_share_links(token) on delete cascade,
  subject_key text not null,
  -- ★1往復と1生成はコストが2桁違う。同じ数で数えない
  kind        text not null check (kind in ('chat','gen')),
  count       int  not null default 0,           -- 累計（日次ではない。体験は日をまたぐ）
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),
  unique (share_token, subject_key, kind)
);
create index if not exists bot_trial_usage_lookup_idx
  on public.bot_trial_usage(share_token, subject_key, kind);
comment on table public.bot_trial_usage is
  '体験版の1人あたり回数。subject_keyは d:{端末キー} / i:{IP+UAハッシュ}。累計であって日次ではない。';

-- ── ⑦ 画像単価（段階2で使う。列だけ先に用意する）─────────────
--   既存 ai_model_prices は「1kトークンあたり」しか持たないため、
--   画像の「1枚あたり」を入れられない。列を1本足して同じ表に載せる。
alter table public.ai_model_prices
  add column if not exists image_jpy_per_unit numeric not null default 0;
comment on column public.ai_model_prices.image_jpy_per_unit is
  '画像1枚あたりの単価（円）。トークン課金でないモデルはこちらを使う。品質別に行を分ける。';

insert into public.ai_model_prices (model, input_jpy_per_1k, output_jpy_per_1k, image_jpy_per_unit, note) values
  ('gpt-image-1:low',    0, 0, 0, '要設定：OpenAI価格表と為替から算出する'),
  ('gpt-image-1:medium', 0, 0, 0, '要設定'),
  ('gpt-image-1:high',   0, 0, 0, '要設定')
on conflict (model) do nothing;

-- ── ⑧ ai_traces が適用済みなら FK を張る（順序に依存させない）──
-- 提出した版への FK（bot_trial_artifacts の作成後に張る）
--   この列は追い付きブロックで足しているので、ここでは FK の有無だけ見る。
do $$ begin
  if not exists (
    select 1 from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
     where c.conrelid = 'public.bot_trial_runs'::regclass
       and c.contype  = 'f'
       and a.attname  = 'submitted_artifact_id'
  ) then
    alter table public.bot_trial_runs
      add constraint bot_trial_runs_submitted_artifact_fk
      foreign key (submitted_artifact_id)
      references public.bot_trial_artifacts(id) on delete set null;
  end if;
end $$;

do $$ begin
  if to_regclass('public.ai_traces') is not null then
    begin
      alter table public.bot_trial_artifacts
        add constraint bot_trial_artifacts_trace_fk
        foreign key (trace_id) references public.ai_traces(id) on delete set null;
    exception when duplicate_object then null;
    end;
  end if;
end $$;

-- ============================================================
-- RLS
--   ・bot_trial_scenarios（マスタ）… 運営が画面から直接編集する。
--     既存 bot_policies / bot_share_links とまったく同じ作法。
--   ・runs / artifacts / reviews / usage（履歴・カウンタ）… 書き込みは
--     service_role（/api/trial/*）が行う。運営には select のみ許す。
--     既存 bot_sessions / bot_messages と同じ作法。
-- ============================================================
alter table public.bot_trial_scenarios enable row level security;
alter table public.bot_trial_runs      enable row level security;
alter table public.bot_trial_artifacts enable row level security;
alter table public.bot_trial_reviews   enable row level security;
alter table public.bot_trial_usage     enable row level security;

drop policy if exists "bot_trial_scenarios_ops" on public.bot_trial_scenarios;
create policy "bot_trial_scenarios_ops" on public.bot_trial_scenarios for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "bot_trial_runs_ops" on public.bot_trial_runs;
create policy "bot_trial_runs_ops" on public.bot_trial_runs for select to authenticated
  using (public.is_ops());

drop policy if exists "bot_trial_artifacts_ops" on public.bot_trial_artifacts;
create policy "bot_trial_artifacts_ops" on public.bot_trial_artifacts for select to authenticated
  using (public.is_ops());

drop policy if exists "bot_trial_reviews_ops" on public.bot_trial_reviews;
create policy "bot_trial_reviews_ops" on public.bot_trial_reviews for all to authenticated
  using (public.is_ops()) with check (public.is_ops());

drop policy if exists "bot_trial_usage_ops" on public.bot_trial_usage;
create policy "bot_trial_usage_ops" on public.bot_trial_usage for select to authenticated
  using (public.is_ops());

-- ============================================================
-- 権限
--   ★新しい権限キーは作らない（決定10a）。
--     体験シナリオの管理は既存 bot_manage の範囲に含める。
--     bot_manage は migration_add_bot.sql で登録済みなので、ここでは何もしない。
-- ============================================================

-- ── 初期シード：最初のシナリオ（決定8：LP構成案）────────────
--   ⚠️ 顧客名・実データを入れない（preview/ に載る設計書と同じ規律）。
insert into public.bot_trial_scenarios
  (slug, title, intro, cta_label, output_kind, step_limit, revise_limit, form_timing, steps, review, max_tokens)
values (
  'lp-outline',
  '30秒でわかる、あなたのLP構成案',
  E'いくつかの質問に答えるだけで、あなたの商売に合わせた「一枚もののLP構成案」をその場で作ります。\n作ったあとは「ここを直して」と話しかけるだけで直せます。',
  'はじめる',
  'html', 1, 3, 'exit',
  $json$[
    {
      "key": "draft",
      "label": "たたき台をつくる",
      "prompt": "あなたは集客の導線設計に詳しい編集者です。次の条件で、一枚もののLP構成案を作ってください。\n\n業種：{{industry}}\nいちばんの目的：{{goal}}\n\n見出し／お悩み／選ばれる理由／お客様の声／申込ボタン の順に、実際に使える文章で書いてください。抽象的な指示ではなく、そのまま載せられる本文にしてください。",
      "inputs": [
        { "key": "industry", "label": "業種", "type": "select",
          "options": ["士業", "治療院", "教室・スクール", "EC", "その他"] },
        { "key": "goal", "label": "いちばんの目的", "type": "text", "maxLength": 40,
          "placeholder": "例：無料相談の申込を増やしたい" }
      ]
    }
  ]$json$::jsonb,
  $json$ {
    "criteria": [
      { "key": "clarity",  "label": "言いたいことが1つに絞れているか" },
      { "key": "audience", "label": "読み手が自分ごとにできるか" },
      { "key": "action",   "label": "次の一手が明示されているか" }
    ],
    "tone": "褒めてから、直すと良くなる点を2つだけ挙げる。専門用語を使わない。"
  } $json$::jsonb,
  1800
)
on conflict (slug) do nothing;
