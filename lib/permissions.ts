// ============================================================
// ロール権限マスタ（ロール × 機能）
//   機能の表示/利用可否をロールごとに制御。設定「権限」タブで編集。
//
//   ★2026-07 リデザイン（Phase 1）:
//     - サイドバー準拠の 9 ジャンル → 管理ドメイン準拠の「親カテゴリ」16 種へ。
//       左＝親カテゴリ、右＝子画面/子機能、という 2 ペイン権限画面に対応する。
//     - 各機能に効果説明（onEffect/offEffect）・セキュリティ（security）・
//       新規提案（proposed）・アカウント種別（account）・通知種別（notif）の
//       メタ情報を持たせ、UI がコードから直接読めるようにした。
//     - 通知は「通知管理（会員）＝ notify_member」と
//       「通知管理（運営）＝ notify_ops」に分離。
//
//   ⚠️ 後方互換:
//     既存の機能キー・既定値（DEFAULT_PERMS）・エクスポート関数は温存する。
//     アカウント単位権限（account_role_access）・通知/フォルダの enforcement は
//     Phase 2 で配線するため、ここでは「キーの定義とメタ情報」までに留める。
// ============================================================
import { supabase } from "./supabase";
import type { MemberRole } from "./database.types";
import { allRoleKeys, SYSTEM_ROLES, BASE_ROLE, isStaffRole } from "./roles";

/**
 * システム固定ロール（既定値 DEFAULT_PERMS の定義対象）。
 * 権限表の列は roles マスタから取る（roleColumns）。ここは既定値の定義に限定。
 */
export const ROLES: MemberRole[] = [...SYSTEM_ROLES];

/** 権限表に並べるロール（システム固定 ＋ 派生ロール）。未ロード時は固定4ロール。 */
export function roleColumns(): string[] {
  const keys = allRoleKeys();
  return keys.length > 0 ? keys : [...SYSTEM_ROLES];
}

export type FeatureGroup = "screen" | "func";

/**
 * 適用範囲。
 *   ops    … 運営専用（会員ロールには適用されない）
 *   member … 会員専用（運営ロールには適用されない）
 *   both   … 双方に存在する
 * ⚠️ ops の判定は lib/zone.ts の OPS_VIEWS と一致させること。
 */
export type FeatureScope = "ops" | "member" | "both";

// ── 親カテゴリ（管理ドメイン）──────────────────────────────
//   2 ペイン権限画面の左ナビ。右ペインは categoryFeatures(id) の子機能。
export interface FeatureCategory {
  id: string;
  name: string; // 表示名（日本語）
  en: string;   // 補足（英語）
}
export const FEATURE_CATEGORIES: FeatureCategory[] = [
  { id: "common",        name: "共通",             en: "Common" },
  { id: "customer",      name: "顧客管理",         en: "Customer" },
  { id: "payment",       name: "決済管理",         en: "Payment" },
  { id: "talk",          name: "トーク管理",       en: "Talk" },
  { id: "line",          name: "LINE管理",         en: "LINE" },
  { id: "mail",          name: "メール管理",       en: "Mail" },
  { id: "form",          name: "フォーム管理",     en: "Form" },
  { id: "broadcast",     name: "配信管理",         en: "Broadcast" },
  { id: "community",     name: "コミュニティ管理", en: "Community" },
  { id: "content",       name: "コンテンツ管理",   en: "Content" },
  { id: "ai",            name: "AIサポート",       en: "AI" },
  { id: "bot",           name: "ボット管理",       en: "Bot" },
  { id: "settings",      name: "設定",             en: "Settings" },
  { id: "notify_member", name: "通知管理（会員）", en: "Notify / Member" },
  { id: "notify_ops",    name: "通知管理（運営）", en: "Notify / Ops" },
  { id: "roadmap",       name: "ロードマップ管理", en: "Roadmap" },
  { id: "analytics",     name: "流入・分析管理",   en: "Analytics" },
];

