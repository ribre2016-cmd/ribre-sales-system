# SMOKE TEST Checklist (Vercel Deploy)

Last updated: 2026-05-12

## Purpose

Vercel反映後に、主要機能が壊れていないことを短時間で確認するための固定チェック表です。

## 実施手順（短縮版）

1. 本番URLを開き、ハードリロードする
2. ConsoleとNetworkを開いたまま、下表を上から実施する
3. 各行の `Status` / `Checked At` / `Checked By` を記録する
4. NGの場合は `NG Memo` に症状と再現手順を残す

## Preconditions

- デプロイ済みURLで最新反映を開く（ハードリロード推奨）
- 可能なら管理者アカウントでログイン
- ブラウザConsoleを開いた状態で実施

## Checklist

| Area | Priority | Check Steps | Expected Result | Status | Checked At | Checked By | NG Memo |
|---|---|---|---|---|---|---|---|
| Dashboard | P1 | `ダッシュボード` で `再集計` / `月別集計` を押す | 件数・集計表示が更新される | TODO |  |  |  |
| 設定・ログイン | P0 | `設定・ログイン` で Supabase接続確認、ログイン/ログアウト実行 | 接続OK、ログイン状態表示が切り替わる | TODO |  |  |  |
| OCR/AI自動登録 | P1 | `AI自動登録` でファイル読込→AI解析→候補登録を実行 | 候補生成・登録が完了し、画面状態が更新される | TODO |  |  |  |
| Storage/証憑 | P0 | `Storage保存` でファイル保存→一覧表示 | 保存成功、一覧にURL/ファイル情報が出る | TODO |  |  |  |
| Backup | P0 | `バックアップ` と `本番バックアップ` で作成/履歴表示/ダウンロード | バックアップ作成・履歴更新・ファイル保存ができる | TODO |  |  |  |
| Sync | P0 | `自動同期` / `同期` で ON/OFF と手動同期を実行 | ON/OFF維持、履歴更新、停止時にtimerが止まる | TODO |  |  |  |
| Audit logs | P0 | `操作ログ` でログ読込/絞込/CSV出力を実行 | ログ表示され、401時は再ログイン案内で本体停止しない | TODO |  |  |  |
| Search | P1 | `検索・絞込` でキーワード検索/クリア/CSV出力 | 結果件数が正しく変化し、CSV出力できる | TODO |  |  |  |
| Templates | P2 | `テンプレート` で保存/一覧/適用/削除 | テンプレCRUDが動作し、件数表示が更新される | TODO |  |  |  |
| Shipping | P0 | `配送照合` / `ヤフオクCSV` で読込・照合・未一致確認 | 照合件数・未一致件数が更新される | TODO |  |  |  |
| Analytics | P1 | `集計・出力` / `経営分析` で分析更新・CSV出力 | 集計値とグラフ表示が更新される | TODO |  |  |  |
| Accounting | P1 | `月締め` / `会計出力` を実行 | 月次集計と仕訳CSV出力ができる | TODO |  |  |  |
| Report | P1 | `日次レポート` で日次/週次/運用チェック/CSVを実行 | レポート値が更新され、CSV出力できる | TODO |  |  |  |
| Realtime | P0 | `リアルタイム` で監視開始→停止、即時読込を実行 | 二重起動せず動作し、停止で監視が止まる | TODO |  |  |  |
| Console error | P0 | 全操作中のConsoleを確認 | 致命的エラー（uncaught / RangeError / TypeError）が出ない | TODO |  |  |  |
| 404 script | P0 | Networkで `.js` 読み込みを確認 | script 404 が0件 | TODO |  |  |  |
| localStorage quota | P0 | OCR/証憑/バックアップ/ログ操作後に確認 | `QuotaExceededError` が発生しない（発生時は縮退動作で継続） | TODO |  |  |  |

## Notes

- 401発生時は「再ログインしてください」表示になり、主要機能全体が停止しないことを確認する。
- localStorageが逼迫した場合は、縮退メッセージ表示のうえ操作継続できることを確認する。
