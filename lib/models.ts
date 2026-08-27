// ============================================================
// アプリ内ドメイン型（camelCase）
// lib/supabase.ts の変換ヘルパー（toProject 等）の戻り値と一致させる。
// ============================================================
import type { RiskLevel, TaskStatus, MemberRole } from "./database.types";

export type Risk = RiskLevel;
export type Status = TaskStatus;
export type Role = MemberRole;

/** 重要度: 1=Ⅰ / 2=Ⅱ / 3=Ⅲ / "none"=なし（DBのNULLに対応） */
export type Importance = 1 | 2 | 3 | "none";

/** 権限（内部ロール）: members.role（日本語）から解決 */
export type PermissionRole = "admin" | "leader" | "member" | "external";

/**
 * プロジェクト区分マスタ（設定 ＞ プロジェクト ＞ サブマスタ）。
 *   一覧の行頭バー・区分チップ・ガントのフェーズ帯の色を決める。
 *   ⚠️ color は #RRGGBB。brand.md の許容色（赤の濃淡・無彩色）だけを入れる。
 *      選択肢は lib/constants.ts の CATEGORY_COLORS に集約している。
 */
export interface ProjectCategory {
  id: number;
  name: string;
  color: string;
  note: string;
  sortOrder: number;
  isDeleted: boolean;
}

/** フェーズ進捗ステータスの適用範囲 */
export type PhaseStatusScope = "common" | "category";

/**
 * フェーズ進捗ステータスマスタ（設定 ＞ フェーズ ＞ 進捗ステータス編集）。
 *   scope="common"   … 全区分共通
 *   scope="category" … categoryId の区分でだけ選べる
 *   フェーズの選択肢は「その区分専用 ＋ 共通」。区分なしのPJは共通のみ。
 */
export interface PhaseStatus {
  id: number;
  scope: PhaseStatusScope;
  /** scope="category" のときだけ値が入る */
  categoryId: number | null;
  name: string;
  color: string;
  /** 新規フェーズの初期値。各スコープで1件だけ */
  isDefault: boolean;
  /** 完了扱い。フェーズ一覧の「完了を除外」とガントの完了フィルタで使う */
  isDone: boolean;
  sortOrder: number;
  isDeleted: boolean;
}

export interface Project {
  id: number;
  name: string;
  abbreviation: string;
  /** プロジェクト区分（project_categories.id）。null = 区分なし */
  categoryId: number | null;
  startDate: string;
  dueDate: string;
  closeDate: string;
  notifyChat: string;
  checkpoint1Name: string;
  checkpoint1Date: string;
  checkpoint2Name: string;
  checkpoint2Date: string;
  checkpoint3Name: string;
  checkpoint3Date: string;
  progress: number;
  risk: Risk;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  memberNames: string[];
  notifyOverrides: Record<string, unknown>;
  isDeleted: boolean;
}

export interface Anken {
  id: number;
  projectId: number;
  name: string;
  abbreviation: string;
  leaderId: number | null;
  leader: string;
  /** フェーズ進捗ステータス（phase_statuses.id）。null = 未設定（既定ステータス扱い） */
  statusId: number | null;
  progress: number;
  risk: Risk;
  dueDate: string;
  lastUpdated: string;
  tasksDueThisWeek: number;
  tasksDelayed: number;
  tasksCompleted: number;
  isDeleted: boolean;
}

export interface Task {
  id: number;
  projectId: number;
  ankenId: number;
  name: string;
  assigneeIds: number[];
  assignees: string[];
  start: string;
  end: string;
  status: Status;
  risk: Risk;
  progressMemo: string;
  specialNotes: string;
  materials: string;
  completedAt: string | null;
  importance: Importance;
  updatedAt: string | null;
  updatedBy: string;
}

/** メモタイトルマスタ（設定 ＞ マスタ管理 ＞ メモタイトル） */
export interface MemoTitle {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;   // false = 新規選択の候補から外す（既存メモの表示は保持）
}

/**
 * メモの登録元。
 *   manual … 運営がメンバー詳細画面で手動追加
 *   form   … フォーム回答から自動連携（回答詳細へ辿れる）
 * ⚠️ 証跡のため読み取り専用。UIから書き換えさせない。
 */
export type MemoSource =
  | { kind: "manual" }
  | { kind: "form"; formId: number | null; formName: string; submissionId: number | null };

export interface MemberMemo {
  id?: number;
  /** メモタイトルマスタ(memo_titles.id)。null = 未選択 or 旧・自由入力の移行漏れ */
  titleId: number | null;
  /** @deprecated 旧・自由入力タイトル。表示フォールバック用に残す（新規入力では使わない）。 */
  title?: string;
  body: string;
  /** 登録元（読み取り専用） */
  source: MemoSource;
  updatedAt: string;
}

// ============================================================
// 顧客（データ種別・LINE統合名寄せ）
//   会員(members) と LINE友だち(line_friends) を「データ種別」で束ねた読み取りモデル。
//   統合(名寄せ)は「会員=親、LINE=子」の一方向。会員の空項目だけを非破壊で補完する。
// ============================================================
export type CustomerKind = "member" | "line";
export const CUSTOMER_KIND_LABEL: Record<CustomerKind, string> = { member: "会員", line: "LINE" };

/** 顧客一覧（v_customers）の1行 */
export interface Customer {
  dataKind: CustomerKind;
  memberId: number | null;       // 会員行=会員ID / LINE行=統合先(親)の会員ID or null
  friendId: number | null;       // LINE行=line_friends.id
  lineAccountId: number | null;  // LINE公式アカウント
  lineUserId: string | null;
  displayName: string;
  email: string;
  phone: string;
  status: "active" | "merged";   // merged = 統合済（親へ集約された子）
  createdAt: string;
}

/** 統合プレビューの1項目（実行前の差分確認） */
export interface MergeFieldDiff {
  field: "kana" | "email" | "tel" | "line_user_id";
  label: string;
  parentValue: string;   // 親（会員）の現在値
  childValue: string;    // 子（LINE）の値
  willFill: boolean;     // true = 親が空なので補完する（非破壊）
}

export interface MergePreview {
  friendId: number;
  memberId: number;
  memberName: string;
  lineDisplayName: string;
  diffs: MergeFieldDiff[];
}

/** 統合履歴の1件（customer_merge_history） */
export interface CustomerMergeHistory {
  id: number;
  memberId: number;
  friendId: number | null;
  field: string;
  oldValue: string;
  newValue: string;
  sourceKind: string;
  matchedBy: string;
  mergedBy: string;
  action: "merge" | "unmerge";
  createdAt: string;
}

export interface Member {
  id: number;
  name: string;
  role: Role;
  userId: string | null;
  email: string;
  company: string;
  chatId: string;
  isDeleted: boolean;
  // ── メンバーマスタ拡張（任意。未取得時は既定値）──
  kana?: string;
  tel?: string;
  prefecture?: string;
  createdAt?: string;
  /** @deprecated Phase 3：旧・流入経路キー（自由テキスト）。表示・判定には sourceId を使うこと。 */
  source?: string;
  /** Phase 3：初回流入（sources.id）。招待・フォーム・?src= で付与。 */
  sourceId?: number | null;
  /** Phase 3：最新流入（sources.id） */
  lastSourceId?: number | null;
  /** Phase 3：初回流入日時 */
  sourceAt?: string;
  /** 付与された属性の末端ノードID配列（属性マスタ attributes.id） */
  attrIds?: number[];
  memos?: MemberMemo[];
  // ── 通知（Web Push）の状態 ──
  /** 通知を受け取れる登録端末の台数（0=未登録） */
  pushDevices?: number;
  /** 登録端末の内訳（一覧・詳細表示用） */
  pushDeviceInfo?: { userAgent: string; createdAt: string }[];
  /** 通知設定（未設定は既定ON） */
  notifyEnabled?: boolean;
  notifyChatEnabled?: boolean;
  notifyNewsEnabled?: boolean;
  // ── 利用状況 ──
  /** ログイン記録（未ログインは空） */
  firstLoginAt?: string;
  lastLoginAt?: string;
  loginCount?: number;
}