export interface FeatureDef {
  key: string;
  label: string;
  group: FeatureGroup;
  scope: FeatureScope;
  /** 親カテゴリ id（未設定＝旧仕様の非表示キー） */
  category?: string;
  /** 親となる画面キー（機能を画面にぶら下げる） */
  parent?: string;
  /** 高権限（UI で「高」バッジ。既定 OFF 運用を推奨する目印） */
  security?: boolean;
  /** 新規に権限キー化を提案した項目（UI で「新」バッジ） */
  proposed?: boolean;
  /** 通知系機能（Phase 2: アカウント単位で 通知/停止 を設定） */
  notif?: boolean;
  /** アカウント単位で制御する種別（Phase 2: account_role_access） */
  account?: "line" | "mail";
  /** AIサポート横断ビューにも出す（本来のカテゴリは別） */
  aiRelated?: boolean;
  /** 既定 ON: メンバー / 外部（DEFAULT_PERMS の算出に使用） */
  memberDefault?: boolean;
  externalDefault?: boolean;
  /** 効果説明（UI の色付きテキスト） */
  onEffect?: string;
  offEffect?: string;
  /** 注意書き（流用キー・影響範囲など） */
  warn?: string;
  /** 旧仕様の互換キー（enforcement のため残すが新 UI には出さない） */
  legacy?: boolean;
}

