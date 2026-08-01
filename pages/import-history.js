'use strict';
/* RIBRE 売上管理 — 取込履歴とチャネル一括訂正 (pages/import-history.js)
 *
 * 背景: 「202607ヤフオク4.csv」を取込む際、取込元プルダウンが「ヤフオク1」のままだったため
 * その回のCSV分の売上行が丸ごと誤ったチャネルに紐付いてしまった。同種の事故が複数回発生しており、
 * 1件のCSVに300件超が入ることもあるため、行単位の修正（AIアシスタントの50件上限つき提案を含む）
 * では対応できない。CSVファイル名×現在のチャネルで「取込バッチ」をグルーピングし、
 * バッチ単位で「チャネルを一括変更」または「このバッチを削除（再取込前提）」できるようにする。
 *
 * 依存（読み込み専用・このファイルでは変更しない）:
 *   services/core.js: get/setLS/LS/createLocalSnapshot/sales/yen
 *   pages/app-v2.js : appvIsMonthLocked/appvSyncYahoo/appvAfterWrite/appvPushCloudSafe/
 *                     APPV_SALES_CHANNELS（constのためwindowには出ないので複製を持つ。下記参照）
 * このファイルは index.html への統合対象外（FILES YOU OWNの範囲外）。
 * script読込は services/core.js・pages/app-v2.js より後に置くこと（下記依存関数を使うため）。
 *
 * ==================== memoパース規則（根拠） ====================
 * pages/app-v2.js の appvImportYahooCsv が売上CSV取込行に必ず刻む形式（同ファイル5017-5023行目）:
 *   memo:   (isYahoo ? 'ヤフオク売上CSV' : account + '売上CSV') + ' / ' + file.name
 *   source: 'YahooCSV Ver60.0'
 * 同一ファイルの再取込による「文字化けmemoの補完更新」（4991-4994行目）でも全く同じ式で
 * memoが再スタンプされる。したがって元CSVファイル名は memo の " / " 以降から復元できる。
 * 月締め appvCloseMonth（4857行目）は締め済み行のmemo末尾に " / [LOCK]" を追加で付与するため、
 * ファイル名抽出時はこれを取り除く（file.name はWindowsのファイル名の性質上 "/" を含み得ないため、
 * " / " 区切りでの分割は安全）。
 * 配送CSV照合（appvMatchShipping）は matchStatus フィールドを更新するのみで memo/source には
 * 触れない。手入力行は source:'manual' で上記 source と一致しないため、
 * source==='YahooCSV Ver60.0' であることをまず要求し、手入力・配送CSVの行を確実に除外している。
 */

/* ==================== チャネル一覧 ====================
 * pages/app-v2.js:35 の APPV_SALES_CHANNELS と同一内容。app-v2.js はプレーンscriptで
 * const 宣言のため window.APPV_SALES_CHANNELS としては公開されていない（2026-08-01時点で確認）。
 * 将来 window.APPV_SALES_CHANNELS が公開されたらそちらを優先して使う。
 * ★注意: app-v2.js側でチャネルが増減した場合、このAIH_SALES_CHANNELS_FALLBACKも必ず同期して直すこと★ */
var AIH_SALES_CHANNELS_FALLBACK = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリ', 'メルカリShops', 'ラクマ'];
function aihChannelList() {
  if (typeof window !== 'undefined' && Array.isArray(window.APPV_SALES_CHANNELS) && window.APPV_SALES_CHANNELS.length) {
    return window.APPV_SALES_CHANNELS.slice();
  }
  return AIH_SALES_CHANNELS_FALLBACK.slice();
}

var AIH_AUDIT_KEY = 'ribre_import_fix_audit_v1';
var AIH_AUDIT_CAP = 50;

/* ==================== memoパース ====================
 * CSV売上取込行だけを対象にする（sourceでの絞り込み＋memo形式の正規表現一致の両方を要求）。
 * どちらか一方でも外れる行（手入力/配送CSVのみの更新/明細等）はバッチとして扱わない。 */
