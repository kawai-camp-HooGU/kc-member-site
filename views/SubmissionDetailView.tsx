"use client";
// ============================================================
// 回答詳細画面（1件・専用画面）
//   /ops/submissions/[id]
//
//   BEFORE：フォーム画面（FormSubmissions）内のモーダルでしか見られなかった。
//   AFTER ：回答1件に固有のURLを持つ独立画面。
//           メンバー詳細の「フォーム回答状況 → 詳細」から遷移する。
//           URL が固定なので、チャットやメールで共有もできる。
//
//   ⚠️ MasterContext が無い（別ウィンドウ）ので、担当者・会員は単体取得する。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, toMember } from "../lib/supabase";
import { fetchSubmission, updateSubmission, deleteSubmission, fileUrl } from "../lib/forms";
import type { FormDef, FormSubmission, SubmissionStatus, Member } from "../lib/models";
import { SUBMISSION_STATUS_LABEL } from "../lib/models";
import { ConfirmDialog } from "../components/common/ConfirmDialog";
import { useToast } from "../components/common/ToastProvider";

const card = "bg-white border border-gray-200 rounded-xl";
const sel  = "border border-gray-200 rounded-lg px-2.5 py-2 text-[12.5px] bg-white focus:outline-none focus:border-red-400";

const STATUS_CLS: Record<SubmissionStatus, string> = {
  new:   "bg-amber-50 text-amber-700 border-amber-200",
  doing: "bg-blue-50 text-blue-700 border-blue-200",
  done:  "bg-emerald-50 text-emerald-700 border-emerald-200",
};

const fmt = (s: string) => (s ? s.replace("T", " ").slice(0, 16) : "—");

export function SubmissionDetailView({ submissionId }: { submissionId: number }) {
  const toast = useToast();
  const [sub, setSub]     = useState<FormSubmission | null>(null);
  const [form, setForm]   = useState<FormDef | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDel, setConfirmDel] = useState(false);

  const load = useCallback(async () => {
    const [r, { data: rows }] = await Promise.all([
      fetchSubmission(submissionId),
      supabase.from("members_visible").select("*").eq("is_deleted", false).order("name"),
    ]);
    setMembers((rows ?? []).map(toMember));
    if (r) { setSub(r.submission); setForm(r.form); }
    setLoading(false);
  }, [submissionId]);

  useEffect(() => { load().catch(() => setLoading(false)); }, [load]);

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const staff = useMemo(
    () => members.filter((m) => m.role === "管理者" || m.role === "オペレーター"),
    [members],
  );

  const patch = async (p: { status?: SubmissionStatus; assigneeId?: number | null; memberId?: number | null }) => {
    if (!sub) return;
    await updateSubmission(sub.id, p);
    setSub({ ...sub, ...p } as FormSubmission);
    toast.success("更新しました");
  };

  const remove = async () => {
    if (!sub) return;
    await deleteSubmission(sub.id);
    setConfirmDel(false);
    toast.success("削除しました");
    setTimeout(() => { if (window.opener) window.close(); else window.history.back(); }, 600);
  };

  const openFile = async (path: string) => {
    const url = await fileUrl(path);
    if (url) window.open(url, "_blank");
    else toast.error("ファイルを開けませんでした");
  };

  if (loading) return <div className="min-h-screen grid place-items-center text-sm text-gray-400">読み込み中...</div>;
  if (!sub) return <div className="min-h-screen grid place-items-center text-sm text-gray-500">回答が見つかりません。</div>;

  const member = sub.memberId != null ? byId.get(sub.memberId) : undefined;

  // フォーム定義の設問順で並べる（定義が取れない場合は回答の保存順）
  const ordered = form
    ? form.sections
        .flatMap((s) => s.fields)
        .map((f) => sub.answers.find((a) => a.fieldId === f.id))
        .filter((a): a is NonNullable<typeof a> => Boolean(a))
    : sub.answers;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 py-6">

        {/* ヘッダー */}
        <div className="flex items-center gap-3 flex-wrap mb-5">
          <button onClick={() => { if (window.opener) window.close(); else window.history.back(); }}
            className="w-9 h-9 rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50" title="戻る">←</button>
          <div className="min-w-0">
            <h1 className="text-lg font-extrabold text-gray-800 leading-tight">回答詳細</h1>
            <p className="text-[12px] text-gray-500 mt-0.5">
              {form?.name ?? "（削除されたフォーム）"}
              {form?.slug && <span className="text-gray-400">　/f/{form.slug}</span>}
            </p>
          </div>
          <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${STATUS_CLS[sub.status]}`}>
            {SUBMISSION_STATUS_LABEL[sub.status]}
          </span>
        </div>

        {/* 回答者・メタ */}
        <div className={`${card} p-4 mb-4`}>
          <div className="flex items-start gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-gray-800">
                {member?.name ?? sub.guestName ?? "（名前なし）"}
              </p>
              <p className="text-[11.5px] text-gray-400 mt-0.5">
                {sub.memberId != null
                  ? <>会員 ID:{sub.memberId}
                      <a href={`/ops/members/${sub.memberId}`} className="text-blue-600 hover:underline">メンバー詳細を開く</a></>
                  : <>外部・未紐付け　{sub.guestEmail}</>}
              </p>
              <p className="text-[11.5px] text-gray-400 mt-0.5">
                送信日時：{fmt(sub.submittedAt)}　／　送信チャネル：{sub.channel}
              </p>
            </div>
          </div>

          {/* 未紐付けなら会員に紐付ける */}
          {sub.memberId == null && (
            <div className="mt-3 p-2.5 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2 flex-wrap">
              <span className="text-[11.5px] font-bold text-gray-600 whitespace-nowrap">会員に紐付ける</span>
              <select className={`${sel} flex-1 min-w-[180px]`} defaultValue=""
                onChange={(e) => e.target.value && patch({ memberId: Number(e.target.value) })}>
                <option value="">（会員を選択）</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}{m.email ? `（${m.email}）` : ""}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* 回答内容 */}
        <div className={`${card} mb-4`}>
          <div className="px-4 py-3 border-b border-gray-100 font-bold text-sm">回答内容</div>
          <div className="px-4 divide-y divide-gray-100">
            {ordered.length === 0 && (
              <p className="py-8 text-center text-[12.5px] text-gray-400">回答項目がありません</p>
            )}
            {ordered.map((a, i) => (
              <div key={i} className="py-3">
                <p className="text-[11px] font-bold text-gray-400 mb-1">{a.label}</p>
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

        {/* 対応状況 */}
        <div className={`${card} p-4 flex items-center gap-3 flex-wrap`}>
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">対応状況</label>
            <select className={sel} value={sub.status}
              onChange={(e) => patch({ status: e.target.value as SubmissionStatus })}>
              {(Object.keys(SUBMISSION_STATUS_LABEL) as SubmissionStatus[]).map((st) => (
                <option key={st} value={st}>{SUBMISSION_STATUS_LABEL[st]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-bold text-gray-500 block mb-1">担当</label>
            <select className={sel} value={sub.assigneeId ?? ""}
              onChange={(e) => patch({ assigneeId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">未割当</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="flex-1" />
          <button onClick={() => setConfirmDel(true)}
            className="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-semibold hover:bg-red-50">
            この回答を削除
          </button>
        </div>
      </div>

      {confirmDel && (
        <ConfirmDialog
          message="この回答を削除しますか？（元に戻せません）"
          onCancel={() => setConfirmDel(false)}
          onConfirm={remove}
        />
      )}
    </div>
  );
}
