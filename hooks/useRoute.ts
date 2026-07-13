"use client";
// ============================================================
// useRoute — URLを唯一の状態源として扱うためのフック
//
//   どのコンポーネントからでも呼べる（Context 不要。next/navigation を読むだけ）。
//
//     const { view, detail, q, go, goDetail, setQuery } = useRoute();
//
//     go("content", [12])        → /content/12        （画面遷移。履歴に積む）
//     goDetail([3,"submissions"])→ 同じ view のまま詳細だけ変更
//     setQuery({ task: 88 })     → ?task=88 を付ける（モーダル。履歴は置換）
//     setQuery({ task: null })   → ?task を外す（モーダルを閉じる）
//
//   モーダル系は replace にしているので「戻る」で一覧まで戻れる。
//   画面遷移は push なので「戻る」で前の画面に戻れる。
// ============================================================
import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { parsePath, buildPath, withQuery, numParam } from "../lib/routes";
import type { Zone } from "../lib/zone";

export interface RouteApi {
  zone: Zone;
  view: string;
  detail: string[];
  /** クエリ値（文字列） */
  q: (key: string) => string | null;
  /** クエリ値（数値。不正・未指定は null） */
  qNum: (key: string) => number | null;
  /** 画面遷移（履歴に積む） */
  go: (view: string, detail?: (string | number)[], query?: Record<string, string | number | null | undefined>) => void;
  /** 同じ view のまま詳細セグメントだけ変更 */
  goDetail: (detail: (string | number)[], query?: Record<string, string | number | null | undefined>) => void;
  /** クエリだけ差分更新（履歴は置換。モーダルの開閉に使う） */
  setQuery: (patch: Record<string, string | number | null | undefined>) => void;
}

export function useRoute(): RouteApi {
  const pathname = usePathname() || "/";
  const search   = useSearchParams();
  const router   = useRouter();

  const { zone, view, detail } = useMemo(() => parsePath(pathname), [pathname]);

  const q    = useCallback((key: string) => search?.get(key) ?? null, [search]);
  const qNum = useCallback((key: string) => numParam(search?.get(key)), [search]);

  const go = useCallback(
    (v: string, d: (string | number)[] = [], query?: Record<string, string | number | null | undefined>) => {
      router.push(withQuery(buildPath(zone, v, d), query), { scroll: false });
    },
    [router, zone],
  );

  const goDetail = useCallback(
    (d: (string | number)[], query?: Record<string, string | number | null | undefined>) => {
      router.push(withQuery(buildPath(zone, view, d), query), { scroll: false });
    },
    [router, zone, view],
  );

  const setQuery = useCallback(
    (patch: Record<string, string | number | null | undefined>) => {
      const next = new URLSearchParams(search?.toString() ?? "");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === undefined || v === "") next.delete(k);
        else next.set(k, String(v));
      }
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  return { zone, view, detail, q, qNum, go, goDetail, setQuery };
}
