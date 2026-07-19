"use client";
import { useState, useEffect } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { supabase } from "../../lib/supabase";
import { OPS_ROOT, MEMBER_ROOT } from "../../lib/zone";
import { fetchIsOps } from "../../lib/roles";
import { useRouter } from "next/navigation";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [error,     setError]     = useState("");
  const [message,   setMessage]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [sessionOk, setSessionOk] = useState(false);

  // Supabase が URL ハッシュの招待トークンを自動処理するのを待つ
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setSessionOk(true);
    });
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionOk(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("パスワードは6文字以上で設定してください");
      return;
    }
    if (password !== confirm) {
      setError("パスワードが一致しません");
      return;
    }
    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    // ── 着地先はロールで分ける（運営 → /ops ／ 会員 → /）──
    //    運営を会員ポータルに落とすと「運営コンソールに入れない」ように見えるため。
    //    current_member_role() は SECURITY DEFINER の RPC（ops/login と同じ判定）。
    //    ⚠️ 派生ロールも運営として扱うため is_ops() で判定する。
    const { data: role } = await supabase.rpc("current_member_role");
    const to = (await fetchIsOps(role)) ? OPS_ROOT : MEMBER_ROOT;
    setMessage(`パスワードを設定しました。${to === "/ops" ? "運営コンソール" : "ダッシュボード"}へ移動します...`);
    setTimeout(() => { router.push(to); router.refresh(); }, 1500);
  };

  if (!sessionOk) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-4 text-center">
          <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className="w-12 h-12 mx-auto">
            <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
            <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
            <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
          </svg>
          <p className="text-sm text-gray-500">招待リンクを確認中...</p>
          <p className="text-xs text-gray-400">しばらく経っても変わらない場合は、招待メールのリンクを再度クリックしてください。</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className="w-12 h-12">
            <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
            <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
            <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
          </svg>
          <h1 className="text-lg font-bold text-gray-800">パスワードを設定</h1>
          <p className="text-xs text-gray-400 text-center">
            初回ログイン用のパスワードを設定してください。<br />次回以降はこのパスワードでログインできます。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">新しいパスワード</label>
            <input
              type="password" required minLength={6}
              value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400"
              placeholder="6文字以上"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">パスワード（確認）</label>
            <input
              type="password" required minLength={6}
              value={confirm} onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400"
              placeholder="もう一度入力"
            />
          </div>

          {error && (
            <p className="text-xs px-3 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200">{error}</p>
          )}
          {message && (
            <p className="text-xs px-3 py-2 rounded-lg bg-green-50 text-green-700 border border-green-200">✓ {message}</p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "設定中..." : "パスワードを設定してログイン"}
          </button>
        </form>
      </div>
    </div>
  );
}
