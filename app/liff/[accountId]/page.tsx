"use client";
// LIFF会員連携フォーム（LINE内で開く・Phase 5）。
//   liff.init → userId 自動取得 → 氏名/メール/電話を入力 → 会員照合。
//   LINE外（ブラウザ直開き）では liff.login() でLINEログインへ誘導。
import { useEffect, useState } from "react";

interface LiffProfile { userId: string; displayName: string }
interface LiffSDK {
  init(cfg: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(): void;
  getProfile(): Promise<LiffProfile>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
}
declare global { interface Window { liff?: LiffSDK } }

function loadLiff(): Promise<LiffSDK> {
  return new Promise((resolve, reject) => {
    if (window.liff) { resolve(window.liff); return; }
    const s = document.createElement("script");
    s.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    s.onload = () => (window.liff ? resolve(window.liff) : reject(new Error("LIFF SDKの読み込みに失敗しました")));
    s.onerror = () => reject(new Error("LIFF SDKの読み込みに失敗しました"));
    document.head.appendChild(s);
  });
}

export default function LiffLinkPage({ params }: { params: { accountId: string } }) {
  const accountId = Number(params.accountId);
  const [phase, setPhase] = useState<"loading" | "form" | "done" | "error">("loading");
  const [error, setError] = useState("");
  const [userId, setUserId] = useState("");
  const [idToken, setIdToken] = useState("");
  const [inClient, setInClient] = useState(true);
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/line/liff-config?acc=${accountId}`);
        const cfg = (await res.json().catch(() => ({}))) as { liffId?: string; error?: string };
        if (!res.ok || !cfg.liffId) throw new Error(cfg.error ?? "LIFFが設定されていません");
        const liff = await loadLiff();
        await liff.init({ liffId: cfg.liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }
        const p = await liff.getProfile();
        const token = liff.getIDToken() ?? "";
        setUserId(p.userId);
        setIdToken(token);
        setName((prev) => prev || p.displayName || "");
        setInClient(liff.isInClient());

        // 流入経路（?s=経路キー）があれば付与する（結果は本流を止めない）
        const sourceKey = new URLSearchParams(window.location.search).get("s");
        if (sourceKey) {
          try {
            await fetch("/api/line/enter", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ accountId, userId: p.userId, idToken: token, sourceKey }),
            });
          } catch { /* 経路付与の失敗は無視 */ }
        }

        setPhase("form");
      } catch (e) {
        setError(e instanceof Error ? e.message : "初期化に失敗しました");
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    setError("");
    if (!email.trim() && !phone.trim()) { setError("メールアドレスまたは電話番号を入力してください"); return; }
    setSending(true);
    try {
      const res = await fetch("/api/line/liff-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, userId, idToken, name, kana, email, phone }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "送信に失敗しました"); setSending(false); return; }
      setPhase("done");
    } catch {
      setError("送信に失敗しました。通信環境をご確認ください。");
      setSending(false);
    }
  };

  const close = () => { if (typeof window !== "undefined" && window.liff && inClient) window.liff.closeWindow(); };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f5", display: "flex", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e5e8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ background: "#06c755", color: "#fff", padding: "16px 20px", fontWeight: 800, fontSize: 16 }}>会員情報の連携</div>

          {phase === "loading" && <div style={{ padding: 40, textAlign: "center", color: "#6b6b73", fontSize: 13 }}>読み込み中…</div>}

          {phase === "error" && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p style={{ fontWeight: 700, color: "#c0392b", marginBottom: 6 }}>開けませんでした</p>
              <p style={{ fontSize: 13, color: "#6b6b73" }}>{error}</p>
            </div>
          )}

          {phase === "done" && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>ご登録ありがとうございました。</p>
              <p style={{ fontSize: 13, color: "#6b6b73", marginBottom: 14 }}>担当者が確認のうえ連携を完了します。</p>
              {inClient && (
                <button onClick={close} style={{ background: "#06c755", color: "#fff", fontWeight: 800, border: "none", borderRadius: 10, padding: "10px 22px", cursor: "pointer" }}>閉じる</button>
              )}
            </div>
          )}

          {phase === "form" && (
            <div style={{ padding: 20 }}>
              <p style={{ fontSize: 13, color: "#6b6b73", marginBottom: 16 }}>
                ご登録済みの情報と照合します。<b>メールアドレスまたは電話番号</b>のいずれかは必須です。
              </p>
              {[
                { label: "お名前", v: name, set: setName, ph: "山田 太郎", type: "text" },
                { label: "フリガナ", v: kana, set: setKana, ph: "ヤマダ タロウ", type: "text" },
                { label: "メールアドレス", v: email, set: setEmail, ph: "you@example.com", type: "email" },
                { label: "電話番号", v: phone, set: setPhone, ph: "090-1234-5678", type: "tel" },
              ].map((f) => (
                <div key={f.label} style={{ marginBottom: 12 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 700, marginBottom: 4 }}>{f.label}</label>
                  <input type={f.type} value={f.v} placeholder={f.ph} onChange={(e) => f.set(e.target.value)}
                    style={{ width: "100%", border: "1px solid #e5e5e8", borderRadius: 10, padding: "10px 12px", fontSize: 14, background: "#fbfbfc" }} />
                </div>
              ))}
              {error && <p style={{ color: "#c0392b", fontSize: 12, marginBottom: 10 }}>{error}</p>}
              <button onClick={submit} disabled={sending}
                style={{ width: "100%", background: "#06c755", color: "#fff", fontWeight: 800, fontSize: 15, border: "none", borderRadius: 10, padding: "12px 0", cursor: "pointer", opacity: sending ? 0.6 : 1 }}>
                {sending ? "送信中…" : "登録する"}
              </button>
            </div>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#9aa0a6", textAlign: "center", marginTop: 12 }}>KAWAI CAMP</p>
      </div>
    </div>
  );
}
