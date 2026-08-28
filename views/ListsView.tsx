"use client";
// ============================================================
// リスト管理（顧客 ＞ リスト）
//   メールアドレス・電話番号のリストを登録・管理する2ペイン画面。
//   左＝リスト枠の一覧（手動並べ替え）／右＝選択中リストのレコード一覧・設定。
//
//   ⚠️ 配信先としての利用（一斉配信・シナリオ配信）は Phase 3 で配線する。
//      この画面は登録・管理までを担う（配信の宛先ロジックには触れない）。
//
//   このビューは配線に徹し、描画は components/list/* に寄せる。
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useRoute } from "../hooks/useRoute";
import { useToast } from "../components/common/ToastProvider";
import { useConfirm } from "../components/common/ConfirmProvider";
import { Icon } from "../components/common/Icon";
import { fmtJst } from "../lib/dateFmt";
import type { ContactList, ListEntry } from "../lib/models";
import {
  fetchContactLists, createContactList, updateContactList, setContactListArchived,
  reorderContactLists, duplicateContactList,
  fetchListEntries, fetchSuppressedSet, deleteListEntries, rematchListMembers, fetchListLabels,
  ENTRY_PAGE_SIZE, isFiltered,
} from "../lib/contactLists";
import type { ContactListInput, EntryFilter } from "../lib/contactLists";
import { fetchWithdrawnMemberIds } from "../lib/listRecipients";
import { ListSidePane } from "../components/list/ListSidePane";
import { ListEntryTable } from "../components/list/ListEntryTable";
import { ListEntryEditModal } from "../components/list/ListEntryEditModal";
import { ListSettingsPane } from "../components/list/ListSettingsPane";
import { ListImportWizard } from "../components/list/ListImportWizard";
import { ListImportHistory } from "../components/list/ListImportHistory";
import { ListDeliveryHistory } from "../components/list/ListDeliveryHistory";
import { ListMergeModal } from "../components/list/ListMergeModal";
import { exportListEntries, EXPORT_MAX_ROWS } from "../lib/listExport";
import type { MergeResult } from "../lib/listMerge";
import { useMaster } from "../hooks/useMaster";

type Tab = "entries" | "imports" | "deliveries" | "settings";

const EMPTY_LIST_INPUT: ContactListInput = {
  name: "", description: "", note1: "", note2: "",
  folderId: null, allowDelivery: true, consentNote: "",
};