function aihParseCsvMemo(row) {
  if (!row || row.source !== 'YahooCSV Ver60.0') return null;
  var memo = String(row.memo || '');
  var m = /^(.+?売上CSV) \/ (.+)$/.exec(memo);
  if (!m) return null;
  var file = m[2].replace(/\s*\/\s*\[LOCK\]\s*$/, '').trim();
  if (!file) return null;
  return { file: file };
}
function aihMatchesBatch(row, file, shop) {
  var parsed = aihParseCsvMemo(row);
  if (!parsed) return false;
  if (parsed.file !== file) return false;
  return String(row.shop || '') === String(shop || '');
}
function aihRowMonth(row) {
  return (row && row.month) || String((row && row.date) || '').slice(0, 7);
}
function aihIsMonthLocked(month) {
  try {
    if (typeof appvIsMonthLocked === 'function') return appvIsMonthLocked(month);
    if (typeof window !== 'undefined' && typeof window.appvIsMonthLocked === 'function') return window.appvIsMonthLocked(month);
  } catch (e) {}
  return false; // 判定関数が読み込まれていない場合は「ロックなし」扱い（安全側ではないが、
  // 依存の読み込み順を誤っていること自体を早期に気づけるよう、無条件ブロックはしない）
}
function aihSyncYahoo(row, shop, mode) {
  try {
    if (typeof appvSyncYahoo === 'function') { appvSyncYahoo(row, shop, mode); return; }
    if (typeof window !== 'undefined' && typeof window.appvSyncYahoo === 'function') { window.appvSyncYahoo(row, shop, mode); return; }
  } catch (e) {}
}

/* ==================== 一覧（読み取り専用・副作用なし） ====================
 * 戻り値: [{key, file, shop, count, dateFrom, dateTo, totalAmount}]（新しい順）
 * key は JSON.stringify([file, shop]) の文字列。aihChangeChannel/aihDeleteBatch に
 * そのまま渡す不透明なIDとして扱う。 */
function aihListBatches() {
  var rows = get(LS.sales, []);
  if (!Array.isArray(rows)) rows = [];
  var groups = {};
  var order = [];
  rows.forEach(function (row) {
    var parsed = aihParseCsvMemo(row);
    if (!parsed) return;
    var shop = String(row.shop || '');
    var key = JSON.stringify([parsed.file, shop]);
    var g = groups[key];
    if (!g) {
      g = { key: key, file: parsed.file, shop: shop, count: 0, dateFrom: null, dateTo: null, totalAmount: 0 };
      groups[key] = g;
      order.push(key);
    }
    g.count++;
    var d = String(row.date || '');
    if (d) {
      if (!g.dateFrom || d < g.dateFrom) g.dateFrom = d;
      if (!g.dateTo || d > g.dateTo) g.dateTo = d;
    }
    g.totalAmount += Number(row.amount || row.price || 0);
  });
  var list = order.map(function (k) { return groups[k]; });
  list.sort(function (a, b) {
    var ad = a.dateTo || '';
    var bd = b.dateTo || '';
    if (ad !== bd) return ad < bd ? 1 : -1; // 日付が新しい方を先に
    if (a.file !== b.file) return a.file < b.file ? -1 : 1;
    return a.shop < b.shop ? -1 : (a.shop > b.shop ? 1 : 0);
  });
  return list;
}

/* ==================== undo用: 直前の変更のスナップショット（1回きり。ai-write.jsのaiwUndoLastApplyと同じ考え方） ==================== */
var aihLastSnapshotForUndo = null;

/* ==================== 監査ログ ==================== */
function aihAppendAudit(entry) {
  var rows = [];
  try { rows = get(AIH_AUDIT_KEY, []); } catch (e) { rows = []; }
  if (!Array.isArray(rows)) rows = [];
  rows.unshift(entry);
  try { setLS(AIH_AUDIT_KEY, rows.slice(0, AIH_AUDIT_CAP)); } catch (e) {}
}
function aihGetAuditLog() {
  try { return get(AIH_AUDIT_KEY, []); } catch (e) { return []; }
}

/* ==================== チャネルを一括変更 ====================
 * 戻り値: {ok, changed, skippedLocked, error} */
