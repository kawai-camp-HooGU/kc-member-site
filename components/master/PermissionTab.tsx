"use client";
// ============================================================
// 権限設定（ロール × 機能）─ 2 ペイン版（2026-07 リデザイン）
//
//   左＝親カテゴリ（管理ドメイン）／右＝子画面・子機能。
//   ・「全ロール一覧」= ロールを列に並べたマトリクス（既定）
//   ・「ロール別」    = 1 ロールに集中。効果は案A（状態追従の色付きテキスト）
//   ・変更は溜めて「保存する」で確定（onChange に PermChange[] をまとめて渡す）
//
//   ★Phase 2: LINE/メールの「アカウント単位」権限（account_role_access）に対応。
//     account/notif 機能では「ロール別」ビューでアカウントごとの
//     アクセス（操作/閲覧/非表示）・通知（通知/停止）を設定できる。
//     accounts / accountAccess / onAccountChange を渡さなければ従来どおり動作する。
//
//   管理者は master/home を常時ONロック。オペレーターは会員側ロールのみ編集可。
// ============================================================
import { Fragment, useMemo, useState } from "react";
import {
  FEATURE_CATEGORIES, categoryFeatures, appliesTo,
  visibleRoleColumns, canEditRoleColumn, isAdminLocked, isAdminRole, permKey,
} from "../../lib/permissions";
import type { FeatureDef, PermMap } from "../../lib/permissions";
import {
  accKey, defaultAccess, type AccountAccess, type AccountAccessMap, type AccountAccessRow, type AccountType,
} from "../../lib/accountAccess";
import { findRole, isDerivedRole } from "../../lib/roles";

export interface PermChange { role: string; feature: string; enabled: boolean }
export interface AccountRef { id: number; name: string }

interface Props {
  perms: PermMap;
  /** ロール×機能の変更をまとめて保存 */
  onChange: (changes: PermChange[]) => void;
  /** 閲覧者が管理者か */
  isAdmin: boolean;
  /** LINE/メールのアカウント一覧（未指定ならアカウント行は出さない） */
  accounts?: { line: AccountRef[]; mail: AccountRef[] };
  /** アカウント単位権限の現在値 */
  accountAccess?: AccountAccessMap;
  /** アカウント単位権限の変更をまとめて保存 */
  onAccountChange?: (rows: AccountAccessRow[]) => void;
}

const ROLE_SUB: Record<string, string> = {
  "管理者": "固定", "オペレーター": "運営", "メンバー": "顧客", "外部": "ゲスト",
};
const roleSub = (role: string): string =>
  ROLE_SUB[role] ?? (isDerivedRole(role) ? "派生" : "");

// ── 小物 ─────────────────────────────────────────────────────
function Tg({ on, disabled, dirty, onClick }: {
  on: boolean; disabled?: boolean; dirty?: boolean; onClick?: () => void;
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full align-middle transition
        ${on ? "bg-green-500" : "bg-gray-300"}
        ${disabled ? "opacity-60 cursor-default" : "cursor-pointer"}
        ${dirty ? "ring-2 ring-amber-400" : ""}`}>
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all
        ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
function Badges({ f }: { f: FeatureDef }) {
  return (
    <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 border align-middle ${
      f.group === "func"
        ? "text-violet-600 bg-violet-50 border-violet-200"
        : "text-blue-600 bg-blue-50 border-blue-200"}`}>
      {f.group === "func" ? "機能" : "画面"}
    </span>
  );
}
function SecTags({ f }: { f: FeatureDef }) {
  return (
    <>
      {f.proposed && <span className="ml-1.5 text-[9px] font-bold text-white bg-blue-500 rounded px-1 py-0.5 align-middle">新</span>}
      {f.security && <span className="ml-1.5 text-[9px] font-bold text-white bg-rose-600 rounded px-1 py-0.5 align-middle">高</span>}
      {f.account && <span className="ml-1.5 text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 align-middle">アカウント別</span>}
    </>
  );
}

