-- ============================================================
-- チャット添付：縮小版（サムネイル）のパスを持たせる
--
--   BEFORE
--     ・添付は原本1枚だけ。吹き出しにインライン表示すると、
--       4MBのスクリーンショットがそのまま流れてスマホ回線で重い
--
--   AFTER
--     ・chat_attachments.thumb_path … 長辺1600pxのJPEGのパス（同じバケット）
--     ・一覧の表示は thumb_path、拡大時だけ storage_path（原本）を読む
--
--   ⚠️ 既存行は thumb_path = null。アプリ側は null なら原本にフォールバックするため、
--      再アップロードは不要（後方互換）。
--   ⚠️ 何度実行しても安全（add column if not exists）。
--
--   適用: Supabase コンソール → SQL Editor に貼り付けて実行
--   ロールバック: migration_add_chat_thumb_rollback.sql
-- ============================================================

alter table public.chat_attachments
  add column if not exists thumb_path text;

comment on column public.chat_attachments.thumb_path is
  '縮小版（長辺1600pxのJPEG）の Storage パス。null＝縮小版なし（storage_path の原本を表示する）';
