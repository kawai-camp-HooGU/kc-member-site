# Ver.20260709.001 リリースノート

- 作成日: 2026-07-09
- 元: `develop/` のスナップショット（デプロイ用リリース点）

## このバージョンの内容

**app.jsx（6,249行の単一ファイル）を full-strict TypeScript 化＋モジュール分割**した最初の版。

- 全72モジュール（`.ts` 28 / `.tsx` 45）に分割。`.jsx` は0。
- `tsc --noEmit`（`strict: true`）: プロジェクト全体で **0エラー**。
- `next build`: **成功**（全12ページ・5APIルートのプロダクションビルド通過）。
- 設定ファイル（next/postcss/tailwind.config）はNext標準に従い `.js` のまま。

## 構成

```
app.tsx            App本体（状態・データ取得・Realtime・ルーティング）
hooks/             usePermission / useMaster
lib/               型（database.types, models）・データ層（supabase等）・
                   通知・定数・純関数（dateUtils, filters, seed, bulkUtils 他）
components/        common / task / gantt / template / master / content / layout（約35部品）
views/             Dashboard / Kanban / Gantt / Calendar / BulkRegister / Master
app/api/           5ルート（全TS化）
```

## 移行中に検出・修正した潜在バグ

1. タスク `status` の値ズレ（実体 `completed` ／ `schema.sql` は旧 `done`）→ 型を実体に統一。
   ※ `schema.sql` のCHECK制約は別途 `completed` へ要修正。
2. RPC `get_user_id_by_email` の引数名を実コードの `email_input` に統一。

## ビルド/起動手順

```
npm install
npm run dev      # 開発
npm run build && npm run start   # 本番
```
事前に `.env.local`（`.env.example` 参照）と Supabase 構築が必要。
