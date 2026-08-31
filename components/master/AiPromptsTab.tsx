"use client";
// ============================================================
// 設定 ＞ AIプロンプト（管理者のみ）
//   ・AI機能   … 各機能の「役割・方針」。出力契約は固定（表示のみ）
//   ・共通パーツ … {{part:key}} で本文へ差し込むブロック（REQ-034）
//
//   ★ 1つのパーツが複数機能に効く。編集画面には必ず「参照している機能」を出し、
//     影響範囲が見えないまま保存させないこと。
//   ★ 視点（事務局／ホルダー）は排他。プレビューは両方を確認してから保存する。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { aiPromptList, aiPromptSave, aiPromptPreview } from "../../lib/aiClient";
import { fmtJst } from "../../lib/dateFmt";
import { errMessage } from "../../lib/errors";
import { AI_VIEWS } from "../../lib/ai/types";
import type {
  AiPromptItem, AiPromptPartItem, AiView, AiFeature,
} from "../../lib/ai/types";

import { FIELD_INPUT } from "../../lib/constants";

type Sel = { kind: "feature"; id: AiFeature } | { kind: "part"; id: string };
type SubTab = "role" | "expanded" | "contract" | "used";

const taCls = `${FIELD_INPUT} font-mono leading-relaxed`;
const PART_RE = /\{\{part:([a-z0-9_]{1,32})\}\}/g;

/** 役割・方針の推奨レンジ（展開後の字数で見る） */
const CHAR_MIN = 300;
const CHAR_MAX = 1500;