export function ListsView() {
  const route = useRoute();
  const toast = useToast();
  const confirm = useConfirm();
  const { can } = useMaster();
  /** 一括取り込みは専用権限（既定OFF）。無い場合はボタンも出さない */
  const canImport = can("contact_list_import");
  /** エクスポートは個人情報の持ち出し。専用権限（既定OFF）が無ければボタンを出さない */
  const canExport = can("contact_list_export");
  /**
   * マージは統合元をアーカイブする＝リスト状態を変える操作なので、
   * 削除・アーカイブと同じ権限（contact_list_delete）で判定する。
   */
  const canMerge = can("contact_list_delete");

  // ── リスト枠 ──
  const [lists, setLists] = useState<ContactList[]>([]);
  const [loadingLists, setLoadingLists] = useState(true);
  const [listQuery, setListQuery] = useState("");
  /** 手動並べ替え中は自動リロードで並びが飛ばないようにする */
  const [dragId, setDragId] = useState<number | null>(null);

  // ── 右ペイン ──
  const [tab, setTab] = useState<Tab>("entries");
  const [entries, setEntries] = useState<ListEntry[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [filter, setFilter] = useState<EntryFilter>({ keyword: "", prefecture: "", ageGroup: "", contact: "all", label: "" });
  /** ラベル絞り込みの選択肢（REQ-049）。''＝未設定の行も1件として返ってくる */
  const [labelOptions, setLabelOptions] = useState<{ value: string; count: number }[]>([]);
  /** ラベル選択肢の再取得トリガ（レコードを増減したら作り直す） */
  const [labelsVer, setLabelsVer] = useState(0);
  const [selected, setSelected] = useState<number[]>([]);
  const [suppressed, setSuppressed] = useState<ReadonlySet<string>>(new Set());
  /** 退会した会員IDの集合（確定事項 A3：配信対象外を一覧でも見せる） */
  const [withdrawn, setWithdrawn] = useState<ReadonlySet<number>>(new Set());

  // ── モーダル ──
  const [editEntry, setEditEntry] = useState<ListEntry | "new" | null>(null);
  const [newListOpen, setNewListOpen] = useState(false);
  const [newListInput, setNewListInput] = useState<ContactListInput>(EMPTY_LIST_INPUT);
  const [savingList, setSavingList] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rematchBusy, setRematchBusy] = useState(false);
  /** 取込履歴タブを再読込させるためのキー（取り込み完了で増やす） */
  const [importedAt, setImportedAt] = useState(0);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  /** 操作履歴（監査）を再読込させるためのキー */
  const [auditKey, setAuditKey] = useState(0);

  // URL の詳細セグメントを選択中リストの正本にする（/ops/lists/{id}）
  const urlId = useMemo(() => {
    const n = Number(route.detail[0]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [route.detail]);

  const selectedId = useMemo(() => {
    if (urlId != null && lists.some((l) => l.id === urlId)) return urlId;
    return lists[0]?.id ?? null;
  }, [urlId, lists]);

  const selected0 = useMemo(() => lists.find((l) => l.id === selectedId) ?? null, [lists, selectedId]);

  // ── 読み込み ──
  const loadLists = useCallback(async () => {
    const rows = await fetchContactLists();
    setLists(rows);
    setLoadingLists(false);
  }, []);

  useEffect(() => { loadLists(); }, [loadLists]);
  useEffect(() => { fetchSuppressedSet().then(setSuppressed); }, []);

  // URL が「存在しないリスト」を指していたときだけ先頭に落として URL を直す。
  //   ⚠️ URL 未指定（/ops/lists）のときは書き換えない。ここで push すると
  //      「戻る」で /ops/lists に戻った瞬間に再度 push されて履歴が詰まる。
  useEffect(() => {
    if (loadingLists || selectedId == null) return;
    if (urlId != null && urlId !== selectedId) route.goDetail([selectedId]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingLists, selectedId, urlId]);

  const loadEntries = useCallback(async (listId: number, f: EntryFilter, from: number | null) => {
    setLoadingEntries(true);
    const page = await fetchListEntries(listId, f, from);
    setEntries((prev) => (from == null ? page.rows : [...prev, ...page.rows]));
    setCursor(page.nextCursor);
    setLoadingEntries(false);
  }, []);

  // 表示中レコードの会員が退会していないかを引く（A3の状態表示）
  useEffect(() => {
    const ids = Array.from(new Set(entries.map((e) => e.memberId).filter((v): v is number => v != null)));
    if (ids.length === 0) { setWithdrawn(new Set()); return; }
    let alive = true;
    fetchWithdrawnMemberIds(ids).then((s0) => { if (alive) setWithdrawn(s0); });
    return () => { alive = false; };
  }, [entries]);

  // リスト切替・絞り込み変更でレコードを読み直す（前のリストの行が残らないよう必ずクリア）
  useEffect(() => {
    setEntries([]);
    setCursor(null);
    setSelected([]);
    if (selectedId != null) loadEntries(selectedId, filter, null);
  }, [selectedId, filter, loadEntries]);

  /**
   * リストを切り替えたら、ラベルの絞り込みを外して選択肢を取り直す（REQ-049）。
   * ⚠️ 外さないと、別のリストに存在しないラベルで絞られたまま 0 件になり、
   *    「レコードが消えた」ように見える。
   */
  useEffect(() => {
    setFilter((f) => (f.label ? { ...f, label: "" } : f));
  }, [selectedId]);

  useEffect(() => {
    if (selectedId == null) { setLabelOptions([]); return; }
    let alive = true;
    // 失敗しても空配列が返る（プルダウンが「すべて」だけになる。一覧は止めない）
    fetchListLabels(selectedId).then((o) => { if (alive) setLabelOptions(o); });
    return () => { alive = false; };
  }, [selectedId, labelsVer, importedAt]);

  // ── リスト枠の操作 ──
  const selectList = (id: number) => { setTab("entries"); route.goDetail([id]); };

  const submitNewList = async () => {
    const name = newListInput.name.trim();
    if (!name) { toast.error("リスト名を入力してください"); return; }
    setSavingList(true);
    const id = await createContactList(newListInput);
    setSavingList(false);
    if (id == null) { toast.error("リストの作成に失敗しました"); return; }
    setNewListOpen(false);
    setNewListInput(EMPTY_LIST_INPUT);
    toast.success("リストを作成しました");
    await loadLists();
    selectList(id);
  };

  const saveSettings = async (input: ContactListInput) => {
    if (selectedId == null) return;
    if (!input.name.trim()) { toast.error("リスト名を入力してください"); return; }
    if (await updateContactList(selectedId, input)) {
      toast.success("保存しました");
      loadLists();
    } else {
      toast.error("保存に失敗しました");
    }
  };

  const toggleArchive = async (l: ContactList) => {
    const next = !l.isArchived;
    const ok = await confirm({
      title: next ? "リストをアーカイブ" : "アーカイブを解除",
      message: next
        ? `「${l.name}」をアーカイブします。\n配信先には選べなくなりますが、レコードと配信履歴はそのまま残ります。`
        : `「${l.name}」のアーカイブを解除し、配信先に選べる状態に戻します。`,
      confirmLabel: next ? "アーカイブする" : "解除する",
    });
    if (!ok) return;
    if (await setContactListArchived(l.id, next)) {
      toast.success(next ? "アーカイブしました" : "アーカイブを解除しました");
      loadLists();
    } else {
      toast.error("更新に失敗しました");
    }
  };

  const duplicate = async (l: ContactList) => {
    const withEntries = await confirm({
      title: "リストを複製",
      message: `「${l.name}」を複製します。\nレコード（${l.entryCount} 件）も一緒にコピーしますか？`,
      confirmLabel: "レコードもコピー",
      cancelLabel: "枠だけ複製",
    });
    const id = await duplicateContactList(l, withEntries);
    if (id == null) { toast.error("複製に失敗しました"); return; }
    toast.success("複製しました");
    await loadLists();
    selectList(id);
  };

  /**
   * 手動並べ替えの確定。楽観更新（先にUIを動かし、失敗したら元に戻す）。
   * ⚠️ 検索で絞っている間はドラッグ自体を無効化しているので、
   *    ここに来る配列は常に全件（＝並び順を壊さない）。
   */
  const commitReorder = async (orderedIds: number[]) => {
    const before = lists;
    const byId = new Map(lists.map((l) => [l.id, l]));
    const next = orderedIds.map((id) => byId.get(id)).filter((l): l is ContactList => !!l);
    setLists(next);
    if (!(await reorderContactLists(orderedIds))) {
      setLists(before);
      toast.error("並べ替えを保存できませんでした");
      return;
    }
    loadLists();
  };

  // ── レコードの操作 ──
  const reloadEntries = () => {
    if (selectedId == null) return;
    setSelected([]);
    loadEntries(selectedId, filter, null);
    loadLists();   // 件数キャッシュを画面に反映
    setLabelsVer((n) => n + 1);   // ラベルの選択肢も作り直す（REQ-049）
  };

  /** 名寄せの再実行（会員マスタは書き換えない／確定事項 No.12=a） */
  const runRematch = async () => {
    if (selectedId == null) return;
    setRematchBusy(true);
    const n = await rematchListMembers(selectedId);
    setRematchBusy(false);
    toast.success(n > 0 ? `${n} 件を会員に紐づけました` : "新たに紐づく会員はありませんでした");
    if (n > 0) reloadEntries();
  };

  /**
   * CSVエクスポート（確定事項 A4=a）。
   * ⚠️ 個人情報の持ち出しなので、実行前に必ず確認を挟み、実行は監査ログに残す。
   *    ログを書けなかったときは lib 側でエクスポート自体を中止する。
   */
  const runExport = async () => {
    if (selected0 == null) return;
    const scope = isFiltered(filter) ? "現在の絞り込みに合う全件" : "このリストの全件";
    const ok = await confirm({
      title: "CSVエクスポート",
      message:
        `「${selected0.name}」の${scope}を、全項目のCSVで書き出します。\n\n` +
        "個人情報の持ち出しにあたるため、実行者と件数が操作履歴に記録されます。\n" +
        "書き出したファイルの取り扱いにご注意ください。",
      confirmLabel: "書き出す",
    });
    if (!ok) return;

    setExporting(true);
    const res = await exportListEntries(selected0, filter, suppressed);
    setExporting(false);
    setAuditKey((n) => n + 1);

    if (!res.ok) { toast.error(res.error); return; }
    if (res.truncated) {
      toast.error(
        `上限 ${EXPORT_MAX_ROWS.toLocaleString()} 件で打ち切りました。` +
        "絞り込んで分けて書き出してください",
      );
      return;
    }
    toast.success(`${res.rowCount.toLocaleString()} 件を書き出しました`);
  };

  /** マージ完了。件数キャッシュ・一覧・操作履歴をまとめて更新する */
  const onMerged = async (res: MergeResult) => {
    setMergeOpen(false);
    setAuditKey((n) => n + 1);
    if (!res.ok && res.inserted === 0) { toast.error(res.error || "統合に失敗しました"); return; }
    await loadLists();
    reloadEntries();
    const tail = res.skipped > 0 ? `（重複 ${res.skipped.toLocaleString()} 件は除外）` : "";
    if (res.ok) {
      toast.success(
        `${res.inserted.toLocaleString()} 件を統合しました${tail}` +
        (res.archived > 0 ? ` ／ 統合元 ${res.archived} リストをアーカイブしました` : ""),
      );
    } else {
      toast.error(`中断しました。${res.inserted.toLocaleString()} 件まで統合済みです${tail}`);
    }
  };

  const removeSelected = async () => {
    if (selectedId == null || selected.length === 0) return;
    const ok = await confirm({
      title: "レコードを削除",
      message: `選択した ${selected.length} 件を削除します。この操作は取り消せません。`,
      confirmLabel: "削除する",
      danger: true,
    });
    if (!ok) return;
    if (await deleteListEntries(selectedId, selected)) {
      toast.success(`${selected.length} 件を削除しました`);
      reloadEntries();
    } else {
      toast.error("削除に失敗しました");
    }
  };

  // 検索で絞った表示（並べ替えは全件に対してのみ許可する）
  const shownLists = useMemo(() => {
    const k = listQuery.trim().toLowerCase();
    if (!k) return lists;
    return lists.filter((l) =>
      l.name.toLowerCase().includes(k) || l.description.toLowerCase().includes(k));
  }, [lists, listQuery]);

  const totalEntries = useMemo(() => lists.reduce((s, l) => s + l.entryCount, 0), [lists]);

  return (
    <div className="h-[calc(100dvh-3rem)] flex flex-col gap-3 min-h-0">
      {/* ── 見出し ── */}
      <div className="shrink-0 flex items-center gap-3 flex-wrap">
        <h1 className="text-xl font-extrabold text-gray-800">リスト管理</h1>
        <span className="text-xs text-gray-400">
          メール・電話番号のリストを登録し、一斉配信・シナリオ配信の宛先として使えます
        </span>
        <span className="ml-auto text-[11px] text-gray-400">
          全 {lists.length} リスト ／ 実レコード {totalEntries.toLocaleString()} 件
        </span>
        <button onClick={() => { setNewListInput(EMPTY_LIST_INPUT); setNewListOpen(true); }}
          className="text-sm px-4 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 flex items-center gap-1.5">
          <Icon name="bulk" size={15} />リストを新規作成
        </button>
      </div>

      {/* ── 2ペイン ── */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row gap-3">
        <ListSidePane
          lists={shownLists}
          allCount={lists.length}
          selectedId={selectedId}
          query={listQuery}
          onQuery={setListQuery}
          /** 検索中は並べ替えを許可しない（見えていない行を巻き込むため） */
          canReorder={listQuery.trim() === ""}
          dragId={dragId}
          onDragId={setDragId}
          onSelect={selectList}
          onReorder={commitReorder}
          onDuplicate={duplicate}
          onToggleArchive={toggleArchive}
          loading={loadingLists}
        />

        <div className="flex-1 min-w-0 flex flex-col bg-white border border-gray-200 rounded-xl overflow-hidden">
          {selected0 == null ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-gray-400 p-8">
              <Icon name="layers" size={30} />
              <p className="text-sm">
                {loadingLists ? "読み込み中..." : "リストがありません。「リストを新規作成」から追加してください。"}
              </p>
            </div>
          ) : (
            <>
              {/* 選択中リストのヘッダ */}
              <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 bg-[#3f3f46] text-white">
                <Icon name="users" size={14} />
                <span className="text-[13px] font-bold truncate">{selected0.name}</span>
                {selected0.isArchived && (
                  <span className="text-[10px] font-bold rounded-full px-2 py-0.5 bg-gray-400 text-white shrink-0">
                    アーカイブ
                  </span>
                )}
                <span className="ml-auto text-[10.5px] text-gray-300 shrink-0 hidden sm:inline">
                  登録 {fmtJst(selected0.createdAt)} ／ 更新 {fmtJst(selected0.updatedAt)}
                </span>
              </div>

              {/* タブ */}
              <div className="shrink-0 flex gap-1 px-3 pt-2 border-b border-gray-200 bg-gray-50">
                {([
                  ["entries", `レコード（${selected0.entryCount.toLocaleString()}）`],
                  ["imports", "取込履歴"],
                  ["deliveries", "配信履歴"],
                  ["settings", "リスト設定"],
                ] as const).map(([k, label]) => (
                  <button key={k} onClick={() => setTab(k)}
                    className={`text-[11.5px] font-bold px-3.5 py-2 rounded-t-lg border border-b-0 ${
                      tab === k ? "text-red-700 bg-white border-gray-200 -mb-px" : "text-gray-400 border-transparent hover:text-gray-600"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {tab === "entries" && (
                <ListEntryTable
                  list={selected0}
                  entries={entries}
                  suppressed={suppressed}
                  withdrawn={withdrawn}
                  filter={filter}
                  onFilter={setFilter}
                  labelOptions={labelOptions}
                  selected={selected}
                  onSelected={setSelected}
                  hasMore={cursor != null}
                  loading={loadingEntries}
                  pageSize={ENTRY_PAGE_SIZE}
                  onLoadMore={() => selectedId != null && loadEntries(selectedId, filter, cursor)}
                  onAdd={() => setEditEntry("new")}
                  onEdit={(e) => setEditEntry(e)}
                  onDeleteSelected={removeSelected}
                  onImport={canImport ? () => setImportOpen(true) : undefined}
                  onExport={canExport ? runExport : undefined}
                  exporting={exporting}
                />
              )}

              {tab === "imports" && (
                <ListImportHistory list={selected0} reloadKey={importedAt} />
              )}

              {tab === "deliveries" && (
                <ListDeliveryHistory list={selected0}
                  /* 送信済みの配信は結果（レポート）を開くのが自然 */
                  onOpenBroadcast={(id) => route.go("broadcast", [id, "report"])} />
              )}

              {tab === "settings" && (
                <ListSettingsPane
                  list={selected0}
                  onSave={saveSettings}
                  onToggleArchive={() => toggleArchive(selected0)}
                  onRematch={runRematch}
                  rematchBusy={rematchBusy}
                  onMerge={canMerge ? () => setMergeOpen(true) : undefined}
                  auditKey={auditKey}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── レコードの手入力モーダル ── */}
      {editEntry != null && selectedId != null && (
        <ListEntryEditModal
          listId={selectedId}
          listName={selected0?.name ?? ""}
          entry={editEntry === "new" ? null : editEntry}
          onClose={() => setEditEntry(null)}
          onSaved={(msg) => { setEditEntry(null); toast.success(msg); reloadEntries(); }}
        />
      )}

      {/* ── 一括取り込みウィザード ── */}
      {importOpen && selected0 != null && (
        <ListImportWizard
          list={selected0}
          onClose={() => setImportOpen(false)}
          onImported={() => { setImportedAt((n) => n + 1); reloadEntries(); }}
        />
      )}

      {/* ── リストの統合（マージ） ── */}
      {mergeOpen && selected0 != null && (
        <ListMergeModal
          dest={selected0}
          lists={lists}
          onClose={() => setMergeOpen(false)}
          onDone={onMerged}
        />
      )}

      {/* ── リスト新規作成モーダル ── */}
      {newListOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[60] p-4"
          onClick={() => setNewListOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 px-4 py-3 bg-[#3f3f46] text-white">
              <Icon name="layers" size={15} />
              <span className="text-[13px] font-bold">リストを新規作成</span>
            </div>
            <div className="p-4 space-y-3">
              <Field label="リスト名" required>
                <input autoFocus className={INPUT} value={newListInput.name}
                  onChange={(e) => setNewListInput({ ...newListInput, name: e.target.value })}
                  placeholder="2026夏 展示会 名刺" />
              </Field>
              <Field label="説明">
                <input className={INPUT} value={newListInput.description}
                  onChange={(e) => setNewListInput({ ...newListInput, description: e.target.value })}
                  placeholder="7/20-22 展示会で取得した名刺データ" />
              </Field>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="備考1">
                  <input className={INPUT} value={newListInput.note1}
                    onChange={(e) => setNewListInput({ ...newListInput, note1: e.target.value })} />
                </Field>
                <Field label="備考2">
                  <input className={INPUT} value={newListInput.note2}
                    onChange={(e) => setNewListInput({ ...newListInput, note2: e.target.value })} />
                </Field>
              </div>
              <Field label="取得元・同意メモ（任意）">
                <input className={INPUT} value={newListInput.consentNote}
                  onChange={(e) => setNewListInput({ ...newListInput, consentNote: e.target.value })}
                  placeholder="ブース掲示の同意文言 v2（2026-07-20〜22 取得）" />
                <p className="text-[10px] text-gray-400 mt-1">
                  広告宣伝メールを送る場合、同意をどう取得したかの記録が必要になります。
                </p>
              </Field>
              <p className="text-[10.5px] text-gray-400">登録日時は自動で記録されます。</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
              <button onClick={() => setNewListOpen(false)}
                className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
              <button onClick={submitNewList} disabled={savingList || !newListInput.name.trim()}
                className="ml-auto text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
                作成する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 小物 ──────────────────────────────────────────────────────
const INPUT =
  "w-full rounded-lg px-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100";

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <div>
      <label className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
