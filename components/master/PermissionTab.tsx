"use client";
// ============================================================
// 権限設定（ロール × 機能）
//   サイドバーと同じジャンルで行をグループ化。
//   ジャンル見出しで折りたたみ／ジャンル単位の一括ON・OFF。
//   管理者は常時ON（誤って自分の権限を落とさないようロック表示）。
// ============================================================
import { Fragment, useState } from "react";
import { NotifyToggle } from "./NotifyToggle";
import { Icon } from "../common/Icon";
import type { IconName } from "../common/Icon";
import {
  roleColumns, FEATURE_GENRES, genreFeatures, orphanFeatures, canFor, isAdminRole,
} from "../../lib/permissions";
import type { FeatureDef, FeatureGenre, PermMap } from "../../lib/permissions";
import { findRole, isDerivedRole } from "../../lib/roles";

/** 機能キー → 表示アイコン（サイドバー準拠） */
const FEATURE_ICON: Record<string, IconName> = {
  home: "home", help: "help",
  content: "content", content_manage: "contentset",
  chat: "chat", ai: "chart",
  notification: "bell", notify: "bellPlus", chatwork: "external",
  dashboard: "dashboard", kanban: "board", gantt: "timeline", calendar: "calendar", bulk_register: "bulk",
  broadcast: "broadcast", scenario: "scenario", form: "form", master: "settings",
  set_member: "users", set_attribute: "tags", set_news: "news", set_source: "globe",
  set_welcome: "chat", set_notify: "bell", set_project: "folder", set_anken: "layers", set_template: "template",
};

const ROLE_SUB: Record<string, string> = {
  "管理者": "固定", "オペレーター": "運営", "メンバー": "顧客", "外部": "ゲスト",
};
/** 列見出しの補足ラベル。派生ロールは「派生」と出す */
const roleSub = (role: string): string =>
  ROLE_SUB[role] ?? (isDerivedRole(role) ? "派生" : "");

export interface PermChange { role: string; feature: string; enabled: boolean }

interface Props {
  perms: PermMap;
  /** 変更をまとめて保存（1件でも配列で渡す） */
  onChange: (changes: PermChange[]) => void;
}

export function PermissionTab({ perms, onChange }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // 列はロールマスタから取る（派生ロールを追加すると列が増える）
  const roles = roleColumns();
  const editRoles = roles.filter((r) => !isAdminRole(r));   // 管理者は編集不可

  const extras = orphanFeatures();
  const genres: (FeatureGenre & { features: FeatureDef[] })[] = [
    ...FEATURE_GENRES.map((g) => ({ ...g, features: genreFeatures(g) })),
    ...(extras.length
      ? [{ id: "other", name: "Other", jp: "その他", keys: extras.map((f) => f.key), features: extras }]
      : []),
  ];

  const toggleOne = (role: string, feature: string) =>
    onChange([{ role, feature, enabled: !canFor(perms, role, feature) }]);

  const bulk = (g: { features: FeatureDef[] }, enabled: boolean) =>
    onChange(editRoles.flatMap((role) => g.features.map((f) => ({ role, feature: f.key, enabled }))));

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        ロールごとに各機能の表示 / 利用可否を切り替えます（管理者のみ操作可）。OFFにすると、そのロールのユーザーには該当メニューや入力項目が表示されません。
        ジャンル見出しをクリックで折りたたみ、「全ON / 全OFF」でジャンル単位の一括切替ができます。変更は即時保存されます。
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            {/* 横スクロールする表なので、固定列（機能）の背景もヘッダー色に合わせる */}
            <tr className="tbl-head">
              <th className="text-left font-medium px-4 py-2.5 sticky left-0 min-w-[210px]"
                style={{ background: "#3f3f46" }}>機能</th>
              {roles.map((role) => (
                <th key={role} className="px-3 py-2 whitespace-nowrap">
                  <div className="flex flex-col items-center leading-tight">
                    <span className="text-xs font-bold">{findRole(role)?.label ?? role}</span>
                    <span className="text-[10px] th-sub">{roleSub(role)}</span>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {genres.map((g) => {
              const total = g.features.length * editRoles.length;
              const on = editRoles.reduce(
                (n, role) => n + g.features.filter((f) => canFor(perms, role, f.key)).length, 0);
              const isClosed = !!closed[g.id];

              return (
                <Fragment key={g.id}>
                  <tr className="bg-gray-50/70 border-b border-gray-100">
                    <td colSpan={roles.length + 1} className="p-0">
                      <div className="flex items-center gap-2.5 px-4 py-2">
                        <button onClick={() => setClosed((c) => ({ ...c, [g.id]: !c[g.id] }))}
                          className="flex items-center gap-2.5 text-left">
                          <span className={`text-[9px] text-gray-400 transition-transform ${isClosed ? "-rotate-90" : ""}`}>▼</span>
                          <span className="text-[11px] font-extrabold tracking-wider uppercase text-gray-600">{g.name}</span>
                          <span className="text-[10.5px] text-gray-400">{g.jp}</span>
                          <span className="text-[10px] text-gray-400 bg-white border border-gray-200 rounded-full px-2 py-0.5">
                            {on} / {total} ON
                          </span>
                        </button>
                        <div className="ml-auto flex gap-1.5">
                          <button onClick={() => bulk(g, true)}
                            className="text-[10.5px] font-bold text-gray-500 border border-gray-200 bg-white rounded-md px-2 py-1 hover:border-red-300 hover:text-red-600">
                            全ON
                          </button>
                          <button onClick={() => bulk(g, false)}
                            className="text-[10.5px] font-bold text-gray-500 border border-gray-200 bg-white rounded-md px-2 py-1 hover:border-red-300 hover:text-red-600">
                            全OFF
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>

                  {!isClosed && g.features.map((f) => (
                    <tr key={f.key} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 sticky left-0 bg-white">
                        <div className="flex items-center gap-2">
                          <span className="w-[18px] text-gray-400 shrink-0">
                            <Icon name={FEATURE_ICON[f.key] ?? "grid"} size={16} />
                          </span>
                          <span className="text-gray-800 font-medium whitespace-nowrap">{f.label}</span>
                          {f.group === "func" && (
                            <span className="text-[10px] text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">機能</span>
                          )}
                        </div>
                      </td>
                      {roles.map((role) => (
                        <td key={role} className="px-3 py-2.5">
                          <div className="flex justify-center">
                            {isAdminRole(role) ? (
                              <span title="管理者は常時ON（変更できません）">
                                <NotifyToggle on disabled onClick={() => undefined} />
                              </span>
                            ) : (
                              <NotifyToggle on={canFor(perms, role, f.key)} onClick={() => toggleOne(role, f.key)} />
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        管理者ロールはすべての機能が常時ONで固定です（トグルは無効表示）。
      </p>
    </div>
  );
}
