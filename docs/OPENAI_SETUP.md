# OpenAI OCR サーバー経由化 セットアップ

OCR機能（証憑読取・自動分類）はブラウザから直接OpenAI APIを呼ばず、
Vercel Serverless Functions (`api/openai/responses.js`, `api/openai/files.js`) 経由で呼び出す。
APIキーはブラウザに一切渡らず、サーバー側の環境変数でのみ保持する。

## 1. Vercel 環境変数

Vercelプロジェクトの Settings > Environment Variables に以下を設定する。

| 変数名 | 内容 |
|---|---|
| `OPENAI_API_KEY` | OpenAIのAPIキー（sk-...）。Production/Preview両方に設定推奨 |

設定後は再デプロイ（または既存デプロイの再ビルド）が必要。

## 2. 未設定時の挙動

`OPENAI_API_KEY` が未設定の場合、`/api/openai/responses` と `/api/openai/files` は
`500 {"error":"server_not_configured"}` を返す。ブラウザ側はこれを検知して
「OCR機能が利用できません（管理者に連絡してください）」と表示する。

## 3. 動作確認手順

1. 環境変数設定後にデプロイする。
2. 証憑OCR画面（`mf-evidence.html` や OCRタブ）で画像/PDFを登録し、AI解析を実行する。
3. ブラウザの開発者ツール > ネットワークタブで `/api/openai/responses`（または `/api/openai/files`）への
   リクエストにAPIキーが含まれていないこと、レスポンスが正常に返ることを確認する。
4. OCR結果が自動入力されることを確認する。
