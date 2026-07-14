"use client";
// ============================================================
// 設定 ＞ イベント・予定
//   コミュニティのイベント／予定の一覧・登録・編集。運営のみ。
//   紐付けフォームがある予定は、回答／未回答の件数を表示する。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import {
  fetchEvents, fetchFormBriefs, fetchAnsweredMembers, setEventPublished,
  emptyEvent, eventRangeLabel, eventDays, eventFormStat, dayKey,
} from "../../lib/events";
import type { FormBrief } from "../../lib/events";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import { AttrChips } from "../master/AttrChips";
import { EventEditModal } from "./EventEditModal";
import { Icon } from "../common/Icon";
import type { CalEvent } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";

type Range = "future" | "past" | "all";

export function EventMaint() {
  const { members } = useMaster();
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [forms, setForms] = useState<FormBrief[]>([]);
  const [answered, setAnswered] = useState<Map<number, Set<number>>>(new Map());
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<Range>("future");
  const [edit, setEdit] = useState<CalEvent | null>(null);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);
  const audience = useMemo(
    () => members.filter((m) => !m.isDeleted && m.role !== "管理者" && m.role !== "オペレーター"),
    [members],
  );

  const reload = async () => {
    const [e, f, a] = await Promise.all([fetchEvents(), fetchFormBriefs(), fetchAnsweredMembers()]);
    setEvents(e); setForms(f); setAnswered(a);
  };

  useEffect(() => {
    (async () => {
      try {
        const [t] = await Promise.all([loadAttributeTree(), reload()]);
        setTree(t);
      } catch (err) { console.error("イベント読込エラー:", err); }
      setLoading(false);
    })();
  }, []);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const today = new Date().toISOString().slice(0, 10);
  const rows = events
    .filter((e) => {
      const end = dayKey(e.endAt || e.startAt);
      if (range === "future") return end >= today;
      if (range === "past") return end < today;
      return true;
    })
    .sort((a, b) => (range === "past" ? b.startAt.localeCompare(a.startAt) : a.startAt.localeCompare(b.startAt)));

  const togglePub = async (e: CalEvent) => {
    await setEventPublished(e.id, !e.published);
    setEvents((prev) => prev.map((x) => x.id === e.id ? { ...x, published: !x.published } : x));
  };

  const segBtn = (on: boolean) =>
    `px-3 py-1.5 rounded-md text-[12.5px] font-bold transition-colors ${on ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"}`;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2.5 bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-800">
        <span className="text-red-600 shrink-0"><Icon name="calendar" size={18} /></span>
        <p className="leading-relaxed m-0">
          ここで登録した<b className="text-red-600">イベント・予定</b>がカレンダーに表示されます。公開対象は<b>属性＋公開条件</b>で出し分け、
          申込やアンケートは<b>フォームを紐付け</b>て受け付けます（出欠機能はありません）。
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex bg-gray-100 rounded-lg p-1">
          <button className={segBtn(range === "future")} onClick={() => setRange("future")}>今後の予定</button>
          <button className={segBtn(range === "past")} onClick={() => setRange("past")}>過去</button>
          <button className={segBtn(range === "all")} onClick={() => setRange("all")}>すべて</button>
        </div>
        <div className="flex-1" />
        <button onClick={() => setEdit(emptyEvent())}
          className="px-3 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700">＋ 予定を追加</button>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {rows.length === 0 ? (
          <div className="text-center text-gray-300 py-10 text-sm">予定がありません。</div>
        ) : rows.map((e, i) => {
          const form = e.formId != null ? forms.find((f) => f.id === e.formId) ?? null : null;
          const stat = form ? eventFormStat(e, audience, index, answered) : null;
          const days = eventDays(e);
          const [y, m, d] = dayKey(e.startAt).split("-");
          void y;
          return (
            <div key={e.id} className={`flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""}`}>
              <div className="w-14 shrink-0 text-center rounded-lg py-1.5 text-white" style={{ background: e.color }}>
                <div className="text-[10px] font-bold opacity-80">{Number(m)}月</div>
                <div className="text-lg font-black leading-none">{Number(d)}</div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-gray-800 truncate">
                  {e.title || "（無題）"}
                  {days > 1 && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">{days}日間</span>}
                </div>
                <div className="text-[11px] text-gray-400 mt-0.5 flex gap-2 flex-wrap items-center">
                  <span>{eventRangeLabel(e)}</span>
                  {e.location && <span>{e.location}</span>}
                  {/* 属性は赤固定のピルだったが、属性色を無視していたため AttrChips に統一 */}
                  <AttrChips index={index} ids={e.attrIds} emptyLabel="全員" />
                  {form && <span className="px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-bold">▤ {form.name}</span>}
                  {e.newsId != null && <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">お知らせ連携</span>}
                </div>
              </div>

              <div className="text-right shrink-0">
                {stat ? (
                  <>
                    <div className="text-[12px] font-extrabold text-blue-600">
                      回答 {stat.answeredMembers.length} <span className="text-gray-300">/</span> <span className="text-red-500">未回答 {stat.unanswered.length}</span>
                    </div>
                    <div className="text-[10.5px] text-gray-400">
                      {form?.deadlineAt ? `期限 ${form.deadlineAt.slice(5, 10).replace("-", "/")}` : "期限なし"}
                    </div>
                  </>
                ) : <span className="text-[11px] text-gray-400">フォームなし</span>}
              </div>

              <button onClick={() => togglePub(e)} title="公開/非公開"
                className={`relative w-10 h-[21px] rounded-full shrink-0 ${e.published ? "bg-green-500" : "bg-gray-300"}`}>
                <span className={`absolute top-0.5 w-[17px] h-[17px] rounded-full bg-white transition-all ${e.published ? "left-[21px]" : "left-0.5"}`} />
              </button>
              <button onClick={() => setEdit({ ...e })} className="text-xs text-red-500 hover:text-red-700 px-2 py-1 shrink-0">編集</button>
            </div>
          );
        })}
      </div>

      {edit && <EventEditModal value={edit} onClose={() => setEdit(null)} onSaved={reload} />}
    </div>
  );
}