// ── 決済情報（payments）──────────────────────────────────────
//   外部決済サイトで確認した決済を運営が登録し、memberId で会員に紐付ける。
//   金額は「円＝整数」で保持（当面 JPY 固定。表示は toLocaleString）。
export interface Payment {
  id: number;
  /** 照合先の会員（members.id）。未照合は null。 */
  memberId: number | null;
  /** 入力時点の顧客名（照合前表示・手がかり） */
  customerName: string;
  /** 氏名カナ（決済時点の入力値。会員マスタへは反映しない） */
  customerKana: string;
  /** 自動照合の第一キー */
  customerEmail: string;
  /** 電話番号（決済時点の入力値。会員マスタへは反映しない） */
  customerTel: string;
  /** 決済完了日時（"YYYY-MM-DDTHH:mm"。未入力は ""） */
  paidAt: string;
  /** 商品種別マスタ(payment_product_types.id)。表示は番号→マスタ参照。 */
  typeId: number | null;
  /** 決済サイトマスタ(payment_sites.id) */
  siteId: number | null;
  /** 決済方法マスタ(payment_methods.id) */
  methodId: number | null;
  /** 決済金額（円＝整数） */
  amount: number;
  /** 決済手数料（円）。決済サイトの率・固定額から自動計算（手動上書き可） */
  feeAmount: number;
  /** 売上計上金額（円）＝ amount − feeAmount。手数料設定が無い場合は amount と同額。 */
  recognizedAmount: number;
  currency: string;   // "JPY"
  note: string;
  status: "matched" | "unmatched";
  /** payment-shots 上のパス（スクショ。未保存は null） */
  screenshotPath: string | null;
  createdAt: string;

  // ── 計上・入金の日付（売上経費PL管理）──
  /** 計上日（"YYYY-MM-DD"）。既定は決済日と同日。月次PL・利益分配の集計軸。 */
  accrualDate: string;
  /** 入金予定日（"YYYY-MM-DD"）。決済日＋決済サイトの入金サイクルから自動計算。 */
  expectedDate: string;
  /** true の間は feeAmount を自動計算しない（ユーザーが手で確定した） */
  isFeeManual: boolean;
  /** true の間は expectedDate を自動計算しない */
  isDateManual: boolean;

  // ── 外部連携・一括取込 ──
  /** 決済サイトの識別子（stripe / paypal / bank …）。重複判定・自動消込のキー */
  externalSource: string;
  /** 外部取引ID（ch_xxx 等）。空でなければ重複登録を DB 側の一意制約で防ぐ */
  externalTxnId: string;
}

/** 決済マスタ（商品種別 / 決済サイト / 決済方法）の共通型 */
export interface PaymentMaster {
  id: number;
  name: string;
  note: string;
  sortOrder: number;
  isDeleted: boolean;
  /** 商品種別のみ：売上計上フラグ */
  salesFlag?: boolean;
  /** 商品種別のみ：決済必要金額（円） */
  requiredAmount?: number;
  /** 経費科目のみ：原価か（false＝販管費） */
  isCost?: boolean;
  /**
   * 決済サイトのみ：入金サイクル・手数料の設定。
   * マイグレーション未適用の環境では undefined になる（画面は既定値で動作する）。
   */
  site?: import("./paymentSites").PaymentSiteConfig;
}

/** AI がスクショから読み取った決済情報の下書き（各項目は任意。マスタは名称で返す） */
export interface PaymentExtract {
  paidAt?: string;
  /** 商品種別・サイト・方法は「名称」で返す（アプリ側でマスタIDへ突合） */
  typeName?: string;
  siteName?: string;
  methodName?: string;
  amount?: number;
  /** 売上計上金額（決済金額から手数料を差し引いた対象金額。読めれば返す） */
  recognizedAmount?: number;
  currency?: string;
  customerName?: string;
  customerKana?: string;
  customerEmail?: string;
  customerTel?: string;
  /** 確信度が低く「要確認」にしたい項目名（例: ["customerName"]） */
  lowConfidence?: string[];
}

// ── 経費（expenses）─────────────────────────────────────────
//   売上（payments）のミラー構造。違いは「顧客照合」の代わりに「支払先」を持つ点だけ。
//   金額は円＝整数・正の値で保持し、マイナス表示は一覧側で付ける。
export interface Expense {
  id: number;
  /** 支払日時（"YYYY-MM-DDTHH:mm"。未入力は ""） */
  paidAt: string;
  /** 計上日（"YYYY-MM-DD"）。既定は支払日と同日。月次PLの集計軸。 */
  accrualDate: string;
  /** 出金予定日（"YYYY-MM-DD"）。支払日＋支払サイトの設定から自動計算。 */
  expectedDate: string;
  /** 経費科目マスタ（expense_categories.id） */
  categoryId: number | null;
  /** 支払サイト（payment_sites.id を売上と共用） */
  siteId: number | null;
  /** 支払方法（payment_methods.id を売上と共用） */
  methodId: number | null;
  /** 支払先名。売上側の「顧客」に相当する（会員照合はしない） */
  vendorName: string;
  /** インボイス登録番号（任意。T＋13桁） */
  vendorInvoiceNo: string;
  /** 支払金額（総額・円） */
  amount: number;
  /** 支払手数料（円）。支払サイトの率から自動計算 */
  feeAmount: number;
  /** 経費計上金額（円・正の値）＝ amount − feeAmount */
  recognizedAmount: number;
  currency: string;   // "JPY"
  note: string;
  /** true の間は feeAmount を自動計算しない */
  isFeeManual: boolean;
  /** true の間は expectedDate を自動計算しない */
  isDateManual: boolean;
  externalSource: string;
  externalTxnId: string;
  /** 領収書・請求書（payment-shots バケットを共用。未保存は null） */
  receiptPath: string | null;
  createdAt: string;
  /**
   * 返金・解約から自動生成された行なら refunds.id（REQ-036）。
   * null は手入力の経費。経費一覧には出さず、売上経費一覧で「返金」区分として出す。
   */
  refundId: number | null;
}

/** 経費科目マスタ（expense_categories） */
export interface ExpenseCategory {
  id: number;
  name: string;
  /** true=原価 / false=販管費 */
  isCost: boolean;
  note: string;
  sortOrder: number;
  isDeleted: boolean;
}

// ── 入出金（cash_entries）＋ 消込（cash_allocations）──────────
//   ⚠️ ここは「明細」ではない。着金・送金 1件＝1行（バッチ）である。
//      例：Stripe から 8/31 に 328,410円 が1本着金 → この層では1行。
//      その中身（売上明細12件）は payments 側にあり、消込でひも付ける。
//
//   差額（振込手数料など）は明細に按分せず、着金1件につき adjustments に
//   1行だけ持たせて吸収する。これが「明細レベルで手数料を管理できない」への答え。

/** 消込差額の区分 */
export type AdjustmentKind =
  | "transfer_fee"  // 振込手数料
  | "fee_diff"      // 決済手数料の誤差
  | "withholding"   // 源泉徴収
  | "fx"            // 為替差額
  | "unknown";      // 過不足・原因不明

/** 消込差額の1行 */
export interface CashAdjustment {
  kind: AdjustmentKind;
  /**
   * 円・**符号付き**。「実着金額が理論値より少なかった額」を表す。
   *   正（＋）… 手数料などで引かれた（よくある）
   *   負（−）… 多く着金した＝過入金
   * 符号を残すことで「充当額の合計 − 調整の合計 ＝ 実着金額」が常に成り立ち、
   * 保存された1件だけを見ても検算できる。
   */
  amount: number;
  memo: string;
}

/** 消込の相手。売上・経費・返金のいずれかの明細を指す */
export type AllocationSource = "payment" | "expense" | "refund";

/** 消込 1件（入出金 × 明細） */
export interface CashAllocation {
  id: number;
  cashEntryId: number;
  sourceType: AllocationSource;
  sourceId: number;
  /** 充当額（円・正の値） */
  amount: number;
}

/** 入出金 1件（着金・送金のバッチ） */
export interface CashEntry {
  id: number;
  /** in=入金 / out=出金 */
  direction: "in" | "out";
  /** 入出金日（"YYYY-MM-DD"） */
  entryDate: string;
  /** 経路（決済サイト。payment_sites.id を共用） */
  siteId: number | null;
  /** 口座名（「三菱UFJ 普通」など。自由入力） */
  accountName: string;
  /** 実着金額・実送金額（円・正の値）。通帳の数字そのもの */
  amount: number;
  /** 摘要（通帳の表記そのまま） */
  description: string;
  /** 差額の内訳。明細に按分しない金額の受け皿 */
  adjustments: CashAdjustment[];
  /** 決済サイトの入金ID（po_xxx 等）。自動消込のキー */
  externalPayoutId: string;
  createdAt: string;
  /** 画面用：この入出金にひも付く消込（DBでは別テーブル） */
  allocations: CashAllocation[];
}

// ── 利益分配（partners / profit_share_rules）─────────────────
//   売上明細1件ごとに「誰にいくら分配するか」を決める層。
//
//   ＜按分ベース＞（確認事項3a＋で確定）
//     計上金額（総額 − 決済手数料）から返金分を控除した額。
//     振込手数料は金額が小さいため按分せず、月次の共通経費として1本で計上する。
//     これにより**売上が確定した時点で分配額が出せる**（着金を待たない）。
//
//   ⚠️ 返金は「元決済に適用されたルールで按分し直してマイナス計上」する。
//      返金月に別のルールを当てると、払い過ぎ・戻し過ぎが必ず起きる。

