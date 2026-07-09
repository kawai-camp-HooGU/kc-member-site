// ヘルプ画面（操作マニュアル資料のダウンロード）
export function HelpView() {
  const PPTX = "/help/ProgressBoard_Tutorial.pptx";
  const PDF  = "/help/ProgressBoard_Tutorial.pdf";
  const CW_PPTX = "/help/Chatwork_ID_Guide.pptx";
  const CW_PDF  = "/help/Chatwork_ID_Guide.pdf";
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-red-600 text-xl leading-none">?</span>
        <h1 className="text-lg font-bold text-gray-800">ヘルプ</h1>
      </div>
      <p className="text-xs text-gray-500 mb-6">操作マニュアルのダウンロードや、使い方の確認ができます。</p>

      <div className="text-xs font-semibold text-red-900 mb-2">操作マニュアル・資料</div>
      <div className="bg-white border border-gray-200 rounded-xl p-5 flex gap-4 items-start max-w-2xl">
        <div className="rounded-xl bg-blue-50 flex items-center justify-center shrink-0" style={{ width: 52, height: 52 }}>
          <span className="text-red-600 text-2xl leading-none">▤</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800">KAWAI CAMP 操作チュートリアル</div>
          <p className="text-xs text-gray-500 leading-relaxed mt-1.5 mb-3">メンバー・プロジェクト・分類・タスクの登録から、ガント／カンバン／カレンダーでの更新、テンプレートマスタの活用まで、操作手順を画面つきでまとめた資料です。</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 mb-4">
            <span>全15スライド</span><span>更新日 2026-07-02</span>
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href={PDF} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-red-700 border border-red-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-50 transition-colors">
              <span className="leading-none">🔍</span>PDFプレビュー
            </a>
            <a href={PPTX} download="ProgressBoard_操作チュートリアル.pptx"
              className="inline-flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors">
              <span className="leading-none">⬇</span>PowerPoint（.pptx）
            </a>
            <a href={PDF} download="ProgressBoard_操作チュートリアル.pdf"
              className="inline-flex items-center gap-2 bg-white text-red-700 border border-red-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors">
              <span className="leading-none">⬇</span>PDF
            </a>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5 flex gap-4 items-start max-w-2xl mt-3">
        <div className="rounded-xl bg-blue-50 flex items-center justify-center shrink-0" style={{ width: 52, height: 52 }}>
          <span className="text-red-600 text-2xl leading-none">▤</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-gray-800">Chatwork ID 確認マニュアル</div>
          <p className="text-xs text-gray-500 leading-relaxed mt-1.5 mb-3">メンバーID（アカウントID）とグループチャットID（ルームID）の調べ方を、画面つきでまとめた資料です。プロジェクトの通知先ルームや、メンバーのメンション先を設定する際にご利用ください。</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-400 mb-4">
            <span>全7スライド</span><span>更新日 2026-07-03</span>
          </div>
          <div className="flex gap-3 flex-wrap">
            <a href={CW_PDF} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-red-700 border border-red-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-50 transition-colors">
              <span className="leading-none">🔍</span>PDFプレビュー
            </a>
            <a href={CW_PPTX} download="Chatwork_ID確認マニュアル.pptx"
              className="inline-flex items-center gap-2 bg-red-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-700 transition-colors">
              <span className="leading-none">⬇</span>PowerPoint（.pptx）
            </a>
            <a href={CW_PDF} download="Chatwork_ID確認マニュアル.pdf"
              className="inline-flex items-center gap-2 bg-white text-red-700 border border-red-300 rounded-lg px-4 py-2 text-sm font-medium hover:bg-red-50 transition-colors">
              <span className="leading-none">⬇</span>PDF
            </a>
          </div>
        </div>
      </div>

      <p className="text-xs text-gray-400 mt-4 max-w-2xl">ご不明な点は管理者までお問い合わせください。</p>
    </div>
  );
}
