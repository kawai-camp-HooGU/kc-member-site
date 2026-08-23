import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

// サービスロールキーはサーバーサイド専用（NEXT_PUBLIC_ を付けない）
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY をサーバーの環境変数に設定してください"
  );
}

// ⚠️ Next.js（App Router）は fetch の GET をデータキャッシュに載せる。
//    supabase-js は内部で fetch を使うため、何もしないと
//    「一度空で返ってきた問い合わせが、その後ずっと空のまま」になる。
//    route.ts に export const dynamic = "force-dynamic" を書いても、
//    supabase-js が投げる fetch までは既定が伝わらない（2026-08-23 実測。
//    CsWork でアップロード後も現行版が null のまま返り続けた）。
//    サーバー側の読み取りは常に最新でなければならないので、ここで no-store を強制する。
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input as RequestInfo, { ...(init ?? {}), cache: "no-store" });

export const supabaseAdmin = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  global: { fetch: noStoreFetch },
});
