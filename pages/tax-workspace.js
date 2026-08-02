/* 税理士ワークスペース（Phase 1・読み取り専用）
 * 設計書: docs/TAX_WORKSPACE_PLAN.md
 * 依存: core.js(escHtml/sess/email/LS/yen), supabase-auth.js(signIn/signOut)
 *
 * ⚠ Phase 1は読み取り専用。仕訳登録(journalize)・証憑添付を呼ぶコードは一切書かない。
 * ⚠ services/auth-gate.js は読み込まない（社内メール専用の入口ガードで税理士は弾かれる）。
 *   代わりにこのファイルが自前のログインゲートを持つ。
 * ⚠ 叩くAPIは POST /api/mf/tax-workspace の action:'list' のみ（bootstrapは選択欄が
 *   無いPhase 1画面では不要なため呼ばない）。他のAPIエンドポイントは一切叩かない。
 */
'use strict';

var TXW_ENDPOINT = '/api/mf/tax-workspace';

/* signIn()/signOut()(services/supabase-auth.js)がログイン・ログアウト後に呼ぶ共通フック。
 * このページでは「ログイン済みなら画面を表示してデータを読み込む」だけでよい。 */
function refreshAll() {
  try {
    if (txwIsLoggedIn()) { txwHideGate(); txwLoad(); }
  } catch (e) {}
}

/* ---------------- 小さなDOM組み立てヘルパー（XSS対策: innerHTMLに外部由来の文字列を入れない） ---------------- */
function el(tag, attrs, children) {
  var e = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'text') e.textContent = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
  }
  (children || []).forEach(function (c) {
    if (c === null || c === undefined) return;
    e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return e;
}
function clearEl(elx) { while (elx.firstChild) elx.removeChild(elx.firstChild); }

/* ---------------- ログイン状態の判定（services/auth-gate.js の tokenValid() と同じ規則） ---------------- */
function txwTokenValid() {
  try {
    var s = sess();
    var t = s.access_token || '';
    if (!t) return false;
    var parts = String(t).split('.');
    if (parts.length < 2) return true; // 非JWTは判定不能→有効扱い(誤締め出し回避)
    var b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var payload = JSON.parse(decodeURIComponent(escape(atob(b))));
    if (payload && payload.exp) return (payload.exp * 1000) > Date.now();
    return true;
  } catch (e) { return true; }
}
function txwIsLoggedIn() {
  try { if (!email()) return false; } catch (e) { return false; }
  return txwTokenValid();
}

/* ---------------- ログインゲート ---------------- */
function txwShowGate(msg) {
  document.getElementById('txwApp').style.display = 'none';
  document.getElementById('txwGate').style.display = 'flex';
  var m = document.getElementById('txwGateMsg');
  m.textContent = msg || '';
  m.style.color = '#b91c1c';
}
function txwHideGate() {
  document.getElementById('txwGate').style.display = 'none';
  document.getElementById('txwApp').style.display = 'block';
  txwSetWho(email() || '');
}
function txwSetWho(emailStr) {
  document.getElementById('txwWhoEmail').textContent = emailStr || '';
}

async function txwGateLogin() {
  var e = (document.getElementById('txwGateEmail').value || '').trim();
  var p = (document.getElementById('txwGatePass').value || '').trim();
  var msgEl = document.getElementById('txwGateMsg');
  if (!e || !p) { msgEl.textContent = 'メールとパスワードを入力してください'; msgEl.style.color = '#b91c1c'; return; }
  msgEl.textContent = 'ログイン中…';
  msgEl.style.color = '#2563eb';
  try {
    // 既存のログインフォーム(#email/#password)に値を渡して signIn() を実行
    document.getElementById('email').value = e;
    document.getElementById('password').value = p;
    if (typeof window.signIn === 'function') { await window.signIn(); }
    else { msgEl.textContent = 'ログイン機能が見つかりません'; return; }
  } catch (err) { msgEl.textContent = 'ログインに失敗しました'; return; }
  setTimeout(function () {
    if (txwIsLoggedIn()) { msgEl.textContent = ''; txwHideGate(); txwLoad(); }
    else msgEl.textContent = 'ログインできませんでした（メール／パスワードをご確認ください）';
  }, 600);
}

function txwLogout() {
  try { if (typeof window.signOut === 'function') window.signOut(); } catch (e) {}
  document.getElementById('txwGateEmail').value = '';
  document.getElementById('txwGatePass').value = '';
  txwShowGate('');
}

/* ---------------- API呼び出し（POST /api/mf/tax-workspace の action:'list' のみ） ---------------- */
async function txwApiCall(action, extra) {
  var body = Object.assign({ action: action }, extra || {});
  var res = await fetch(TXW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
    body: JSON.stringify(body)
  });
  var data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  return { status: res.status, data: data || {} };
}

function txwClearGlobalError() {
  var e = document.getElementById('txwGlobalError');
  e.style.display = 'none';
  e.textContent = '';
}
function txwShowGlobalError(msg) {
  var e = document.getElementById('txwGlobalError');
  e.textContent = msg;
  e.style.display = 'block';
}

