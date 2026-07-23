"use client";
// ============================================================
// 設定 ＞ AIプロンプト（管理者のみ）
//   各AI機能の「役割・方針」だけを編集する。出力契約は固定（表示のみ）。
//   保存前にプレビュー実行で試走して出力を確認できる。
// ============================================================
import { useEffect, useState } from "react";
import { aiPromptList, aiPromptSave, aiPromptPreview } from "../../lib/aiClient";
import { fmtJst } from "../../lib/dateFmt";
import { errMessage } from "../../lib/errors";
import type { AiPromptItem } from "../../lib/ai/types";

import { FIELD_INPUT } from "../../lib/constants";
type SubTab = "role" | "contract";

const taCls =
  `${FIELD_INPUT} font-mono leading-relaxed`;

export function AiPromptsTab() {
  const [items, setItems] = useState<AiPromptItem[]>([]);
  const [sel, setSel] = useState<string>("");
  const [sub, setSub] = useState<SubTab>("role");
  const [body, setBody] = useState("");
  const [sample, setSample] = useState("");
  const [preview, setPreview] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"" | "preview" | "save">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const cur = items.find((i) => i.feature === sel) ?? null;
  const dirty = cur ? body !== cur.body : false;

  useEffect(() => {
    (async () => {
      try {
        const list = await aiPromptList();
        setItems(list);
        if (list[0]) { setSel(list[0].feature); setBody(list[0].body); }
      } catch (e) {
        setMsg({ ok: false, text: errMessage(e) });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const pick = (feature: string) => {
    const it = items.find((i) => i.feature === feature);
    if (!it) return;
    setSel(feature);
    setBody(it.body);
    setSub("role");
    setPreview("");
    setMsg(null);
  };

  const runPreview = async () => {
    if (!cur) return;
    setBusy("preview"); setMsg(null); setPreview("");
    try {
      const r = await aiPromptPreview({ feature: cur.feature, body, sample });
      setPreview(r.preview || "（出力が空でした）");
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    } finally {
      setBusy("");
    }
  };

  const save = async () => {
    if (!cur) return;
    setBusy("save"); setMsg(null);
    try {
      await aiPromptSave({ feature: cur.feature, body });
      setItems((prev) => prev.map((i) =>
        i.feature === cur.feature ? { ...i, body, saved: true, updatedAt: new Date().toISOString() } : i));
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

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-xl font-extrabold text-gray-800">AIプロンプト</h1>
        <p className="text-xs text-gray-400 mt-1">
          各AI機能の「役割・方針」を編集できます。出力形式（JSON等）は壊れると機能が停止するため固定です。
          保存前に「プレビュー実行」で出力を確認してください。
        </p>
      </div>

      <div className="flex gap-4 items-start">
        {/* 左：機能リスト */}
        <div className="w-48 shrink-0 bg-white border border-gray-200 rounded-xl overflow-hidden">
          {items.map((i) => (
            <button key={i.feature} onClick={() => pick(i.feature)}
              className={`w-full text-left px-4 py-2.5 text-sm border-b border-gray-100 last:border-b-0 transition-colors ${
                sel === i.feature ? "bg-red-50 text-red-600 font-bold border-l-2 border-l-red-500" : "text-gray-600 hover:bg-gray-50"
              }`}>
              {i.label}
              {!i.saved && <span className="ml-1.5 text-[10px] text-gray-400">既定</span>}
            </button>
          ))}
        </div>

        {/* 右：編集 */}
        <div className="flex-1 min-w-0 bg-white border border-gray-200 rounded-xl p-4 space-y-3">
          {cur && (
            <>
              <div className="flex items-center gap-2 border-b border-gray-100 pb-2">
                <button onClick={() => setSub("role")}
                  className={`px-3 py-1 text-sm rounded-md ${sub === "role" ? "bg-red-50 text-red-600 font-bold" : "text-gray-500 hover:bg-gray-50"}`}>
                  役割・方針（編集可）
                </button>
                <button onClick={() => setSub("contract")}
                  className={`px-3 py-1 text-sm rounded-md ${sub === "contract" ? "bg-gray-100 text-gray-700 font-bold" : "text-gray-400 hover:bg-gray-50"}`}>
                  出力契約（固定）
                </button>
              </div>

              {sub === "role" ? (
                <>
                  <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={12}
                    className={taCls} placeholder="この機能の役割・厳守ルール・トーンなど" />
                  <div className="text-[11px] text-gray-400">
                    {dirty ? "未保存の変更があります。" : cur.saved ? `保存済み（${fmtJst(cur.updatedAt)}）` : "既定値を表示中（未保存）"}
                  </div>

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
                    <button onClick={save} disabled={busy !== "" || !dirty}
                      className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50">
                      {busy === "save" ? "保存中…" : "保存"}
                    </button>
                    <button onClick={resetDefault} disabled={busy !== ""}
                      className="px-3 py-1.5 rounded-lg bg-white border border-gray-300 text-gray-600 text-sm font-semibold hover:bg-gray-50 disabled:opacity-50">
                      既定に戻す
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-gray-400">
                    この部分はコード側で固定されており、画面からは編集できません（出力形式・タグのホワイトリスト・差し込み変数など）。
                  </p>
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap text-gray-500 max-h-96 overflow-auto">
                    {cur.contract || "（この機能は固定の出力契約を持ちません）"}
                  </div>
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
