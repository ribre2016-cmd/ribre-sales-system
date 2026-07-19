# RIBRE 売上管理システム

株式会社RIBRE（古物商）の売上・仕入管理＋マネーフォワード(MF)証憑連携システム。

## 構成

- **技術**: ビルド不要の静的SPA（Vanilla JS）＋ Vercel Serverless Functions ＋ Supabase（DB/Storage/Auth）
- **本番**: https://ribre-sales-system.vercel.app
- **デプロイ**: `npx --yes vercel deploy --prod --scope ribre2016-cmds-projects`
- **エントリ**: `index.html`（売上管理本体・かんたんモード常時固定）／`mf-evidence.html`（MF証憑インボックス）／`kobutsu-ledger.html`（電子古物台帳）

## MF証憑連携（2026-07構築）

**目的**: 税理士とのやり取りを自動化。証憑（領収書・請求書）をMFクラウドBoxへ送り、登録済み仕訳に自動マッチング添付する。税理士の作業（仕訳登録）は変えない。

**運用の役割分担**:
- カード・銀行引落の取引 → このシステム（メール自動取込/貼り付け → Box → マッチング添付）
- 現金レシート → **MFクラウド経費**のスマホアプリ（このシステムの守備範囲外。MF標準の経費→会計連携を使う）

**主要ファイル**:
- `pages/mf-evidence.js` — 証憑インボックス画面（Ctrl+V/撮影/OCR/台帳/マッチングUI/プレビュー）
- `api/mf/_lib/mf-client.js` — MF OAuth・証憑送信。`_lib/mf-match-core.js` — マッチングコア（3段: 完全一致→±3日→取引先名+±7日）
- `api/mf/ingest-mail.js` — Gmail Apps Script（`tools/gmail-ingest.gs`）からのメール添付受信。**承認制**（pending保存→台帳で人がMFへ送信/削除）
- `api/mf/evidence-action.js` — 再送/削除/プレビューの統合エンドポイント
- `api/openai/*` — OpenAIプロキシ（ブラウザにAPIキーを渡さない）
- `docs/MF_SETUP.md` / `docs/MAIL_INGEST_SETUP.md` — セットアップ手順

## 触る前に知るべき制約（ハマりどころ）

