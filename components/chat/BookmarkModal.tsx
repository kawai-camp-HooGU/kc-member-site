"use client";
// ============================================================
// トークのブックマーク登録／解除モーダル（ポータルトーク・LINEトーク共用）
//
//   REQ-032（2026-08-25）
//     ・公開範囲を1件ずつ選ぶ。既定は最も狭い「運営のみ」
//     ・開いたら1度だけAIの下見を走らせ、分割候補・差し込み変数・重複を先に見せる
//     ・下見が落ちても登録はできる（下見を必須にすると、AI障害中に1件も作れなくなる）
//   ⚠️ このモーダルは ChatView と LineChatView の両方から使う。片方だけ直さないこと。
// ============================================================
import { useEffect, useRef, useState } from "react";
import { BOOKMARK_GENRES, PUBLISH_SCOPES, previewBookmark } from "../../lib/bookmarks";
import type {
  PublishScope, BookmarkSegment, BookmarkGenResult, SimilarBookmark,
} from "../../lib/bookmarks";

/** 登録時に親へ渡すもの。 */
export interface BookmarkSavePayload {
  genre: string;
  publishScope: PublishScope;
  /** 分割して登録するとき。1件のままなら空配列 */
  segments: BookmarkSegment[];
  /** 下見の生成結果（あればサーバーは再生成しない） */
  gen?: BookmarkGenResult;
  /** 重複を置き換えるとき */
  replaceId?: number;
}

// ジャンルごとの公開範囲の初期候補（取り込み仕様 A-4 の「公開ボットで使うか」を写したもの）。
//   ⚠️ あくまで初期値。運営が触った後は追従しない。
const SCOPE_BY_GENRE: Record<string, PublishScope> = {
  "アプローチ": "ops_only",
  "クレーム": "ops_only",
  "説明": "public",
  "申込・手続き": "public",
  "料金・支払い": "public",
  "予約・日程": "public",
  "解約・返金": "member",
  "フォローアップ": "ops_only",
  "その他": "ops_only",
};

/** 取り込み仕様 §2 の粒度の目安。超えたら分割を促す（登録は止めない）。 */
const LONG_TEXT = 800;

