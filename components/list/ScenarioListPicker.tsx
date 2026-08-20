"use client";
// ============================================================
// シナリオ配信：宛先リストの選択（Phase 3c）
//   一斉配信の宛先選択と同じ規則・同じ見た目に揃える。
//   ⚠️ 「投入件数」は実データから出す。ここの数字と実際の投入数が
//      食い違うと、運用側が誰に配信が始まったか把握できなくなる。
// ============================================================
import type { ContactList } from "../../lib/models";
import { isSelectableForDelivery, unselectableReason, BREAKDOWN_LABEL } from "../../lib/listRecipients";
import type { ListAudience } from "../../lib/listRecipients";

export interface ScenarioListPickerProps {
  lists: ContactList[];
  selected: number[];
  onToggle: (listId: number) => void;
  audience: ListAudience;
  busy: boolean;
}

export function ScenarioListPicker({ lists, selected, onToggle, audience, busy }: ScenarioListPickerProps) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
        <p className="text-[11px] text-gray-600">
          選んだリストの宛先を投入します。<b>リストに後から追加された人も、自動で順次シナリオが始まります。</b>
          配信停止・電話のみ・重複は自動で除外されます。
        </p>
      </div>

      {lists.length === 0 ? (
        <p className="text-[11px] text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-4 text-center">
          リストがありません。「顧客 ＞ リスト」で作成してください。
        </p>
      ) : (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-[11.5px]">
            <thead>
              <tr className="tbl-head">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-2.5 py-2 text-left font-medium">リスト名</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">総件数</th>
                <th className="px-2 py-2 text-right font-medium whitespace-nowrap">メール可</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {lists.map((l) => {
                const ok = isSelectableForDelivery(l);
                const reason = unselectableReason(l);
                return (
                  <tr key={l.id} className={ok ? "hover:bg-gray-50/60" : "opacity-50"}>
                    <td className="px-2 py-1.5 text-center">
                      <input type="checkbox" checked={selected.includes(l.id)} disabled={!ok}
                        onChange={() => onToggle(l.id)} aria-label={`${l.name} を選択`} />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <b className="text-gray-800">{l.name}</b>
                        {!ok && (
                          <span className="text-[9.5px] font-bold rounded-full px-1.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-300">
                            {reason}
                          </span>
                        )}
                      </div>
                      {l.description && <div className="text-[10px] text-gray-400 truncate">{l.description}</div>}
                    </td>
                    <td className="px-2 py-1.5 text-right font-mono">{l.entryCount.toLocaleString()}</td>
                    <td className="px-2 py-1.5 text-right font-mono text-emerald-700 font-bold">{l.emailableCount.toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected.length > 0 && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          {busy ? (
            <p className="text-[11.5px] text-emerald-800">投入件数を計算しています…</p>
          ) : (
            <>
              <p className="text-[12.5px] font-bold text-emerald-800 mb-1">
                保存時に <span className="text-[17px]">{audience.sendCount.toLocaleString()}</span> 件を投入します
              </p>
              <p className="text-[11px] text-emerald-900 leading-relaxed">
                対象 {audience.targetCount.toLocaleString()} 件 − 除外 {audience.excludedCount.toLocaleString()} 件
                <br />
                {(Object.keys(audience.breakdown) as (keyof typeof audience.breakdown)[])
                  .map((k) => `・${BREAKDOWN_LABEL[k]}：${audience.breakdown[k]} 件`)
                  .join("　")}
              </p>
            </>
          )}
        </div>
      )}

      <p className="text-[10.5px] text-gray-400">
        既に投入済みの宛先は重複して追加されません（進捗は保持されます）。
        差し込み変数は、会員と一致した宛先のみ値が入ります。
      </p>
    </div>
  );
}
