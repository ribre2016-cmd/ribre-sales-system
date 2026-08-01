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

## 売上CSV取込まわり（2026-08 大規模改修）

**取込ページの構成**（`index.html` の `#page-import`。上から順）:
1. **やることリスト（受信箱）** `pages/auto-inbox.js` — 監視フォルダの新着CSV・証憑を自動検出
2. 売上CSV取込 / 3. 配送照合 / 4. メール取込状況 / 5. OCR取込
6. **取込履歴とチャネル訂正**（折りたたみ）`pages/import-history.js` — 取込元を間違えた分をCSV単位で訂正・削除

**受信箱の要点**:
- File System Access API（**PCのChrome/Edge専用**）。ハンドルはIndexedDB、取込済み台帳は
  `ribre_inbox_seen_v1`（ファイル内容のSHA-256）。**取込は必ず利用者のクリック**
- 取り込み直したいときは「取込済みのファイル」から**ファイル単位で**「もう一度取り込む」。
  全消し（`aibClearLedger`）は配送CSVまで再表示されるので通常は使わない
- CSVの分類は決定的（見出し・列位置・ファイル名）。**LLMは使わない**

**棚番からの出品アカウント判定**（`aibDetectAccount`）:
- 商品タイトル先頭が `<配送サイズ><アカウント英字><種別><棚番>` （例 `1HC1`）
- 配送サイズ: 1=ネコポス 2=宅急便コンパクト 3=ヤマト60 4=80 5=100（判定に不使用）
- アカウント: 無し/K=ヤフオク1、S=2、R=3、N=4、M=5、J=6、Q=7、H=8
- 種別: C=CD、D=DVD、K=カセットテープ
- 全行を集計して多数決。3行未満・6割未満・未知の英字は**判定しない**（勝手に決めつけない）
- ヤフオク4は2026年8月頃まで棚番が無いため判定不能

**配送照合の要点**:
- ヤマトは**2種のCSVを組み合わせて初めて送料が入る**。発行済データ(yamato1)=商品ID↔伝票番号
  （運賃の列は無い）、運賃明細(yamato2)=伝票番号↔送料。そのため商品IDを持つ行を先に処理し、
  ループ中に付与した伝票番号を索引へ即反映する（`appvMatchShipping`）
- 送り状だけ当たって送料0の行は「**送料待ち**」として不一致に数える。これが出ていたら
  **運賃明細の取込漏れ**を疑う（出力期間の隙間で実際に発生した）
- CSV種類は**ファイル名を優先**（`appvDetectShipTypeByName`: 発行済データ→yamato1、
  unchinjyoho/運賃→yamato2、佐川→sagawa）。中身の列位置判定だけでは誤判定する
- 配送データは `shipping_rows` テーブルでクラウド同期（`pages/shipping-sync.js`）。
  取込ページを開いたとき1回pull、取込・再照合の後にpush。**ローカル行は削除しない追加専用**

## AI機能（2026-08 追加）

- **AI質問**（分析ページ・`pages/ai-assistant.js`）: 日本語で売上・仕入を質問できる。
  モデルは `gpt-5.6-luna`（ツール利用向けで安価。失敗時はgpt-4.1へ自動フォールバックし、
  使ったモデル名を回答の根拠行に表示）。**金額の計算はJS側で行いモデルには暗算させない**
- **修正・削除**（`pages/ai-write.js`）: AIは「提案」を作るだけ。利用者が実行を押した時に
  **自動バックアップ→実行**。修正50件・削除10件が上限、締め済み月は対象外、
  提案から10分で失効、「元に戻す」あり
- **学習メモ**（`pages/ai-memory.js`）: 教わった解釈を覚えて次回以降に適用。
  記憶はシステムプロンプトへ差し込まれるため、安全ルールを覆す内容は**保存自体を拒否**する