async function aihChangeChannel(key, newShop) {
  var parsedKey;
  try { parsedKey = JSON.parse(key); } catch (e) {
    return { ok: false, error: '不正な取込分の指定です', changed: 0, skippedLocked: 0 };
  }
  var file = parsedKey[0];
  var oldShop = String(parsedKey[1] || '');
  var shopTo = String(newShop || '').trim();
  if (!shopTo) return { ok: false, error: '変更先のチャネルを選択してください', changed: 0, skippedLocked: 0 };
  if (aihChannelList().indexOf(shopTo) < 0) return { ok: false, error: '不正なチャネルです: ' + shopTo, changed: 0, skippedLocked: 0 };
  if (shopTo === oldShop) return { ok: false, error: '変更前と同じチャネルです', changed: 0, skippedLocked: 0 };

  var rows = get(LS.sales, []);
  if (!Array.isArray(rows)) rows = [];
  var targets = [];
  var skippedLocked = 0;
  rows.forEach(function (row) {
    if (!aihMatchesBatch(row, file, oldShop)) return;
    if (aihIsMonthLocked(aihRowMonth(row))) { skippedLocked++; return; }
    targets.push(row);
  });

  if (!targets.length && !skippedLocked) {
    return { ok: false, error: '対象の取込分が見つかりませんでした（既に変更・削除済みの可能性があります）', changed: 0, skippedLocked: 0 };
  }
  if (!targets.length) {
    // 該当行は全て締め済み月 → 変更なしで正常終了（何も書き込まない）
    return { ok: true, changed: 0, skippedLocked: skippedLocked, error: null };
  }

  // ---- ここまでは読み取りのみ。最初の変更の直前でバックアップを取る（失敗したら中止・書込ゼロ） ----
  var snap;
  try {
    snap = createLocalSnapshot('before import fix: change channel (' + file + ')');
  } catch (e) {
    return { ok: false, error: 'バックアップの作成に失敗したため中止しました: ' + ((e && e.message) || e), changed: 0, skippedLocked: skippedLocked };
  }
  aihLastSnapshotForUndo = snap;

  targets.forEach(function (row) {
    row.shop = shopTo;
    aihSyncYahoo(row, row.shop, 'edit'); // ribre_yahoo_sales240側も必ず同期（次回CSV取込での巻き戻り防止）
  });
  setLS(LS.sales, rows); // 一括変更後の配列を一回だけ書く

  try { if (typeof appvAfterWrite === 'function') await appvAfterWrite(); } catch (e) {}
  try { if (typeof appvPushCloudSafe === 'function') await appvPushCloudSafe(); } catch (e) {}

  aihAppendAudit({ at: new Date().toISOString(), action: 'change_channel', file: file, from: oldShop, to: shopTo, changed: targets.length, skippedLocked: skippedLocked });

  return { ok: true, changed: targets.length, skippedLocked: skippedLocked, error: null };
}

/* ==================== 取込バッチを削除（再取込前提） ====================
 * 戻り値: {ok, deleted, skippedLocked, error} */
async function aihDeleteBatch(key) {
  var parsedKey;
  try { parsedKey = JSON.parse(key); } catch (e) {
    return { ok: false, error: '不正な取込分の指定です', deleted: 0, skippedLocked: 0 };
  }
  var file = parsedKey[0];
  var shop = String(parsedKey[1] || '');

  var rows = get(LS.sales, []);
  if (!Array.isArray(rows)) rows = [];
  var toDelete = [];
  var skippedLocked = 0;
  rows.forEach(function (row) {
    if (!aihMatchesBatch(row, file, shop)) return;
    if (aihIsMonthLocked(aihRowMonth(row))) { skippedLocked++; return; }
    toDelete.push(row);
  });

  if (!toDelete.length && !skippedLocked) {
    return { ok: false, error: '対象の取込分が見つかりませんでした（既に変更・削除済みの可能性があります）', deleted: 0, skippedLocked: 0 };
  }
  if (!toDelete.length) {
    return { ok: true, deleted: 0, skippedLocked: skippedLocked, error: null };
  }

  // ---- ここまでは読み取りのみ。最初の変更の直前でバックアップを取る（失敗したら中止・書込ゼロ） ----
  var snap;
  try {
    snap = createLocalSnapshot('before import batch delete');
  } catch (e) {
    return { ok: false, error: 'バックアップの作成に失敗したため中止しました: ' + ((e && e.message) || e), deleted: 0, skippedLocked: skippedLocked };
  }
  aihLastSnapshotForUndo = snap;

  // identity(オブジェクト参照)で対象行を特定し、一括で1回だけ書く（index計算のズレを避ける）
  var deleteSet = new Set(toDelete);
  var remaining = rows.filter(function (row) { return !deleteSet.has(row); });
  setLS(LS.sales, remaining);
  toDelete.forEach(function (row) {
    aihSyncYahoo(row, null, 'delete'); // ribre_yahoo_sales240側からも必ず削除（ミラー同期必須）
  });

  try { if (typeof appvAfterWrite === 'function') await appvAfterWrite(); } catch (e) {}
  try { if (typeof appvPushCloudSafe === 'function') await appvPushCloudSafe(); } catch (e) {}

  aihAppendAudit({ at: new Date().toISOString(), action: 'delete', file: file, from: shop, to: null, changed: toDelete.length, skippedLocked: skippedLocked });

  return { ok: true, deleted: toDelete.length, skippedLocked: skippedLocked, error: null };
}

