// ============================================================
// 公開問い合わせボット 共有型（クライアント / サーバー 双方で使う）
// ============================================================

/** 入口。未ログイン / 会員 / 体験版URL */
export type BotEntry = "anon" | "member" | "trial";

/** 回答の出典（内部情報は含めない）。excerpt/score は根拠パネル表示用（任意）。 */
export type BotSource =
  | { type: "bookmark"; id: number; genre: string; excerpt?: string; score?: number }
  | { type: "doc"; docType: string; title: string; url: string | null; excerpt?: string; score?: number }
  | { type: "web"; url: string; title: string; excerpt?: string; score?: number };

/** POST /api/bot リクエスト */
export interface BotAskReq {
  message: string;
  /** クライアント保持の会話ID（任意・ログ紐付け用） */
  conversationId?: string | null;
  /** 体験版のときだけ付与 */
  shareToken?: string | null;
  /** 🌐外部情報トグル（ポリシーが許可する時だけ有効） */
  useWeb?: boolean;
}

/** POST /api/bot レスポンス */
export interface BotAskRes {
  answer: string;
  sources: BotSource[];
  /** 残り利用回数（trial は残り累計） */
  remaining: number;
  /** スコープ外で辞退したら true（answer は定型辞退文） */
  refused: boolean;
}
