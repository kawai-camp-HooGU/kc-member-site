"use client";
// ============================================================
// リスト管理：右ペイン（レコード一覧）
//   要件の項目に加えて「状態／会員／取込元」を出す。
//   状態列が無いと「送ったのに届いていない」の原因が画面から追えない。
//
//   ⚠️ ページングは keyset（OFFSET を使わない）。「さらに読み込む」で継ぎ足す。
//   ⚠️ 一括取り込みは Phase 2。ここではボタンを出さない。
// ============================================================
import { useMemo } from "react";
import { Icon } from "../common/Icon";
import { fmtJst } from "../../lib/dateFmt";
import type { ContactList, ListEntry } from "../../lib/models";
import {
  AGE_GROUPS, PREFECTURES, ENTRY_STATE_CLS, ENTRY_STATE_LABEL, entryState,
} from "../../lib/contactLists";
import type { EntryFilter } from "../../lib/contactLists";

export interface ListEntryTableProps {
  list: ContactList;
  entries: ListEntry[];
  suppressed: ReadonlySet<string>;
  /** 退会（論理削除）した会員IDの集合（確定事項 A3） */
  withdrawn: ReadonlySet<number>;
  filter: EntryFilter;
  onFilter: (f: EntryFilter) => void;
  selected: number[];
  onSelected: (ids: number[]) => void;
  hasMore: boolean;
  loading: boolean;
  pageSize: number;
  onLoadMore: () => void;
  onAdd: () => void;
  onEdit: (e: ListEntry) => void;
  onDeleteSelected: () => void;
  /** 一括取り込みを開く。権限が無いときは undefined（ボタンを出さない） */
  onImport?: () => void;
  /** CSVエクスポート。権限（contact_list_export）が無いときは undefined */
  onExport?: () => void;
  exporting?: boolean;
}

const SELECT =
  "rounded-lg px-2 py-1.5 text-[11px] bg-white border border-gray-200 " +
  "focus:outline-none focus:border-red-400 focus:ring-2 focus:ring-red-100";

const SOURCE_LABEL: Record<ListEntry["sourceKind"], string> = {
  manual: "手入力", csv: "CSV", md: "MD", api: "API",
};