/* ==================== 元に戻す（直前の変更のみ・1回きり） ==================== */
async function aihUndoLast() {
  if (!aihLastSnapshotForUndo) {
    return { ok: false, error: '元に戻せる変更がありません（直前のバックアップが見つかりません）。' };
  }
  var snap = aihLastSnapshotForUndo;
  try {
    setLS(LS.sales, snap.sales || []);
    setLS(LS.purchases, snap.purchases || []);
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(snap.yahooSales || []));
    setLS(LS.ev, snap.evidences || []);
    setLS(LS.cand, snap.candidates || []);
  } catch (e) {
    return { ok: false, error: '復元に失敗しました: ' + ((e && e.message) || e) };
  }
  aihLastSnapshotForUndo = null; // 多重undo防止（一度使ったら消す。ai-write.jsと同じ考え方）
  try { if (typeof appvAfterWrite === 'function') await appvAfterWrite(); } catch (e) {}
  try { if (typeof appvPushCloudSafe === 'function') await appvPushCloudSafe(); } catch (e) {}
  aihAppendAudit({ at: new Date().toISOString(), action: 'undo', file: null, from: null, to: null, changed: 0, skippedLocked: 0 });
  return { ok: true };
}

/* ==================== UI描画（createElement/textContentのみ。innerHTMLは使わない） ==================== */
function aihYen(n) {
  if (typeof yen === 'function') return yen(n);
  return (Number(n) || 0).toLocaleString() + '円';
}
function aihDateRangeLabel(batch) {
  if (!batch.dateFrom && !batch.dateTo) return '（日付不明）';
  if (batch.dateFrom === batch.dateTo) return batch.dateFrom;
  return batch.dateFrom + ' 〜 ' + batch.dateTo;
}

function aihRenderPanel(container) {
  if (!container) return;
  while (container.firstChild) container.removeChild(container.firstChild);

  var wrap = document.createElement('div');
  wrap.className = 'aih-panel';

  var title = document.createElement('h2');
  title.textContent = '取込履歴とチャネル一括訂正';
  wrap.appendChild(title);

  var caution = document.createElement('div');
  caution.className = 'aih-caution';
  caution.textContent = '変更前に自動でバックアップを取ります。締め済みの月の行は変更されません。';
  wrap.appendChild(caution);

  var list = aihListBatches();
  if (!list.length) {
    var empty = document.createElement('div');
    empty.className = 'aih-empty';
    empty.textContent = 'CSV取込の履歴が見つかりませんでした。';
    wrap.appendChild(empty);
    container.appendChild(wrap);
    return;
  }

  var listEl = document.createElement('div');
  listEl.className = 'aih-list';
  list.forEach(function (batch) {
    listEl.appendChild(aihBuildBatchRow(batch, container));
  });
  wrap.appendChild(listEl);

  container.appendChild(wrap);
}