export const FEATURES: FeatureDef[] = [
  // ── 共通 ────────────────────────────────────────────────
  { key: "home",         label: "ホーム",       group: "screen", scope: "both", category: "common", memberDefault: true, externalDefault: true, onEffect: "メニューに表示・ホームを開ける", offEffect: "メニューから消え退避先へ" },
  { key: "help",         label: "ヘルプ",       group: "screen", scope: "both", category: "common", memberDefault: true, externalDefault: true, onEffect: "ヘルプ画面を表示", offEffect: "ヘルプ導線を隠す" },
  { key: "news_view",    label: "お知らせ表示", group: "screen", scope: "both", category: "common", proposed: true, memberDefault: true, externalDefault: true, onEffect: "お知らせ一覧・詳細を閲覧", offEffect: "お知らせを表示しない" },
  { key: "notif_center", label: "通知センター（ベル）", group: "func", scope: "both", category: "common", proposed: true, memberDefault: true, onEffect: "新着通知の一覧を表示", offEffect: "通知ベルを非表示" },
  { key: "global_search",label: "横断検索",     group: "func",   scope: "ops",  category: "common", proposed: true, onEffect: "顧客/トーク/メール横断で検索", offEffect: "検索窓を非表示" },

  // ── 顧客管理 ────────────────────────────────────────────
  { key: "customers",    label: "顧客一覧（会員∪LINE）", group: "screen", scope: "ops", category: "customer", proposed: true, onEffect: "顧客一覧を表示", offEffect: "メニュー非表示", warn: "会員とLINE友だちを横断表示。個人情報を含む" },
  { key: "member_detail",label: "会員詳細",     group: "screen", scope: "ops", category: "customer", onEffect: "会員の詳細・履歴を閲覧", offEffect: "詳細を開けない" },
  { key: "member_edit",  label: "会員情報の編集", group: "func", scope: "ops", category: "customer", proposed: true, onEffect: "会員情報を編集", offEffect: "閲覧のみ" },
  { key: "unregistered", label: "会員未登録タブ", group: "func", scope: "ops", category: "customer", proposed: true, onEffect: "未登録メールを表示", offEffect: "非表示" },
  { key: "member_merge", label: "名寄せ・マージ", group: "func", scope: "ops", category: "customer", security: true, proposed: true, onEffect: "重複会員を統合", offEffect: "統合不可" },
  { key: "member_delete",label: "会員の削除",   group: "func",   scope: "ops", category: "customer", security: true, proposed: true, onEffect: "会員を削除できる", offEffect: "削除不可", warn: "取り消し不可の高権限操作" },
  { key: "member_bulk",  label: "一括登録・エクスポート", group: "func", scope: "ops", category: "customer", proposed: true, onEffect: "CSV入出力が可能", offEffect: "不可" },
  // ── リスト管理（配信先リスト）──
  //   ⚠️ 既定は全ロール OFF（管理者のみ）。必要なロールに運用側で付与する。
  { key: "contact_list",        label: "リスト管理",             group: "screen", scope: "ops", category: "customer", proposed: true, onEffect: "リスト管理画面を表示", offEffect: "メニュー非表示", warn: "メール・電話番号を保持。個人情報を含む" },
  { key: "contact_list_import", label: "リストの一括取り込み",   group: "func",   scope: "ops", category: "customer", parent: "contact_list", proposed: true, onEffect: "CSVから一括登録できる", offEffect: "手入力のみ" },
  { key: "contact_list_export", label: "リストのエクスポート",   group: "func",   scope: "ops", category: "customer", parent: "contact_list", security: true, proposed: true, onEffect: "CSVで書き出せる", offEffect: "書き出し不可", warn: "個人情報の持ち出し。付与は限定推奨" },
  { key: "contact_list_delete", label: "リスト・レコードの削除", group: "func",   scope: "ops", category: "customer", parent: "contact_list", security: true, proposed: true, onEffect: "レコード削除・リストのアーカイブが可能", offEffect: "不可" },

  // ── 決済管理 ────────────────────────────────────────────
  { key: "payment_manage", label: "決済一覧",   group: "screen", scope: "ops", category: "payment", onEffect: "決済画面を表示", offEffect: "メニュー非表示" },
  { key: "payment_master", label: "決済マスタ編集", group: "func", scope: "ops", category: "payment", parent: "payment_manage", onEffect: "マスタ編集が可能", offEffect: "閲覧のみ" },
  { key: "payment_admin",  label: "スクショ閲覧・完全削除", group: "func", scope: "ops", category: "payment", parent: "payment_manage", security: true, onEffect: "スクショ閲覧・物理削除が可能", offEffect: "不可", warn: "個人情報を含む高権限" },
  { key: "refund_manage",  label: "返金・解約", group: "screen", scope: "ops", category: "payment", onEffect: "返金・解約画面を表示", offEffect: "メニュー非表示" },
  { key: "refund_master",  label: "返金・解約マスタ編集", group: "func", scope: "ops", category: "payment", parent: "refund_manage", onEffect: "マスタ編集が可能", offEffect: "閲覧のみ" },
  { key: "refund_admin",   label: "返金・解約マスタの完全削除", group: "func", scope: "ops", category: "payment", parent: "refund_manage", security: true, onEffect: "マスタの物理削除が可能", offEffect: "不可", warn: "取り消し不可の高権限操作" },

  // ── トーク管理 ──────────────────────────────────────────
  { key: "chat",         label: "ポータルトーク（会話）", group: "screen", scope: "both", category: "talk", memberDefault: true, onEffect: "トークを表示（未読連動）", offEffect: "メニュー非表示・未読購読も停止" },
  { key: "chat_inbox",   label: "統合インボックス", group: "func", scope: "ops", category: "talk", proposed: true, onEffect: "全チャネルの未対応を集約表示", offEffect: "集約表示なし" },
  { key: "ai",           label: "AI返信支援",   group: "func",   scope: "ops", category: "talk", parent: "chat", aiRelated: true, onEffect: "返信案パネルを表示", offEffect: "非表示" },
  { key: "bookmarks",    label: "ブックマーク（ナレッジ）", group: "screen", scope: "ops", category: "talk", onEffect: "ブックマークを表示", offEffect: "メニュー非表示" },
  { key: "summary",      label: "対応サマリー", group: "screen", scope: "ops", category: "talk", proposed: true, onEffect: "コミュニケーション集約を表示", offEffect: "メニュー非表示" },
  { key: "staff_activity", label: "スタッフ別 対応ログ", group: "screen", scope: "ops", category: "talk", security: true, onEffect: "個人稼働ログを表示", offEffect: "非表示", warn: "個人の稼働が見えるため公開範囲注意" },

  // ── LINE管理 ────────────────────────────────────────────
  { key: "line_chat",    label: "LINEトーク",   group: "screen", scope: "ops", category: "line", account: "line", onEffect: "LINEトークを表示", offEffect: "メニュー非表示" },
  { key: "line_friends", label: "LINE友だち一覧", group: "screen", scope: "ops", category: "line", account: "line", onEffect: "友だち一覧を表示", offEffect: "メニュー非表示" },
  { key: "line_match",   label: "LINE名寄せ",   group: "screen", scope: "ops", category: "line", onEffect: "名寄せキューを表示", offEffect: "非表示" },
  { key: "line_richmenu",label: "リッチメニュー", group: "screen", scope: "ops", category: "line", onEffect: "リッチメニュー編集を表示", offEffect: "非表示" },
  { key: "line_autoreply",label: "自動応答", group: "screen", scope: "ops", category: "line", onEffect: "キーワード自動応答を表示", offEffect: "非表示" },
  { key: "line_analytics",label: "LINE分析", group: "screen", scope: "ops", category: "line", onEffect: "LINE分析ダッシュボードを表示", offEffect: "非表示" },
  { key: "line_template",label: "テンプレート", group: "screen", scope: "ops", category: "line", onEffect: "テンプレート管理を表示", offEffect: "非表示" },
  { key: "line_account", label: "LINEアカウント管理", group: "screen", scope: "ops", category: "line", security: true, onEffect: "接続・確認・削除を表示", offEffect: "非表示" },

  // ── メール管理 ──────────────────────────────────────────
  { key: "mailbox",      label: "受信トレイ",   group: "screen", scope: "ops", category: "mail", account: "mail", onEffect: "受信トレイを表示", offEffect: "非表示" },
  { key: "mailthreads",  label: "会話（スレッド）", group: "screen", scope: "ops", category: "mail", account: "mail", onEffect: "送受信スレッドを表示", offEffect: "非表示" },
  { key: "mail_send",    label: "メール送信・返信", group: "func", scope: "ops", category: "mail", proposed: true, onEffect: "送信・返信が可能", offEffect: "閲覧のみ" },
  { key: "mail",         label: "アカウント接続管理", group: "screen", scope: "ops", category: "mail", security: true, onEffect: "接続・確認・削除を表示", offEffect: "非表示" },
  { key: "mail_folder",  label: "フォルダ管理", group: "func", scope: "ops", category: "mail", proposed: true, onEffect: "フォルダ作成・整理が可能", offEffect: "不可" },

  // ── フォーム管理 ────────────────────────────────────────
  { key: "form",         label: "フォーム一覧", group: "screen", scope: "ops", category: "form", onEffect: "フォーム管理を表示", offEffect: "非表示" },
  { key: "form_edit",    label: "フォーム作成・編集", group: "func", scope: "ops", category: "form", proposed: true, onEffect: "作成・編集が可能", offEffect: "閲覧のみ" },
  { key: "form_submissions", label: "回答一覧・集計", group: "screen", scope: "ops", category: "form", proposed: true, onEffect: "回答を閲覧・集計", offEffect: "非表示" },
  { key: "form_publish", label: "公開設定",     group: "func",   scope: "ops", category: "form", proposed: true, onEffect: "公開/非公開を切替", offEffect: "切替不可" },
  { key: "form_folder",  label: "フォルダ管理", group: "func", scope: "ops", category: "form", proposed: true, onEffect: "フォルダ整理が可能", offEffect: "不可" },

  // ── 配信管理 ────────────────────────────────────────────
  { key: "broadcast",    label: "一斉配信",     group: "screen", scope: "ops", category: "broadcast", onEffect: "配信画面を表示", offEffect: "非表示" },
  { key: "ai_draft",     label: "AI配信原稿生成", group: "func", scope: "ops", category: "broadcast", parent: "broadcast", aiRelated: true, onEffect: "原稿AI生成ボタンを表示", offEffect: "非表示" },
  { key: "scenario",     label: "シナリオ配信", group: "screen", scope: "ops", category: "broadcast", onEffect: "シナリオを表示", offEffect: "非表示" },
  { key: "broadcast_send", label: "配信の実行（送信）", group: "func", scope: "ops", category: "broadcast", security: true, proposed: true, onEffect: "実配信を実行できる", offEffect: "下書きまで", warn: "誤送信防止のため付与は限定推奨" },
  { key: "bc_folder",    label: "配信フォルダ管理", group: "func", scope: "ops", category: "broadcast", proposed: true, onEffect: "フォルダ整理が可能", offEffect: "不可" },

  // ── コミュニティ管理 ────────────────────────────────────
  { key: "calendar",     label: "カレンダー",   group: "screen", scope: "both", category: "community", memberDefault: true, externalDefault: true, onEffect: "予定表を表示", offEffect: "非表示" },
  { key: "event_manage", label: "イベント・予定の管理", group: "func", scope: "ops", category: "community", parent: "calendar", onEffect: "予定の作成・編集が可能", offEffect: "閲覧のみ" },
  { key: "news_manage",  label: "お知らせ管理（編集）", group: "func", scope: "ops", category: "community", proposed: true, onEffect: "お知らせの作成・編集", offEffect: "閲覧のみ", warn: "表示側は共通「お知らせ表示」と共有" },
  { key: "ai_consult",   label: "AI相談チャット（メンバー）", group: "func", scope: "member", category: "community", parent: "chat", aiRelated: true, memberDefault: true, onEffect: "会員向けAI相談を表示", offEffect: "非表示" },
  { key: "comm_content", label: "コミュニティ内コンテンツ表示", group: "func", scope: "both", category: "community", proposed: true, memberDefault: true, externalDefault: true, onEffect: "会員向けコンテンツを表示", offEffect: "非表示" },

  // ── コンテンツ管理 ──────────────────────────────────────
  { key: "content",        label: "コンテンツ一覧", group: "screen", scope: "both", category: "content", memberDefault: true, externalDefault: true, onEffect: "コンテンツ一覧を表示", offEffect: "非表示" },
  { key: "content_manage", label: "コンテンツ設定・編集", group: "func", scope: "ops", category: "content", parent: "content", onEffect: "作成・編集・並べ替えが可能", offEffect: "閲覧のみ", warn: "コンテンツ/お知らせ/フォーム完了画面に共通で影響" },
  { key: "ai_html",        label: "AI HTMLコード生成", group: "func", scope: "ops", category: "content", parent: "content", security: true, aiRelated: true, onEffect: "本文AI生成ボタンを表示", offEffect: "非表示" },
  { key: "content_publish",label: "公開範囲（属性）設定", group: "func", scope: "ops", category: "content", proposed: true, onEffect: "属性による公開範囲を設定", offEffect: "設定不可" },
  { key: "content_folder", label: "コンテンツフォルダ管理", group: "func", scope: "ops", category: "content", proposed: true, onEffect: "フォルダ整理が可能", offEffect: "不可" },

  // ── AIサポート（横断。aiRelated は本来のカテゴリにも所属）────
  { key: "ai_data_search", label: "AIデータ検索", group: "func", scope: "ops", category: "ai", proposed: true, onEffect: "ナレッジ横断のAI検索", offEffect: "非表示" },
  { key: "ai_prompts",     label: "AIプロンプト管理", group: "screen", scope: "ops", category: "ai", security: true, proposed: true, onEffect: "プロンプト定義を編集", offEffect: "非表示", warn: "AI挙動全体に影響。管理者向け" },

  // ── ボット管理（公開問い合わせボット）──────────────────
  { key: "bot",        label: "チャットボット", group: "screen", scope: "both", category: "bot", memberDefault: true, onEffect: "チャットボットを表示・利用", offEffect: "メニュー非表示" },
  { key: "bot_manage", label: "ボット設定・ナレッジ管理", group: "func", scope: "ops", category: "bot", parent: "bot", onEffect: "ポリシー・索引・体験版URLを管理", offEffect: "設定不可" },

  // ── 設定（マスタ）────────────────────────────────────────
  { key: "master",         label: "設定（マスタ管理）", group: "screen", scope: "ops", category: "settings", onEffect: "設定画面を表示", offEffect: "メニュー非表示（配下も無効）" },
  { key: "set_permission", label: "権限",       group: "screen", scope: "ops", category: "settings", parent: "master", security: true, onEffect: "権限を編集（運営列は除く）", offEffect: "非表示" },
  { key: "set_role",       label: "ロール",     group: "screen", scope: "ops", category: "settings", parent: "master", security: true, onEffect: "ロール追加・編集", offEffect: "非表示" },
  { key: "set_member",     label: "メンバー",   group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "メンバー管理", offEffect: "非表示", warn: "顧客管理と一部重複" },
  { key: "set_attribute",  label: "属性",       group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "属性マスタ編集", offEffect: "非表示" },
  { key: "set_news",       label: "お知らせ",   group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "お知らせマスタ編集", offEffect: "非表示" },
  { key: "set_source",     label: "流入経路",   group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "流入経路マスタ編集", offEffect: "非表示" },
  { key: "set_welcome",    label: "初回メッセージ", group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "初回メッセージ編集", offEffect: "非表示" },
  { key: "set_notify",     label: "通知の文面", group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "通知テンプレ編集", offEffect: "非表示" },
  { key: "set_project",    label: "プロジェクト", group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "プロジェクトマスタ編集", offEffect: "非表示" },
  { key: "set_anken",      label: "分類（案件）", group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "案件分類編集", offEffect: "非表示" },
  { key: "set_template",   label: "テンプレート", group: "screen", scope: "ops", category: "settings", parent: "master", onEffect: "テンプレ編集", offEffect: "非表示" },
  { key: "folder_perm",    label: "フォルダ権限（横断）", group: "func", scope: "ops", category: "settings", proposed: true, onEffect: "フォルダ作成・共有を許可", offEffect: "不可" },
  { key: "account_perm",   label: "LINE/メール アカウント権限", group: "func", scope: "ops", category: "settings", security: true, proposed: true, onEffect: "アカウント単位の割当を編集", offEffect: "不可" },

  // ── 通知管理（会員）─────────────────────────────────────
  { key: "notification",    label: "通知設定画面", group: "screen", scope: "both", category: "notify_member", memberDefault: true, externalDefault: true, onEffect: "会員が自分の通知設定を開ける", offEffect: "非表示" },
  { key: "notify_push_chat",label: "トークのプッシュ通知", group: "func", scope: "member", category: "notify_member", proposed: true, memberDefault: true, onEffect: "トークのプッシュを受信できる", offEffect: "受信しない" },
  { key: "notify_push_news",label: "お知らせのプッシュ通知", group: "func", scope: "member", category: "notify_member", proposed: true, memberDefault: true, externalDefault: true, onEffect: "お知らせのプッシュを受信できる", offEffect: "受信しない" },

  // ── 通知管理（運営）─────────────────────────────────────
  { key: "ntf_talk_push_portal", label: "トーク受信 プッシュ/デスクトップ：ポータルトーク", group: "func", scope: "ops", category: "notify_ops", proposed: true, onEffect: "ポータルトーク受信時にプッシュ/デスクトップ通知", offEffect: "通知しない" },
  { key: "ntf_talk_push_line",   label: "トーク受信 プッシュ/デスクトップ：LINE",       group: "func", scope: "ops", category: "notify_ops", proposed: true, notif: true, account: "line", onEffect: "LINE受信時にプッシュ/デスクトップ通知", offEffect: "通知しない", warn: "アカウント単位で通知有無を設定できます" },
  { key: "ntf_talk_push_mail",   label: "トーク受信 プッシュ/デスクトップ：メール",     group: "func", scope: "ops", category: "notify_ops", proposed: true, notif: true, account: "mail", onEffect: "メール受信時にプッシュ/デスクトップ通知", offEffect: "通知しない", warn: "アカウント単位で通知有無を設定できます" },
  { key: "ntf_talk_mail_portal", label: "トーク受信 メール通知：ポータルトーク",       group: "func", scope: "ops", category: "notify_ops", proposed: true, onEffect: "ポータルトーク受信をメール（アカウントID宛）通知", offEffect: "通知しない" },
  { key: "ntf_talk_mail_line",   label: "トーク受信 メール通知：LINE",                 group: "func", scope: "ops", category: "notify_ops", proposed: true, notif: true, account: "line", onEffect: "LINE受信をメール（アカウントID宛）通知", offEffect: "通知しない", warn: "アカウント単位で通知有無を設定できます" },
  { key: "ntf_talk_mail_mail",   label: "トーク受信 メール通知：メール",               group: "func", scope: "ops", category: "notify_ops", proposed: true, notif: true, account: "mail", onEffect: "メール受信をメール（アカウントID宛）通知", offEffect: "通知しない", warn: "アカウント単位で通知有無を設定できます" },
  { key: "ntf_form_push",        label: "フォーム回答受信 プッシュ/デスクトップ通知",   group: "func", scope: "ops", category: "notify_ops", proposed: true, onEffect: "フォーム回答受信時にプッシュ/デスクトップ通知", offEffect: "通知しない" },
  { key: "ntf_form_mail",        label: "フォーム回答受信 メール通知",                 group: "func", scope: "ops", category: "notify_ops", proposed: true, onEffect: "フォーム回答受信をメール（アカウントID宛）通知", offEffect: "通知しない" },
  { key: "chatwork",             label: "ChatWork通知（タスク期限）",                 group: "func", scope: "ops", category: "notify_ops", onEffect: "ChatWork連携（期限通知）を利用", offEffect: "非表示" },

  // ── ロードマップ管理 ────────────────────────────────────
  { key: "dashboard",     label: "ダッシュボード", group: "screen", scope: "both", category: "roadmap", onEffect: "ダッシュボードを表示", offEffect: "ホーム/カンバンへ退避" },
  { key: "kanban",        label: "カンバン",     group: "screen", scope: "both", category: "roadmap", memberDefault: true, onEffect: "カンバンを表示", offEffect: "非表示" },
  { key: "gantt",         label: "ガント",       group: "screen", scope: "both", category: "roadmap", memberDefault: true, onEffect: "ガントを表示", offEffect: "非表示" },
  { key: "bulk_register", label: "一括登録",     group: "screen", scope: "ops", category: "roadmap", onEffect: "ガント内に一括登録導線", offEffect: "非表示" },
  { key: "task_edit",     label: "タスクの編集", group: "func",   scope: "both", category: "roadmap", proposed: true, memberDefault: true, onEffect: "担当タスクを編集", offEffect: "閲覧のみ" },

  // ── 流入・分析管理 ──────────────────────────────────────
  { key: "source_view",   label: "流入経路の実績", group: "screen", scope: "ops", category: "analytics", proposed: true, onEffect: "流入計測の実績を表示", offEffect: "非表示" },
  { key: "engagement",    label: "エンゲージメント分析", group: "screen", scope: "ops", category: "analytics", proposed: true, onEffect: "閲覧・反応の分析を表示", offEffect: "非表示" },
  { key: "content_engage",label: "コンテンツ別 反応", group: "func", scope: "ops", category: "analytics", proposed: true, onEffect: "コンテンツ毎の反応を表示", offEffect: "非表示" },

  // ── 互換キー（enforcement のため残置。新 UI には出さない）──
  //   会員向けプッシュ通知の一括トグル。Phase 2 で notify_push_chat/news へ移行する。
  { key: "notify",        label: "通知（会員プッシュ・旧）", group: "func", scope: "both", legacy: true },
];

