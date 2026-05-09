Ver45.0 本番DB重複防止・更新保存版

追加:
- 重複防止メニュー
- 重複防止SQL表示/出力
- 本番sales重複チェック
- item_id重複禁止用SQL
- slip_number確認用index
- upsert保存
- 再保存時は追加ではなく更新
- 重複レポートCSV出力

重要:
1. 先に重複防止SQLをSupabase SQL Editorで実行してください。
2. 既に重複がある場合、unique index作成でエラーになることがあります。
3. その場合は先に本番重複チェックで重複を確認してください。

次にやること:
1. ZIPを解凍
2. GitHubへ中身を全部上書きアップロード
3. Commit changes
4. 公開URLを再読み込み
5. 重複防止を開く
6. 重複防止SQL出力
7. Supabase SQL Editorで実行
8. 本番重複チェック
9. 更新保存データ準備
10. まとめて更新保存
