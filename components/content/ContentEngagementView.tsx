"use client";
// ============================================================
// コンテンツ横断ビュー（視聴状況）
//   コンテンツごとの 対象者数／視聴者数／視聴率／延べ回数／最終視聴 を一覧。
//   行をクリックすると 視聴者・未視聴者 の内訳を表示。
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useMaster } from "../../hooks/useMaster";
import { fetchContentData } from "../../lib/contents";
import { loadAttributeTree } from "../../lib/attributes";
import { buildAttrIndex } from "../../lib/members";
import {
  fetchContentViews, buildViewIndex, contentStat, relDays, fmtDateTime, loginState,
} from "../../lib/engagement";
import type { ContentStat, ContentViewRow } from "../../lib/engagement";
import type { ContentPage, CmsContent, Member } from "../../lib/models";
import type { AttrNode } from "../../lib/attributes";
import { Icon } from "../common/Icon";

const KIND_LABEL: Record<string, string> = { video: "動画", doc: "資料", none: "記事" };

function Bar({ pct }: { pct: number }) {
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-2 rounded-full bg-gray-200 overflow-hidden">
        <div className={`h-full rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 30 ? "bg-red-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold text-gray-700 w-10 text-right">{pct}%</span>
    </div>
  );
}

export function ContentEngagementView() {
  const { members } = useMaster();
  const [pages, setPages] = useState<ContentPage[]>([]);
  const [contents, setContents] = useState<CmsContent[]>([]);
  const [rows, setRows] = useState<ContentViewRow[]>([]);
  const [tree, setTree] = useState<AttrNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageId, setPageId] = useState<number | "all">("all");
  const [excludeStaff, setExcludeStaff] = useState(true);
  const [detail, setDetail] = useState<ContentStat | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [{ pages, contents }, vr, t] = await Promise.all([fetchContentData(), fetchContentViews(), loadAttributeTree()]);
        setPages(pages); setContents(contents); setRows(vr); setTree(t);
      } catch (e) { console.error("視聴状況の読込エラー:", e); }
      setLoading(false);
    })();
  }, []);

  const index = useMemo(() => buildAttrIndex(tree), [tree]);
  const views = useMemo(() => buildViewIndex(rows), [rows]);

  // 集計対象のメンバー（既定でスタッフ〈管理者・オペレーター〉を除外）
  const audience: Member[] = useMemo(
    () => members.filter((m) => !m.isDeleted && (!excludeStaff || (m.role !== "管理者" && m.role !== "オペレーター"))),
    [members, excludeStaff],
  );

  const stats: ContentStat[] = useMemo(() => {
    const target = contents
      .filter((c) => c.published && (pageId === "all" || c.pageId === pageId))
      .sort((a, b) => a.pageId - b.pageId || a.sortOrder - b.sortOrder || a.id - b.id);
    return target.map((c) => contentStat(c, pages, audience, index, views));
  }, [contents, pages, pageId, audience, index, views]);

  if (loading) return <p className="text-sm text-gray-400 py-10 text-center">読み込み中…</p>;

  const avgPct = stats.length ? Math.round(stats.reduce((s, x) => s + x.pct, 0) / stats.length) : 0;
  const activeMembers = audience.filter((m) => loginState(m) === "active").length;
  const neverLogin = audience.filter((m) => loginState(m) === "never").length;

  return (
    <div className="space-y-4">
      {/* サマリー */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        {[
          { icon: "content", label: "公開コンテンツ", value: `${stats.length} 件` },
          { icon: "chart", label: "平均視聴率", value: `${avgPct}%` },
          { icon: "login", label: "7日以内にログイン", value: `${activeMembers} / ${audience.length} 名` },
          { icon: "clock", label: "未ログイン", value: `${neverLogin} 名` },
        ].map((k) => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="w-9 h-9 rounded-[10px] bg-red-50 text-red-600 inline-flex items-center justify-center shrink-0">
              <Icon name={k.icon as "content"} size={18} />
            </span>
            <div className="min-w-0">
              <p className="text-[11px] text-gray-400 truncate">{k.label}</p>
              <p className="text-base font-extrabold text-gray-800">{k.value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ページ絞り込み＋集計対象 */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setPageId("all")}
          className={`px-3.5 py-2 rounded-lg text-sm font-bold border ${pageId === "all" ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>すべて</button>
        {[...pages].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((p) => (
          <button key={p.id} onClick={() => setPageId(p.id)}
            className={`px-3.5 py-2 rounded-lg text-sm font-bold border ${pageId === p.id ? "bg-neutral-900 text-white border-neutral-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"}`}>
            {p.abbr || p.name}
          </button>
        ))}
        <div className="flex-1" />
        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <button type="button" onClick={() => setExcludeStaff((v) => !v)}
            className={`relative w-10 h-[22px] rounded-full transition-colors ${excludeStaff ? "bg-emerald-500" : "bg-gray-300"}`}>
            <span className={`absolute top-0.5 w-[18px] h-[18px] rounded-full bg-white transition-all ${excludeStaff ? "left-5" : "left-0.5"}`} />
          </button>
          スタッフ（管理者・オペレーター）を集計から除く
        </label>
      </div>

      {/* コンテンツ別 視聴状況 */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-2.5 bg-gray-50 border-b border-gray-100 text-[11px] font-bold text-gray-500">
          <span className="flex-1">コンテンツ</span>
          <span className="w-16 text-right">対象</span>
          <span className="w-16 text-right">視聴</span>
          <span className="w-32">視聴率</span>
          <span className="w-20 text-right">延べ回数</span>
          <span className="w-24 text-right">最終視聴</span>
        </div>
        {stats.length === 0 ? (
          <div className="text-center text-gray-300 py-10 text-sm">公開中のコンテンツがありません。</div>
        ) : stats.map((s, i) => (
          <div key={s.content.id} onClick={() => setDetail(s)}
            className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 ${i > 0 ? "border-t border-gray-100" : ""}`}>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate">{s.content.name}</p>
              <p className="text-[11px] text-gray-400 flex gap-2">
                <span>{s.page?.abbr || s.page?.name || "—"}</span>
                <span>{KIND_LABEL[s.content.kind] ?? "記事"}</span>
              </p>
            </div>
            <span className="w-16 text-right text-sm text-gray-500">{s.targets.length}</span>
            <span className="w-16 text-right text-sm font-bold text-gray-800">{s.viewers.length}</span>
            <span className="w-32"><Bar pct={s.pct} /></span>
            <span className="w-20 text-right text-sm text-gray-500">{s.totalViews}</span>
            <span className="w-24 text-right text-[11px] text-gray-400">{s.lastViewedAt ? relDays(s.lastViewedAt) : "—"}</span>
          </div>
        ))}
      </div>

      {/* ドリルダウン */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <h2 className="font-bold text-gray-800 truncate">{detail.content.name}</h2>
                <p className="text-[11px] text-gray-400">{detail.page?.name ?? "—"}／{KIND_LABEL[detail.content.kind] ?? "記事"}</p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600"><Icon name="close" size={20} /></button>
            </div>

            <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-4">
              <span className="text-sm text-gray-600">対象 <b className="text-gray-800">{detail.targets.length}</b> 名／視聴 <b className="text-gray-800">{detail.viewers.length}</b> 名</span>
              <div className="flex-1"><Bar pct={detail.pct} /></div>
            </div>

            <div className="px-5 py-4 overflow-y-auto grid gap-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <p className="text-xs font-bold text-emerald-700 mb-2 flex items-center gap-1.5"><Icon name="check" size={14} />視聴済み（{detail.viewers.length}）</p>
                <div className="space-y-1">
                  {detail.viewers.length === 0 && <p className="text-xs text-gray-300">まだ誰も視聴していません。</p>}
                  {detail.viewers.map((m) => {
                    const v = views.byContent.get(detail.content.id)?.find((r) => r.memberId === m.id);
                    return (
                      <div key={m.id} className="flex items-center gap-2 text-xs bg-white border border-gray-200 rounded-lg px-2.5 py-1.5">
                        <span className="truncate text-gray-700">{m.name}</span>
                        <span className="flex-1" />
                        <span className="text-[11px] text-gray-400 shrink-0">{fmtDateTime(v?.lastViewedAt)}・{v?.viewCount ?? 0}回</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <p className="text-xs font-bold text-gray-500 mb-2 flex items-center gap-1.5"><Icon name="eyeOff" size={14} />未視聴（{detail.unviewed.length}）</p>
                <div className="space-y-1">
                  {detail.unviewed.length === 0 && <p className="text-xs text-gray-300">全員が視聴済みです。</p>}
                  {detail.unviewed.map((m) => (
                    <div key={m.id} className="flex items-center gap-2 text-xs bg-gray-50 border border-dashed border-gray-200 rounded-lg px-2.5 py-1.5">
                      <span className="truncate text-gray-500">{m.name}</span>
                      <span className="flex-1" />
                      <span className="text-[11px] text-gray-400 shrink-0">{m.lastLoginAt ? `最終ログイン ${relDays(m.lastLoginAt)}` : "未ログイン"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
