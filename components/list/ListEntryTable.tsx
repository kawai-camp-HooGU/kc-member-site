"use client";
// ============================================================
// リスト管理：右ペイン（レコード一覧）
//   要件の項目に加えて「状態／会員／ラベル」を出す。
//   状態列が無いと「送ったのに届いていない」の原因が画面から追えない。
//
//   ⚠️ 横スクロールを出さない（REQ-049）。右ペインの実効幅は
//      max-w-6xl(1120px) − 左ペイン268px − gap12px − 枠2px ＝ 約838px しかない。
//      常時表示は7列＋展開ボタンに絞り、固定幅の合計を 528px に収める。
//      残りは「連絡先」列が可変で受ける。列を増やすときは必ずこの数字を更新すること。
//   ⚠️ 常時表示から外した項目は**消さずに畳む**（brand.md §2-4）。
//      行右端の「＞」で詳細行を開くと全項目が見える。
//   ⚠️ ページングは keyset（OFFSET を使わない）。「さらに読み込む」で継ぎ足す。
// ============================================================
import { useMemo, useState } from "react";
import { Icon } from "../common/Icon";
import { fmtJst } from "../../lib/dateFmt";
import { labelChipCls, DETAIL_LABEL, DETAIL_VALUE } from "../../lib/constants";
import type { ContactList, ListEntry } from "../../lib/models";
import {
  AGE_GROUPS, PREFECTURES, ENTRY_STATE_CLS, ENTRY_STATE_LABEL, entryState,
  LABEL_NONE, LINE_UID_RE, isFiltered,
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
  /** ラベル絞り込みの選択肢（そのリストに実在するラベルと件数。''＝未設定） */
  labelOptions: readonly { value: string; count: number }[];
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

/**
 * 常時表示する列。thead・colgroup・詳細行の colSpan が**すべてこの配列を見る**。
 * ⚠️ 列を足したら width の合計を見直すこと（可変列を除いた固定幅の合計 ≦ 700px）。
 *    固定幅合計 = 62+120+96+68+66+78+38 = 528px。残りは「連絡先」が受ける。
 */
const COLS: { key: string; label: string; width?: string }[] = [
  { key: "sel",     label: "選択／編集",     width: "62px" },
  { key: "contact", label: "連絡先" },                        // 可変
  { key: "name",    label: "氏名 ／ LINE名", width: "120px" },
  { key: "label",   label: "ラベル",         width: "96px" },
  { key: "state",   label: "状態",           width: "68px" },
  { key: "member",  label: "会員",           width: "66px" },
  { key: "attr",    label: "年代 ／ 地域",   width: "78px" },
  { key: "expand",  label: "",               width: "38px" },
];

const Dash = () => <span className="text-gray-300">—</span>;

export function ListEntryTable({
  list, entries, suppressed, withdrawn, filter, onFilter, labelOptions,
  selected, onSelected,
  hasMore, loading, pageSize, onLoadMore, onAdd, onEdit, onDeleteSelected, onImport,
  onExport, exporting = false,
}: ListEntryTableProps) {
  const selSet = useMemo(() => new Set(selected), [selected]);
  const allShownSelected = entries.length > 0 && entries.every((e) => selSet.has(e.id));

  /** 展開中の行。⚠️ リストを切り替えたら親が entries を差し替えるので、ここも畳み直す */
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());
  const toggleExpand = (id: number) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

        {/*
          ラベル絞り込み（REQ-049）。
          ⚠️ 件数は**リスト全体**のもので、他の絞り込みは反映しない。誤解しないよう
             選択肢のラベルに件数だけを添え、絞り込み後の件数はフッタで見せる。
          ⚠️ 選択中は**文字色だけ**で示す（枠・地・太字を重ねない。brand.md §1-3）。
        */}
        <select
          className={`${SELECT} ${filter.label ? "text-red-700" : ""}`}
          value={filter.label ?? ""}
          onChange={(e) => patch({ label: e.target.value })}
          title="このリストに実在するラベルで絞り込みます（件数はリスト全体のもの）">
          <option value="">ラベル：すべて</option>
          {labelOptions.filter((o) => o.value !== "").map((o) => (
            <option key={o.value} value={o.value}>{o.value}（{o.count}）</option>
          ))}
          {labelOptions.some((o) => o.value === "") && (
            <option value={LABEL_NONE}>
              （未設定）（{labelOptions.find((o) => o.value === "")?.count ?? 0}）
            </option>
          )}
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

      {/* ── テーブル ──
          ⚠️ overflow-x-hidden。列幅の合計が枠に収まることは COLS で担保している。
             列を増やして収まらなくなると、右端の展開ボタンが押せない画面になる。 */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
        <table className="w-full table-fixed text-[11.5px]">
          <colgroup>
            {COLS.map((c) => <col key={c.key} style={c.width ? { width: c.width } : undefined} />)}
          </colgroup>
          <thead>
            <tr className="tbl-head">
              <th className="px-2 py-2">
                <span className="flex items-center gap-2">
                  <input type="checkbox" checked={allShownSelected} onChange={toggleAll} aria-label="表示中をすべて選択" />
                  <span className="sr-only">編集</span>
                </span>
              </th>
              {COLS.slice(1).map((c) => (
                <th key={c.key} className="px-2 py-2 text-left font-medium whitespace-nowrap">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && entries.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-3 py-10 text-center text-gray-400">読み込み中...</td></tr>
            )}
            {!loading && entries.length === 0 && (
              <tr><td colSpan={COLS.length} className="px-3 py-10 text-center text-gray-400">
                {/* ⚠️ 条件をここにハードコードしない。絞り込みを足すたびに文言がずれる */}
                {isFiltered(filter)
                  ? "条件に一致するレコードはありません"
                  : "レコードがありません。「手入力で追加」から登録してください。"}
              </td></tr>
            )}

            {entries.map((e) => {
              const st = entryState(e, suppressed, withdrawn);
              const open = expanded.has(e.id);
              return [
                <tr key={e.id} className={`hover:bg-gray-50/60 ${selSet.has(e.id) ? "bg-red-50/40" : ""} ${open ? "bg-gray-50/60" : ""}`}>
                  {/* 選択＋編集（REQ-049 ②：編集を選択チェックの隣へ。8pxの余白で押し間違いを防ぐ） */}
                  <td className="px-2 py-1.5">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={selSet.has(e.id)} onChange={() => toggleOne(e.id)}
                        aria-label={`${e.email || e.phone} を選択`} />
                      <button onClick={() => onEdit(e)} title="このレコードを編集"
                        aria-label={`${e.email || e.phone} を編集`}
                        className="shrink-0 w-[22px] h-[22px] inline-flex items-center justify-center
                          rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700">
                        <Icon name="pencil" size={12} />
                      </button>
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="font-mono text-[11px] text-gray-800 truncate" title={e.email}>
                      {e.email || <Dash />}
                    </div>
                    <div className="font-mono text-[10px] text-gray-400 truncate" title={e.phone}>
                      {e.phone || <Dash />}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate" title={e.name}>{e.name || <Dash />}</div>
                    <div className="text-[10px] text-gray-400 truncate" title={e.lineDisplayName}>
                      {e.lineDisplayName || <Dash />}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {e.label
                      ? <span className={`inline-block max-w-full truncate align-middle text-[9.5px] font-bold rounded-full px-2 py-0.5 border ${labelChipCls}`}
                          title={e.label}>{e.label}</span>
                      : <Dash />}
                  </td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[9.5px] font-bold rounded-full px-2 py-0.5 border whitespace-nowrap ${ENTRY_STATE_CLS[st]}`}>
                      {ENTRY_STATE_LABEL[st]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    {e.memberId != null
                      ? <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 whitespace-nowrap"
                          title={e.matchedBy === "email" ? "メールアドレスで名寄せ" : "会員IDで一致"}>
                          会員#{e.memberId}
                        </span>
                      : <Dash />}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate">{e.ageGroup || <Dash />}</div>
                    <div className="text-[10px] text-gray-400 truncate">{e.prefecture || <Dash />}</div>
                  </td>
                  <td className="px-1 py-1.5">
                    <button onClick={() => toggleExpand(e.id)}
                      aria-expanded={open}
                      title={open ? "詳細を閉じる" : "詳細を開く（備考・LINE ID・同意情報など）"}
                      className={`w-[22px] h-[22px] inline-flex items-center justify-center rounded-md
                        hover:bg-gray-100 ${open ? "text-red-700 rotate-90" : "text-gray-400"} transition-transform`}>
                      <Icon name="chevronRight" size={13} />
                    </button>
                  </td>
                </tr>,
                open ? (
                  <tr key={`${e.id}-d`} className="bg-gray-50/60">
                    <td colSpan={COLS.length} className="px-4 pt-2 pb-3 pl-[70px] border-b border-gray-100">
                      <dl className="grid grid-cols-3 gap-x-6 gap-y-2">
                        <Detail k="備考1" v={e.note1} />
                        <Detail k="備考2" v={e.note2} />
                        <Detail k="登録日時" v={e.createdAt ? fmtJst(e.createdAt) : ""} />
                        <div>
                          <dt className={DETAIL_LABEL}>LINE ID</dt>
                          <dd className={`${DETAIL_VALUE} font-mono`}>
                            {e.lineUserId || <span className="text-gray-400">未設定</span>}
                          </dd>
                          {e.lineUserId && !LINE_UID_RE.test(e.lineUserId) && (
                            <dd className="text-[10px] text-amber-700">形式が異なります（U＋32文字）</dd>
                          )}
                        </div>
                        <Detail k="同意日時" v={e.consentAt ? fmtJst(e.consentAt) : ""} />
                        <Detail k="同意取得元" v={e.consentSrc} />
                        <div>
                          <dt className={DETAIL_LABEL}>取込元</dt>
                          <dd className={DETAIL_VALUE}>
                            <span className="text-[9.5px] font-bold rounded-full px-2 py-0.5 bg-gray-100 text-gray-600 border border-gray-200">
                              {SOURCE_LABEL[e.sourceKind]}
                            </span>
                          </dd>
                        </div>
                        <Detail k="紐づけ根拠" v={
                          e.matchedBy === "member_id" ? "会員IDで一致"
                          : e.matchedBy === "email" ? "メールで名寄せ" : ""
                        } />
                        <Detail k="更新日時" v={e.updatedAt ? fmtJst(e.updatedAt) : ""} />
                        <Detail k="レコードID" v={`#${e.id}`} mono />
                      </dl>
                    </td>
                  </tr>
                ) : null,
              ];
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

/** 展開行の1項目。空欄は「未設定」と出す（—だと畳んだ側と紛らわしい） */
function Detail({ k, v, mono = false }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className={DETAIL_LABEL}>{k}</dt>
      <dd className={`${DETAIL_VALUE}${mono ? " font-mono" : ""}`}>
        {v || <span className="text-gray-400">未設定</span>}
      </dd>
    </div>
  );
}
