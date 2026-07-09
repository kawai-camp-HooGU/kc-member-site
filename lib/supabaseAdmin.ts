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

export const supabaseAdmin = createClient<Database>(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
