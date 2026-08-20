"use client";
// ============================================================
// リスト管理：右ペイン「リスト設定」タブ
//   リスト枠の登録項目（リスト名／説明／備考1・2）を編集する。
//   ⚠️ 登録日時は自動採番のため読み取り専用で表示する（決定事項 No.1）。
// ============================================================
import { useEffect, useState } from "react";
import { fmtJst } from "../../lib/dateFmt";
import type { ContactList } from "../../lib/models";
import type { ContactListInput } from "../../lib/contactLists";
import { ListAuditHistory } from "./ListAuditHistory";

export interface ListSettingsPaneProps {
  list: ContactList;
  onSave: (input: ContactListInput) => void;
  onToggleArchive: () => void;
  /** 名寄せ（会員との再照合）を実行する */
  onRematch: () => void;
  rematchBusy: boolean;
  /** 他リストの統合を開く。権限が無いときは undefined（ボタンを出さない） */
  onMerge?: () => void;
  /** 操作履歴の再読込キー（マージ・エクスポートの直後に増やす） */
  auditKey?: number;
}

const INPUT =
  "w-full rounded-lg px-3 py-2 text-sm bg-gray-50 border border-gray-200 text-gray-800 " +
  "placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-red-400 focus:ring-2 focus:ring-red-100";
const LABEL = "block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5";
const READONLY = "w-full rounded-lg px-3 py-2 text-sm bg-gray-100 border border-gray-200 text-gray-400";

const toInput = (l: ContactList): ContactListInput => ({
  name: l.name,
  description: l.description,
  note1: l.note1,
  note2: l.note2,
  folderId: l.folderId,
  allowDelivery: l.allowDelivery,
  consentNote: l.consentNote,
});

export function ListSettingsPane({
  list, onSave, onToggleArchive, onRematch, rematchBusy, onMerge, auditKey = 0,
}: ListSettingsPaneProps) {
  const [v, setV] = useState<ContactListInput>(() => toInput(list));

  // リストを切り替えたら編集中の値を捨てて選択中リストの値に合わせる
  useEffect(() => { setV(toInput(list)); }, [list]);

  const set = (p: Partial<ContactListInput>) => setV((cur) => ({ ...cur, ...p }));
  const dirty = JSON.stringify(v) !== JSON.stringify(toInput(list));

  return (
    <div className="flex-1 min-h-0 overflow-auto p-4">
      <div className="max-w-2xl">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label className={LABEL}>リスト名<span className="text-red-600 ml-0.5">*</span></label>
            <input className={INPUT} value={v.name} onChange={(e) => set({ name: e.target.value })} />
          </div>
          <div>
            <label className={LABEL}>登録日時（自動）</label>
            <div className={READONLY}>{fmtJst(list.createdAt)}（変更できません）</div>
          </div>
        </div>

        <div className="mb-3">
          <label className={LABEL}>説明</label>
          <input className={INPUT} value={v.description} onChange={(e) => set({ description: e.target.value })}
            placeholder="7/20-22 展示会で取得した名刺データ" />
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

        <div className="mb-3">
          <label className={LABEL}>取得元・同意メモ</label>
          <input className={INPUT} value={v.consentNote} onChange={(e) => set({ consentNote: e.target.value })}
            placeholder="ブース掲示の同意文言 v2（2026-07-20〜22 取得）" />
          <p className="text-[10px] text-gray-400 mt-1">
            広告宣伝メールを送る場合、同意をどう取得したかの記録が必要になります。
          </p>
        </div>

        <label className="flex items-center gap-2 mb-4 cursor-pointer">
          <input type="checkbox" checked={v.allowDelivery} onChange={(e) => set({ allowDelivery: e.target.checked })} />
          <span className="text-[12px] text-gray-700">配信先として選べるようにする</span>
        </label>

        {/* 件数の内訳（読み取り専用） */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
          <p className={LABEL}>件数</p>
          <div className="flex gap-4 flex-wrap text-[12px]">
            <span>合計 <b className="text-base">{list.entryCount.toLocaleString()}</b> 件</span>
            <span className="text-emerald-700">メール可 <b>{list.emailableCount.toLocaleString()}</b></span>
            <span className="text-amber-700">電話のみ <b>{list.phoneOnlyCount.toLocaleString()}</b></span>
          </div>
          {list.emailableCount === 0 && list.entryCount > 0 && (
            <p className="text-[10.5px] text-amber-700 mt-1.5">
              メールアドレスを持つレコードがないため、このリストはメール配信に使えません。
            </p>
          )}
        </div>

        {/* 会員との名寄せ（参照の紐づけのみ。会員マスタは書き換えない） */}
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
          <p className={LABEL}>会員との名寄せ</p>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={onRematch} disabled={rematchBusy}
              className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700
                hover:bg-gray-50 disabled:opacity-50">
              {rematchBusy ? "照合中..." : "会員との紐づけを再実行"}
            </button>
            <span className="text-[10.5px] text-gray-500">
              メールアドレスが一致する会員にレコードを紐づけます。<b>会員情報は書き換えません。</b>
            </span>
          </div>
          <p className="text-[10px] text-gray-400 mt-1.5">
            毎晩の自動処理でも同じ紐づけを行っています（すぐ反映したいときだけ押してください）。
          </p>
        </div>

        {/* 他リストの統合（マージ）。統合元は消さずアーカイブするだけ */}
        {onMerge && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
            <p className={LABEL}>他のリストを統合</p>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={onMerge} disabled={list.isArchived}
                className="text-[11.5px] font-bold px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-gray-700
                  hover:bg-gray-50 disabled:opacity-50">
                このリストに統合する
              </button>
              <span className="text-[10.5px] text-gray-500">
                他リストのレコードをここへコピーします。<b>統合元は削除せずアーカイブ</b>します。
              </span>
            </div>
            {list.isArchived && (
              <p className="text-[10px] text-amber-700 mt-1.5">
                アーカイブ中のリストは統合先にできません。先にアーカイブを解除してください。
              </p>
            )}
          </div>
        )}

        <ListAuditHistory list={list} reloadKey={auditKey} />

        <div className="flex items-center gap-2 pt-3 border-t border-gray-100 flex-wrap">
          <button onClick={() => onSave(v)} disabled={!dirty || !v.name.trim()}
            className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50">
            保存
          </button>
          <button onClick={() => setV(toInput(list))} disabled={!dirty}
            className="text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            元に戻す
          </button>
          <button onClick={onToggleArchive}
            className="ml-auto text-sm px-4 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50">
            {list.isArchived ? "アーカイブを解除" : "このリストをアーカイブ"}
          </button>
        </div>
        <p className="text-[10.5px] text-gray-400 mt-2">
          リストは削除ではなくアーカイブします（過去の配信履歴を壊さないため）。
        </p>
      </div>
    </div>
  );
}