export function PermissionTab({ perms, onChange, isAdmin, accounts, accountAccess, onAccountChange }: Props) {
  const roles = visibleRoleColumns(isAdmin);
  const [mode, setMode] = useState<"all" | "role">("all");
  const [curCat, setCurCat] = useState<string>(FEATURE_CATEGORIES[0].id);
  const [curRole, setCurRole] = useState<string>(roles.find((r) => !isAdminRole(r)) ?? roles[0]);
  // 保存前の下書き
  const [draft, setDraft] = useState<Record<string, boolean>>({});           // permKey -> enabled
  const [accDraft, setAccDraft] = useState<Record<string, AccountAccess>>({}); // accKey -> access

  const base = (role: string, key: string): boolean => !!perms[permKey(role, key)];
  const cur = (role: string, key: string): boolean => {
    const k = permKey(role, key);
    return k in draft ? draft[k] : base(role, key);
  };
  const locked = (role: string, f: FeatureDef): boolean =>
    isAdminRole(role) && isAdminLocked(f.key);
  const editable = (role: string, f: FeatureDef): boolean =>
    appliesTo(f, role) && canEditRoleColumn(isAdmin, role) && !locked(role, f);

  const dirtyPermKeys = useMemo(
    () => Object.keys(draft).filter((k) => draft[k] !== !!perms[k]),
    [draft, perms]
  );
  const accDirtyKeys = Object.keys(accDraft);
  const dirtyTotal = dirtyPermKeys.length + accDirtyKeys.length;
  const isDirty = (role: string, key: string) => permKey(role, key) in draft;

  const toggle = (role: string, f: FeatureDef) => {
    if (!editable(role, f)) return;
    const k = permKey(role, f.key);
    const nv = !cur(role, f.key);
    setDraft((d) => {
      const nd = { ...d };
      if (nv === base(role, f.key)) delete nd[k]; else nd[k] = nv;
      return nd;
    });
  };

  // ── アカウント単位 ──
  const accountsFor = (f: FeatureDef): AccountRef[] => {
    if (!accounts || !f.account) return [];
    return f.account === "line" ? accounts.line : accounts.mail;
  };
  const accPersisted = (f: FeatureDef, role: string, id: number): AccountAccess => {
    const k = accKey(f.key, f.account as AccountType, id, role);
    if (accountAccess && k in accountAccess) return accountAccess[k];
    return defaultAccess(!!f.notif, base(role, f.key), isAdminRole(role));
  };
  const accCur = (f: FeatureDef, role: string, id: number): AccountAccess => {
    const k = accKey(f.key, f.account as AccountType, id, role);
    return k in accDraft ? accDraft[k] : accPersisted(f, role, id);
  };
  const accIsDirty = (f: FeatureDef, role: string, id: number) =>
    accKey(f.key, f.account as AccountType, id, role) in accDraft;
  const setAcc = (f: FeatureDef, role: string, id: number, value: AccountAccess) => {
    if (!canEditRoleColumn(isAdmin, role)) return;
    const k = accKey(f.key, f.account as AccountType, id, role);
    setAccDraft((d) => {
      const nd = { ...d };
      if (value === accPersisted(f, role, id)) delete nd[k]; else nd[k] = value;
      return nd;
    });
  };

  const save = () => {
    const permChanges: PermChange[] = dirtyPermKeys.map((k) => {
      const i = k.indexOf("::");
      return { role: k.slice(0, i), feature: k.slice(i + 2), enabled: draft[k] };
    });
    const accChanges: AccountAccessRow[] = accDirtyKeys.map((k) => {
      const [feature, type, idStr, role] = k.split("::");
      return { feature, accountType: type as AccountType, accountId: Number(idStr), roleKey: role, access: accDraft[k] };
    });
    if (permChanges.length) onChange(permChanges);
    if (accChanges.length && onAccountChange) onAccountChange(accChanges);
    setDraft({});
    setAccDraft({});
  };
  const discard = () => { setDraft({}); setAccDraft({}); };

  const catCount = (catId: string) => {
    const feats = categoryFeatures(catId);
    const rs = mode === "all" ? roles : [curRole];
    let on = 0, tot = 0;
    feats.forEach((f) => rs.forEach((r) => {
      if (appliesTo(f, r)) { tot++; if (locked(r, f) || cur(r, f.key)) on++; }
    }));
    return { on, tot };
  };

  const curFeats = categoryFeatures(curCat);
  const curCatDef = FEATURE_CATEGORIES.find((c) => c.id === curCat)!;
  const hasAccounts = !!accounts;

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-400 leading-relaxed">
        左でカテゴリを選び、右で各機能の表示 / 利用可否をロールごとに切り替えます。
        変更は溜まり、上部の<b className="text-red-500">「保存する」</b>で確定します（<span className="text-amber-600 font-bold">オレンジ枠</span>＝未保存）。
        {hasAccounts && <>「アカウント別」機能は<b>「ロール別」</b>ビューでアカウント単位の割当を設定できます。</>}
        {!isAdmin && (<><br />運営ロールの権限は管理者のみ変更できます。ここでは会員ロールの設定のみ行えます。</>)}
      </p>

      {/* 表示モード＋（ロール別時）ロール選択 */}
      <div className="flex flex-wrap items-center gap-2 bg-white border border-gray-200 rounded-xl px-3 py-2">
        <span className="text-xs font-bold text-gray-500">表示</span>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
          <button type="button" onClick={() => setMode("all")}
            className={`text-xs font-bold px-3 py-1.5 ${mode === "all" ? "bg-zinc-800 text-white" : "bg-white text-gray-500"}`}>全ロール一覧</button>
          <button type="button" onClick={() => setMode("role")}
            className={`text-xs font-bold px-3 py-1.5 border-l border-gray-200 ${mode === "role" ? "bg-zinc-800 text-white" : "bg-white text-gray-500"}`}>ロール別</button>
        </div>
        {mode === "role" && (
          <>
            <span className="text-xs font-bold text-gray-500 ml-2">対象ロール</span>
            {roles.map((r) => (
              <button key={r} type="button" onClick={() => setCurRole(r)}
                className={`text-xs font-bold rounded-full px-3 py-1 border ${
                  r === curRole ? "bg-red-500 text-white border-red-500" : "bg-white text-gray-500 border-gray-200 hover:border-red-300"}`}>
                {findRole(r)?.label ?? r}<span className="text-[9px] opacity-70 ml-1">{roleSub(r)}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* 保存バー */}
      {dirtyTotal > 0 && (
        <div className="sticky top-1 z-20 flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 shadow-sm">
          <span className="text-xs font-bold text-amber-800">未保存の変更 <b className="text-amber-600 text-sm">{dirtyTotal}</b> 件</span>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={discard} className="text-xs font-bold text-gray-500 border border-gray-200 bg-white rounded-lg px-4 py-1.5 hover:border-gray-300">変更を破棄</button>
            <button type="button" onClick={save} className="text-xs font-bold text-white bg-red-500 border border-red-500 rounded-lg px-4 py-1.5 hover:opacity-90">保存する</button>
          </div>
        </div>
      )}

      {/* 2 ペイン */}
      <div className="grid grid-cols-[190px_1fr] bg-white border border-gray-200 rounded-xl overflow-hidden min-h-[520px]">
        <div className="bg-gray-50/70 border-r border-gray-200 p-2">
          {FEATURE_CATEGORIES.map((c) => {
            const { on, tot } = catCount(c.id);
            const active = c.id === curCat;
            return (
              <button key={c.id} type="button" onClick={() => setCurCat(c.id)}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg mb-0.5 text-left text-xs font-semibold ${
                  active ? "bg-zinc-800 text-white" : "text-gray-600 hover:bg-gray-100"}`}>
                <span className="truncate">{c.name}</span>
                <span className={`ml-auto text-[9.5px] rounded-full px-1.5 ${
                  active ? "bg-white/15 text-white" : "bg-white border border-gray-200 text-gray-400"}`}>{on}/{tot}</span>
              </button>
            );
          })}
        </div>

        <div className="p-4 overflow-x-auto">
          <div className="flex items-center gap-2 pb-3 mb-1 border-b border-gray-100">
            <span className="text-[11px] font-bold text-white bg-red-500 rounded px-2 py-0.5">{mode === "all" ? "全ロール" : (findRole(curRole)?.label ?? curRole)}</span>
            <h3 className="text-sm font-extrabold text-gray-800">{curCatDef.name} <span className="text-gray-400 text-xs font-semibold">{curCatDef.en}</span></h3>
          </div>

          {mode === "all"
            ? <MatrixView feats={curFeats} roles={roles} cur={cur} locked={locked} editable={editable} isDirty={isDirty} toggle={toggle} hasAccounts={hasAccounts} />
            : <RoleView
                feats={curFeats} role={curRole} cur={cur} locked={locked} editable={editable} isDirty={isDirty} toggle={toggle}
                canEditRole={canEditRoleColumn(isAdmin, curRole)}
                accountsFor={accountsFor} accCur={accCur} accIsDirty={accIsDirty} setAcc={setAcc} />}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 bg-gray-50 border border-dashed border-gray-200 rounded-lg px-3 py-2 leading-relaxed">
        並び順は「ラベル（画面/機能）＞項目名＞セキュリティ（<span className="text-white bg-rose-600 rounded px-1">高</span>/<span className="text-white bg-blue-500 rounded px-1">新</span>）」。効果は色付きテキスト（<span className="text-green-700 font-bold">ON</span>／<span className="text-red-700 font-bold">OFF</span>）。
        <span className="text-gray-300 font-bold mx-1">－</span>＝適用外、🔒＝管理者ロック（常時ON）。「アカウント別」の機能は LINE/メールのアカウント単位で割当できます。
      </p>
    </div>
  );
}

// ── 全ロール一覧（マトリクス）─────────────────────────────────
function MatrixView({ feats, roles, cur, locked, editable, isDirty, toggle, hasAccounts }: {
  feats: FeatureDef[]; roles: string[]; hasAccounts: boolean;
  cur: (r: string, k: string) => boolean;
  locked: (r: string, f: FeatureDef) => boolean;
  editable: (r: string, f: FeatureDef) => boolean;
  isDirty: (r: string, k: string) => boolean;
  toggle: (r: string, f: FeatureDef) => void;
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-zinc-700 text-white">
          <th className="text-left font-medium px-3 py-2 min-w-[220px] text-[11px]">子画面 / 子機能</th>
          {roles.map((r) => (
            <th key={r} className="px-2 py-2 text-[11px] whitespace-nowrap">
              <div className="flex flex-col items-center leading-tight">
                <span className="font-bold">{findRole(r)?.label ?? r}</span>
                <span className="text-[9px] text-zinc-300">{roleSub(r)}</span>
              </div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {feats.map((f) => (
          <Fragment key={f.key}>
            <tr className="border-t border-gray-100 hover:bg-gray-50/60">
              <td className="px-3 py-2.5">
                <span className="align-middle"><Badges f={f} /></span>
                <span className="align-middle text-gray-900 font-bold text-[13px] mx-1.5">{f.label}</span>
                <SecTags f={f} />
              </td>
              {roles.map((r) => (
                <td key={r} className="px-2 py-2.5 text-center">
                  {!appliesTo(f, r)
                    ? <span className="text-gray-300 font-bold tracking-widest" title={f.scope === "ops" ? "運営専用（適用外）" : "会員専用（適用外）"}>－</span>
                    : locked(r, f)
                      ? <span title="管理者ロック：常時ON"><Tg on disabled /></span>
                      : <Tg on={cur(r, f.key)} disabled={!editable(r, f)} dirty={isDirty(r, f.key)} onClick={() => toggle(r, f)} />}
                </td>
              ))}
            </tr>
            <tr className="text-[11.5px]">
              <td colSpan={roles.length + 1} className="px-3 pb-2.5 pt-0 text-left">
                <span className="text-green-700"><b className="font-extrabold">ON</b> {f.onEffect}</span>
                <span className="text-gray-300 mx-1.5">／</span>
                <span className="text-red-700"><b className="font-extrabold">OFF</b> {f.offEffect}</span>
                {f.warn && <span className="text-amber-700 ml-2">⚠ {f.warn}</span>}
                {hasAccounts && f.account && <span className="text-violet-500 ml-2">▸ アカウント単位は「ロール別」で設定</span>}
              </td>
            </tr>
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

// ── ロール別（案A: 状態追従の色付きテキスト＋アカウント単位）─────
function RoleView({ feats, role, cur, locked, editable, isDirty, toggle, canEditRole, accountsFor, accCur, accIsDirty, setAcc }: {
  feats: FeatureDef[]; role: string; canEditRole: boolean;
  cur: (r: string, k: string) => boolean;
  locked: (r: string, f: FeatureDef) => boolean;
  editable: (r: string, f: FeatureDef) => boolean;
  isDirty: (r: string, k: string) => boolean;
  toggle: (r: string, f: FeatureDef) => void;
  accountsFor: (f: FeatureDef) => AccountRef[];
  accCur: (f: FeatureDef, r: string, id: number) => AccountAccess;
  accIsDirty: (f: FeatureDef, r: string, id: number) => boolean;
  setAcc: (f: FeatureDef, r: string, id: number, v: AccountAccess) => void;
}) {
  return (
    <div className="space-y-2">
      {feats.map((f) => {
        const applies = appliesTo(f, role);
        const isLocked = locked(role, f);
        const on = isLocked ? true : cur(role, f.key);
        const dirty = isDirty(role, f.key);
        const accs = applies && on ? accountsFor(f) : [];
        return (
          <div key={f.key} className={`border rounded-xl px-3 py-2.5 ${dirty ? "border-amber-300 bg-amber-50/40" : "border-gray-200"}`}>
            <div className="flex items-center gap-2">
              <Badges f={f} />
              <span className={`font-bold text-[13px] ${applies ? "text-gray-900" : "text-gray-400"}`}>{f.label}{isLocked && " 🔒"}</span>
              <SecTags f={f} />
              {dirty && <span className="text-[9px] font-bold text-white bg-amber-500 rounded-full px-1.5 py-0.5">変更</span>}
              <span className="ml-auto flex items-center gap-2">
                {applies
                  ? <>
                      <span className={`text-[11px] font-bold ${on ? "text-green-600" : "text-gray-400"}`}>{on ? "ON" : "OFF"}</span>
                      {isLocked
                        ? <Tg on disabled />
                        : <Tg on={on} disabled={!editable(role, f)} dirty={dirty} onClick={() => toggle(role, f)} />}
                    </>
                  : <span className="text-gray-300 font-bold tracking-widest" title={f.scope === "ops" ? "運営専用（適用外）" : "会員専用（適用外）"}>－</span>}
              </span>
            </div>
            {applies && (
              <div className={`mt-1.5 text-[11.5px] ${on ? "text-green-700" : "text-red-700"}`}>
                {on
                  ? <>✓ {f.onEffect}<span className="text-gray-400"> ／ OFFで「{f.offEffect}」</span></>
                  : <>✕ {f.offEffect}<span className="text-gray-400"> ／ ONで「{f.onEffect}」</span></>}
              </div>
            )}
            {f.warn && <div className="mt-1 text-[10.5px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">⚠ {f.warn}</div>}

            {/* アカウント単位（LINE/メール）*/}
            {accs.length > 0 && (
              <div className="mt-2 pl-3 border-l-2 border-violet-200 space-y-1.5">
                <div className="text-[10px] font-bold text-gray-400 tracking-wide">
                  {f.notif ? "アカウント単位の通知（通知 / 停止）" : "アカウント単位のアクセス（操作 / 閲覧 / 非表示）"}
                </div>
                {accs.map((a) => {
                  const val = accCur(f, role, a.id);
                  const d = accIsDirty(f, role, a.id);
                  const opts: { v: AccountAccess; label: string; on: string }[] = f.notif
                    ? [{ v: "on", label: "通知", on: "bg-green-500 text-white border-green-500" }, { v: "off", label: "停止", on: "bg-gray-400 text-white border-gray-400" }]
                    : [{ v: "operate", label: "操作", on: "bg-green-500 text-white border-green-500" }, { v: "view", label: "閲覧", on: "bg-blue-500 text-white border-blue-500" }, { v: "none", label: "非表示", on: "bg-gray-400 text-white border-gray-400" }];
                  return (
                    <div key={a.id} className="flex items-center gap-2">
                      <span className="text-[12px] text-gray-700 flex-1 truncate">{a.name}{d && <span className="ml-1.5 text-[8.5px] font-bold text-white bg-amber-500 rounded-full px-1.5 py-0.5 align-middle">変更</span>}</span>
                      <span className={`inline-flex rounded-lg border overflow-hidden ${d ? "ring-2 ring-amber-300" : ""}`}>
                        {opts.map((o) => (
                          <button key={o.v} type="button" disabled={!canEditRole}
                            onClick={() => setAcc(f, role, a.id, o.v)}
                            className={`text-[10.5px] font-bold px-2.5 py-1 border-l first:border-l-0 border-gray-200 ${
                              val === o.v ? o.on : "bg-white text-gray-500"} ${canEditRole ? "" : "opacity-60 cursor-default"}`}>
                            {o.label}
                          </button>
                        ))}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