/**
 * そのロールにこの機能が適用されるか。false なら権限表で「－」を表示する。
 * ⚠️ isStaffRole() を使うため、派生ロールは自動的に「運営」として扱われる。
 */
export function appliesTo(f: FeatureDef, role: string): boolean {
  if (f.scope === "both") return true;
  return f.scope === "ops" ? isStaffRole(role) : !isStaffRole(role);
}

export const FEATURE_GROUP_LABEL: Record<FeatureGroup, string> = {
  screen: "画面（表示 / 非表示）",
  func:   "機能（使用有無）",
};
export type Feature = string;

/** カテゴリに属する子機能。AIサポートは aiRelated も横断で集約する。 */
export function categoryFeatures(catId: string): FeatureDef[] {
  if (catId === "ai") {
    return FEATURES.filter((f) => !f.legacy && (f.category === "ai" || f.aiRelated));
  }
  return FEATURES.filter((f) => !f.legacy && f.category === catId);
}

/** 親カテゴリ（子機能つき）一覧。UI の左ナビ用。 */
export function categoriesWithFeatures(): (FeatureCategory & { features: FeatureDef[] })[] {
  return FEATURE_CATEGORIES.map((c) => ({ ...c, features: categoryFeatures(c.id) }));
}

export const ADMIN_ROLE = "管理者";
export const isAdminRole = (role: string): boolean => role === ADMIN_ROLE;

