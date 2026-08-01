'use strict';
/* ============================================================================
 * pages/auto-inbox.js — 監視フォルダ →「やることリスト（受信箱）」
 * ----------------------------------------------------------------------------
 * 目的: オーナーがダウンロードフォルダに保存したヤフオク/メルカリの売上CSVや
 * 証憑PDF/画像を、フォルダを開き直すことなく自動で見つけて一覧表示する。
 * 「見つける」までは完全自動・無許可（読み取り専用）、「取り込む」はユーザーの
 * クリックが必須（このアプリの「AI提案→人間承認」と同じ思想。自動取込は絶対にしない）。
 *
 * 技術: File System Access API（永続化可能な FileSystemDirectoryHandle）。
 * ハンドルは構造化複製可能なので IndexedDB に保存し、次回訪問時に
 * queryPermission→(必要なら)requestPermission で読み取り許可を確認する。
 * Chrome/Edge（PC版）専用。Safari/Firefox/iOS では window.showDirectoryPicker が
 * 存在しないため、aibIsSupported() が false を返し、案内文だけを表示する。
 *
 * このファイルが所有するもの: pages/auto-inbox.js, styles/auto-inbox.css のみ。
 * index.html・pages/app-v2.js 等の書き換えは行わない（統合は別担当）。
 *
 * ---- 公開API（window.*） --------------------------------------------------
 *   aibIsSupported()                     : boolean
 *   async aibChooseFolder()               : {ok, name} | {ok:false, reason}
 *   async aibGetFolderInfo()              : {connected, supported, name?, permission?}
 *   async aibScan()                        : {items, skipped, errors, connected, capped, totalCandidates, permission}
 *   aibMarkProcessed(id, action)          : {ok}
 *   async aibReadFileText(id)             : string（CSV等のテキスト。取込関数へそのまま渡せる）
 *   async aibReadFileBase64(id)           : string（証憑用。data:プレフィックス無し）
 *   aibRenderPanel(container, handlers)    : 受信箱UIを container 配下に描画
 *   async aibForgetFolder()                : {ok}
 *
 * handlers = {
 *   onImportCsv(item, text)   : yahoo_sales / mercari_shops / shipping のCSVで「取り込む」を押したときに呼ばれる。
 *                               既存の取込関数（appvImportYahooCsv / appvImportShippingCsv 等）へ
 *                               このモジュールは一切触れない。呼び出し元（統合担当）が item.kind で分岐して
 *                               本物の取込処理を呼ぶこと。Promiseを返してよい。例外を投げれば「失敗」として
 *                               行に残り、正常終了（resolve）すれば既取込としてリストから消える。
 *   onSendEvidence(item, base64) : evidence（PDF/画像）で「証憑として送る」を押したときに呼ばれる。
 *   onIgnore(item) (任意)     : 「無視する」を押したとき、台帳登録の後に追加で呼ばれる通知（無くても動く）。
 * }
 *
 * ---- 分類ルール（決定的・LLM不使用） --------------------------------------
 * pages/app-v2.js の appvImportYahooCsv（4819-4840行目）と
 * pages/app-shipping.js の detectShipType（130-144行目。app-v2.js側の同一移植は
 * appvDetectShipType 5012-5026行目）を読んだ上で、そこで実際に使われている
 * 見出し語彙・列位置をそのまま流用する。詳細は下記 aibClassifyCsv 等のコメント参照。
 *
 * 重要な事実確認（当てずっぽうにしないための前提）:
 *   実際の appvImportYahooCsv は「ヤフオク／メルカリ／メルカリShops／ラクマ」の
 *   区別を CSVの中身からではなく、ユーザーが取込画面のプルダウン(#impYahooAccount)で
 *   選んだアカウント名(account引数)で行っている。CSVヘッダーで区別できるのは
 *   実質「ヤフオク特有の語（オークションID/落札系）」の有無だけであり、
 *   メルカリShopsは isMercariShops 分岐で列位置(0,6,12,15列目)を固定参照するのみで
 *   見出し文字列の検索を一切行っていない（=ヘッダー内容から確実に判定する方法が
 *   存在しない）。そのため本モジュールは:
 *     - 'yahoo_sales' : ヤフオク特有語 or 汎用売上語彙(ID+日付/金額)にマッチ →
 *                       「ヤフオク1〜8／メルカリ／ラクマ」のいずれか。実アプリと同じく
 *                       取込時にアカウントを人が選ぶ前提のノートを添える。
 *     - 'mercari_shops': ヘッダー文言では判定不能なため、実装が使う固定列位置
 *                       (6列目=日付・12列目/15列目=金額)が実データと整合するかという
 *                       "構造的な"判定のみを行う。文言からの当てずっぽうはしない。
 *     - 'shipping'     : detectShipType と同一の列位置・数値ロジックで判定。
 *     - 'unknown'      : 上記いずれにも決定的に一致しない場合。黙って推測しない。
 * ============================================================================ */

