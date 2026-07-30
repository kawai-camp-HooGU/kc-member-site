// ============================================================
// fixture 読み込み（サーバー専用・開発用）
//   ・develop/fixtures/{note,x}/*.md を SourceFile[] として返す。
//   ・実データ同期（Mac側フル同期）では、ここを実 root の走査に差し替える。
// ============================================================
import { readdir, readFile } from "fs/promises";
import { join } from "path";
import type { SourceFile } from "./types";

/** note / x の fixture を読み込む。 */
export async function loadFixtureSourceFiles(source: "note" | "x"): Promise<SourceFile[]> {
  const dir = join(process.cwd(), "fixtures", source);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
  const out: SourceFile[] = [];
  for (const name of names.sort()) {
    const content = await readFile(join(dir, name), "utf8");
    out.push({ sourceType: source, relativePath: `fixtures/${source}/${name}`, content });
  }
  return out;
}
