"use client";
// ============================================================
// ⑤提出パネル（出口フォーム → 受付完了）
//
//   ・連絡先を聞くのはこの瞬間だけ。入口では聞かない（設計 決定7）。
//   ・「やめておく」を必ず置く。提出しない自由を残す（成果物を人質にしない）。
//   ・回答すると外部ロールで会員登録され、その場でポータルへ入れる。
// ============================================================
import { useState } from "react";
import { errMessage } from "../../../lib/errors";
import { submitTrial } from "../../../lib/bot/trial/trialClient";
import { IcCheck } from "../icons";

const IN =
  "w-full bg-[#100f0e] border border-[#37342f] rounded-lg px-3 py-2 text-[12.5px] text-[#f3efe8] placeholder-[#5a564e] focus:outline-none focus:border-[#ee1c25]";

export function SubmitPanel({
  runId, shareToken, passcode, onDone,
}: {
  runId: number;
  shareToken: string;
  passcode: string | null;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ tokenHash: string | null } | null>(null);

  const onSubmit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await submitTrial({ runId, shareToken, passcode, name, email });
      setDone({ tokenHash: res.tokenHash });
      onDone();
    } catch (e: unknown) {
      setError(errMessage(e, "提出できませんでした。"));
    } finally {
      setBusy(false);
    }
  };

  // ── 受付完了 ──
  if (done) {
    return (
      <div className="bg-[#161513] border border-[#2f6b4f] rounded-xl p-4">
        <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#8fe0b0] mb-2">
          <IcCheck className="w-4 h-4" />提出を受け付けました
        </div>
        <p className="text-[12px] text-[#a8a196] leading-relaxed m-0">
          担当者が目を通して、講評をお届けします。
          会員ポータルにそのまま入れるようになりました。講評が届くとお知らせします。
        </p>
        <div className="mt-3">
          {done.tokenHash ? (
            <a
              href={`/auth/trial?token_hash=${encodeURIComponent(done.tokenHash)}&next=/`}
              className="inline-block bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110"
            >
              ポータルに入る
            </a>
          ) : (
            // トークンを受け取れなかった場合の逃げ道。ログインから入り直せる。
            <a href="/login" className="inline-block bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110">
              ログインして続ける
            </a>
          )}
        </div>
      </div>
    );
  }

  // ── 提出前 ──
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110"
      >
        これで提出する
      </button>
    );
  }

  return (
    <div className="bg-[#161513] border border-[#37342f] rounded-xl p-4">
      <div className="text-[13px] font-bold text-[#f3efe8] mb-1">
        提出して、担当者からの講評を受け取る
      </div>
      <p className="text-[11px] text-[#736e66] leading-relaxed mb-3 m-0">
        作ったものに担当者が目を通し、良い点と直すと良くなる点をお返しします。受け取り先だけ教えてください。
      </p>

      {error && (
        <div className="bg-[#241f16] border border-[#4a3f22] text-[#e0b45a] rounded-lg px-3 py-2 text-[11.5px] mb-3">
          {error}
        </div>
      )}

      <div className="mb-3">
        <label className="block text-[11px] text-[#a8a196] mb-1.5">お名前</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className={IN} />
      </div>
      <div className="mb-3">
        <label className="block text-[11px] text-[#a8a196] mb-1.5">メールアドレス</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" maxLength={254} className={IN} />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void onSubmit()}
          disabled={busy || !name.trim() || !email.trim()}
          className="bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "送信中…" : "提出する"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy}
          className="text-[#a8a196] border border-[#37342f] rounded-xl px-4 py-2.5 text-xs hover:border-[#5a564e] disabled:opacity-40"
        >
          やめておく
        </button>
      </div>
      <div className="text-[10.5px] text-[#5a564e] mt-2.5 leading-relaxed">
        提出しなくても、作ったものはこの画面から保存できます。
      </div>
    </div>
  );
}
