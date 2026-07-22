// ============================================================
// 会員未登録のメールアドレス一覧（運営のみ）
//   GET /api/ops/unregistered-emails → { items: UnregisteredEmail[] }
//
//   「未登録」の判定は **メールアドレスが会員マスタに無いこと**。
//   回答の member_id が空かどうかでは見ない。紐付け漏れ（会員なのに
//   ゲスト扱いのまま）を未登録として拾ってしまい、二重登録の元になるため。
//
//   拾う先は2つ：
//     ・フォーム回答（form_submissions.guest_email）
//     ・決済情報（payments.customer_email）
//   決済側を含めるのは、「入金は取れているが会員化されていない」人を
//   フォロー漏れさせないため（フォームを経由しない銀行振込などがある）。
//
//   ⚠️ 個人情報を返すため service_role を使う。requireOps は必須。
// ============================================================
import { NextResponse } from "next/server";
import { requireOps, errorResponse } from "../../../../lib/authz";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import type { UnregisteredEmail, UnregisteredEvent } from "../../../../lib/models";

interface Acc {
  email: string; name: string; nameAt: string;
  origins: Set<string>;
  formCount: number; paymentCount: number; amount: number;
  firstAt: string; lastAt: string;
  events: UnregisteredEvent[];
}

export async function GET(request: Request) {
  try {
    await requireOps(request);

    const [membersRes, subsRes, formsRes, paysRes, notesRes] = await Promise.all([
      supabaseAdmin.from("members").select("email").eq("is_deleted", false),
      supabaseAdmin.from("form_submissions")
        .select("form_id, guest_name, guest_email, submitted_at")
        .neq("guest_email", ""),
      supabaseAdmin.from("forms").select("id, name, title"),
      supabaseAdmin.from("payments")
        .select("customer_name, customer_email, amount, site, paid_at, created_at")
        .eq("is_deleted", false).neq("customer_email", ""),
      supabaseAdmin.from("unregistered_notes").select("email, note, updated_by, updated_at"),
    ]);

    // 会員のメール（小文字・空は除く）。ここに在るものは「登録済み」
    const known = new Set(
      (membersRes.data ?? [])
        .map((m) => (m.email ?? "").trim().toLowerCase())
        .filter((e) => e !== ""),
    );
    const formName = new Map(
      (formsRes.data ?? []).map((f) => [f.id, f.name || f.title || `フォーム#${f.id}`]),
    );
    const notes = new Map(
      (notesRes.data ?? []).map((n) => [
        (n.email ?? "").trim().toLowerCase(),
        { note: n.note ?? "", by: n.updated_by ?? "", at: n.updated_at ?? "" },
      ]),
    );

    const acc = new Map<string, Acc>();
    /** 1件の記録を積む。会員に居るメールはここで弾く */
    const touch = (rawEmail: string, name: string, ev: UnregisteredEvent) => {
      const email = rawEmail.trim().toLowerCase();
      if (!email || !email.includes("@") || known.has(email)) return null;
      let cur = acc.get(email);
      if (!cur) {
        cur = {
          email, name: "", nameAt: "", origins: new Set(),
          formCount: 0, paymentCount: 0, amount: 0,
          firstAt: ev.at, lastAt: ev.at, events: [],
        };
        acc.set(email, cur);
      }
      cur.origins.add(ev.kind === "payment" ? "決済" : ev.label);
      cur.events.push(ev);
      // 氏名は「いちばん新しい記録のもの」を採用する（改名・表記ゆれは新しい方が正しい）
      if (name.trim() && (!cur.name || (ev.at && ev.at >= cur.nameAt))) {
        cur.name = name.trim(); cur.nameAt = ev.at;
      }
      if (ev.at && (!cur.firstAt || ev.at < cur.firstAt)) cur.firstAt = ev.at;
      if (ev.at && (!cur.lastAt || ev.at > cur.lastAt)) cur.lastAt = ev.at;
      return cur;
    };

    for (const s of subsRes.data ?? []) {
      const a = touch(s.guest_email ?? "", s.guest_name ?? "", {
        at: s.submitted_at ?? "", kind: "form",
        label: formName.get(s.form_id) ?? "フォーム", amount: 0,
      });
      if (a) a.formCount += 1;
    }
    for (const p of paysRes.data ?? []) {
      const a = touch(p.customer_email ?? "", p.customer_name ?? "", {
        at: p.paid_at ?? p.created_at ?? "", kind: "payment",
        label: p.site || "決済", amount: p.amount ?? 0,
      });
      if (a) { a.paymentCount += 1; a.amount += p.amount ?? 0; }
    }

    const items: UnregisteredEmail[] = [...acc.values()]
      .map((a) => {
        const n = notes.get(a.email);
        return {
          email: a.email,
          name: a.name,
          origins: [...a.origins],
          formCount: a.formCount,
          paymentCount: a.paymentCount,
          amount: a.amount,
          firstAt: a.firstAt,
          lastAt: a.lastAt,
          note: n?.note ?? "",
          noteBy: n?.by ?? "",
          noteAt: n?.at ?? "",
          events: a.events.sort((x, y) => (y.at || "").localeCompare(x.at || "")),
        };
      })
      // 新しい動きがあった順。フォロー対象として上から潰せるようにする
      .sort((x, y) => (y.lastAt || "").localeCompare(x.lastAt || ""));

    return NextResponse.json({ items });
  } catch (err) {
    return errorResponse(err);
  }
}
