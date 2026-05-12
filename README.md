# RIBRE 売上管理システム

株式会社RIBRE向けの売上管理SPAです。  
本番エントリは **`index.html`**（Ver60.0）で、ビルド不要の静的構成（HTML/CSS/JavaScript）です。

## 現在の構成（要点）

- **実行形態**: ビルド不要の静的配信
- **エントリ**: `index.html`
- **データ**: `localStorage` + Supabase（画面設定）
- **主要ページ分割**: `pages/` へ移行済み（dashboard/settings/ocr/storage/sync/report 等）

## ディレクトリの役割

- `pages/`
  - 画面機能ごとのロジック
  - 例: `dashboard.js`, `settings.js`, `ocr.js`, `storage-backup.js`, `storage-sync.js`, `storage-audit.js`, `storage-guide.js`
- `services/`
  - 共通処理・外部連携
  - 例: `core.js`, `supabase-rest.js`, `supabase-auth.js`, `openai-ocr.js`, `app-main-v2.js`, `storage.js`
- `docs/`
  - 運用・設計・確認手順
  - 例: `SMOKE_TEST.md`, `ARCHITECTURE_SPLIT_PLAN_Ver60.md`

## ローカル起動

### 1) バッチ起動（Windows）

- `start_local.bat` を実行
- `http://localhost:8765/index.html` を開く

### 2) 手動起動

```bash
python -m http.server 8765
```

ブラウザで `http://localhost:8765/index.html` を開いてください。  
`file://` 直開きは非推奨です。

## デプロイと Vercel 公開URL確認

### デプロイ前提

- `vercel.json` は `/` を `index.html` へルーティング

### 公開URL確認手順

1. Vercel ダッシュボードで対象プロジェクトの最新デプロイを開く  
2. `Visit` から本番URLを開く  
3. 画面ヘッダ表示と主要ナビが出ることを確認  
4. ブラウザDevToolsの `Network` で script 404 がないことを確認  
5. 反映差分が見えない場合はハードリロード（`Ctrl+F5` / `Cmd+Shift+R`）

## Smoke Test 実施手順

詳細チェック表: [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md)

1. 本番URLを開き、Console を表示  
2. `docs/SMOKE_TEST.md` の上から順に確認  
3. `Status` を更新（OK/NG）  
4. NG があれば該当画面・エラー内容を記録  

## よくあるトラブル

### 401 Unauthorized

- 原因: セッション期限切れ、token未設定、RLS条件不一致
- 対処:
  - 一度ログアウト→再ログイン
  - Supabase設定（URL/Key）再確認
  - `sync_logs` / `audit_logs` は401時に「再ログインしてください」表示を確認

### localStorage quota

- 原因: 証憑データ/候補/ログの蓄積で容量上限到達
- 対処:
  - 古い候補・履歴・ログを削除
  - 画像本体を localStorage に保持しない運用を維持
  - 縮退メッセージ表示後も本体処理が継続するか確認

### 404 script

- 原因: scriptパス変更漏れ、削除済みファイル参照、キャッシュ
- 対処:
  - `index.html` の script パスを確認
  - `Network` で 404 script 名を特定
  - 必要なら再デプロイ + ハードリロード

### キャッシュが古い

- 症状: 修正済み不具合が再現、古い行番号が出る
- 対処:
  - ハードリロード
  - キャッシュ削除
  - query付きscriptの更新反映確認

## 開発時の基本コマンド

```bash
git add .
git commit -m "your message"
git push
```

## 関連ドキュメント

| 文書 | 内容 |
|------|------|
| [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md) | Vercel反映後の本番確認チェック表 |
| [docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md](docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md) | 分割方針・フェーズ |
| [docs/REFACTOR_PLAN_Ver56_0.md](docs/REFACTOR_PLAN_Ver56_0.md) | 初期リファクタ計画（参考） |
| [docs/HANDOFF_Ver56_0.txt](docs/HANDOFF_Ver56_0.txt) | 引き継ぎメモ |
