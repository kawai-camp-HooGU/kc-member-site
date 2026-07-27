"use client";
// 名寄せ操作（トーク画面ヘッダー）：連携状態の表示・連携フォーム送信・自動照合・手動連携・解除。
//   ※ 本格的な要対応キュー（案B）は後フェーズ。ここは1対1の最小操作。
import { useState } from "react";
import type { LineFriend, LineMatchCandidate, LineMatchResult } from "../../lib/models";

export interface LinkControlProps {
  friend: LineFriend;
  memberName: string;
  onSendForm: () => Promise<{ ok: boolean; error?: string }>;
  onMatch: () => Promise<LineMatchResult | null>;
  onManualLink: (memberId: number) => Promise<{ ok: boolean; error?: string }>;
  onUnlink: () => Promise<{ ok: boolean; error?: string }>;
}

export function LinkControl({ friend, memberName, onSendForm, onMatch, onManualLink, onUnlink }: LinkControlProps) {
  const [busy, setBusy] = useState(false);
  const [cands, setCands] = useState<LineMatchCandidate[] | null>(null);
  const [msg, setMsg] = useState("");
  const linked = friend.memberId != null;

  const run = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string) => {
    setBusy(true); setMsg("");
    const r = await fn();
    setBusy(false);
    setMsg(r.ok ? ok : (r.error ?? "失敗しました"));
    return r.ok;
  };

  const doMatch = async () => {
    setBusy(true); setMsg("");
    const r = await onMatch();
    setBusy(false);
    if (!r) { setMsg("照合に失敗しました"); return; }
    if (r.linked) { setCands(null); setMsg("自動連携しました"); return; }
    setCands(r.candidates);
    setMsg(
      r.candidates.length === 0
        ? "候補がありません。連携フォームを送って情報を集めてください"
        : r.conflict ? "複数候補/矛盾のため手動で確定してください" : "候補から選んで連携してください"
    );
  };

  if (linked) {
    return (
      <div className="text-[11px] text-gray-600 flex items-center gap-2 flex-wrap">
        <span className="font-bold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-700">
          会員 #{friend.memberId}{memberName ? ` ${memberName}` : ""} に連携済み
        </span>
        <button onClick={() => run(onUnlink, "解除しました")} disabled={busy} className="text-red-600 underline disabled:opacity-50">解除</button>
        {msg && <span className="text-gray-400">{msg}</span>}
      </div>
    );
  }

  return (
    <div className="text-[11px] text-gray-600">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">未連携</span>
        <button onClick={() => run(onSendForm, "連携フォームを送信しました")} disabled={busy} className="text-emerald-700 underline disabled:opacity-50">連携フォーム送信</button>
        <button onClick={doMatch} disabled={busy} className="text-emerald-700 underline disabled:opacity-50">自動照合</button>
        {(friend.collectedEmail || friend.collectedPhone) && (
          <span className="text-gray-400">収集済: {[friend.collectedEmail, friend.collectedPhone].filter(Boolean).join(" / ")}</span>
        )}
      </div>
      {msg && <div className="mt-1 text-gray-500">{msg}</div>}
      {cands && cands.length > 0 && (
        <div className="mt-1.5 border border-gray-200 rounded-lg divide-y divide-gray-100 bg-white">
          {cands.map((c) => (
            <div key={c.memberId} className="flex items-center gap-2 px-2 py-1.5">
              <div className="min-w-0">
                <div className="font-bold truncate">{c.name || "(名称未設定)"} <span className="text-gray-400">#{c.memberId}</span></div>
                <div className="text-gray-400 truncate">
                  {c.matchedBy.map((k) => (k === "email" ? "メール" : k === "phone" ? "電話" : "氏名")).join("・")}一致
                  {c.alreadyLinked && " ／ 既に別LINEに連携済み"}
                </div>
              </div>
              <button
                onClick={() => run(() => onManualLink(c.memberId), "連携しました").then((ok) => { if (ok) setCands(null); })}
                disabled={busy || c.alreadyLinked}
                className="ml-auto text-[11px] font-bold border border-emerald-300 text-emerald-700 rounded-md px-2 py-1 disabled:opacity-40"
              >
                連携
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