function aihBuildBatchRow(batch, rootContainer) {
  var row = document.createElement('div');
  row.className = 'aih-row';

  var head = document.createElement('div');
  head.className = 'aih-row-head';
  var fileEl = document.createElement('div');
  fileEl.className = 'aih-file';
  fileEl.textContent = batch.file;
  head.appendChild(fileEl);
  var shopBadge = document.createElement('span');
  shopBadge.className = 'aih-badge aih-badge-shop';
  shopBadge.textContent = batch.shop || '（チャネル未設定）';
  head.appendChild(shopBadge);
  var countBadge = document.createElement('span');
  countBadge.className = 'aih-badge aih-badge-count';
  countBadge.textContent = batch.count + '件';
  head.appendChild(countBadge);
  row.appendChild(head);

  var meta = document.createElement('div');
  meta.className = 'aih-row-meta';
  meta.textContent = aihDateRangeLabel(batch) + '　合計 ' + aihYen(batch.totalAmount);
  row.appendChild(meta);

  var actions = document.createElement('div');
  actions.className = 'aih-row-actions';

  var changeBtn = document.createElement('button');
  changeBtn.type = 'button';
  changeBtn.className = 'aih-btn aih-btn-primary';
  changeBtn.textContent = 'チャネルを変更';
  actions.appendChild(changeBtn);

  var deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'aih-btn aih-btn-danger';
  deleteBtn.textContent = 'この取込分を削除';
  actions.appendChild(deleteBtn);

  row.appendChild(actions);

  var hint = document.createElement('div');
  hint.className = 'aih-hint';
  hint.textContent = 'チャネル名を間違えただけなら「チャネルを変更」の方が安全です（削除は送料・伝票番号・配送業者など取込後に付いた情報も一緒に消えます）。';
  row.appendChild(hint);

  var formArea = document.createElement('div');
  formArea.className = 'aih-form-area';
  row.appendChild(formArea);

  var resultArea = document.createElement('div');
  resultArea.className = 'aih-result-area';
  row.appendChild(resultArea);

  changeBtn.addEventListener('click', function () {
    while (formArea.firstChild) formArea.removeChild(formArea.firstChild);
    while (resultArea.firstChild) resultArea.removeChild(resultArea.firstChild);
    formArea.appendChild(aihBuildChangeForm(batch, formArea, resultArea, rootContainer));
  });

  deleteBtn.addEventListener('click', function () {
    aihHandleDeleteClick(batch, deleteBtn, changeBtn, resultArea, rootContainer);
  });

  return row;
}

function aihBuildChangeForm(batch, formArea, resultArea, rootContainer) {
  var form = document.createElement('div');
  form.className = 'aih-change-form';

  var selectRow = document.createElement('div');
  selectRow.className = 'aih-select-row';
  var label = document.createElement('label');
  label.textContent = '変更先チャネル: ';
  var select = document.createElement('select');
  select.className = 'aih-select';
  var placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '選択してください';
  select.appendChild(placeholder);
  aihChannelList().forEach(function (c) {
    if (c === batch.shop) return; // 変更前と同じチャネルは選択肢から除く
    var opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
  label.appendChild(select);
  selectRow.appendChild(label);
  form.appendChild(selectRow);

  var preview = document.createElement('div');
  preview.className = 'aih-preview';
  preview.textContent = '変更先チャネルを選択してください。';
  form.appendChild(preview);

  select.addEventListener('change', function () {
    if (!select.value) {
      preview.textContent = '変更先チャネルを選択してください。';
      return;
    }
    preview.textContent = batch.count + '件を『' + batch.shop + '』→『' + select.value + '』に変更します';
  });

  var actions = document.createElement('div');
  actions.className = 'aih-form-actions';

  var execBtn = document.createElement('button');
  execBtn.type = 'button';
  execBtn.className = 'aih-btn aih-btn-primary';
  execBtn.textContent = '実行';
  actions.appendChild(execBtn);

  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'aih-btn aih-btn-ghost';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', function () {
    while (formArea.firstChild) formArea.removeChild(formArea.firstChild);
  });
  actions.appendChild(cancelBtn);

  form.appendChild(actions);

  execBtn.addEventListener('click', function () {
    var newShop = select.value;
    if (!newShop) { alert('変更先のチャネルを選択してください'); return; }
    var msg = batch.count + '件を「' + batch.shop + '」から「' + newShop + '」へ変更します。\n' +
      '変更前に自動でバックアップを取ります。実行しますか？';
    if (!confirm(msg)) return;
    execBtn.disabled = true;
    cancelBtn.disabled = true;
    execBtn.textContent = '実行中…';
    aihChangeChannel(batch.key, newShop).then(function (result) {
      while (formArea.firstChild) formArea.removeChild(formArea.firstChild);
      aihRenderActionResult(resultArea, result, {
        okMessage: function (r) {
          var s = r.changed + '件を「' + batch.shop + '」から「' + newShop + '」へ変更しました。';
          if (r.skippedLocked) s += '（締め済みのため対象外: ' + r.skippedLocked + '件）';
          return s;
        }
      }, rootContainer);
    }).catch(function (e) {
      aihRenderActionResult(resultArea, { ok: false, error: (e && e.message) || String(e) }, {}, rootContainer);
    });
  });

  return form;
}