/** 分配先。会員と紐付けてもよいし、社外パートナーとして単独で持ってもよい */
export interface Partner {
  id: number;
  name: string;
  email: string;
  /** 会員と同一人物なら members.id。無ければ null */
  memberId: number | null;
  /** 2ティア報酬の親パートナー（紹介元）。無ければ null */
  parentPartnerId: number | null;
  note: string;
  sortOrder: number;
  isDeleted: boolean;
}

/** ルールの適用範囲 */
export type ShareScope = "all" | "type";
/** 初回購入のみ／2回目以降のみ／両方（MyASP のレート分けに相当） */
export type ShareTier = "first" | "repeat" | "both";
/** 率で分けるか、固定額で分けるか */
export type ShareCalc = "rate" | "fixed";

export interface ShareRule {
  id: number;
  partnerId: number;
  scope: ShareScope;
  /** scope="type" のときの商品種別（payment_product_types.id） */
  typeId: number | null;
  tier: ShareTier;
  calc: ShareCalc;
  /** calc="rate" のときの率（％） */
  rate: number;
  /** calc="fixed" のときの固定額（円） */
  fixedAmount: number;
  /** 2ティア：親パートナーへ渡す率（％）。0＝渡さない */
  parentRate: number;
  /** 適用期間（"YYYY-MM-DD"。空＝制限なし）。計上日で判定する */
  validFrom: string;
  validTo: string;
  /** 同一パートナーで複数一致したときの優先度（大きいほど優先） */
  priority: number;
  /** 端数処理。既定は切り捨て（払い過ぎない側に寄せる） */
  rounding: "floor" | "round" | "ceil";
  note: string;
  isDeleted: boolean;
}

/** 分配エントリ1件。売上＝正、返金＝負 */
export type ShareEntryKind = "sale" | "refund";
/** 本人への分配か、親パートナーへの2ティア報酬か */
export type ShareTierKind = "direct" | "parent";

export interface ShareEntry {
  /** 一覧内で一意。React の key と重複排除に使う */
  uid: string;
  partnerId: number;
  ruleId: number;
  kind: ShareEntryKind;
  tierKind: ShareTierKind;
  sourceType: "payment" | "refund";
  sourceId: number;
  /** 計上日（"YYYY-MM-DD"）。この日付で月次に振り分ける */
  accrualDate: string;
  /** 按分ベース（円）。返金は負 */
  baseAmount: number;
  /** 分配額（円）。返金は負 */
  amount: number;
  note: string;
}

/** 月次の確定状態。確定するとその月の数字は動かなくなる */
export interface SharePeriod {
  id: number;
  /** "YYYY-MM" */
  period: string;
  status: "draft" | "fixed";
  fixedAt: string;
  fixedBy: string;
  totalBase: number;
  totalShare: number;
}

// ── 返金・解約（refunds）─────────────────────────────────────
//   決済（payments）への返金/解約を運営が登録し、進捗（ステータス）を管理する。
//   申請者（applicant*）は対象者会員と異なる場合がある。区分①/②・ステータスはマスタ参照。
export type RefundKind = "refund" | "cancel" | "both";

export interface Refund {
  id: number;
  /** 対象者会員（members.id）。未照合は null。 */
  memberId: number | null;
  /** 元決済（payments.id）。任意。 */
  paymentId: number | null;
  /** 対象者会員の氏名・メール（照合前表示／照合キー） */
  customerName: string;
  customerEmail: string;
  // 申請者（対象者会員と異なる場合あり）
  applicantName: string;
  applicantAddress: string;
  applicantEmail: string;
  applicantTel: string;
  // マスタ参照（refund_masters.id）
  cancelCat1Id: number | null;
  cancelCat2Id: number | null;
  statusId: number | null;
  kind: RefundKind;
  /** 返金金額（円）。売上レポートの経費計上対象。 */
  refundAmount: number;
  /** 経費区分（"refund" / "chargeback" 等） */
  expenseCategory: string;
  /** 申請・受付日時（"YYYY-MM-DDTHH:mm"。未入力は ""） */
  requestedAt: string;
  /** 返金完了日時（完了扱いで確定・計上月の基準。未確定は ""） */
  refundedAt: string;
  reason: string;
  /** 進捗メモ（対応履歴など） */
  progressMemo: string;
  note: string;
  screenshotPath: string | null;
  createdAt: string;

  // ── 経費・出金への計上（REQ-036）────────────────────────
  /** 経費科目（expense_categories.id）。生成する経費行の科目になる */
  expenseCategoryId: number | null;
  /** 出金経路（payment_sites.id を経費と共用） */
  payoutSiteId: number | null;
  /** 出金方法（payment_methods.id を経費と共用） */
  payoutMethodId: number | null;
  /** 出金予定日（"YYYY-MM-DD"）。"" なら refundedAt の日付を使う */
  payoutExpectedDate: string;
}

/** 返金・解約マスタ（解約区分①/②・進捗ステータスの選択肢） */
export type RefundMasterGroupKey = "cancel_cat1" | "cancel_cat2" | "refund_status";

export interface RefundMaster {
  id: number;
  groupKey: RefundMasterGroupKey;
  name: string;
  note: string;
  /** refund_status 用：完了扱い（経費計上・完了日時確定のトリガ） */
  isDone: boolean;
  sortOrder: number;
  isDeleted: boolean;
}

/** マスタのグループ表示名（「解約区分①」等。編集可） */
export interface RefundMasterGroup {
  key: RefundMasterGroupKey;
  label: string;
  sortOrder: number;
}

export interface TemplateTask {
  name: string;
  startOffset: number | "";
  endOffset: number | "";
  importance: Importance;
  progressMemo: string;
  specialNotes: string;
  materials: string;
}

export interface TemplateAnken {
  name: string;
  tasks: TemplateTask[];
}

export interface Template {
  id: number | null;
  name: string;
  anken: TemplateAnken[];
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
}

/** id をキーにした member 参照マップ（表示名解決に使用） */
export type MemberById = Record<number, Member>;

// ── 新機能: コンテンツ ───────────────────────────────────────
export type ContentGenre = "video" | "file" | "link";

export interface ContentItem {
  id: number;
  genre: ContentGenre;
  title: string;
  meta: string;
  date?: string;
  badge?: string;
  ext?: string;
  url?: string;
  licon?: string;
  /** 公開対象: "all"=全員 / string[]=メンバー名の配列 */
  target: "all" | string[];
  published: boolean;
}

// ── コンテンツ機能（ページ／コンテンツ マスタ）──
/** 公開条件（属性ABCの含み方）。メンバー抽出条件と同じ4種。 */
export type PublishMode = "any" | "all" | "exany" | "exall";
/** コンテンツ種別：動画(URL埋め込み) / 資料(URL埋め込み) / なし(テキスト・HTML) */
export type ContentKind = "video" | "doc" | "none";
export type NoneMode = "text" | "html";

/** 公開ページ /p のレイアウト。cards＝カード一覧（既定）／embed＝1カラムで動画・資料・本文をインライン埋め込み */
export type PageLayout = "cards" | "embed";
export const PAGE_LAYOUT_LABEL: Record<PageLayout, string> = { cards: "カード一覧", embed: "埋め込み表示（1カラム）" };

/**
 * コンテンツセクション（＝会員ポータルの入口）。
 *   1セクション＝サイドバー1項目＝会員ハブ1つ。ページはどれか1つのセクションに所属する。
 *   運営がセクションを増やせば「コンテンツ2・3…」と入口が汎用的に増える。
 */
export interface ContentSection {
  id: number;
  name: string;         // 日本語名（サイドバー下段・ハブ見出し）
  nameEn: string;       // 英語名（サイドバー上段ラベル）。"" ならフォールバック
  icon: string;         // サイドバー用アイコンキー（任意・将来用。"" 可）
  overview: string;     // ハブ上部の説明（任意）
  sortOrder: number;    // サイドバーの並び順
  published: boolean;   // 入口自体の公開ON/OFF
  attrMode: PublishMode;
  attrIds: number[];    // 公開対象属性（末端ノードID）
  isDefault: boolean;   // 既定セクション（削除不可・未所属ページの受け皿）
  /** ハブ本体の表示方式。既定は cards 相当の "auto"（＝従来どおりページカード一覧） */
  doorMode: DoorMode;
  /** 扉ページHTML。doorMode が html / hybrid のときにハブ本体として描画する */
  doorHtml: string;
}

/**
 * セクションのハブ本体の表示方式。
 *   auto   … 配下ページのカード一覧を自動生成（既定・従来の挙動）
 *   html   … 扉ページHTMLのみを描画
 *   hybrid … 扉ページHTML ＋ その下にカード一覧（扉への載せ忘れ対策）
 */
export type DoorMode = "auto" | "html" | "hybrid";

