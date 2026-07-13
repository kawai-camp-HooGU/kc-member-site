-- ============================================================
-- 公開対象属性を DB 側（RLS）でも判定する
--
--   これまで「属性 × 公開条件」による出し分けはクライアントの canView() だけで行われていた。
--   RLS は「公開中なら authenticated 全員が SELECT 可」だったため、
--   ログインした人が PostgREST を直接叩けば、対象外のコンテンツ本文まで取得できた。
--
--   外部ロール（メルマガ登録者など）をポータルに入れる前に、必ずこれを塞ぐこと。
--   クライアントの canView() はそのまま残す（多層防御）。
--
--   【適用方法】Supabase ダッシュボード → SQL Editor に貼り付けて実行。
--   【ロールバック】末尾のコメント参照。
-- ============================================================

begin;

-- ── ① メンバーがタグ（属性ノード）t を「含む」か ──────────────
--   canView の memberCovers と同じ意味：
--     メンバーの持つ属性のいずれかが t 自身、または t の配下（子孫）であれば true。
--   ＝ メンバーの属性から親をたどった集合（自身を含む）に t が現れるか。
create or replace function public.member_covers_tag(p_member bigint, p_tag bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive up as (
    select a.id, a.parent_id
      from public.attributes a
     where a.id in (
       select ma.attribute_id from public.member_attributes ma where ma.member_id = p_member
     )
    union all
    select a.id, a.parent_id
      from public.attributes a
      join up on a.id = up.parent_id
  )
  select exists (select 1 from up where up.id = p_tag);
$$;

-- ── ② 公開条件（any/all/exany/exall）の判定 ───────────────────
--   対象タグが空 → 全員可（＝ canView と同じ）
--   ログイン中のメンバーが解決できない → 不可（安全側）
create or replace function public.can_view_attrs(p_tags bigint[], p_mode text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mid      bigint := public.current_member_id();
  some_ok  boolean := false;
  every_ok boolean := true;
  t        bigint;
begin
  if p_tags is null or array_length(p_tags, 1) is null then
    return true;                       -- 対象未指定＝全員
  end if;
  if mid is null then
    return false;                      -- メンバー行が無い認証ユーザーには見せない
  end if;

  foreach t in array p_tags loop
    if public.member_covers_tag(mid, t) then
      some_ok := true;
    else
      every_ok := false;
    end if;
  end loop;

  case coalesce(p_mode, 'any')
    when 'any'   then return some_ok;
    when 'all'   then return every_ok;
    when 'exany' then return not some_ok;
    when 'exall' then return not every_ok;
    else return true;
  end case;
end;
$$;

grant execute on function public.member_covers_tag(bigint, bigint) to authenticated;
grant execute on function public.can_view_attrs(bigint[], text)   to authenticated;

-- 判定を軽くするためのインデックス
create index if not exists member_attributes_member_idx on public.member_attributes(member_id);
create index if not exists attributes_parent_idx        on public.attributes(parent_id);

-- ── ③ content_pages ──────────────────────────────────────────
drop policy if exists "content_pages_select" on public.content_pages;
create policy "content_pages_select" on public.content_pages for select to authenticated
  using (
    public.is_ops()
    or (
      is_deleted = false
      and public.can_view_attrs(
        array(select cpa.attribute_id from public.content_page_attributes cpa where cpa.page_id = content_pages.id),
        attr_mode
      )
    )
  );

-- ── ④ contents ───────────────────────────────────────────────
--   ページ側の公開対象も満たすこと（掲載画面と同じ AND 条件）。
--   ※ 外部公開URL（/c/{token}）はサーバー側の service role で読むため、このポリシーの影響を受けない。
drop policy if exists "contents_select" on public.contents;
create policy "contents_select" on public.contents for select to authenticated
  using (
    public.is_ops()
    or (
      published = true
      and is_deleted = false
      and public.can_view_attrs(
        array(select ca.attribute_id from public.content_attributes ca where ca.content_id = contents.id),
        attr_mode
      )
      and exists (
        select 1 from public.content_pages p
         where p.id = contents.page_id
           and p.is_deleted = false
           and public.can_view_attrs(
             array(select cpa.attribute_id from public.content_page_attributes cpa where cpa.page_id = p.id),
             p.attr_mode
           )
      )
    )
  );

-- ── ⑤ news ───────────────────────────────────────────────────
drop policy if exists "news_select" on public.news;
create policy "news_select" on public.news for select to authenticated
  using (
    public.is_ops()
    or (
      published = true
      and is_deleted = false
      and (published_at is null or published_at <= now())   -- 予約公開は時間が来るまで見せない
      and public.can_view_attrs(
        array(select na.attribute_id from public.news_attributes na where na.news_id = news.id),
        attr_mode
      )
    )
  );

-- ── ⑥ events ─────────────────────────────────────────────────
drop policy if exists "events_select" on public.events;
create policy "events_select" on public.events for select to authenticated
  using (
    public.is_ops()
    or (
      published = true
      and is_deleted = false
      and public.can_view_attrs(
        array(select ea.attribute_id from public.event_attributes ea where ea.event_id = events.id),
        attr_mode
      )
    )
  );

commit;

-- ============================================================
-- ロールバック（Phase1 の「公開中なら全員可」に戻す）
-- ------------------------------------------------------------
-- drop policy if exists "content_pages_select" on public.content_pages;
-- create policy "content_pages_select" on public.content_pages for select to authenticated
--   using (public.is_ops() or is_deleted = false);
-- drop policy if exists "contents_select" on public.contents;
-- create policy "contents_select" on public.contents for select to authenticated
--   using (public.is_ops() or (published = true and is_deleted = false));
-- drop policy if exists "news_select" on public.news;
-- create policy "news_select" on public.news for select to authenticated
--   using (public.is_ops() or (published = true and is_deleted = false));
-- drop policy if exists "events_select" on public.events;
-- create policy "events_select" on public.events for select to authenticated
--   using (public.is_ops() or (published = true and is_deleted = false));
-- ============================================================
