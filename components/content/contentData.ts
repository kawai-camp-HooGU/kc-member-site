import type { ContentGenre, ContentItem } from "../../lib/models";

export interface ContentGenreDef { key: ContentGenre; label: string; icon: string; }
export const CONTENT_GENRES: ContentGenreDef[] = [
  { key: "video", label: "動画",           icon: "▷" },
  { key: "file",  label: "資料・ファイル", icon: "▤" },
  { key: "link",  label: "リンク集",       icon: "🔗" },
];
export const GENRE_LABEL: Record<ContentGenre, string> = { video: "動画", file: "資料・ファイル", link: "リンク集" };
export const GENRE_PILL: Record<ContentGenre, string> = {
  video: "bg-red-100 text-red-700", file: "bg-neutral-200 text-neutral-700", link: "bg-rose-100 text-rose-700",
};

// サンプルコンテンツ（本実装では Supabase の contents テーブルから取得予定）
export const CONTENT_SAMPLE: ContentItem[] = [
  { id: 1,  genre: "video", title: "新メンバー オリエンテーション", meta: "12:40", date: "2026-07-01", badge: "必見", target: "all",                    published: true  },
  { id: 2,  genre: "video", title: "夏合宿 事前研修セミナー",       meta: "28:05", date: "2026-06-28",              target: ["合宿参加者"],            published: true  },
  { id: 3,  genre: "video", title: "安全管理マニュアル動画",         meta: "06:22", date: "2026-06-20",              target: "all",                    published: true  },
  { id: 4,  genre: "video", title: "リーダー向け 進行講習",           meta: "09:48", date: "2026-07-05", badge: "限定", target: ["河合", "佐藤", "山嵜"], published: true  },
  { id: 11, genre: "file",  title: "2026 合宿 参加者ガイド.pdf",      meta: "PDF · 3.2MB",  date: "2026-07-03", ext: "PDF",  target: ["合宿参加者"], published: true  },
  { id: 12, genre: "file",  title: "持ち物チェックリスト.xlsx",       meta: "XLSX · 88KB",  date: "2026-07-02", ext: "XLSX", target: "all",         published: true  },
  { id: 13, genre: "file",  title: "安全管理マニュアル.pdf",          meta: "PDF · 1.9MB",  date: "2026-06-30", ext: "PDF",  badge: "必読", target: "all", published: true  },
  { id: 14, genre: "file",  title: "会員規約 最新版.docx",            meta: "DOCX · 210KB", date: "2026-06-28", ext: "DOCX", target: "all",         published: false },
  { id: 21, genre: "link",  title: "会員専用 予約システム",           meta: "reserve.kawai-camp.jp",     url: "#", licon: "🔗", target: "all",       published: true  },
  { id: 22, genre: "link",  title: "メンバー交流 Chatworkグループ",   meta: "chatwork.com/g/kawaicamp",  url: "#", licon: "💬", target: "all",       published: true  },
  { id: 23, genre: "link",  title: "活動写真アルバム",                meta: "photos.google.com/share/…", url: "#", licon: "📷", target: ["正会員"],  published: true  },
];