export function ListEntryTable({
  list, entries, suppressed, withdrawn, filter, onFilter, selected, onSelected,
  hasMore, loading, pageSize, onLoadMore, onAdd, onEdit, onDeleteSelected, onImport,
  onExport, exporting = false,
}: ListEntryTableProps) {
  const selSet = useMemo(() => new Set(selected), [selected]);
  const allShownSelected = entries.length > 0 && entries.every((e) => selSet.has(e.id));

  const toggleAll = () => {
    onSelected(allShownSelected ? [] : entries.map((e) => e.id));
  };
  const toggleOne = (id: number) => {
    onSelected(selSet.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  };

  const patch = (p: Partial<EntryFilter>) => onFilter({ ...filter, ...p });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      {/* ── ツールバー ── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-gray-100 flex-wrap">
        <input value={filter.keyword ?? ""} onChange={(e) => patch({ keyword: e.target.value })}
          placeholder="メール・電話・氏名で検索"
          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-[11.5px] w-[180px] bg-gray-50
            focus:outline-none focus:bg-white focus:border-red-400" />

        <select className={SELECT} value={filter.prefecture ?? ""} onChange={(e) => patch({ prefecture: e.target.value })}>
          <option value="">都道府県：すべて</option>
          {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>

        <select className={SELECT} value={filter.ageGroup ?? ""} onChange={(e) => patch({ ageGroup: e.target.value })}>
          <option value="">年代：すべて</option>
          {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>

        <select className={SELECT} value={filter.contact ?? "all"}
          onChange={(e) => patch({ contact: e.target.value as EntryFilter["contact"] })}>
          <option value="all">連絡先：すべて</option>
          <option value="emailable">メールあり</option>
          <option value="phone_only">電話のみ</option>
        </select>

        <button onClick={onAdd}
          className="ml-auto text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700
            hover:bg-gray-50 flex items-center gap-1">
          <Icon name="bulk" size={13} />手入力で追加
        </button>
        {onExport && (
          <button onClick={onExport} disabled={exporting}
            title="表示中の絞り込みに合う全件をCSVで書き出します（実行は記録されます）"
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg border border-gray-200 text-gray-700
              hover:bg-gray-50 disabled:opacity-50 flex items-center gap-1">
            <Icon name="download" size={13} />{exporting ? "書き出し中..." : "CSVエクスポート"}
          </button>
        )}
        {onImport && (
          <button onClick={onImport}
            className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white
              hover:bg-red-700 flex items-center gap-1">
            <Icon name="download" size={13} />一括取り込み
          </button>
        )}
      </div>

      {/* ── テーブル ── */}
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="tbl-head">
              <th className="px-2 py-2 w-8">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="表示中をすべて選択" />
              </th>
              {["メールアドレス", "電話番号", "氏名", "年代", "都道府県", "状態", "会員", "登録日時", "備考1", "備考2", "取込元", ""].map((h) => (
                <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && entries.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-gray-400">読み込み中...</td></tr>
            )}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={12} className="px-3 py-10 text-center text-gray-400">
                {(filter.keyword ?? "").trim() || filter.prefecture || filter.ageGroup || filter.contact !== "all"
                  ? "条件に一致するレコードはありません"
                  : "レコードがありません。「手入力で追加」から登録してください。"}
              </td></tr>
            )}

            {entries.map((e) => {
              const st = entryState(e, suppressed, withdrawn);
              return (
                <tr key={e.id} className={`hover:bg-gray-50/60 ${selSet.has(e.id) ? "bg-red-50/40" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selSet.has(e.id)} onChange={() => toggleOne(e.id)}
                      aria-label={`${e.email || e.phone} を選択`} />
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-gray-800 break-all">
                    {e.email || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[11px] text-gray-700 whitespace-nowrap">
                    {e.phone || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{e.name || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{e.ageGroup || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">{e.prefecture || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5">
                    <span className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 border whitespace-nowrap ${ENTRY_STATE_CLS[st]}`}>
                      {ENTRY_STATE_LABEL[st]}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5 whitespace-nowrap">
                    {e.memberId != null
                      ? <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200"
                          title={e.matchedBy === "email" ? "メールアドレスで名寄せ" : "会員IDで一致"}>
                          会員#{e.memberId}
                        </span>
                      : <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-2.5 py-1.5 text-[10.5px] text-gray-400 whitespace-nowrap">{fmtJst(e.createdAt)}</td>
                  <td className="px-2.5 py-1.5 max-w-[120px] truncate" title={e.note1}>{e.note1 || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5 max-w-[120px] truncate" title={e.note2}>{e.note2 || <span className="text-gray-300">—</span>}</td>
                  <td className="px-2.5 py-1.5">
                    <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200 whitespace-nowrap">
                      {SOURCE_LABEL[e.sourceKind]}
                    </span>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <button onClick={() => onEdit(e)}
                      className="text-[10.5px] font-bold px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                      編集
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {hasMore && (
          <div className="p-3 text-center">
            <button onClick={onLoadMore} disabled={loading}
              className="text-[11.5px] font-bold px-4 py-2 rounded-lg border border-gray-200 text-gray-700
                hover:bg-gray-50 disabled:opacity-50">
              {loading ? "読み込み中..." : `さらに ${pageSize} 件を読み込む`}
            </button>
          </div>
        )}
      </div>

      {/* ── フッタ（選択中の操作）── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-t border-gray-100 flex-wrap">
        <span className="text-[10.5px] text-gray-400">
          表示 {entries.length.toLocaleString()} 件 / 全 {list.entryCount.toLocaleString()} 件
          {selected.length > 0 && <span className="ml-2 text-red-700 font-bold">{selected.length} 件を選択中</span>}
        </span>
        <button onClick={onDeleteSelected} disabled={selected.length === 0}
          className="ml-auto text-[10.5px] font-bold px-2.5 py-1 rounded-md border border-red-200 text-red-700
            hover:bg-red-50 disabled:opacity-40">
          選択を削除
        </button>
      </div>
    </div>
  );
}
