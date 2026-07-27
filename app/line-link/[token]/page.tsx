"use client";
// LINE連携 登録フォーム（公開・トークン認証）。
//   友だちがLINEから開き、氏名・メール・電話を登録する。回答は会員照合に使われる。
import { useState } from "react";

export default function LineLinkPage({ params }: { params: { token: string } }) {
  const token = params.token;
  const [name, setName] = useState("");
  const [kana, setKana] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [state, setState] = useState<"input" | "sending" | "done">("input");
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!email.trim() && !phone.trim()) { setError("メールアドレスまたは電話番号を入力してください"); return; }
    setState("sending");
    try {
      const res = await fetch("/api/line/link-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, name, kana, email, phone }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setError(j.error ?? "送信に失敗しました"); setState("input"); return; }
      setState("done");
    } catch {
      setError("送信に失敗しました。通信環境をご確認ください。");
      setState("input");
    }
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f5", display: "flex", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e5e8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ background: "#06c755", color: "#fff", padding: "16px 20px", fontWeight: 800, fontSize: 16 }}>
            会員情報の連携
          </div>
          {state === "done" ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 8 }}>✓</div>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>ご登録ありがとうございました。</p>
              <p style={{ fontSize: 13, color: "#6b6b73" }}>担当者が確認のうえ、連携を完了します。このページは閉じていただいて大丈夫です。</p>
            </div>
          ) : (
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
                  <input
                    type={f.type}
                    value={f.v}
                    placeholder={f.ph}
                    onChange={(e) => f.set(e.target.value)}
                    style={{ width: "100%", border: "1px solid #e5e5e8", borderRadius: 10, padding: "10px 12px", fontSize: 14, background: "#fbfbfc" }}
                  />
                </div>
              ))}
              {error && <p style={{ color: "#c0392b", fontSize: 12, marginBottom: 10 }}>{error}</p>}
              <button
                onClick={submit}
                disabled={state === "sending"}
                style={{ width: "100%", background: "#06c755", color: "#fff", fontWeight: 800, fontSize: 15, border: "none", borderRadius: 10, padding: "12px 0", cursor: "pointer", opacity: state === "sending" ? 0.6 : 1 }}
              >
                {state === "sending" ? "送信中…" : "登録する"}
              </button>
            </div>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#9aa0a6", textAlign: "center", marginTop: 12 }}>KAWAI CAMP</p>
      </div>
    </div>
  );
}
