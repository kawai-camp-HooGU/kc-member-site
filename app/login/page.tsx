"use client";
import { useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";
import { errMessage } from "../../lib/errors";

type Mode = "login" | "signup";

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [mode,     setMode]     = useState<Mode>("login");

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = mode === "login"
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (result.error) throw result.error;
      if (mode === "signup") {
        setError("確認メールを送信しました。メールを確認してからログインしてください。");
        setMode("login");
      } else {
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(errMessage(err, "エラーが発生しました"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className="w-14 h-14">
            <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
            <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
            <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
          </svg>
          <h1 className="text-lg font-bold tracking-wide"><span className="text-gray-900">KAWAI</span><span className="text-red-600"> CAMP</span></h1>
          <p className="text-xs text-gray-400">
            {mode === "login" ? "アカウントにログイン" : "新規アカウント作成"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">メールアドレス</label>
            <input
              type="email" required
              value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 block mb-1.5">パスワード</label>
            <input
              type="password" required minLength={6}
              value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400"
              placeholder="6文字以上"
            />
          </div>

          {error && (
            <p className={`text-xs px-3 py-2 rounded-lg ${
              error.includes("メール") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {error}
            </p>
          )}

          <button
            type="submit" disabled={loading}
            className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {loading ? "処理中..." : mode === "login" ? "ログイン" : "アカウント作成"}
          </button>
        </form>

        <div className="text-center">
          <button
            onClick={() => { setMode((m) => (m === "login" ? "signup" : "login")); setError(""); }}
            className="text-xs text-red-600 hover:underline"
          >
            {mode === "login" ? "アカウントをお持ちでない方はこちら" : "ログインはこちら"}
          </button>
        </div>
      </div>
    </div>
  );
}