1. **VercelはProプラン**（2026-07-19にHobbyから移行確認）。Hobby時代の「Serverless Functions 12個上限」は撤廃済みで、新APIは既存への統合不要（過去の統合例: evidence-action.js）。ただしリクエストボディ約4.5MB上限は全プラン共通なので、base64ファイル送信は実ファイル3MBまで（クライアント/Gmail取込とも3MB制限済み）
2. **MF仕訳APIの金額は税抜**。`branches[].debitor.value + tax_value` の合計＝税込。証憑（税込）との比較は必ず合算値で（`mf-match-core.js` の `journalAmount()`）
3. **Supabase REST/Storageは `apikey` ヘッダー必須**（Authorizationだけだと黙って失敗）
4. **全APIエンドポイントは認証必須**: ログインユーザー（`verifySupabaseToken`）または Cron（`CRON_SECRET`）またはメール取込（`MAIL_INGEST_SECRET`）
5. APIでBoxに入れた証憑は授受区分「未選択」。後から「受領」に変えてもMFのAI-OCR仕訳候補には流れない（MF側の既知の不具合）
6. OCRは `gpt-4.1`。2桁年（26.7.3）は20xx解釈をプロンプトで明示済み。日付が読めない/あり得ない年のときは空欄にする（今日の日付で埋めない）。外貨建て証憑（Anthropic/OpenAI等のドル建て請求書）はOCRが`currency`（ISO4217）も返し、`mf_evidence.ocr_currency`（要`supabase_mf_currency.sql`）に保存する。JPY以外は円換算しない・金額ベースのマッチング(`findCandidates`/`findFuzzyCandidates`)対象外にする（`mf-match-core.js`の`isJpyEvidence`）
7. Boxメタデータ（取引日・取引先・金額）はAPIで書き込めない（会計APIに機能なし、Box APIはトライアル非公開）。台帳の「Box入力」チェック列で手入力漏れを管理
8. 台帳（Supabase `mf_evidence`）とMF側は同期しない
9. **売上/仕入データを書き込むページは必ず `services/data-store.js` を読み込むこと**。`hydrate()`（起動時）はクラウドの内容でlocalStorageを**完全置換**するため、data-store.js無しのページで書いた行は（クラウドにpushされず）次にどこかのページを開いた瞬間に消える。実際にPhase Bで発生（957b8abで修正）
10. **MFのvouchers APIは呼ぶたびに必ず新規ファイルを作成する**。既存アップロード済みファイルを後から仕訳に紐付け直すことも、未紐付けファイル単体を削除することもできない（`DELETE /vouchers`はjournal_id必須＝既に仕訳に紐付いているものの解除専用。openapi.yamlで確認済み）。そのため証憑の「送信」ボタン（`handleResend`/`vouchers.js`）は、送信時点で確実な仕訳が見つからなければ即座に未紐付け送信せず`status='awaiting_match'`（マッチ待ち）で保留する。日次cron・手動「マッチング実行」（`processAwaitingMatch`）が見つかるまで再チェックし続け、**自動フォールバックは無い**（ユーザーの明示的な選択。要`supabase_mf_awaiting_match.sql`）。長期間見つからない証憑は台帳から手動で対応する（削除して再登録、またはMF画面から直接対応）
11. **証憑のMF添付は必ずclaim（条件付きPATCH）を先に行う**。`attachEvidenceToJournal`はMF送信より先に`status=eq.<元status>`条件付きで`status='attached'`へ遷移させ、0行更新なら他プロセスが処理済みとして**MFへ送信しない**（`claimEvidence`）。失敗時は元statusへ復帰。MFのvouchersは取り消し不能なため、この順序（DB先行claim→送信）を崩すと二重送信が復活する。cron毎時実行・手動マッチング・再送ボタンが同時に走っても安全なのはこの仕組みによる
12. **mf_evidenceのRLSはメンバー許可リスト方式**（`supabase_mf_owner_rls.sql`）。共有Supabaseプロジェクトのため`authenticated`全開放は禁止。閲覧・更新はRIBREメンバーのメール（ribre2016@gmail.com / k.sado@ribre.co.jp）のみ。メンバー追加はSQLのリストに足して再実行。`content_hash`にはunique制約あり（メール取込の同時実行重複をDBレベルで防止）
13. **OCRが想定外の形（配列・複数候補など）を返したときに「それらしい値」を自動計算で補完しない**。特に金額は、精算書・請求書のように複数ページ・複数箇所に合計/小計/明細が入れ子で存在することがあり、それらを単純合算すると二重計上で架空の金額になりうる（実例: 実際の合計37,572円のところ、合計・小計・明細7件の全9値を合算し103,092円という誤った値を出してしまい、ユーザー指摘で発覚・撤回。詳細はCLAUDE_LOG.md「2026-07-13 (続き2)」）。想定外の形式で返ってきた場合は`extractJson`/`extractOcrJson`とも黙って失敗（`null`/`{}`、console.errorに生の応答を記録）させ、手入力に委ねるのが正しい。発生自体を減らす対策はプロンプト強化（単一オブジェクト限定・最終合計のみを返す指示）で行う

## 環境変数（Vercel）

`MF_CLIENT_ID` `MF_CLIENT_SECRET` `MF_REDIRECT_URI` `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `OPENAI_API_KEY` `SLACK_WEBHOOK_URL` `CRON_SECRET` `CHATWORK_API_TOKEN` `CHATWORK_ROOM_ID`（現在テスト用マイチャット宛） `MAIL_INGEST_SECRET`

## Cron（vercel.json）

- 毎時0分: `/api/mf/auto-match` — 自動マッチング＋結果・失敗があればSlack通知（Pro移行で日次→毎時化。失敗も通知される）
- 毎月28日: `/api/mf/monthly-report` — カバー率をSlack＋Chatworkへ

## 変更履歴

`CLAUDE_LOG.md` に日付付きで記録すること（外部プロジェクト変更ログの慣例）。機能追加は1機能1コミットにし、ロールバックは `git revert <コミット>` → 再デプロイ。