export function BookmarkModal({
  originalText, alreadyBookmarked, busy, onSave, onDelete, onClose,
}: {
  originalText: string;
  alreadyBookmarked: boolean;
  busy: boolean;
  onSave: (p: BookmarkSavePayload) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [genre, setGenre] = useState<string>("説明");
  const [scope, setScope] = useState<PublishScope>(SCOPE_BY_GENRE["説明"] ?? "ops_only");
  const [scopeTouched, setScopeTouched] = useState(false);

  const [previewing, setPreviewing] = useState(false);
  const [gen, setGen] = useState<BookmarkGenResult | null>(null);
  const [dups, setDups] = useState<SimilarBookmark[]>([]);
  const [previewErr, setPreviewErr] = useState("");
  const [segChecked, setSegChecked] = useState<boolean[]>([]);
  const [replaceId, setReplaceId] = useState<number | null>(null);

  const ranRef = useRef(false);

  // ── AIの下見（開いたら1度だけ）──
  //   ⚠️ ジャンルを変えても再実行しない。ジャンルは分類であって生成内容をほぼ変えないため、
  //      変えるたびにAIを呼ぶとトークンと待ち時間だけが増える。
  useEffect(() => {
    if (alreadyBookmarked || ranRef.current) return;
    ranRef.current = true;
    let alive = true;
    (async () => {
      setPreviewing(true);
      const r = await previewBookmark({ genre, originalText });
      if (!alive) return;
      setPreviewing(false);
      if (!r.ok) { setPreviewErr(r.error ?? "AIの下見に失敗しました"); return; }
      setGen(r.gen ?? null);
      setDups(r.duplicates ?? []);
      setSegChecked((r.gen?.segments ?? []).map(() => true));
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alreadyBookmarked, originalText]);

  const pickGenre = (g: string) => {
    setGenre(g);
    if (!scopeTouched) setScope(SCOPE_BY_GENRE[g] ?? "ops_only");
  };

  const segments = gen?.segments ?? [];
  const chosen = segments.filter((_, i) => segChecked[i]);
  const count = chosen.length >= 2 ? chosen.length : 1;
  const tooLong = originalText.length > LONG_TEXT;

  const submit = () => {
    onSave({
      genre, publishScope: scope,
      segments: chosen.length >= 2 ? chosen : [],
      gen: gen ?? undefined,
      replaceId: replaceId ?? undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end justify-center md:items-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl overflow-hidden my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center">
          <b className="text-[15px] font-extrabold text-gray-800">★ ブックマーク{alreadyBookmarked ? "" : "に登録"}</b>
          <button onClick={onClose} className="ml-auto text-gray-400 text-lg leading-none">✕</button>
        </div>

        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
          <div className="text-[12px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 mb-4 max-h-28 overflow-y-auto whitespace-pre-wrap">{originalText || "（本文なし）"}</div>

          {alreadyBookmarked ? (
            <p className="text-[13px] text-gray-600">このメッセージは既にブックマーク済みです。解除しますか？</p>
          ) : (
            <>
              <div className="text-xs font-bold text-gray-500 mb-2">ジャンル</div>
              <div className="flex flex-wrap gap-2">
                {BOOKMARK_GENRES.map((g) => (
                  <button key={g} type="button" onClick={() => pickGenre(g)}
                    className={`text-[12px] font-bold px-3 py-1.5 rounded-full border transition-colors ${genre === g ? "bg-red-50 border-red-400 text-red-600" : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"}`}>{g}</button>
                ))}
              </div>

              {/* ── 公開範囲 ── */}
              <div className="text-xs font-bold text-gray-500 mt-4 mb-2">
                公開範囲 <span className="font-normal text-gray-400">どこまでのAIが参照してよいか</span>
              </div>
              <div className="flex border border-gray-300 rounded-lg overflow-hidden w-full">
                {PUBLISH_SCOPES.map((s, i) => (
                  <button key={s.key} type="button"
                    onClick={() => { setScope(s.key); setScopeTouched(true); }}
                    className={`flex-1 text-[11.5px] font-bold py-2 ${i > 0 ? "border-l border-gray-300" : ""} ${scope === s.key ? "bg-neutral-800 text-white" : "bg-white text-gray-600 hover:bg-gray-50"}`}>
                    {s.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
                {PUBLISH_SCOPES.find((s) => s.key === scope)?.help}
                {scope === "ops_only" && "。あとから一覧で広げられます"}
              </p>

              {/* ── AIの下見 ── */}
              {previewing && (
                <div className="mt-4 border border-gray-200 bg-gray-50 rounded-lg px-3 py-2.5 text-[11.5px] text-gray-500">
                  AIが下見しています…（分割候補・差し込み変数・重複を確認します）
                </div>
              )}

              {!previewing && previewErr && (
                <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2.5 text-[11.5px] text-amber-700 leading-relaxed">
                  AIの下見に失敗しました（{previewErr}）。このまま登録できます（登録時にもう一度生成します）。
                </div>
              )}

              {tooLong && segments.length === 0 && (
                <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg px-3 py-2.5 text-[11.5px] text-amber-700 leading-relaxed">
                  原文が{originalText.length}字あります。1件は300〜800字が目安です。話題が複数あるなら分けて登録すると検索の精度が上がります。
                </div>
              )}

              {segments.length >= 2 && (
                <div className="mt-4 border border-amber-200 bg-amber-50 rounded-lg px-3 py-3">
                  <div className="text-[11.5px] font-bold text-amber-700 mb-2">AIの下見：話題が{segments.length}つあります</div>
                  {segments.map((sg, i) => (
                    <label key={`${sg.topic}-${i}`} className="block border border-gray-200 bg-white rounded-lg px-3 py-2 mb-2 cursor-pointer">
                      <span className="flex items-center gap-2 mb-1">
                        <input type="checkbox" checked={segChecked[i] ?? false}
                          onChange={(e) => setSegChecked((prev) => prev.map((v, j) => (j === i ? e.target.checked : v)))} />
                        <b className="text-[12px] text-gray-800">{sg.topic || `話題${i + 1}`}</b>
                      </span>
                      <span className="block text-[11.5px] text-gray-500 leading-relaxed">
                        {sg.question} ／ {sg.answer.slice(0, 70)}{sg.answer.length > 70 ? "…" : ""}
                      </span>
                    </label>
                  ))}
                  <p className="text-[11px] text-amber-700 m-0">
                    {chosen.length >= 2
                      ? `${chosen.length}件に分けて登録します。1件のままにする場合はチェックを外してください。`
                      : "1件のまま登録します。分けるにはチェックを2つ以上入れてください。"}
                  </p>
                </div>
              )}

              {(gen?.variables?.length ?? 0) > 0 && (
                <div className="mt-3 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2.5">
                  <div className="text-[11.5px] font-bold text-emerald-700 mb-1.5">固有の値を差し込み変数に置き換えました</div>
                  <div className="text-[11.5px] text-gray-600 leading-relaxed">
                    {gen?.variables.map((v) => (
                      <span key={v.name} className="inline-block mr-3">
                        <span className="font-bold text-emerald-700 bg-white border border-emerald-200 rounded px-1.5 py-0.5">{`{{${v.name}}}`}</span>
                        <span className="ml-1 text-gray-500">{v.example}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {dups.length > 0 && (
                <div className="mt-3 border border-amber-200 bg-amber-50 rounded-lg px-3 py-3">
                  <div className="text-[11.5px] font-bold text-amber-700 mb-2">
                    似た内容が既に登録されています（類似度 {dups[0] ? dups[0].score.toFixed(2) : "-"}）
                  </div>
                  {dups.slice(0, 2).map((d) => (
                    <div key={d.id} className="bg-white border border-gray-200 rounded-lg px-3 py-2 mb-2">
                      <div className="text-[12px] font-bold text-gray-800 mb-0.5">{d.expectedQuestion || "（想定質問なし）"}</div>
                      <div className="text-[11.5px] text-gray-500 line-clamp-2">{d.formattedReply}</div>
                      <div className="text-[10.5px] text-gray-400 mt-1">参照{d.usedCount}回</div>
                    </div>
                  ))}
                  <div className="flex gap-2 mt-1">
                    <button type="button" onClick={() => setReplaceId(dups[0]?.id ?? null)}
                      className={`flex-1 text-[11.5px] font-bold py-2 rounded-lg border ${replaceId != null ? "bg-neutral-800 text-white border-neutral-800" : "bg-white text-gray-700 border-gray-300"}`}>
                      既存を置き換える
                    </button>
                    <button type="button" onClick={() => setReplaceId(null)}
                      className={`flex-1 text-[11.5px] font-bold py-2 rounded-lg border ${replaceId == null ? "bg-neutral-800 text-white border-neutral-800" : "bg-white text-gray-700 border-gray-300"}`}>
                      別件として登録
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-gray-400 mt-3 leading-relaxed">
                登録すると「未承認」で保存されます。ナレッジ画面で内容を確認して承認すると、AIが参照するようになります。
              </p>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-100 flex gap-2.5 items-center">
          {alreadyBookmarked && (
            <button onClick={onDelete} disabled={busy}
              className="text-sm py-2 px-4 rounded-lg border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-40">
              {busy ? "処理中…" : "ブックマーク削除"}
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-sm py-2 px-5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          {!alreadyBookmarked && (
            <button onClick={submit} disabled={busy || previewing}
              className="text-sm py-2 px-5 rounded-lg bg-red-600 text-white font-bold hover:bg-red-700 disabled:opacity-40">
              {busy ? "登録中…" : previewing ? "下見中…" : `${count}件で登録する`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
