# Claude 作業ログ

このファイルは、Claude（AIアシスタント）がこのプロジェクトに加えた変更の記録です。
新しい変更は上に追記します。

## 2026-07-19 (続き) 中優先課題4件＋Chatwork通知切替（全体レビュー残課題の解消）

前エントリの全体レビューで残っていた中優先4件をユーザー指示により一括修正。

- **①Supabaseセッション自動リフレッシュ**（services/supabase-auth.js / auth-gate.js）:
  `ribreRefreshSession()`新設。5分ごと＋期限10分前に`grant_type=refresh_token`で先行更新。
  失敗時はセッションを壊さずconsole.warnのみ。同時実行は単一Promiseへ集約。タブ間の
  競合はaccess_token比較で新しい方を優先。auth-gateは期限切れ検知時に一度だけ
  リフレッシュを試みてからゲート表示（急にログイン画面へ戻される問題の解消）。
  restHeaders()は同期呼び出し（7箇所）のため非同期化せず、先行タイマー方式のみ採用
- **②タブ間同期ロック**（services/data-store.js）: `ribre_sync_lock_v1`（owner+ts、30秒で
  失効）でreconcileとhydrateを相互排他。ロック中のpushは`{ok:true, locked:true}`で
  待機扱い＋debounce再試行（呼び出し元は偽エラーを出さない形を実測確認）。分割送信中は
  renewLockで陳腐化防止。ロック機構自体の例外はフェイルオープン（同期を止めない）。
  既知の残余: ミリ秒級のacquire競合窓（CASなしlocalStorageの限界・コメント明記）、
  replaceCloudWithLocal/seedFromThisPCは対象外（手動・稀な操作のため）
- **③Gmail取込をメッセージID単位の重複排除へ**（tools/gmail-ingest.gs）: 検索から
  ラベル除外を撤廃し、Script Properties`PROCESSED_MSG_IDS`（上限400件≒7.6KB<9KB制限）で
  メッセージ単位に管理。同一スレッドに届く翌月請求書も取り込まれるように。ラベルは
  視覚マーカーに降格。失敗メッセージのみ再試行（兄弟メッセージを道連れにしない）。
  更新直後は7日窓内の既処理分が一度だけ再走査されるがサーバーのcontent-hash重複判定で
  即座に弾かれる（無害・コメント明記）。処理済みスレッドが枠を消費するようになったため
  MAX_THREADS_PER_RUNを10→50へ拡大
