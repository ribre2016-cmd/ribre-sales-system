# メール請求書の自動取込 セットアップ手順

Gmailに届いた請求書添付メールを、Google Apps Script が定期的に拾い、
`ribre-sales-system` の `/api/mf/ingest-mail` へ自動送信する仕組みです。
サーバー側でOCR→Storage控え保存→台帳記録（状態「送信前」）までを自動で行います。
**MFクラウドBoxへの送信は承認制です。自動では送信されません。** 台帳
（mf-evidence.html）で内容を確認し、「MFへ送信」ボタンを押した証憑だけが実際にMFへ
送信されます（`api/mf/ingest-mail.js` の承認制の実装を参照）。

## 1. Vercel環境変数の設定

Vercelのプロジェクト設定 → Environment Variables に以下を追加します。

- `MAIL_INGEST_SECRET`: ランダムな文字列（例: `openssl rand -hex 32` などで生成）

この値はGoogle Apps Script側の `INGEST_SECRET` と完全に一致させる必要があります。
設定後、Vercelへ再デプロイしてください。

## 2. Google Apps Scriptの設置

1. https://script.google.com を開き、「新しいプロジェクト」を作成
2. デフォルトの `Code.gs` の中身を削除し、`tools/gmail-ingest.gs` の内容を全て貼り付ける
3. 左メニューの歯車アイコン「プロジェクトの設定」を開き、「スクリプト プロパティ」に以下の2つを追加
   - `INGEST_URL` = `https://ribre-sales-system.vercel.app/api/mf/ingest-mail`
   - `INGEST_SECRET` = 手順1で設定した `MAIL_INGEST_SECRET` と同じ値
4. 左メニューの時計アイコン「トリガー」を開き、「トリガーを追加」
   - 実行する関数: `ingestInvoices`
   - イベントのソース: `時間主導型`
   - 時間ベースのタイマー: `分ベースのタイマー`
   - 間隔: `15分おき`
   - 保存時にGmail/UrlFetchの権限承認を求められるので許可する

## 3. 動作確認手順

1. 自分（Gmailアカウント）宛に、PDFまたは画像(PNG/JPEG)を添付したテストメールを送信する
2. Apps Scriptのエディタ画面に戻り、関数選択で `ingestInvoices` を選び、実行ボタン（▷）を押す
3. 初回は権限確認画面が出るので許可する
4. 実行ログ（表示 → 実行数）でエラーが出ていないか確認する
5. https://ribre-sales-system.vercel.app/mf-evidence.html を開き、台帳リストに
   「📧」付きの行が追加されていることを確認する
6. 対象のGmailスレッドに「MF取込済み」ラベルが付いていることを確認する
   （付いていればそのスレッドは次回以降スキップされる）

## 4. 添付ファイルサイズの上限

Vercelのサーバーレス関数はリクエストボディが約4.5MBを超えると失敗します。メール添付は
base64化する際に元サイズの約4/3に膨張するため、Apps Script側で **3MBを超える添付は
送信せずスキップ** します（`tools/gmail-ingest.gs` の `MAX_ATTACHMENT_BYTES`）。

スキップした添付はエラー扱いにせず、そのスレッドには通常どおり「MF取込済み」ラベルが
付きます（＝次回以降リトライされません）。スキップした事実は実行ログに
「添付サイズ超過のためスキップ」として件名・ファイル名・サイズ付きで記録されます
（表示 → 実行数 から確認できます）。

3MBを超える請求書等は、https://ribre-sales-system.vercel.app/mf-evidence.html を開き、
手動で貼り付け/ドラッグ＆ドロップして登録してください。ただし同画面のアップロード上限も
同じ理由（Vercelのリクエストボディ上限）で3MBのため、それでも超える場合はPDFの解像度を
下げる・分割するなどしてファイルサイズを3MB未満に圧縮してから登録してください。

## 5. 止めたいとき（ロールバック）

Apps Scriptの「トリガー」画面で `ingestInvoices` のトリガーを削除するだけで停止できます。
コードやスクリプトプロパティは残したままで問題ありません（次に有効化したいときにトリガーを再度追加するだけで再開できます）。

`MAIL_INGEST_SECRET` を未設定に戻す、またはVercel側から削除すると、
`/api/mf/ingest-mail` 自体が503 (`ingest_not_configured`) を返すようになり、二重の安全策になります。