/**
 * 管理者でも OFF にできない機能（ロックアウト防止）。
 * ⚠️ これを外すと、管理者が自分で「設定」を OFF にした瞬間に設定画面へ入れなくなる。
 */
export const ADMIN_LOCKED_FEATURES: readonly string[] = ["master", "home"];
export const isAdminLocked = (feature: string): boolean =>
  ADMIN_LOCKED_FEATURES.includes(feature);

/** 権限表に表示するロール列。管理者列は管理者本人にだけ見せる。 */
export function visibleRoleColumns(viewerIsAdmin: boolean): string[] {
  const cols = roleColumns();
  return viewerIsAdmin ? cols : cols.filter((r) => !isAdminRole(r));
}

/**
 * 閲覧者がそのロール列を編集できるか。
 * ⚠️ オペレーターは会員側ロール（メンバー・外部）しか編集できない（権限昇格の防止）。
 *    サーバー側も role_permissions の RLS で同じ条件を課すこと。
 */
export function canEditRoleColumn(viewerIsAdmin: boolean, targetRole: string): boolean {
  if (viewerIsAdmin) return true;
  return !isStaffRole(targetRole);
}

/** `${role}::${feature}` → enabled のマップ */
export type PermMap = Record<string, boolean>;
export const permKey = (role: string, feature: string): string => `${role}::${feature}`;