export interface ContentPage {
  id: number;
  name: string;
  abbr: string;
  overview: string;    // 概要（会員のタブ下に表示。任意）
  /** ハブ（会員のコンテンツ一覧）でカード表示する際のカバー画像URL。任意。未設定は既定カバー */
  coverUrl: string;
  /** 所属セクション（content_sections.id）。会員ポータルの入口を分ける単位。null=未所属（既定扱い） */
  sectionId: number | null;
  /** 公開ページ /p の表示方式。既定は cards（既存挙動）。embed で動画等をインライン埋め込み */
  layout: PageLayout;
  createdAt: string;
  sortOrder: number;
  attrMode: PublishMode;
  attrIds: number[];   // 公開対象属性（末端ノードID）
  /** 公開URLトークン。新規登録時にDBが自動発行し、以後変更不可（/p/{publicToken}）。未保存は "" */
  publicToken: string;
  /** 外部公開。ONなら公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。publishedがOFFなら無効 */
  isExternal: boolean;
  /** 公開トグル。OFFなら /p/{token} は404 */
  published: boolean;
  /**
   * 扉ページHTMLから参照するための不変キー（例: "C00"）。未設定は ""。
   * ⚠️ abbr（表示用の略称）と役割が違う。abbr は運営が表示都合で変えるため、
   *    参照キーに使うと扉ページのリンクが黙って切れる。
   */
  slug: string;
}

// ── イベント・予定（カレンダー掲載）──
/** 予定の種別（色の既定値と一覧の見出しに使う） */
export type EventKind = "event" | "meeting" | "deadline" | "other";
export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  event: "イベント／行事", meeting: "説明会・ミーティング", deadline: "締切", other: "休業・その他",
};
// ⚠️ 青（#2563eb）はフォーム締切チップ専用に予約している。
//    イベントに青を使うと、カレンダー上でフォーム締切と見分けがつかなくなるため使わない。
//    「説明会・ミーティング」はシアン（#0891b2）にして青との衝突を避ける。
export const EVENT_KIND_COLOR: Record<EventKind, string> = {
  event: "#0d9488", meeting: "#0891b2", deadline: "#7c3aed", other: "#ea580c",
};

/**
 * コミュニティのイベント／予定。
 *   ・公開対象は属性ABC＋公開条件（コンテンツ／お知らせと同じ canView で判定）
 *   ・出欠は持たない。申込・アンケートは formId に紐付けたフォームで受ける
 */
export interface CalEvent {
  id: number;
  title: string;
  kind: EventKind;
  color: string;
  allDay: boolean;
  startAt: string;        // datetime-local 文字列（"YYYY-MM-DDTHH:mm"）
  endAt: string;
  location: string;
  url: string;
  bodyText: string;
  published: boolean;
  newsId: number | null;  // お知らせ連携（お知らせから作られた予定）
  formId: number | null;  // 申込・回答フォーム
  showFormDeadline: boolean;
  attrMode: PublishMode;
  attrIds: number[];
  createdAt: string;
}

// ── お知らせ ──
export type NewsCategory = "notice" | "maint" | "event";
export interface NewsItem {
  id: number;
  category: NewsCategory;
  title: string;
  bodyMode: NoneMode;   // "text" | "html"
  bodyText: string;
  bodyHtml: string;
  important: boolean;
  published: boolean;
  publishedAt: string;  // datetime-local 文字列（"YYYY-MM-DDTHH:mm"）
  attrMode: PublishMode;
  attrIds: number[];
  sortOrder: number;
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
}

export interface CmsContent {
  id: number;
  pageId: number;
  name: string;
  createdAt: string;
  /** 公開URLトークン。新規登録時にDBが自動発行し、以後変更不可（/c/{publicToken}）。未保存は "" */
  publicToken: string;
  sortOrder: number;
  published: boolean;
  /** 外部公開。ON＝公開URLを知る全員が未ログインで閲覧可（公開対象属性は無視）。published が OFF なら無効。 */
  isExternal: boolean;
  kind: ContentKind;
  url: string;          // 動画/資料の埋め込みURL
  noneMode: NoneMode;
  bodyText: string;
  bodyHtml: string;
  thumbUrl: string;     // サムネイル画像URL（任意）
  attrMode: PublishMode;
  attrIds: number[];    // 公開対象属性（末端ノードID）

  /**
   * アップロードした資料（PDF等）。Storage(content-files) のパス。
   *   URL 埋め込み（url）との違い：
   *     url       … 外部（Googleドライブ等）に実体がある。共有設定に依存し、URLが漏れれば誰でも取れる。
   *     filePath  … 実体をプライベートバケットに持つ。閲覧可否をサーバーで判定してから
   *                 期限付きの署名URLを発行するため、会員限定が成立する。
   *   両方セットされている場合は filePath を優先して表示する。
   */
  filePath: string;
  fileName: string;     // ダウンロード時の保存名
  fileSize: number;     // バイト数（0＝不明）
}

/** fetchAllData の戻り値 */
export interface AppData {
  projects: Project[];
  anken: Anken[];
  tasks: Task[];
  members: Member[];
  templates: Template[];
  projectCategories: ProjectCategory[];
  phaseStatuses: PhaseStatus[];
}

/** MultiSelect 等の選択肢 */
export interface SelectOption {
  value: string;
  label: string;
}

// ── チャット ─────────────────────────────────────────────────
/** メッセージの向き: member=顧客発 / staff=社内スタッフ発 */
export type ChatSide = "member" | "staff";

export interface ChatAttachment {
  id: number;
  messageId: number;
  fileName: string;
  storagePath: string;
  /** 縮小版（長辺1600px）のパス。null＝縮小版なし＝原本をそのまま表示する */
  thumbPath: string | null;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

/**
 * メッセージの送信元。
 *   side（member/staff）だけでは「人が書いた返信」と「自動配信」を区別できないため追加した。
 *   ⚠️ 運営画面では出し分ける（人＝塗り／自動＝白地＋タグ）が、
 *      会員画面では一切ラベルを出さない（内部の仕組みを見せない）。
 */
export type ChatOrigin = "member" | "staff" | "broadcast" | "scenario" | "action";

export const CHAT_ORIGIN_LABEL: Record<ChatOrigin, string> = {
  member: "会員",
  staff: "運営",
  broadcast: "一斉配信",
  scenario: "シナリオ配信",
  action: "自動アクション",
};

/** 本文中のURL（訪問計測つき） */
export interface ChatLink {
  id: number;
  messageId: number;
  url: string;
  /** 未訪問なら "" */
  clickedAt: string;
  lastClickAt: string;
  clickCount: number;
}

export interface ChatMessage {
  id: number;
  conversationId: number;
  senderMemberId: number | null;
  side: ChatSide;
  body: string;
  createdAt: string;
  attachments: ChatAttachment[];
  origin: ChatOrigin;
  /** 引用返信の元メッセージID（null＝通常メッセージ） */
  replyToId: number | null;
  /** 本文から抽出したURL。運営画面で訪問状況を出す */
  links: ChatLink[];
}

/** スタッフ一覧の1行（会話＋顧客＋未読数） */
export interface ChatThread {
  conversationId: number;
  member: Member;
  assignedTo: number | null;
  lastMessageAt: string;
  lastSnip: string;
  staffLastReadAt: string | null;
  unread: number;
}

// ── 流入経路（Phase 3：マスタとして独立）────────────────────
export type SourceCategory = "ad" | "seminar" | "referral" | "sns" | "organic" | "offline" | "other";

export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  ad:       "広告",
  seminar:  "セミナー",
  referral: "紹介",
  sns:      "SNS",
  organic:  "自然流入",
  offline:  "オフライン",
  other:    "その他",
};

export const SOURCE_CATEGORIES: SourceCategory[] =
  ["ad", "seminar", "referral", "sns", "organic", "offline", "other"];

/** 流入経路マスタ（sources テーブル） */
export interface Source {
  id: number;
  /** URL の ?src= に載せる識別子。配布済み QR/URL が死ぬため原則不変。 */
  key: string;
  label: string;
  category: SourceCategory;
  /** 誘導先（例: /f/entry）。未指定なら /login */
  landingPath: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  color: string;
  memo: string;
  /** 停止しても既存会員の紐付けは残る（新規付与だけ止まる） */
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  /**
   * この経路が会員に紐づいた時に実行するアクション（属性付与・シナリオ・チャット送信）。
   *   発火点：① 公開URL /s/{key} をログイン中の会員が踏んだ
   *           ② ?src= 付きでフォームに回答した（新規登録・既存会員とも）
   */
  actions: FormAction[];
  /** true=1人1経路につき1回だけ発火／false=踏むたびに発火 */
  fireOnce: boolean;
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
}

export const DEFAULT_SOURCE_COLOR = "#6b6b73";

/** 経路ごとのウェルカム文面（welcome_messages テーブル） */
export interface WelcomeMessage {
  sourceId: number;
  message: string;
}

/**
 * @deprecated Phase 3：旧・app_settings.welcome_routes(JSON) の要素。
 *   経路の定義は sources、文面は welcome_messages に分離した。
 *   ロールバック用に型だけ残置している。
 */
