"use client";
// ============================================================
// リスト管理：操作履歴（Phase 5 ／ 確定事項 A4=a）
//   エクスポート（個人情報の持ち出し）とマージを「誰が・いつ・何件」で残す。
//
//   ⚠️ 追記専用。画面から消す手段は用意しない（監査の意味が無くなるため）。
// ============================================================
import { useEffect, useState } from "react";
import { fmtJst } from "../../lib/dateFmt";
import type { ContactList, ListAudit } from "../../lib/models";
import { fetchListAudits, AUDIT_ACTION_LABEL } from "../../lib/listExport";

const ACTION_CLS: Record<string, string> = {
  export: "bg-red-50 text-red-700 border-red-300",
  merge: "bg-emerald-50 text-emerald-700 border-emerald-300",
  merge_source: "bg-gray-100 text-gray-600 border-gray-300",
};

function detailText(a: ListAudit): string {
  const d = a.detail;
  if (a.action === "export") {
    const scope = d.scope === "filtered" ? "絞り込んだ範囲" : "全件";
    return d.truncated === true ? `${scope}（上限で打ち切り）` : scope;
  }
  if (a.action === "merge") {
    const names = Array.isArray(d.sourceNames) ? (d.sourceNames as unknown[]).map(String) : [];
    const skipped = typeof d.skipped === "number" ? d.skipped : 0;
    const head = names.length > 0 ? names.map((n) => `「${n}」`).join("") : "";
    return skipped > 0 ? `${head} から統合（重複 ${skipped} 件は除外）` : `${head} から統合`;
  }
  if (a.action === "merge_source") {
    const to = typeof d.destName === "string" ? d.destName : "";
    return to ? `「${to}」へ統合された${d.archived === true ? "（アーカイブ済み）" : ""}` : "他リストへ統合された";
  }
  return "";
}

export function ListAuditHistory({ list, reloadKey = 0 }: { list: ContactList; reloadKey?: number }) {
  const [rows, setRows] = useState<ListAudit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetchListAudits(list.id).then((r) => {
      if (!alive) return;
      setRows(r);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [list.id, reloadKey]);

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 mb-4">
      <p className="block text-[10.5px] font-semibold text-gray-400 tracking-wider mb-1.5">操作履歴</p>

      {loading ? (
        <p className="text-[11px] text-gray-400 py-2">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="text-[11px] text-gray-400 py-2">
          このリストへのエクスポート・統合はまだありません。
        </p>
      ) : (
        <div className="max-h-[200px] overflow-auto rounded-md border border-gray-200 bg-white">
          <table className="w-full text-[10.5px]">
            <tbody className="divide-y divide-gray-50">
              {rows.map((a) => (
                <tr key={a.id} className="align-top">
                  <td className="px-2 py-1.5 text-gray-500 whitespace-nowrap">{fmtJst(a.createdAt)}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap">
                    <span className={`text-[9.5px] font-bold rounded-full px-1.5 py-0.5 border ${ACTION_CLS[a.action] ?? ""}`}>
                      {AUDIT_ACTION_LABEL[a.action]}
                    </span>
                  </td>
                  <td className="px-2 py-1.5 text-right text-gray-700 whitespace-nowrap">
                    {a.rowCount.toLocaleString()} 件
                  </td>
                  <td className="px-2 py-1.5 text-gray-500 break-all">{a.actorLabel || "—"}</td>
                  <td className="px-2 py-1.5 text-gray-500">{detailText(a)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[10px] text-gray-400 mt-1.5">
        エクスポートは<b>個人情報の持ち出し</b>にあたるため、実行を必ず記録しています（この履歴は削除できません）。
      </p>
    </div>
  );
}