function txwMapError(data) {
  switch (data && data.error) {
    case 'not_connected':
      return 'MFと連携されていません。管理者にご連絡ください。';
    case 'scope_missing':
      return 'MF連携の権限が不足しています。管理者による再連携が必要です。';
    case 'transactions_fetch_failed':
      return data.message ? String(data.message) : '明細の取得に失敗しました。';
    case 'master_fetch_failed':
      return data.message ? String(data.message) : 'マスタの取得に失敗しました。';
    case 'not_tax_advisor':
      return 'このアカウントは税理士として登録されていません。管理者にご連絡ください。';
    case 'invalid_month':
      return '対象月の指定が正しくありません。';
    case 'invalid_action':
      return '不正なリクエストです。';
    default:
      return 'エラーが発生しました。しばらくしてからもう一度お試しください。';
  }
}

function txwSetLoading() {
  ['txwUnmatchedList', 'txwAwaitingBody', 'txwFilesBody'].forEach(function (id) {
    var e = document.getElementById(id);
    clearEl(e);
    e.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  });
  document.getElementById('txwUnmatchedCount').textContent = '-';
}
function txwSetLoadFailed() {
  ['txwUnmatchedList', 'txwAwaitingBody', 'txwFilesBody'].forEach(function (id) {
    var e = document.getElementById(id);
    clearEl(e);
    e.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' }));
  });
  document.getElementById('txwUnmatchedCount').textContent = '-';
}

async function txwLoad() {
  txwClearGlobalError();
  var monthInput = document.getElementById('txwMonth');
  var month = monthInput.value;
  if (!month) return;
  txwSetLoading();

  var result;
  try {
    result = await txwApiCall('list', { month: month });
  } catch (e) {
    txwShowGlobalError('通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。');
    txwSetLoadFailed();
    return;
  }
  var status = result.status, data = result.data;

  if (status === 401) {
    txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
    return;
  }
  if (status === 403 && data && data.error === 'not_tax_advisor') {
    txwShowGlobalError('このアカウントは税理士として登録されていません。管理者にご連絡ください。');
    txwSetLoadFailed();
    return;
  }
  if (!data || !data.ok) {
    if (data && data.advisor && data.advisor.email) txwSetWho(data.advisor.email);
    txwShowGlobalError(txwMapError(data));
    txwSetLoadFailed();
    return;
  }

  if (data.advisor && data.advisor.email) txwSetWho(data.advisor.email);
  txwRenderUnmatched(Array.isArray(data.items) ? data.items : []);
  txwRenderAwaiting(Number(data.open_evidence_count) || 0);
  txwRenderFiles(Array.isArray(data.shared_files) ? data.shared_files : []);
}

/* ---------------- ① 未仕訳の明細 ---------------- */
function txwSideLabel(tx) {
  var s = String((tx && tx.side) || '').toLowerCase();
  if (s.indexOf('incom') >= 0 || s.indexOf('credit') >= 0) return '収入';
  if (s.indexOf('expense') >= 0 || s.indexOf('outcome') >= 0 || s.indexOf('pay') >= 0 || s.indexOf('debit') >= 0) return '支出';
  var v = Number(tx && tx.value);
  if (Number.isFinite(v)) {
    if (v < 0) return '支出';
    if (v > 0) return '収入';
  }
  return (tx && tx.side) ? String(tx.side) : '収支不明';
}

function txwEvidenceAmountText(ev) {
  var n = Number(ev.ocr_amount);
  if (!Number.isFinite(n)) return '金額不明';
  var cur = ev.ocr_currency || 'JPY';
  if (cur === 'JPY') return yen(n);
  return n.toLocaleString() + ' ' + cur;
}

function txwRenderUnmatched(items) {
  var container = document.getElementById('txwUnmatchedList');
  clearEl(container);
  document.getElementById('txwUnmatchedCount').textContent = '未仕訳 ' + items.length + '件';

  if (!items.length) {
    container.appendChild(el('div', { class: 'evidence-empty', text: '未仕訳の明細はありません。' }));
    return;
  }

  items.forEach(function (tx) {
    var card = el('div', { class: 'jcard' });

    var head = el('div', { class: 'jcard-head' });
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', { class: 'title', text: (tx.date || '(日付不明)') + '　' + (tx.content || '(内容なし)') }));
    var sub = el('div', { class: 'sub', text: txwSideLabel(tx) + ' ' + yen(Math.abs(Number(tx.value) || 0)) });
    titleWrap.appendChild(sub);
    head.appendChild(titleWrap);
    head.appendChild(el('span', { class: 'chip chip-gray', text: '未仕訳' }));
    card.appendChild(head);

    var body = el('div', { class: 'jcard-body' });

    var evBox = el('div', { class: 'evidence-box' });
    var cands = Array.isArray(tx.evidence_candidates) ? tx.evidence_candidates : [];
    evBox.appendChild(el('h4', { text: '関連しそうな証憑' + (cands.length ? '（' + cands.length + '件）' : '') }));
    if (!cands.length) {
      evBox.appendChild(el('div', { class: 'evidence-empty', text: '候補となる証憑は見つかりませんでした。' }));
    } else {
      cands.forEach(function (ev) {
        var item = el('div', { class: 'evidence-item' });
        item.appendChild(el('div', { class: 'fname', text: ev.file_name || '(ファイル名なし)' }));
        item.appendChild(el('div', {
          class: 'meta',
          text: (ev.ocr_date || '日付不明') + '／' + (ev.ocr_vendor || '取引先不明') + '／' + txwEvidenceAmountText(ev)
        }));
        item.appendChild(el('div', {
          class: 'cand-note',
          text: '取引先名と日付(±45日)で見つけた候補。金額は照合していません。中身を確認してください。'
        }));
        evBox.appendChild(item);
      });
    }
    body.appendChild(evBox);
    card.appendChild(body);
    container.appendChild(card);
  });
}