export interface WelcomeRoute {
  key: string;
  label: string;
  message: string;
}

/** 全般設定（機能ON/OFFフラグ・アプリ全体） */
export interface AppSettings {
  chatworkEnabled: boolean;
  bulkRegisterEnabled: boolean;
  contentEnabled: boolean;
  // ── 初回ログイン時のウェルカムメッセージ ──
  welcomeEnabled: boolean;
  welcomeDefault: string;        // 既定文面（経路未指定・未一致時）
  /** @deprecated Phase 3：経路別文面は welcome_messages テーブルへ移行済み。 */
  welcomeRoutes: WelcomeRoute[];
}
export const DEFAULT_APP_SETTINGS: AppSettings = {
  chatworkEnabled: true,
  bulkRegisterEnabled: true,
  contentEnabled: true,
  welcomeEnabled: false,
  welcomeDefault: "",
  welcomeRoutes: [],
};

// ── 一斉配信（ブロードキャスト）─────────────────────────────
export type BroadcastStatus = "draft" | "scheduled" | "sent";
export interface Broadcast {
  id: number;
  title: string;
  status: BroadcastStatus;
  targetMode: "all" | "filter" | "email" | "list";   // 全員 / 条件で絞り込み / メールアドレス指定 / リストから選ぶ
  targetAttrIds: number[];        // 属性ABC（抽出は attrMode で制御）
  /** ② 属性ABCの抽出モード（lib/members.ts の AttrMode と同一）。既定 any＝いずれか含む */
  attrMode: "any" | "all" | "exany" | "exall";
  /** ③ target_mode='email' のときの配信先メールアドレス一覧（貼り付け） */
  targetEmails: string[];
  /**
   * target_mode='list' のときの配信先リスト（contact_lists.id）。
   * ⚠️ Phase 3a では下書き保存と件数表示までで、実送信は解禁していない。
   */
  targetListIds: number[];
  /** 複数リストで重複するアドレスを1通にまとめるか（既定 true） */
  listDedupe: boolean;
  /** @deprecated Phase 3：旧・単一経路キー。targetSourceIds を使うこと。 */
  targetSource: string;
  /** Phase 3：流入経路（sources.id。空=指定なし。複数指定はOR） */
  targetSourceIds: number[];
  /** Phase 3：カテゴリ一括指定（例: ["ad"] で広告経由の全員。空=指定なし） */
  targetSourceCats: SourceCategory[];
  channelChat: boolean;           // ポータルトークへ配信
  channelEmail: boolean;          // メールへ配信
  channelLine: boolean;           // LINE公式アカウントへ配信（Phase 4）
  /** ③ メール件名（title=管理用タイトルとは別。空なら title をフォールバック） */
  mailSubject: string;
  /** ④ 送信元メールアカウント（mail_accounts.id）。null=環境変数SMTP */
  mailAccountId: number | null;
  /** 送信履歴を送信ボックス(Sent)へ残すか。既定 false。送信元アカウント選択時のみ有効。 */
  keepSentCopy: boolean;
  lineAccountId: number | null;   // 送信元LINEアカウント（line_accounts.id）
  lineAudience: "linked" | "attr" | "all"; // linked=属性で絞った連携済み会員 / attr=属性で絞る(未連携の友だちも含む) / all=アカウントの友だち全員
  lineSentCount: number;          // LINE配信の実績通数
  scheduledAt: string;            // 予約日時（""=今すぐ）
  targetExcludeAttrIds?: number[]; // P2-A：除外する属性（保有者は対象から外す）
  messageBody: string;            // 本文（変数・URL可）
  messageJson?: RichMessage | null; // LINEリッチメッセージ（任意・Phase 7①）。未設定ならテキスト送信。
  recipientCount: number;         // 配信数（送信時に確定）
  sentAt: string;                 // 送信完了日時
  createdAt: string;
  /** AI(⑤)で原稿を生成したか（監査用・任意） */
  aiAssisted?: boolean;
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
}

// ── シナリオ配信（ステップ配信）─────────────────────────────
export type ScenarioTrigger = "source" | "login" | "attribute" | "manual";
export type StepDelayUnit = "immediate" | "hours" | "days";
export interface ScenarioStep {
  id: number;
  sortOrder: number;
  delayUnit: StepDelayUnit;
  delayValue: number;       // hours/days のときの値
  timeOfDay: string;        // "HH:MM"（days時のみ・""=指定なし）
  channelChat: boolean;
  channelEmail: boolean;
  channelLine: boolean;     // LINEへ配信（Phase 4）
  messageBody: string;
  messageJson?: RichMessage | null; // LINEリッチメッセージ（任意・Phase 7①）
  /** STEP2：メール件名（ステップ単位）。空=フォールバック（シナリオ名＋ステップ番号）。 */
  mailSubject: string;
  /** STEP5：条件分岐。none=分岐なし / click=本文URLクリック有無 / attr=属性の有無。 */
  branchType: "none" | "click" | "attr";
  /** STEP5：attr条件で判定する属性ID（いずれか保有で成立）。 */
  branchAttrIds: number[];
  /** STEP5：条件成立時の分岐先ステップ番号（0始まり）。-1=シナリオ終了 / null=次のステップへ。 */
  branchYes: number | null;
  /** STEP5：条件不成立時の分岐先ステップ番号。 */
  branchNo: number | null;
  /** STEP5：クリック判定までの待ち時間（時間）。 */
  branchWaitHours: number;
}
export interface Scenario {
  id: number;
  name: string;
  active: boolean;
  triggerType: ScenarioTrigger;
  /** @deprecated Phase 3：旧・単一経路キー。targetSourceIds を使うこと。 */
  targetSource: string;
  /** Phase 3：流入経路（sources.id。空=指定なし） */
  targetSourceIds: number[];
  /** Phase 3：カテゴリ一括指定（空=指定なし） */
  targetSourceCats: SourceCategory[];
  targetAttrIds: number[];  // 属性ABC（抽出は attrMode で制御）
  /** STEP2：属性ABCの抽出モード（一斉配信と同一）。既定 any＝いずれか含む。 */
  attrMode: "any" | "all" | "exany" | "exall";
  /** STEP4：宛先タイプ。member=会員から条件抽出／email=外部メールリスト。 */
  /**
   * 配信対象の種別。
   * ⚠️ "list"（リストから選ぶ）は受け皿のみで、UI からはまだ選べない（Phase 3c）。
   *    解釈は lib/scenario.ts の toAudienceType() に集約している。
   */
  audienceType: "member" | "email" | "list";
  /**
   * audience_type='list' のときの配信先リスト（contact_lists.id）。
   * ⚠️ リストに後から追加された人も、Cron のエンロールで順次投入される（確定事項 A1=a）。
   */
  targetListIds: number[];
  lineAccountId: number | null;  // 送信元LINEアカウント（Phase 4。LINEステップで使用）
  /** STEP2：送信元メールアカウント（mail_accounts.id）。null=環境変数SMTP。 */
  mailAccountId: number | null;
  steps: ScenarioStep[];
  createdAt: string;
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
}
export const SCENARIO_TRIGGER_LABEL: Record<ScenarioTrigger, string> = {
  source:    "流入経路の付与時",
  login:     "初回ログイン時",
  attribute: "属性の付与時",
  manual:    "手動で追加",
};

/** 差し込み変数（本文で顧客情報を出力） */
export interface BroadcastVariable { token: string; label: string; }
export const BROADCAST_VARIABLES: BroadcastVariable[] = [
  { token: "{{氏名}}",     label: "氏名" },
  { token: "{{セイ}}",     label: "セイ" },
  { token: "{{所属}}",     label: "所属" },
  { token: "{{流入経路}}", label: "流入経路" },
  { token: "{{都道府県}}", label: "都道府県" },
  { token: "{{メール}}",   label: "メール" },
];

// ── フォーム（Lステップ「回答フォーム」相当）───────────────────
/** 設問ブロックの種類 */
export type FieldType =
  | "text" | "textarea" | "radio" | "checkbox" | "select"
  | "date" | "file" | "pref" | "number" | "heading";
export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text:     "記述式（テキストボックス）",
  textarea: "段落（テキストエリア）",
  radio:    "ラジオボタン",
  checkbox: "チェックボックス",
  select:   "プルダウン",
  date:     "日付",
  file:     "ファイル添付",
  pref:     "都道府県",
  number:   "数値",
  heading:  "見出し／説明文",
};
/** 選択肢を持つ種類 */
export const HAS_OPTIONS: FieldType[] = ["radio", "checkbox", "select"];
/** 回答値を持たない（表示専用）種類 */
export const IS_DISPLAY_ONLY = (t: FieldType) => t === "heading";

/** 入力規則 */
export type FieldRule = "email" | "tel" | "zip" | "numeric" | "kana";
export const FIELD_RULE_LABEL: Record<FieldRule, string> = {
  email:   "メールアドレス",
  tel:     "電話番号",
  zip:     "郵便番号",
  numeric: "半角数字",
  kana:    "ひらがな",
};

