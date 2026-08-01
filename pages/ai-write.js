'use strict';
/* RIBRE 売上管理 — AIによるデータ変更エンジン（提案 → 人間の承認 → 実行）
 * ------------------------------------------------------------------------
 * 目的: pages/ai-assistant.js は読み取り専用（query_data/list_rows）だが、
 *   オーナーはAIに「7月のヤフオク1の◯◯を削除して」のような変更も頼みたい。
 *   ただし売上・仕入は実際の会計データであり、AIの応答だけで書き換えることは
 *   絶対に許してはいけない。
 *
 * 設計方針（変更しないこと）:
 *  - このファイルの aiwProposeUpdate/aiwProposeDelete は「提案オブジェクト」を
 *    返すだけで、localStorage・sales()・purchases() を一切書き換えない（純粋関数）。
 *    実際にsales/purchases配列を書き換えるのは aiwApplyProposal のみであり、
 *    それは人間がUI上で「実行」ボタンを押した時にだけ呼ばれる想定。
 *    モデルの応答（テキスト・ツール呼び出し）だけではデータは絶対に変わらない。
 *  - フィルタ語彙（source/month/month_from/month_to/shop/vendor/name_contains/
 *    memo_contains/amount_min/amount_max）は pages/ai-assistant.js の
 *    aiqPickFilters/aiqApplyFilters と完全に同じ意味・同じ挙動になるよう、
 *    このファイル内に aiw* として複製している（読み込み順に依存させないため。
 *    ai-assistant.js自身もcore.jsのnum()に依存せず自己完結させているのと同じ理由）。
 *    amount_min/amount_max が 0 の場合は「指定なし」として扱う点も同一。
 *  - 危険な操作（更新・削除の実行）は必ず以下の安全策を全て通ってから行う:
 *      1. 行数上限（修正50件・削除10件）を超える提案は実行不可
 *      2. 0件マッチは ok:false（黙って成功しない）
 *      3. 締め済み月(appvIsMonthLocked)の行は必ずblockedへ（絶対に変更しない）
 *      4. appvFindLocalRowIndexが一意に特定できない行(-1)は必ずblockedへ
 *      5. 実行直前に createLocalSnapshot() でバックアップ（失敗したら中断・書込ゼロ）
 *      6. 提案時点のfingerprint(行の内容のJSON)と実行時点を比較し、変化があれば中断
 *      7. 売上行は appvSyncYahoo でribre_yahoo_sales240側も必ず同期（CSV取込での消失事故と同じ経路を塞ぐ）
 *      8. 監査ログ(ribre_ai_write_audit_v1)に実行結果を必ず記録
 *      9. 提案の有効期限は10分（古い提案は実行不可）
 *  - 既存インフラの再利用（新しい書込み経路を自作しない）:
 *      services/core.js: sales()/purchases()/get/setLS/LS/createLocalSnapshot
 *      pages/app-v2.js : appvFindLocalRowIndex/appvSyncYahoo/appvIsMonthLocked/
 *                        appvAfterWrite/appvPushCloudSafe
 *    このファイルは services/core.js・pages/app-v2.js より後に読み込まれる前提
 *    （index.htmlのscript順。ai-assistant.jsと同じ制約）。
 *  - 画面描画は textContent / createElement のみを使い、innerHTML は一切使わない
 *    （pages/mf-evidence.js・pages/ai-assistant.jsの安全なレンダリングパターンに合わせる）。
 * ------------------------------------------------------------------------ */

