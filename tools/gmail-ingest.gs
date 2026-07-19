/**
 * Gmail添付ファイル(請求書等)を ribre-sales-system の /api/mf/ingest-mail へ自動転送するスクリプト。
 *
 * 【設置手順】
 * 1. https://script.google.com で新規プロジェクトを作成し、このファイルの内容を貼り付ける
 * 2. 左メニュー「プロジェクトの設定」→「スクリプト プロパティ」に以下を追加
 *      INGEST_URL    = https://ribre-sales-system.vercel.app/api/mf/ingest-mail
 *      INGEST_SECRET = (Vercel環境変数 MAIL_INGEST_SECRET と同じ値)
 * 3. 左メニュー「トリガー」→「トリガーを追加」
 *      実行する関数: ingestInvoices
 *      イベントのソース: 時間主導型
 *      時間ベースのタイマー: 分ベースのタイマー → 15分おき
 * 4. 動作確認: 自分宛にPDF添付メールを送信 → エディタで ingestInvoices を手動実行
 *    → https://ribre-sales-system.vercel.app/mf-evidence.html の台帳に登録されることを確認
 * 5. 止めたいとき（ロールバック）: 上記トリガーを削除するだけでよい。コード自体は残してよい。
 */

'use strict';

var GMAIL_SEARCH_QUERY = 'has:attachment -label:MF取込済み newer_than:7d';
var PROCESSED_LABEL_NAME = 'MF取込済み';
var MAX_THREADS_PER_RUN = 10; // 1回の実行タイムアウト対策
var ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
// base64化すると元サイズの約4/3に膨張し、Vercelのサーバーレス関数はリクエストボディが
// 約4.5MBを超えると失敗する。3MB超の添付は送信しても必ず失敗し続けるため、
// ここでスキップしてラベルを付け、7日間毎回リトライされるのを防ぐ。
// 3MB超は手動で mf-evidence.html から登録する運用（同画面も同じ理由で3MBまで）。
var MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;

function ingestInvoices() {
  var props = PropertiesService.getScriptProperties();
  var ingestUrl = props.getProperty('INGEST_URL');
  var ingestSecret = props.getProperty('INGEST_SECRET');

  if (!ingestUrl || !ingestSecret) {
    Logger.log('INGEST_URL または INGEST_SECRET が未設定です。スクリプトプロパティを確認してください。');
    return;
  }

  var label = getOrCreateLabel_(PROCESSED_LABEL_NAME);
  var threads = GmailApp.search(GMAIL_SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var ok = processThread_(thread, ingestUrl, ingestSecret);
    if (ok) {
      thread.addLabel(label);
    }
    // 次回リトライに任せるため、失敗したスレッドにはラベルを付けない
  }
}

// スレッド内の全メッセージ・全添付を処理する。1件でも送信リクエストが失敗したら false を返す。
function processThread_(thread, ingestUrl, ingestSecret) {
  var messages = thread.getMessages();
  var allOk = true;

  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var attachments = message.getAttachments();
    if (!attachments || !attachments.length) continue;

    var from = message.getFrom();
    var subject = message.getSubject();

    for (var a = 0; a < attachments.length; a++) {
      var blob = attachments[a];
      var contentType = blob.getContentType();
      if (ALLOWED_ATTACHMENT_TYPES.indexOf(contentType) < 0) continue;

      // 3MB超は送信しても必ず失敗する（Vercelのリクエストボディ上限のため）。
      // allOkは崩さず「処理済み」扱いにしてラベルを付け、毎回リトライされないようにする。
      // 3MB超は手動で mf-evidence.html から登録する運用。
      if (blob.getSize() > MAX_ATTACHMENT_BYTES) {
        Logger.log(
          '添付サイズ超過のためスキップ: subject=' + subject +
          ' filename=' + blob.getName() + ' size=' + blob.getSize()
        );
        continue;
      }

      var success = sendAttachment_(ingestUrl, ingestSecret, blob, from, subject);
      if (!success) allOk = false;
    }
  }

  return allOk;
}

function sendAttachment_(ingestUrl, ingestSecret, blob, from, subject) {
  var payload = {
    file_name: blob.getName(),
    content_type: blob.getContentType(),
    file_data: Utilities.base64Encode(blob.getBytes()),
    from: from,
    subject: subject,
  };

  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-ingest-secret': ingestSecret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  try {
    var response = UrlFetchApp.fetch(ingestUrl, options);
    var code = response.getResponseCode();
    if (code >= 200 && code < 300) {
      return true;
    }
    Logger.log('送信失敗: HTTP ' + code + ' body=' + response.getContentText());
    return false;
  } catch (e) {
    Logger.log('送信エラー: ' + e.message);
    return false;
  }
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}
