"use client";
// ============================================================
// 通知の許可を求めるカード（オプトイン）
//
//   ⚠️ 出すタイミングが命。
//   ブラウザの通知許可は「一度拒否されると復活が極めて困難」（ユーザーが
//   ブラウザ設定から手動で戻すしかない）。したがって、来訪直後の何も価値を
//   感じていない状態でプロンプトを出すのは最悪手になる。
//
//   このコンポーネントは「コンテンツを1本開いた後」＝価値を感じた直後に
//   詳細画面の末尾で出す前提で作っている。
//
//   ・permission が "default"（未回答）のときだけ表示する
//   ・「あとで」を選べる（＝ブラウザの拒否を踏ませない）。選択は localStorage に残す
//   ・iOS Safari はホーム画面に追加した PWA でないと購読できない。
//     その場合は isPushSupported() が false になるので、そもそも表示しない。
// ============================================================
import { useEffect, useState } from "react";
import { isPushSupported, permissionState, isSubscribed, subscribeDevice } from "../../lib/push";

const SNOOZE_KEY = "kc_push_optin_snoozed";

export function PushOptIn({ memberId }: { memberId: number | null }) {
  const [show, setShow]   = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (memberId == null) return;
      if (!isPushSupported()) return;                     // iOS のブラウザ表示など
      if (permissionState() !== "default") return;        // 既に許可／拒否済み
      if (localStorage.getItem(SNOOZE_KEY) === "1") return;
      if (await isSubscribed()) return;
      setShow(true);
    })();
  }, [memberId]);

  if (!show || memberId == null) return null;

  const allow = async () => {
    setBusy(true); setError(null);
    const r = await subscribeDevice(memberId);
    setBusy(false);
    if (r.ok) { setShow(false); return; }
    // 拒否された場合もここに来る。しつこく出さない。
    setError(r.reason ?? "通知を有効にできませんでした");
    localStorage.setItem(SNOOZE_KEY, "1");
  };

  const later = () => {
    localStorage.setItem(SNOOZE_KEY, "1");
    setShow(false);
  };

  return (
    <div className="mt-6 border border-red-100 bg-red-50/60 rounded-2xl p-5">
      <p className="text-sm font-bold text-gray-800">新しいコンテンツを通知で受け取りますか？</p>
      <p className="text-[12.5px] text-gray-500 mt-1 leading-relaxed">
        新着コンテンツや事務局からのメッセージを、ブラウザの通知でお知らせします。<br />
        あとから設定画面でいつでも変更できます。
      </p>

      {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}

      <div className="flex gap-2 mt-4">
        <button
          onClick={allow} disabled={busy}
          className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "設定中..." : "通知を受け取る"}
        </button>
        <button
          onClick={later}
          className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-600 text-sm font-semibold hover:bg-gray-50"
        >
          あとで
        </button>
      </div>
    </div>
  );
}