- **④iPhone HEIC対応**（pages/mf-evidence.js）: png/jpeg以外のimage/*はcanvas経由で
  JPEG(品質0.92・長辺2500px上限)へ変換してから通常フローへ。変換後にサイズ検査
  （HEICは変換で3MB未満に縮むことが多い）。デコード不能ブラウザでは設定変更手順
  （設定→カメラ→フォーマット→互換性優先）を案内するアラート。OCRレースガードは不変
- **⑤通知先をSlack→Chatworkへ**（api/mf/auto-match.js）: ユーザーがSlack利用を停止した
  ため、auto-matchの成功/失敗通知をChatwork（monthly-reportと同一API方式）へ送信。
  SLACK_WEBHOOK_URLが設定されていれば並行送信も維持（害なし）。通知失敗はcronを
  失敗させない

**テスト**: 新規3スイート（session-refresh 6 / cross-tab-lock 18〔vm二重コンテキストで
2タブを実シミュレート〕/ auto-match-notify 3）＋既存5スイート全パス。全ファイル
node --check OK（.gsもJS構文検証済み）。

**ユーザー作業**: gmail-ingest.gsのscript.google.comへの再貼り付けが必要。
CHATWORK_ROOM_IDは現在テスト用マイチャット宛のため、本番の部屋へ変えるなら
Vercel環境変数の変更が必要。

## 2026-07-19 全体レビュー（5観点並列）→ CRITICAL/HIGH指摘の一括修正

ユーザー指示「全体をくまなくレビューし100点になるように」により、5観点（APIセキュリティ/
MFマッチングロジック/クライアントデータ整合性/SQL・RLS/証憑UI+OCR）の並列レビューを実施。
全指摘をコード行レベルで裏取りし、以下を修正した。

**P1: データ消失根絶（CRITICAL）**
- C1: 通常モード手入力の売上行がLS.salesのみに書かれ、ヤフオクCSV取込のappvYSave
  （yahoo240起点でLS.salesを丸ごと置換）で消えて次のreconcileでクラウドからも削除される
  事故経路を修正。appvInsertRowにappvSyncYahoo('insert')ミラーを追加。監査で見つかった
  同種のミラー漏れ（月締め/締め解除/配送CSV自動照合）も修正
- C2: 旧アップロード経路uploadSales/uploadPurchases（client_idなし生POST＝呼ぶたび全行複製。
  2026-07-01の3210→6420件倍化事故と同一機構）をdata-store.jsのpushSafe()委譲へ書き換え。
  生POSTには二度と到達しない。ver320自動同期も同様に委譲化
- H1: 新UI（appvManualPush）に大量削除の承認フローを追加（pendingDeletes>0でconfirm→
  allowMassDelete再実行。従来は旧ページにしか承認手段がなく、保留削除がリロードで復活していた）
- appvTaxShareRandTokenのMath.randomフォールバック廃止（安全な乱数が使えない環境ではエラー）

**P2: MF二重送信の構造的根絶（HIGH）**
- claimEvidence（条件付きPATCH status=eq.元status）を新設し、attachEvidenceToJournalを
  「DB先行claim→Storage取得→MF送信→mf_file_id記録（ベストエフォート）」の順に再構築。
  0行更新=他プロセス処理済みならMFへ送信しない。失敗時は元statusへ復帰。
  cron毎時実行・手動マッチング・再送の同時実行でも二重送信が構造的に不可能に
- 同一実行内で添付済みの仕訳を後続証憑の候補から除外（従来はマーカーだけで実質機能せず）
- runManualMatchにstatus='attached'ガード（already_attachedエラー）
- 送信ボタンをconfirmダイアログより前に無効化＋in-flightガード（二重クリック窓の封鎖）
- ファイル上限5MB→3MB（base64膨張4/3×Vercelリクエスト上限4.5MBのため5MBは必ず失敗していた）。
  Gmail取込も3MB超をスキップ＋ログ（従来は7日間15分おき無限リトライ）
- OCRレース修正（別ファイル貼り付け時に古いOCR結果がフォームを上書きしない）、
  日付/金額未入力時の送信confirm、プレビューモーダルのリスナーリーク修正、
  状態フィルタに「マッチ待ち」追加

**P3: セキュリティ隔離（ユーザーがSupabase SQL Editorで実行済み）**
- supabase_mf_owner_rls.sql: mf_evidenceの全開放ポリシー（authenticated using(true)×3本）を
  RIBREメンバーのメール許可リスト方式へ置換（共有プロジェクトの同居アプリから遮断）。
  当初user_email一致方式で実装したが実運用ログインがk.sado@ribre.co.jpのため台帳が
  空表示になり、許可リスト方式へ即日変更。content_hashにunique制約追加（重複0件確認済み）
- tax-shareトークン検証強化（regex {32,64}・SHA-256+timingSafeEqual比較）

**P4: 運用可視化＋Proプラン活用**
- auto-matchのSlack通知を失敗時にも送るよう変更（従来は成功時のみで、MF連携が壊れても
  永久に無通知だった）
- CRON_SECRET/MAIL_INGEST_SECRETの比較をtimingSafeEqual化
- OCRプロンプトの「今日」とカバー率の対象月をJST化（従来UTC: JST朝9時まで前日/前月扱い）
- ingest-mailの金額0保全（||nullで0がnullになっていた）・ボディサイズ上限追加
- vercel.json: auto-matchを日次→毎時化（Pro移行による）。netlify.toml削除（死に設定）
- CLAUDE.md: 制約#1をPro前提に書き換え、claim必須(#11)・RLSメンバー方式(#12)を追加

**テスト**: 全5スイート（auth 14グループ/currency-dup-match 29/no-double-upload 39
〔claim対応で書き換え＋claim競合・revert・同一仕訳除外の新規3ケース追加〕/ocr-repair 3/
ocr-array-repair 6）パス。全13ファイルnode --check OK。RLSは本番の実画面で台帳表示を確認済み。

**レビューで確認した非問題（記録）**: 未認証者から突ける穴なし・SSRF/インジェクション/CORS
問題なし・シークレット混入なし・OAuth state設計は堅牢・mf_tokens/StorageはRLS deny-all適切。
Vercelのcache-controlはmax-age=0のため?v=キャッシュバスティングは実質不要。

## 2026-07-13 (続き2) MF証憑OCR: 「配列を自動合算」は誤りだったため撤回。安全に失敗する仕様に訂正

直前のエントリ（下記「真の原因判明→合算して修復」）で実装した**自動合算は誤りだった**。
ユーザーが実際の証憑PDF「409_20260710_ver1_精算書(再発行).pdf」を提供して指摘してくれた
（正しい合計金額は37,572円。自動合算の結果103,092円は誤り）。

PDFを直接確認したところ、9件の値は独立した9件の取引ではなく、**同一取引を3階層で
重複表現したもの**だった: (1) 1ページ目の精算合計金額 -37,572円（正しい最終値）、
(2) 2ページ目の買主小計 34,020円（=買上小計31,500円＋手数料2,520円）、(3) 2〜3ページ目の
商品明細7件（合計31,500円）。つまり合計・小計・明細が入れ子で重なっており、全9件を
単純合算すると合計と内訳を二重・三重に計上してしまい、実際より大きい架空の金額
（103,092円）になっていた。

**金額データという性質上、構造を確実に理解できないOCR出力を「それらしい合算値」で
自動補完するのは危険**（もっともらしいが誤った金額を黙って生成してしまう）と判断し、
以下の通り訂正した:
- `ribreReduceOcrArray`（services/openai-ocr.js）・`reduceOcrArray`（api/mf/ingest-mail.js）を
  完全に削除。`extractJson`/`extractOcrJson`は配列が返ってきた場合も推測復元せず、
  素直に失敗（`null`/`{}`を返し`console.error`で生の応答を記録）して手入力を促す元の
  挙動に戻した
- 発生自体を減らすため、OCRプロンプト（pages/mf-evidence.jsのmfRunOcr・
  api/mf/ingest-mail.jsのbuildOcrPrompt）をさらに強化。「配列も複数候補も絶対に返さない」
  「精算書・請求書のように複数ページ・複数箇所に小計や明細があっても合算・個別列挙せず、
  書類内で最終的に支払う/受け取る1つの金額（『合計』『合計金額』『精算合計金額』
  『お支払い金額』『ご請求金額』等とラベルが付いた最終値、通常は書類の一番下）だけを
  返す」ことを明記。マイナス表記の金額は絶対値で返す指示も追加

**テスト**: `test-mf-ocr-array-repair.js`をユーザー提供の実データ（9明細配列）のまま
「合算せず安全に失敗する」仕様へ書き換えて再確認（6assertion、status='pending'・
ocr_amount/date/vendor=null・file_nameは元のまま）。node直接requireで
`window.ribreExtractOcrJson`が同じ実データに対し`null`を返しconsole.errorに生の応答を
記録することも確認。既存の回帰テスト（test-mf-auth.js 14グループ、
test-mf-currency-dup-match.js 29assertion、test-mf-no-double-upload.js 30assertion、
test-mf-ocr-repair.js 3assertion）もすべてパスし回帰なし。

**教訓**: 曖昧・想定外の形で返ってきたOCR結果を「それらしい計算」で自動補完するのは、
特に金額のような財務データでは危険。構造を確信できない場合は黙って失敗させ手入力に
委ねる方が安全（[[CLAUDE.md]]にも同様の注意を追記）。

## 2026-07-13 (続き) MF証憑OCR: 真の原因判明「精算書で明細ごとのJSON配列が返る」→合算して修復 ※このエントリの対策は誤りと判明し上記で撤回・訂正済み

前回追加した診断ログにより、ユーザーが実際にコンソールへ出た生の応答を報告してくれ、
真の原因が判明した。「オークション志木_20260710_ver1_精算書.pdf」（9件の商品明細を含む
消化仕入の精算書）に対し、モデルが単一オブジェクトの指示を無視し、**明細1件ごとに
別オブジェクトとしたJSON配列**（`[{"date":...,"amount":37572,...}, {...}, ...]` 全9件）を
返していた。旧`extractJson`/`extractOcrJson`は単一オブジェクトしか想定しておらず、配列の
外側`[`/`]`を最初の`{`〜最後の`}`抽出で剥がしてしまい、複数オブジェクトが並ぶ不正なJSON
として`JSON.parse`が必ず失敗する構造的な問題だった（前回追加した生改行の修復では対応不可）。

**対策（誤り。上記の訂正エントリを参照）**:
- OCRプロンプト（pages/mf-evidence.jsのmfRunOcr・api/mf/ingest-mail.jsのbuildOcrPrompt。
  両者同一仕様を維持）に「出力は必ずJSONオブジェクト1つのみ。配列は絶対に返さない」
  「精算書等で複数明細があっても、明細ごとに分けず書類全体の合計金額1つを返す」を明記
- 保険として`ribreReduceOcrArray`（services/openai-ocr.js）・`reduceOcrArray`
  （api/mf/ingest-mail.js）を追加。それでも配列が返った場合、`extractJson`/`extractOcrJson`
  の最終フォールバックとしてフェンス除去のみの生テキストを配列として解析し、`amount`
  （openai-ocr.js側は`shipping`も）を全明細で合算、それ以外のフィールドは先頭要素の
  非空値を採用して単一オブジェクトへ還元する

**テスト**: ユーザー報告の実データ（9明細・合計103,092円）をそのまま使った統合テストで
サーバー側extractOcrJsonが正しく合算・抽出することを確認（5assertion）。ブラウザ実機でも
同じ実データでribreExtractOcrJsonが103,092円・日付・取引先を正しく1オブジェクトへ還元し、
console.errorも呼ばれない（正常に修復できた）ことを確認。既存73assertionも回帰なし。

**※上記の「対策」は誤りだったことが後に判明した（実際の合計は37,572円で、103,092円は
合計・小計・明細の二重計上による架空の値）。詳細と訂正は本ログの上のエントリを参照。**

## 2026-07-13 MF証憑OCR: 「OCR結果の解析に失敗しました」の原因調査用ログ追加＋JSON修復強化

ユーザー報告: 「オークション志木_20260710_ver1_精算書.pdf」（消化仕入/委託販売の精算書）を
mf-evidence.htmlで手動OCRしたところ「OCR失敗: OCR結果の解析に失敗しました」になり、
取引日・金額・取引先が空欄のまま。実際のOpenAI応答テキストがどこにも記録されておらず、
原因を特定する手がかりが一切無かった。

**根本原因の当たり**: LLMがJSON文字列値の中に生の改行/タブをそのままエスケープせず出力すると、
それだけで`JSON.parse`が失敗する（精算書のような長文・複数行書類でありがち）。旧`extractJson`
（services/openai-ocr.js、pages/mf-evidence.jsのmfRunOcrもこれを共有）はコードフェンス除去・
末尾カンマ除去しか試みておらず、この種の壊れ方には無力だった。

**対策**:
- `ribreRepairJsonControlChars`を追加（services/openai-ocr.js）。エスケープ考慮でJSON文字列内
  かどうかを追跡し、文字列内の生の改行/復帰/タブだけを`\n`/`\r`/`\t`に修復してから再度
  `JSON.parse`を試す。`extractJson`の最終フォールバックとして追加（window.ribreExtractOcrJson
  経由でmf-evidence.jsのmfRunOcrにも自動的に効く）
- それでも解析できない場合は`console.error`で生の応答テキストを残す（従来は完全に握りつぶして
  いた。次回同じ失敗が起きたら、ブラウザのdevtoolsコンソールで実際にモデルが何を返したか
  確認できる）
- サーバー側（api/mf/ingest-mail.js、メール自動取込のOCR）の`extractOcrJson`も同水準に強化。
  従来はコードフェンス除去のみで前後の説明文にも生改行にも対応できていなかった。同じ
  `repairJsonControlChars`ロジック＋前後の説明文除去（最初の`{`〜最後の`}`抽出）＋
  console.error診断ログを追加（Vercelのファンクションログで確認可能）

**テスト**: ブラウザ実機でribreExtractOcrJsonの5パターン（正常/文字列内生改行/前後説明文/末尾
カンマ+生タブ混在/真に解析不能）を確認、いずれも意図通り（真に解析不能な場合のみnull＋
console.error記録）。サーバー側extractOcrJsonの統合テスト3パターン（生改行修復・前後説明文
除去・真に解析不能でも承認待ちとして台帳に残ること）全パス。既存73assertionも回帰なし。

**残る制約**: 今回の実例（オークション志木の精算書）が実際に生改行由来だったかは、ログが
無かった時点の失敗のため確定できない。次に同じ失敗が起きたら、ログに残る生の応答を見れば
断定できる。

## 2026-07-12 (続き) MF証憑インボックス: 「送信」時点で未確定ならMFへ送らず見つかるまで待つ（完全手動フォールバック）

前回の対策（送信直前にtrySingleMatchで一度だけ確認）をさらに一歩進め、送信時点で
見つからなくても即座に未紐付け送信せず、見つかるまでMFへは一切送信しないように変更。
ユーザーの提案「送信前の状態にしておいて、税理士が登録したあとにマッチングすればいい」
を採用。当初は「1〜2日待って自動フォールバック」案も実装したが、ユーザーの明示選択
（「無くして完全に手動にする」）により自動フォールバックは削除し、無期限待機＋手動対応に
確定した。

**新ステータス `awaiting_match`（マッチ待ち）を追加（要`supabase_mf_awaiting_match.sql`）**:
- `mf_evidence.approved_at`列を追加（「いつマッチ待ちになったか」の表示用。時間判定には使わない）。statusのCHECK制約に`awaiting_match`を追加（動的に既存制約名を探して置換。冪等）

**送信フロー変更（api/mf/evidence-action.js の handleResend・api/mf/vouchers.js）**:
- 送信時点でtrySingleMatchが見つかれば、従来通り最初から添付済みで1回だけ送信（変更なし）
- 見つからない場合、**MFへは一切送信せず**`status='awaiting_match'`で保留するだけに変更（以前は即座に未紐付けでbox_saved送信していた）
- `handleDelete`は`awaiting_match`も削除可能な状態に追加（まだMFへ何も送っていないため）

**日次リトライ（api/mf/_lib/mf-match-core.js の processAwaitingMatch。新規）**:
- `awaiting_match`の証憑をまとめて取得し、完全一致(±0日)で判定。見つかれば1回のPOSTで添付済み送信（二重アップロードなし）
- 見つからなければ`still_waiting`のまま**無期限に待機**（自動フォールバックは意図的に無し。長期間見つからない証憑はユーザーが台帳から手動対応する運用）
- `api/mf/auto-match.js`（日次cron）・`api/mf/match.js`（手動「マッチング実行」）の両方から呼ばれる

**フロント（pages/mf-evidence.js）**: `mfStatusLabel`に「マッチ待ち」追加。送信成功時のメッセージを「MFへ送信しました（自動添付）」/「登録しました。仕訳が見つかり次第、自動でMFへ送信されます」で出し分け。マッチング実行結果に awaiting_match の集計（自動添付/様子見中の件数）を追加表示

**ダッシュボード（pages/app-v2.js）**: 「マッチング未処理」件数の集計クエリを`status=eq.box_saved`から`status=in.(box_saved,awaiting_match)`に拡張（awaiting_match中の証憑も未処理として正しくカウントされるように）

**運用上の注意（ユーザー選択の代償）**: 自動フォールバックが無いため、税理士が仕訳を登録しない限り証憑は`awaiting_match`のまま**永久にMFへ送信されない**。電帳法対応のストック漏れリスクはユーザー側で運用管理する前提（長期未マッチの証憑を台帳で定期確認する等）

**ドキュメント更新**: `docs/MF_SETUP.md`（接続テスト手順・cronの動作説明）、`CLAUDE.md`（制約10として追記）

**テスト**: Node単体テスト5グループ30assertion（trySingleMatch/handleResend統合/processAwaitingMatch/vouchers.js統合。マッチ即添付・無期限待機・approved_at欠損・明示journal_id指定を含む）全パス。既存43assertionも回帰なし。ブラウザ実機でawaiting_matchのバッジ表示・ボタン出し分け・マッチング結果表示を確認、コンソールエラーなし。

## 2026-07-12 MF証憑インボックス: 「MFへ送信」後にマッチングすると二重アップロードされる問題を軽減

**原因（MF側APIの構造的制約。openapi.yamlで確認済み）**:
- `POST /api/v3/vouchers` は呼ぶたびに必ず新規ファイルを作成する。既存アップロード済みファイル(file_id)を後から仕訳に紐付ける方法は無い（`file_data`の再送信のみ）
- `DELETE /api/v3/vouchers` は「既に仕訳に紐付いているファイルの紐付け解除」専用（journal_id必須）。未紐付けのままBoxに置かれているファイル単体を削除する手段は無い
- そのため従来の「①MFへ送信＝未紐付けでBoxへ送る（box_saved）→②後でマッチングして仕訳へ添付」という2段階の流れは、両方実行すると必ずBoxに同一内容のファイルが2件残る（片方は永久に未紐付けのまま）。API側にクリーンアップ手段が無いため、コード側だけでは完全解消不可

**対策（api/mf/_lib/mf-match-core.js・api/mf/evidence-action.js・pages/mf-evidence.js）**:
- `trySingleMatch({accessToken, evidence})`を追加。runAutoMatchの完全一致(±0日・金額一致)と同じ確度でその場判定し、ちょうど1件に絞れればjournal_idを返す（外貨建て・日付未読取は対象外）
- `handleResend`（「MFへ送信」ボタン）は送信直前にこれを呼び、見つかればその場で`journal_id`付き・`status:'attached'`として1回のPOSTで送信（＝二重アップロードなし）。見つからなければ従来通り未紐付け(`box_saved`)で送信し、後日のマッチングに委ねる（この場合のみ従来と同じ制約が残る）
- フロントの送信成功トーストを「MFへ送信しました（仕訳に自動添付されました）」/「MFへ送信しました」に出し分け

**残るリスク**: 送信時点でMF側にまだ仕訳が存在しない場合（証憑がMF側の記帳より先に届くケースは多い）は従来通りbox_saved経由になり、後日マッチングで添付すると引き続き2件になる。MF側の`DELETE /api/v3/vouchers`がjournal_id必須のため、未紐付けファイルの自動削除は不可能。**手動でMFのBox画面から片方を削除する運用は今後も必要**。

**テスト**: Node単体テスト2グループ12assertion（trySingleMatchの完全一致/0件/外貨除外/日付なし/取引先名絞込み/絞れず、handleResendの一括統合テスト2パターン）全パス。既存29assertionも回帰なし。ブラウザ実機でトースト分岐確認、コンソールエラーなし。

## 2026-07-09 MF証憑インボックス: 外貨誤認識・重複取込・マッチング原因不明の解消

**外貨誤認識（api/mf/ingest-mail.js・api/mf/vouchers.js・pages/mf-evidence.js・api/mf/_lib/mf-match-core.js・supabase_mf_currency.sql）**:
- OCRスキーマに`currency`（ISO4217、判別不能ならJPY）を追加。ドル建て請求書(Anthropic等)の数値がそのまま円として保存・表示・マッチングされていた根本原因。新列`mf_evidence.ocr_currency`（デフォルトJPY・要SQL実行）に保存。
- 台帳の金額表示は`ocr_currency!=='JPY'`のとき「11 USD」のように通貨コード付きで表示（従来は常に「◯◯円」）。ファイル名にも通貨コードを付与（`_11USD`等）。
- マッチングは`ocr_currency!=='JPY'`の証憑を`findCandidates`/`findFuzzyCandidates`（金額比較あり）の対象から除外し、既存の第三段`findVendorDateCandidates`（取引先名+日付±7日・金額不問。外貨建て向けに元々設計済みだった）のみに委ねる。手動送信時は円換算していない旨のconfirmダイアログを追加。
- `ocr_currency`列が無い/空の既存データはJPY扱いで後方互換（`isJpyEvidence`）。

**重複取込（api/mf/ingest-mail.js）**:
- 既存のcontent_hash（添付バイト列のSHA256）完全一致チェックに加え、`findRecentSemanticDup`を追加。24時間以内に同じ取引日・金額・通貨・取引先名（NFKC正規化）の行が既にあれば重複とみなしStorage保存前に打ち切る。Anthropicが承認用に内容同一・バイト列だけ異なるPDFを複数通送るケース（content_hashをすり抜ける）に対応。取引先名が読めた場合のみ判定（誤爆防止）。

**マッチング「該当なし」の原因可視化（api/mf/_lib/mf-match-core.js・pages/mf-evidence.js）**:
- `unmatched`配列を証憑idの羅列から`{evidence_id, file_name, ocr_date, ocr_amount, ocr_currency, ocr_vendor, reason}`へ拡張。reasonは`no_ocr_date`/`no_journal_in_window`（検索期間±7日に仕訳が1件も無い）/`no_ocr_vendor`/`no_candidates`/`attach_failed`を判別。
- フロントは件数だけでなく証憑ごとに理由を画面表示（従来はconsole.log頼み）。ブックオフ2件がなぜ「該当なし」になるかは実際のMF仕訳データが見えないと断定できないため、このログを見れば「検索期間に仕訳が無い」のか「あるが不一致」のかをユーザー自身が即座に判別できるようにした（コード上のバグは見つからなかった。第三段の取引先名+日付マッチは既に実装済みで意図通り機能している）。

**テスト**: Node単体テスト14グループ25assertion（OCR結果の通貨保存・ファイル名・重複判定の正常系/誤爆防止4パターン・findCandidates系の通貨スキップ・後方互換・診断理由3パターン）全パス。ブラウザ実機: ヘルパー関数群・マッチング結果の理由表示・台帳の通貨表示、コンソールエラーなし。全JS `node --check` OK。

**要Supabase SQL実行**: `supabase_mf_currency.sql`（`mf_evidence.ocr_currency`列追加。冪等）

**追記(同日): マッチング日付ウィンドウの拡張（api/mf/_lib/mf-match-core.js）**:
- ブックオフの実例（購入日と仕訳計上日にズレがある疑い）を受け、クレジットカード購入は「利用日」と「仕訳計上日」が数週間〜1ヶ月以上ずれうるため、`VENDOR_DATE_MARGIN_DAYS`（取引先名+日付マッチ。金額不問・自動添付なし・提案のみ）を7日→**45日**に拡張。`MARGIN_DAYS`（仕訳取得ウィンドウ全体）も45日に合わせて拡張（狭いままだと拡張した45日ぶんの仕訳がそもそも取得されないため）。`FUZZY_MARGIN_DAYS`（完全一致0件時の日付緩和・金額は厳密一致のまま）も3日→14日に拡張。
- テスト: 領収書日付から30日後に計上された同一取引先の仕訳が、拡張後は候補(ambiguous)として拾われることを確認（拡張前の7日設定では該当なしになっていたケース）。全29assertion（15グループ）でパス。

## 2026-07-08 セキュリティ修正: MF OAuth保護／Storage RLS所有者照合／削除・同期の誤表示修正／大量削除ガードの追跡保持

**MF OAuth（api/mf/auth/start.js・callback.js・status.js・pages/mf-evidence.js・pages/app-v2.js）**:
- start: GET限定＋ログイン必須（verifySupabaseToken）。任意の`MF_ADMIN_EMAILS`（カンマ区切り）で管理者限定可。stateはHMAC署名付き（鍵=MF_CLIENT_SECRET・有効10分・crypto.randomBytes）で、HttpOnly/Secure/SameSite=Lax Cookie（Path=/api/mf/auth）にも保存。
- callback: GET限定。Cookie一致＋HMAC＋期限をtimingSafeEqualで検証し、不正stateではトークン交換・保存を行わない（`mf_error=state_invalid`）。Cookieは成功・失敗どちらでも削除。
- status: GET限定＋ログイン必須。フロント2箇所（mf-evidence.js/app-v2.js）にAuthorizationヘッダー付与。

**Storage RLS（supabase_tax_docs.sql・supabase_tax_share.sql — 要Supabase SQL Editor実行）**:
- 共有Supabaseプロジェクト（SELKURA等が同居）のため「authenticated全開放」は他アプリのユーザーが税務書類を読める・消せる状態だった。`owner = auth.uid()` OR パス先頭`= auth.uid()` の所有者照合に変更。既存ファイルはStorageのowner列で互換（移行不要）。新規アップロードは `<uid>/YYYY-MM/...` パス（appvTaxDocsBuildKey）。tax-shareのマニフェストupdate/deleteも所有者限定。

**税理士共有の再設計（pages/app-v2.js・pages/tax-share.js・api/mf/evidence-action.js）**:
- 1年有効の署名URL一覧をマニフェストに置く方式を廃止。公開ページは `/api/mf/evidence-action` の `action='tax_share_list'`（ログイン不要・共有トークン照合・インデックスにあるキーのみ）から**24時間**署名URLをその場で受け取る。共有解除（token墓標化のクラウド同期）で新規アクセスは即停止。旧リンク（#u=&t=）は旧マニフェスト→v2ポインタ→API の順にフォールバックし互換維持。解除ダイアログに「取得済みURLは期限まで残る」旨を明記。

**削除・同期の誤表示（pages/app-v2.js）**:
- appvTaxDocsDelete: Storage DELETEの結果を確認（okまたは404のみ削除扱い。401/403/5xx/通信例外ではインデックス変更せず具体的エラー表示）。
- appvTaxDocsUpload/Rename/Delete: インデックスのクラウド同期を`appvTaxDocsPushTracked`で評価。失敗時は`ribre_tax_docs_dirty_v1`に記録し「クラウド同期は失敗：あとで自動再試行します」を表示、描画時（appvRenderTaxDocs→appvTaxDocsSyncRetry）に自動再試行。キー単位のインデックスのため再試行で重複しない。

**大量削除ガード（services/data-store.js・pages/app-simple.js）**:
- reconcile: ガードでスキップした削除のclient_idを同期基準（ribre_store_synced_v1）に残す＝次回も削除候補として再検出される（従来は基準から消えて追跡が失われ、hydrateで復活していた）。ステータスは「保存OK（ただし削除N件は保留中）」と明示。
- pushSafe({allowMassDelete})を追加し、手動保存（legacy.htmlの💾）でpendingDeletes>0のとき件数つきconfirmで承認→削除込み再実行。自動保存は常に保留のまま（安全側）。
- 既知の限界: 承認前にhydrateすると削除対象がローカルに復活する（クラウド優先の既存設計。恒久対策はtombstone化が必要）。

**テスト**: APIハンドラ14グループ（Node・fetchスタブ）＋ブラウザ検証（403削除・同期失敗・dirty再試行・ガード保留→承認削除・1件追加/削除回帰・共有更新/解除・新旧リンク互換）全パス。全JS `node --check` OK。主要HTML6枚 200・コンソールエラーなし。

## 2026-07-03 Phase3: ±3日緩和マッチ／証憑カバー率メーター／月次Slackレポート

**追加ファイル**:
- `api/mf/_lib/mf-journals.js` — 仕訳取得(`fetchJournals`)・税込金額計算(`journalAmount`)・摘要抽出(`journalSummaryText`)・日付加算(`addDays`)の共通ヘルパー。coverage.js/monthly-report.js から使用。match.js自体は既存実装のまま変更していない（重複はあるが本番稼働中ロジックへの影響を避けた）。
- `api/mf/_lib/mf-coverage.js` — `computeCoverage({accessToken, month})` で指定月(省略時は当月)の仕訳を取得し、`voucher_file_ids`の有無でカバー率を集計。missingは日付昇順で最大50件。
- `api/mf/coverage.js` — `GET /api/mf/coverage?month=YYYY-MM`。verifySupabaseTokenでログイン必須。
- `api/mf/monthly-report.js` — `GET /api/mf/monthly-report`。Vercel Cron（`Authorization: Bearer CRON_SECRET`）またはログインユーザーのどちらかで認証。当月カバー率＋`mf_evidence.status='box_saved'`件数を集計しSlack Incoming Webhookへ日本語メッセージを送信。`SLACK_WEBHOOK_URL`未設定時は`{ok:false, error:'slack_not_configured'}`を200で返す（クラッシュさせない）。

**変更ファイル**:
- `api/mf/match.js`: `findCandidates`（完全一致）に加え`findFuzzyCandidates`を追加。完全一致が0件のときのみ、ocr_dateの±3日以内・税込金額一致の仕訳を検索し、見つかれば自動添付せず全件を`ambiguous`（`fuzzy:true`付き）として返す。完全一致が1件以上あるときは従来通り緩和検索はしない。
- `vercel.json`: `crons`に`/api/mf/monthly-report`を毎月28日0:00 UTC実行する設定を追加。既存の`routes`は変更なし。
- `mf-evidence.html`: 「仕訳マッチング」パネルの下に「証憑カバー率」パネル（月選択・集計ボタン・メーター・証憑なし仕訳一覧・Slack送信テストボタン）を追加。
- `pages/mf-evidence.js`: `mfRenderAmbiguous`にfuzzy注記表示を追加。`mfRunCoverage`/`mfRenderCoverageMeter`/`mfRenderCoverageMissing`/`mfSendSlackTest`を新規追加。DOMContentLoadedで対象月inputに当月を初期セット。
- `styles/mf-evidence.css`: `.mf-meter-wrap`/`.mf-meter-bar`/`.mf-missing-table`/`.mf-missing-row`/`.mf-missing-head`を追加。
- `docs/MF_SETUP.md`: 「5. Phase3」節を追記（SLACK_WEBHOOK_URL/CRON_SECRETの設定手順、Cronの動作、カバー率の見方）。

**判断した点**:
- match.js内の`fetchJournals`等を`_lib/mf-journals.js`へ切り出して共用する案もあったが、match.jsは直近の本番デバッグ対象で「必ず流用する」指示があったため、match.js自体の実装・エクスポート形は一切変更せず、coverage.js/monthly-report.js側だけが新設の共通libを使う設計にした（重複コードは残るがリスクを避けた）。
- カバー率の「証憑あり」判定は`voucher_file_ids.length > 0`のみを見ている。自動マッチ添付・手動添付・MF本体からの直接添付のいずれも区別せず「あり」として扱う。
- Cronのタイムゾーンは0 0 28 * *（UTC）とした。日本時間では28日9:00頃の実行になる。

**node --check結果**: `api/mf/match.js` `api/mf/_lib/mf-journals.js` `api/mf/_lib/mf-coverage.js` `api/mf/coverage.js` `api/mf/monthly-report.js` `pages/mf-evidence.js` すべてOK。`vercel.json`は`JSON.parse`で妥当性確認済み。

**未実施**: `SLACK_WEBHOOK_URL`/`CRON_SECRET`のVercel環境変数設定、実機でのSlack送信テスト、本番デプロイ。

---

## 2026-07-03 — MF証憑連携 Phase2: 登録済み仕訳への自動マッチング添付＋PDF OCR対応

**背景**: Phase1で証憑をMFのBoxへ送信するところまでは実装済みだったが、登録済み仕訳への添付は
手動（送信時にjournal_idを指定する場合のみ）に限られていた。Phase2として、Box保存済みの証憑を
MF会計の仕訳一覧と自動照合し、日付・金額が一致する仕訳へ自動添付する機能を追加。あわせて
PDF証憑がOCR時に`unsupported MIME type`エラーになっていた不具合も解消した。

**追加ファイル**:
- `api/mf/match.js`（284行）— `POST /api/mf/match`。自動モード（ボディ空）でbox_saved証憑を仕訳と
  自動マッチング・添付。手動確定モード（`{evidence_id, journal_id}`）で候補複数時の確定添付にも対応。
- `supabase_mf_storage.sql`（15行）— Supabase Storageバケット`mf-evidence`作成SQL（service role専用、
  RLSポリシーは意図的に未作成）。

**変更ファイル**:
- `api/mf/vouchers.js`（190行）— MF送信成功後、同じファイルbytesをSupabase Storage
  (`mf-evidence`バケット)へ控え保存し`storage_path`をmf_evidenceにINSERTする処理を追加。
  Storage保存失敗時もMF送信自体は成功として扱う（fail-safe、`storage_path`はnullのまま）。
- `pages/mf-evidence.js`（480行）— (1) `mfRunOcr()`のPDF分岐を修正。従来PDFもdata URLを
  `input_image`として送っておりOpenAIがMIMEエラーを返していたが、既存の`services/openai-ocr.js`
  `uploadOpenAIFile()`を流用してOpenAI Files APIへアップロードし`input_file`+`file_id`で渡す方式に変更
  （画像はこれまで通り`input_image`のまま）。(2) 「仕訳マッチング」パネルの制御関数
  (`mfRunMatch`, `mfRenderAmbiguous`, `mfConfirmMatch`等)を追加。摘要等はtextContentで描画しXSSを回避。
- `mf-evidence.html`（87行）— 台帳リストの上に「仕訳マッチング」パネル（マッチング実行ボタン・
  結果サマリー・候補複数時の選択UI）を追加。

**openapi.yaml (https://developers.api-accounting.moneyforward.com/v3/openapi.yaml) で確認した仕様**:
- `GetJournalsResponse`: `{metadata:{total_count, total_pages}, journals:[JournalItem]}`。
  `JournalItem.branches[]`は`{remark, creditor:JournalLineDetails, debitor:JournalLineDetails}`の配列で、
  各`JournalLineDetails.value`が金額(integer)。1仕訳の金額は「各branchのdebitor.valueの合計」として算出
  （貸借は各branch内で同額のためdebitor側のみ合計すれば仕訳合計に一致する）。
- ページネーションは`page`(1始まり)/`per_page`(最大10000, デフォルト10)のクエリパラメータ方式。
  `metadata.total_pages`が尽きるまでページを進める（`match.js`では`per_page=200`で実装）。
- `JournalItem.voucher_file_ids`は文字列配列（file_idの配列。`{file_name,file_id}`オブジェクトではない点に注意。
  これは`PostVouchersResponse.voucher_file_ids`との違い）。

**マッチング判定ロジック（`api/mf/match.js`）**:
1. `mf_evidence`から`status='box_saved'` かつ `storage_path is not null`の行を取得
2. 対象証憑群の`ocr_date`最小〜最大の前後±3日で`GET /api/v3/journals`をページ送りしながら全件取得
3. 各証憑について`transaction_date`一致 かつ 仕訳金額一致（除外条件: `voucher_file_ids`が5件以上、
   または既に同一`mf_file_id`を含む）で候補仕訳を絞り込み
4. 候補ちょうど1件→Storageからファイル取得しbase64化→`postVoucher()`で添付→
   `mf_evidence`を`status='attached', journal_id, mf_file_id`に更新。複数→ambiguousとして返却
   （候補一覧の日付/金額/摘要を添える）。0件→unmatched。
5. 同一実行内で二重添付を避けるため、添付が決まった仕訳の`voucher_file_ids`をメモリ上でのみ
   マーカー追加し、後続証憑の候補判定から除外する簡易ガードを入れている。

**node --check結果**: `api/mf/vouchers.js` / `api/mf/match.js` / `pages/mf-evidence.js` すべてOK。

**判断が必要だった点・実装できなかった点**:
- MF会計APIには「Box内の既存ファイルを後から仕訳に紐づける」専用APIが存在しないため、
  マッチング添付は指示どおりStorageに控えたファイル本体を`POST /api/v3/vouchers`で再送する方式とした
  （Box上には同じファイルが二重に残る形になるが、MF側の仕様上これ以外の方法がない）。
- 自動マッチング中に同一仕訳へ複数証憑が同時にマッチしてしまうケース（同日・同額の証憑が複数ある場合）は、
  実行順に処理し先に添付が決まった証憑をメモリ上でのみ仕訳の`voucher_file_ids`に反映して以降の判定から
  除外しているが、これは同一リクエスト内のみのガードであり、次回実行時にMF側の実データで
  `voucher_file_ids`が更新されている前提に依存する。極端に大量の同額同日証憑がある場合は
  ambiguous判定で人手確認に回る設計とした。
- ローカルにMF/Supabase実認証情報がなく、`vercel dev`等での実機E2E確認は未実施
  （静的ファイルサーバーのプレビューのみで、`/api/mf/*`は未検証。デプロイ後の実機確認が必要）。

---

## 2026-07-03 — OpenAI OCR呼び出しをサーバー経由プロキシへ移行（APIキーのブラウザ露出を解消）

**背景**: ブラウザ側JSがOpenAI APIキーを `localStorage`（`ribre_openai_key200`）に平文保存し、
`https://api.openai.com` を直接叩いていたため、開発者ツール/ネットワークタブでAPIキーが丸見えだった。
Vercel Serverless Functions経由に変更し、キーはサーバー側環境変数のみで保持するようにした。

**追加ファイル**:
- `api/openai/responses.js`（92行）— `POST /api/openai/responses`。ブラウザのリクエストボディをほぼそのまま
  `https://api.openai.com/v1/responses` へ転送。`Authorization`はサーバー側で付与。10MB超は413、
  `OPENAI_API_KEY`未設定は500 `{error:'server_not_configured'}`。
- `api/openai/files.js`（103行）— `POST /api/openai/files`。`{purpose, file_name, file_data(base64), content_type}`
  を受け取り、Node18標準の`FormData`/`Blob`で`multipart/form-data`に組み立てて
  `https://api.openai.com/v1/files`へ転送（追加パッケージなし）。
- `docs/OPENAI_SETUP.md`（27行）— `OPENAI_API_KEY`環境変数の設定手順・未設定時の挙動・動作確認手順。

**変更ファイル**:
- `pages/mf-evidence.js` `mfRunOcr()` — APIキーのlocalStorage参照・未設定チェックを削除し、
  `fetch('/api/openai/responses', {headers:{'Content-Type':'application/json'}})` に変更。
  `server_not_configured`時は「OCR機能が利用できません（管理者に連絡してください）」を表示。
- `pages/ocr-engine.js` `ver500OpenAiAnalyze()` — 同様にAPIキー取得処理を削除し `/api/openai/responses` 経由に変更。
- `services/openai-ocr.js` `uploadOpenAIFile()` — 引数から `key` を削除。データURLから取得したBlobを
  base64化して `/api/openai/files` にJSON POSTする形に変更（署名変更のため呼び出し元 `runOcr()` も追随）。
- `services/openai-ocr.js` `runOcr()` — APIキー未設定チェックを削除、`/api/openai/responses` 経由に変更。
- `index.html` — 設定画面のOpenAI APIキー入力欄・保存ボタンを削除し、
  「OpenAI APIキーはサーバー側で管理されています（設定不要）」という説明文に置き換え。
- `pages/settings.js` / `services/app-main-v2.js` — 重複定義されていた `saveOpenAI()` を両方とも削除
  （`app-main-v2.js`側は `window.saveOpenAI` エクスポートは元々無し、`settings.js`側のエクスポートも削除）。
  `app-main-v2.js` の `refreshTop()` 内のAPIキー保存有無ステータス表示を、
  サーバー管理前提の固定文言「サーバー管理」に変更。
- `services/core.js` — `LS.openai` 定数は既存参照コードとの互換のため削除せず維持（新規保存は行わない）。

**確認**: `grep -rn "api.openai.com" pages/ services/` は0件（プロキシ側の `api/openai/*.js` のみに残存）。
`node --check` は変更・新規作成した全JSファイルで成功。

**判断が必要だった点**:
- `uploadOpenAIFile()` は元々ブラウザで直接blobをFormData化していたため、プロキシ越しにするには
  一度base64化してJSONで送る形に変える必要があった（サーバー側 `api/openai/files.js` で再度Blob化）。
  既存のOCRプロンプト・レスポンス解析ロジックには手を入れていない。
- `OPENAI_API_KEY` 未設定時のエラーメッセージ文言は、指示にあった
  「OCR機能が利用できません（管理者に連絡してください）」をそのまま採用。

**環境変数**（未設定・要Vercel側で追加）: `OPENAI_API_KEY`

---

## 2026-07-03 — マネーフォワード会計API連携 バックエンド実装

**背景**: 別セッションで先行実装されたフロントエンド（`mf-evidence.html` / `pages/mf-evidence.js`）が
呼び出す `/api/mf/*` エンドポイントとSupabaseテーブルが未実装だったため、Vercel Serverless Functionsとして実装。

**追加ファイル**:
- `api/mf/_lib/mf-client.js`（181行）— 共通クライアント。Supabase `mf_tokens`（id=1固定1行）でトークン管理、
  5分以内期限切れならrefresh_tokenで自動更新、authorization code⇔token交換、証憑POST処理。
- `api/mf/status.js`（16行）— `GET /api/mf/status`。`{connected: boolean}`を返す。
- `api/mf/auth/start.js`（26行）— `GET /api/mf/auth/start`。MF認可URLを`{url}`で返す（state検証は未実装、コメントで明示）。
- `api/mf/auth/callback.js`（33行）— `GET /api/mf/auth/callback?code=`。トークン交換しmf_tokensへ保存、
  `/mf-evidence.html?connected=1`（失敗時`?mf_error=token_exchange_failed`）へ302リダイレクト。
- `api/mf/vouchers.js`（155行）— `POST /api/mf/vouchers`。file_data必須・base64デコード後5MB以下・
  file_name 255文字以下を検証→MF証憑API送信→成否をSupabase `mf_evidence`へINSERT。
- `supabase_mf_evidence.sql`（65行）— `mf_tokens`（RLS有効・ポリシー無し=service roleのみ）、
  `mf_evidence`（認証済みユーザーselect/insert可、status check制約）。
- `docs/MF_SETUP.md`（48行）— MFアプリポータル登録手順・Vercel環境変数・SQL適用・接続テスト手順。

**変更ファイル**:
- `vercel.json` — 既存の `routes` はcatch-all `{"src":"/(.*)","dest":"/$1"}` のみで
  `"handle":"filesystem"` フェーズが無く、新設した `api/mf/*` サーバーレス関数がfilesystem/function解決より先に
  catch-allに飲まれる懸念があったため、`{ "src": "/", "dest": "/index.html" }` の直後に
  `{ "handle": "filesystem" }` を追加した。既存のSPAフォールバック（catch-all）自体はそのまま維持。

**確認したMF OAuthエンドポイント**: WebFetchで開発者ポータル（developers.biz.moneyforward.com配下）の
authorize/tokenの具体URLを直接確認できなかったため、`api/mf/_lib/mf-client.js` 内に暫定値
（`https://api.biz.moneyforward.com/authorize`, `.../token`）をTODOコメント付きで定数化した。
本番接続前に公式ドキュメントでの再確認が必要。証憑APIのベースURL
`https://api-accounting.moneyforward.com` はopenapi.yamlのserversセクションで確認済み。

**環境変数**（未設定・要Vercel側で追加）: `MF_CLIENT_ID`, `MF_CLIENT_SECRET`, `MF_REDIRECT_URI`,
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

**未実施**: `supabase_mf_evidence.sql`の実適用、Vercel環境変数設定、実機での接続テスト、デプロイ。

---

## 2026-07-03 — マネーフォワード証憑インボックス新規ページ追加

**背景/依頼元**: 別セッション（auction_tool_v138側）から、ribre-sales-system に対して
「マネーフォワード証憑インボックス」ページの実装を依頼された。バックエンド（/api/mf/* エンドポイント、
Supabase mf_evidence テーブル）は別エージェントが並行実装中という前提で、フロントエンドのみ担当。

**追加ファイル**:
- `mf-evidence.html` — 独立ページ。ヘッダーにMF接続ステータス、貼り付け/D&Dゾーン、OCRプレビュー編集フォーム、台帳リストを配置。
  既存の signIn()/signOut()/auth-gate.js が参照する非表示の `#email`/`#password`/`#role`/`#settingsList` を用意し、
  index.html を経由しない単独ページでも共通ログイン処理がエラーなく動くようにした。
- `pages/mf-evidence.js` — ページ本体ロジック（貼り付け/D&D受付、5MB・PNG/JPG/PDF制限、OpenAI OCR呼び出し、
  ファイル名自動生成、重複警告、`/api/mf/vouchers` `/api/mf/status` `/api/mf/auth/start` 呼び出し、台帳一覧描画、トースト通知）。
- `styles/mf-evidence.css` — ドロップゾーン・台帳行・ステータスバッジ・トーストの専用スタイル。

**変更ファイル**: なし（index.html・vercel.json・既存servicesは未変更、読み取りのみ）

**流用した既存関数**:
- `services/core.js`: `escHtml`, `sb`, `sess`, `email`, `LS`, `today`, `num`, `yen`, `renderList`, `safeLevel`
- `services/supabase-rest.js`: `restUrl`, `restHeaders`（mf_evidence テーブルへの直接REST読み取りに流用）
- `services/openai-ocr.js`: `window.ribreOptimizeOcrImage`, `window.ribreExtractOcrJson`, `window.ribreNormalizeOcrSchema`
- `services/auth-gate.js`: そのまま読み込み、ログインオーバーレイをこのページにも適用

**判断した点**:
- `services/app-main-v2.js` と `pages/app-simple.js` は `window.addEventListener('load', ...)` 内で
  index.html 固有のDOM要素（`#sbUrl` 等）を無条件参照しており、mf-evidence.html にそのまま読み込むと
  ロード時にJSエラーになるため、あえて読み込み対象から除外した（Googleログインボタンは
  `smpGoogleLogin` 未定義時のフォールバックメッセージが auth-gate.js 側に既にあるため問題なし）。
- PDFファイルはOCR時に画像として最適化できないため、`ribreOptimizeOcrImage` をスキップし
  dataURLをそのまま画像入力としてOpenAIへ渡す実装とした（失敗時は手入力にフォールバック）。

**影響/前提**: バックエンドAPI（/api/mf/status, /api/mf/auth/start, /api/mf/vouchers）と
Supabaseテーブル mf_evidence が存在しない間はエラー表示（トースト/ステータス欄）にフォールバックする。
デプロイ・実機確認は未実施（バックエンド実装完了後に要確認）。

### 2026-07-03 追記（レビュー修正）
- `pages/mf-evidence.js`: `refreshAll()` 互換スタブを追加（supabase-auth.js の `signIn`/`signOut` が
  `refreshAll()` を呼ぶため、未定義だとゲートからのメールログインが成功してもエラー扱いになる不具合を修正）
- `mf-evidence.html`: 隠し要素 `#settingsList` を追加（`signIn` が `renderList('settingsList')` を呼ぶため必須）
- `styles/mf-evidence.css`: トースト（.mf-toast / .ok / .error）スタイルを追加
- `node --check pages/mf-evidence.js` → OK

## 2026-07-03 レビュー修正（Fable 5 / コーディネータ）
- api/mf/vouchers.js: MFレスポンスの mf_file_id 抽出を修正（誤: mfResult.id / voucher_files[0].id → 正: voucher_file_ids[0].file_id、openapi.yaml PostVouchersResponse準拠）
- api/mf/_lib/mf-client.js: OAuth authorize/token URLのTODOコメントを確定値に更新（openapi.yaml securitySchemesで裏取り）

## 2026-07-03 相互リンク追加
- index.html: かんたんモード下部ナビに6個目「🧾証憑」を追加（/mf-evidence へ遷移、grid列数5→6）
- mf-evidence.html: ヘッダーに「← 売上管理へ」リンクを追加

## 2026-07-04 便利機能①〜⑤実装（Phase4）
- api/mf/_lib/mf-match-core.js: match.jsのマッチングコアを共通化＋摘要第二キー(NFKC正規化・部分一致で1件に絞れたら自動添付 via:'vendor')。取引先名はbranches[].debitor/creditor.trade_partner_nameからも取得
- api/mf/auto-match.js: 毎朝JST7時のcron自動マッチング(vercel.json crons追加)。結果があるときだけSlack通知
- api/mf/monthly-report.js: Chatwork送信対応(CHATWORK_API_TOKEN/CHATWORK_ROOM_ID)、?target=slack|chatwork|all
- supabase_mf_phase4.sql: box_meta_doneカラム＋authenticated update policy
- mf-evidence.html/js/css: 📷撮影ボタン、台帳フィルタ(月/検索/状態/Box入力待ち)、Box入力チェック列、クラウドBoxリンク、Chatworkテストボタン

## 2026-07-04 便利機能A〜D実装（機能別コミットでロールバック可能）
- ベースライン 3b7673f にPhase1〜4を固定後、A=e0355eb(失敗証憑の再送)、B=dd1bae3(月次レポートにBox入力待ち件数)、C=3a22ba6(メール請求書の自動取込 /api/mf/ingest-mail＋tools/gmail-ingest.gs)、D=eae207a(電子古物台帳 /kobutsu-ledger)
- 個別ロールバック: git revert <コミット> → vercel deploy --prod

## 2026-07-04 承認制化＋関数統合
- b8c999a: ingest-mailは pending 保存に変更（承認制）。台帳にMFへ送信/削除ボタン
- f12caee: resend+evidence-delete → evidence-action に統合（Vercel Hobby 12関数制限）

## 2026-07-04 追加分
- 20842e6/53eccf3: 台帳ファイル名クリックでモーダルプレビュー(非公開Storageをサーバー経由取得)、メール取込の拡張子保持
- e19abc5: 第三段マッチング(取引先名＋日付±7日・金額不問・候補提示のみ)。外貨建て請求書(Anthropic/OpenAI等のUSD)対応

## 2026-07-04 新UI Phase A（97c5637）
- /app に新UI追加（読み取り専用・既存UIと並行稼働・既存ファイル無変更）
- ホーム(実データKPI・やること・最近の取引)＋取引(統合台帳閲覧)。書込はPhase B
- ロールバック: git revert 97c5637 または単に / を使い続ければよい

## 2026-07-05 KPI集計修正（d36a639）
- app-v2のKPIを旧UI(smpProfitMonthTotals)と同一データ源に修正。経費=salesのfee+shipping_fee、明細=app_settings(profit_meisai)、当月仮入力=profit_prov

## 2026-07-05 Phase B（8adc160）
- /appに登録/編集/削除＋テンプレート。旧addSale/addPurchase互換・cid一意時のみ編集削除・削除前スナップショット

## 2026-07-05 Supabase salesドリフト調査（コード変更なし・調査資材のみ追加）

**背景/依頼元**: 07-05のKPIズレ調査(de6c0d3)で検知された「Supabase salesテーブルのドリフト」の規模と原因の特定タスク（auction_tool側セッションから依頼）。

**調査結果（確定）**:
- クラウドsales=6,420行はローカル(ribre_full_sales221)3,210行のちょうど2倍。
- 真因: 2026-07-01に旧UIの`smpUploadAllToCloud()`(app-simple.js)が**client_id無し**(`on_conflict=user_email,item_id`)で全行アップロード→data-store.jsのpushSafe(`on_conflict=user_email,client_id`)が同内容を`db_<id>`のcidで別行として再アップロードし倍化。null行はdata-store.jsの削除経路(cid指定)に乗らず永久残留。
- 検証: `client_id IS NULL`の3,210行(全て2026-07-01作成/source「かんたん」/id 1153236–1156445連番)は全てdb_行の内容重複。db_行3,210行はlocalStorageと全フィールド一致・欠落0・不一致0。purchasesはクラウド/ローカルとも0行で一致（仕入実データはapp_settingsの明細側）。

**追加ファイル**:
- `tools/drift-check-sales.browser.js` — 突合スクリプト（読み取り専用・404ページのコンソールで実行。アプリページで実行するとhydrateがローカルを置換するため不可）
- `supabase_cleanup_sales_null_cid.sql` — クリーンアップSQL（STEP1件数確認→STEP1b双子なし0件確認→STEP2でnull行削除）。**未実行**（ユーザー承認待ち）

**影響/前提**: 本体コードは無変更・デプロイなし。クリーンアップ実行はSupabase SQL Editorから手動（実行前にバックアップJSON保存）。再発防止として、smpUploadAllToCloudの廃止またはclient_id付与(data-store.jsのclientIdOfと同一規則)への統一を別途検討のこと。

## 2026-07-05 Supabase salesクリーンアップ実行（ユーザー承認済み・チェックポイント3点全通過）

**実行内容**: ログイン中ブラウザのセッション経由でREST DELETE `sales?user_email=eq.ribre2016@gmail.com&client_id=is.null` を実行（3,210行削除、HTTP 204、Content-Range */3210）。
**事前**: 削除対象行の完全バックアップを `C:\Users\ksado\Downloads\sales_null_cid_backup_2026-07-05.json`（3,210行・全24カラム・2.0MB）に保存し、ディスク上で整合検証済み。双子なし行（消すと失われる行）0件を再確認。
**事後検証**: クラウド3,210行＝ローカル3,210行、null行0、全フィールド一致（不一致0・欠落0）、月別合計もローカルと完全一致（2026-03〜06）。
**備考**: `supabase_cleanup_sales_null_cid.sql` は実行済みのため参照用。再発防止（smpUploadAllToCloudのclient_id統一or廃止）は未着手の別タスク。

