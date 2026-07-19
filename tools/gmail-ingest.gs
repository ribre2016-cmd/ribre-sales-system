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

var GMAIL_SEARCH_QUERY = 'has:attachment newer_than:7d';
var PROCESSED_LABEL_NAME = 'MF取込済み';
// 重複排除は「MF取込済み」ラベルではなく、このプロパティに保存する処理済みメッセージID
// (JSON配列、古い順→新しい順) で行う。スレッド返信で新しい添付が来ても、その返信メッセージ
// 自体のIDが未記録なら処理される（旧: スレッド単位のラベル除外だと返信が永久に無視されていた）。
var PROCESSED_MSG_IDS_PROPERTY = 'PROCESSED_MSG_IDS';
// newer_than:7dの検索範囲であれば1週間分のメッセージ数は400件を大きく下回る想定。
// メッセージIDは16文字程度のhex文字列のため、JSON配列400件でも約7.6KB程度
// （"xxxxxxxxxxxxxxxx", を19バイト換算 × 400 ≈ 7,600バイト）に収まり、
// Apps Scriptのスクリプトプロパティ1件あたり9KB制限に対して十分な余裕がある。
var MAX_PROCESSED_MSG_IDS = 400;
var MAX_THREADS_PER_RUN = 50; // 1回の実行タイムアウト対策。
// メッセージID単位の重複排除化で検索からラベル除外を外したため、処理済みスレッドも
// 検索結果の枠を消費する。処理済みメッセージはID照合のみで即スキップ（軽量）なので、
// 新着メールが処理済みスレッドに押し出されないよう枠を10→50に拡大（7日窓で十分な余裕）
var ALLOWED_ATTACHMENT_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
// base64化すると元サイズの約4/3に膨張し、Vercelのサーバーレス関数はリクエストボディが
// 約4.5MBを超えると失敗する。3MB超の添付は送信しても必ず失敗し続けるため、
// ここでスキップしてメッセージを処理済み扱いにし、7日間毎回リトライされるのを防ぐ。
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
  var processedIds = loadProcessedIds_(props);
  var originalCount = processedIds.length;

  // メッセージ単位の重複排除（PROCESSED_MSG_IDS）に切り替えたため、検索条件から
  // 「-label:MF取込済み」を外している。アップグレード直後の1回だけ、既に
  // 「MF取込済み」ラベルが付いている過去7日以内のスレッドも再スキャンされ、
  // そこに含まれるメッセージ（IDがまだプロパティに未記録）の添付が再送信される。
  // サーバー側（/api/mf/ingest-mail）はcontent_hashで重複を検知し
  // {ok:true, duplicate:true} を素早く返すだけなので、二重登録にはならず実害のない
  // 一時的な現象（意図した挙動）。2回目以降の実行からは通常どおりメッセージIDで
  // スキップされる。
  var threads = GmailApp.search(GMAIL_SEARCH_QUERY, 0, MAX_THREADS_PER_RUN);

  for (var i = 0; i < threads.length; i++) {
    var thread = threads[i];
    var threadFullyProcessed = processThread_(thread, ingestUrl, ingestSecret, processedIds);
    if (threadFullyProcessed) {
      // ラベルはもう重複排除の判定には使わない。スレッド内の全メッセージの処理が
      // 完了したことをユーザーが目視確認できるようにするための、視覚的な目印として
      // 付けるだけ。
      thread.addLabel(label);
    }
    // メッセージ単位で失敗があった場合はラベルを付けない。ただしラベルの有無は
    // 検索条件に影響しないため、次回実行時は同じスレッドが再スキャンされ、
    // 未処理（IDが未記録）のメッセージだけが再試行される。
  }

  if (processedIds.length > originalCount) {
    saveProcessedIds_(props, processedIds);
  }
}

