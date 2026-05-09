Ver54.0 自動同期・複数端末対応版

追加:
- 自動同期
- 複数端末同期
- 本番→端末
- 端末→本番
- 同期履歴
- 自動同期タイマー
- 端末名管理

注意:
sync_logs テーブルが必要です

Supabase SQL:
create table if not exists sync_logs (
  id bigint generated always as identity primary key,
  user_email text,
  device_name text,
  synced_at timestamptz default now(),
  sales_count int,
  purchases_count int,
  payload jsonb
);

使い方:
1. ZIP解凍
2. GitHubへ上書き
3. Commit changes
4. 公開URL更新
5. Supabase SQL実行
6. 自動同期を開く
7. 自動同期開始