// ── 既定値 ────────────────────────────────────────────────
//   管理者=全 ON。オペレーター=運営/共通の機能（高権限の一部を除く）。
//   メンバー/外部=memberDefault/externalDefault フラグを持つ機能のみ。
//
//   ⚠️ 既存キーの既定値は従来と一致させること（role_permissions に行が無い環境で
//      canFor() のフォールバックに使われるため）。
const OPS_EXCLUDE: readonly string[] = [
  // 従来から除外（会員専用 or 高権限）
  "ai_consult", "ai_html", "payment_admin", "set_permission", "set_role",
  // 新規の高権限（既定は管理者のみ）
  "member_delete", "member_merge", "broadcast_send", "ai_prompts", "account_perm",
  "refund_admin",
  // リスト管理（新規）：既定は管理者のみ。運用側で必要なロールに付与する
  "contact_list", "contact_list_import", "contact_list_export", "contact_list_delete",
];

const ALLOW: Record<string, string[]> = {
  "管理者":       FEATURES.map((f) => f.key),
  // ⚠️ legacy キー（notify 等）も従来どおり含める（既存の既定値を変えないため）。
  "オペレーター": FEATURES.map((f) => f.key).filter((k) => !OPS_EXCLUDE.includes(k)),
  "メンバー":     FEATURES.filter((f) => f.memberDefault).map((f) => f.key),
  "外部":         FEATURES.filter((f) => f.externalDefault).map((f) => f.key),
};