## 2026-07-05 再発防止: smpUploadAllToCloudをseedFromThisPCへ委譲

**変更ファイル**: `pages/app-simple.js` — 初回移行`smpUploadAllToCloud()`の独自upsert(client_id無し・on_conflict=user_email,item_id)を廃止し、data-store.jsの`seedFromThisPC()`(clientIdOf規則のclient_id付き・on_conflict=user_email,client_id)へ委譲。data-store.js未読込時は移行を中止してエラーを返す（次回ログインで再試行）。未使用になった`smpBuildCloudBodies`/`smpMigStableId`/`smpMigPurchaseClientId`を削除。
**背景**: 07-01にこの経路がclient_id無しで全行アップロード→pushSafeが別行として再登録し全行倍化（07-05クリーンアップ済み）。conflictキーの不一致が根因のため、アップロード経路をdata-store.jsに一本化。

## 2026-07-05 明細方式化＋Phase C（6c0fd51, cd8ca7c）
- /app登録=profit_meisai互換の明細方式（行マージ・墓標・月ロック）＋取込画面（ヤフオクCSV/配送照合/メール状況）
**デプロイ**: 2026-07-05 dpl_EnMohNzQ2pBGJkdYK6HU1iCDTkxP を本番反映（https://ribre-sales-system.vercel.app）。配信中のapp-simple.jsにseedFromThisPC委譲あり・旧smpBuildCloudBodies無しを確認。