(function () {
  var DB_NAME = 'ribre_inbox_db_v1';
  var DB_STORE = 'handles';
  var DB_KEY = 'dirHandle';
  var LEDGER_KEY = 'ribre_inbox_seen_v1';
  var LEDGER_CAP = 500;
  var MAX_AGE_DAYS = 60;
  var MAX_FILES = 200;
  var EXT_RE = /\.(csv|pdf|png|jpe?g)$/i;

  var KIND_LABEL = {
    yahoo_sales: '売上CSV（ヤフオク／メルカリ／ラクマ等）',
    mercari_shops: '売上CSV（メルカリShops・列位置判定）',
    shipping: '配送CSV',
    evidence: '証憑（PDF・画像）',
    unknown: '不明なファイル'
  };
  var KIND_ORDER = ['yahoo_sales', 'mercari_shops', 'shipping', 'evidence', 'unknown'];
  var SHIP_TYPE_LABEL = { yamato1: 'ヤマト便（送り状）', yamato2: 'ヤマト便（運賃明細）', sagawa: '佐川急便' };

  /* pages/app-v2.js 4825-4829行目 の idxId/idxDate/idxName/idxAmount/idxFee パターンの和集合。
   * YAHOO_ONLY_TERMS はヤフオク（isYahoo）専用の分岐でしか検索されない語
   * （'オークションID' は idxId のYahoo分岐のみ／'落札システム利用料' は idxFee のYahoo分岐のみ）に、
   * 実運用上ヤフオクにしか出現しない語（'落札日'・'落札価格'）を加えたもの。 */
  var YAHOO_ONLY_TERMS = ['オークションID', '落札システム利用料', '落札日', '落札価格'];
  var ID_VOCAB = ['商品ID', '管理番号', '注文番号']; // 4825行目 idxId（Yahoo/elseの両方の候補の和集合）
  var DATE_VOCAB = ['完了日', '落札日', '終了日時', '取扱日']; // 4826行目 idxDate（isMercariShops以外は共通）
  var AMOUNT_VOCAB = ['決済金額', '落札価格', '売上金額', '合計']; // 4828行目 idxAmount

  /* ---------------- 内部状態 ---------------- */
  var aibDirHandle = null; // IndexedDBから読み込んだ/選択直後のディレクトリハンドル（メモリキャッシュ）
  var aibLastItems = new Map(); // 直近のaibScan()結果: id -> {fh, name, size, lastModified, kind, hash}
  var aibScanPromise = null; // 実行中のスキャンPromise（二重スキャン防止のため共有する）

  /* ==================== 0. サポート判定 ==================== */
  function aibIsSupported() {
    return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
  }

  /* ==================== 1. IndexedDB（ハンドル永続化） ====================
   * FileSystemDirectoryHandle は構造化複製可能だが localStorage には保存できないため、
   * IndexedDBへ保存する。 */
  function aibOpenDb() {
    return new Promise(function (resolve, reject) {
      if (!('indexedDB' in window)) { reject(new Error('indexedDB is not available')); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function aibIdbGet(key) {
    return aibOpenDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }
  function aibIdbSet(key, value) {
    return aibOpenDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function aibIdbDelete(key) {
    return aibOpenDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  function aibLoadHandle() {
    if (aibDirHandle) return Promise.resolve(aibDirHandle);
    return aibIdbGet(DB_KEY).then(function (h) {
      if (h) aibDirHandle = h;
      return aibDirHandle;
    }).catch(function () { return null; });
  }

  /* ==================== 2. フォルダ選択・解除 ==================== */
  function aibChooseFolder() {
    if (!aibIsSupported()) return Promise.resolve({ ok: false, reason: 'unsupported' });
    return window.showDirectoryPicker({ id: 'ribre-inbox', mode: 'read', startIn: 'downloads' }).then(function (handle) {
      aibDirHandle = handle;
      return aibIdbSet(DB_KEY, handle).catch(function () { /* 保存できなくても今回のセッションでは使える */ }).then(function () {
        return { ok: true, name: handle.name };
      });
    }, function (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled' };
      return { ok: false, reason: 'error', message: e && e.message };
    });
  }
  function aibForgetFolder() {
    aibDirHandle = null;
    aibLastItems = new Map();
    aibScanPromise = null;
    return aibIdbDelete(DB_KEY).catch(function () {}).then(function () { return { ok: true }; });
  }
  function aibGetFolderInfo() {
    if (!aibIsSupported()) return Promise.resolve({ connected: false, supported: false });
    return aibLoadHandle().then(function (handle) {
      if (!handle) return { connected: false, supported: true };
      return Promise.resolve(handle.queryPermission ? handle.queryPermission({ mode: 'read' }) : 'granted')
        .catch(function () { return 'denied'; })
        .then(function (permission) {
          return { connected: true, supported: true, name: handle.name, permission: permission };
        });
    });
  }

  /* ==================== 3. 台帳（重複取込防止） ====================
   * localStorage ribre_inbox_seen_v1: [{hash, name, size, lastModified, at, action}, ...]（最大500件）。
   * ファイル名を変えても中身が同じならSHA-256ハッシュが一致するため再提示されない。 */
  function aibLoadLedger() {
    try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function aibSaveLedger(arr) {
    try { localStorage.setItem(LEDGER_KEY, JSON.stringify(arr.slice(-LEDGER_CAP))); } catch (e) { /* 容量オーバー等は無視 */ }
  }
  function aibLedgerHasHash(ledger, hash) {
    return ledger.some(function (e) { return e && e.hash === hash; });
  }
  function aibMarkProcessed(id, action) {
    var entry = aibLastItems.get(id);
    if (!entry) return { ok: false, reason: 'not_found' };
    var ledger = aibLoadLedger();
    if (!aibLedgerHasHash(ledger, entry.hash)) {
      ledger.push({ hash: entry.hash, name: entry.name, size: entry.size, lastModified: entry.lastModified, at: Date.now(), action: action || 'processed' });
      aibSaveLedger(ledger);
    }
    aibLastItems.delete(id);
    return { ok: true };
  }

  /* ==================== 4. ハッシュ・文字コード ==================== */
  function aibSha256Hex(buf) {
    return crypto.subtle.digest('SHA-256', buf).then(function (digest) {
      var bytes = new Uint8Array(digest);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) { hex += bytes[i].toString(16).padStart(2, '0'); }
      return hex;
    });
  }
  /* pages/app-v2.js の appvReadFileAsText（5110-5125行目）と同一方針:
   * まずUTF-8として読み、置換文字(U+FFFD)が出たらShift_JISとして読み直す。
   * ヤフオク/メルカリ系CSV・配送業者CSVのどちらもこの2択でほぼカバーできる。 */
  function aibDecodeText(buf) {
    var text = '';
    try { text = new TextDecoder('utf-8', { fatal: false }).decode(buf); } catch (e) { text = ''; }
    if (text.indexOf('�') >= 0) {
      try { text = new TextDecoder('shift-jis').decode(buf); } catch (e) { /* デコードできなければUTF-8のまま */ }
    }
    return text.replace(/^﻿/, '');
  }
  function aibArrayBufferToBase64(buf) {
    var bytes = new Uint8Array(buf);
    var chunkSize = 0x8000;
    var chunks = [];
    for (var i = 0; i < bytes.length; i += chunkSize) {
      chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize)));
    }
    return btoa(chunks.join(''));
  }

  /* ==================== 5. CSVパース・分類 ====================
   * pages/app-shipping.js parseCsvLine/parseCsv（49-79行目）と同一のクォート処理。 */
  function aibCsvLine(line) {
    var out = [], cur = '', q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
      if (ch === '"') { q = !q; continue; }
      if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
      cur += ch;
    }
    out.push(cur);
    return out;
  }
  function aibParseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    return text.split(/\r?\n/).filter(function (x) { return x.trim(); }).map(aibCsvLine);
  }
  function aibHasAny(headerRow, patterns) {
    return patterns.some(function (p) {
      return (headerRow || []).some(function (cell) { return String(cell || '').indexOf(p) >= 0; });
    });
  }
  function aibNum(v) {
    var n = Number(String(v == null ? '' : v).replace(/[¥,円\s]/g, ''));
    return isFinite(n) ? n : 0;
  }
  function aibNormalizeSlip(v) {
    return String(v || '')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xfee0); })
      .replace(/[-\s]/g, '')
      .trim();
  }
  function aibExtractItemId(v) {
    var s = String(v || '').trim();
    var order = s.match(/order_[A-Za-z0-9]+/);
    if (order) return order[0];
    var m = s.match(/[a-z]?\d{9,12}/i);
    if (m) return m[0];
    if (s.length >= 8) return s;
    return '';
  }
  /* pages/app-shipping.js detectShipType（130-144行目）／pages/app-v2.js appvDetectShipType
   * （5012-5026行目）と同一ロジック。ヤマト送り状=A/AB列(0/27)に商品ID、
   * ヤマト運賃明細=E列(4)に伝票番号かつL列(11)に運賃、佐川=E列(4)に商品ID かつ K列(10)に送料。 */
  function aibShipTypeOf(rows) {
    var y1 = 0, y2 = 0, sg = 0;
    (rows || []).forEach(function (r, idx) {
      var joined = (r || []).join('');
      if (!joined.trim()) return;
      if (idx === 0 && /お客様|原票|運賃|伝票|管理|送料|問い合わせ|問合|商品/.test(joined)) return;
      if (aibNum(r[11]) > 0 && aibNormalizeSlip(r[4] || '')) y2++;
      else if (aibExtractItemId(r[0] || '') || aibExtractItemId(r[27] || '')) y1++;
      if (aibExtractItemId(r[4] || '') && aibNum(r[10]) > 0) sg++;
    });
    if (y2 > 0 && y2 >= y1 && y2 >= sg) return 'yamato2';
    if (y1 > 0 && y1 >= sg) return 'yamato1';
    if (sg > 0) return 'sagawa';
    return null;
  }
  /* メルカリShops構造判定（ヘッダー文言では判定できないため列位置のみで見る）。
   * appvImportYahooCsv の isMercariShops 分岐（4824-4829,4853行目）が実際に読む列:
   * 0列目=商品/注文ID、6列目=日付、12列目=決済金額、15列目=手数料。
   * データ行の7割以上でこの4列の形が揃っていれば「メルカリShops形式らしい」と判定する
   * （文言からの当てずっぽうはしない＝一致しなければ素直にunknownへ）。 */
  function aibDateLike(v) { return /\d{4}[\/\-年]\d{1,2}/.test(String(v || '')); }
  function aibIsNumericLike(v) {
    var s = String(v == null ? '' : v).replace(/[¥,円\s]/g, '').trim();
    return s !== '' && /^-?\d+(\.\d+)?$/.test(s);
  }
  function aibMercariShopsLike(rows) {
    var dataRows = (rows || []).slice(1);
    if (!dataRows.length) return false;
    var checked = 0, matched = 0;
    dataRows.forEach(function (r) {
      if (!r || r.length < 16) return;
      checked++;
      if (aibDateLike(r[6]) && aibIsNumericLike(r[12]) && aibIsNumericLike(r[15]) && String(r[0] || '').trim().length >= 4) matched++;
    });
    if (!checked) return false;
    return (matched / checked) >= 0.7;
  }
  /* ==================== 出品アカウントの判定（商品タイトルの棚番から） ====================
   * ヤフオクの売上CSVには出品者アカウントを示す列が無いため（pages/app-v2.js 4825-4834行目の
   * 読み取り列を参照）、CSVの中身だけではヤフオク1〜8のどれかを区別できない。
   * ただしRIBREの運用では商品タイトル先頭に棚番が付いており、その形が
   *   1文字目=配送サイズ数字 / 2文字目=アカウント英字 / 3文字目=種別英字 / 4文字目=棚番数字
   *   例: 1HC1 → ネコポス・ヤフオク8・CD・棚1
   * になっている。2文字目のアカウント英字で判別する。
   *   配送サイズ: 1=ネコポス 2=宅急便コンパクト 3=ヤマト60 4=80 5=100（判定には使わない）
   *   アカウント: 無し=ヤフオク1、K=ヤフオク1（下記の例外）、S=2、R=3、N=4、M=5、J=6、Q=7、H=8
   *   種別      : C=CD、D=DVD、K=カセットテープ
   *   棚番      : 1〜
   * ヤフオク1だけは例外で、当初は 1C1（アカウント英字なし）だったが最近は 1KC1 の形を使う。
   * このKはアカウント位置に来るため、Kが来たらヤフオク1と認識する。
   * したがって 1KC1=ヤフオク1のCD、1HK1=ヤフオク8のカセット、と読む
   * （1HKC1 のような3文字英字の形は存在しない）。
   * 1行だけで決めず全行を集計して多数決を取る（棚番の付け忘れ・例外行があっても揺らがない）。
   * なおヤフオク4は2026年8月頃までは棚番が付いていないため、その時期のCSVは判定不能になる。
   * 判定できない場合は勝手に決めず、利用者に選んでもらう。 */
  var AIB_SHELF_ACCOUNT_MAP = {
    '': 'ヤフオク1', K: 'ヤフオク1', S: 'ヤフオク2', R: 'ヤフオク3', N: 'ヤフオク4',
    M: 'ヤフオク5', J: 'ヤフオク6', Q: 'ヤフオク7', H: 'ヤフオク8'
  };
  // アカウント英字は1文字（貪欲）、種別はC/D/Kのいずれか。
  // 1C1 はアカウント位置が空でCが種別、1KC1 はK=アカウント(ヤフオク1)でCが種別、
  // 1HK1 はH=アカウントでK=種別(カセット)、と自然に解釈される。
  var AIB_SHELF_RE = /^\s*([1-9])([A-Za-z]?)([CDKcdk])(\d+)/;
  var AIB_ACCOUNT_MIN_VOTES = 3;   // これ未満のサンプルでは判定しない
  var AIB_ACCOUNT_MIN_RATIO = 0.6; // 最多アカウントがこの割合未満なら判定しない

  function aibDetectAccount(rows) {
    if (!rows || rows.length < 2) return null;
    var header = rows[0];
    var idxName = aibFindIndex(header, ['商品名', 'タイトル', '取扱内容'], 2);
    if (idxName < 0) return null;
    var votes = {}, total = 0;
    rows.slice(1).forEach(function (r) {
      var title = String((r && r[idxName]) || '');
      var m = AIB_SHELF_RE.exec(title);
      if (!m) return;
      var letter = String(m[2] || '').toUpperCase();
      var acc = AIB_SHELF_ACCOUNT_MAP[letter];
      if (!acc) return; // 未知の英字は勝手に割り当てない
      votes[acc] = (votes[acc] || 0) + 1;
      total++;
    });
    if (total < AIB_ACCOUNT_MIN_VOTES) return null;
    var best = null, bestN = 0;
    Object.keys(votes).forEach(function (k) { if (votes[k] > bestN) { best = k; bestN = votes[k]; } });
    if (!best) return null;
    var ratio = bestN / total;
    if (ratio < AIB_ACCOUNT_MIN_RATIO) return null;
    return { account: best, votes: bestN, sampled: total, ratio: ratio };
  }

  /* ヘッダー配列から候補語のいずれかを含む列位置を探す（pages/app-v2.js の appvYFindIndex と同規則） */
  function aibFindIndex(header, cands, fallback) {
    for (var i = 0; i < header.length; i++) {
      var cell = String(header[i] || '');
      for (var j = 0; j < cands.length; j++) {
        if (cell.indexOf(cands[j]) >= 0) return i;
      }
    }
    return typeof fallback === 'number' ? fallback : -1;
  }

  /* 取込前の目視確認用に、先頭数件の日付・商品名・金額を抜き出す。
   * 列位置は取込本体（pages/app-v2.js 4828-4830行目）と同じ語彙で探すため、
   * ここで見えている値が実際に取り込まれる値と一致する。 */
  var AIB_SAMPLE_MAX = 5;
  function aibSampleRows(rows) {
    if (!rows || rows.length < 2) return [];
    var header = rows[0];
    var idxDate = aibFindIndex(header, ['完了日', '落札日', '終了日時', '取扱日'], 1);
    var idxName = aibFindIndex(header, ['商品名', 'タイトル', '取扱内容'], 2);
    var idxAmount = aibFindIndex(header, ['決済金額', '落札価格', '売上金額', '合計'], 3);
    var out = [];
    for (var i = 1; i < rows.length && out.length < AIB_SAMPLE_MAX; i++) {
      var r = rows[i];
      if (!r) continue;
      var name = String((idxName >= 0 && r[idxName]) || '').trim();
      var date = String((idxDate >= 0 && r[idxDate]) || '').trim();
      var amount = String((idxAmount >= 0 && r[idxAmount]) || '').trim();
      if (!name && !date && !amount) continue;
      out.push({
        date: date.slice(0, 20),
        name: name.length > 60 ? name.slice(0, 60) + '…' : name,
        amount: amount.slice(0, 20)
      });
    }
    return out;
  }

  /* 配送CSVの種類。ファイル名の手がかり（app-v2.js の appvDetectShipTypeByName。
   * 発行済データ→ヤマト送り状、unchinjyoho/運賃→ヤマト運賃明細、佐川→佐川）を
   * 優先し、無ければ中身の列位置から判定する。中身の判定はヤマトの送り状発行済
   * データを佐川と誤判定する実例があったため、ファイル名が勝つ順序にしている。
   * 判定の実体はapp-v2.js側に一本化し、ここでは持たない（二重管理を避ける）。 */
  function aibShipTypeOfWithName(rows, fileName) {
    try {
      if (fileName && typeof window.appvDetectShipTypeByName === 'function') {
        var byName = window.appvDetectShipTypeByName(fileName);
        if (byName) return { type: byName, reason: 'ファイル名' };
      }
    } catch (e) {}
    var byContent = aibShipTypeOf(rows);
    return byContent ? { type: byContent, reason: 'CSVの中身' } : { type: null, reason: '' };
  }

  function aibClassifyCsv(rows, fileName) {
    if (!rows.length) return { kind: 'unknown', note: 'CSVが空です（ヘッダー行もありません）。', rowCount: 0 };
    var header = rows[0];
    var dataRows = rows.slice(1);
    var yahooSignal = aibHasAny(header, YAHOO_ONLY_TERMS);
    var idMatch = aibHasAny(header, ID_VOCAB);
    var dateMatch = aibHasAny(header, DATE_VOCAB);
    var amountMatch = aibHasAny(header, AMOUNT_VOCAB);
    var genericSalesLike = idMatch && (dateMatch || amountMatch);

    /* メルカリShopsの構造判定は、汎用の売上見出し判定より先に行う。
     * 棚番の英字はヤフオクのアカウントしか表さないため、メルカリShopsのCSVを
     * 先に売上CSVとして拾ってしまうと、商品名に棚番が付いている場合に
     * 「ヤフオク5」等と誤ってアカウント判定してしまう。
     * ただしヤフオク固有語（オークションID・落札日等）があるものはメルカリでは
     * ありえないので、そちらが先。 */
    if (!yahooSignal && aibMercariShopsLike(rows)) {
      return {
        kind: 'mercari_shops',
        account: 'メルカリShops',
        note: '列位置からメルカリShops形式と判定しました（見出し文言では判定できない形式のため）。'
          + 'メルカリShopsのCSVはファイル名に販路が入らない（例: 202607-202607_report.csv）ため、中身で判定しています。',
        rowCount: dataRows.length,
        sampleRows: aibSampleRows(rows)
      };
    }

    if (yahooSignal || genericSalesLike) {
      var det = aibDetectAccount(rows);
      var samples = aibSampleRows(rows);
      if (det) {
        return {
          kind: 'yahoo_sales',
          account: det.account,
          accountConfidence: det.ratio,
          note: '売上CSVとして検出しました。商品タイトルの棚番から「' + det.account + '」と判定しました（'
            + det.votes + '/' + det.sampled + '行が一致）。',
          rowCount: dataRows.length,
          sampleRows: samples
        };
      }
      return {
        kind: 'yahoo_sales',
        note: '売上CSVとして検出しました（列見出しが一致）。商品タイトルの棚番からはアカウントを判定できなかったため、取込時に対象アカウント（ヤフオク1〜8／メルカリ／ラクマ等）を選んでください。',
        rowCount: dataRows.length,
        sampleRows: samples
      };
    }
    var shipGuess = aibShipTypeOfWithName(rows, fileName);
    var shipType = shipGuess.type;
    var shipNote = function () {
      return '配送CSV（' + SHIP_TYPE_LABEL[shipType] + '）として検出しました（' + shipGuess.reason + 'から判定）。';
    };
    /* ファイル名から判定できたものは中身の弱いシグナルより確実なので最優先。
     * 中身だけの判定は、ヤマトの送り状発行済データを佐川と誤判定する実例があった。 */
    if (shipType && shipGuess.reason === 'ファイル名') {
      return { kind: 'shipping', note: shipNote(), rowCount: dataRows.length, shipType: shipType };
    }
    /* yamato2/sagawaは「数値列＋ID/伝票列」の2条件一致が必要な強いシグナルなので先に判定してよいが、
     * yamato1は「0列目 or 27列目がID『らしい』文字列」という1条件だけの弱いシグナルで、
     * メルカリShops固定列（0列目=ID）の値とも構造的に衝突しうる。そのため
     * 「メルカリShops構造判定 → 残ったyamato1判定」の順にして弱いシグナルを後回しにする。 */
    if (shipType === 'yamato2' || shipType === 'sagawa') {
      return { kind: 'shipping', note: shipNote(), rowCount: dataRows.length, shipType: shipType };
    }
    if (aibMercariShopsLike(rows)) {
      return {
        kind: 'mercari_shops',
        note: '列位置からメルカリShops形式らしいと判定しました（見出し文言では判定できない形式のため）。取込時にアカウント「メルカリShops」を選んでください。',
        rowCount: dataRows.length
      };
    }
    if (shipType === 'yamato1') {
      return { kind: 'shipping', note: shipNote(), rowCount: dataRows.length, shipType: shipType };
    }
    return { kind: 'unknown', note: '列見出しから種類を判定できませんでした。取込対象外です（手動でご確認ください）。', rowCount: dataRows.length };
  }

  /* ==================== 6. 表示用フォーマッタ ==================== */
  function aibFormatSize(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes < 1024) return bytes + 'B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + 'KB';
    return (bytes / (1024 * 1024)).toFixed(2) + 'MB';
  }
  function aibFormatDate(ts) {
    try { return new Date(ts).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
    catch (e) { return ''; }
  }

  /* ==================== 7. スキャン本体 ====================
   * 読み取り専用（mode:'read'）。ファイルの書き込み・削除は一切行わない。
   * 直近のフォルダ一覧を「更新日時60日以内 かつ 対象拡張子」で絞り込み、
   * 新しい順に最大200件だけ中身を読む（cap超過分は totalCandidates/capped で報告）。
   * 二重スキャン防止: 実行中のPromiseを共有し、呼び出しが重なっても1回分の結果しか作らない。 */
  function aibScan() {
    if (aibScanPromise) return aibScanPromise;
    aibScanPromise = aibDoScan();
    aibScanPromise.then(function () { aibScanPromise = null; }, function () { aibScanPromise = null; });
    return aibScanPromise;
  }

  function aibDoScan() {
    var result = { items: [], skipped: 0, errors: [], connected: false, supported: aibIsSupported(), capped: false, totalCandidates: 0 };
    if (!result.supported) return Promise.resolve(result);

    return aibLoadHandle().then(function (handle) {
      if (!handle) return result;
      result.connected = true;

      return Promise.resolve(handle.queryPermission({ mode: 'read' })).catch(function () { return 'denied'; })
        .then(function (permission) {
          if (permission === 'granted') return permission;
          return Promise.resolve(handle.requestPermission({ mode: 'read' })).catch(function () { return 'denied'; });
        })
        .then(function (permission) {
          result.permission = permission;
          if (permission !== 'granted') return result;

          var cutoff = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
          var candidates = [];

          return (function collectEntries() {
            var iterator = handle.entries();
            function step() {
              return Promise.resolve(iterator.next()).then(function (res) {
                if (res.done) return;
                var name = res.value[0];
                var fh = res.value[1];
                if (fh && fh.kind === 'file' && EXT_RE.test(name)) {
                  return Promise.resolve(fh.getFile()).then(function (file) {
                    if (file.lastModified >= cutoff) candidates.push({ fh: fh, file: file });
                  }, function (e) {
                    result.errors.push({ name: name, note: '開けませんでした（他のアプリで使用中の可能性があります）: ' + ((e && e.message) || e) });
                  }).then(step);
                }
                return step();
              });
            }
            return step();
          })().catch(function (e) {
            result.errors.push({ name: '(フォルダ)', note: 'フォルダの一覧取得に失敗しました: ' + ((e && e.message) || e) });
          }).then(function () {
            candidates.sort(function (a, b) { return b.file.lastModified - a.file.lastModified; });
            result.totalCandidates = candidates.length;
            result.capped = candidates.length > MAX_FILES;
            var selected = candidates.slice(0, MAX_FILES);
            var ledger = aibLoadLedger();
            var newItemsMap = new Map();

            var i = 0;
            function next() {
              if (i >= selected.length) return;
              var cur = selected[i++];
              var file = cur.file;
              return Promise.resolve(file.arrayBuffer()).then(function (buf) {
                return aibSha256Hex(buf).then(function (hash) {
                  if (aibLedgerHasHash(ledger, hash)) { result.skipped++; return; }
                  var extMatch = file.name.match(/\.([a-z0-9]+)$/i);
                  var ext = extMatch ? extMatch[1].toLowerCase() : '';
                  var kind, note, preview, account = '', accountConfidence = 0, sampleRows = [];
                  if (ext === 'csv') {
                    var text = aibDecodeText(buf);
                    var rows = aibParseCsv(text);
                    var cls = aibClassifyCsv(rows, file.name);
                    kind = cls.kind; note = cls.note;
                    account = cls.account || '';
                    accountConfidence = cls.accountConfidence || 0;
                    sampleRows = cls.sampleRows || [];
                    preview = KIND_LABEL[kind] + (typeof cls.rowCount === 'number' ? '・' + cls.rowCount + '行' : '');
                    // 棚番から出品アカウントが判明した場合はひと目で分かるようにする
                    if (account) preview += '・' + account;
                  } else {
                    kind = 'evidence';
                    note = '証憑（' + ext.toUpperCase() + '）として送信できます。';
                    preview = KIND_LABEL.evidence;
                  }
                  var id = 'aib_' + hash.slice(0, 24);
                  newItemsMap.set(id, { fh: cur.fh, name: file.name, size: file.size, lastModified: file.lastModified, kind: kind, hash: hash });
                  result.items.push({
                    id: id, name: file.name, kind: kind, size: file.size, lastModified: file.lastModified,
                    preview: preview, note: note, account: account, accountConfidence: accountConfidence,
                    sampleRows: sampleRows
                  });
                });
              }, function (e) {
                result.errors.push({ name: file.name, note: '読み込みに失敗しました（他のアプリで使用中の可能性があります）: ' + ((e && e.message) || e) });
              }).then(next);
            }
            return Promise.resolve(next()).then(function () {
              aibLastItems = newItemsMap; // このスキャン結果で丸ごと置き換える(前回分のidは失効)
              return result;
            });
          });
        });
    });
  }

  /* ==================== 8. 個別ファイル読み出し（統合担当が既存importerへ渡す用） ==================== */
  function aibReadFileText(id) {
    var entry = aibLastItems.get(id);
    if (!entry) return Promise.reject(new Error('対象ファイルが見つかりません（再スキャンしてください）'));
    return Promise.resolve(entry.fh.getFile()).then(function (file) {
      return file.arrayBuffer();
    }, function (e) {
      throw new Error('ファイルを開けませんでした: ' + ((e && e.message) || e));
    }).then(function (buf) { return aibDecodeText(buf); });
  }
  function aibReadFileBase64(id) {
    var entry = aibLastItems.get(id);
    if (!entry) return Promise.reject(new Error('対象ファイルが見つかりません（再スキャンしてください）'));
    return Promise.resolve(entry.fh.getFile()).then(function (file) {
      return file.arrayBuffer();
    }, function (e) {
      throw new Error('ファイルを開けませんでした: ' + ((e && e.message) || e));
    }).then(function (buf) { return aibArrayBufferToBase64(buf); });
  }

  /* ==================== 9. UI（createElement/textContentのみ。innerHTML禁止） ====================
   * ファイル名はファイルシステム由来＝攻撃者が細工できる値のため、pages/mf-evidence.js の
   * 安全な描画スタイル（createElement + textContent）にならい、innerHTMLは一切使わない。 */
  function aibClearEl(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function aibMakeButton(label, cls, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = cls;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function aibRenderUnsupported(container) {
    aibClearEl(container);
    var explain = document.createElement('div'); explain.className = 'aib-explain';
    var p1 = document.createElement('p');
    p1.textContent = 'このブラウザでは「監視フォルダ」機能を使えません。';
    var p2 = document.createElement('p'); p2.className = 'aib-explain-sub';
    p2.textContent = 'この機能はパソコン版のChromeまたはEdgeが必要です（Safari・Firefox・スマートフォンには対応していません）。これまで通り、上の「売上CSV取込」からファイルを選んで取り込んでください。';
    explain.appendChild(p1); explain.appendChild(p2);
    container.appendChild(explain);
  }

  function aibRenderNotConnected(container, handlers) {
    aibClearEl(container);
    var explain = document.createElement('div'); explain.className = 'aib-explain';
    var p1 = document.createElement('p');
    p1.textContent = 'フォルダを一度選ぶと、次からは開くだけで新しいCSV・証憑を自動で見つけます。';
    var p2 = document.createElement('p'); p2.className = 'aib-explain-sub';
    p2.textContent = '対応ブラウザ: パソコン版のChrome／Edge。ふだんCSVや証憑を保存している「ダウンロード」フォルダを選ぶのがおすすめです（読み取り専用でお借りします）。';
    explain.appendChild(p1); explain.appendChild(p2);
    container.appendChild(explain);

    var btn = aibMakeButton('📁 フォルダを選ぶ', 'aib-btn aib-btn-primary', function () {
      btn.disabled = true;
      aibChooseFolder().then(function (res) {
        if (res.ok) { aibRenderPanel(container, handlers); return; }
        btn.disabled = false;
        if (res.reason !== 'cancelled') {
          var err = document.createElement('div'); err.className = 'aib-error';
          err.textContent = 'フォルダを選べませんでした: ' + (res.message || res.reason);
          container.appendChild(err);
        }
      });
    });
    container.appendChild(btn);
  }

  function aibSummaryText(items) {
    var csv = 0, evi = 0, unk = 0;
    items.forEach(function (it) {
      if (it.kind === 'evidence') evi++;
      else if (it.kind === 'unknown') unk++;
      else csv++;
    });
    var parts = [];
    if (csv) parts.push('取込待ちCSV ' + csv + '件');
    if (evi) parts.push('証憑 ' + evi + '件');
    if (unk) parts.push('不明 ' + unk + '件');
    return parts.join('・') || '新しいファイルがあります';
  }

  function aibGroupItems(items) {
    var groups = {};
    KIND_ORDER.forEach(function (k) { groups[k] = []; });
    items.forEach(function (it) { (groups[it.kind] || (groups[it.kind] = [])).push(it); });
    return groups;
  }

  function aibRunAction(row, btn, item, action, runner) {
    btn.disabled = true;
    var prevText = btn.textContent;
    btn.textContent = '処理中…';
    runner().then(function () {
      aibMarkProcessed(item.id, action);
      if (row.parentNode) row.parentNode.removeChild(row);
    }, function (e) {
      btn.disabled = false;
      btn.textContent = prevText;
      var main = row.querySelector('.aib-item-main');
      var errEl = row.querySelector('.aib-item-error');
      if (!errEl && main) { errEl = document.createElement('div'); errEl.className = 'aib-item-error'; main.appendChild(errEl); }
      if (errEl) errEl.textContent = '⚠ ' + ((e && e.message) || String(e));
    });
  }

  function aibRenderItemRow(item, handlers) {
    var row = document.createElement('div'); row.className = 'aib-item';
    var main = document.createElement('div'); main.className = 'aib-item-main';
    var nameEl = document.createElement('div'); nameEl.className = 'aib-item-name'; nameEl.textContent = item.name;
    var metaEl = document.createElement('div'); metaEl.className = 'aib-item-meta';
    metaEl.textContent = aibFormatSize(item.size) + '・' + aibFormatDate(item.lastModified) + (item.preview ? '・' + item.preview : '');
    var noteEl = document.createElement('div'); noteEl.className = 'aib-item-note'; noteEl.textContent = item.note || '';
    main.appendChild(nameEl); main.appendChild(metaEl); main.appendChild(noteEl);

    /* 中身のプレビュー。取り込む前に「本当にこのアカウントのCSVか」を目視で
     * 確かめられるようにする（判定は多数決なので、根拠となる実データを見せる）。
     * 表形式ではなく折りたたみにして、普段は邪魔にならないようにする。 */
    if (item.sampleRows && item.sampleRows.length) {
      var det = document.createElement('details'); det.className = 'aib-item-sample';
      var sum = document.createElement('summary');
      sum.textContent = '中身を確認（先頭' + item.sampleRows.length + '件）';
      det.appendChild(sum);
      var tbl = document.createElement('table'); tbl.className = 'aib-sample-table';
      var thead = document.createElement('thead');
      var htr = document.createElement('tr');
      ['日付', '商品名', '金額'].forEach(function (h) {
        var th = document.createElement('th'); th.textContent = h; htr.appendChild(th);
      });
      thead.appendChild(htr); tbl.appendChild(thead);
      var tbody = document.createElement('tbody');
      item.sampleRows.forEach(function (s) {
        var tr = document.createElement('tr');
        var td1 = document.createElement('td'); td1.textContent = s.date || '';
        var td2 = document.createElement('td'); td2.textContent = s.name || '';
        var td3 = document.createElement('td'); td3.className = 'aib-sample-amount'; td3.textContent = s.amount || '';
        tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(td3);
        tbody.appendChild(tr);
      });
      tbl.appendChild(tbody);
      det.appendChild(tbl);
      if (item.account) {
        var hint = document.createElement('div'); hint.className = 'aib-sample-hint';
        hint.textContent = '商品名の先頭（例: 1HC1 → H＝ヤフオク8）から判定しています。違っていればキャンセルして手動で選んでください。';
        det.appendChild(hint);
      }
      main.appendChild(det);
    }

    var actions = document.createElement('div'); actions.className = 'aib-item-actions';

    if (item.kind === 'yahoo_sales' || item.kind === 'mercari_shops' || item.kind === 'shipping') {
      var importBtn = aibMakeButton('取り込む', 'aib-btn aib-btn-primary', function () {
        aibRunAction(row, importBtn, item, 'imported', function () {
          return aibReadFileText(item.id).then(function (text) {
            if (typeof handlers.onImportCsv !== 'function') throw new Error('取込先が未設定です（アプリ側の実装待ち）');
            return handlers.onImportCsv(item, text);
          });
        });
      });
      actions.appendChild(importBtn);
    } else if (item.kind === 'evidence') {
      var sendBtn = aibMakeButton('証憑として送る', 'aib-btn aib-btn-primary', function () {
        aibRunAction(row, sendBtn, item, 'evidence_sent', function () {
          return aibReadFileBase64(item.id).then(function (b64) {
            if (typeof handlers.onSendEvidence !== 'function') throw new Error('送信先が未設定です（アプリ側の実装待ち）');
            return handlers.onSendEvidence(item, b64);
          });
        });
      });
      actions.appendChild(sendBtn);
    }

    var ignoreBtn = aibMakeButton('無視する', 'aib-btn aib-btn-ghost', function () {
      aibMarkProcessed(item.id, 'ignored');
      if (row.parentNode) row.parentNode.removeChild(row);
      if (typeof handlers.onIgnore === 'function') { try { handlers.onIgnore(item); } catch (e) {} }
    });
    actions.appendChild(ignoreBtn);

    row.appendChild(main);
    row.appendChild(actions);
    return row;
  }

  function aibRenderGroup(kind, list, handlers) {
    var group = document.createElement('div'); group.className = 'aib-group';
    var title = document.createElement('div'); title.className = 'aib-group-title';
    title.textContent = KIND_LABEL[kind] + '（' + list.length + '件）';
    group.appendChild(title);
    list.forEach(function (item) { group.appendChild(aibRenderItemRow(item, handlers)); });
    return group;
  }

  function aibRenderResult(body, handlers, res) {
    aibClearEl(body);
    if (res.permission && res.permission !== 'granted') {
      var perm = document.createElement('div'); perm.className = 'aib-explain-sub';
      perm.textContent = 'フォルダへのアクセスが許可されていません。「再スキャン」を押すとブラウザの許可ダイアログが表示されます。';
      body.appendChild(perm);
      return;
    }
    var items = res.items || [];
    if (!items.length) {
      var empty = document.createElement('div'); empty.className = 'aib-empty'; empty.textContent = '新しいファイルはありません';
      body.appendChild(empty);
    } else {
      var summary = document.createElement('div'); summary.className = 'aib-summary';
      summary.textContent = aibSummaryText(items);
      body.appendChild(summary);
      var groups = aibGroupItems(items);
      KIND_ORDER.forEach(function (kind) {
        var list = groups[kind];
        if (list && list.length) body.appendChild(aibRenderGroup(kind, list, handlers));
      });
    }
    if (res.capped) {
      var capNote = document.createElement('div'); capNote.className = 'aib-note-warn';
      capNote.textContent = 'フォルダ内に対象ファイルが' + res.totalCandidates + '件あり、最新の' + MAX_FILES + '件のみ表示しています。専用フォルダに分けることをおすすめします。';
      body.appendChild(capNote);
    }
    if (res.errors && res.errors.length) {
      var errBox = document.createElement('div'); errBox.className = 'aib-errors';
      var errTitle = document.createElement('div'); errTitle.className = 'aib-errors-title'; errTitle.textContent = '読み込めなかったファイル';
      errBox.appendChild(errTitle);
      res.errors.forEach(function (e) {
        var errRow = document.createElement('div'); errRow.className = 'aib-error-row';
        var n = document.createElement('span'); n.className = 'aib-error-name'; n.textContent = e.name;
        var m = document.createElement('span'); m.className = 'aib-error-note'; m.textContent = e.note;
        errRow.appendChild(n); errRow.appendChild(m);
        errBox.appendChild(errRow);
      });
      body.appendChild(errBox);
    }
  }

  function aibRenderConnected(container, handlers, info) {
    aibClearEl(container);
    var header = document.createElement('div'); header.className = 'aib-header';
    var folderInfo = document.createElement('div'); folderInfo.className = 'aib-folder-info';
    var icon = document.createElement('span'); icon.className = 'aib-folder-icon'; icon.textContent = '📁';
    var nameEl = document.createElement('span'); nameEl.className = 'aib-folder-name'; nameEl.textContent = info.name || 'フォルダ';
    folderInfo.appendChild(icon); folderInfo.appendChild(nameEl);

    var btnRow = document.createElement('div'); btnRow.className = 'aib-header-actions';
    var rescanBtn = aibMakeButton('🔄 再スキャン', 'aib-btn', function () { aibRenderConnected(container, handlers, info); });
    var forgetBtn = aibMakeButton('解除', 'aib-btn aib-btn-ghost', function () {
      aibForgetFolder().then(function () { aibRenderPanel(container, handlers); });
    });
    btnRow.appendChild(rescanBtn); btnRow.appendChild(forgetBtn);
    header.appendChild(folderInfo); header.appendChild(btnRow);
    container.appendChild(header);

    var body = document.createElement('div'); body.className = 'aib-body';
    var loading = document.createElement('div'); loading.className = 'aib-loading'; loading.textContent = 'スキャン中…';
    body.appendChild(loading);
    container.appendChild(body);

    aibScan().then(function (res) {
      aibRenderResult(body, handlers, res);
    }, function (e) {
      aibClearEl(body);
      var err = document.createElement('div'); err.className = 'aib-error';
      err.textContent = 'スキャンに失敗しました: ' + ((e && e.message) || e);
      body.appendChild(err);
    });
  }

  /* 受信箱UIを container 配下に描画する。呼ぶタイミングは「取込」タブが実際に開かれた/表示された時
   * にすること（起動時に無条件では呼ばない＝アプリ起動をブロックしないため）。 */
  function aibRenderPanel(container, handlers) {
    if (!container) return;
    handlers = handlers || {};
    container.classList.add('aib-panel');
    aibClearEl(container);

    if (!aibIsSupported()) { aibRenderUnsupported(container); return; }

    var loading = document.createElement('div'); loading.className = 'aib-loading'; loading.textContent = '確認中…';
    container.appendChild(loading);

    aibGetFolderInfo().then(function (info) {
      if (!info.connected) { aibRenderNotConnected(container, handlers); return; }
      aibRenderConnected(container, handlers, info);
    }, function (e) {
      aibClearEl(container);
      var err = document.createElement('div'); err.className = 'aib-error';
      err.textContent = '確認に失敗しました: ' + ((e && e.message) || e);
      container.appendChild(err);
    });
  }

  /* ==================== 10. 公開API ==================== */
  window.aibIsSupported = aibIsSupported;
  window.aibChooseFolder = aibChooseFolder;
  window.aibGetFolderInfo = aibGetFolderInfo;
  window.aibScan = aibScan;
  window.aibMarkProcessed = aibMarkProcessed;
  window.aibReadFileText = aibReadFileText;
  window.aibReadFileBase64 = aibReadFileBase64;
  window.aibRenderPanel = aibRenderPanel;
  // 棚番→出品アカウント判定。取込先の自動選択に使うほか、
  // 「なぜこのアカウントと判定されたか」を確認・検証できるよう公開する
  window.aibDetectAccount = aibDetectAccount;
  window.aibForgetFolder = aibForgetFolder;

  /* テスト用（Node vm サンドボックス）に内部関数へのアクセスを許す。ブラウザ実行には無害。 */
  window.__aibInternal = {
    classifyCsv: aibClassifyCsv,
    parseCsv: aibParseCsv,
    shipTypeOf: aibShipTypeOf,
    mercariShopsLike: aibMercariShopsLike
  };
})();
