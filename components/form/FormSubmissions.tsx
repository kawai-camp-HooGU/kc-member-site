"use client";
// ============================================================
// 問合せ（回答）一覧：フォーム別
//   対応状況・担当の管理／会員への紐付け／詳細／CSV出力
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import {
  fetchForm, fetchSubmissions, updateSubmission, deleteSubmission,
  submissionsToCsv, downloadCsv, fileUrl,
} from "../../lib/forms";
import type { FormDef, FormSubmission, SubmissionStatus } from "../../lib/models";
import { SUBMISSION_STATUS_LABEL } from "../../lib/models";
import { useConfirm } from "../common/ConfirmProvider";

const card = "bg-white rounded-xl border border-gray-200";
const sel = "border border-gray-200 rounded-lg px-2 py-1.5 text-[12.5px] bg-white focus:outline-none focus:border-red-400";

const STATUS_CLS: Record<SubmissionStatus, string> = {
  new:   "bg-amber-50 text-amber-700",
  doing: "bg-blue-50 text-blue-700",
  done:  "bg-emerald-50 text-emerald-700",
};

const fmt = (s: string) => (s ? s.replace("T", " ").slice(5, 16) : "—");

interface Props { formId: number; onBack: () => void; onEdit: () => void }

export function FormSubmissions({ formId, onBack, onEdit }: Props) {
  const confirm = useConfirm();
  const { members } = useMaster();
  const [form, setForm] = useState<FormDef | null>(null);
  const [subs, setSubs] = useState<FormSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"all" | SubmissionStatus>("all");
  const [who, setWho] = useState<"all" | "member" | "guest">("all");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState<FormSubmission | null>(null);

  const staff = useMemo(
    () => members.filter((m) => !m.isDeleted && (m.role === "管理者" || m.role === "オペレーター")),
    [members],
  );
  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const reload = useCallback(() => {
    Promise.all([fetchForm(formId), fetchSubmissions(formId)]).then(([f, s]) => {
      setForm(f); setSubs(s); setLoading(false);
    });
  }, [formId]);
  useEffect(() => { reload(); }, [reload]);

  const patch = async (id: number, p: { status?: SubmissionStatus; assigneeId?: number | null; memberId?: number | null }) => {
    await updateSubmission(id, p);
    setSubs((prev) => prev.map((s) => (s.id === id ? { ...s, ...p } as FormSubmission : s)));
    setDetail((d) => (d && d.id === id ? { ...d, ...p } as FormSubmission : d));
  };

  const remove = async (id: number) => {
    if (!(await confirm({ title: "回答を削除", message: "この回答を削除しますか？", confirmLabel: "削除する", danger: true }))) return;
    await deleteSubmission(id);
    setSubs((prev) => prev.filter((s) => s.id !== id));
    setDetail(null);
  };

  const rows = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return subs.filter((s) => {
      if (status !== "all" && s.status !== status) return false;
      if (who === "member" && s.memberId == null) return false;
      if (who === "guest" && s.memberId != null) return false;
      if (!kw) return true;
      const name = s.memberId != null ? byId.get(s.memberId)?.name ?? "" : s.guestName;
      const hay = [name, s.guestEmail, ...s.answers.map((a) => `${a.label} ${a.value} ${a.valueList.join(" ")}`)]
        .join(" ").toLowerCase();
      return hay.includes(kw);
    });
  }, [subs, status, who, q, byId]);

  // 一覧に出す設問（先頭2つ）＋残りはサマリー
  const cols = useMemo(() => {
    const fields = (form?.sections ?? []).flatMap((s) => s.fields).filter((f) => f.type !== "heading");
    return fields.slice(0, 2);
  }, [form]);

  const answerOf = (s: FormSubmission, fieldId: number) => {
    const a = s.answers.find((x) => x.fieldId === fieldId);
    if (!a) return "";
    if (a.valueList.length) return a.valueList.join("、");
    if (a.filePath) return `📎 ${a.filePath.split("/").pop()}`;
    return a.value;
  };
  const summary = (s: FormSubmission) => {
    const skip = new Set(cols.map((c) => c.id));
    return s.answers.filter((a) => a.fieldId != null && !skip.has(a.fieldId))
      .map((a) => (a.valueList.length ? a.valueList.join("、") : a.filePath ? "📎" : a.value))
      .filter(Boolean).join(" ／ ");
  };

  const exportCsv = () => {
    if (!form) return;
    downloadCsv(`${form.name}_回答_${new Date().toISOString().slice(0, 10)}.csv`, submissionsToCsv(form, rows, members));
  };

  const openFile = async (path: string) => {
    const url = await fileUrl(path);
    if (url) window.open(url, "_blank");
    else alert("ファイルを開けませんでした");
  };

  if (loading) return <div className="text-sm text-gray-400 py-10 text-center">読み込み中...</div>;
  if (!form) return <div className="text-sm text-gray-400 py-10 text-center">フォームが見つかりません</div>;

  const kpi = {
    total: subs.length,
    new: subs.filter((s) => s.status === "new").length,
    doing: subs.filter((s) => s.status === "doing").length,
    done: subs.filter((s) => s.status === "done").length,
  };

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm font-bold text-gray-600 bg-white border border-gray-200 rounded-lg px-3 py-2">
        ← フォーム一覧へ戻る
      </button>

      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-base font-extrabold text-gray-800">{form.name}</h1>
          <p className="text-[11.5px] text-gray-400 mt-0.5">
            /f/{form.slug}
            {form.deadlineAt && `　期限 ${form.deadlineAt.replace("T", " ")}`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={onEdit} className="px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-bold text-gray-600">フォームを編集</button>
          <button onClick={exportCsv} className="px-3 py-1.5 rounded-lg bg-neutral-800 text-white text-xs font-bold">⬇ CSV出力</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { n: kpi.total, l: "回答数", c: "text-gray-800" },
          { n: kpi.new, l: "未対応", c: "text-amber-600" },
          { n: kpi.doing, l: "対応中", c: "text-blue-600" },
          { n: kpi.done, l: "完了", c: "text-emerald-600" },
        ].map((b) => (
          <div key={b.l} className={`${card} p-3.5`}>
            <p className={`text-xl font-extrabold ${b.c}`}>{b.n}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">{b.l}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="回答者・回答内容で検索"
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-[12.5px] w-56 focus:outline-none focus:border-red-400" />
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as typeof status)}>
          <option value="all">対応状況：すべて</option>
          {(Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[]).map((s) => (
            <option key={s} value={s}>{SUBMISSION_STATUS_LABEL[s]}</option>
          ))}
        </select>
        <select className={sel} value={who} onChange={(e) => setWho(e.target.value as typeof who)}>
          <option value="all">回答者：すべて</option>
          <option value="member">会員のみ</option>
          <option value="guest">外部（未紐付け）</option>
        </select>
        <span className="text-[11.5px] text-gray-400 ml-auto">{rows.length} 件</span>
      </div>

      <div className={`${card} overflow-x-auto`}>
        <table className="w-full">
          <thead>
            <tr className="border-b border-gray-200">
              {["回答日時", "回答者", ...cols.map((c) => c.label || "設問"), "回答サマリー", "対応状況", "担当", ""].map((h, i) => (
                <th key={i} className="text-[11px] text-gray-400 font-bold text-left px-3 py-2.5 whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={cols.length + 5} className="text-center text-[12.5px] text-gray-400 py-10">回答はまだありません</td></tr>
            )}
            {rows.map((s) => {
              const m = s.memberId != null ? byId.get(s.memberId) : undefined;
              return (
                <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-3 py-2.5 text-[12px] text-gray-500 whitespace-nowrap">{fmt(s.submittedAt)}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-[12.5px] font-bold text-gray-800">{m?.name ?? s.guestName ?? "（不明）"}</p>
                    <p className="text-[10.5px] text-gray-400">{m ? `会員 ID:${m.id}` : "外部・未紐付け"}</p>
                  </td>
                  {cols.map((c) => (
                    <td key={c.id} className="px-3 py-2.5 text-[12.5px] text-gray-600 max-w-[160px] truncate">{answerOf(s, c.id)}</td>
                  ))}
                  <td className="px-3 py-2.5 text-[12px] text-gray-500 max-w-[220px] truncate">{summary(s)}</td>
                  <td className="px-3 py-2.5">
                    <select value={s.status} onChange={(e) => patch(s.id, { status: e.target.value as SubmissionStatus })}
                      className={`text-[11px] font-bold rounded-full px-2 py-1 border-0 ${STATUS_CLS[s.status]}`}>
                      {(Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[]).map((st) => (
                        <option key={st} value={st}>{SUBMISSION_STATUS_LABEL[st]}</option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2.5">
                    <select value={s.assigneeId ?? ""} onChange={(e) => patch(s.id, { assigneeId: e.target.value ? Number(e.target.value) : null })}
                      className="text-[11.5px] border border-gray-200 rounded-lg px-1.5 py-1 bg-white max-w-[110px]">
                      <option value="">未割当</option>
                      {staff.map((st) => <option key={st.id} value={st.id}>{st.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <button onClick={() => setDetail(s)} className="text-[11.5px] font-bold text-gray-600 border border-gray-200 rounded-lg px-2 py-1">詳細</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 詳細モーダル */}
      {detail && (
        <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2">
              <p className="text-sm font-extrabold">回答詳細</p>
              <span className={`text-[11px] font-bold rounded-full px-2 py-0.5 ${STATUS_CLS[detail.status]}`}>
                {SUBMISSION_STATUS_LABEL[detail.status]}
              </span>
              <button onClick={() => setDetail(null)} className="ml-auto text-gray-400 text-lg">✕</button>
            </div>

            <div className="p-4 overflow-y-auto">
              <div className="mb-3">
                <p className="text-[13px] font-bold text-gray-800">
                  {detail.memberId != null ? byId.get(detail.memberId)?.name ?? "（不明）" : detail.guestName || "（名前なし）"}
                </p>
                <p className="text-[11px] text-gray-400">
                  {detail.memberId != null ? `会員 ID:${detail.memberId}` : `外部・未紐付け ${detail.guestEmail}`}
                  　{detail.submittedAt.replace("T", " ").slice(0, 16)} 送信
                </p>
              </div>

              {detail.memberId == null && (
                <div className="mb-3 p-2.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2">
                  <span className="text-[11.5px] font-bold text-gray-600 whitespace-nowrap">会員に紐付ける</span>
                  <select className={`${sel} flex-1`} defaultValue=""
                    onChange={(e) => e.target.value && patch(detail.id, { memberId: Number(e.target.value) })}>
                    <option value="">（会員を選択）</option>
                    {members.filter((m) => !m.isDeleted).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}{m.email ? `（${m.email}）` : ""}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="divide-y divide-gray-100">
                {detail.answers.map((a, i) => (
                  <div key={i} className="py-2.5">
                    <p className="text-[11px] font-bold text-gray-400 mb-0.5">{a.label}</p>
                    {a.filePath ? (
                      <button onClick={() => openFile(a.filePath)} className="text-[13px] text-blue-600 font-bold underline">
                        📎 {a.filePath.split("/").pop()}
                      </button>
                    ) : (
                      <p className="text-[13.5px] text-gray-800 whitespace-pre-wrap">
                        {a.valueList.length ? a.valueList.join("、") : a.value || "—"}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-200 flex gap-2 bg-gray-50 rounded-b-2xl">
              <select value={detail.status} onChange={(e) => patch(detail.id, { status: e.target.value as SubmissionStatus })}
                className={`${sel} mr-auto`}>
                {(Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[]).map((st) => (
                  <option key={st} value={st}>{SUBMISSION_STATUS_LABEL[st]}</option>
                ))}
              </select>
              <button onClick={() => remove(detail.id)} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-[12.5px] font-bold text-red-600">削除</button>
              <button onClick={() => setDetail(null)} className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-[12.5px] font-bold">閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