/** 回答の登録先（会員マスタのカラム） */
export type SaveTarget = "name" | "kana" | "email" | "tel" | "prefecture" | "company";
export const SAVE_TARGET_LABEL: Record<SaveTarget, string> = {
  name: "氏名", kana: "セイ", email: "メールアドレス", tel: "電話番号",
  prefecture: "都道府県", company: "所属",
};

/** アクション（選択時 / 回答後で共通） */
export type FormActionType =
  | "attr_add" | "attr_remove" | "scenario_start" | "scenario_stop" | "chat_message"
  /** 回答者を「外部」ロールの会員として登録し、招待メール（パスワード設定）を送る */
  | "member_signup";
/** メッセージ送信アクションの配信チャネル（未指定＝レガシー＝アプリ内トークのみ） */
export interface MsgChannels { chat?: boolean; email?: boolean; line?: boolean }
export interface FormAction {
  type: FormActionType;
  attrId?: number;        // attr_add / attr_remove
  scenarioId?: number;    // scenario_start / scenario_stop
  body?: string;          // chat_message
  channels?: MsgChannels; // chat_message の配信チャネル（アプリ内トーク/メール/LINE）
}
export const FORM_ACTION_LABEL: Record<FormActionType, string> = {
  attr_add:       "属性を付与",
  attr_remove:    "属性を解除",
  scenario_start: "シナリオを開始",
  scenario_stop:  "シナリオを停止",
  chat_message:   "チャットにメッセージ送信",
  member_signup:  "会員登録（外部ロール）",
};

/** 表示条件（分岐）：指定設問の回答が値と一致/不一致のときだけ表示 */
export interface FieldCondition {
  fieldId: number;
  op: "eq" | "neq";
  value: string;
}

/**
 * 表示条件のグループ（分岐）。セクション・設問の condition に入れる。
 *   conditions が空なら常に表示。複数あるときは match で AND/OR を切り替える。
 *   ⚠️ 旧データは condition が単体 FieldCondition だった。読込時に formParse の
 *      toCondGroup が1件のグループへ畳んで吸収する（旧形式は書き戻さない）。
 *   ⚠️ CondMatch はこのファイルの下部（自動返信ブロック）で定義済みのものを共用する。
 */
export interface CondGroup {
  match: CondMatch;
  conditions: FieldCondition[];
}
/** 空の条件グループ（＝常に表示）。newField/newSection の初期値。 */
export const EMPTY_COND_GROUP: CondGroup = { match: "all", conditions: [] };

export interface FormOption {
  label: string;
  actions: FormAction[];
  /** この選択肢が選ばれたら「自由入力欄」を表示する（ラジオ／チェック／カード共通）。既定 undefined=false=従来どおり。 */
  allowFreeText?: boolean;
  /** この選択肢を回答画面に出さない（編集画面には残す）。既定 undefined=false=表示。 */
  hidden?: boolean;
}

export interface FormField {
  id: number;
  type: FieldType;
  label: string;
  description: string;
  /** 説明文を HTML として表示するか（true=サニタイズHTML／false=テキスト・改行保持） */
  descHtml: boolean;
  placeholder: string;
  defaultValue: string;
  required: boolean;
  rule: FieldRule | "";
  minLen: number | "";
  maxLen: number | "";
  maxSelect: number | "";
  saveTo: SaveTarget | "";
  options: FormOption[];
  /** ラジオ／チェックの選択肢を「価格カード」で見せる（名称と ｜ 以降を分けて大きく表示）。既定 false=リスト。 */
  optionCards: boolean;
  /** 一覧上で「非表示」にした設問。回答画面には出さず、検証・アクションも走らない。編集画面には残る。既定 false */
  hidden: boolean;
  condition: CondGroup;
  sortOrder: number;
}

export interface FormSection {
  id: number;
  name: string;
  condition: CondGroup;
  sortOrder: number;
  fields: FormField[];
}

export type FormStatus = "draft" | "published" | "closed";
export const FORM_STATUS_LABEL: Record<FormStatus, string> = {
  draft: "下書き", published: "公開中", closed: "受付終了",
};
export type FormVisibility = "member" | "both";
export const FORM_VISIBILITY_LABEL: Record<FormVisibility, string> = {
  member: "会員のみ", both: "会員＋外部",
};

/**
 * 未ログイン回答者（会員＋外部フォーム）に出す「ご連絡先」欄の設定。
 *   見出し・説明・各ラベル・必須の有無をフォームごとに変えられる。
 *   ⚠️ design(jsonb) の中に入れて保存する（専用列は作らない）。
 */
export interface GuestContact {
  title: string;         // 見出し（例：ご連絡先）
  note: string;          // 説明文
  nameLabel: string;     // お名前の欄のラベル（「氏名」等に変更可）
  nameRequired: boolean;
  emailLabel: string;    // メールアドレスの欄のラベル
  emailRequired: boolean;
  /**
   * 氏名・メールの取得元。
   *   "auto"   … 登録先＝氏名／メールの設問があればそれを使い、この欄には出さない（重複入力の解消）
   *   "always" … 設問の有無に関わらず、確認用として必ずこの欄を出す（旧来の挙動）
   * ⚠️ サーバー側（formsServer の pickEmail/pickName）は元々「設問 → ゲスト欄」の順で
   *    拾っており、"auto" はその挙動を回答画面のUIにも一致させるもの。
   */
  mode: "auto" | "always";
}
export const DEFAULT_GUEST_CONTACT: GuestContact = {
  title: "ご連絡先",
  note: "ご回答の確認・ご連絡に使用します。",
  nameLabel: "お名前・ニックネーム",
  nameRequired: true,
  emailLabel: "メールアドレス",
  emailRequired: true,
  mode: "auto",
};

/**
 * 回答後に表示する画面の種類。
 *   text … 改行を保持したプレーンテキスト（thanksText）
 *   html … サニタイズ済みHTML（design.thanksHtml）
 *   url  … 指定URLへ遷移（thanksUrl）
 * ⚠️ 旧データには無い。読込時に thanks_url の有無から補完する（formParse の toDesign）。
 */
export type ThanksMode = "text" | "html" | "url";

/**
 * 自動返信メールの本文ブロック。
 *   conditions が空なら常に出力し、条件つきなら満たしたときだけ出力する。
 *   条件の型は設問の分岐（FieldCondition）と同じものを使い回している。
 *
 * ⚠️ 旧データは条件を単体（condition: FieldCondition | null）で持っている。
 *    読込時に formParse の toDesign が conditions[] へ畳んで吸収するので、
 *    アプリ内部はこの配列だけを見ればよい（旧形式は書き戻さない）。
 */
export interface AutoReplyBlock {
  conditions: FieldCondition[];
  /** all＝すべて満たしたとき（AND）／any＝どれか1つ満たしたとき（OR） */
  condMatch: CondMatch;
  body: string;
}
export type CondMatch = "all" | "any";
export const COND_MATCH_LABEL: Record<CondMatch, string> = {
  all: "すべて満たすとき",
  any: "どれか1つを満たすとき",
};

/** 回答者本人への自動返信メール設定 */
export interface AutoReply {
  enabled: boolean;
  fromName: string;      // 差出人名（空なら SMTP_FROM_NAME）
  bccStaff: boolean;     // 運営にも同じ内容を送る
  subject: string;       // {{氏名}} 等の差し込み可
  blocks: AutoReplyBlock[];
}
export const DEFAULT_AUTO_REPLY: AutoReply = {
  enabled: false,
  fromName: "",
  bccStaff: false,
  subject: "【KAWAI CAMP】ご回答ありがとうございました",
  blocks: [],
};

/**
 * 会員未登録のメールアドレス（マスタ ＞ 未登録メール）。
 *   フォーム回答・決済情報に出てくるのに members に居ないアドレスを
 *   1メール＝1行にまとめたもの。集計は /api/ops/unregistered-emails で行う。
 */
export interface UnregisteredEmail {
  email: string;
  /** 直近に確認できた氏名（空のこともある） */
  name: string;
  /** 由来（フォーム名／「決済」）。重複は除く */
  origins: string[];
  formCount: number;
  paymentCount: number;
  /** 合計決済額（円）。決済が無ければ 0 */
  amount: number;
  /** 最初に現れた日時 */
  firstAt: string;
  /** 最後に現れた日時。一覧の「登録日時」はこちらを出す */
  lastAt: string;
  /** 運営メモ（unregistered_notes） */
  note: string;
  noteBy: string;
  noteAt: string;
  /** 明細（新しい順）。詳細で「いつ・どこから来たか」を追うのに使う */
  events: UnregisteredEvent[];
}

/** 未登録メールの1件の記録（フォーム回答 or 決済） */
export interface UnregisteredEvent {
  at: string;
  kind: "form" | "payment";
  /** フォーム名 or 商品名・決済サイト */
  label: string;
  /** 決済額（円）。フォームは 0 */
  amount: number;
}

