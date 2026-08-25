-- ============================================================
-- REQ-032　ブックマーク取り込みの改善（公開範囲・個人情報・承認）
--   設計書：preview/kawai-camp/design/2026-08-25_ブックマーク取り込みの改善_設計書.html
--   確定した方針（2026-08-25）：1a 2a 3a 4a / 5a 6a
--
--   ① chat_bookmarks へ列を追加（すべて default 付き。既存行は既定値で埋まる）
--   ② 運営専用のブックマーク検索 RPC（公開/会員判定を通さずに全件を引く）
--   ③ 参照実績カウンタの加算 RPC
--
--   ⚠️ 既存の knowledge_search_v2 / knowledge_public_search は一切変更しない。
--      公開ボット・メンバーAI相談は従来どおり visibility で絞られる（fail-closed）。
--      運営（②返信提案）だけが新しい RPC を通って ops_only も引ける。
-- ============================================================

-- ============================================================
-- ① chat_bookmarks の列追加
-- ============================================================

-- 公開範囲。ここが knowledge_documents.visibility を決める（取り込み時に写す）。
--   ops_only … 運営（②返信提案）のみ      → visibility='internal'
--   member   … ＋ メンバーAI相談           → visibility='member'（対象属性なし＝全会員）
--   public   … ＋ 公開ボット（未ログイン）  → visibility='public'
-- ⚠️ 既定は最も狭い ops_only。公開範囲は「広げる方向が不可逆」なので安全側に倒す。
alter table public.chat_bookmarks
  add column if not exists publish_scope text not null default 'ops_only';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bookmarks'::regclass
      and conname = 'chat_bookmarks_publish_scope_chk'
  ) then
    alter table public.chat_bookmarks
      add constraint chat_bookmarks_publish_scope_chk
      check (publish_scope in ('ops_only','member','public'));
  end if;
end $$;

-- 承認状態。approved だけが索引に入る。
-- ⚠️ 既定を 'approved' にするのは移行のため。
--    既存行がいっせいに draft になると索引から消え、AIが何も答えられなくなる。
--    新規登録のときだけアプリ側が明示的に 'draft' を入れる（API の action="create"）。
alter table public.chat_bookmarks
  add column if not exists review_status text not null default 'approved';
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_bookmarks'::regclass
      and conname = 'chat_bookmarks_review_status_chk'
  ) then
    alter table public.chat_bookmarks
      add constraint chat_bookmarks_review_status_chk
      check (review_status in ('draft','approved','archived'));
  end if;
end $$;

-- 差し込み変数。formatted_reply 中の {{name}} と対応する。
--   [{ "name":"お名前", "example":"井手", "kind":"person" }, ...]
alter table public.chat_bookmarks
  add column if not exists variables jsonb not null default '[]'::jsonb;

-- 有効期限（日付）。過ぎたら索引から外れ、日次バッチが archived にする。null=無期限。
alter table public.chat_bookmarks
  add column if not exists valid_until date;

-- 参照実績。検索でこのブックマークが採用されたときに加算する（bookmark_mark_used）。
alter table public.chat_bookmarks
  add column if not exists last_used_at timestamptz;
alter table public.chat_bookmarks
  add column if not exists used_count int not null default 0;

-- 重複を「置き換える」で登録したときの後継。履歴を切らずに辿れるようにする。
alter table public.chat_bookmarks
  add column if not exists replaced_by_id bigint references public.chat_bookmarks(id);

create index if not exists cbm_scope_idx  on public.chat_bookmarks(publish_scope);
create index if not exists cbm_review_idx on public.chat_bookmarks(review_status);
create index if not exists cbm_valid_idx  on public.chat_bookmarks(valid_until) where valid_until is not null;

comment on column public.chat_bookmarks.publish_scope is
  'ops_only=返信提案のみ / member=＋メンバーAI相談 / public=＋公開ボット。取り込み時に knowledge_documents.visibility へ写す。';
comment on column public.chat_bookmarks.review_status is
  'draft=未承認（索引に入らない） / approved=承認済み / archived=期限切れ・置き換え済み。';
