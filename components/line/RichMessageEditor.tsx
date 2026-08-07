"use client";
// ============================================================
// リッチメッセージ エディタ（Phase 7①・配信/シナリオ/トーク共通）
//   種別：テキスト / 画像 / 画像カード(ボタン) / カルーセル。クイックリプライ付与可。
//   画像はリッチメニューと同じ line-outbound バケットへアップロードし公開URLで使う。
//   ボタンのアクションはリッチメニューと同じ種別（URL/連携フォーム/マイページ/テキスト送信）。
// ============================================================
import { useState } from "react";
import type { RichMessage, RichMsgType, RichMsgCard, RichMsgButton, RichMenuActionType } from "../../lib/models";
import { uploadRichMenuImage, richMenuImageUrl } from "../../lib/lineRichMenu";

const ACT: Record<RichMenuActionType, string> = {
  uri: "URLを開く", liff: "会員連携フォーム", liff_mypage: "マイページ", message: "テキスト送信",
};
const TYPES: { k: RichMsgType; l: string }[] = [
  { k: "text", l: "テキスト" }, { k: "image", l: "画像" }, { k: "buttons", l: "画像カード" }, { k: "carousel", l: "カルーセル" },
];
const emptyBtn = (): RichMsgButton => ({ label: "", actionType: "uri", actionValue: "" });
const emptyCard = (): RichMsgCard => ({ imageUrl: "", title: "", text: "", buttons: [emptyBtn()] });
const inp = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12.5px] bg-white";

export interface RichMessageEditorProps {
  value: RichMessage | null;
  onChange: (m: RichMessage | null) => void;
  accountId: number | null;
}

