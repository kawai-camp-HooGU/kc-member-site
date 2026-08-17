// ============================================================
// 扉ページのトークン解決
//
//   運営が書いた扉HTML（sanitizeDoorHtml 済み）の data-* トークンを、
//   閲覧者ごとの実データ（見られるページ・進捗・カバー画像）で解決する。
//
//   ⚠️ 解決は必ず「サニタイズ後」のHTMLに対して行う。
//      サニタイズ前に解決すると、注入された属性を信用することになる。
//
//   ⚠️ 公開範囲の判定はここでやり直さない。
//      呼び出し側が canView() を通したページだけを ctx.pages に渡す。
//      判定の正本は lib/contents.ts の canView() 1箇所のままにする
//      （「扉ページだけ判定がズレる」事故を構造的に防ぐ）。
//
//   解決できないトークン（存在しない slug・権限が無い・削除済み）は
//   要素ごと DOM から取り除く。会員に死んだリンクを見せないため。
// ============================================================
import { toImageUrl } from "./contents";
import type { ContentPage } from "./models";

export interface DoorStat {
  total: number;
  viewed: number;
}

/**
 * 解決に必要な最小のページ情報。
 *   ContentPage をそのまま渡せる（構造的部分型）。
 *   AIチャットのプレビューのように、ページの全項目を持たない場面でも使えるようにしている。
 */
export type DoorPageRef = Pick<ContentPage, "id" | "name" | "slug" | "coverUrl">;

export interface DoorContext {
  /** その会員が閲覧できるページだけ（canView 適用済み） */
  pages: DoorPageRef[];
  /** ページIDごとの進捗 */
  statOf: (pageId: number) => DoorStat;
  /** 未読が残る先頭ページ（＝続きから）。全部読了なら null */
  resume: DoorPageRef | null;
  /** ページを開くURL（SPA遷移が効かない環境でのフォールバック用） */
  hrefOf: (pageId: number) => string;
}

/** 扉HTMLが空か（空なら呼び出し側は auto 表示へフォールバックする） */
export function isDoorHtmlEmpty(html: string | null | undefined): boolean {
  const s = String(html ?? "");
  // タグを剥がして中身が無く、かつ画像・トークンも無ければ「空」
  if (/<img\b|data-page|data-resume|data-progress/i.test(s)) return false;
  return s.replace(/<[^>]*>/g, "").trim().length === 0;
}

/**
 * background-image に安全に載せられるURLへ整える。
 *   url("...") の外へ抜けられる文字（" ) 改行）を落とす。
 */
