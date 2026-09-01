// ============================================================
// 体験シナリオ 共有型（クライアント / サーバー 双方で使う）
//
//   ⚠️ テンプレプロンプトはこの型に含めない。
//      TrialScenarioPublic は公開APIの戻り値になるため、
//      プロンプト本文が /try/ の画面から読めてはいけない。
// ============================================================

/** 成果物の種類。段階1で実装するのは text / html。 */
export type TrialOutputKind = "text" | "html" | "image" | "pdf";

/** 体験の進行。DB の bot_trial_runs.status と同じ。 */
export type TrialStatus =
  | "intro" | "input" | "running" | "ready" | "submitted" | "reviewed" | "failed";

/** 出口フォームをいつ挟むか（段階3で使う） */
export type TrialFormTiming = "none" | "entry" | "exit";

// ── ステップの入力項目 ────────────────────────────────────────
/**
 * 利用者に聞く項目。自由記述は最小限にする（やさしさ）。
 * select は options を持ち、既定値は先頭（空のプルダウンを出さない）。
 */
export interface TrialInputDef {
  key: string;
  label: string;
  type: "select" | "text";
  options?: string[];
  maxLength?: number;
  placeholder?: string;
}

/** 公開してよいステップ情報（prompt を含めない） */
export interface TrialStepPublic {
  key: string;
  label: string;
  inputs: TrialInputDef[];
}

/** 公開してよいシナリオ情報 */
export interface TrialScenarioPublic {
  id: number;
  slug: string;
  title: string;
  intro: string;
  ctaLabel: string;
  outputKind: TrialOutputKind;
  steps: TrialStepPublic[];
  /** 出口フォームをいつ挟むか。none なら提出そのものを出さない */
  formTiming: TrialFormTiming;
  /** 出口フォームが実際に設定されているか（未設定なら提出ボタンを出さない） */
  hasForm: boolean;
}

// ── 進行と成果物 ──────────────────────────────────────────────
export interface TrialRun {
  id: number;
  status: TrialStatus;
  stepKey: string;
  genCount: number;
  reviseCount: number;
  error: string | null;
}

export interface TrialArtifact {
  id: number;
  revision: number;
  kind: TrialOutputKind;
  /** html / text は本文。image / pdf は空で、url に署名URLが入る（段階2） */
  body: string;
  url: string | null;
  instruction: string;
}

/** 何回目の調整で何を指示したか（見える化） */
export interface TrialRevisionRef {
  revision: number;
  instruction: string;
}

// ── API 契約 ──────────────────────────────────────────────────
/** POST /api/trial/start */
export interface TrialStartReq {
  shareToken: string;
  passcode?: string | null;
}
export interface TrialStartRes {
  run: TrialRun;
  scenario: TrialScenarioPublic;
  remainingGen: number;
  remainingRevise: number;
}

/** POST /api/trial/generate（202 を返し、生成は続けて実行する） */
export interface TrialGenerateReq {
  runId: number;
  shareToken: string;
  passcode?: string | null;
  /** 初回：ステップの入力値。調整時は null */
  inputs?: Record<string, string> | null;
  /** 調整指示。初回は null */
  instruction?: string | null;
}
export interface TrialGenerateRes {
  runId: number;
  status: TrialStatus;
  remainingGen: number;
}

/** POST /api/trial/submit */
export interface TrialSubmitReq {
  runId: number;
  shareToken: string;
  passcode?: string | null;
  name: string;
  email: string;
  /** 任意のひとこと。フォームに自由記述があれば入る */
  message?: string | null;
}
export interface TrialSubmitRes {
  ok: true;
  /** その場でログインさせるワンタイムトークン。/auth/trial?token_hash= へ渡す */
  tokenHash: string | null;
  /** 受け取り損ねたときの再発行キー（既存 /api/form/trial-token） */
  submissionId: number | null;
  message: string;
}

/** GET /api/trial/status */
export interface TrialStatusRes {
  run: TrialRun;
  artifact: TrialArtifact | null;
  history: TrialRevisionRef[];
  remainingGen: number;
  remainingRevise: number;
}

// ── 上限の既定値（コード側の最後の砦。settings / シナリオが優先）──
export const TRIAL_DEFAULTS = {
  perUserChatLimit: 30,
  perUserGenLimit: 10,
  /** IP+UA 側の上限を1人あたりの何倍にするか（同一Wi-Fiの数人を通すため） */
  ipMultiplier: 3,
  reviseLimit: 3,
  assumedUsers: 30,
} as const;