/* ---------------- ② 仕訳待ちの証憑 ---------------- */
function txwRenderAwaiting(count) {
  var body = document.getElementById('txwAwaitingBody');
  clearEl(body);
  body.appendChild(el('span', { class: 'chip ' + (count > 0 ? 'chip-yellow' : 'chip-green'), text: '仕訳待ちの証憑 ' + count + '件' }));
  body.appendChild(el('div', {
    class: 'note',
    text: '仕訳が無いために送信を保留している証憑の件数です。①未仕訳の明細で該当する明細の仕訳を作れば解消します。'
  }));
}

/* ---------------- ③ 共有ファイル ---------------- */
function txwFormatSize(n) {
  var v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + 'MB';
  if (v >= 1024) return Math.round(v / 1024) + 'KB';
  return v + 'B';
}

function txwRenderFiles(files) {
  var body = document.getElementById('txwFilesBody');
  clearEl(body);
  if (!files.length) {
    body.appendChild(el('div', { class: 'evidence-empty', text: '共有ファイルはありません。' }));
    return;
  }

  var groups = {};
  var order = [];
  files.forEach(function (f) {
    var m = f.month || '(月不明)';
    if (!groups[m]) { groups[m] = []; order.push(m); }
    groups[m].push(f);
  });

  order.forEach(function (m) {
    body.appendChild(el('div', { class: 'month-group-title', text: m }));
    var table = document.createElement('table');
    var thead = el('thead');
    var trh = el('tr');
    ['ファイル名', 'サイズ', '種別'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    groups[m].forEach(function (f) {
      var tr = el('tr');

      var tdName = el('td');
      if (f.url && /^https:\/\//.test(f.url)) {
        tdName.appendChild(el('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', text: f.name || f.key || '(ファイル名なし)' }));
      } else {
        tdName.textContent = f.name || f.key || '(ファイル名なし)';
      }
      if (!f.attachable) {
        tdName.appendChild(el('div', { class: 'file-attach-note', text: '証憑としては添付できません（閲覧のみ）' }));
      }
      tr.appendChild(tdName);

      tr.appendChild(el('td', { class: 'num', text: txwFormatSize(f.size) }));

      var tdKind = el('td');
      tdKind.appendChild(el('span', { class: 'chip ' + (f.attachable ? 'chip-blue' : 'chip-gray'), text: f.attachable ? '証憑添付可' : '閲覧のみ' }));
      tr.appendChild(tdKind);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  });
}

/* ---------------- タブ切替 ---------------- */
function txwGoTab(t) {
  document.querySelectorAll('.tabpage').forEach(function (elx) { elx.classList.toggle('active', elx.id === 't-' + t); });
  document.querySelectorAll('.tab-btn').forEach(function (elx) { elx.classList.toggle('active', elx.dataset.t === t); });
}

/* ---------------- 初期化 ---------------- */
function txwCurrentMonthDefault() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

var txwWasLoggedIn = false;
function txwSessionWatch() {
  var loggedIn = txwIsLoggedIn();
  if (!loggedIn && txwWasLoggedIn) {
    txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
  }
  txwWasLoggedIn = loggedIn;
}

function txwInit() {
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () { txwGoTab(btn.dataset.t); });
  });
  document.getElementById('txwGateLoginBtn').addEventListener('click', txwGateLogin);
  document.getElementById('txwGatePass').addEventListener('keydown', function (e) { if (e.key === 'Enter') txwGateLogin(); });
  document.getElementById('txwGateEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') txwGateLogin(); });
  document.getElementById('txwLogoutBtn').addEventListener('click', txwLogout);

  var monthInput = document.getElementById('txwMonth');
  monthInput.value = txwCurrentMonthDefault();
  monthInput.addEventListener('change', txwLoad);

  if (txwIsLoggedIn()) { txwHideGate(); txwLoad(); }
  else { txwShowGate(''); }

  txwWasLoggedIn = txwIsLoggedIn();
  setInterval(txwSessionWatch, 5000);
}

if (document.readyState !== 'loading') txwInit();
else document.addEventListener('DOMContentLoaded', txwInit);
