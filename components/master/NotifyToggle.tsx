"use client";
export interface NotifyToggleProps { on: boolean; onClick: () => void; disabled?: boolean; }
export function NotifyToggle({ on, onClick, disabled }: NotifyToggleProps) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`relative inline-flex w-9 h-5 rounded-full transition-colors shrink-0 ${on ? "bg-green-500" : "bg-gray-300"} disabled:opacity-40`}
      aria-pressed={on}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
    </button>
  );
}