export function RichMessageEditor({ value, onChange, accountId }: RichMessageEditorProps) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const m: RichMessage = value ?? { type: "text", text: "" };
  const set = (p: Partial<RichMessage>) => onChange({ ...m, ...p });

  const setType = (t: RichMsgType) => {
    const next: RichMessage = { type: t, altText: m.altText, quickReplies: m.quickReplies };
    if (t === "text") next.text = m.text ?? "";
    if (t === "image") next.imageUrl = m.imageUrl ?? "";
    if (t === "buttons") next.card = m.card ?? emptyCard();
    if (t === "carousel") next.cards = m.cards?.length ? m.cards : [emptyCard()];
    onChange(next);
  };

  const upload = async (file: File, apply: (url: string) => void) => {
    if (accountId == null) { setErr("先に送信元LINEアカウントを選択してください"); return; }
    setBusy(true); setErr("");
    const r = await uploadRichMenuImage(accountId, file);
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    apply(richMenuImageUrl(r.path));
  };

  // ── カード編集（ボタンカード／カルーセルの各カード共通）──
  const cardEditor = (card: RichMsgCard, onCard: (c: RichMsgCard) => void) => {
    const setBtn = (i: number, p: Partial<RichMsgButton>) =>
      onCard({ ...card, buttons: card.buttons.map((b, idx) => idx === i ? { ...b, ...p } : b) });
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {card.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={card.imageUrl} alt="" className="w-16 h-12 object-cover rounded border border-gray-200" />
            : <div className="w-16 h-12 rounded bg-gray-100 border border-gray-200 grid place-items-center text-[10px] text-gray-400">画像</div>}
          <label className="text-[11.5px] font-bold border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
            画像を選択
            <input type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, (url) => onCard({ ...card, imageUrl: url })); }} />
          </label>
          {card.imageUrl && <button type="button" onClick={() => onCard({ ...card, imageUrl: "" })} className="text-[11px] text-gray-400">画像を外す</button>}
        </div>
        <input className={inp} placeholder="タイトル" value={card.title} onChange={(e) => onCard({ ...card, title: e.target.value })} />
        <input className={inp} placeholder="本文（〜60字）" value={card.text} onChange={(e) => onCard({ ...card, text: e.target.value })} />
        <div className="space-y-1.5">
          {card.buttons.map((b, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input className={inp} placeholder="ボタン名" value={b.label} onChange={(e) => setBtn(i, { label: e.target.value })} />
              <select className={inp} value={b.actionType} onChange={(e) => setBtn(i, { actionType: e.target.value as RichMenuActionType })}>
                {(Object.keys(ACT) as RichMenuActionType[]).map((k) => <option key={k} value={k}>{ACT[k]}</option>)}
              </select>
              <button type="button" className="text-red-500 text-xs px-1" onClick={() => onCard({ ...card, buttons: card.buttons.filter((_, idx) => idx !== i) })}>✕</button>
              {(b.actionType === "uri" || b.actionType === "message") && (
                <input className={`${inp} col-span-3`} placeholder={b.actionType === "uri" ? "https://…" : "送信するテキスト"}
                  value={b.actionValue} onChange={(e) => setBtn(i, { actionValue: e.target.value })} />
              )}
            </div>
          ))}
          {card.buttons.length < 3 && (
            <button type="button" onClick={() => onCard({ ...card, buttons: [...card.buttons, emptyBtn()] })}
              className="text-[11.5px] text-emerald-700 font-bold">＋ ボタンを追加</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-1.5 flex-wrap">
        {TYPES.map((t) => (
          <button key={t.k} type="button" onClick={() => setType(t.k)}
            className={`text-[11.5px] font-bold rounded-full px-3 py-1 border ${m.type === t.k ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-gray-300 text-gray-600"}`}>{t.l}</button>
        ))}
        <button type="button" onClick={() => onChange(null)} className="ml-auto text-[11px] text-gray-400 underline">リッチをやめる</button>
      </div>

      {m.type === "text" && (
        <textarea className={`${inp} min-h-[70px]`} placeholder="メッセージ本文" value={m.text ?? ""} onChange={(e) => set({ text: e.target.value })} />
      )}

      {m.type === "image" && (
        <div className="flex items-center gap-2">
          {m.imageUrl
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={m.imageUrl} alt="" className="w-24 h-16 object-cover rounded border border-gray-200" />
            : <div className="w-24 h-16 rounded bg-gray-100 border border-gray-200 grid place-items-center text-[10px] text-gray-400">画像</div>}
          <label className="text-[11.5px] font-bold border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white cursor-pointer">
            画像を選択
            <input type="file" accept="image/jpeg,image/png" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f, (url) => set({ imageUrl: url })); }} />
          </label>
        </div>
      )}

      {m.type === "buttons" && m.card && cardEditor(m.card, (c) => set({ card: c }))}

      {m.type === "carousel" && m.cards && (
        <div className="space-y-2.5">
          {m.cards.map((c, i) => (
            <div key={i} className="border border-gray-200 rounded-lg p-2.5 bg-gray-50">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-bold text-gray-500">カード {i + 1}</span>
                {m.cards!.length > 1 && <button type="button" className="text-red-500 text-xs" onClick={() => set({ cards: m.cards!.filter((_, idx) => idx !== i) })}>削除</button>}
              </div>
              {cardEditor(c, (nc) => set({ cards: m.cards!.map((x, idx) => idx === i ? nc : x) }))}
            </div>
          ))}
          {m.cards.length < 10 && (
            <button type="button" onClick={() => set({ cards: [...m.cards!, emptyCard()] })}
              className="text-[11.5px] text-emerald-700 font-bold">＋ カードを追加</button>
          )}
        </div>
      )}

      {/* クイックリプライ */}
      <div className="border-t border-gray-100 pt-2">
        <div className="text-[11px] font-bold text-gray-500 mb-1">クイックリプライ（任意・最大13）</div>
        <div className="space-y-1.5">
          {(m.quickReplies ?? []).map((q, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1.5">
              <input className={inp} placeholder="表示ラベル" value={q.label} onChange={(e) => set({ quickReplies: (m.quickReplies ?? []).map((x, idx) => idx === i ? { ...x, label: e.target.value } : x) })} />
              <input className={inp} placeholder="送信テキスト" value={q.text} onChange={(e) => set({ quickReplies: (m.quickReplies ?? []).map((x, idx) => idx === i ? { ...x, text: e.target.value } : x) })} />
              <button type="button" className="text-red-500 text-xs px-1" onClick={() => set({ quickReplies: (m.quickReplies ?? []).filter((_, idx) => idx !== i) })}>✕</button>
            </div>
          ))}
          {(m.quickReplies ?? []).length < 13 && (
            <button type="button" onClick={() => set({ quickReplies: [...(m.quickReplies ?? []), { label: "", text: "" }] })}
              className="text-[11.5px] text-emerald-700 font-bold">＋ クイックリプライを追加</button>
          )}
        </div>
      </div>

      {busy && <div className="text-[11px] text-gray-400">画像アップロード中…</div>}
      {err && <div className="text-[11px] text-red-600">{err}</div>}
    </div>
  );
}
