"use client";
// ============================================================
// ログイン画面
//
//   ⚠️ Phase 0 の変更点：
//   セルフサインアップ（アカウント作成）を廃止し、招待制のみにした。
//   以前は URL を知る第三者が誰でも signUp() でき、
//   「認証済みユーザー」になれてしまっていた（RLS が全開放のため影響大）。
//   代わりにパスワード再設定（メール送付）の導線を用意する。
//
//   ※ アプリ側だけでなく Supabase ダッシュボードでも
//     Authentication → Sign In / Providers →「Allow new users to sign up」を
//     OFF にすること（そちらが本丸。詳細は docs/Phase0_セキュリティ緊急対応.md）。
// ============================================================
import { useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";
import { errMessage } from "../../lib/errors";

type Mode = "login" | "reset";
type Msg = { ok: boolean; text: string } | null;

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [msg,      setMsg]      = useState<Msg>(null);
  const [loading,  setLoading]  = useState(false);
  const [mode,     setMode]     = useState<Mode>("login");

  const switchMode = (m: Mode) => { setMode(m); setMsg(null); };

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      router.push("/");
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errMessage(err, "ログインに失敗しました") });
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);

    const origin = typeof window !== "undefined" ? window.location.origin : "";
    // 成否にかかわらず同じ文言を返す（アカウントの存在有無を漏らさない＝メール列挙攻撃の防止）
    const sameAnswer = {
      ok: true,
      text: "パスワード再設定用のメールを送信しました。メールのリンクから再設定してください。",
    };
    try {
      await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${origin}/set-password` });
    } catch { /* 理由は伏せる */ }

    setMsg(sameAnswer);
    setLoading(false);
  };

  const inputCls =
    "w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-red-400";

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP" className="w-14 h-14">
            <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
            <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
            <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
          </svg>
          <h1 className="text-lg font-bold tracking-wide">
            <span className="text-gray-900">KAWAI</span><span className="text-red-600"> CAMP</span>
          </h1>
          <p className="text-xs text-gray-400">
            {mode === "login" ? "アカウントにログイン" : "パスワードの再設定"}
          </p>
        </div>

        {mode === "login" ? (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">メールアドレス</label>
              <input
                type="email" required autoComplete="username"
                value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">パスワード</label>
              <input
                type="password" required autoComplete="current-password"
                value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
                className={inputCls}
                placeholder="パスワード"
              />
            </div>

            {msg && (
              <p className={`text-xs px-3 py-2 rounded-lg ${
                msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {msg.text}
              </p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "処理中..." : "ログイン"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-[11.5px] text-gray-500 leading-relaxed">
              ご登録のメールアドレスを入力してください。パスワード再設定用のリンクをお送りします。
            </p>
            <div>
              <label className="text-xs font-semibold text-gray-500 block mb-1.5">メールアドレス</label>
              <input
                type="email" required autoComplete="username"
                value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
                className={inputCls}
                placeholder="you@example.com"
              />
            </div>

            {msg && (
              <p className={`text-xs px-3 py-2 rounded-lg ${
                msg.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
              }`}>
                {msg.text}
              </p>
            )}

            <button
              type="submit" disabled={loading}
              className="w-full py-2.5 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "送信中..." : "再設定メールを送信"}
            </button>
          </form>
        )}

        <div className="text-center">
          <button
            onClick={() => switchMode(mode === "login" ? "reset" : "login")}
            className="text-xs text-red-600 hover:underline"
          >
            {mode === "login" ? "パスワードをお忘れの方はこちら" : "ログイン画面に戻る"}
          </button>
        </div>

        {/* 招待制であることの明示（セルフサインアップは廃止） */}
        <div className="border-t border-gray-100 pt-4 text-center">
          <p className="text-[11px] text-gray-400 leading-relaxed">
            KAWAI CAMP は<span className="font-semibold text-gray-500">招待制</span>です。<br />
            招待メールが届いていない方は事務局までお問い合わせください。
          </p>
        </div>
      </div>
    </div>
  );
}