/** 自動返信メールで使える差し込みトークン（設問は {{Q:設問名}}） */
export const AUTO_REPLY_VARIABLES: { token: string; label: string }[] = [
  { token: "{{氏名}}",         label: "氏名" },
  { token: "{{メール}}",       label: "メールアドレス" },
  { token: "{{フォーム名}}",   label: "フォーム名" },
  { token: "{{回答日時}}",     label: "回答日時" },
  { token: "{{回答内容ぜんぶ}}", label: "全回答（設問名：回答の一覧）" },
];

export interface FormDesign {
  color: string;         // メインカラー
  bgColor: string;       // 背景色
  headerImage: string;   // ヘッダー画像URL
  submitLabel: string;   // 送信ボタン文言
  progress: boolean;     // プログレスバー
  /** 公開フォーム最上部の黒いブランド帯（KAWAI CAMP ヘッダー）を隠す。既定=表示（false） */
  hideHeader: boolean;
  customCss: string;
  /** 未ログイン回答者向けのご連絡先欄。旧データには無いので読み込み時に既定で補完する。 */
  guestContact: GuestContact;
  /**
   * 回答後に表示する画面の種類。旧データには無いので thanks_url の有無から補完する。
   * ⚠️ 専用列は作らず design(jsonb) に入れる（guestContact と同じ方針）。
   */
  thanksMode: ThanksMode;
  /** thanksMode === "html" のときの本文（保存時にサニタイズ済み） */
  thanksHtml: string;
  /** 回答者本人への自動返信メール */
  autoReply: AutoReply;
}
export const DEFAULT_FORM_DESIGN: FormDesign = {
  color: "#dc2626", bgColor: "#f7f7f8", headerImage: "",
  submitLabel: "送信する", progress: true, hideHeader: false, customCss: "",
  guestContact: { ...DEFAULT_GUEST_CONTACT },
  thanksMode: "text", thanksHtml: "",
  autoReply: { ...DEFAULT_AUTO_REPLY, blocks: [] },
};

/**
 * フォーム回答 → メンバーメモの連携設定。
 *   enabled  … ON で、会員が特定できる回答があるたびメモを1件自動生成
 *   titleId  … メモタイトルマスタ。null = フォーム名をそのまま採用
 *   fieldIds … 本文へ転記する設問(form_fields.id)。空配列 = 全回答を転記
 */
export interface FormMemoLink {
  enabled: boolean;
  titleId: number | null;
  fieldIds: number[];
}

export const DEFAULT_FORM_MEMO_LINK: FormMemoLink = { enabled: false, titleId: null, fieldIds: [] };

export interface FormDef {
  id: number;
  name: string;
  /** @deprecated 旧・テキスト分類。folderId（folders テーブル）へ移行済み */
  folder: string;
  /** 所属フォルダ（null=未分類）。lib/folders.ts のフォルダ機能で使用 */
  folderId: number | null;
  slug: string;
  title: string;
  description: string;
  status: FormStatus;
  visibility: FormVisibility;
  deadlineAt: string;        // "" = 期限なし（"YYYY-MM-DDTHH:mm"）
  deadlineMessage: string;
  answerLimit: number;       // 0 = 無制限
  confirmDialog: boolean;
  confirmText: string;
  thanksUrl: string;
  thanksText: string;
  design: FormDesign;
  afterActions: FormAction[];
  autofillMember: boolean;
  notifyEnabled: boolean;
  /** 回答をメンバーのメモへ自動連携する設定 */
  memoLink: FormMemoLink;
  /** 回答期限をカレンダーに表示する */
  showOnCalendar: boolean;
  /** カレンダー表示名（空ならフォーム名） */
  calendarLabel: string;
  sections: FormSection[];
  createdAt: string;
  updatedAt: string;
}

/** 回答（1送信＝1レコード） */
export type SubmissionStatus = "new" | "doing" | "done";
export const SUBMISSION_STATUS_LABEL: Record<SubmissionStatus, string> = {
  new: "未対応", doing: "対応中", done: "完了",
};
export interface FormAnswer {
  fieldId: number | null;
  label: string;
  value: string;
  valueList: string[];
  filePath: string;
}
/** 送信チャネル（どの導線から回答されたか）。※ 流入経路（Source）とは別物。 */
export type FormChannel = "direct" | "chat" | "broadcast" | "scenario" | "qr";

export interface FormSubmission {
  id: number;
  formId: number;
  memberId: number | null;
  guestName: string;
  guestEmail: string;
  status: SubmissionStatus;
  assigneeId: number | null;
  /**
   * Phase 3：送信チャネル（旧 `source`）。
   *   ⚠️ 用語衝突の解消：members の「流入経路」とは意味が違う。
   *      こちらは「どの導線でフォームに来たか」。
   */
  channel: FormChannel | string;
  /** Phase 3：流入経路（sources.id）。?src= から解決。 */
  sourceId: number | null;
  submittedAt: string;
  answers: FormAnswer[];
}

// ============================================================
// LINE公式アカウント連携 Phase 1
//   DBは snake_case、アプリ内は camelCase（lib/line.ts の toXxx で境界変換）
// ============================================================
export type LineFriendStatus = "friend" | "blocked" | "unfollowed";
export type LineMsgType =
  "text" | "image" | "video" | "audio" | "file" | "sticker" | "location" | "flex" | "other";
export type LineDirection = "in" | "out";
export type LineMediaStatus = "none" | "pending" | "stored" | "failed";
export type LineSendKind = "reply" | "push" | "multicast" | "narrowcast";

export type LineAccountEnv = "prod" | "test";
export type LineAccountStatus = "connected" | "needs_action" | "paused";

/** LINE公式アカウント（line_accounts。非秘密メタのみ。シークレットはサーバー隔離） */
export interface LineAccount {
  id: number;
  name: string;
  channelId: string;
  basicId: string;
  botUserId: string;
  pictureUrl: string;
  notes: string;
  liffId: string;
  loginChannelId: string;
  env: LineAccountEnv;
  status: LineAccountStatus;
  statusDetail: string;
  webhookVerifiedAt: string;
  lastTestAt: string;
  lastReceivedAt: string;
  sortOrder: number;
  /** 集計で付与（友だち数） */
  friendCount?: number;
}

/** LINE友だち（line_friends。1人＝1行） */
export interface LineFriend {
  id: number;
  accountId: number | null;
  lineUserId: string;
  memberId: number | null;
  displayName: string;
  pictureUrl: string;
  status: LineFriendStatus;
  followedAt: string;
  unfollowedAt: string;
  lastMessageAt: string;
  lastMessageSnip: string;
  staffLastReadAt: string;
  assignedTo: number | null;
  sourceId: number | null;
  tagIds: number[];
  createdAt: string;
  // ── Phase 2 名寄せ：登録フォームで集めた本人情報 ──
  collectedName: string;
  collectedKana: string;
  collectedEmail: string;
  collectedPhone: string;
  identitySource: string;
  identityAt: string;
  /** 集計で付与（未読の顧客発メッセージ数）。取得元によっては未設定 */
  unreadCount?: number;
}

// ── リッチメニュー（Phase 5b）────────────────────────────────
export type RichMenuSize = "full" | "compact";
export type RichMenuStatus = "draft" | "published";
/** セルのアクション種別：liff=会員連携フォーム / liff_mypage=マイページ / uri=任意URL / message=テキスト送信 */
export type RichMenuActionType = "liff" | "liff_mypage" | "uri" | "message";

// ── リッチメッセージ（Phase 7①）────────────────────────────────
/** リッチメッセージの種別 */
export type RichMsgType = "text" | "image" | "buttons" | "carousel";
/** カード/ボタンのアクション（リッチメニューと同じ種別を流用） */
export interface RichMsgButton { label: string; actionType: RichMenuActionType; actionValue: string }
/** 1枚のカード（ボタン単体・カルーセルの各カード） */
export interface RichMsgCard { imageUrl: string; title: string; text: string; buttons: RichMsgButton[] }
/** 送信するリッチメッセージ（配信・シナリオ・手動トーク共通） */
export interface RichMessage {
  type: RichMsgType;
  altText?: string;                               // 通知/一覧用（template必須。未指定はタイトル等から補完）
  text?: string;                                  // type=text
  imageUrl?: string;                              // type=image（公開HTTPS）
  card?: RichMsgCard;                             // type=buttons
  cards?: RichMsgCard[];                          // type=carousel
  quickReplies?: { label: string; text: string }[]; // text/buttons/carousel に付与
}

// ── テンプレート（定型文・Phase P2-B）────────────────────────
export interface LineTemplate {
  id: number;
  name: string;
  message: RichMessage;   // テキスト/画像/カード/カルーセル
  sortOrder: number;
}

