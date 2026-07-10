"use client";
import { useEffect, useState } from "react";
import type { ChatThread, MemberMemo, Role } from "../../lib/models";
import { supabase } from "../../lib/supabase";
import { errMessage } from "../../lib/errors";
import { useMaster } from "../../hooks/useMaster";
import { loadAttributeTree } from "../../lib/attributes";
import type { AttrNode } from "../../lib/attributes";
import { buildAttrIndex, saveMemberExtras } from "../../lib/members";
import { MEMBER_ROLES } from "../../lib/seed";
import { MemberExtraFields } from "../master/MemberExtraFields";
import { avatarColor, initial, roleBadge } from "./chatUtils";

export interface CustomerInfoModalProps {
  thread: ChatThread;
  messageCount: number;
  assignedName: string;
  onClose: () => void;
}

const fmtDate = (s?: string) => (s ? s.replace("T", " ").slice(0, 16) : "―");

export function CustomerInfoModal({ thread, messageCount, assignedName, onClose }: CustomerInfoModalProps) {
  const { permission, can, setMembers } = useMaster();
  const m = thread.member;

  // ── 編集フォーム（メンバーマスタ項目に連動。メールは読取専用）──
  const [name, setName] = useState(m.name ?? "");
  const [kana, setKana] = useState(m.kana ?? "");
  const [role, setRole] = useState<string>(m.role ?? "メンバー");
  const [tel, setTel] = useState(m.tel ?? "");
  const [prefecture, setPrefecture] = useState(m.prefecture ?? "");
  const [attrIds, setAttrIds] = useState<number[]>(m.attrIds ?? []);
  const [memos, setMemos] = useState<MemberMemo[]>(m.memos ?? []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [tree, setTree] = useState<AttrNode[]>([]);
  const index = buildAttrIndex(tree);
  useEffect(() => { loadAttributeTree().then(setTree).catch(() => setTree([])); }, []);

  // 付与できるロール（マスタ編集と同一ルール）
  const myRole = permission?.role;
  const assignable = myRole === "admin"
    ? MEMBER_ROLES.filter((r) => r !== "管理者")
    : myRole === "leader"
      ? MEMBER_ROLES.filter((r) => r !== "管理者" && r !== "オペレーター")
      : [];
  const roleOptions = (assignable as string[]).includes(role) ? (assignable as string[]) : [role, ...(assignable as string[])];

  const rb = roleBadge(role as Role);

  const save = async () => {
    if (!name.trim()) { setMsg({ ok: false, text: "氏名は必須です" }); return; }
    setSaving(true); setMsg(null);
    try {
      const updates = {
        name: name.trim(),
        role: role as Role,
        tel: tel.trim() || null,
        prefecture: prefecture || null,
        kana: kana.trim() || null,
      };
      const { error } = await supabase.from("members").update(updates).eq("id", m.id);
      if (error) throw new Error(error.message);
      await saveMemberExtras(m.id, attrIds, memos);
      setMembers((prev) => prev.map((x) => x.id === m.id
        ? { ...x, name: name.trim(), role: role as Role, tel: tel.trim(), prefecture, kana: kana.trim(), attrIds, memos }
        : x));
      setMsg({ ok: true, text: "保存しました" });
    } catch (e) {
      setMsg({ ok: false, text: errMessage(e) });
    } finally {
      setSaving(false);
    }
  };

  // ── AI要約 ──
  const [aiLoading, setAiLoading] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [summary, setSummary] = useState("");
  const summarize = async () => {
    setAiLoading(true); setAiErr(""); setSummary("");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/chat/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ conversationId: thread.conversationId }),
      });
      const json = (await res.json()) as { error?: string; summary?: string };
      if (!res.ok) throw new Error(json.error ?? "要約に失敗しました");
      setSummary(json.summary ?? "");
    } catch (e) {
      setAiErr(errMessage(e));
    } finally {
      setAiLoading(false);
    }
  };

  const inputCls = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-red-400";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-[60] p-5" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-2xl w-full max-w-md max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-200">
          <span className="w-11 h-11 rounded-full grid place-items-center text-white font-bold text-base" style={{ background: avatarColor(m.id) }}>{initial(name || m.name)}</span>
          <div><b className="text-base">{name || m.name}</b> <span className={`ml-1.5 align-middle text-[11px] px-2 py-0.5 rounded-full font-bold ${rb.cls}`}>{rb.label}</span></div>
          <button onClick={onClose} className="ml-auto text-xl text-gray-400 leading-none">✕</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {/* 氏名 ＋ カナ */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 block mb-1">氏名 <span className="text-red-500">*</span></label>
              <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="氏名" />
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 block mb-1">氏名カナ</label>
              <input className={inputCls} value={kana} onChange={(e) => setKana(e.target.value)} placeholder="セイ メイ" />
            </div>
          </div>

          {/* 会員ロール ＋ 電話番号 */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 block mb-1">会員ロール</label>
              <select className={`${inputCls} bg-white`} value={role} onChange={(e) => setRole(e.target.value)} disabled={assignable.length === 0}>
                {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="w-40">
              <label className="text-[11px] text-gray-500 block mb-1">電話番号</label>
              <input type="tel" className={inputCls} value={tel} onChange={(e) => setTel(e.target.value)} placeholder="090-0000-0000" />
            </div>
          </div>

          {/* メール（読取専用）＋ 担当（社内） */}
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-gray-500 block mb-1">メール <span className="text-gray-400 font-normal">変更不可</span></label>
              <input className={`${inputCls} bg-gray-50 text-gray-500`} value={m.email || "―"} readOnly />
            </div>
            <div className="w-40">
              <label className="text-[11px] text-gray-500 block mb-1">担当（社内）</label>
              <input className={`${inputCls} bg-gray-50 text-gray-500`} value={assignedName || "未割当"} readOnly />
            </div>
          </div>

          {/* 都道府県・属性ABC・メモ（マスタと同一UI）*/}
          <MemberExtraFields
            tree={tree} index={index}
            prefecture={prefecture} onPref={setPrefecture}
            attrIds={attrIds} onAttrIds={setAttrIds}
            memos={memos} onMemos={setMemos}
          />

          {/* 参考情報（読取専用）*/}
          <div className="grid grid-cols-2 gap-y-1 gap-x-5 pt-1 border-t border-gray-100">
            <div><div className="text-[11px] text-gray-400">やり取り回数</div><div className="text-[12.5px] font-semibold">{messageCount} 通</div></div>
            <div><div className="text-[11px] text-gray-400">登録日時</div><div className="text-[12.5px] font-semibold">{fmtDate(m.createdAt)}</div></div>
          </div>

          {/* AI要約（AI機能ON時のみ）*/}
          {can("ai") && (
            <div className="border border-red-100 bg-red-50/50 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700">✦ AIでやり取りを要約</span>
                <button onClick={summarize} disabled={aiLoading}
                  className="text-xs font-bold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition-colors">
                  {aiLoading ? "要約中..." : "やり取りを要約"}
                </button>
              </div>
              {aiErr && <p className="text-[11.5px] text-red-500">{aiErr}</p>}
              {summary && <div className="text-[12.5px] text-gray-700 whitespace-pre-wrap bg-white border border-gray-200 rounded-lg p-3 leading-relaxed">{summary}</div>}
              {!summary && !aiErr && !aiLoading && <p className="text-[11px] text-gray-400">顧客とのやり取りを時系列で要約します。</p>}
            </div>
          )}

          <p className="text-[11px] text-gray-400">※ ここでの変更はメンバーマスタに反映されます（メールは設定＞メンバーから変更）。</p>
        </div>

        {/* フッター：保存 */}
        <div className="px-5 py-3 border-t border-gray-200 flex items-center gap-3">
          {msg && <span className={`text-xs ${msg.ok ? "text-green-600" : "text-red-500"}`}>{msg.text}</span>}
          <button onClick={onClose} className="ml-auto text-sm px-4 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">閉じる</button>
          <button onClick={save} disabled={saving}
            className="text-sm px-5 py-2 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50 transition-colors">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
