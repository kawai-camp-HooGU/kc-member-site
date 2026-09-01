"use client";
// ============================================================
// 体験の提出（運営）— 一覧 → 詳細 → 講評の送信
//   ・develop.md §7 の画面パターン①（一覧 → 詳細）。
//   ・権限は既存 bot_manage（新しい権限キーは作らない）。
//   ・空状態は brand.md §4 の3型に従う（0件＝達成 なので緑＋肯定文）。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { sanitizeHtml } from "../lib/ai/sanitize";
import { SUCCESS_CONFIG } from "../lib/constants";
import { Icon } from "../components/common/Icon";
import {
  loadSubmissions, loadArtifacts, loadReview, loadCriteria,
  saveReviewDraft, sendReview, signArtifactUrl,
  type ArtifactRow, type ReviewCriterion, type ReviewRow, type SubmissionRow,
} from "../lib/bot/trial/trialReviewAdmin";

export function TrialSubmissionsView() {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<SubmissionRow | null>(null);
  const [msg, setMsg] = useState("");

  const reload = useCallback(async () => {
    setLoading(true);
    setRows(await loadSubmissions());
    setLoading(false);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const pending = rows.filter((r) => !r.reviewed).length;

  if (selected) {
    return (
      <SubmissionDetail
        row={selected}
        onBack={() => { setSelected(null); void reload(); }}
        onMessage={setMsg}
      />
    );
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div>
        <h1 className="text-lg font-bold text-gray-900">体験の提出</h1>
        <p className="text-xs text-gray-500">
          体験版で作られた成果物と、それに対する講評を扱います。講評は担当者が書いて送ります。
        </p>
      </div>

      {msg && <div className={`text-sm ${SUCCESS_CONFIG.bg} border ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.text} rounded-lg px-3 py-2`}>{msg}</div>}

      {loading ? (
        // ⚠️ レイアウトは先に確定させる（brand.md §4）
        <div className="border border-gray-200 rounded-xl bg-white px-4 py-10 text-center text-sm text-gray-400">…</div>
      ) : rows.length === 0 ? (
        // 空状態①：対応が0件＝達成。灰色で沈めない（brand.md §4）
        <div className={`border ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.bg} rounded-xl px-4 py-8 text-center`}>
          <Icon name="check" size={22} className={SUCCESS_CONFIG.icon} />
          <p className={`text-sm font-bold ${SUCCESS_CONFIG.text} mt-2 mb-1`}>未対応の提出はありません</p>
          <p className={`text-xs ${SUCCESS_CONFIG.text} opacity-80`}>体験版URLから提出があると、ここに並びます。</p>
        </div>
      ) : (
        <>
          <div className="text-xs text-gray-500">
            未講評 <span className="font-bold text-gray-800">{pending}</span> 件 / 全 {rows.length} 件
          </div>
          <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="tbl-head">
                  <th className="text-left px-3 py-2 font-semibold">提出日時</th>
                  <th className="text-left px-3 py-2 font-semibold">体験</th>
                  <th className="text-left px-3 py-2 font-semibold">配布</th>
                  <th className="text-left px-3 py-2 font-semibold">回答者</th>
                  <th className="text-left px-3 py-2 font-semibold">調整</th>
                  <th className="text-left px-3 py-2 font-semibold">講評</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-gray-100">
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                      {r.submitted_at ? r.submitted_at.slice(0, 16).replace("T", " ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-800">{r.scenarioTitle}</td>
                    <td className="px-3 py-2 text-gray-500">{r.linkLabel || "（無題）"}</td>
                    <td className="px-3 py-2 text-gray-600">{r.memberName || "—"}</td>
                    <td className="px-3 py-2 text-gray-500">{r.revise_count} 回</td>
                    <td className="px-3 py-2">
                      {r.reviewed
                        ? <span className={`text-xs rounded-full px-2 py-0.5 ${SUCCESS_CONFIG.bg} ${SUCCESS_CONFIG.text} font-bold`}>送信済</span>
                        : <span className="text-xs rounded-full px-2 py-0.5 bg-red-50 text-red-700 font-bold">未講評</span>}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => setSelected(r)} className="text-sm text-red-700 font-bold">開く</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── 詳細：成果物と調整の履歴を見ながら講評を書く ──────────────
function SubmissionDetail({
  row, onBack, onMessage,
}: {
  row: SubmissionRow;
  onBack: () => void;
  onMessage: (s: string) => void;
}) {
  const [artifacts, setArtifacts] = useState<ArtifactRow[]>([]);
  const [criteria, setCriteria] = useState<ReviewCriterion[]>([]);
  const [review, setReview] = useState<ReviewRow | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const [a, c, r] = await Promise.all([
        loadArtifacts(row.id), loadCriteria(row.scenario_id), loadReview(row.id),
      ]);
      setArtifacts(a);
      setCriteria(c);
      setReview(r);
      setScores(r?.scores ?? {});
      setComment(r?.comment ?? "");
      const last = a[a.length - 1];
      if (last?.storage_path) setImgUrl(await signArtifactUrl(last.storage_path));
    })();
  }, [row.id, row.scenario_id]);

  const final = artifacts[artifacts.length - 1] ?? null;
  const sent = review?.sent_at != null;

  const safeHtml = useMemo(
    () => (final && (final.kind === "html" || final.kind === "pdf") ? sanitizeHtml(final.body).html : ""),
    [final],
  );

  const onSave = async () => {
    if (!final) return;
    setBusy(true); setError("");
    const ok = await saveReviewDraft({ runId: row.id, artifactId: final.id, scores, comment });
    setBusy(false);
    if (ok) { setReview(await loadReview(row.id)); onMessage("下書きを保存しました"); }
    else setError("保存できませんでした");
  };

  const onSend = async () => {
    setBusy(true); setError("");
    const r = await sendReview(row.id);
    setBusy(false);
    if (r.ok) { onMessage("講評を送信しました"); onBack(); }
    else setError(r.error ?? "送信できませんでした");
  };

  return (
    <div className="max-w-5xl space-y-4">
      <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-800">← 一覧へ戻る</button>

      <div>
        <h1 className="text-lg font-bold text-gray-900">{row.scenarioTitle}</h1>
        <p className="text-xs text-gray-500">
          {row.linkLabel || "（無題）"} ／ {row.memberName || "回答者不明"} ／
          提出 {row.submitted_at ? row.submitted_at.slice(0, 16).replace("T", " ") : "—"} ／
          作成 {row.gen_count} 回・調整 {row.revise_count} 回
        </p>
      </div>

      {error && <div className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{error}</div>}
      {sent && (
        <div className={`text-sm ${SUCCESS_CONFIG.bg} border ${SUCCESS_CONFIG.border} ${SUCCESS_CONFIG.text} rounded-lg px-3 py-2`}>
          この講評は {review?.sent_at?.slice(0, 16).replace("T", " ")} に送信済みです。内容は変更できません。
        </div>
      )}

      <div className="grid grid-cols-[1fr_360px] gap-4 max-[900px]:grid-cols-1">
        {/* 左：成果物と調整の履歴 */}
        <div className="space-y-3">
          <div className="border border-gray-200 rounded-xl bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-gray-100 text-xs text-gray-500">
              提出された成果物{final ? `（rev.${final.revision}）` : ""}
            </div>
            <div className="max-h-[420px] overflow-y-auto">
              {!final ? (
                <div className="px-4 py-10 text-center text-sm text-gray-400">成果物がありません</div>
              ) : final.kind === "image" ? (
                imgUrl
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={imgUrl} alt="成果物" className="w-full object-contain bg-gray-50" />
                  : <div className="px-4 py-10 text-center text-sm text-gray-400">…</div>
              ) : final.kind === "text" ? (
                <pre className="p-4 text-[13px] leading-7 text-gray-800 whitespace-pre-wrap break-words font-sans">{final.body}</pre>
              ) : (
                <div className="p-4 text-[13px] leading-7 text-gray-800 content-rich"
                  dangerouslySetInnerHTML={{ __html: safeHtml }} />
              )}
            </div>
          </div>

          <div className="border border-gray-200 rounded-xl bg-white p-3">
            <div className="text-xs text-gray-500 mb-2">つくり直しの経緯</div>
            {artifacts.length <= 1 ? (
              <p className="text-xs text-gray-400 m-0">一度で仕上げています（調整なし）。</p>
            ) : (
              <ol className="text-xs text-gray-600 space-y-1 pl-4 list-decimal m-0">
                {artifacts.map((a) => (
                  <li key={a.id}>
                    <span className="font-bold text-gray-800">rev.{a.revision}</span>
                    {a.instruction ? `：${a.instruction}` : "：最初の作成"}
                  </li>
                ))}
              </ol>
            )}
          </div>

          {Object.keys(row.inputs ?? {}).length > 0 && (
            <div className="border border-gray-200 rounded-xl bg-white p-3">
              <div className="text-xs text-gray-500 mb-2">体験者が入力した内容</div>
              <dl className="text-xs text-gray-700 space-y-1 m-0">
                {Object.entries(row.inputs).map(([k, v]) => (
                  <div key={k} className="flex gap-2">
                    <dt className="text-gray-400 shrink-0">{k}</dt>
                    <dd className="m-0">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>

        {/* 右：講評の記入欄 */}
        <div className="border border-gray-200 rounded-xl bg-white p-4 space-y-3 h-fit">
          <h2 className="text-sm font-bold text-gray-800 m-0">講評を書く</h2>

          {criteria.length > 0 && (
            <div className="space-y-2">
              {criteria.map((c) => (
                <div key={c.key} className="flex items-center gap-2">
                  <span className="text-xs text-gray-600 flex-1">{c.label}</span>
                  <select
                    value={scores[c.key] ?? ""}
                    disabled={sent}
                    onChange={(e) => setScores((s) => ({ ...s, [c.key]: Number(e.target.value) }))}
                    className="border border-gray-300 rounded-lg px-2 py-1 text-sm disabled:bg-gray-50"
                  >
                    <option value="">—</option>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )}

          <div>
            <label className="block text-xs text-gray-600 mb-1">
              講評の本文（そのままメールで届きます）
            </label>
            <textarea
              value={comment}
              disabled={sent}
              onChange={(e) => setComment(e.target.value)}
              rows={10}
              placeholder="褒めてから、直すと良くなる点を2つだけ挙げる。専門用語を使わない。"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm disabled:bg-gray-50"
            />
          </div>

          {!sent && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void onSave()}
                disabled={busy || !comment.trim()}
                className="text-sm bg-white border border-gray-300 text-gray-700 rounded-lg px-4 py-1.5 font-bold hover:bg-gray-50 disabled:opacity-50"
              >
                下書きを保存
              </button>
              <button
                onClick={() => {
                  // ⚠️ 利用者へメールが飛ぶ。送る前に必ず確認を挟む（誤爆させない）
                  if (window.confirm("この講評を回答者へメールで送ります。よろしいですか？")) void onSend();
                }}
                disabled={busy || !review || !comment.trim()}
                className="text-sm bg-red-600 text-white rounded-lg px-4 py-1.5 font-bold hover:bg-red-700 disabled:opacity-50"
              >
                講評を送る
              </button>
            </div>
          )}
          {!sent && !review && (
            <p className="text-[11px] text-gray-400 m-0">先に下書きを保存すると送信できます。</p>
          )}
        </div>
      </div>
    </div>
  );
}