// スレッド内の未処理メッセージを処理する。処理済み（送信成功 or サイズ超過スキップのみ）の
// メッセージIDを processedIds に追加する。添付の送信が1件でも失敗したメッセージのIDは
// 追加しない（次回リトライ）。
// 戻り値は「スレッド内の全メッセージが処理済み扱いになったか」（添付なしメッセージや
// 既に処理済みのメッセージも処理済みとみなす）。ラベル付与の判定にのみ使う。
function processThread_(thread, ingestUrl, ingestSecret, processedIds) {
  var messages = thread.getMessages();
  var threadFullyProcessed = true;

  for (var m = 0; m < messages.length; m++) {
    var message = messages[m];
    var msgId = message.getId();

    if (processedIds.indexOf(msgId) >= 0) {
      continue; // 既に処理済み（今回のスレッドの他メッセージ含む過去の実行分）
    }

    var attachments = message.getAttachments();
    if (!attachments || !attachments.length) continue; // 添付なしメッセージは処理対象外（ラベル判定は妨げない）

    var from = message.getFrom();
    var subject = message.getSubject();
    var messageOk = true;

    for (var a = 0; a < attachments.length; a++) {
      var blob = attachments[a];
      var contentType = blob.getContentType();
      if (ALLOWED_ATTACHMENT_TYPES.indexOf(contentType) < 0) continue;

      // 3MB超は送信しても必ず失敗する（Vercelのリクエストボディ上限のため）。
      // messageOkは崩さず「処理済み」扱いにして、毎回リトライされないようにする。
      // 3MB超は手動で mf-evidence.html から登録する運用。
      if (blob.getSize() > MAX_ATTACHMENT_BYTES) {
        Logger.log(
          '添付サイズ超過のためスキップ: subject=' + subject +
          ' filename=' + blob.getName() + ' size=' + blob.getSize()
        );
        continue;
      }

      var success = sendAttachment_(ingestUrl, ingestSecret, blob, from, subject);
      if (!success) messageOk = false;
    }

    if (messageOk) {
      processedIds.push(msgId);
    } else {
      threadFullyProcessed = false;
    }
  }

  return threadFullyProcessed;
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

// 処理済みメッセージIDの配列（古い順→新しい順）をスクリプトプロパティから読み込む。
// 読み込みに失敗した場合は空配列扱いにする。サーバー側のcontent_hash重複排除が
// 二重登録の実害を防いでくれるため、安全側（未処理扱い）に倒して処理を継続する。
function loadProcessedIds_(props) {
  try {
    var raw = props.getProperty(PROCESSED_MSG_IDS_PROPERTY);
    if (!raw) return [];
    var parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (e) {
    Logger.log('PROCESSED_MSG_IDS の読み込みに失敗したため空扱いで続行します: ' + e.message);
    return [];
  }
}

// 処理済みメッセージID配列を、直近 MAX_PROCESSED_MSG_IDS 件（古いものを切り捨て）に
// 詰め直してスクリプトプロパティへ保存する。保存に失敗してもスクリプト自体は継続する
// （次回実行時に同じメッセージが再送信されるだけで、サーバー側のcontent_hash重複排除で
// 実害はない）。
function saveProcessedIds_(props, processedIds) {
  try {
    var trimmed = processedIds;
    if (trimmed.length > MAX_PROCESSED_MSG_IDS) {
      trimmed = trimmed.slice(trimmed.length - MAX_PROCESSED_MSG_IDS);
    }
    props.setProperty(PROCESSED_MSG_IDS_PROPERTY, JSON.stringify(trimmed));
  } catch (e) {
    Logger.log('PROCESSED_MSG_IDS の保存に失敗しました（次回実行で再送信される可能性がありますが、サーバー側の重複排除で実害はありません）: ' + e.message);
  }
}

function getOrCreateLabel_(name) {
  var label = GmailApp.getUserLabelByName(name);
  if (!label) {
    label = GmailApp.createLabel(name);
  }
  return label;
}
