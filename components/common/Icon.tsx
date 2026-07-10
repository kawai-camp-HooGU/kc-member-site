"use client";
// ============================================================
// アプリ共通アイコン（@tabler/icons-react の outline を name キーで集約）
//   - Icon: ラインアイコン（色は親の text 色を継承＝currentColor）
//   - IconBadge: 薄赤の角丸背景＋赤ライン（ハブ/ホームのカード用）
//   絵文字はこのコンポーネント経由のラインアイコンへ順次置き換え。
// ============================================================
import {
  IconShieldLock, IconFolder, IconStack2, IconTags, IconUsers, IconClipboardList,
  IconPlayerPlay, IconSpeakerphone, IconHome, IconMessageCircle, IconLayoutDashboard,
  IconLayoutKanban, IconTimeline, IconCalendar, IconPlus, IconSettings, IconAdjustments,
  IconHelp, IconVideo, IconFileText, IconArticle, IconBell, IconTool, IconCalendarEvent,
  IconEye, IconEyeOff, IconPalette, IconTag, IconLock, IconExternalLink, IconSearch, IconX,
  IconTrash, IconLayoutGrid, IconWorld, IconBook, IconBooks, IconFileDescription,
} from "@tabler/icons-react";

// Tablerアイコンの実型（全アイコン共通）。size は number|string、stroke 等も含む。
type TablerIcon = typeof IconShieldLock;

export type IconName =
  | "shield" | "folder" | "layers" | "tags" | "users" | "template" | "content" | "news"
  | "home" | "chat" | "dashboard" | "board" | "timeline" | "calendar" | "bulk" | "settings"
  | "contentset" | "help" | "video" | "doc" | "article" | "bell" | "tool" | "event"
  | "eye" | "eyeOff" | "palette" | "tag" | "lock" | "external" | "search" | "close"
  | "trash" | "grid" | "globe" | "book" | "books" | "fileText";

const MAP: Record<IconName, TablerIcon> = {
  shield: IconShieldLock, folder: IconFolder, layers: IconStack2, tags: IconTags,
  users: IconUsers, template: IconClipboardList, content: IconPlayerPlay, news: IconSpeakerphone,
  home: IconHome, chat: IconMessageCircle, dashboard: IconLayoutDashboard, board: IconLayoutKanban,
  timeline: IconTimeline, calendar: IconCalendar, bulk: IconPlus, settings: IconSettings,
  contentset: IconAdjustments, help: IconHelp, video: IconVideo, doc: IconFileText, article: IconArticle,
  bell: IconBell, tool: IconTool, event: IconCalendarEvent, eye: IconEye, eyeOff: IconEyeOff,
  palette: IconPalette, tag: IconTag, lock: IconLock, external: IconExternalLink, search: IconSearch, close: IconX,
  trash: IconTrash, grid: IconLayoutGrid, globe: IconWorld, book: IconBook, books: IconBooks, fileText: IconFileDescription,
};

export function Icon({ name, size = 20, stroke = 1.8, className }: { name: IconName; size?: number; stroke?: number; className?: string }) {
  const C = MAP[name];
  return C ? <C size={size} stroke={stroke} className={className} /> : null;
}

// 薄赤の角丸背景＋赤ライン（設定ハブ・ホームのカード用）
export function IconBadge({ name, size = 22, box = "w-10 h-10" }: { name: IconName; size?: number; box?: string }) {
  return (
    <span className={`${box} rounded-[10px] inline-flex items-center justify-center bg-red-50 text-red-600 shrink-0`}>
      <Icon name={name} size={size} />
    </span>
  );
}
