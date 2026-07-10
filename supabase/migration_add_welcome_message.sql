-- ============================================================
-- 初回ログイン時のウェルカムメッセージ機能
--   - members に「流入経路(source)」「初回送信済み(welcomed_at)」を追加
--   - app_settings にウェルカム設定（ON/OFF・既定文面・経路別文面）を追加
-- ============================================================

-- メンバー：流入経路（招待時に付与）と初回メッセージ送信済みフラグ
alter table public.members add column if not exists source      text;
alter table public.members add column if not exists welcomed_at timestamptz;

-- 全般設定：ウェルカムメッセージ設定
--   welcome_routes は [{ "key": "...", "label": "...", "message": "..." }, ...] の配列
alter table public.app_settings add column if not exists welcome_enabled boolean not null default false;
alter table public.app_settings add column if not exists welcome_default text;
alter table public.app_settings add column if not exists welcome_routes  jsonb  not null default '[]'::jsonb;

-- 既定行(id=1)が無い場合に備えて初期化
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
