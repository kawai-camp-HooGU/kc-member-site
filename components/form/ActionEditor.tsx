"use client";
// ============================================================
// アクション設定（選択時アクション / 回答後アクション で共通）
//   属性付与・属性解除・シナリオ開始/停止・チャット送信
// ============================================================
import { useState } from "react";
import { AttrCascadePicker } from "../master/AttrCascadePicker";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
import { attrLabel } from "../../lib/members";
import type { FormAction } from "../../lib/models";
import { BROADCAST_VARIABLES } from "../../lib/models";

export interface ScenarioOpt { id: number; name: string }

interface Props {
  actions: FormAction[];
  onChange: (a: FormAction[]) => void;
  tree: AttrNode[];
  index: AttrIndex;
  scenarios: ScenarioOpt[];
  /** チャット送信アクションを使えるか（回答後アクションのみ true 推奨） */
  allowChat?: boolean;
}

const label = "text-[11.5px] font-bold text-gray-600 mb-1.5 block";
const box = "border border-gray-200 rounded-xl p-3 bg-white";

export function ActionEditor({ actions, onChange, tree, index, scenarios, allowChat = true }: Props) {
  const [sid, setSid] = useState("");
  const [chat, setChat] = useState(actions.find((a) => a.type === "chat_message")?.body ?? "");

  const idsOf = (t: "attr_add" | "attr_remove") =>
    actions.filter((a) => a.type === t && a.attrId != null).map((a) => a.attrId as number);

  const setAttrs = (t: "attr_add" | "attr_remove", ids: number[]) => {
    const rest = actions.filter((a) => a.type !== t);
    onChange([...rest, ...ids.map((id) => ({ type: t, attrId: id } as FormAction))]);
  };

  const addScenario = (type: "scenario_start" | "scenario_stop") => {
    const id = Number(sid);
    if (!id) return;
    if (actions.some((a) => a.type === type && a.scenarioId === id)) return;
    onChange([...actions, { type, scenarioId: id }]);
    setSid("");
  };
  const removeAction = (i: number) => onChange(actions.filter((_, idx) => idx !== i));

  const setChatBody = (body: string) => {
    setChat(body);
    const rest = actions.filter((a) => a.type !== "chat_message");
    onChange(body.trim() ? [...rest, { type: "chat_message", body }] : rest);
  };

  const scName = (id?: number) => scenarios.find((s) => s.id === id)?.name ?? `#${id}`;

  return (
    <div className="space-y-3">
      <div className={box}>
        <span className={label}>🏷 属性を付与</span>
        <AttrCascadePicker tree={tree} index={index} value={idsOf("attr_add")}
          onChange={(ids) => setAttrs("attr_add", ids)} emptyLabel="付与する属性なし" />
      </div>

      <div className={box}>
        <span className={label}>🏷 属性を解除</span>
        <AttrCascadePicker tree={tree} index={index} value={idsOf("attr_remove")}
          onChange={(ids) => setAttrs("attr_remove", ids)} emptyLabel="解除する属性なし" />
      </div>

      <div className={box}>
        <span className={label}>🔁 シナリオ配信</span>
        <div className="flex gap-2">
          <select value={sid} onChange={(e) => setSid(e.target.value)}
            className="flex-1 border border-gray-200 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:border-red-400">
            <option value="">（シナリオを選択）</option>
            {scenarios.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="button" onClick={() => addScenario("scenario_start")} disabled={!sid}
            className="px-3 py-2 rounded-lg bg-neutral-800 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-40">開始</button>
          <button type="button" onClick={() => addScenario("scenario_stop")} disabled={!sid}
            className="px-3 py-2 rounded-lg border border-gray-300 text-gray-600 text-xs font-semibold whitespace-nowrap disabled:opacity-40">停止</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {actions.filter((a) => a.type === "scenario_start" || a.type === "scenario_stop").length === 0 && (
            <span className="text-[11.5px] text-gray-400">シナリオ操作なし</span>
          )}
          {actions.map((a, i) =>
            a.type === "scenario_start" || a.type === "scenario_stop" ? (
              <span key={i} className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full ${
                a.type === "scenario_start" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>
                {a.type === "scenario_start" ? "開始" : "停止"}：{scName(a.scenarioId)}
                <button type="button" onClick={() => removeAction(i)} className="text-gray-400 hover:text-red-600">✕</button>
              </span>
            ) : null,
          )}
        </div>
      </div>

      {allowChat && (
        <div className={box}>
          <span className={label}>💬 チャットにメッセージ送信（会員のみ）</span>
          <div className="flex flex-wrap gap-1 mb-1.5">
            {BROADCAST_VARIABLES.map((v) => (
              <button key={v.token} type="button" onClick={() => setChatBody(chat + v.token)}
                className="text-[11px] border border-purple-200 bg-purple-50 text-purple-700 rounded px-1.5 py-0.5 font-semibold">
                {v.token}
              </button>
            ))}
          </div>
          <textarea value={chat} onChange={(e) => setChatBody(e.target.value)}
            placeholder="{{氏名}}さん、ご回答ありがとうございました！"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:border-red-400" />
        </div>
      )}

      {/* 現在の属性アクションの確認表示 */}
      {(idsOf("attr_add").length > 0 || idsOf("attr_remove").length > 0) && (
        <p className="text-[11px] text-gray-400">
          付与：{idsOf("attr_add").map((id) => attrLabel(index, id)).join("、") || "—"} ／
          解除：{idsOf("attr_remove").map((id) => attrLabel(index, id)).join("、") || "—"}
        </p>
      )}
    </div>
  );
}
