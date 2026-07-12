"use client";
// ============================================================
// 運営ゾーンのログイン画面（Phase 2：入り口分離）
//
//   会員向け /login とは視覚的にも明確に分ける（ダークテーマ ＋ OPS ロゴ）。
//   誤ログインを防ぐため「会員の方はこちら」の導線を明記する。
//
//   ⚠️ 認証基盤（Supabase Auth）は会員ゾーンと共通。
//      つまり会員のメール／パスワードでも signIn 自体は成功してしまう。
//      そこで「ログイン直後にロールを判定し、運営でなければ即サインアウト」する。
//      （middleware でも二重に弾くので、仮に画面をすり抜けても運営データには到達できない）
// ============================================================
import { useEffect, useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import { errMessage } from "../../../lib/errors";
import { isOpsRole, safeNext, OPS_ROOT, MEMBER_LOGIN } from "../../../lib/zone";

type Msg = { ok: boolean; text: string } | null;

export default function OpsLoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [msg,      setMsg]      = useState<Msg>(null);
  const [loading,  setLoading]  = useState(false);
  const [next,     setNext]     = useState<string>(OPS_ROOT);

  // middleware が付ける ?next=（元々開こうとしていた運営ページ）を拾う。
  //   useSearchParams は Suspense 必須になるため、window から直接読む。
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setNext(safeNext(q.get("next"), OPS_ROOT));
  }, []);

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      // ── ロール判定：運営でなければこの入り口は使わせない ──
      const { data: role } = await supabase.rpc("current_member_role");
      if (!isOpsRole(role)) {
        await supabase.auth.signOut();
        setMsg({ ok: false, text: "この入り口は運営スタッフ専用です。会員の方は会員ログインからお入りください。" });
        return;
      }

      // 運営ゾーン外の next（例: 会員ページ）は無視して /ops へ
      const to = next.startsWith(OPS_ROOT) ? next : OPS_ROOT;
      router.push(to);
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: errMessage(err, "ログインに失敗しました") });
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2.5 text-sm text-neutral-100 " +
    "placeholder:text-neutral-500 focus:outline-none focus:border-red-500";

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ background: "linear-gradient(160deg,#17171b,#0d0d0f)" }}>
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl p-8 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <svg viewBox="0 0 120 104" role="img" aria-label="KAWAI CAMP OPS" className="w-14 h-14">
            <path d="M60 6 L114 98 H6 Z" fill="#ee1c25" stroke="#ee1c25" strokeWidth="6" strokeLinejoin="round" />
            <rect x="46" y="54" width="7.5" height="26" rx="1.5" fill="#fff" />
            <path d="M72 54 L72 80 L54 67 Z" fill="#fff" />
          </svg>
          <h1 className="text-lg font-bold tracking-wide">
            <span className="text-white">KAWAI CAMP</span><span className="text-red-500"> OPS</span>
          </h1>
          <p className="text-xs text-neutral-500">運営管理コンソール</p>
        </div>

        {/* 誤ログイン防止の案内 */}
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2.5 text-[11px] leading-relaxed text-red-200">
          🔒 この画面は運営スタッフ専用です。会員の方は{" "}
          <a href={MEMBER_LOGIN} className="text-white underline underline-offset-2">会員ログイン</a>{" "}
          からお入りください。
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="text-xs font-semibold text-neutral-400 block mb-1.5">メールアドレス</label>
            <input
              type="email" required autoComplete="username"
              value={email} onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
              className={inputCls} placeholder="operator@example.com"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-neutral-400 block mb-1.5">パスワード</label>
            <input
              type="password" required autoComplete="current-password"
              value={password} onChange={(e: ChangeEvent<HTMLInputElement>) => setPassword(e.target.value)}
              className={inputCls} placeholder="パスワード"
            />
          </div>

          {msg && (
            <p className={`text-xs px-3 py-2 rounded-lg ${
              msg.ok ? "bg-green-950/60 text-green-300" : "bg-red-950/60 text-red-300"
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

        <p className="text-[11px] text-neutral-600 text-center leading-relaxed">
          新規アカウントの作成は管理者からの招待のみです。<br />
          パスワードをお忘れの場合は管理者にお問い合わせください。
        </p>
      </div>
    </div>
  );
}