export function AiPromptsTab() {
  const [items, setItems] = useState<AiPromptItem[]>([]);
  const [parts, setParts] = useState<AiPromptPartItem[]>([]);
  const [sel, setSel] = useState<Sel | null>(null);
  const [sub, setSub] = useState<SubTab>("role");
  const [body, setBody] = useState("");
  const [sample, setSample] = useState("");
  const [view, setView] = useState<AiView>("support");
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const curFeature = sel?.kind === "feature" ? items.find((i) => i.feature === sel.id) ?? null : null;
  const curPart = sel?.kind === "part" ? parts.find((p) => p.key === sel.id) ?? null : null;
  const cur = curFeature ?? curPart;
  const dirty = cur ? body !== cur.body : false;

  useEffect(() => {
    (async () => {
      try {
        const { items: list, parts: ps } = await aiPromptList();
        setItems(list);
        setParts(ps);
        if (list[0]) { setSel({ kind: "feature", id: list[0].feature }); setBody(list[0].body); }
      } catch (e) {
        setMsg({ ok: false, text: errMessage(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /** {{part:key}} を画面側で展開する（サーバーと同じ解決順・同じ本文を見ている） */
  const expand = useMemo(() => (text: string, v: AiView) =>
    text
      .replace(PART_RE, (_m, k: string) => {
        const key = k === "view" ? (v === "holder" ? "view_holder" : "view_support") : k;
        // 編集中のパーツは、その場の本文で展開して見せる
        if (curPart && curPart.key === key) return body;
        return parts.find((p) => p.key === key)?.body ?? "";
      })
      .replace(/\n{3,}/g, "\n\n"),
  [parts, curPart, body]);

  const expanded = curFeature ? expand(body, view) : "";
  const unknown = useMemo(() => {
    const keys = Array.from(body.matchAll(PART_RE)).map((m) =>
      m[1] === "view" ? "view_support" : m[1]);
    return Array.from(new Set(keys)).filter((k) => !parts.some((p) => p.key === k));
  }, [body, parts]);

  const pick = (s: Sel) => {
    const it = s.kind === "feature"
      ? items.find((i) => i.feature === s.id)
      : parts.find((p) => p.key === s.id);
    if (!it) return;
    setSel(s);
    setBody(it.body);
    setSub(s.kind === "feature" ? "role" : "role");
    setPreview("");
    setMsg(null);
  };

  const runPreview = async () => {
    if (!sel) return;
    setBusy("preview"); setMsg(null); setPreview("");
    try {
      const r = await aiPromptPreview(
        sel.kind === "part"
          ? { kind: "part", key: sel.id, body, sample, view }
          : { kind: "feature", feature: sel.id, body, sample, view },
      );
      setPreview(r.preview || "（出力が空でした）");
      if (r.unknownKeys.length > 0) {
        setMsg({ ok: false, text: `展開できないパーツがあります: ${r.unknownKeys.join(" / ")}` });
      }
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!sel) return;
    setBusy("save"); setMsg(null);
    try {
      await aiPromptSave(
        sel.kind === "part"
          ? { kind: "part", key: sel.id, body }
          : { kind: "feature", feature: sel.id, body },
      );
      const now = new Date().toISOString();
      if (sel.kind === "part") {
        setParts((prev) => prev.map((p) =>
          p.key === sel.id ? { ...p, body, saved: true, updatedAt: now } : p));
      } else {
        setItems((prev) => prev.map((i) =>
          i.feature === sel.id ? { ...i, body, saved: true, updatedAt: now } : i));
      }
      setMsg({ ok: true, text: "保存しました。次回のAI呼び出しから反映されます。" });
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const resetDefault = () => {
    if (!cur) return;
    setBody(cur.defaultBody);
    setMsg({ ok: true, text: "既定値に戻しました（保存するまで反映されません）。" });
  };

  if (loading) return <div className="px-4 py-12 text-center text-sm text-gray-400">読み込み中…</div>;

  const charState = (n: number) =>
    n < CHAR_MIN ? { cls: "text-amber-600", note: "短すぎる可能性があります" }
      : n > CHAR_MAX ? { cls: "text-red-600", note: "長すぎます。共通パーツへ寄せてください" }
        : { cls: "text-teal-600", note: "推奨内" };

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800">AIプロンプト</h1>
        <p className="text-xs text-gray-400 mt-1">
          各AI機能の「役割・方針」と、そこへ差し込む「共通パーツ」を編集できます。
          出力形式（JSON等）は壊れると機能が停止するため固定です。保存前に「プレビュー実行」で出力を確認してください。
        </p>
      </div>

      <div className="flex gap-4 items-start">
        {/* 左：機能リスト ＋ 共通パーツ */}
        <div className="w-52 shrink-0 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <div className="px-4 py-1.5 text-[10px] font-bold tracking-wider text-gray-400 bg-gray-50 border-b border-gray-200">
            AI機能
          </div>
          {items.map((i) => (
            <button key={i.feature} onClick={() => pick({ kind: "feature", id: i.feature })}
              className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 transition-colors ${
                sel?.kind === "feature" && sel.id === i.feature
                  ? "bg-red-50 text-red-600 font-bold border-l-2 border-l-red-500"
                  : "text-gray-600 hover:bg-gray-50"
              }`}>
              {i.label}
              {!i.saved && <span className="ml-1.5 text-[10px] text-gray-400">既定</span>}
            </button>
          ))}

          <div className="px-4 py-1.5 text-[10px] font-bold tracking-wider text-gray-400 bg-gray-50 border-y border-gray-200">
            共通パーツ
          </div>
          {parts.map((p) => (
            <button key={p.key} onClick={() => pick({ kind: "part", id: p.key })}
              className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-b-0 transition-colors ${
                sel?.kind === "part" && sel.id === p.key
                  ? "bg-red-50 text-red-600 font-bold border-l-2 border-l-red-500"
                  : "text-gray-600 hover:bg-gray-50"
              }`}>
              {p.label}
              {!p.saved && <span className="ml-1.5 text-[10px] text-gray-400">既定</span>}
            </button>
          ))}
        </div>

        {/* 右：編集 */}
        <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {cur && (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2 flex-wrap">
                <button onClick={() => setSub("role")}
                  className={`px-3 py-1 text-sm rounded-md ${sub === "role" ? "bg-red-50 text-red-600 font-bold" : "text-gray-500 hover:bg-gray-50"}`}>
                  {curPart ? "本文（編集可）" : "役割・方針（編集可）"}
                </button>
                {curFeature && (
                  <button onClick={() => setSub("expanded")}
                    className={`px-3 py-1 text-sm rounded-md ${sub === "expanded" ? "bg-red-50 text-red-600 font-bold" : "text-gray-500 hover:bg-gray-50"}`}>
                    展開後の全文
                  </button>
                )}
                {curFeature && (
                  <button onClick={() => setSub("contract")}
                    className={`px-3 py-1 text-sm rounded-md ${sub === "contract" ? "bg-gray-100 text-gray-700 font-bold" : "text-gray-400 hover:bg-gray-50"}`}>
                    出力契約（固定）
                  </button>
                )}
                {curPart && (
                  <button onClick={() => setSub("used")}
                    className={`px-3 py-1 text-sm rounded-md ${sub === "used" ? "bg-gray-100 text-gray-700 font-bold" : "text-gray-400 hover:bg-gray-50"}`}>
                    参照している機能
                  </button>
                )}

                {/* 視点：プレビューと展開表示に効く */}
                <div className="ml-auto flex items-center gap-1.5">
                  <span className="text-[10px] text-gray-400 font-bold">視点</span>
                  <div className="flex border border-gray-200 rounded-lg overflow-hidden">
                    {AI_VIEWS.map((v) => (
                      <button key={v.v} onClick={() => setView(v.v)} title={v.hint}
                        className={`px-3 py-1 text-[11px] font-bold ${
                          view === v.v ? "bg-red-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"
                        }`}>
                        {v.l}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {sub === "role" && (
                <>
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14}
                    className={taCls}
                    placeholder={curPart ? "この共通ブロックの本文" : "この機能の役割・厳守ルール・トーンなど"} />

                  <div className="flex items-center gap-3 flex-wrap text-[11px]">
                    <span className="text-gray-400">
                      {dirty ? "未保存の変更があります。" : cur.saved ? `保存済み（${fmtJst(cur.updatedAt)}）` : "既定値を表示中（未保存）"}
                    </span>
                    {curPart && (
                      <span className="text-gray-500">
                        {body.length}字
                        {curPart.usedBy.length > 0 && (
                          <>　参照元：<b className="text-red-700">{curPart.usedBy.join("・")}</b></>
                        )}
                      </span>
                    )}
                    {curFeature && (() => {
                      const st = charState(expanded.length);
                      return (
                        <span className={`font-bold ${st.cls}`}>
                          展開後 {expanded.length}字（{st.note}）
                        </span>
                      );
                    })()}
                  </div>

                  {unknown.length > 0 && (
                    <div className="text-[11px] px-3 py-2 rounded-lg bg-red-50 text-red-600">
                      存在しないパーツを参照しています：{unknown.join(" / ")}
                      　このままでは空文字に置き換わります（保存はできません）。
                    </div>
                  )}

                  {/* プレビュー */}
                  <div className="border-t border-gray-100 pt-3 space-y-2">
                    <label className="block text-xs font-bold text-gray-600">プレビュー用のサンプル入力（任意）</label>
                    <textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={2}
                      className={FIELD_INPUT}
                      placeholder="例：請求書の再発行はできますか？" />
                    {preview && (
                      <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-gray-700 max-h-64 overflow-auto">
                        {preview}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={runPreview} disabled={busy !== ""}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-semibold hover:bg-teal-700 disabled:opacity-50">
                      {busy === "preview" ? "実行中…" : "▶ プレビュー実行"}
                    </button>
                    <button onClick={save} disabled={busy !== "" || !dirty || unknown.length > 0}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                      {busy === "save" ? "保存中…" : "保存"}
                    </button>
                    <button onClick={resetDefault} disabled={busy !== ""}
                      className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                      既定に戻す
                    </button>
                    <span className="text-[10.5px] text-gray-400 ml-1">
                      視点は両方プレビューしてから保存してください
                    </span>
                  </div>
                </>
              )}

              {sub === "expanded" && curFeature && (
                <>
                  <p className="text-[11px] text-gray-400">
                    共通パーツを差し込んだあとの「役割・方針」です。ここに出力契約が続いてAIへ送られます。
                    パーツ部分はそれぞれのパーツ画面で編集します。
                  </p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-gray-700 max-h-[28rem] overflow-auto">
                    {expanded}
                  </div>
                </>
              )}

              {sub === "contract" && curFeature && (
                <>
                  <p className="text-[11px] text-gray-400">
                    この部分はコード側で固定されており、画面からは編集できません（出力形式・タグのホワイトリスト・差し込み変数など）。
                  </p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-gray-500 max-h-96 overflow-auto">
                    {curFeature.contract || "（この機能は固定の出力契約を持ちません）"}
                  </div>
                </>
              )}

              {sub === "used" && curPart && (
                <>
                  <p className="text-[11px] text-gray-400">
                    このパーツを編集すると、次の機能の出力がまとめて変わります。
                  </p>
                  {curPart.usedBy.length === 0 ? (
                    <div className="text-xs text-gray-400 py-6 text-center">
                      どの機能からも参照されていません。機能の本文に
                      <code className="mx-1">{`{{part:${curPart.key}}}`}</code>
                      と書くと差し込まれます。
                    </div>
                  ) : (
                    <ul className="text-sm text-gray-700 list-disc pl-5">
                      {curPart.usedBy.map((l) => <li key={l}>{l}</li>)}
                    </ul>
                  )}
                </>
              )}

              {msg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${msg.ok ? "bg-teal-50 text-teal-700" : "bg-red-50 text-red-600"}`}>
                  {msg.text}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
