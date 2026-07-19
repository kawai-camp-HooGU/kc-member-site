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
  visibleRoleColumns, canEditRoleColumn, isAdminLocked, appliesTo,
  FEATURE_GENRES, genreFeatures, orphanFeatures, canFor, isAdminRole,
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
  bookmarks: "book", payment_manage: "doc", payment_master: "doc", payment_admin: "lock",
  set_permission: "shield", set_role: "users",
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
  /** 閲覧者が管理者か。管理者列の表示・編集可否を決める */
  isAdmin: boolean;
}

export function PermissionTab({ perms, onChange, isAdmin }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // 列はロールマスタから取る（派生ロールを追加すると列が増える）。
  //   管理者列は管理者本人にだけ見せる。
  const roles = visibleRoleColumns(isAdmin);
  // 一括ON/OFF の対象は「閲覧者が編集できる列」だけ
  const editRoles = roles.filter((r) => canEditRoleColumn(isAdmin, r));

  const extras = orphanFeatures();
  const genres: (FeatureGenre & { features: FeatureDef[] })[] = [
    ...FEATURE_GENRES.map((g) => ({ ...g, features: genreFeatures(g) })),
    ...(extras.length
      ? [{ id: "other", name: "Other", jp: "その他", keys: extras.map((f) => f.key), features: extras }]
      : []),
  ];

  const toggleOne = (role: string, feature: string) =>
    onChange([{ role, feature, enabled: !canFor(perms, role, feature) }]);

  /** その組み合わせを実際に切り替えられるか（ロック中の管理者機能は除外） */
  const editable = (f: FeatureDef, role: string): boolean =>
    appliesTo(f, role)
    && canEditRoleColumn(isAdmin, role)
    && !(isAdminRole(role) && isAdminLocked(f.key));

  const bulk = (g: { features: FeatureDef[] }, enabled: boolean) =>
    onChange(editRoles.flatMap((role) =>
      g.features
        // ⚠️ 適用外・ロック中の組み合わせを含めると、画面は「－」なのに
        //    DB には true が書き込まれるという不整合が起きる
        .filter((f) => editable(f, role))
        .map((f) => ({ role, feature: f.key, enabled }))));

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        ロールごとに各機能の表示 / 利用可否を切り替えます。OFFにすると、そのロールのユーザーには該当メニューや入力項目が表示されません。
        ジャンル見出しをクリックで折りたたみ、「全ON / 全OFF」でジャンル単位の一括切替ができます。変更は即時保存されます。
        {!isAdmin && (
          <><br />運営ロール（オペレーター・その派生）の権限は管理者のみが変更できます。ここでは会員ロールの設定のみ行えます。</>
        )}
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
              // 「N / M ON」は適用対象の組み合わせだけで数える。
              //   「－」の組み合わせを分母に含めると、全ONにしても満数にならず紛らわしい。
              const cells = editRoles.flatMap((role) =>
                g.features.filter((f) => appliesTo(f, role)).map((f) => ({ role, f })));
              const total = cells.length;
              const on = cells.filter(({ role, f }) => canFor(perms, role, f.key)).length;
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

                  {!isClosed && g.features.map((f) => {
                    // 画面＝青バー・太字 / 機能＝紫バー・インデント。
                    //   親子関係を視覚的に見せることで「画面はOFFなのに機能はON」という
                    //   矛盾に気づけるようにする。
                    const isFunc = f.group === "func";
                    return (
                    <tr key={f.key} className={`hover:bg-gray-50/60 ${isFunc ? "" : "border-t border-gray-100"}`}>
                      <td className={`sticky left-0 bg-white ${isFunc ? "pl-14 pr-4 py-2" : "px-4 py-2.5"}`}>
                        <div className="flex items-center gap-2 relative">
                          {/* 階層バー */}
                          <span className={`absolute -left-3 rounded-sm ${
                            isFunc ? "w-[3px] h-[18px] bg-violet-400" : "w-[4px] h-[20px] bg-blue-500"}`} />
                          <span className="w-[18px] text-gray-400 shrink-0">
                            <Icon name={FEATURE_ICON[f.key] ?? "grid"} size={16} />
                          </span>
                          <span className={`whitespace-nowrap ${
                            isFunc ? "text-gray-700" : "text-gray-900 font-bold"}`}>{f.label}</span>
                          <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 border ${
                            isFunc
                              ? "text-violet-600 bg-violet-50 border-violet-200"
                              : "text-blue-600 bg-blue-50 border-blue-200"}`}>
                            {isFunc ? "機能" : "画面"}
                          </span>
                        </div>
                      </td>
                      {roles.map((role) => (
                        <td key={role} className="px-3 py-2.5">
                          <div className="flex justify-center">
                            {!appliesTo(f, role) ? (
                              // そのロールには概念として存在しない機能。トグルを出さない。
                              //   例：運営専用の一斉配信をメンバーにONにしても、
                              //       ゾーン判定とRLSで表示されないため意味を持たない。
                              <span className="text-gray-300 font-bold text-[15px] tracking-widest"
                                    title={f.scope === "ops"
                                      ? "運営専用のため、会員ロールには適用されません"
                                      : "会員専用のため、運営ロールには適用されません"}>－</span>
                            ) : isAdminRole(role) && isAdminLocked(f.key) ? (
                              // ロックアウト防止：管理者の「設定」「ホーム」は落とせない
                              <span title="この機能をOFFにすると設定画面へ戻れなくなるため、管理者は常時ONです">
                                <NotifyToggle on disabled onClick={() => undefined} />
                              </span>
                            ) : !canEditRoleColumn(isAdmin, role) ? (
                              // オペレーターから見た運営ロール列は読み取り専用
                              <span title="運営ロールの権限は管理者のみが変更できます">
                                <NotifyToggle on={canFor(perms, role, f.key)} disabled onClick={() => undefined} />
                              </span>
                            ) : (
                              <NotifyToggle on={canFor(perms, role, f.key)} onClick={() => toggleOne(role, f.key)} />
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                    );
                  })}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        {isAdmin
          ? "管理者ロールの「ホーム」「設定（マスタ管理）」は常時ONで固定です。OFFにすると設定画面へ戻れなくなるため、変更できません。"
          : "管理者ロールの列は表示されません。運営ロールの列は参照のみで、変更できるのは会員ロール（メンバー・外部）の列だけです。"}
      </p>
    </div>
  );
}
