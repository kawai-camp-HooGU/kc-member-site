-- ============================================================
-- リスト管理：レコードに「ラベル」「LINEアカウント名」「LINE ID」を追加
--   REQ-049 / 設計書 2026-08-28_リスト管理_一覧改善とLINE項目・ラベル追加_設計書.html
--
--   label             … マスタ無しの任意入力（最大20文字）。空文字＝未設定。絞り込みに使う
--   line_display_name … LINEアカウント名（表示名）。line_friends とは同期しない
--   line_user_id      … LINEのuserId（U＋32文字）。line_friends.line_user_id との突合用
--
--   ⚠️ すべて default 付き／nullable。既存行は「未設定」になる（後方互換）
--   ⚠️ line_user_id に UNIQUE は張らない。重複判定はメール／電話のまま
--      （設計書 判断3-A。dupKey を変えると過去の取込結果と判定基準がずれる）
--   ⚠️ 何度実行しても安全（if not exists / create or replace）
--   ⚠️ 適用順序は「このSQL → アプリ配備」。逆にするとINSERT/UPDATEが
--      PGRST204 で全滅する（列が無いため）
-- ============================================================

alter table public.contact_list_entries
  add column if not exists label             text not null default '',
  add column if not exists line_display_name text not null default '',
  add column if not exists line_user_id      text;

-- ラベル絞り込み・選択肢の列挙用（空文字＝未設定も絞り込み対象なので部分索引にしない）
create index if not exists idx_contact_entries_label
  on public.contact_list_entries(list_id, label);

-- line_friends との突合用
create index if not exists idx_contact_entries_line_uid
  on public.contact_list_entries(line_user_id) where line_user_id is not null;

comment on column public.contact_list_entries.label is
  'ラベル（マスタ無しの任意入力・最大20文字）。空文字＝未設定。絞り込みに使う';
comment on column public.contact_list_entries.line_display_name is
  'LINEアカウント名（表示名）。取込・手入力の値。line_friends とは同期しない';
comment on column public.contact_list_entries.line_user_id is
  'LINEのuserId（U＋32文字）。line_friends.line_user_id と突合する。重複判定には使わない';

-- ── ラベルの選択肢（プルダウン用）────────────────────────────
--   ⚠️ 全件をクライアントへ運ばないための集計RPC
--   ⚠️ 空文字（未設定）の行も返す。画面側で「（未設定）」として出す
--   ⚠️ 出力列名はテーブル列名と衝突させない
--      （SQL関数では列側が優先され、group by が壊れる）
--   ⚠️ security invoker。既存のRLS（contact_list_entries_ops = is_ops()）が
--      そのまま効く。運営以外からは0件が返る
create or replace function public.contact_list_entry_labels(p_list_id bigint)
returns table(label_value text, entry_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select e.label, count(*)
  from public.contact_list_entries e
  where e.list_id = p_list_id
  group by e.label
  order by (e.label = '') asc, e.label asc;   -- 未設定は末尾へ
$$;

grant execute on function public.contact_list_entry_labels(bigint) to authenticated;

comment on function public.contact_list_entry_labels(bigint) is
  'リスト内のラベルと件数（空文字＝未設定を含む）。絞り込みプルダウンの選択肢に使う';
