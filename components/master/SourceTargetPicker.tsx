"use client";
// ============================================================
// 流入経路によるターゲティング（Phase 3）
//
//   BEFORE：単一の経路キーとの完全一致のみ（プルダウン1つ）。
//           「広告経由の全員」のようなカテゴリ単位の絞り込みができなかった。
//
//   AFTER ：経路の複数選択 ＋ カテゴリ一括選択。
//           ids と cats は OR で評価される（lib/sources.ts の matchSource）。
//
//   一斉配信（BroadcastView）とシナリオ配信（ScenarioView）で共用する。
// ============================================================
import { useMemo } from "react";
import type { Source, SourceCategory } from "../../lib/models";
import { SOURCE_CATEGORIES, SOURCE_CATEGORY_LABEL } from "../../lib/models";
import { MultiSelect } from "../common/MultiSelect";

export interface SourceTargetPickerProps {
  sources: Source[];
  sourceIds: number[];
  sourceCats: SourceCategory[];
  onChange: (next: { sourceIds: number[]; sourceCats: SourceCategory[] }) => void;
}

export function SourceTargetPicker({ sources, sourceIds, sourceCats, onChange }: SourceTargetPickerProps) {
  // 経路の選択肢。停止中でも「既に条件に入っている」ものは残す（配信条件が勝手に変わらないように）
  const options = useMemo(
    () => sources
      .filter((s) => s.isActive || sourceIds.includes(s.id))
      .map((s) => ({ value: String(s.id), label: s.isActive ? s.label : `${s.label}（停止中）` })),
    [sources, sourceIds],
  );

  // カテゴリは「実際に経路が存在するもの」だけ出す（空振りを防ぐ）
  const catOptions = useMemo(() => {
    const used = new Set(sources.filter((s) => s.isActive).map((s) => s.category));
    return SOURCE_CATEGORIES
      .filter((c) => used.has(c) || sourceCats.includes(c))
      .map((c) => ({ value: c, label: SOURCE_CATEGORY_LABEL[c] }));
  }, [sources, sourceCats]);

  const none = sourceIds.length === 0 && sourceCats.length === 0;

  return (
    <div>
      <label className="text-xs font-semibold text-gray-500 block mb-1">
        流入経路 <span className="text-gray-400 font-normal">任意・複数選択可</span>
      </label>
      <div className="grid gap-2" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <MultiSelect
          label="経路"
          searchable
          options={options}
          selected={sourceIds.map(String)}
          onChange={(vals) => onChange({ sourceIds: vals.map(Number), sourceCats })}
        />
        <MultiSelect
          label="カテゴリ"
          options={catOptions}
          selected={sourceCats}
          onChange={(vals) => onChange({ sourceIds, sourceCats: vals as SourceCategory[] })}
        />
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        {none
          ? "指定なし（経路では絞り込みません）"
          : "経路とカテゴリは OR で評価します（どちらかに合致すれば対象）。経路が未設定の会員は対象外になります。"}
      </p>
    </div>
  );
}