function aihHandleDeleteClick(batch, deleteBtn, changeBtn, resultArea, rootContainer) {
  var msg = 'この取込分 ' + batch.count + '件 を削除します。\n' +
    '削除すると、取込後に配送CSV照合や手入力で付いた送料・伝票番号・配送業者の情報も一緒に消えます（CSVを取り込み直しても戻りません）。\n' +
    'チャネル名を直したいだけなら「チャネルを変更」の方が安全です。\n' +
    '削除前に自動でバックアップを取ります。実行しますか？';
  if (!confirm(msg)) return;
  deleteBtn.disabled = true;
  changeBtn.disabled = true;
  deleteBtn.textContent = '削除中…';
  aihDeleteBatch(batch.key).then(function (result) {
    aihRenderActionResult(resultArea, result, {
      okMessage: function (r) {
        var s = r.deleted + '件を削除しました。CSVを取込元プルダウンを正しく設定して再取込してください。';
        if (r.skippedLocked) s += '（締め済みのため対象外: ' + r.skippedLocked + '件）';
        return s;
      }
    }, rootContainer);
  }).catch(function (e) {
    aihRenderActionResult(resultArea, { ok: false, error: (e && e.message) || String(e) }, {}, rootContainer);
  });
}

function aihRenderActionResult(resultArea, result, opts, rootContainer) {
  while (resultArea.firstChild) resultArea.removeChild(resultArea.firstChild);
  opts = opts || {};
  if (!result || !result.ok) {
    var errLine = document.createElement('div');
    errLine.className = 'aih-result-error';
    errLine.textContent = '⚠ ' + ((result && result.error) || '処理に失敗しました。');
    resultArea.appendChild(errLine);
    return;
  }
  var okLine = document.createElement('div');
  okLine.className = 'aih-result-ok';
  okLine.textContent = '✅ ' + (opts.okMessage ? opts.okMessage(result) : '実行しました。');
  resultArea.appendChild(okLine);

  var undoBtn = document.createElement('button');
  undoBtn.type = 'button';
  undoBtn.className = 'aih-btn aih-btn-ghost';
  undoBtn.textContent = '元に戻す';
  undoBtn.addEventListener('click', function () {
    undoBtn.disabled = true;
    undoBtn.textContent = '元に戻しています…';
    aihUndoLast().then(function (undoResult) {
      if (undoResult && undoResult.ok) {
        aihRenderPanel(rootContainer); // データが変わったので一覧ごと再描画
      } else {
        undoBtn.disabled = false;
        undoBtn.textContent = '元に戻す';
        var undoErr = document.createElement('div');
        undoErr.className = 'aih-result-error';
        undoErr.textContent = '⚠ 元に戻せませんでした: ' + ((undoResult && undoResult.error) || '');
        resultArea.appendChild(undoErr);
      }
    });
  });
  resultArea.appendChild(undoBtn);
}

/* ==================== グローバル公開 ==================== */
if (typeof window !== 'undefined') {
  window.aihListBatches = aihListBatches;
  window.aihChangeChannel = aihChangeChannel;
  window.aihDeleteBatch = aihDeleteBatch;
  window.aihUndoLast = aihUndoLast;
  window.aihRenderPanel = aihRenderPanel;
  window.aihGetAuditLog = aihGetAuditLog;
}
