-- ============================================================
-- スタッフ別 対応ログ抽出（Staff Activity Log）
--   4つのデータソースを「スタッフ×日時」で横断抽出するための基盤。
--     1) LINE 送信履歴   … line_messages (direction='out', sent_by)      ※既存列で対応
--     2) メール 送信履歴 … mail_send_log (新規。/api/mail/send 時に記録)  ※送信元アカウントも保持
--     3) トーク 送信履歴 … chat_messages (sender_side='staff')            ※既存列で対応
--     4) 決済 登録/更新   … payment_audit (新規。payments のトリガーで自動記録)
--
--   ⚠️ メールの direction='out' 行は IMAP の Sent フォルダ同期で作られ、
--      「どのスタッフが送ったか」を持たない。そこでアプリ内送信(/api/mail/send)の
--      時点で mail_send_log に1行残す方式にする（sent_by を確実に記録できる）。
--   ⚠️ 参照は運営(is_ops)のみ。他スタッフの本文・会員個人情報を横断表示するため。
--   冪等（再実行可）を意識し、if not exists / create or replace を用いる。
-- ============================================================

-- ── 0) LINE 送信元スタッフ列（設計互換のため保持。既存にあれば無視）──────
alter table public.line_messages
  add column if not exists sent_by int references public.members(id) on delete set null;

-- ── 1) メール送信ログ ────────────────────────────────────────
create table if not exists public.mail_send_log (
  id          bigint generated always as identity primary key,
  account_id  bigint  references public.mail_accounts(id) on delete set null,  -- 送信元アカウント
  sent_by     int     references public.members(id)       on delete set null,  -- 送信スタッフ
  to_addr     text    not null default '',
  subject     text    not null default '',
  message_id  text    not null default '',   -- 突合用（将来 mail_messages と結合可）
  member_id   int     references public.members(id) on delete set null,  -- 宛先の会員（照合できれば）
  created_at  timestamptz not null default now()
);
create index if not exists idx_mail_send_log_sent_by
  on public.mail_send_log (sent_by, created_at desc);
create index if not exists idx_mail_send_log_account
  on public.mail_send_log (account_id, created_at desc);

alter table public.mail_send_log enable row level security;
drop policy if exists "mail_send_log_read_ops" on public.mail_send_log;
create policy "mail_send_log_read_ops" on public.mail_send_log
  for select to authenticated using (public.is_ops());
-- 書き込みはサーバー(service_role)からのみ想定。RLSの INSERT ポリシーは付けない。

-- ── 2) 決済 監査ログ ─────────────────────────────────────────
create table if not exists public.payment_audit (
  id              bigint generated always as identity primary key,
  payment_id      bigint  references public.payments(id) on delete set null,
  actor_member_id int     references public.members(id)  on delete set null,  -- 操作スタッフ
  action          text    not null,   -- create | update | match | delete | restore
  changes         jsonb   not null default '{}'::jsonb,   -- {field:{from,to}} の差分
  customer_snip   text    not null default '',            -- 表示用（氏名/金額の抜粋）
  created_at      timestamptz not null default now()
);
create index if not exists idx_payment_audit_actor
  on public.payment_audit (actor_member_id, created_at desc);
create index if not exists idx_payment_audit_payment
  on public.payment_audit (payment_id, created_at desc);

alter table public.payment_audit enable row level security;
drop policy if exists "payment_audit_read_ops" on public.payment_audit;
create policy "payment_audit_read_ops" on public.payment_audit
  for select to authenticated using (public.is_ops());

-- ── 2b) payments のトリガーで監査を自動記録 ──────────────────
--   既存の savePayment / deletePayment（クライアントからの update/insert）を
--   一切変更せず、DB側で「誰が・いつ・何を」を残す。actor は current_member_id()。
create or replace function public.trg_payment_audit() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_actor  int := public.current_member_id();
  v_action text;
  v_changes jsonb := '{}'::jsonb;
  v_snip   text;
begin
  if (tg_op = 'INSERT') then
    v_action := case when new.status = 'matched' then 'create+match' else 'create' end;
    v_snip   := coalesce(nullif(new.customer_name, ''), new.customer_email);
    insert into public.payment_audit(payment_id, actor_member_id, action, changes, customer_snip)
    values (new.id, v_actor, v_action, jsonb_build_object(
      'amount', new.amount, 'status', new.status, 'member_id', new.member_id), v_snip);
    return new;
  end if;

  if (tg_op = 'UPDATE') then
    -- 論理削除 / 復元 を最優先で判定
    if (coalesce(old.is_deleted,false) = false and coalesce(new.is_deleted,false) = true) then
      v_action := 'delete';
    elsif (coalesce(old.is_deleted,false) = true and coalesce(new.is_deleted,false) = false) then
      v_action := 'restore';
    elsif (coalesce(old.status,'') <> 'matched' and new.status = 'matched') then
      v_action := 'match';
    else
      v_action := 'update';
    end if;

    -- 主要フィールドの差分を記録（変わった項目だけ）
    if (coalesce(old.amount,0) <> coalesce(new.amount,0)) then
      v_changes := v_changes || jsonb_build_object('amount', jsonb_build_object('from', old.amount, 'to', new.amount));
    end if;
    if (coalesce(old.status,'') <> coalesce(new.status,'')) then
      v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if (old.member_id is distinct from new.member_id) then
      v_changes := v_changes || jsonb_build_object('member_id', jsonb_build_object('from', old.member_id, 'to', new.member_id));
    end if;
    if (coalesce(old.note,'') <> coalesce(new.note,'')) then
      v_changes := v_changes || jsonb_build_object('note', jsonb_build_object('from', old.note, 'to', new.note));
    end if;

    v_snip := coalesce(nullif(new.customer_name, ''), new.customer_email);
    insert into public.payment_audit(payment_id, actor_member_id, action, changes, customer_snip)
    values (new.id, v_actor, v_action, v_changes, v_snip);
    return new;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payment_audit_ins on public.payments;
