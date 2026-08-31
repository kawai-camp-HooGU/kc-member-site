-- ============================================================
-- AIプロンプト：共通パーツ（2026-08-31 / REQ-034）
--   ・ai_prompt_parts          … 役割・方針から {{part:key}} で差し込むブロック
--   ・ai_prompt_part_revisions … 保存時の変更履歴（誤編集からの復元用）
--
--   ★ 既定の本文はコード側（lib/ai/prompts.ts の DEFAULT_PARTS）が持つ。
--     ここでは行を作らない。行が無ければ既定が使われる（ai_prompts と同じ関係）。
-- ============================================================

-- ── パーツ本体 ──
create table if not exists public.ai_prompt_parts (
  key         text primary key,                 -- msg_core / view_support / view_holder
  label       text not null default '',
  body        text not null default '',
  kind        text not null default 'common',   -- 'common'（常時）| 'view'（排他選択）
  enabled     boolean not null default true,
  sort_order  int not null default 100,
  updated_by  int references public.members(id) on delete set null,
  updated_at  timestamptz default now()
);

-- ── 変更履歴 ──
create table if not exists public.ai_prompt_part_revisions (
  id         bigserial primary key,
  key        text not null,
  body       text not null default '',
  edited_by  int references public.members(id) on delete set null,
  created_at timestamptz default now()
);
create index if not exists idx_ai_prompt_part_rev
  on public.ai_prompt_part_revisions(key, created_at desc);

-- ── RLS：管理者のみ（ai_prompts と同じ）──
alter table public.ai_prompt_parts          enable row level security;
alter table public.ai_prompt_part_revisions enable row level security;

drop policy if exists "ai_prompt_parts_admin" on public.ai_prompt_parts;
create policy "ai_prompt_parts_admin" on public.ai_prompt_parts for all to authenticated
  using (public.current_member_role() = '管理者')
  with check (public.current_member_role() = '管理者');

drop policy if exists "ai_prompt_part_rev_admin" on public.ai_prompt_part_revisions;
create policy "ai_prompt_part_rev_admin" on public.ai_prompt_part_revisions for select to authenticated
  using (public.current_member_role() = '管理者');


-- ============================================================
-- 移行：②返信提案・③添削の保存済み行を既定へ戻す
--
--   ⚠️ 手で実行する。上の DDL とは分けて流すこと。
--      保存済みの本文があると、コード側の既定（{{part:}} 入り）が反映されない。
--      削除しても ai_prompt_revisions に履歴が残るため、内容は後から復元できる。
--
--   1) まず保存済みの有無を確認する
--        select feature, length(body) as len, updated_at
--          from public.ai_prompts
--         where feature in ('reply_suggest','review');
--
--   2) 行があり、その内容を捨ててよいと確認できたら削除する
--        delete from public.ai_prompts
--         where feature in ('reply_suggest','review');
-- ============================================================


-- ============================================================
-- 移行：app_settings.ai_style_guide の一本化（REQ-034 確認事項1）
--
--   ⚠️ 手で実行する。
--      文体ガイドは msg_core パーツへ集約し、AI への注入を廃止した。
--      列自体は残す（他機能からの参照が無いことを確認してから落とす）。
--
--   1) 現行の本文を控える
--        select ai_style_guide from public.app_settings where id = 1;
--
--   2) その内容を「設定 ＞ AIプロンプト ＞ 共通：トーン・確度・禁止表現」へ
--      取り込んで保存する（画面から行う）
--
--   3) 取り込みが済んだら空にする
--        update public.app_settings set ai_style_guide = '' where id = 1;
-- ============================================================