// ⚠️ 既定値を持つのはシステム固定4ロールのみ。派生ロールは copy_role_permissions() で初期化。
export const DEFAULT_PERMS: PermMap = (() => {
  const m: PermMap = {};
  for (const role of ROLES) for (const f of FEATURES) m[permKey(role, f.key)] = (ALLOW[role] ?? []).includes(f.key);
  return m;
})();

/** 派生ロール作成時に複製元となるロール（＝オペレーター）*/
export const COPY_SOURCE_ROLE = BASE_ROLE;

/**
 * 指定ロールが機能を使えるか（管理者は「設定」「ホーム」だけ常時ON。未設定は既定値）。
 * ⚠️ 派生ロールは DEFAULT_PERMS を持たないため、role_permissions に行が無ければ false（安全側）。
 */
export function canFor(perms: PermMap | null, role: string, feature: Feature): boolean {
  if (isAdminRole(role) && isAdminLocked(feature)) return true;
  const k = permKey(role, feature);
  const m = perms ?? DEFAULT_PERMS;
  return m[k] ?? DEFAULT_PERMS[k] ?? false;
}

export async function loadRolePermissions(): Promise<PermMap> {
  const { data, error } = await supabase.from("role_permissions").select("*");
  if (error || !data || data.length === 0) return { ...DEFAULT_PERMS };
  const m: PermMap = { ...DEFAULT_PERMS };
  for (const r of data) m[permKey(r.role, r.feature)] = r.enabled;
  return m;
}

export async function saveRolePermission(role: string, feature: string, enabled: boolean): Promise<void> {
  await supabase.from("role_permissions").upsert({ role, feature, enabled }, { onConflict: "role,feature" });
}
