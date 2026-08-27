// ============================================================
// CsWork：ビューモデルの組み立てと検証（REQ-028）
//
//   parse.ts が返した素の構造から、画面が必要とする形へ寄せる。
//     ・導線種別（概要／資料一覧／タスク）
//     ・運用設定値（mdをそのまま投影するHTML ＋ 判定に使う構造化データ）
//     ・業務フロー（使用ツール順に組み替えた作業手順）
//     ・要監視顧客（滞留判定の自動計算・顧客URLの生成）
//
//   ⚠️ 滞留判定は CSV に持たせない。最終アクション日・予定日・判定基準から
//      表示のたびに計算する（土日のみ除外。祝日は営業日として数える）。
//   ⚠️ パスワードはここで伏字にする。実値は reveal 指定時だけ返す（監査ログつき）。
// ============================================================
import {
  parseFrontMatter, parseTree, parseYaml, parseCsv, renderMarkdown, escapeHtml,
  type MdNode,
} from "./parse";

export const SETTINGS_HEADING = "運用設定値";
export const MASK = "●●●●●●●●";

export interface CsTask {
  funnel: string;
  name: string;
  tool: string;
  html: string;
  refs: string[];
}
export interface CsSection { title: string; html: string; }
export interface CsFunnel {
  name: string;
  summaryHtml: string;
  sections: CsSection[];
  tasks: CsTask[];
}
export interface CsOps {
  title: string;
  version: string;
  funnels: CsFunnel[];
  intro: CsSection[];          // 「このファイルについて」など導線種別以外の見出し
  settingsSections: CsSection[]; // 運用設定値（mdのまま投影）
  settings: Record<string, any>;
}
export interface CsFlowStep {
  tool: string;
  account: { 用途?: string; url?: string; id?: string } | null;
  tasks: CsTask[];
}
export interface CsWatchRow {
  優先度: string;
  導線種別: string;
  氏名: string;
  現況: string;
  顧客種別: string;
  LINE名: string;
  メールアドレス: string;
  電話番号: string;
  顧客ID: string;
  予定日: string;
  監視要件: string;
  最終アクション日: string;
  最終アクション内容: string;
  次アクション予定日: string;
  次アクション提案: string;
  備考: string;
  stale: { level: StaleLevel; reason: string };
  links: { name: string; url: string | null }[];
}
export type StaleLevel = "最優先" | "要フォロー" | "通常" | "対象外" | "要確認";

const TOOL_RE = /\*\*使用ツール\*\*\s*[:：]\s*(.+)/;
const PLACEHOLDER_RE = /\{\{(.+?)\}\}/g;

// ── 導線種別md ────────────────────────────────────────────
export function buildOps(md: string): CsOps {
  const { meta, body } = parseFrontMatter(md);
  const tree = parseTree(body);
  const funnelNames = Array.isArray(meta.funnels) ? (meta.funnels as unknown[]).map(String) : [];

  const funnels: CsFunnel[] = [];
  const intro: CsSection[] = [];
  const settingsSections: CsSection[] = [];
  let settings: Record<string, any> = {};

  for (const h1 of tree.children) {
    const name = h1.title.trim();

    if (name === SETTINGS_HEADING) {
      for (const h2 of h1.children) {
        settingsSections.push({ title: h2.title.trim(), html: renderMarkdown(h2.body) });
        settings = { ...settings, ...collectYaml(h2.body) };
      }
      settings = { ...collectYaml(h1.body), ...settings };
      continue;
    }

    if (funnelNames.length && !funnelNames.includes(name)) {
      intro.push({ title: name, html: renderSubtree(h1) });
      continue;
    }
    if (!funnelNames.length) { intro.push({ title: name, html: renderSubtree(h1) }); continue; }

    const funnel: CsFunnel = { name, summaryHtml: "", sections: [], tasks: [] };
    for (const h2 of h1.children) {
      const title = h2.title.trim();
      if (title.startsWith("概要")) funnel.summaryHtml = renderMarkdown(h2.body);
      else funnel.sections.push({ title, html: renderMarkdown(h2.body) });

      for (const h3 of h2.children) {
        const raw = h3.body.join("\n");
        const tool = TOOL_RE.exec(raw)?.[1]?.trim() ?? "その他";
        funnel.tasks.push({
          funnel: name,
          name: h3.title.trim(),
          tool,
          html: renderMarkdown(h3.body),
          refs: Array.from(raw.matchAll(PLACEHOLDER_RE)).map((m) => m[1].trim()),
        });
      }
    }
    funnels.push(funnel);
  }

  return {
    title: String(meta.title ?? "CsWork"),
    version: String(meta.version ?? ""),
    funnels,
    intro,
    settingsSections,
    settings,
  };
}

