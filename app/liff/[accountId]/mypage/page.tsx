"use client";
// LINE内マイページ（LIFF・Phase 5c）。
//   liff.init → getIDToken（本人確認）→ 会員プロフィールを表示。
//   リッチメニューの「マイページ」から https://liff.line.me/<LIFF ID>/mypage で開く。
//   未連携なら会員連携フォームへ誘導する。
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

interface Member { name: string; company: string; source: string; prefecture: string; createdAt: string; attrLabels: string[] }
interface MyPageData { linked: boolean; accountName: string; displayName: string; member?: Member }

export default function LiffMyPage({ params }: { params: { accountId: string } }) {
  const accountId = Number(params.accountId);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [data, setData] = useState<MyPageData | null>(null);
  const [inClient, setInClient] = useState(true);
  const [liffId, setLiffId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/line/liff-config?acc=${accountId}`);
        const cfg = (await res.json().catch(() => ({}))) as { liffId?: string; error?: string };
        if (!res.ok || !cfg.liffId) throw new Error(cfg.error ?? "LIFFが設定されていません");
        setLiffId(cfg.liffId);
        const liff = await loadLiff();
        await liff.init({ liffId: cfg.liffId });
        if (!liff.isLoggedIn()) { liff.login(); return; }
        const p = await liff.getProfile();
        setInClient(liff.isInClient());
        const mres = await fetch("/api/line/liff-mypage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId, userId: p.userId, idToken: liff.getIDToken() ?? "" }),
        });
        const mj = (await mres.json().catch(() => ({}))) as { data?: MyPageData; error?: string };
        if (!mres.ok || !mj.data) throw new Error(mj.error ?? "情報の取得に失敗しました");
        setData(mj.data);
        setPhase("ready");
      } catch (e) {
        setError(e instanceof Error ? e.message : "初期化に失敗しました");
        setPhase("error");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => { if (typeof window !== "undefined" && window.liff && inClient) window.liff.closeWindow(); };
  const openForm = () => { if (liffId) window.location.href = `https://liff.line.me/${liffId}`; };

  const row = (label: string, value: string) =>
    value ? (
      <div style={{ display: "flex", padding: "10px 0", borderBottom: "1px solid #f0f0f2" }}>
        <div style={{ width: 96, fontSize: 12, color: "#9aa0a6", flexShrink: 0 }}>{label}</div>
        <div style={{ fontSize: 14, color: "#2b2b30", fontWeight: 600 }}>{value}</div>
      </div>
    ) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f4f4f5", display: "flex", justifyContent: "center", padding: "24px 16px" }}>
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ background: "#fff", border: "1px solid #e5e5e8", borderRadius: 16, overflow: "hidden" }}>
          <div style={{ background: "#06c755", color: "#fff", padding: "16px 20px", fontWeight: 800, fontSize: 16 }}>マイページ</div>

          {phase === "loading" && <div style={{ padding: 40, textAlign: "center", color: "#6b6b73", fontSize: 13 }}>読み込み中…</div>}

          {phase === "error" && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p style={{ fontWeight: 700, color: "#c0392b", marginBottom: 6 }}>開けませんでした</p>
              <p style={{ fontSize: 13, color: "#6b6b73" }}>{error}</p>
            </div>
          )}

          {phase === "ready" && data && !data.linked && (
            <div style={{ padding: 24, textAlign: "center" }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>会員情報が未連携です</p>
              <p style={{ fontSize: 13, color: "#6b6b73", marginBottom: 16 }}>
                {data.displayName ? `${data.displayName} さん、` : ""}会員連携を行うと、ここに登録情報が表示されます。
              </p>
              <button onClick={openForm}
                style={{ background: "#06c755", color: "#fff", fontWeight: 800, border: "none", borderRadius: 10, padding: "12px 22px", cursor: "pointer", width: "100%" }}>
                会員連携をする
              </button>
            </div>
          )}

          {phase === "ready" && data && data.linked && data.member && (
            <div style={{ padding: "8px 20px 20px" }}>
              <div style={{ padding: "16px 0 8px" }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#2b2b30" }}>{data.member.name} さん</div>
                {data.accountName && <div style={{ fontSize: 12, color: "#9aa0a6", marginTop: 2 }}>{data.accountName}</div>}
              </div>
              {data.member.attrLabels.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "6px 0 12px" }}>
                  {data.member.attrLabels.map((t) => (
                    <span key={t} style={{ fontSize: 12, fontWeight: 700, color: "#0a7d40", background: "#e7f7ee", borderRadius: 999, padding: "4px 10px" }}>{t}</span>
                  ))}
                </div>
              )}
              {row("所属", data.member.company)}
              {row("都道府県", data.member.prefecture)}
              {row("流入経路", data.member.source)}
              {row("登録日", data.member.createdAt)}
            </div>
          )}

          {phase === "ready" && inClient && (
            <div style={{ padding: "0 20px 20px", textAlign: "center" }}>
              <button onClick={close}
                style={{ background: "#f0f0f2", color: "#4b4b52", fontWeight: 700, border: "none", borderRadius: 10, padding: "10px 22px", cursor: "pointer" }}>
                閉じる
              </button>
            </div>
          )}
        </div>
        <p style={{ fontSize: 11, color: "#9aa0a6", textAlign: "center", marginTop: 12 }}>KAWAI CAMP</p>
      </div>
    </div>
  );
}
