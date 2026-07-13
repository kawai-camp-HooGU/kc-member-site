"use client";
// ============================================================
// イベント詳細（カレンダーのチップをクリックしたときに開く）
//   会員 … 内容＋紐付けフォームへの導線（未回答／回答済を出し分け）
//   運営 … 加えて回答状況（回答数・未回答者・リマインド導線）
// ============================================================
import { useMemo } from "react";
import { useMaster } from "../../hooks/useMaster";
import { eventFormStat, eventRangeLabel } from "../../lib/events";
import type { FormBrief } from "../../lib/events";
import { EVENT_KIND_LABEL } from "../../lib/models";
import type { CalEvent } from "../../lib/models";
import type { AttrIndex } from "../../lib/members";
import { attrLabel } from "../../lib/members";
import { Icon } from "../common/Icon";

interface Props {
  event: CalEvent;
  form: FormBrief | null;
  answered: Map<number, Set<number>>;
  index: AttrIndex;
  isOps: boolean;
  onClose: () => void;
  onEdit?: (e: CalEvent) => void;
}

export function EventDetailPopup({ event: e, form, answered, index, isOps, onClose, onEdit }: Props) {
  const { members, permission } = useMaster();

  // 集計対象は「運営を除いた会員」（対象者＝この予定を見られる人）
  const audience = useMemo(
    () => members.filter((m) => !m.isDeleted && m.role !== "管理者" && m.role !== "オペレーター"),
    [members],
  );
  const stat = useMemo(
    () => (form ? eventFormStat(e, audience, index, answered) : null),
    [e, form, audience, index, answered],
  );

  const iAnswered = form != null && permission.myId != null && (answered.get(form.id)?.has(permission.myId) ?? false);
  const formUrl = form ? `/f/${form.slug}` : "";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] flex flex-col overflow-hidden"
        onClick={(ev) => ev.stopPropagation()}>
        <div className="h-1.5 shrink-0" style={{ background: e.color }} />

        <div className="p-5 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full text-white" style={{ background: e.color }}>
              {EVENT_KIND_LABEL[e.kind]}
            </span>
            {e.attrIds.length === 0
              ? <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">全員</span>
              : e.attrIds.map((id) => (
                <span key={id} className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-100">
                  {attrLabel(index, id)}
                </span>
              ))}
            {!e.published && <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-gray-200 text-gray-600">下書き</span>}
            <span className="flex-1" />
            {isOps && onEdit && (
              <button onClick={() => onEdit(e)} className="text-[11.5px] font-bold px-2.5 py-1 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">編集</button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
          </div>

          <h3 className="text-lg font-extrabold text-neutral-900 mb-3">{e.title}</h3>

          <dl className="text-[12.5px] space-y-1.5 mb-4">
            <div className="flex gap-3">
              <dt className="w-14 text-gray-400 font-bold shrink-0">日時</dt>
              <dd className="text-gray-700">{eventRangeLabel(e)}</dd>
            </div>
            {e.location && (
              <div className="flex gap-3">
                <dt className="w-14 text-gray-400 font-bold shrink-0">場所</dt>
                <dd className="text-gray-700">{e.location}</dd>
              </div>
            )}
            {e.url && (
              <div className="flex gap-3">
                <dt className="w-14 text-gray-400 font-bold shrink-0">リンク</dt>
                <dd><a href={e.url} target="_blank" rel="noopener noreferrer" className="text-red-500 underline break-all">{e.url}</a></dd>
              </div>
            )}
          </dl>

          {e.bodyText && (
            <p className="text-[12.5px] text-gray-600 leading-relaxed whitespace-pre-wrap mb-4 pb-4 border-b border-gray-100">{e.bodyText}</p>
          )}

          {/* フォーム連携 */}
          {form && (
            isOps && stat ? (
              <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3.5">
                <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                  <span className="text-[11px] font-extrabold px-2 py-0.5 rounded text-white bg-blue-600">申込フォーム</span>
                  <span className="text-[12.5px] font-bold text-gray-800">{form.name}</span>
                  <span className="flex-1" />
                  <span className="text-[10.5px] text-gray-500 font-mono">/f/{form.slug}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 mb-2.5">
                  <div className="rounded-lg bg-white border border-gray-200 p-2 text-center">
                    <div className="text-[18px] font-black text-blue-600">{stat.answeredMembers.length}</div>
                    <div className="text-[10.5px] text-gray-400 font-bold">回答</div>
                  </div>
                  <div className="rounded-lg bg-white border-2 border-red-200 p-2 text-center">
                    <div className="text-[18px] font-black text-red-600">{stat.unanswered.length}</div>
                    <div className="text-[10.5px] text-red-500 font-bold">未回答</div>
                  </div>
                  <div className="rounded-lg bg-white border border-gray-200 p-2 text-center">
                    <div className="text-[18px] font-black text-gray-500">{stat.targets.length}</div>
                    <div className="text-[10.5px] text-gray-400 font-bold">公開対象</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="flex-1 h-1.5 rounded-full bg-white border border-blue-100 overflow-hidden">
                    <span className="block h-full bg-blue-600" style={{ width: `${stat.pct}%` }} />
                  </span>
                  <span className="text-[11px] font-bold text-gray-500">回答率 {stat.pct}%</span>
                </div>
                {stat.unanswered.length > 0 && (
                  <div className="border border-gray-200 rounded-lg bg-white divide-y divide-gray-100 text-[12px] max-h-32 overflow-y-auto">
                    {stat.unanswered.slice(0, 30).map((m) => (
                      <div key={m.id} className="flex items-center gap-2 px-3 py-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                        {m.name}
                        <span className="ml-auto text-red-500 font-bold">未回答</span>
                      </div>
                    ))}
                  </div>
                )}
                <a href={formUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 mt-2.5 text-[11.5px] font-bold text-blue-700 underline">
                  <Icon name="external" size={14} /> フォームを開く
                </a>
              </div>
            ) : iAnswered ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-extrabold text-emerald-700">✓ 回答済</span>
                <span className="text-[11.5px] text-emerald-800">「{form.name}」を送信しました</span>
                <a href={formUrl} target="_blank" rel="noopener noreferrer"
                  className="ml-auto text-[11px] font-bold text-emerald-700 underline">フォームを開く</a>
              </div>
            ) : (
              <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3.5">
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="text-[11px] font-extrabold px-2 py-0.5 rounded text-white bg-blue-600">申込フォーム</span>
                  <span className="text-[10.5px] font-bold px-2 py-0.5 rounded-full bg-red-100 text-red-700">未回答</span>
                </div>
                <div className="text-[13px] font-bold text-gray-800">{form.name}</div>
                {form.deadlineAt && (
                  <div className="text-[11px] text-gray-500 mt-0.5 mb-3">回答期限：{form.deadlineAt.replace("T", " ")}</div>
                )}
                <a href={formUrl} target="_blank" rel="noopener noreferrer"
                  className="block w-full text-center py-2.5 rounded-lg bg-blue-600 text-white text-[13px] font-bold hover:bg-blue-700">
                  申し込む（フォームを開く）→
                </a>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