## 2026-07-05 監査修正＋仮入力（e827908/ae66bfc/87a3cc0/479d73d）
- 並び順=SMP_ACCS+order、商品ID表示、締め月保護、CSV再取込補完、当月仮入力パネル(prov互換)

## 2026-07-05 Phase D（37ba36f/6ade9ed/36e2160）
- 分析(グラフ/目標goals互換/構成比)・月締めチェックリスト([LOCK]互換)・設定(バックアップsmpFullBackup互換/同期)。新UI全画面完成

## 2026-07-05 取引「粗利」タブを年間グリッド化（f3660c3）
**変更ファイル**: `pages/app-v2.js` / `app.html` / `styles/app-v2.css`
- 旧UI(app-simple.js)の`simpleRenderProfitTable`/`smpProfitData`と同一式で、取引ページ「粗利」タブを月次サマリー表→年間グリッド(3月〜翌2月×12ヶ月＋年計)に置き換え。
- 行=仕入(明細ごと＋買取先ごと＋合計)／売上明細(明細ごと＋合計)／売上チャネル別(ヤフオク1〜8・メルカリ・メルカリShops・ラクマ＋その他＋合計)／売上合計／送料合計／手数料合計／粗利(マイナス赤)。
- 当月列は黄色ハイライト固定(`!important`)。チャネル(実数0のみ)・送料・手数料の当月空欄はクリックで仮入力→`appvProvSetOne`/`appvProvPushCloud`(既存profit_prov同期)に保存。
- 年度セレクタ(前後年度切替)を追加。データ取得は`appvFiscalMonths`/`appvGetMeisai`/`appvProvGet`/`APPV_SALES_CHANNELS`など既存関数を再利用し、`appvMonthTotals`と同じ集計ロジック(LS.sales/LS.purchases、明細除外)を年間分に拡張した新関数`appvProfitYearData`を追加。
- 検証: `node --check pages/app-v2.js`成功。式レベルでは仕入=vendor別+明細合算、売上=チャネル別(実数優先・当月のみ仮入力加算)+明細合算、粗利=売上−仕入−送料−手数料で旧UIと一致する構造であることを確認。