// ── キーワード自動応答（Phase 7③）────────────────────────────
export type AutoReplyMatch = "partial" | "exact" | "regex";
export interface AutoReplyRule {
  id: number;
  accountId: number;
  name: string;
  keywords: string[];               // いずれか一致で成立
  matchType: AutoReplyMatch;
  isFallback: boolean;              // true=不一致時のフォールバック（その他すべて）
  reply: RichMessage | null;       // 返信メッセージ（null=返信なし・アクションのみ）
  actions: FormAction[];           // 発火するアクション（属性付与・シナリオ開始・メッセージ送信）
  priority: number;                // 大きいほど先に評価
  enabled: boolean;
}

export interface RichMenuCell {
  label: string;
  actionType: RichMenuActionType;
  actionValue: string;   // uri/message の値。liff は空（アカウントのLIFFを使う）
}
export interface LineRichMenu {
  id: number;
  accountId: number;
  name: string;
  chatBarText: string;
  size: RichMenuSize;
  layout: string;        // 例 "2x1"（cols x rows）
  imagePath: string;     // line-outbound 上のパス（""=未設定）
  cells: RichMenuCell[];
  richMenuId: string;    // LINE採番（""=未公開）
  isDefault: boolean;
  status: RichMenuStatus;
  /** 表示条件（Phase 7②）：all=全員(既定ベース) / unlinked=未連携 / linked=連携済み会員 / attr=タグ指定 */
  audience: RichMenuAudience;
  audienceAttrIds: number[];   // audience=attr の対象属性ID（いずれか保有で一致）
  priority: number;            // 大きいほど優先
  abGroup: string;             // A/Bテスト群（同群＋同条件を友だちごとに安定分割）。""=A/Bなし
}
export type RichMenuAudience = "all" | "unlinked" | "linked" | "attr";

/** 名寄せの候補会員（手動確定・確認用） */
export interface LineMatchCandidate {
  memberId: number;
  name: string;
  email: string;
  tel: string;
  /** 一致したキー（email / phone / name） */
  matchedBy: ("email" | "phone" | "name")[];
  /** その会員が既に別のLINEに連携済みか（重複の疑い） */
  alreadyLinked: boolean;
}

/** 名寄せキューの分類（案B 要対応キュー） */
export type LineLinkCategory =
  | "ready"     // ②③が一意一致・その会員は未連携 → 1クリックで連携可
  | "conflict"  // 複数一致 or キー間の矛盾 → 手動確定
  | "duplicate" // 一致会員が既に別LINEに連携済み → 重複の疑い
  | "name"      // ④氏名のみ候補 → 手動確定
  | "pending";  // 収集情報が無い/会員に該当なし → 連携フォーム送信

/** 名寄せキューの1件（未連携の友だち＋照合結果） */
export interface LineLinkQueueItem {
  friendId: number;
  displayName: string;
  accountId: number | null;
  collectedName: string;
  collectedEmail: string;
  collectedPhone: string;
  category: LineLinkCategory;
  /** ready のとき、連携先の一意な会員ID */
  autoMemberId: number | null;
  candidates: LineMatchCandidate[];
}

/** 名寄せ結果 */
export interface LineMatchResult {
  /** 自動連携できたか（②③が一意一致） */
  linked: boolean;
  linkedMemberId: number | null;
  linkedBy: "email" | "phone" | null;
  /** キー間の矛盾（例：メールはA・電話はB） */
  conflict: boolean;
  /** 手動確定用の候補（④氏名や複数一致・重複を含む） */
  candidates: LineMatchCandidate[];
}

/** LINE送受信メッセージ（line_messages） */
export interface LineMessage {
  id: number;
  accountId: number | null;
  friendId: number;
  lineMessageId: string | null;
  direction: LineDirection;
  msgType: LineMsgType;
  body: string;
  mediaStatus: LineMediaStatus;
  mediaPath: string | null;
  mediaMime: string | null;
  sentBy: number | null;
  sendKind: LineSendKind | null;
  createdAt: string;
}

// ============================================================
// リスト管理（配信先リスト）
//   contact_lists / contact_list_entries / contact_list_imports /
//   contact_list_deliveries に対応するドメイン型。
//   ⚠️ 生の入力値（email / phone）と正規化値（emailNorm / phoneE164）は
//      必ず別フィールドで持つ。表示は生、重複判定は正規化値を使う。
// ============================================================

/** リスト枠（画面の左ペイン1行） */
export interface ContactList {
  id: number;
  name: string;
  description: string;
  note1: string;
  note2: string;
  folderId: number | null;
  /** 件数キャッシュ（recount_contact_list() で実体から再集計できる） */
  entryCount: number;
  /** メールアドレスを持つ＝メール配信できる件数 */
  emailableCount: number;
  /** メールが無く電話のみ＝メール配信できない件数 */
  phoneOnlyCount: number;
  /** 手動並べ替えの位置（10刻み）。昇順で表示し、同値は updatedAt desc */
  sortOrder: number;
  allowDelivery: boolean;
  /** 取得元・同意メモ（特定電子メール法の記録／リスト単位） */
  consentNote: string;
  isArchived: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

/** レコードの状態（一覧の「状態」列。配信できるかどうかが一目で分かるようにする） */
export type EntryState = "ok" | "phone_only" | "suppressed" | "bounced" | "role_address" | "withdrawn";

/** リストのレコード（連絡先1件） */
export interface ListEntry {
  id: number;
  listId: number;
  /** 会員と紐づいた場合の members.id。非会員は null */
  memberId: number | null;
  /** 紐づけの根拠。空文字＝未紐づけ */
  matchedBy: "member_id" | "email" | "";
  email: string;
  emailNorm: string;
  phone: string;
  phoneE164: string;
  name: string;
  ageGroup: string;
  prefecture: string;
  note1: string;
  note2: string;
  sourceKind: "manual" | "csv" | "md" | "api";
  importId: number | null;
  consentAt: string;
  consentSrc: string;
  createdAt: string;
  updatedAt: string;
}

/** 手入力・取込の1行分の入力値（正規化前の生の値） */
export interface EntryInput {
  email: string;
  phone: string;
  name: string;
  ageGroup: string;
  prefecture: string;
  note1: string;
  note2: string;
  /**
   * 同意を得た日時（Phase 5）。空文字＝未記録。
   * ⚠️ 入力は "2026-07-20" / "2026/7/20 14:30" のような表記を受けるため、
   *    保存前に必ず normalizeConsentAt() を通す（不正な値は未記録として捨てる）。
   */
  consentAt: string;
  /** 同意の取得元（"展示会ブース掲示 v2" など）。空文字＝未記録 */
  consentSrc: string;
}

/** 行ごとの判定 */
export type DupVerdict = "insert" | "update" | "skip" | "error";

/** 重複チェックの結果（プレビュー表示とそのまま登録に使う） */
export interface DupCheckRow {
  /** 1始まりの行番号（画面表示用） */
  no: number;
  input: EntryInput;
  emailNorm: string | null;
  phoneE164: string | null;
  verdict: DupVerdict;
  /** 画面と失敗CSVの「理由」列に出す日本語メッセージ。空文字＝理由なし */
  reason: string;
  /** スキップ理由が既存レコードだった場合の相手の id */
  existingId: number | null;
}

/** 一括取込ジョブ（Phase 2） */
export interface ListImportJob {
  id: number;
  listId: number;
  fileName: string;
  fileKind: "csv" | "paste" | "md";
  encoding: string;
  delimiter: string;
  dupPolicy: "skip" | "update" | "abort";
  blankOverwrite: boolean;
  skipSuppressed: boolean;
  totalRows: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  status: "queued" | "running" | "done" | "failed" | "canceled";
  errorMessage: string;
  startedAt: string;
  finishedAt: string;
  createdAt: string;
}

/** リストを宛先に使った配信の履歴（送信時点のスナップショット・Phase 3） */
export interface ListDelivery {
  id: number;
  listId: number;
  kind: "broadcast" | "scenario";
  broadcastId: number | null;
  scenarioId: number | null;
  listNameSnapshot: string;
  titleSnapshot: string;
  channel: string;
  targetCount: number;
  sentCount: number;
  excludedCount: number;
  /** 除外の内訳（suppressed / phone_only / invalid / dup） */
  excludedBreakdown: Record<string, number>;
  sentAt: string;
}

/** リストへの操作履歴（Phase 5：エクスポート・マージなど個人情報に触る操作の記録） */
export type ListAuditAction = "export" | "merge" | "merge_source";

export interface ListAudit {
  id: number;
  listId: number | null;
  action: ListAuditAction;
  /** 実施者（auth.users の uuid）。取得できなければ空文字 */
  actor: string;
  /** 実施時点の表示名・メール（会員マスタを消しても誰がやったか残るようにする） */
  actorLabel: string;
  /** 対象件数（エクスポートした行数／マージで移した件数） */
  rowCount: number;
  /** 操作の補足（リスト名スナップショット・相手リストなど） */
  detail: Record<string, unknown>;
  createdAt: string;
}