- **MFのMCPサーバー**: Claude Codeから会計データを直接照会できる（`claude mcp add --scope user
  --transport http moneyforward https://beta.mcp.developers.biz.moneyforward.com/mcp/ca/v3`）。
  仕訳作成・更新の権限も付くため、当面は照会用途に留めるのが安全

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
10. **MFのvouchers APIは呼ぶたびに必ず新規ファイルを作成する**。既存アップロード済みファイルを後から仕訳に紐付け直すことも、未紐付けファイル単体を削除することもできない（`DELETE /vouchers`はjournal_id必須＝既に仕訳に紐付いているものの**添付解除**専用でファイル本体は消えない〔電帳法要件のため削除不可・ゴミ箱移動のみ〕。紐付け専用endpointは存在せず、仕訳作成APIの書込フィールドにも`voucher_file_ids`は無い。2026-08-01にopenapi.yaml全文と/specs/vouchersで再確認済み）。なお`journal_id`自体は`nullable: true`かつ非requiredで、**仕訳なしアップロードは仕様上は可能**（その場合「電子取引データ保存」扱いとなり、電帳法の検索要件はBox画面での3項目入力か画面での仕訳紐付けが別途必要）。そのため証憑の「送信」ボタン（`handleResend`/`vouchers.js`）は、送信時点で確実な仕訳が見つからなければ即座に未紐付け送信せず`status='awaiting_match'`（マッチ待ち）で保留する。日次cron・手動「マッチング実行」（`processAwaitingMatch`）が見つかるまで再チェックし続け、**自動フォールバックは無い**（ユーザーの明示的な選択。要`supabase_mf_awaiting_match.sql`）。長期間見つからない証憑は台帳から手動で対応する（削除して再登録、またはMF画面から直接対応）
11. **売上CSVの再取込は商品IDで重複判定され「補完更新」になるが、チャネル名(shop)は選択中の取込元で上書きされる**（`appvImportYahooCsv`の`if (account && existing.shop !== account)`）。つまり再取込は行を増やさない一方で無害でもなく、**間違ったアカウントを選んで取り込み直すとその分が丸ごと別チャネルへ移動する**。逆に言えば、正しいアカウントで取り込み直せばチャネルの訂正にもなる。取込元の選び忘れは`appvGuessImportAccount`（棚番＞ファイル名の順で推定）が検知して確認ダイアログを出す
12. **証憑のMF添付は必ずclaim（条件付きPATCH）を先に行う**。`attachEvidenceToJournal`はMF送信より先に`status=eq.<元status>`条件付きで`status='attached'`へ遷移させ、0行更新なら他プロセスが処理済みとして**MFへ送信しない**（`claimEvidence`）。失敗時は元statusへ復帰。MFのvouchersは取り消し不能なため、この順序（DB先行claim→送信）を崩すと二重送信が復活する。cron毎時実行・手動マッチング・再送ボタンが同時に走っても安全なのはこの仕組みによる
13. **mf_evidenceのRLSはメンバー許可リスト方式**（`supabase_mf_owner_rls.sql`）。共有Supabaseプロジェクトのため`authenticated`全開放は禁止。閲覧・更新はRIBREメンバーのメール（ribre2016@gmail.com / k.sado@ribre.co.jp）のみ。メンバー追加はSQLのリストに足して再実行。`content_hash`にはunique制約あり（メール取込の同時実行重複をDBレベルで防止）
14. **売上の並び順は「アカウント順（ヤフオク1〜8→メルカリShops）→CSVの行順」で、表示のたびに並べ替える**（`appvSortSalesForDisplay`）。保存時に並べても意味がない: `hydrate()`がクラウドから`order=client_id.asc`で取得した内容でlocalStorageを丸ごと置き換えるため、ページを開くたびに崩れる。CSVの行番号は`sales.csv_order`列で同期している（要`supabase_sales_csv_order.sql`）。**mapSaleOut/mapSaleInに無いフィールドはhydrateで消える**ので、行に持たせたい値は必ず両方へ足すこと
15. **localStorageは約5MBで、実際に上限到達して取込が失敗した**。内訳の実測は配送行1535KB・売上1403KB・yahoo240 1403KB（売上とほぼ同一内容の複製）・照合結果646KB。対策として`setLS`が容量不足時にスナップショット削除→`appvCompactStorage`（配送行のrawを照合に使う6列だけ残す／照合結果の未使用フィールド削除）を自動実行する。**新しく大きなデータをlocalStorageへ足すときは、この5MBの枠を意識すること**。なお`ribre_yahoo_sales240`が売上の完全な複製である点は未解消の無駄（下記「残課題」参照）
16. **数千行を扱うループでlocalStorageの読み書きを毎回行わない**。実際に配送照合で一致行ごとに約1.4MBのJSONを全読み書きし、2861行×2.8MB≒8GBでブラウザが**Out of Memory**でクラッシュした。まとめて1回にする（`appvSyncYahooShipBatch`）。総当たりの照合も、正規化を毎回やり直さず1回だけ計算して使い回す
17. **OCRが想定外の形（配列・複数候補など）を返したときに「それらしい値」を自動計算で補完しない**。特に金額は、精算書・請求書のように複数ページ・複数箇所に合計/小計/明細が入れ子で存在することがあり、それらを単純合算すると二重計上で架空の金額になりうる（実例: 実際の合計37,572円のところ、合計・小計・明細7件の全9値を合算し103,092円という誤った値を出してしまい、ユーザー指摘で発覚・撤回。詳細はCLAUDE_LOG.md「2026-07-13 (続き2)」）。想定外の形式で返ってきた場合は`extractJson`/`extractOcrJson`とも黙って失敗（`null`/`{}`、console.errorに生の応答を記録）させ、手入力に委ねるのが正しい。発生自体を減らす対策はプロンプト強化（単一オブジェクト限定・最終合計のみを返す指示）で行う

