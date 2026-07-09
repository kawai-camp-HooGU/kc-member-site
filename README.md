# ProManage（プロマネージ）

プロジェクト・タスク管理アプリ。ダッシュボード／カンバン／ガント／カレンダー、重要度・期限の色分け、担当者マスタ、ChatWork通知（任意）などを備えています。

- 技術: Next.js（App Router）+ React + Tailwind CSS + Supabase（DB / 認証）
- 配信: Vercel 推奨 + Supabase

---

## セットアップ手順（新規環境）

### 1. Supabase を用意する
1. Supabase で新規プロジェクトを作成します。
2. 「SQL Editor」を開き、`supabase/init.sql` の中身を貼り付けて一括実行します（テーブル・関数・RLS・Realtime・インデックスが作成されます）。
3. 「Settings → API」から次の値を控えます: `Project URL` / `anon public` キー / `service_role` キー。

### 2. 環境変数を設定する
`.env.example` をコピーして `.env.local` を作り、各値を埋めます。

- `NEXT_PUBLIC_SUPABASE_URL` … Supabase の Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` … anon public キー
- `SUPABASE_SERVICE_ROLE_KEY` … service_role キー（サーバー専用・非公開）
- `NEXT_PUBLIC_SITE_URL` … ローカルは `http://localhost:3000` / 本番は公開URL
- `CHATWORK_API_TOKEN` / `CRON_SECRET` … ChatWork通知を使う場合のみ

> `.env.local` は秘密情報です。Git にコミットしないでください（`.gitignore` で除外済み）。

### 3. ローカルで起動する
```
npm install
npm run dev
```
`http://localhost:3000` を開き、ログイン画面からアカウントを作成します。最初のユーザーは担当者マスタで「管理者」として登録・メール紐づけしてください。

### 4. Vercel にデプロイする
1. このフォルダを GitHub の非公開リポジトリに上げます。
2. Vercel で当該リポジトリをインポートします。
3. 「Environment Variables」に手順2と同じキーを登録します（本番の `NEXT_PUBLIC_SITE_URL` は公開URL）。
4. デプロイします。

### 5. ChatWork スケジュール通知（任意）
`vercel.json` の Cron で `/api/cron/notify` を定時実行する構成を予定。`CHATWORK_API_TOKEN` と `CRON_SECRET` を設定し、プロジェクトの「通知先グループチャット」に ChatWork ルームID、担当者の「チャットID」に ChatWork アカウントIDを入れて利用します。

---

## フォルダ構成

```
app/                 Next.js App Router（画面・APIルート）
  api/invite/        メンバー招待API（service_role 使用）
  login/             ログイン画面
  set-password/      招待リンクからのパスワード設定
  page.jsx           トップ（app.jsx を読み込む）
  layout.jsx         レイアウト・メタデータ
app.jsx              アプリ本体（全ビューを内包）
lib/supabase.js      Supabase クライアントと変換ヘルパー
public/              ロゴ等の静的ファイル
supabase/init.sql    新規DB初期化スクリプト
.env.example         環境変数テンプレート
```