/* ==================== 数値・行の共通ヘルパー（ai-assistant.js の aiq* と同一規則） ==================== */
function aiwNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  var n = Number(String(v == null ? '' : v).replace(/[¥,円\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function aiwIsMeiRow(r) {
  return String((r && r.source) || '') === '明細';
}
function aiwIsExpenseRow(r) {
  return /^\[経費\]/.test(String((r && r.memo) || '').trim());
}
function aiwRowMonth(r) {
  var v = (r && (r.month || r.date)) || '';
  return String(v).slice(0, 7);
}
function aiwSaleAmount(r) {
  return aiwNum(r && r.amount != null ? r.amount : r && r.price);
}
function aiwPurchaseAmount(r) {
  return aiwNum(r && r.total != null ? r.total : r && r.amount);
}

/* ==================== フィルタ引数の許可リスト（aiqPickFilters と完全に同じ規則） ==================== */
var AIW_SOURCE_VALUES = ['sales', 'purchases', 'expenses'];

function aiwPickFilters(args) {
  var a = args && typeof args === 'object' ? args : {};
  var out = {
    source: typeof a.source === 'string' ? a.source : '',
    month: typeof a.month === 'string' ? a.month : '',
    month_from: typeof a.month_from === 'string' ? a.month_from : '',
    month_to: typeof a.month_to === 'string' ? a.month_to : '',
    shop: typeof a.shop === 'string' ? a.shop.trim() : '',
    vendor: typeof a.vendor === 'string' ? a.vendor.trim() : '',
    name_contains: typeof a.name_contains === 'string' ? a.name_contains : '',
    memo_contains: typeof a.memo_contains === 'string' ? a.memo_contains : '',
    amount_min: null,
    amount_max: null
  };
  // 0は「指定なし」（aiqPickFiltersの回帰対策と同じ理由。0円で絞り込みたい実務上の場面はない）
  var minRaw = aiwNum(a.amount_min);
  var maxRaw = aiwNum(a.amount_max);
  if (minRaw > 0) out.amount_min = minRaw;
  if (maxRaw > 0) out.amount_max = maxRaw;
  return out;
}

function aiwApplyFilters(rows, f, isSalesLike) {
  return (rows || []).filter(function (r) {
    var m = aiwRowMonth(r);
    if (f.month && m !== f.month) return false;
    if (f.month_from && m < f.month_from) return false;
    if (f.month_to && m > f.month_to) return false;
    if (isSalesLike && f.shop) {
      if (String(r.shop || '').trim() !== f.shop) return false;
    }
    if (!isSalesLike && f.vendor) {
      if (String(r.vendor || '').trim() !== f.vendor) return false;
    }
    if (f.name_contains) {
      if (String(r.name || '').toLowerCase().indexOf(f.name_contains.toLowerCase()) < 0) return false;
    }
    if (f.memo_contains) {
      if (String(r.memo || '').toLowerCase().indexOf(f.memo_contains.toLowerCase()) < 0) return false;
    }
    var amt = isSalesLike ? aiwSaleAmount(r) : aiwPurchaseAmount(r);
    if (f.amount_min != null && amt < f.amount_min) return false;
    if (f.amount_max != null && amt > f.amount_max) return false;
    return true;
  });
}

/* ==================== 対象行の取得（source別。明細行・経費/非経費の切り分けはaiqBaseRowsと同一規則） ==================== */
function aiwRawSalesRows() {
  var rows = typeof sales === 'function' ? sales() : [];
  return (Array.isArray(rows) ? rows : []).filter(function (r) { return !aiwIsMeiRow(r); });
}
function aiwRawPurchaseRows(wantExpense) {
  var rows = typeof purchases === 'function' ? purchases() : [];
  return (Array.isArray(rows) ? rows : [])
    .filter(function (r) { return !aiwIsMeiRow(r); })
    .filter(function (r) { return aiwIsExpenseRow(r) === !!wantExpense; });
}
function aiwBaseRows(source) {
  if (source === 'sales') return aiwRawSalesRows();
  if (source === 'purchases') return aiwRawPurchaseRows(false);
  if (source === 'expenses') return aiwRawPurchaseRows(true);
  return [];
}

/* ==================== set（更新内容）の許可リスト ====================
 * date/name/partner/amount/memo の5キーのみ。動的プロパティアクセス・evalは一切行わない。
 * amountは0/不正値を「指定なし」として無視する（amount_min/maxと同じ安全側の解釈）。 */
function aiwPickSet(set) {
  if (!set || typeof set !== 'object') return null;
  var out = {};
  if (typeof set.date === 'string' && set.date) out.date = set.date;
  if (typeof set.name === 'string') out.name = set.name;
  if (typeof set.partner === 'string') out.partner = set.partner;
  if (set.amount != null) {
    var n = aiwNum(set.amount);
    if (n > 0) out.amount = n;
  }
  if (typeof set.memo === 'string') out.memo = set.memo;
  return out;
}

/* ==================== 表示用の行（提案UI・監査用） ==================== */
function aiwDisplayRow(row, isSalesLike) {
  return {
    date: row.date || '',
    partner: isSalesLike ? (row.shop || '') : (row.vendor || ''),
    name: row.name || '',
    amount: isSalesLike ? aiwSaleAmount(row) : aiwPurchaseAmount(row),
    memo: row.memo || ''
  };
}
function aiwApplySetForDisplay(before, setPicked, row, isSalesLike) {
  var after = { date: before.date, partner: before.partner, name: before.name, amount: before.amount, memo: before.memo };
  if (Object.prototype.hasOwnProperty.call(setPicked, 'date')) after.date = setPicked.date;
  if (Object.prototype.hasOwnProperty.call(setPicked, 'name')) after.name = setPicked.name;
  if (Object.prototype.hasOwnProperty.call(setPicked, 'partner')) after.partner = setPicked.partner;
  if (Object.prototype.hasOwnProperty.call(setPicked, 'amount')) after.amount = setPicked.amount;
  if (Object.prototype.hasOwnProperty.call(setPicked, 'memo')) {
    var isExpense = !isSalesLike && aiwIsExpenseRow(row);
    after.memo = isExpense ? ('[経費] ' + setPicked.memo).trim() : setPicked.memo;
  }
  return after;
}

/* 行の同一性フィンガープリント（提案時→実行時の変化検知用。docs/MF_JOURNAL_PLAN.md の
 * confirm_token（プレビューと確定の間にデータが変わったら中断する）と同じ考え方）。 */
function aiwFingerprint(row) {
  try { return JSON.stringify(row); } catch (e) { return 'x_' + Date.now() + '_' + Math.random(); }
}

/* ==================== 安全策の定数 ====================
 * 1回の提案で扱える行数の上限。削除と修正で分ける:
 *  - 削除は取り返しがつきにくいので10件のまま
 *  - 修正は取込元チャネルの一括訂正のような正当な用途で10件では足りない
 *    （実例: CSV1本を誤ったチャネルで取り込み、その分をまとめて直したい）。
 *    実行前に全行を画面で確認でき、直前に自動バックアップも取り、
 *    「元に戻す」もあるため、50件までは安全に扱えると判断した。 */
var AIW_MAX_ROWS_UPDATE = 50;
var AIW_MAX_ROWS_DELETE = 10;
var AIW_MAX_ROWS = AIW_MAX_ROWS_DELETE; // 後方互換（外部公開値は厳しい方を維持）
var AIW_PROPOSAL_TTL_MS = 10 * 60 * 1000; // 10分
var AIW_AUDIT_KEY = 'ribre_ai_write_audit_v1';
var AIW_AUDIT_CAP = 50;

/* ==================== 提案の保管（メモリ上のみ） ====================
 * aiwApplyProposal(proposalId) はIDしか受け取らない設計のため、提案本体は
 * このモジュール内のメモリに保持しておく必要がある（localStorageには書かない＝
 * 提案そのものは「データ」ではないため、これは aiwProposeUpdate/Delete の
 * 「pure・副作用なし」という制約（sales/purchases/localStorageの会計データを
 * 変更しない、という意味）には反しない）。ページを再読み込みすれば提案は消える。 */
var aiwProposals = {};

function aiwPruneExpiredProposals() {
  var now = Date.now();
  Object.keys(aiwProposals).forEach(function (id) {
    var p = aiwProposals[id];
    if (!p) return;
    if (p.applied || (now - p.createdAt > AIW_PROPOSAL_TTL_MS)) delete aiwProposals[id];
  });
}

/* ==================== 監査ログ ==================== */
function aiwAppendAudit(kind, rowCount, filters, applied, error) {
  var entry = {
    at: new Date().toISOString(),
    kind: kind,
    rowCount: rowCount,
    filters: filters || null,
    applied: !!applied,
    error: error || null
  };
  var rows = [];
  try { rows = (typeof get === 'function') ? get(AIW_AUDIT_KEY, []) : JSON.parse(localStorage.getItem(AIW_AUDIT_KEY) || '[]'); } catch (e) { rows = []; }
  if (!Array.isArray(rows)) rows = [];
  rows.unshift(entry);
  rows = rows.slice(0, AIW_AUDIT_CAP);
  try {
    if (typeof setLS === 'function') setLS(AIW_AUDIT_KEY, rows);
    else localStorage.setItem(AIW_AUDIT_KEY, JSON.stringify(rows));
  } catch (e) {}
  return entry;
}
function aiwGetAuditLog() {
  try { return (typeof get === 'function') ? get(AIW_AUDIT_KEY, []) : JSON.parse(localStorage.getItem(AIW_AUDIT_KEY) || '[]'); } catch (e) { return []; }
}

/* ==================== 提案の構築（純粋関数：sales/purchasesを一切書き換えない） ==================== */
function aiwBuildProposal(kind, args) {
  var a = args && typeof args === 'object' ? args : {};
  var f = aiwPickFilters(a);

  if (AIW_SOURCE_VALUES.indexOf(f.source) < 0) {
    return { ok: false, kind: kind, rows: [], blocked: [], filters: f, summary: 'source には sales / purchases / expenses のいずれかを指定してください。' };
  }

  var isSalesLike = f.source === 'sales';
  var setPicked = null;
  if (kind === 'update') {
    setPicked = aiwPickSet(a.set);
    if (!setPicked || !Object.keys(setPicked).length) {
      return { ok: false, kind: kind, rows: [], blocked: [], filters: f, summary: '更新内容(set)が指定されていません。date/name/partner/amount/memoのいずれかを指定してください。' };
    }
  }

  var matched = aiwApplyFilters(aiwBaseRows(f.source), f, isSalesLike);

  if (!matched.length) {
    return { ok: false, kind: kind, rows: [], blocked: [], filters: f, summary: '指定した条件に一致するデータが見つかりませんでした。条件を確認してください。' };
  }
  var maxRows = (kind === 'delete') ? AIW_MAX_ROWS_DELETE : AIW_MAX_ROWS_UPDATE;
  if (matched.length > maxRows) {
    return {
      ok: false, kind: kind, rows: [], blocked: [], filters: f,
      summary: '該当件数が' + matched.length + '件です。安全のため一度に' + maxRows + '件を超える'
        + (kind === 'delete' ? '削除' : '修正') + 'は提案できません。月・チャネル・取引先・金額範囲などで条件を絞り込んでください。'
    };
  }

  var rows = [];
  var blocked = [];
  matched.forEach(function (row) {
    var month = aiwRowMonth(row);
    if (typeof appvIsMonthLocked === 'function' && appvIsMonthLocked(month)) {
      blocked.push({ row: aiwDisplayRow(row, isSalesLike), reason: '締め済み月（' + (month || '不明') + '）のため対象外です。' });
      return;
    }
    var target = { type: isSalesLike ? 'sale' : 'purchase', id: row.id };
    var idx = (typeof appvFindLocalRowIndex === 'function') ? appvFindLocalRowIndex(target) : -1;
    if (idx < 0) {
      blocked.push({ row: aiwDisplayRow(row, isSalesLike), reason: 'この行は一意に特定できないため対象外です（同一内容の行が複数存在する可能性があります）。' });
      return;
    }
    var before = aiwDisplayRow(row, isSalesLike);
    var after = kind === 'update' ? aiwApplySetForDisplay(before, setPicked, row, isSalesLike) : null;
    rows.push({ before: before, after: after, _target: target, _fingerprint: aiwFingerprint(row) });
  });

  if (!rows.length) {
    return {
      ok: false, kind: kind, rows: [], blocked: blocked, filters: f,
      summary: '該当した' + matched.length + '件はすべて対象外（締め済み月、または行の一意特定不可）でした。'
    };
  }

  var id = 'aiw_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
  var proposal = {
    id: id,
    ok: true,
    kind: kind,
    createdAt: Date.now(),
    filters: f,
    source: f.source,
    set: kind === 'update' ? setPicked : null,
    rows: rows,
    blocked: blocked,
    applied: false,
    summary: (kind === 'update' ? '修正' : '削除') + '対象 ' + rows.length + '件' + (blocked.length ? '（他 ' + blocked.length + '件は対象外）' : '') + '。'
  };
  aiwPruneExpiredProposals();
  aiwProposals[id] = proposal;
  return proposal;
}

function aiwProposeUpdate(args) { return aiwBuildProposal('update', args); }
function aiwProposeDelete(args) { return aiwBuildProposal('delete', args); }

/* ==================== 実行（このモジュールで唯一データを書き換える関数） ==================== */
var aiwLastSnapshotForUndo = null; // 直前の適用で取ったスナップショット（undo用・1回きり）

async function aiwApplyProposal(proposalId) {
  var proposal = aiwProposals[String(proposalId)];
  if (!proposal) {
    return { ok: false, error: '提案が見つかりません（無効なID、期限切れ、または既に処理済みです）。' };
  }
  if (proposal.applied) {
    return { ok: false, error: 'この提案は既に実行済みです。' };
  }
  if (!proposal.ok || !proposal.rows || !proposal.rows.length) {
    return { ok: false, error: 'この提案には実行できる行がありません。' };
  }
  if (Date.now() - proposal.createdAt > AIW_PROPOSAL_TTL_MS) {
    aiwAppendAudit(proposal.kind, proposal.rows.length, proposal.filters, false, '提案の有効期限（10分）が切れました。');
    return { ok: false, error: '提案の有効期限（10分）が切れました。もう一度AIに依頼して提案を作り直してください。' };
  }

  var arrKey = proposal.source === 'sales' ? LS.sales : LS.purchases;
  var isSalesLike = proposal.source === 'sales';

  // ---- 再検証（読み取りのみ）：提案時点のfingerprintと現在の内容を比較する ----
  var freshArr = get(arrKey, []);
  if (!Array.isArray(freshArr)) freshArr = [];
  var resolved = [];
  for (var i = 0; i < proposal.rows.length; i++) {
    var pr = proposal.rows[i];
    var idx = (typeof appvFindLocalRowIndex === 'function') ? appvFindLocalRowIndex(pr._target) : -1;
    if (idx < 0 || idx >= freshArr.length) {
      aiwAppendAudit(proposal.kind, proposal.rows.length, proposal.filters, false, '対象の行が見つからないため中止しました（データが変更された可能性があります）。');
      return { ok: false, error: '対象の行が見つからないため中止しました（バックアップは作成していません。データも変更していません）。' };
    }
    var current = freshArr[idx];
    if (aiwFingerprint(current) !== pr._fingerprint) {
      aiwAppendAudit(proposal.kind, proposal.rows.length, proposal.filters, false, '提案後にデータが変更されたため中止しました。');
      return { ok: false, error: '提案を作成した後にこの行のデータが変更されたため、安全のため中止しました（データは変更していません）。もう一度提案を作り直してください。' };
    }
    resolved.push({ idx: idx, row: current });
  }

  // ---- ここまでは読み取りのみ。最初の変更の直前でバックアップを取る ----
  var snap;
  try {
    snap = createLocalSnapshot('before AI ' + proposal.kind);
  } catch (e) {
    aiwAppendAudit(proposal.kind, proposal.rows.length, proposal.filters, false, 'バックアップの作成に失敗したため中止しました: ' + ((e && e.message) || e));
    return { ok: false, error: 'バックアップの作成に失敗したため、変更を中止しました（データは変更されていません）: ' + ((e && e.message) || e) };
  }
  aiwLastSnapshotForUndo = snap;

  var workArr = freshArr.slice();
  var salesTouched = []; // 売上行のみ：ribre_yahoo_sales240側の同期に使う

  if (proposal.kind === 'delete') {
    // インデックスの大きい順にspliceして、後続indexのずれを防ぐ（appvDeleteRowと同じ考え方）
    var idxToRow = {};
    resolved.forEach(function (r) { idxToRow[r.idx] = r.row; });
    var idxsDesc = resolved.map(function (r) { return r.idx; }).sort(function (x, y) { return y - x; });
    idxsDesc.forEach(function (idx) {
      var row = idxToRow[idx];
      workArr.splice(idx, 1);
      if (isSalesLike) salesTouched.push({ row: row, mode: 'delete' });
    });
  } else {
    var set = proposal.set || {};
    resolved.forEach(function (r) {
      var row = workArr[r.idx];
      if (Object.prototype.hasOwnProperty.call(set, 'date')) { row.date = set.date; row.month = String(set.date || '').slice(0, 7); }
      if (Object.prototype.hasOwnProperty.call(set, 'name')) { row.name = set.name; }
      if (isSalesLike) {
        if (Object.prototype.hasOwnProperty.call(set, 'partner')) row.shop = set.partner || 'その他';
        if (Object.prototype.hasOwnProperty.call(set, 'amount')) row.amount = set.amount;
        if (Object.prototype.hasOwnProperty.call(set, 'memo')) row.memo = set.memo;
      } else {
        if (Object.prototype.hasOwnProperty.call(set, 'partner')) row.vendor = set.partner || 'その他';
        if (Object.prototype.hasOwnProperty.call(set, 'amount')) row.total = set.amount;
        if (Object.prototype.hasOwnProperty.call(set, 'memo')) {
          var wasExpense = aiwIsExpenseRow(row);
          row.memo = wasExpense ? ('[経費] ' + set.memo).trim() : set.memo;
        }
      }
      if (isSalesLike) salesTouched.push({ row: row, mode: 'edit' });
    });
  }

  setLS(arrKey, workArr);
  // 売上行はribre_yahoo_sales240側も必ず同期する（CLAUDE.md制約#9・appv3987行目コメントと同じ理由。
  // これを飛ばすと次のCSV取込(appvYSave)でこの変更が消える＝クラウドreconcileでも削除扱いになる）
  salesTouched.forEach(function (t) {
    try { appvSyncYahoo(t.row, t.mode === 'delete' ? null : t.row.shop, t.mode); } catch (e) {}
  });

  proposal.applied = true;

  // 再描画・クラウド同期はappvDeleteRow/appvUpdateRowと同じ経路を使う。
  // これらは画面更新の後始末であり、既にsetLS/appvSyncYahooでデータは確定済みのため、
  // ここが失敗してもデータ不整合にはならない（例外を握りつぶして監査ログの記録は続ける）。
  try { if (typeof appvAfterWrite === 'function') await appvAfterWrite(); } catch (e) {}
  var pushResult = null;
  try { if (typeof appvPushCloudSafe === 'function') pushResult = await appvPushCloudSafe(); } catch (e) {}

  aiwAppendAudit(proposal.kind, proposal.rows.length, proposal.filters, true, null);

  return {
    ok: true,
    appliedCount: proposal.rows.length,
    snapshotAt: snap && snap.createdAtLocal,
    cloudSynced: !!(pushResult && pushResult.ok),
    summary: (proposal.kind === 'update' ? '修正' : '削除') + 'を実行しました（' + proposal.rows.length + '件）。'
  };
}

/* ==================== Undo（直前の適用のみ・1回きり） ==================== */
async function aiwUndoLastApply() {
  if (!aiwLastSnapshotForUndo) {
    return { ok: false, error: '元に戻せる変更がありません（直前のバックアップが見つかりません）。' };
  }
  var snap = aiwLastSnapshotForUndo;
  try {
    setLS(LS.sales, snap.sales || []);
    setLS(LS.purchases, snap.purchases || []);
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(snap.yahooSales || []));
    setLS(LS.ev, snap.evidences || []);
    setLS(LS.cand, snap.candidates || []);
  } catch (e) {
    return { ok: false, error: '復元に失敗しました: ' + ((e && e.message) || e) };
  }
  aiwLastSnapshotForUndo = null; // 多重undo防止（一度使ったら消す）
  try { if (typeof appvAfterWrite === 'function') await appvAfterWrite(); } catch (e) {}
  try { if (typeof appvPushCloudSafe === 'function') await appvPushCloudSafe(); } catch (e) {}
  aiwAppendAudit('undo', 0, null, true, null);
  return { ok: true };
}

/* ==================== UI（提案カードの描画。textContent/createElementのみ） ==================== */
function aiwFieldLabelValue(v, isAmount) {
  if (isAmount) return (Number(v) || 0).toLocaleString() + '円';
  return v == null ? '' : String(v);
}

function aiwBuildRowsTable(proposal) {
  var wrap = document.createElement('div');
  wrap.className = 'aiw-table-wrap';
  var table = document.createElement('table');
  table.className = 'aiw-table';
  var thead = document.createElement('thead');
  var htr = document.createElement('tr');
  ['日付', '取引先', '品名', '金額'].forEach(function (h) {
    var th = document.createElement('th');
    th.textContent = h;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);

  var tbody = document.createElement('tbody');
  var fieldsOrder = ['date', 'partner', 'name', 'amount'];
  proposal.rows.forEach(function (r) {
    var tr = document.createElement('tr');
    fieldsOrder.forEach(function (f) {
      var td = document.createElement('td');
      var beforeVal = r.before ? r.before[f] : '';
      var afterVal = (proposal.kind === 'update' && r.after) ? r.after[f] : null;
      var isAmount = f === 'amount';
      var changed = proposal.kind === 'update' && afterVal != null && String(afterVal) !== String(beforeVal);
      if (changed) {
        td.className = 'aiw-cell-changed';
        var oldSpan = document.createElement('span');
        oldSpan.className = 'aiw-old-val';
        oldSpan.textContent = aiwFieldLabelValue(beforeVal, isAmount);
        var arrow = document.createElement('span');
        arrow.className = 'aiw-arrow';
        arrow.textContent = ' → ';
        var newSpan = document.createElement('span');
        newSpan.className = 'aiw-new-val';
        newSpan.textContent = aiwFieldLabelValue(afterVal, isAmount);
        td.appendChild(oldSpan);
        td.appendChild(arrow);
        td.appendChild(newSpan);
      } else {
        td.textContent = aiwFieldLabelValue(beforeVal, isAmount);
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function aiwBuildBlockedSection(blocked) {
  var sec = document.createElement('div');
  sec.className = 'aiw-blocked muted';
  var title = document.createElement('div');
  title.className = 'aiw-blocked-title';
  title.textContent = '対象外（' + blocked.length + '件）';
  sec.appendChild(title);
  var ul = document.createElement('ul');
  ul.className = 'aiw-blocked-list';
  blocked.forEach(function (b) {
    var li = document.createElement('li');
    var row = b.row || {};
    var rowInfo = [row.date || '', row.partner || '', row.name || '', row.amount != null ? aiwFieldLabelValue(row.amount, true) : '']
      .filter(function (x) { return x; }).join(' / ');
    li.textContent = (rowInfo ? rowInfo + ' — ' : '') + b.reason;
    ul.appendChild(li);
  });
  sec.appendChild(ul);
  return sec;
}

function aiwClearContainer(container) {
  while (container.firstChild) container.removeChild(container.firstChild);
}

function aiwRenderApplyResult(container, proposal, result, done) {
  aiwClearContainer(container);
  var card = document.createElement('div');
  card.className = 'aiw-card';
  var line = document.createElement('div');
  if (result && result.ok) {
    line.className = 'aiw-result-ok';
    line.textContent = '✅ ' + (result.summary || '実行しました。');
    card.appendChild(line);
    var undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.className = 'aiw-btn aiw-btn-ghost';
    undoBtn.textContent = '元に戻す';
    undoBtn.addEventListener('click', function () {
      undoBtn.disabled = true;
      undoBtn.textContent = '元に戻しています…';
      aiwUndoLastApply().then(function (undoResult) {
        aiwClearContainer(card);
        var undoLine = document.createElement('div');
        undoLine.textContent = (undoResult && undoResult.ok)
          ? '↩ 元に戻しました。'
          : ('⚠ 元に戻せませんでした: ' + ((undoResult && undoResult.error) || ''));
        card.appendChild(undoLine);
        done({ applied: true, undone: !!(undoResult && undoResult.ok) });
      });
    });
    card.appendChild(undoBtn);
    container.appendChild(card);
    done({ applied: true, appliedCount: result.appliedCount });
  } else {
    line.className = 'aiw-result-error';
    line.textContent = '⚠ 実行できませんでした: ' + ((result && result.error) || '不明なエラー');
    card.appendChild(line);
    container.appendChild(card);
    done({ applied: false, error: result && result.error });
  }
}

function aiwRenderProposal(container, proposal, onDone) {
  if (!container || !proposal) return;
  var done = typeof onDone === 'function' ? onDone : function () {};
  aiwClearContainer(container);

  var card = document.createElement('div');
  card.className = 'aiw-card';

  var header = document.createElement('div');
  header.className = 'aiw-card-head';
  var title = document.createElement('strong');
  title.textContent = 'AIからの変更提案';
  header.appendChild(title);
  var kindBadge = document.createElement('span');
  kindBadge.className = 'aiw-badge ' + (proposal.kind === 'delete' ? 'aiw-badge-delete' : 'aiw-badge-update');
  kindBadge.textContent = proposal.kind === 'delete' ? '削除' : '修正';
  header.appendChild(kindBadge);
  card.appendChild(header);

  if (proposal.summary) {
    var summary = document.createElement('div');
    summary.className = 'aiw-summary';
    summary.textContent = proposal.summary;
    card.appendChild(summary);
  }

  if (!proposal.ok || !proposal.rows || !proposal.rows.length) {
    if (proposal.blocked && proposal.blocked.length) card.appendChild(aiwBuildBlockedSection(proposal.blocked));
    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'aiw-btn aiw-btn-ghost';
    closeBtn.textContent = '閉じる';
    closeBtn.addEventListener('click', function () {
      aiwClearContainer(container);
      done({ cancelled: true });
    });
    card.appendChild(closeBtn);
    container.appendChild(card);
    return;
  }

  card.appendChild(aiwBuildRowsTable(proposal));
  if (proposal.blocked && proposal.blocked.length) card.appendChild(aiwBuildBlockedSection(proposal.blocked));

  var warn = document.createElement('div');
  warn.className = 'aiw-warning';
  warn.textContent = '実行するとデータが変更されます。実行前に自動でバックアップを取ります。';
  card.appendChild(warn);

  var actions = document.createElement('div');
  actions.className = 'aiw-actions';
  var execBtn = document.createElement('button');
  execBtn.type = 'button';
  execBtn.className = 'aiw-btn aiw-btn-primary';
  execBtn.textContent = '実行';
  var cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'aiw-btn aiw-btn-ghost';
  cancelBtn.textContent = 'キャンセル';
  cancelBtn.addEventListener('click', function () {
    aiwClearContainer(container);
    done({ cancelled: true });
  });
  execBtn.addEventListener('click', function () {
    execBtn.disabled = true;
    cancelBtn.disabled = true;
    execBtn.textContent = '実行中…';
    aiwApplyProposal(proposal.id).then(function (result) {
      aiwRenderApplyResult(container, proposal, result, done);
    }).catch(function (e) {
      aiwRenderApplyResult(container, proposal, { ok: false, error: (e && e.message) || String(e) }, done);
    });
  });
  actions.appendChild(execBtn);
  actions.appendChild(cancelBtn);
  card.appendChild(actions);

  container.appendChild(card);
}

/* ==================== グローバル公開 ==================== */
if (typeof window !== 'undefined') {
  window.aiwProposeUpdate = aiwProposeUpdate;
  window.aiwProposeDelete = aiwProposeDelete;
  window.aiwApplyProposal = aiwApplyProposal;
  window.aiwUndoLastApply = aiwUndoLastApply;
  window.aiwRenderProposal = aiwRenderProposal;
  window.aiwGetAuditLog = aiwGetAuditLog;
  // テスト・デバッグ用（scratchpadのtest-ai-write.jsが利用）
  window.AIW_MAX_ROWS = AIW_MAX_ROWS;
  window.AIW_MAX_ROWS_UPDATE = AIW_MAX_ROWS_UPDATE;
  window.AIW_MAX_ROWS_DELETE = AIW_MAX_ROWS_DELETE;
  window.AIW_PROPOSAL_TTL_MS = AIW_PROPOSAL_TTL_MS;
  window.aiwPickFilters = aiwPickFilters;
  window.aiwProposals = aiwProposals;
}