## 環境変数（Vercel）

`MF_CLIENT_ID` `MF_CLIENT_SECRET` `MF_REDIRECT_URI` `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` `OPENAI_API_KEY` `SLACK_WEBHOOK_URL` `CRON_SECRET` `CHATWORK_API_TOKEN` `CHATWORK_ROOM_ID`（現在テスト用マイチャット宛） `MAIL_INGEST_SECRET`

## Cron（vercel.json）

- 毎時0分: `/api/mf/auto-match` — 自動マッチング＋結果・失敗があれば**Chatwork通知**（ユーザーはSlack利用を停止しChatworkへ移行済み。SLACK_WEBHOOK_URLが残っていればSlackにも並行送信される）。Pro移行で日次→毎時化
- 毎月28日: `/api/mf/monthly-report` — カバー率をSlack＋Chatworkへ

## 残課題（2026-08-02 時点・未着手）

着手する前に必ず利用者へ確認すること。急ぎのものは無い。

1. **`ribre_yahoo_sales240` が売上の完全な複製**（1.4MB）。localStorageの最大の無駄だが、
   旧UI（legacy.html）とCSV取込ロジックの両方が参照しているため、解消には慎重な設計が必要
2. **スタッフ名簿（`staff`）のRLSが `authenticated` 全開放**。共有Supabaseのため、
   SELKURA等の他アプリのログインユーザーが氏名・メール・LINE IDを読める。
   **勤怠の運用（スタッフ各自がログインするのか等）が分からないと閉じると壊す恐れ**があるため保留。
   利用者に運用を確認してから対応する（2026-08-02「一旦後回しで平気」との判断）
3. **運賃明細の伝票番号が10桁のものが73件**（正常は12桁）。突合できていない可能性があり要調査
4. **常駐版**: ブラウザを閉じていても証憑PDFのOCR・仕訳添付まで進める仕組み
   （`/api/mf/ingest-mail` へPOSTする小さな常駐スクリプト）。売上CSVは確認のためどのみち
   アプリを開くので、常駐化の価値は証憑に限られる
5. **MF仕訳の自動作成**: 設計書は `docs/MF_JOURNAL_PLAN.md` に完成済み。
   **税理士への確認14項目**と、消費税の丸め方の実測が前提。実装は未着手
6. **AI質問からMF会計データも参照できるようにする**: 現在アプリが持つMF権限は
   仕訳の読み取りと証憑アップロードのみ。試算表等を見るには権限追加と再連携が必要
7. 3月以前の売上が配送照合で「匿名配送」と表示される（実際は手入力送料333件）。
   データは正常でラベルだけの問題。過去データのため触らない判断（2026-08-02）

## 変更履歴

`CLAUDE_LOG.md` に日付付きで記録すること（外部プロジェクト変更ログの慣例）。機能追加は1機能1コミットにし、ロールバックは `git revert <コミット>` → 再デプロイ。
