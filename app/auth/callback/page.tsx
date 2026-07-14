"use client";
// ============================================================
// 認証コールバック（マジックリンクの着地点）
//
//   /auth/callback?next=/
//
//   【なぜ必要か】
//   マジックリンクを踏むと Supabase から
//     ・PKCE     … /auth/callback?code=xxxx
//     ・implicit … /auth/callback#access_token=xxxx
//   のどちらかの形で戻ってくる。どちらも「ブラウザ側で処理して初めて
//   セッション Cookie が書かれる」ため、いきなり `/`（会員ゾーン）に着地させると
//   middleware が「Cookie が無い＝未ログイン」と判断して /login へ 302 してしまい、
//   ログイン → メール → リンク → ログイン … の無限ループになる。
//
//   そこでこのページを認証不要ゾーン（lib/zone.ts の PUBLIC_EXACT）に置き、
//   ここでセッションを確立してから、ロールに応じた行き先へ送る。
//
//   ⚠️ このページは「認証情報を Cookie に変換するだけ」の中継地点。
//      画面としては何も見せない（スピナーのみ）。
// ============================================================
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { safeNext, homePathForRole, MEMBER_ROOT } from "../../../lib/zone";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let done = false;

    const land = async (next: string) => {
      if (done) return;
      done = true;
      // ロールに応じた着地先（運営 → /ops ／ 会員 → /）
      const { data: role } = await supabase.rpc("current_member_role");
      const to = next !== MEMBER_ROOT ? next : homePathForRole(role);
      router.replace(to);
      router.refresh();
    };

    (async () => {
      const url = new URL(window.location.href);
      const next = safeNext(url.searchParams.get("next"), MEMBER_ROOT);
      const code = url.searchParams.get("code");

      // ① PKCE：?code= を Cookie の code_verifier と突き合わせてセッションに交換
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) { setFailed(true); return; }
        await land(next);
        return;
      }

      // ② implicit：#access_token= は supabase-js（detectSessionInUrl）が
      //    自動で読み取ってセッションを張る。張れたら onAuthStateChange が発火する。
      const { data: { session } } = await supabase.auth.getSession();
      if (session) { await land(next); return; }

      const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => {
        if (s) land(next);
      });

      // 一定時間たっても張れない＝リンクの期限切れ・使用済み
      const timer = setTimeout(() => { if (!done) setFailed(true); }, 6000);
      return () => { subscription.unsubscribe(); clearTimeout(timer); };
    })();
  }, [router]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl px-8 py-10 w-full max-w-sm text-center space-y-3">
        <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className="w-12 h-12 mx-auto">
          <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
          <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
          <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
        </svg>

        {failed ? (
          <>
            <p className="text-sm font-bold text-gray-800">リンクの有効期限が切れています</p>
            <p className="text-[12.5px] text-gray-500 leading-relaxed">
              お手数ですが、もう一度ログイン用リンクをお送りください。
            </p>
            <a href="/login?magic=expired"
              className="inline-block mt-2 px-6 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">
              ログイン画面へ
            </a>
          </>
        ) : (
          <>
            <p className="text-sm text-gray-500">ログインしています…</p>
            <p className="text-xs text-gray-400">そのままお待ちください</p>
          </>
        )}
      </div>
    </div>
  );
}
