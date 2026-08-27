// ============================================================
// CsWork：md / CSV のパーサ（REQ-028）
//
//   運用ドキュメント（導線種別md・AI作業設計md・要監視顧客CSV）を
//   アップロードされたテキストのまま解釈するための純関数だけを置く。
//
//   ⚠️ 外部ライブラリを足さない方針。YAML は運用ドキュメントで使う範囲
//      （入れ子マップ・リスト・インライン配列・折り返しスカラ）に絞った
//      サブセットパーサを自前で持つ。書式は
//      docs/CS運用/【KAWAICAMP】CS運用.md「ファイル書式（入力契約）」が正本。
//   ⚠️ HTML は必ずこのファイルの escapeHtml を通してから組み立てる
//      （アップロードされた md をそのまま innerHTML に流さないため）。
// ============================================================

/** 見出しツリーのノード。level 0 はルート。 */
export interface MdNode {
  level: number;
  title: string;
  body: string[];
  children: MdNode[];
}

const HEADING = /^(#{1,3})\s+(.*?)\s*#*$/;

/** 段落を打ち切る行（箇条書き・引用・表）。`**強調**` を箇条書きと誤判定しないよう `-`/`*` の後ろに空白を要求する。 */
const PARA_BREAK = /^\s*(?:[-*]\s|>|\|)/;

/** 先頭の `---` ブロックを front matter として読む。 */
export function parseFrontMatter(text: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = parseYaml(m[1]);
  return {
    meta: (meta && typeof meta === "object" && !Array.isArray(meta)) ? meta as Record<string, unknown> : {},
    body: text.slice(m[0].length),
  };
}

/** 見出し（# ～ ###）でツリー化する。コードブロック内の # は見出しにしない。 */
export function parseTree(body: string): MdNode {
  const root: MdNode = { level: 0, title: "", body: [], children: [] };
  const stack: MdNode[] = [root];
  let inCode = false;

  for (const line of body.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) inCode = !inCode;

    const m = inCode ? null : HEADING.exec(line);
    if (m) {
      const node: MdNode = { level: m[1].length, title: m[2].trim(), body: [], children: [] };
      while (stack.length && stack[stack.length - 1].level >= node.level) stack.pop();
      stack[stack.length - 1].children.push(node);
      stack.push(node);
    } else {
      stack[stack.length - 1].body.push(line);
    }
  }
  return root;
}

// ── YAML（サブセット）─────────────────────────────────────
interface YamlLine { indent: number; text: string; }

/** 運用ドキュメントで使う範囲の YAML を読む。解釈できない行は文字列として扱う。 */
export function parseYaml(text: string): unknown {
  const lines: YamlLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const stripped = stripComment(raw);
    if (!stripped.trim()) continue;
    lines.push({ indent: stripped.length - stripped.trimStart().length, text: stripped.trim() });
  }
  const [value] = parseBlock(lines, 0, lines.length > 0 ? lines[0].indent : 0);
  return value;
}

/** 行末コメントを落とす（引用符の中は残す）。 */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseBlock(lines: YamlLine[], start: number, indent: number): [unknown, number] {
  if (start >= lines.length) return [null, start];

  if (lines[start].text.startsWith("- ") || lines[start].text === "-") {
    const arr: unknown[] = [];
    let i = start;
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith("- ") || lines[i].text === "-")) {
      const head = lines[i].text.replace(/^-\s*/, "");
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent;

      if (head.includes(": ") || /:$/.test(head)) {
        // 「- key: value」で始まるマップ要素。続く行（より深い字下げ）も同じ要素に含める。
        const inner: YamlLine[] = [{ indent: 0, text: head }];
        let j = i + 1;
        while (j < lines.length && lines[j].indent > indent) {
          inner.push({ indent: lines[j].indent - (childIndent > indent ? childIndent : indent + 2), text: lines[j].text });
          j++;
        }
        const [obj] = parseBlock(inner, 0, 0);
        arr.push(obj);
        i = j;
      } else if (head) {
        arr.push(scalar(head));
        i++;
      } else {
        const [obj, next] = parseBlock(lines, i + 1, childIndent);
        arr.push(obj);
        i = next;
      }
    }
    return [arr, i];
  }

  const obj: Record<string, unknown> = {};
  let i = start;
  while (i < lines.length && lines[i].indent === indent) {
    const line = lines[i].text;
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) { i++; continue; }

    const key = m[1].trim().replace(/^["']|["']$/g, "");
    const rest = m[2].trim();

    if (rest === ">" || rest === "|" || rest === ">-" || rest === "|-") {
      // 折り返しスカラ。より深い字下げの行をつなげる。
      const buf: string[] = [];
      let j = i + 1;
      while (j < lines.length && lines[j].indent > indent) { buf.push(lines[j].text); j++; }
      obj[key] = rest.startsWith(">") ? buf.join(" ") : buf.join("\n");
      i = j;
    } else if (rest === "") {
      const childIndent = i + 1 < lines.length ? lines[i + 1].indent : indent;
      if (childIndent > indent) {
        const [child, next] = parseBlock(lines, i + 1, childIndent);
        obj[key] = child;
        i = next;
      } else {
        obj[key] = null;
        i++;
      }
    } else {
      obj[key] = scalar(rest);
      i++;
    }
  }
  return [obj, i];
}

