# RIBRE 売上管理システム

株式会社RIBRE向けの売上・仕入・証憑・クラウド連携などを1画面で扱う **シングルページアプリ** です。現在の本番エントリはルートの **`index.html`**（Ver60.0）です。

## 現状の構成（重要）

- **実行形態**: ビルド不要の素の HTML / CSS / JavaScript（モジュールバンドルなし）。
- **エントリ**: `index.html` のみがデプロイの起点（`vercel.json` / `netlify.toml` とも整合）。
- **データ**: ブラウザの `localStorage` と Supabase（設定は画面から保存）を併用。
- **リファクタ**: ファイル分割は [docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md](docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md) に従い **段階的** に行います。分割完了までは **`index.html` を正とする** 運用でお願いします。

## バージョン・変更履歴

リリースノートは従来どおり **`README_Ver60_0.txt`** など `README_Ver*.txt` を参照してください。

## ローカルでの動かし方

静的ファイルとして配信すれば動作します。

**Python（リポジトリ同梱のバッチ）**

- Windows: `start_local.bat` を実行（`http://localhost:8765/index.html` が開きます）

**手動**

```bash
python -m http.server 8765
```

ブラウザで `http://localhost:8765/index.html` を開いてください。

※ `file://` 直開きは CORS や挙動の差があるため非推奨です。

## デプロイ

- **Vercel**: `vercel.json`（`/` → `index.html`）
- **Netlify**: `netlify.toml`（SPA 的に `index.html` へフォールバック）

環境変数に依存しない構成のため、静的ホスティングにそのまま載せられます（Supabase / OpenAI キーは画面またはローカル設定で扱う想定）。

## ドキュメント

| 文書 | 内容 |
|------|------|
| [docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md](docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md) | `services` / `pages` / `styles` / `components` への分割方針・フェーズ（**動作維持最優先**） |
| [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md) | Vercel反映後の本番確認用チェック表（smoke test） |
| [docs/REFACTOR_PLAN_Ver56_0.md](docs/REFACTOR_PLAN_Ver56_0.md) | 当初のターゲットディレクトリと安全な順序（参考） |
| [docs/HANDOFF_Ver56_0.txt](docs/HANDOFF_Ver56_0.txt) | 引き継ぎメモ |

## 今後のディレクトリ（予約）

分割作業で中身を増やすフォルダです。

- `styles/` — **Phase1 済**: `base.css`（ベース UI）、`mobile.css`（760px / 420px ブレークポイント・固定アクション）
- `services/` — **`core.js`**、**`supabase-rest.js`**、**`supabase-auth.js`**、**`openai-ocr.js`**、**`app-main.js`**（ダッシュ・設定・売上/仕入 UI・`load`）、**`storage.js`**（会計export直後に読込）など
- `pages/` — 画面単位の HTML 断片またはテンプレート
- `components/` — ヘッダ・ナビ・パネル等の再利用 UI 断片

詳細は [docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md](docs/ARCHITECTURE_SPLIT_PLAN_Ver60.md) を参照してください。

## アーカイブ HTML

`sales_management_Ver*_*.html` は過去バージョンのスナップショットです。通常の運用・デプロイでは **`index.html`** を使用してください。
