// ============================================================
// bot 用ラインアイコン（イラストアイコン / 絵文字不使用）
//   Tabler 系のストロークアイコンをインライン SVG で提供。
//   className でサイズ・色（currentColor）を指定する。
// ============================================================
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({
  viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
  ...props,
});

export const IcPlus = (p: P) => (<svg {...base(p)}><path d="M12 5v14M5 12h14" /></svg>);
export const IcSearch = (p: P) => (<svg {...base(p)}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
export const IcClock = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>);
export const IcGlobe = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg>);
export const IcSend = (p: P) => (<svg {...base(p)}><path d="M12 20V5M5 12l7-7 7 7" /></svg>);
export const IcArrowUp = (p: P) => (<svg {...base(p)}><path d="M12 19V5M6 11l6-6 6 6" /></svg>);
export const IcPaperclip = (p: P) => (<svg {...base(p)}><path d="M20 12l-8.5 8.5a5 5 0 01-7-7L13 5a3 3 0 014 4l-8.5 8.5a1 1 0 01-1.5-1.5L15 8" /></svg>);
export const IcBookmark = (p: P) => (<svg {...base(p)}><path d="M7 4h10a1 1 0 011 1v15l-6-4-6 4V5a1 1 0 011-1z" /></svg>);
export const IcFile = (p: P) => (<svg {...base(p)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>);
export const IcX = (p: P) => (<svg {...base(p)}><path d="M6 6l12 12M18 6L6 18" /></svg>);
export const IcList = (p: P) => (<svg {...base(p)}><path d="M8 6h12M8 12h12M8 18h9M4 6h.01M4 12h.01M4 18h.01" /></svg>);
export const IcUser = (p: P) => (<svg {...base(p)}><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>);
export const IcCopy = (p: P) => (<svg {...base(p)}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h8" /></svg>);
export const IcRefresh = (p: P) => (<svg {...base(p)}><path d="M4 12a8 8 0 0114-5M20 4v3h-3M20 12a8 8 0 01-14 5M4 20v-3h3" /></svg>);
export const IcSettings = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M4.5 4.5l1.5 1.5M18 18l1.5 1.5M3 12h2M19 12h2M4.5 19.5L6 18M18 6l1.5-1.5" /></svg>);
export const IcExpand = (p: P) => (<svg {...base(p)}><path d="M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5" /></svg>);
export const IcRocket = (p: P) => (<svg {...base(p)}><path d="M5 15c-1 1-2 4-2 4s3-1 4-2M9 12a8 8 0 018-8s2 0 2 0 0 2 0 2a8 8 0 01-8 8l-3 1-1-1z" /><circle cx="14" cy="10" r="1.4" /></svg>);
export const IcCalendar = (p: P) => (<svg {...base(p)}><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></svg>);
export const IcCoin = (p: P) => (<svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="M9 9h5M9 12h4M11 7v10" /></svg>);
