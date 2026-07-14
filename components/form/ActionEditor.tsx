"use client";
// ============================================================
// アクション設定（選択時アクション / 回答後アクション で共通）
//   属性付与・属性解除・シナリオ開始/停止・チャット送信
// ============================================================
import { useState } from "react";
import { AttrTable } from "../master/AttrTable";
import type { AttrNode } from "../../lib/attributes";
import type { AttrIndex } from "../../lib/members";
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
  /**
   * 「会員登録（外部ロール）」を出すか。
   *   フォームの回答後アクション専用。流入経路のように「既に会員が特定できている」
   *   文脈では意味を持たないので false にする。
   */
  allowSignup?: boolean;
}

const label = "text-[11.5px] font-bold text-gray-600 mb-1.5 block";
const box = "border border-gray-200 rounded-xl p-3 bg-white";

export function ActionEditor({
  actions, onChange, tree, index, scenarios, allowChat = true, allowSignup = true,
}: Props) {
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

  const signupOn = actions.some((a) => a.type === "member_signup");
  const toggleSignup = (on: boolean) => {
    const rest = actions.filter((a) => a.type !== "member_signup");
    onChange(on ? [...rest, { type: "member_signup" } as FormAction] : rest);
  };

  return (
    <div className="space-y-3">
      {/* 属性は「顧客詳細画面」と同じ表表示（AttrTable）に揃える。
          チップの羅列だと A ＞ B ＞ C の階層が読み取れず、どの属性を付けているのか分かりにくかった。 */}
      <div className={box}>
        <span className={label}>🏷 属性を付与</span>
        <AttrTable tree={tree} index={index} value={idsOf("attr_add")}
          onChange={(ids) => setAttrs("attr_add", ids)} addLabel="＋ 付与する属性を追加" />
      </div>

      <div className={box}>
        <span className={label}>🏷 属性を解除</span>
        <AttrTable tree={tree} index={index} value={idsOf("attr_remove")}
          onChange={(ids) => setAttrs("attr_remove", ids)} addLabel="＋ 解除する属性を追加" />
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

      {allowChat && allowSignup && (
        <div className="border-2 border-teal-200 rounded-xl p-3 bg-teal-50/50">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-4 h-4 accent-teal-600"
              checked={signupOn} onChange={(e) => toggleSignup(e.target.checked)} />
            <span>
              <span className="text-[12.5px] font-bold text-teal-900">👤 会員登録（外部ロール）</span>
              <span className="block text-[11px] text-teal-700 mt-0.5 leading-relaxed">
                未ログインの回答者を「外部」ロールの会員として登録します。パスワードレスのため、
                送信完了と同時にポータルへ入れます（メールは送りません／外部ロールの権限と属性の範囲のみ）。
              </span>
              {signupOn && (
                <span className="block text-[10.5px] text-gray-500 mt-1.5 leading-relaxed">
                  ※ メールアドレスの取得元：<b>登録先＝メール</b> を設定した設問（無ければゲスト入力欄）。<br />
                  ※ すでに登録済みのメールのときは何もしません（既存アカウントは変更されません）。<br />
                  ※ 上の「属性を付与」と併用すると、流入元に応じた属性を付けた状態で登録できます。
                </span>
              )}
            </span>
          </label>
        </div>
      )}

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

      {/* 属性の内訳は上の AttrTable にそのまま出ているため、テキストでの再掲は廃止した */}
    </div>
  );
}