drop trigger if exists trg_payment_audit_upd on public.payments;
create trigger trg_payment_audit_ins after insert on public.payments
  for each row execute function public.trg_payment_audit();
create trigger trg_payment_audit_upd after update on public.payments
  for each row execute function public.trg_payment_audit();

-- ── 3) 横断抽出 RPC（明細）────────────────────────────────────
--   4ソースを共通スキーマに正規化して UNION し、フィルタ・並び・ページングを適用。
--   security definer + is_ops() ガードで、運営のみ・全件横断を許可する。
create or replace function public.get_staff_activity(
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_staff_ids   int[]       default null,
  p_kinds       text[]      default null,   -- 'line','mail','talk','pay'
  p_account_ids bigint[]    default null,   -- LINE/メールの送信元アカウント
  p_include_auto boolean    default false,  -- 自動送信/システム操作(スタッフ未特定=staff_id is null)を含めるか。既定=手動のみ
  p_keyword     text        default null,
  p_limit       int         default 200,
  p_offset      int         default 0
) returns table (
  at            timestamptz,
  kind          text,
  staff_id      int,
  staff_name    text,
  account_id    bigint,
  account_label text,
  counterpart   text,
  action        text,
  summary       text
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ops() then
    raise exception 'forbidden';
  end if;

  return query
  with base as (
    -- LINE 送信
    select m.created_at as at, 'line'::text as kind, m.sent_by as staff_id,
           m.account_id::bigint as account_id,
           coalesce(nullif(la.basic_id,''), la.name) as account_label,
           coalesce(f.display_name, f.line_user_id) as counterpart,
           coalesce(m.send_kind,'send') as action, m.body as summary
    from public.line_messages m
    join public.line_friends  f  on f.id = m.friend_id
    left join public.line_accounts la on la.id = m.account_id
    where m.direction = 'out'

    union all
    -- メール 送信（送信ログ）
    select s.created_at, 'mail', s.sent_by,
           s.account_id::bigint, coalesce(nullif(ma.display_name,''), ma.address),
           s.to_addr, 'send', s.subject
    from public.mail_send_log s
    left join public.mail_accounts ma on ma.id = s.account_id

    union all
    -- ポータルトーク 送信（アカウント概念なし）
    select c.created_at, 'talk', c.sender_member_id,
           null::bigint, null::text,
           coalesce(mem.name, '会員#'||cc.member_id::text) as counterpart,
           'send', c.body
    from public.chat_messages c
    join public.chat_conversations cc on cc.id = c.conversation_id
    left join public.members mem on mem.id = cc.member_id
    where c.sender_side = 'staff'

    union all
    -- 決済 登録/更新（アカウントは決済サイト名を表示に流用）
    select pa.created_at, 'pay', pa.actor_member_id,
           null::bigint, coalesce(nullif(ps.name,''), nullif(p.site,'')),
           pa.customer_snip, pa.action, pa.changes::text
    from public.payment_audit pa
    left join public.payments      p  on p.id = pa.payment_id
    left join public.payment_sites ps on ps.id = p.site_id
  )
  select b.at, b.kind, b.staff_id, mm.name as staff_name,
         b.account_id, b.account_label, b.counterpart, b.action, b.summary
  from base b
  left join public.members mm on mm.id = b.staff_id
  where (p_from is null or b.at >= p_from)
    and (p_to   is null or b.at <  p_to)
    -- 手動対応のみ（スタッフ未特定＝自動送信/システム操作は既定で除外）
    and (p_include_auto or b.staff_id is not null)
    and (p_staff_ids   is null or b.staff_id   = any(p_staff_ids))
    and (p_kinds       is null or b.kind       = any(p_kinds))
    and (p_account_ids is null or b.account_id = any(p_account_ids))
    and (p_keyword is null or p_keyword = '' or
         b.summary ilike '%'||p_keyword||'%' or b.counterpart ilike '%'||p_keyword||'%')
  order by b.at desc
  limit greatest(p_limit, 1) offset greatest(p_offset, 0);
end;
$$;

-- ── 4) 横断集計 RPC（サマリー：スタッフ×種別の件数）──────────
create or replace function public.get_staff_activity_summary(
  p_from        timestamptz default null,
  p_to          timestamptz default null,
  p_staff_ids   int[]       default null,
  p_kinds       text[]      default null,
  p_account_ids bigint[]    default null,
  p_include_auto boolean    default false,
  p_keyword     text        default null
) returns table (
  staff_id   int,
  staff_name text,
  kind       text,
  cnt        bigint
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_ops() then
    raise exception 'forbidden';
  end if;

  return query
  select t.staff_id, coalesce(mm.name,'(自動/不明)') as staff_name, t.kind, count(*)::bigint as cnt
  from public.get_staff_activity(
         p_from, p_to, p_staff_ids, p_kinds, p_account_ids, p_include_auto, p_keyword,
         1000000, 0) t
  left join public.members mm on mm.id = t.staff_id
  group by t.staff_id, mm.name, t.kind;
end;
$$;

grant execute on function public.get_staff_activity(timestamptz,timestamptz,int[],text[],bigint[],boolean,text,int,int) to authenticated;
grant execute on function public.get_staff_activity_summary(timestamptz,timestamptz,int[],text[],bigint[],boolean,text) to authenticated;