/** 見出し以外の md（design など単純な文書）をそのまま HTML にする。 */
export function buildDoc(md: string): { title: string; sections: CsSection[] } {
  const { meta, body } = parseFrontMatter(md);
  const tree = parseTree(body);
  const h1s = tree.children;
  const node = h1s.length === 1 ? h1s[0] : tree;
  const sections: CsSection[] = [];
  if (node.body.some((l) => l.trim())) sections.push({ title: "", html: renderMarkdown(node.body) });
  for (const c of node.children) sections.push({ title: c.title.trim(), html: renderSubtree(c) });
  return { title: String(meta.title ?? node.title ?? "ドキュメント"), sections };
}

function renderSubtree(node: MdNode): string {
  let html = renderMarkdown(node.body);
  for (const c of node.children) {
    const tag = c.level >= 3 ? "h4" : "h3";
    html += `<${tag} class="cw-h">${escapeHtml(c.title)}</${tag}>` + renderSubtree(c);
  }
  return html;
}

function collectYaml(lines: string[]): Record<string, any> {
  const text = lines.join("\n");
  const out: Record<string, any> = {};
  const re = /```yaml\r?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const data = parseYaml(m[1]);
    if (data && typeof data === "object" && !Array.isArray(data)) Object.assign(out, data);
  }
  return out;
}

// ── 業務フロー ────────────────────────────────────────────
export function buildFlow(ops: CsOps): CsFlowStep[] {
  const order: string[] = (ops.settings?.workflow?.["ツール順"] as string[] | undefined) ?? [];
  const all = ops.funnels.flatMap((f) => f.tasks);
  const accounts: any[] = Array.isArray(ops.settings?.accounts) ? ops.settings.accounts : [];
  const used = new Set<CsTask>();
  const steps: CsFlowStep[] = [];

  for (const tool of order) {
    const tasks = all.filter((t) => t.tool === tool);
    if (!tasks.length) continue;
    tasks.forEach((t) => used.add(t));
    const acc = accounts.find((a) => {
      const use = String(a?.["用途"] ?? "");
      return use.includes(tool) || tool.includes(use.replace(/（.*$/, ""));
    }) ?? null;
    steps.push({ tool, account: acc, tasks });
  }

  const rest = all.filter((t) => !used.has(t));
  if (rest.length) steps.push({ tool: "その他", account: null, tasks: rest });
  return steps;
}

// ── 滞留判定（自動計算）────────────────────────────────────
/** 土日を除いた日数（start の翌日から end まで）。祝日は営業日として数える。 */
export function businessDaysBetween(start: Date, end: Date): number {
  let days = 0;
  const cur = new Date(start.getTime());
  while (cur < end) {
    cur.setDate(cur.getDate() + 1);
    const w = cur.getDay();
    if (w !== 0 && w !== 6) days++;
  }
  return days;
}

function toDate(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test((s ?? "").trim())) return null;
  const d = new Date(`${s.trim()}T00:00:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

export function judgeStale(
  row: Record<string, string>,
  settings: Record<string, any>,
  today: Date,
): { level: StaleLevel; reason: string } {
  const th = settings?.thresholds ?? {};
  const follow = Number(th["要フォロー"] ?? 3);
  const top = Number(th["最優先"] ?? 7);
  const skipScheduled = th["予定日が未来なら対象外"] !== false;

  const planned = toDate(row["予定日"] ?? "");
  if (skipScheduled && planned && planned >= today) {
    return { level: "対象外", reason: `予定日 ${row["予定日"]}` };
  }

  const last = toDate(row["最終アクション日"] ?? "");
  if (!last) return { level: "要確認", reason: "最終アクション日が未登録" };

  const elapsed = Math.floor((today.getTime() - last.getTime()) / 86400000);
  const bd = businessDaysBetween(last, today);
  if (elapsed >= top) return { level: "最優先", reason: `${elapsed}日経過` };
  if (bd >= follow) return { level: "要フォロー", reason: `${bd}営業日経過` };
  return { level: "通常", reason: `${bd}営業日経過` };
}

// ── 要監視顧客 ────────────────────────────────────────────
export const WATCH_REQUIRED = ["優先度", "導線種別", "氏名", "監視要件", "最終アクション日"] as const;

export function buildWatchlist(csv: string, settings: Record<string, any>, today = new Date()): CsWatchRow[] {
  const rows = parseCsv(csv);
  const order: string[] = Array.isArray(settings?.funnels)
    ? settings.funnels
    : Object.keys(settings?.funnels ?? {});

  const list = rows.map((r) => ({
    優先度: r["優先度"] ?? "",
    導線種別: r["導線種別"] ?? "",
    氏名: r["氏名"] ?? "",
    現況: r["現況"] ?? "",
    顧客種別: r["顧客種別"] ?? "",
    LINE名: r["LINE名"] ?? "",
    メールアドレス: r["メールアドレス"] ?? "",
    電話番号: r["電話番号"] ?? "",
    顧客ID: r["顧客ID"] ?? "",
    予定日: r["予定日"] ?? "",
    監視要件: r["監視要件"] ?? "",
    最終アクション日: r["最終アクション日"] ?? "",
    最終アクション内容: r["最終アクション内容"] ?? "",
    次アクション予定日: r["次アクション予定日"] ?? "",
    次アクション提案: r["次アクション提案"] ?? "",
    備考: r["備考"] ?? "",
    stale: judgeStale(r, settings, today),
    links: customerLinks(r, settings),
  }));

  return list.sort((a, b) => {
    const pa = a.優先度 === "A" ? 0 : 1, pb = b.優先度 === "A" ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const fa = order.indexOf(a.導線種別), fb = order.indexOf(b.導線種別);
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    return (a.最終アクション日 || "9999").localeCompare(b.最終アクション日 || "9999");
  });
}

/**
 * 顧客IDからのURL自動生成 ＋ CSVの「関連URL」列（`名称|URL`、`;` 区切り）。
 *
 *   ⚠️ パターンに `種別` があるときは、CSVの「顧客種別」が一致する行にだけ使う
 *      （会員は /ops/members/{id}、LINEのみの相手は /ops/line-customers/{id} と
 *        顧客ページが別なので、両方を出すと必ず片方が死んだリンクになる）。
 *   ⚠️ 顧客IDが無い相手は本来この台帳に載らない（先にポータルへ登録する運用）。
 *      入ってしまった場合はURLなしの項目として出し、画面で気づけるようにする。
 */
export function customerLinks(row: Record<string, string>, settings: Record<string, any>): { name: string; url: string | null }[] {
  const out: { name: string; url: string | null }[] = [];
  const id = (row["顧客ID"] ?? "").trim();
  const kind = (row["顧客種別"] ?? "").trim();
  const patterns: any[] = Array.isArray(settings?.customer_url_patterns) ? settings.customer_url_patterns : [];
  const typed = patterns.filter((p) => String(p?.種別 ?? "").trim());

  for (const p of patterns) {
    const tmpl = String(p?.pattern ?? "");
    if (!tmpl) continue;
    const want = String(p?.種別 ?? "").trim();
    // 種別つきのパターンが定義されている場合：
    //   ・行の顧客種別と一致するものだけ使う
    //   ・行の顧客種別が空なら、種別つきパターンは1本だけ「URLなし」で出す（未登録の合図）
    if (typed.length) {
      if (want && kind && want !== kind) continue;
      if (want && !kind && p !== typed[0]) continue;
    }
    const name = String(p?.name ?? "リンク");
    if (tmpl.includes("{顧客ID}") && !id) {
      out.push({ name: kind ? name : "ポータル顧客ページ（未登録）", url: null });
      continue;
    }
    out.push({ name, url: tmpl.replace("{顧客ID}", id) });
  }

  for (const chunk of (row["関連URL"] ?? "").split(";")) {
    const t = chunk.trim();
    if (!t) continue;
    const idx = t.indexOf("|");
    if (idx > 0) out.push({ name: t.slice(0, idx).trim(), url: t.slice(idx + 1).trim() });
    else out.push({ name: "リンク", url: t });
  }
  return out;
}

// ── パスワードの伏字化 ────────────────────────────────────
/** 設定値HTML／構造化データの pass 値を伏字にする。 */
export function maskSecrets<T>(value: T): T {
  if (typeof value === "string") {
    return value.replace(/((?:pass|password|パスワード)\s*[:：]\s*)([^\s<][^\n<]*)/gi, `$1${MASK}`) as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => maskSecrets(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = /^(pass|password|パスワード)$/i.test(k) ? (v ? MASK : v) : maskSecrets(v);
    }
    return out as unknown as T;
  }
  return value;
}

// ── アップロード時の検証 ──────────────────────────────────
export interface ValidationResult {
  ok: boolean;
  summary: { label: string; status: "ok" | "warn" | "ng"; detail: string }[];
}

/**
 * 枠ごとに受け付ける front matter の kind（REQ-039 v2）。
 *   ops      … ポータル読込用md（運用設定値を同梱する）
 *   design   … エージェント指示用md。従来の `design` に加えて `agent` を受ける
 *   watchlist… 要監視顧客CSV（front matter を持たない）
 */
const KIND_ALIASES: Record<string, readonly string[]> = {
  ops: ["ops"],
  design: ["design", "agent"],
  watchlist: [],
};

export function validate(kind: "ops" | "design" | "watchlist", text: string): ValidationResult {
  const summary: ValidationResult["summary"] = [];
  const push = (label: string, status: "ok" | "warn" | "ng", detail: string) => summary.push({ label, status, detail });

  if (kind === "watchlist") {
    const rows = parseCsv(text);
    if (!rows.length) push("CSV", "ng", "データ行がありません");
    else {
      const missing = WATCH_REQUIRED.filter((c) => !(c in rows[0]));
      if (missing.length) push("必須列", "ng", `不足：${missing.join("・")}`);
      else push("必須列", "ok", `${WATCH_REQUIRED.length}列すべてあり`);

      const badDate = rows.filter((r) =>
        (r["最終アクション日"] && !/^\d{4}-\d{2}-\d{2}$/.test(r["最終アクション日"])) ||
        (r["予定日"] && !/^\d{4}-\d{2}-\d{2}$/.test(r["予定日"])));
      if (badDate.length) push("日付書式", "ng", `${badDate.length}件が YYYY-MM-DD ではありません`);
      else push("日付書式", "ok", "すべて YYYY-MM-DD");

      push("行数", "ok", `${rows.length}件`);
      const noId = rows.filter((r) => !(r["顧客ID"] ?? "").trim()).length;
      if (noId) push("顧客ID", "warn", `${noId}件が未登録。先にポータルへ顧客登録し、顧客種別（会員／LINE）とIDを入れてから台帳に載せてください`);
      else push("顧客ID", "ok", `${rows.length}件すべて登録済み`);

      const badKind = rows.filter((r) => {
        const k = (r["顧客種別"] ?? "").trim();
        return (r["顧客ID"] ?? "").trim() && k !== "会員" && k !== "LINE";
      }).length;
      if (badKind) push("顧客種別", "warn", `${badKind}件が「会員」「LINE」以外（顧客ページのURLを組み立てられません）`);
    }
    return { ok: !summary.some((s) => s.status === "ng"), summary };
  }

  // ⚠️ REQ-039 v2：書式の責任は Claude セッションの整形が引き取った。
  //    front matter の有無や kind の違いは **NGにしない**（人が読める md なら通す）。
  //    画面が空になる不備（導線の見出しが無い等）だけを NG に残す。
  const { meta } = parseFrontMatter(text);
  const wanted = KIND_ALIASES[kind] ?? [];
  const got = String(meta.kind ?? "").trim();
  if (!got) push("front matter", "warn", "kind がありません（種別はアップロードした枠で判定します）");
  else if (wanted.length && !wanted.includes(got)) push("front matter", "warn", `kind が ${got}（この枠が想定するのは ${wanted.join(" / ")}）`);
  else push("front matter", "ok", `kind: ${got || "-"} / version: ${String(meta.version ?? "-")}`);

  if (kind === "design") {
    // エージェント指示用md。**禁止事項が書かれていない指示ファイルは危険**なので必ず見る。
    if (!/禁止事項/.test(text)) push("禁止事項", "warn", "「禁止事項」の節がありません（送信禁止・クレーム一次対応禁止を必ず書いてください）");
    else push("禁止事項", "ok", "記載あり");
    if (!/送信/.test(text)) push("送信の扱い", "warn", "送信についての記述が見当たりません");
    const steps = (text.match(/^\s*###\s+/gm) ?? []).length;
    push("手順", steps ? "ok" : "warn", steps ? `${steps}件` : "### の手順が1件もありません");
    return { ok: !summary.some((s) => s.status === "ng"), summary };
  }

  const funnelNames = Array.isArray(meta.funnels) ? (meta.funnels as unknown[]).map(String) : [];
  if (!funnelNames.length) push("導線種別", "ng", "front matter の funnels がありません（導線種別タブに何も表示されません）");
  else {
    const ops = buildOps(text);
    const found = ops.funnels.map((f) => f.name);
    const miss = funnelNames.filter((f) => !found.includes(f));
    if (miss.length) push("導線種別", "ng", `見出しが無い：${miss.join("・")}`);
    else push("導線種別", "ok", `${found.length}区分（${found.join("・")}）`);

    const tasks = ops.funnels.flatMap((f) => f.tasks);
    const noTool = tasks.filter((t) => t.tool === "その他");
    if (!tasks.length) push("タスク", "ng", "タスクが1件もありません");
    else if (noTool.length) push("タスク", "warn", `${tasks.length}件（使用ツール未記載 ${noTool.length}件）`);
    else push("タスク", "ok", `${tasks.length}件（使用ツールの記載漏れなし）`);

    const keys = Object.keys(ops.settings);
    if (!keys.length) push("運用設定値", "ng", "yaml ブロックを解釈できませんでした");
    else push("運用設定値", "ok", `${keys.length}ブロックを解釈`);

    const links: Record<string, any> = ops.settings?.links ?? {};
    const noUrl = Object.entries(links).filter(([, v]) => !(v && typeof v === "object" ? v.url : v));
    if (noUrl.length) push("URL未登録", "warn", `${noUrl.length}件（${noUrl.map(([k]) => k).join("・")}）`);
  }

  return { ok: !summary.some((s) => s.status === "ng"), summary };
}
