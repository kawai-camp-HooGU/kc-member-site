// ============================================================
// サーバー用 Supabase クライアント（Phase 1）
//
//   Cookie セッション化（@supabase/ssr）により、
//   サーバー側（Server Component / Route Handler / middleware）からも
//   ログイン中のユーザーを判定できるようになった。
//
//   ⚠️ supabaseAdmin（service_role）との違い
//      ・supabaseServer … ログイン中のユーザーとして動く。RLS が効く。
//      ・supabaseAdmin  … 全権限。RLS を無視する。呼び出し元の検証が必須。
//      迷ったら supabaseServer を使うこと。
// ============================================================
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import type { Database } from "./database.types";

const url  = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Server Component / Route Handler 用。
 * ログイン中のユーザーとして動くため、RLS がそのまま効く。
 */
export function createSupabaseServer() {
  const cookieStore = cookies();

  return createServerClient<Database>(url, anon, {
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value, ...options });
        } catch {
          // Server Component からは Cookie を書けない（middleware が更新するので無視してよい）
        }
      },
      remove(name: string, options: CookieOptions) {
        try {
          cookieStore.set({ name, value: "", ...options });
        } catch {
          // 同上
        }
      },
    },
  });
}

/**
 * middleware 用（Phase 2 のゾーン分離で使用）。
 * リクエストの Cookie を読み、更新されたトークンをレスポンスに書き戻す。
 */
export function createSupabaseMiddleware(req: NextRequest, res: NextResponse) {
  return createServerClient<Database>(url, anon, {
    cookies: {
      get(name: string) {
        return req.cookies.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        req.cookies.set({ name, value, ...options });
        res.cookies.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        req.cookies.set({ name, value: "", ...options });
        res.cookies.set({ name, value: "", ...options });
      },
    },
  });
}
