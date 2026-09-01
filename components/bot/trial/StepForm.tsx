"use client";
// ============================================================
// ②ステップの入力フォーム
//   ・選択肢中心。自由記述は最小限にする（やさしさ）。
//   ・select の初期値は先頭（空のプルダウンを出さない）。
// ============================================================
import type { TrialInputDef } from "../../../lib/bot/trial/types";

export function StepForm({
  label, defs, values, busy, onChange, onSubmit, onBack,
}: {
  label: string;
  defs: TrialInputDef[];
  values: Record<string, string>;
  busy: boolean;
  onChange: (key: string, value: string) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  return (
    <div className="bg-[#161513] border border-[#37342f] rounded-xl p-4">
      <div className="text-xs font-bold text-[#f3efe8] mb-3">{label}</div>

      {defs.map((d) => (
        <div key={d.key} className="mb-3">
          <label className="block text-[11px] text-[#a8a196] mb-1.5">{d.label}</label>

          {d.type === "select" ? (
            <div className="flex flex-wrap gap-1.5">
              {(d.options ?? []).map((o) => {
                const on = values[d.key] === o;
                return (
                  <button
                    key={o}
                    type="button"
                    onClick={() => onChange(d.key, o)}
                    className={`text-[11px] rounded-full px-3 py-1.5 border ${
                      on
                        ? "bg-[rgba(238,28,37,0.14)] border-[#ee1c25] text-[#ff9ea2] font-bold"
                        : "border-[#37342f] text-[#a8a196] hover:border-[#5a564e]"
                    }`}
                  >
                    {o}
                  </button>
                );
              })}
            </div>
          ) : (
            <input
              value={values[d.key] ?? ""}
              onChange={(e) => onChange(d.key, e.target.value)}
              maxLength={d.maxLength && d.maxLength > 0 ? d.maxLength : 120}
              placeholder={d.placeholder ?? ""}
              className="w-full bg-[#100f0e] border border-[#37342f] rounded-lg px-3 py-2 text-[12.5px] text-[#f3efe8] placeholder-[#5a564e] focus:outline-none focus:border-[#ee1c25]"
            />
          )}
        </div>
      ))}

      <div className="flex items-center gap-2 mt-1">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          className="bg-[#ee1c25] text-white rounded-xl px-5 py-2.5 text-sm font-bold hover:brightness-110 disabled:opacity-40"
        >
          {busy ? "作成中…" : "これで作る"}
        </button>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          className="text-[#a8a196] border border-[#37342f] rounded-xl px-4 py-2.5 text-xs hover:border-[#5a564e] disabled:opacity-40"
        >
          戻る
        </button>
      </div>
    </div>
  );
}