comment on column public.chat_bookmarks.variables is
  'formatted_reply の {{変数}} 一覧。[{name, example, kind}]。個人情報を本文に固定しないための型。';

-- ============================================================
-- ② 運営専用のブックマーク検索
-- ============================================================
-- ⚠️ なぜ knowledge_search_v2 を拡張せずに別関数にするか
--    ・knowledge_search_v2 は「公開ボット・メンバーAI相談」が通る道であり、
--      visibility の判定がそのまま情報漏えいの境界になっている。
--      引数を1つ足して internal も返せるようにすると、
--      呼び出し側が1箇所でも既定値を間違えた瞬間に境界が壊れる（fail-open）。
--    ・別関数にすれば、既存の道は一切変わらない。運営だけが別の道を通る（fail-closed）。
--    ・pgroonga 索引の有無に依存しないベクトル検索のみにしてあるため、
--      AI_SEARCH_V2 の on/off にかかわらず同じように動く。
create or replace function public.bookmark_search_ops(
  p_persona_id uuid,
  p_emb        text,
  p_k          int default 8
)
returns table (
  chunk_id         bigint,
  document_id      bigint,
  chat_bookmark_id bigint,
  title            text,
  chunk_text       text,
  score            real,
  freshness        text
)
language sql stable as $$
  with qe as (select nullif(p_emb, '')::vector as v)
  select c.id, d.id, d.chat_bookmark_id, d.title, c.text,
         (1 - (c.embedding <=> (select v from qe)))::real as score,
         u.freshness_class
  from public.knowledge_chunks c
  join public.knowledge_units u     on u.id = c.unit_id
  join public.knowledge_documents d on d.id = u.document_id
  join public.knowledge_sources ks  on ks.id = d.source_id
  where ks.source_type = 'chat_bookmark'
    and c.is_retrievable
    and u.retrieval_mode in ('answer_and_style','answer_only')
    and d.publication_status = 'published'
    and d.is_active
    and d.persona_id = p_persona_id
    and (d.expires_at is null or d.expires_at > now())
    and c.embedding is not null
    and (select v from qe) is not null
  order by c.embedding <=> (select v from qe)
  limit greatest(1, p_k);
$$;

comment on function public.bookmark_search_ops(uuid, text, int) is
  '運営（②返信提案）専用。visibility を見ずにブックマーク断片を全件から引く。公開ボットからは呼ばない。';

revoke all on function public.bookmark_search_ops(uuid, text, int) from anon, authenticated;

-- ============================================================
-- ③ 参照実績の加算
-- ============================================================
-- ⚠️ ai_traces を後から集計する方式は取らない。
--    ai_traces は既定90日で物理削除されるうえ、②返信提案の経路では
--    retrieval_json にブックマークの採点が入っていない（記録していない）。
--    「引いた瞬間に足す」ほうが正確で、実装も1回の update で済む。
create or replace function public.bookmark_mark_used(p_ids bigint[])
returns void
language sql volatile as $$
  update public.chat_bookmarks
     set used_count   = used_count + 1,
         last_used_at = now()
   where id = any(p_ids);
$$;

comment on function public.bookmark_mark_used(bigint[]) is
  '検索で採用されたブックマークの参照実績を加算する。棚卸し（90日未参照）の材料。';

revoke all on function public.bookmark_mark_used(bigint[]) from anon, authenticated;

-- ============================================================
-- 適用後の確認
-- ============================================================
-- select publish_scope, review_status, count(*) from public.chat_bookmarks
--   where is_deleted = false group by 1,2 order by 1,2;
--   → 適用直後は全件 (ops_only, approved) になるはず
--
-- 索引に入る条件を満たす件数（取り込み対象）
-- select count(*) from public.chat_bookmarks
--  where is_deleted=false and ai_enabled and not ai_pending and review_status='approved'
--    and (valid_until is null or valid_until >= current_date);
--
-- ⚠️ この migration のあと、必ず一度 dry_run を流すこと。
--    visibility が動くため content_hash が全件変わり、全ブックマークが再取り込みになる。
--    POST /api/bot/knowledge/sync { "source":"chat_bookmark", "mode":"dry_run" }
