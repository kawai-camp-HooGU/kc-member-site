"use client";
// ============================================================
// リスト管理：レコードの手入力（1件ずつ／まとめて貼り付け）
//   ・メールアドレス・電話番号のどちらか一方が必須
//   ・登録前に重複チェックを掛け、対象行はエラー／スキップとして弾く
//     （同一リスト内の重複と配信停止リストを照合。他リストは見ない）
//   ・貼り付けモードは件数の内訳と理由を先に見せてから登録する
// ============================================================
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../common/Icon";
import type { DupCheckRow, ListEntry } from "../../lib/models";
import {
  AGE_GROUPS, PREFECTURES, EMPTY_ENTRY_INPUT,
  checkEntries, addListEntries, updateListEntry, parseContactPaste,
  normalizeEmail, normalizePhone, consentAtToDateInput,
  LABEL_MAX, LINE_NAME_MAX, LINE_UID_RE, labelLength, normalizeLabel,
} from "../../lib/contactLists";
import type { EntryInput } from "../../lib/contactLists";

export interface ListEntryEditModalProps {
  listId: number;
  listName: string;
  /** null = 新規追加 */
  entry: ListEntry | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

type Mode = "single" | "paste";

const INPUT =
  "w-full rounded-lg px-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100";
const LABEL = "block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5";

export function ListEntryEditModal({ listId, listName, entry, onClose, onSaved }: ListEntryEditModalProps) {
  const isEdit = entry != null;
  const [mode, setMode] = useState<Mode>("single");
  const [busy, setBusy] = useState(false);

  const [v, setV] = useState<EntryInput>(() =>
    entry
      ? {
          email: entry.email, phone: entry.phone, name: entry.name,
          ageGroup: entry.ageGroup, prefecture: entry.prefecture,
          note1: entry.note1, note2: entry.note2,
          consentAt: consentAtToDateInput(entry.consentAt), consentSrc: entry.consentSrc,
          label: entry.label, lineDisplayName: entry.lineDisplayName, lineUserId: entry.lineUserId,
        }
      : EMPTY_ENTRY_INPUT,
  );

  const [paste, setPaste] = useState("");
  /** 検証結果（1件モードは先頭1行だけを見る） */
  const [rows, setRows] = useState<DupCheckRow[]>([]);
  const [checking, setChecking] = useState(false);

  const set = (p: Partial<EntryInput>) => setV((cur) => ({ ...cur, ...p }));

  // ── 文字数（REQ-049）──
  //   ⚠️ Array.from で数える。v.length だと絵文字が2文字に数えられ、
  //      画面の残り文字数と保存可否がずれる。
  const labelRemain = LABEL_MAX - labelLength(normalizeLabel(v.label));
  const lineNameRemain = LINE_NAME_MAX - labelLength((v.lineDisplayName ?? "").trim());
  const lineUid = (v.lineUserId ?? "").trim();
  const lineUidOdd = lineUid !== "" && !LINE_UID_RE.test(lineUid);

  // ── 入力の形式チェック（サーバーに行く前にその場で出す）──
  const localError = useMemo(() => {
    const e = v.email.trim();
    const p = v.phone.trim();
    if (!e && !p) return "メールアドレス・電話番号のどちらか一方は必須です";
    if (e && !normalizeEmail(e)) return "メールアドレスの形式が正しくありません";
    if (p && !normalizePhone(p)) return "電話番号の形式が正しくありません（数字10〜15桁）";
    // REQ-049。上限は**保存を止めて知らせる**（黙って切り詰めない）
    if (labelRemain < 0) return `ラベルは${LABEL_MAX}文字までです`;
    if (lineNameRemain < 0) return `LINEアカウント名は${LINE_NAME_MAX}文字までです`;
    return "";
  }, [v.email, v.phone, labelRemain, lineNameRemain]);

  const e164 = useMemo(() => normalizePhone(v.phone), [v.phone]);

  // ── 重複チェック（1件モード：入力が止まってから照会する）──
  const runCheckSingle = useCallback(async () => {
    if (isEdit || localError) { setRows([]); return; }
    setChecking(true);
    setRows(await checkEntries(listId, [v]));
    setChecking(false);
  }, [isEdit, localError, listId, v]);

  useEffect(() => {
    if (mode !== "single") return;
    const t = setTimeout(() => { runCheckSingle(); }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, v.email, v.phone, isEdit, localError]);

  // ── 重複チェック（貼り付けモード）──
  const parsed = useMemo(() => parseContactPaste(paste), [paste]);
  const runCheckPaste = useCallback(async () => {
    if (parsed.length === 0) { setRows([]); return; }
    setChecking(true);
    setRows(await checkEntries(listId, parsed));
    setChecking(false);
  }, [listId, parsed]);

  useEffect(() => {
    if (mode !== "paste") return;
    const t = setTimeout(() => { runCheckPaste(); }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, paste]);

  const stats = useMemo(() => ({
    total: rows.length,
    insert: rows.filter((r) => r.verdict === "insert").length,
    skip: rows.filter((r) => r.verdict === "skip").length,
    error: rows.filter((r) => r.verdict === "error").length,
  }), [rows]);

  const singleVerdict = mode === "single" ? rows[0] ?? null : null;
  const canSubmit = isEdit
    ? !localError && !busy
    : mode === "single"
      ? !localError && !busy && !checking && singleVerdict?.verdict === "insert"
      : !busy && !checking && stats.insert > 0;

  /** 保存時のサーバー側エラー（重複など）。モーダルは閉じずに理由を見せる。 */
  const [saveError, setSaveError] = useState("");

  // ── 保存 ──
  const submit = async () => {
    setBusy(true);
    setSaveError("");
    if (isEdit && entry) {
      const res = await updateListEntry(entry.id, listId, v);
      setBusy(false);
      if (res.ok) onSaved("レコードを更新しました");
      else setSaveError(res.error);
      return;
    }
    const n = await addListEntries(listId, rows, "manual");
    setBusy(false);
    if (n > 0) { onSaved(`${n} 件を追加しました`); return; }
    setSaveError("追加できるレコードがありませんでした（重複または形式エラー）");
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end md:items-center justify-center z-[60] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 bg-[#3f3f46] text-white">
          <Icon name="users" size={15} />
          <span className="text-[13px] font-bold">
            {isEdit ? "レコードを編集" : "レコードを手入力で追加"}
          </span>
          <span className="ml-auto text-[10.5px] text-gray-300 truncate max-w-[45%]">{listName}</span>
        </div>

        <div className="flex-1 min-h-0 overflow-auto p-4">
          {/* モード切替（新規のときだけ） */}
          {!isEdit && (
            <div className="flex gap-2 mb-3">
              {([["single", "1件ずつ入力"], ["paste", "まとめて貼り付け"]] as const).map(([k, label]) => (
                <button key={k} onClick={() => { setMode(k); setRows([]); }}
                  className={`text-[11.5px] px-3 py-1.5 rounded-lg border ${
                    mode === k ? "border-red-500 bg-red-50 text-red-700 font-bold" : "border-gray-200 bg-white text-gray-600"}`}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {(isEdit || mode === "single") && (
            <>
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 mb-3">
                <p className="text-[11px] text-red-800">
                  <b>メールアドレス・電話番号のどちらか一方は必須</b>です。
                </p>
              </div>

              <div className="mb-3">
                <label className={LABEL}>メールアドレス<span className="text-red-600 ml-0.5">*</span></label>
                <input autoFocus className={INPUT} value={v.email} onChange={(e) => set({ email: e.target.value })}
                  placeholder="t.yamada@example.co.jp" inputMode="email" />
                {singleVerdict && singleVerdict.verdict !== "insert" && (
                  <p className={`text-[10.5px] mt-1 ${singleVerdict.verdict === "error" ? "text-red-600" : "text-amber-700"}`}>
                    {singleVerdict.reason}
                  </p>
                )}
              </div>

              <div className="mb-3">
                <label className={LABEL}>電話番号<span className="text-red-600 ml-0.5">*</span></label>
                <input className={INPUT} value={v.phone} onChange={(e) => set({ phone: e.target.value })}
                  placeholder="090-1234-5678" inputMode="tel" />
                {e164 && (
                  <p className="text-[10px] text-gray-400 mt-1">
                    保存時に <span className="font-mono">{e164}</span> に正規化されます
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL}>氏名</label>
                  <input className={INPUT} value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="山田 太郎" />
                </div>
                <div>
                  <label className={LABEL}>年代</label>
                  <select className={INPUT} value={v.ageGroup} onChange={(e) => set({ ageGroup: e.target.value })}>
                    <option value="">選択してください</option>
                    {AGE_GROUPS.map((a) => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
              </div>

              <div className="mb-3">
                <label className={LABEL}>都道府県</label>
                <select className={INPUT} value={v.prefecture} onChange={(e) => set({ prefecture: e.target.value })}>
                  <option value="">選択してください</option>
                  {PREFECTURES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL}>備考1</label>
                  <input className={INPUT} value={v.note1} onChange={(e) => set({ note1: e.target.value })} />
                </div>
                <div>
                  <label className={LABEL}>備考2</label>
                  <input className={INPUT} value={v.note2} onChange={(e) => set({ note2: e.target.value })} />
                </div>
              </div>

              {/* ラベル・LINE（REQ-049）。マスタは持たず、その場の任意入力で完結させる */}
              <div className="mb-3">
                <label className={LABEL}>ラベル</label>
                <input className={INPUT} value={v.label} onChange={(e) => set({ label: e.target.value })}
                  placeholder="説明会参加" />
                <div className="flex mt-1 text-[10px]">
                  <span className="text-gray-400">マスタはありません。自由に入力できます</span>
                  <span className={`ml-auto ${labelRemain < 0 ? "text-red-600 font-bold" : "text-gray-400"}`}>
                    残り {labelRemain} 文字
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
                <div>
                  <label className={LABEL}>LINEアカウント名</label>
                  <input className={INPUT} value={v.lineDisplayName}
                    onChange={(e) => set({ lineDisplayName: e.target.value })} placeholder="いちろう＠副業" />
                  <div className="flex mt-1 text-[10px]">
                    <span className={`ml-auto ${lineNameRemain < 0 ? "text-red-600 font-bold" : "text-gray-400"}`}>
                      残り {lineNameRemain} 文字
                    </span>
                  </div>
                </div>
                <div>
                  <label className={LABEL}>LINE ID</label>
                  <input className={`${INPUT} font-mono text-[11.5px]`} value={v.lineUserId}
                    onChange={(e) => set({ lineUserId: e.target.value })}
                    placeholder="U1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6" />
                  {/* ⚠️ 形式が違っても保存は止めない（他システムのIDを暫定で入れる運用を殺さない） */}
                  {lineUidOdd && (
                    <p className="text-[10px] text-amber-700 mt-1">
                      LINEのIDは U ではじまる33文字（U＋32文字）です。このまま保存もできます。
                    </p>
                  )}
                </div>
              </div>

              {/* 同意の記録（レコード単位）。特定電子メール法の根拠として残す */}
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-3">
                <p className={LABEL}>同意の記録（任意）</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">同意日時</label>
                    <input type="date" className={INPUT} value={v.consentAt}
                      onChange={(e) => set({ consentAt: e.target.value })} />
                  </div>
                  <div>
                    <label className="block text-[10px] text-gray-500 mb-1">同意取得元</label>
                    <input className={INPUT} value={v.consentSrc}
                      onChange={(e) => set({ consentSrc: e.target.value })}
                      placeholder="展示会ブース掲示 v2" />
                  </div>
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">
                  リスト単位の同意メモとは別に、<b>レコードごと</b>に残せます（人によって取得元が違う場合に使います）。
                  CSVエクスポートに含まれます。
                </p>
              </div>

              {!isEdit && (
                <p className="text-[10.5px] text-gray-400">登録日時は自動で記録されます。</p>
              )}
              {localError && <p className="text-[11px] text-red-600 mt-2">{localError}</p>}
            </>
          )}

          {!isEdit && mode === "paste" && (
            <>
              <div className="mb-3">
                <label className={LABEL}>メールアドレス／電話番号（改行・カンマ・タブ区切り）</label>
                <textarea autoFocus rows={7} value={paste} onChange={(e) => setPaste(e.target.value)}
                  placeholder={"n.kobayashi@example.jp\nyuki.m@example.com\n090-3333-4444"}
                  className={`${INPUT} font-mono text-[11.5px] leading-relaxed resize-y`} />
                <p className="text-[10px] text-gray-400 mt-1">
                  @ を含むものはメールアドレス、含まないものは電話番号として取り込みます。氏名などの任意項目は後から編集できます。
                </p>
              </div>

              {parsed.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex gap-2 flex-wrap mb-2">
                    <Chip cls="bg-gray-100 text-gray-600 border-gray-200">{stats.total} 件</Chip>
                    <Chip cls="bg-emerald-50 text-emerald-700 border-emerald-300">追加 {stats.insert}</Chip>
                    <Chip cls="bg-amber-50 text-amber-700 border-amber-300">スキップ {stats.skip}</Chip>
                    <Chip cls="bg-red-50 text-red-700 border-red-300">エラー {stats.error}</Chip>
                    {checking && <span className="text-[10px] text-gray-400 self-center">照合中...</span>}
                  </div>

                  {rows.filter((r) => r.verdict !== "insert").length > 0 && (
                    <div className="max-h-[168px] overflow-auto rounded-md border border-gray-200 bg-white">
                      <table className="w-full text-[10.5px]">
                        <tbody className="divide-y divide-gray-50">
                          {rows.filter((r) => r.verdict !== "insert").map((r) => (
                            <tr key={r.no} className={r.verdict === "error" ? "bg-red-50/60" : "bg-amber-50/60"}>
                              <td className="px-2 py-1 text-gray-400 w-8">{r.no}</td>
                              <td className="px-2 py-1 font-mono break-all">{r.input.email || r.input.phone}</td>
                              <td className="px-2 py-1 text-gray-600">{r.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-t border-gray-200 bg-gray-50">
          <button onClick={onClose}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">キャンセル</button>
          <span className={`ml-auto text-[10.5px] ${saveError ? "text-red-600 font-bold" : "text-gray-400"}`}>
            {saveError || (
              <>
                {!isEdit && mode === "paste" && stats.insert > 0 && `${stats.insert} 件を追加します`}
                {!isEdit && mode === "single" && checking && "重複を照合中..."}
              </>
            )}
          </span>
          <button onClick={submit} disabled={!canSubmit}
            className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
            {isEdit ? "保存する" : "追加する"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip({ cls, children }: { cls: string; children: ReactNode }) {
  return <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 border ${cls}`}>{children}</span>;
}