function scalar(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return null;
  if (/^\[.*\]$/.test(v)) {
    const inner = v.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((x) => scalar(x));
  }
  if (/^".*"$/.test(v) || /^'.*'$/.test(v)) return v.slice(1, -1);
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null" || v === "~") return null;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

// ── Markdown（表示用の最小レンダラ）───────────────────────
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

/** インライン記法（太字・コード・リンク）だけを適用する。 */
export function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/(^|[\s(（])(https?:\/\/[^\s<)）]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return s;
}

/**
 * ブロック記法（見出し以外）を HTML にする。
 * 対応：箇条書き（入れ子）・チェックボックス・表・コードブロック・引用・段落。
 */
export function renderMarkdown(lines: string[]): string {
  const out: string[] = [];
  let i = 0;

  const flushList = (items: { depth: number; html: string }[]) => {
    if (!items.length) return;
    let depth = 0;
    out.push("<ul>");
    for (const it of items) {
      while (it.depth > depth) { out.push("<ul>"); depth++; }
      while (it.depth < depth) { out.push("</ul>"); depth--; }
      out.push(`<li>${it.html}</li>`);
    }
    while (depth-- > 0) out.push("</ul>");
    out.push("</ul>");
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i++; continue; }

    // コードブロック
    if (line.trimStart().startsWith("```")) {
      const lang = line.trim().replace(/^```/, "").trim();
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre data-lang="${escapeHtml(lang)}"><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // 表
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>`
      );
      continue;
    }

    // 箇条書き（- / * ）。字下げ4スペース（または2）で入れ子。
    if (/^\s*[-*]\s+/.test(line)) {
      const items: { depth: number; html: string }[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const indent = lines[i].length - lines[i].trimStart().length;
        const text = lines[i].trimStart().replace(/^[-*]\s+/, "");
        const check = /^\[( |x|X)\]\s*/.exec(text);
        const html = check
          ? `<span class="cw-check">${check[1] === " " ? "☐" : "☑"}</span> ${renderInline(text.slice(check[0].length))}`
          : renderInline(text);
        items.push({ depth: indent >= 4 ? 1 : indent >= 2 ? 1 : 0, html });
        i++;
      }
      flushList(items);
      continue;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { buf.push(lines[i].replace(/^\s*>\s?/, "")); i++; }
      out.push(`<blockquote>${buf.map(renderInline).join("<br>")}</blockquote>`);
      continue;
    }

    // 段落
    //   ⚠️ 先頭行は必ず消費する。ここで1行も消費しないと i が進まず無限ループになる
    //      （例：**強調** で始まる行は `*` から始まるので継続条件に弾かれる）。
    const buf: string[] = [lines[i]];
    i++;
    while (i < lines.length && lines[i].trim() && !PARA_BREAK.test(lines[i]) && !lines[i].trimStart().startsWith("```")) {
      buf.push(lines[i]); i++;
    }
    out.push(`<p>${buf.map(renderInline).join("<br>")}</p>`);
  }

  return out.join("\n");
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

// ── CSV ───────────────────────────────────────────────────
/** ダブルクォート対応の CSV パーサ。1行目をヘッダとして行オブジェクトにする。 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else { quoted = false; }
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ",") { row.push(cell); cell = ""; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; continue; }
    if (c === "\r") continue;
    cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];

  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const obj: Record<string, string> = {};
      header.forEach((h, idx) => { obj[h] = (r[idx] ?? "").trim(); });
      return obj;
    });
}