## 2026-07-05 分析強化A〜F（c6f8de9/0f1978b）
- 個数・平均単価/価格帯分布/日別推移+着地予測/手数料送料率/目標ペースメーカー/販売先ランキング（読み取り専用）

## 2026-07-05 取引ページに「売上CSVダウンロード」「送料だけコピー」を移植

**変更ファイル**: `pages/app-v2.js` / `app.html`
- 旧UI(index.html 1199-1200行目のボタン、実体はapp-simple.js `smpCopyShippingOnly`3194-3213行目 / `smpDownloadSalesCsv`3229-3242行目)の2機能を、新UI「取引」ページのフィルタ行(`#ledgerFilterRow`)に移植。
- CSV: 列構成`['日付','月','取込元','商品名','金額','手数料','送料','利益','商品ID','メモ']`・値・BOM付き(`csvDownload`はcore.js既存関数を再利用)は旧と完全一致。旧はアカウント/年月の絞り込みUIに連動してファイル名が変わるが、新UIの取引ページにはその絞り込みUIが無いため、常に旧の初期状態(絞り込みなし)と同じ「全アカウント・全期間」固定でファイル名`売上_全アカウント_全期間.csv`を出力。並び順は旧`smpSortByAccount`と同一規則(チャネル順→CSV取込順→添字)を流用する新関数`appvLedgerSalesRows`を追加。
- 送料コピー: 全件表示相当(acc='all')なので旧同様`ヤフオク1〜8・メルカリShops`のみに絞り込み、旧`smpSortShippingCopyRows`と同一規則で並べ替えた送料の数値だけを改行区切りで`navigator.clipboard.writeText`にコピー（失敗時はtextarea+`execCommand('copy')`フォールバック、旧と同一実装）。コピー件数をトースト表示。
- ボタンは「取引」タブが売上を含む場合(すべて/売上)のみ表示、仕入・粗利タブでは非表示（`appvUpdateLedgerSalesToolsVisibility`）。
- 検証: `node --check pages/app-v2.js`成功。静的HTTPサーバでapp.htmlを配信しボタン要素・初期非表示(`display:none`)を確認（このセッションのpreviewツールは別プロジェクトに紐付いており起動できなかったため、curlでの直接確認）。

## 2026-07-05 10体監査修正（43c480b/97c5231/7a1149b/d13458d）
- ヤフオクストア同期(手入力送料/編集/削除)・CSV取込ロック保護(スナップショット差し戻し)・明細/仮入力ローカル読み+起動時pull・migrate移植・目標月ごと単価・明細ロック撤去ほか

## 2026-07-05 入口切り替え完了
- 新UI=index.html(/)・旧UI=legacy.html(/legacy)・/app=互換スタブ。vercel.jsonのroutesは撤去(cleanUrls混在で無視されていた)
