-- ============================================================
-- 他会員の氏名を非表示にする（QA第3弾 4-1 / 「運営 vs 個々のメンバー」方針）
--
--   members_visible ビューの name を、
--     ・運営（管理者/オペレーター）… 実名
--     ・本人（自分の行）           … 実名
--     ・それ以外（他会員をメンバー/外部が見る場合）… '(非公開)'
--   に変更する。氏名以外のマスク列は Phase1 の定義を踏襲。
--
--   【適用方法】
--     Supabase ダッシュボード → SQL Editor に貼り付けて実行。
--     ロールバックは末尾のコメント参照（Phase1 の定義に戻す）。
--
--   【フロント側の前提（別途対応済み）】
--     メンバー/外部のロードマップ（Gantt/カレンダー等）は「自分のみ」に
--     制限しているため、通常 '(非公開)' が表に出ることはほぼない。
--     （安全網としてビュー側でも氏名をマスクする多層防御）
-- ============================================================

begin;

drop view if exists public.members_visible;
create view public.members_visible as
select
  m.id,
  -- 氏名：運営 or 本人のみ実名。他会員には '(非公開)'
  case when public.is_ops() or m.user_id = auth.uid() then m.name else '(非公開)' end as name,
  m.role,
  m.is_deleted,
  m.created_at,
  -- ── 以下は「本人」または「運営」にしか見せない（Phase1 踏襲） ──
  case when public.is_ops() or m.user_id = auth.uid() then m.email          end as email,
  case when public.is_ops() or m.user_id = auth.uid() then m.company        end as company,
  case when public.is_ops() or m.user_id = auth.uid() then m.chat_id        end as chat_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.user_id        end as user_id,
  case when public.is_ops() or m.user_id = auth.uid() then m.kana           end as kana,
  case when public.is_ops() or m.user_id = auth.uid() then m.tel            end as tel,
  case when public.is_ops() or m.user_id = auth.uid() then m.prefecture     end as prefecture,
  case when public.is_ops() or m.user_id = auth.uid() then m.source         end as source,
  case when public.is_ops() or m.user_id = auth.uid() then m.welcomed_at    end as welcomed_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.first_login_at end as first_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.last_login_at  end as last_login_at,
  case when public.is_ops() or m.user_id = auth.uid() then m.login_count    end as login_count
from public.members m;

grant select on public.members_visible to authenticated;

commit;

-- ── ロールバック（氏名を全員公開に戻す）──
--   name の case 式を「m.name」に戻して同じ create view を実行すればよい。
--   （migration_phase1_rls.sql の members_visible 定義がその状態）