function cssUrl(raw: string): string | null {
  const u = toImageUrl(String(raw ?? "").trim());
  if (!u) return null;
  if (!/^(https?:\/\/|\/)/i.test(u)) return null;   // スキーム制限
  if (/["')\\\n\r]/.test(u)) return null;            // 抜け出し文字を含むものは使わない
  return u;
}

/** 進捗バーの要素を組み立てる（文字列連結ではなくDOMで作る＝注入経路を作らない） */
function buildBar(doc: Document, stat: DoorStat): HTMLElement {
  const pct = stat.total > 0 ? Math.round((stat.viewed / stat.total) * 100) : 0;
  const bar = doc.createElement("span");
  bar.className = "door-bar";
  const fill = doc.createElement("i");
  fill.style.width = `${pct}%`;
  bar.appendChild(fill);
  return bar;
}

/** 要素から見て、対応するページIDを決める（自身の値 → 無ければ祖先の data-page-id） */
function ownerPageId(el: Element, value: string, bySlug: Map<string, DoorPageRef>): number | null {
  const slug = value.trim();
  if (slug) return bySlug.get(slug)?.id ?? null;
  const host = el.closest("[data-page-id]");
  const id = host?.getAttribute("data-page-id");
  return id ? Number(id) : null;
}

/**
 * 扉HTMLのトークンを解決して返す。
 * @param html sanitizeDoorHtml() を通した後のHTML
 */
export function resolveDoorHtml(html: string, ctx: DoorContext): string {
  // SSR時は DOMParser が無い。空を返し、クライアントで再描画させる。
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") return "";

  const doc = new window.DOMParser().parseFromString(`<div id="__door">${html}</div>`, "text/html");
  const root = doc.getElementById("__door");
  if (!root) return "";

  const bySlug = new Map<string, DoorPageRef>();
  for (const p of ctx.pages) if (p.slug) bySlug.set(p.slug, p);
  const byId = new Map<number, DoorPageRef>(ctx.pages.map((p) => [p.id, p]));

  // ── 1. data-resume：未読が残る先頭ページへの入口 ──────────
  //    先に処理する。ページ入口としての性質は data-page と同じ。
  for (const el of Array.from(root.querySelectorAll("[data-resume]"))) {
    const page = ctx.resume;
    if (!page || !byId.has(page.id)) { el.remove(); continue; }   // 全部読了 → 出さない
    el.setAttribute("data-page-id", String(page.id));
    if (el.tagName === "A") el.setAttribute("href", ctx.hrefOf(page.id));
    // 中身の data-name / data-progress は、この data-page-id を親として解決される
  }

  // ── 2. data-page：ページへの入口 ─────────────────────────
  //    解決できない（存在しない slug／権限が無い／削除済み）なら要素ごと除去。
  for (const el of Array.from(root.querySelectorAll("[data-page]"))) {
    if (!el.isConnected) continue;                       // 親ごと消えていた
    const page = bySlug.get((el.getAttribute("data-page") ?? "").trim());
    if (!page) { el.remove(); continue; }
    el.setAttribute("data-page-id", String(page.id));
    if (el.tagName === "A") el.setAttribute("href", ctx.hrefOf(page.id));
  }

  // ── 3. data-page-cover：カバー画像を背景に敷く ───────────
  for (const el of Array.from(root.querySelectorAll("[data-page-cover]"))) {
    if (!el.isConnected) continue;
    const pid = ownerPageId(el, el.getAttribute("data-page-cover") ?? "", bySlug);
    const page = pid != null ? byId.get(pid) : undefined;
    const u = page?.coverUrl ? cssUrl(page.coverUrl) : null;
    if (!u) continue;                                    // 未設定は既定カバー（CSS側）のまま
    const style = (el as HTMLElement).style;
    style.backgroundImage = `url("${u}")`;
    style.backgroundSize = "cover";
    style.backgroundPosition = "center";
  }

  // ── 4a. data-name：ページ名 ──────────────────────────────
  //    値を省くと親（data-page / data-resume）のページ名になる。
  //    続きからカードのように、指す先が閲覧者ごとに変わる場所で使う。
  for (const el of Array.from(root.querySelectorAll("[data-name]"))) {
    if (!el.isConnected) continue;
    const pid = ownerPageId(el, el.getAttribute("data-name") ?? "", bySlug);
    const page = pid != null ? byId.get(pid) : undefined;
    if (!page) { el.remove(); continue; }
    el.textContent = page.name;
  }

  // ── 4. data-progress：「4 / 10」 ────────────────────────
  for (const el of Array.from(root.querySelectorAll("[data-progress]"))) {
    if (!el.isConnected) continue;
    const pid = ownerPageId(el, el.getAttribute("data-progress") ?? "", bySlug);
    if (pid == null) { el.remove(); continue; }
    const s = ctx.statOf(pid);
    el.textContent = `${s.viewed} / ${s.total}`;
  }

  // ── 5. data-progress-bar：進捗バー ──────────────────────
  for (const el of Array.from(root.querySelectorAll("[data-progress-bar]"))) {
    if (!el.isConnected) continue;
    const pid = ownerPageId(el, el.getAttribute("data-progress-bar") ?? "", bySlug);
    if (pid == null) { el.remove(); continue; }
    el.textContent = "";
    el.appendChild(buildBar(doc, ctx.statOf(pid)));
  }

  // ── 6. {{count:C00}} / {{name:C00}}：テキスト置換 ────────
  //    テキストノードだけを走査する。タグを注入させないため。
  const walker = doc.createTreeWalker(root, 0x4 /* SHOW_TEXT */);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const src = t.nodeValue ?? "";
    if (!src.includes("{{")) continue;
    t.nodeValue = src.replace(/\{\{(count|name|total):([A-Za-z0-9_-]+)\}\}/g, (_m, key: string, slug: string) => {
      const page = bySlug.get(slug);
      if (!page) return "";
      if (key === "name") return page.name;
      const s = ctx.statOf(page.id);
      return String(key === "count" ? s.total : s.total);
    });
  }

  return root.innerHTML;
}

/**
 * 扉HTMLが参照している slug の一覧を返す（運営画面の「掲載漏れ」検出用）。
 * 描画とは無関係なので、正規表現で軽く拾う。
 */
export function referencedSlugs(html: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const re = /data-page\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html ?? ""))) !== null) {
    const s = m[1].trim();
    if (s) out.add(s);
  }
  return out;
}
