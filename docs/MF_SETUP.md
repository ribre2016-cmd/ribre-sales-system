# マネーフォワード クラウド会計 連携セットアップ

## 1. MFアプリポータルでアプリ登録

1. マネーフォワード クラウド開発者ポータル（https://developers.biz.moneyforward.com/）で
   アプリを新規登録する。
2. リダイレクトURI（コールバックURL）に以下を設定する。

   ```
   https://<本番ドメイン>/api/mf/auth/callback
   ```

   ローカル確認用に別途登録する場合は開発環境のURLも追加する。
3. 必要スコープ: `mfc/accounting/voucher.write`, `mfc/accounting/journal.read`
4. 発行された `Client ID` / `Client Secret` を控える。

> NOTE: OAuth2 の authorize/token エンドポイントURLは
> `api/mf/_lib/mf-client.js` 内で TODO コメント付きの暫定値として定数化している。
> 本番接続前に公式ドキュメントで正式なURLを確認し、必要なら修正すること。

## 2. Vercel 環境変数

Vercelプロジェクトの Settings > Environment Variables に以下を設定する。

| 変数名 | 内容 |
|---|---|
| `MF_CLIENT_ID` | MFアプリのClient ID |
| `MF_CLIENT_SECRET` | MFアプリのClient Secret |
| `MF_REDIRECT_URI` | `https://<本番ドメイン>/api/mf/auth/callback` |
| `SUPABASE_URL` | 既存のSupabaseプロジェクトURL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabaseのservice roleキー（絶対にフロントに出さない） |

## 3. SQL 適用手順

Supabase SQL Editor で `supabase_mf_evidence.sql` を実行する。

- `mf_tokens`: id=1固定の1行運用。RLSは有効だがポリシーは作らず、service roleキー経由のみアクセス可能。
- `mf_evidence`: 証憑送信履歴。認証済みユーザーはselect/insert可能。

## 4. 接続テスト手順

1. `mf-evidence.html` を開き、「MF連携: 未接続」と表示されることを確認する。
2. 接続ボタン押下 → `/api/mf/auth/start` が返すURLへ遷移 → MFの認可画面でログイン・許可。
3. `/api/mf/auth/callback` が呼ばれ、`mf-evidence.html?connected=1` にリダイレクトされることを確認する。
4. ステータス表示が「MF連携: 接続済み」になることを確認する。
5. テスト画像を貼り付け、送信ボタンで `/api/mf/vouchers` にPOSTし、`{ok:true}` が返ることと
   `mf_evidence` テーブルに `status='box_saved'` の行が追加されることを確認する。
6. 失敗時は `mf_evidence` に `status='failed'` と `error_message` が記録されることを確認する。

## 5. Phase3: 証憑カバー率・月次Slackレポート

### 環境変数（追加）

| 変数名 | 内容 |
|---|---|
| `SLACK_WEBHOOK_URL` | SlackのIncoming Webhook URL。未設定でも他機能は動くが、月次レポートは `slack_not_configured` を返す |
| `CRON_SECRET` | Vercel Cronからの `/api/mf/monthly-report` 呼び出しを認証する秘密値。任意の乱数文字列を設定する |

### Cronの動作

`vercel.json` の `crons` に `/api/mf/monthly-report` を毎月28日 0:00 UTC（日本時間9:00頃）に実行する設定を追加済み。
Vercelが自動的に `Authorization: Bearer <CRON_SECRET>` を付けて呼び出す（Vercel側でCRON_SECRETを使う設定をしている場合）。
ログインユーザーが手動で叩く場合はSupabaseアクセストークンでも認証を通過できる。

### カバー率の見方

- 「証憑あり」= MF側の仕訳に `voucher_file_ids` が1件以上ある状態（自動マッチ添付・手動添付・直接MF証憑UIからの添付いずれも含む）
- カバー率90%以上=緑、70〜89%=黄、70%未満=赤のメーターで表示
- 「証憑なしの仕訳」一覧は最大50件、日付昇順で表示（それ以上は`mf-evidence.html`ではなくMF本体で確認する）

## 6. Phase4: 自動マッチングCron・Chatwork月次報告

### 環境変数（追加）

| 変数名 | 内容 |
|---|---|
| `CHATWORK_API_TOKEN` | ChatworkのAPIトークン。Chatwork画面右上のプロフィールアイコン→「サービス連携」→「APIトークン」から発行・取得する |
| `CHATWORK_ROOM_ID` | 通知先ルームのID。対象ルームをブラウザで開いたときのURL末尾 `#!rid<数字>` の数字部分 |

### auto-matchの自動実行（Cron）

`vercel.json` の `crons` に `/api/mf/auto-match` を毎日 22:00 UTC（日本時間 翌朝7:00頃）に実行する設定を追加済み。
box_saved状態の証憑をまとめて仕訳とマッチングし、自動添付できたもの・候補が複数で保留（ambiguous）になったものを集計する。
添付件数または保留件数が1件以上のときのみSlack通知する（0件の日は通知しない）。

### monthly-reportの通知先切り替え

`/api/mf/monthly-report?target=slack|chatwork|all` のクエリパラメータで通知先を個別にテスト実行できる（デフォルトは`all`）。
未設定のサービスは `slack_sent:false` / `chatwork_sent:false` を返す。両方とも未設定の場合は `{ok:false, error:'notify_not_configured', ...}` を200で返す。
