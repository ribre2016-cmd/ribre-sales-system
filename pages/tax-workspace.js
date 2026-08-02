/* 税理士ワークスペース（Phase 1・読み取り専用 + 招待リンクによる自己登録 + 社内管理パネル）
 * 設計書: docs/TAX_WORKSPACE_PLAN.md
 * 依存: core.js(escHtml/sess/email/LS/yen/sb), supabase-auth.js(signIn/signUp/signOut)
 *
 * ⚠ Phase 1は読み取り専用。仕訳登録(journalize)・証憑添付を呼ぶコードは一切書かない。
 * ⚠ services/auth-gate.js は読み込まない（社内メール専用の入口ガードで税理士は弾かれる）。
 *   代わりにこのファイルが自前のログインゲートを持つ。
 * ⚠ 叩くAPIは POST /api/mf/tax-workspace のみ。action は 'list' /
 *   'redeem_invite'（招待リンクの引き換え）/ 'invite_create' / 'invite_list' /
 *   'invite_revoke' / 'advisor_list' / 'advisor_set_enabled'（社内メンバー向け管理。
 *   is_member:true のときだけ⑤タブから使う）。bootstrapは選択欄が無いPhase 1画面では
 *   不要なため呼ばない。他のAPIエンドポイントは一切叩かない。
 * ⚠ 招待トークンは画面のURL欄（招待リンク発行時の読み取り専用input）以外に出さない。
 *   console.log等のログにも出さない。
 */
'use strict';

var TXW_ENDPOINT = '/api/mf/tax-workspace';

// URLのハッシュ #invite=<32桁16進> を読み取る。引き換え後・無関係なページ遷移では
// history.replaceState でハッシュ自体を消すため、以後は txwInviteToken の値だけで判定する。
function txwParseInviteToken(hash) {
  var m = /^#invite=([0-9a-f]{32})$/i.exec(String(hash || ''));
  return m ? m[1] : '';
}
var txwInviteToken = txwParseInviteToken(location.hash);
var txwAdminLoaded = false; // ⑤タブのデータ(招待一覧・税理士一覧)を初回表示時だけ読み込むためのフラグ

/* signIn()/signOut()(services/supabase-auth.js)がログイン・ログアウト後に呼ぶ共通フック。
 * ログイン済みになったら画面を表示し、招待トークンがあれば引き換えてから通常のデータを読み込む。 */
function refreshAll() {
  try {
    if (txwIsLoggedIn()) { txwHandleLoginSuccess(); }
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
function txwUpdateInviteNote() {
  var el2 = document.getElementById('txwGateInviteNote');
  if (!el2) return;
  if (txwInviteToken) {
    el2.textContent = '招待リンクを開いています。ログインまたは新規登録すると、税理士として登録されます。';
    el2.style.display = 'block';
  } else {
    el2.style.display = 'none';
    el2.textContent = '';
  }
}
function txwShowGate(msg) {
  document.getElementById('txwApp').style.display = 'none';
  document.getElementById('txwGate').style.display = 'flex';
  txwUpdateInviteNote();
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

// URLのハッシュからトークンを消す（history.replaceStateでページ遷移扱いにしない）。
// リロード時に招待の引き換えを再送しないため、また画面のURL欄にトークンを残さないため。
function txwStripInviteHash() {
  try { history.replaceState(null, '', location.pathname + location.search); }
  catch (e) { try { location.hash = ''; } catch (e2) {} }
}

// 招待トークンを引き換える。成功・失敗のいずれでもトークンはURLから消す。
function txwRedeemInvite(token) {
  return txwApiCall('redeem_invite', { invite_token: token }).then(function (result) {
    var data = result.data || {};
    if (data.ok) {
      txwShowInfoBanner('税理士として登録しました（' + (data.email || '') + '）');
    } else if (data.error === 'invite_unusable') {
      txwShowInfoBanner('この招待リンクは使用済み・取り消し済み・期限切れです。管理者に新しいリンクを発行してもらってください。', 'error');
    } else if (data.error === 'invalid_invite') {
      txwShowInfoBanner('招待リンクが正しくありません。', 'error');
    } else {
      txwShowInfoBanner('招待の処理に失敗しました。', 'error');
    }
  }).catch(function () {
    txwShowInfoBanner('招待の処理に失敗しました。', 'error');
  });
}

// ログイン成功後の共通処理（signIn()経由のrefreshAll()・初期表示の両方から呼ぶ）。
// 招待トークンがあれば先にURLから消してから引き換え、その後いつも通りlistを読み込む。
async function txwHandleLoginSuccess() {
  txwHideGate();
  var token = txwInviteToken;
  if (token) {
    txwInviteToken = '';
    txwStripInviteHash();
    await txwRedeemInvite(token);
  }
  txwLoad();
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
  // 成功時は signIn() 内部で呼ばれる refreshAll() → txwHandleLoginSuccess() が既に処理済み。
  // ここでは失敗（メール/パスワード誤り等）だけを拾う。
  setTimeout(function () {
    if (!txwIsLoggedIn()) msgEl.textContent = 'ログインできませんでした（メール／パスワードをご確認ください）';
  }, 600);
}

// 新規登録。services/supabase-auth.js の signUp() をそのまま使う（#email/#password/#roleの
// 共通フォームに値を渡す方式はsignIn()と同じ）。このSupabaseプロジェクトの既存の登録導線
// （pages/app-v2.js appvDoRegister 等）と同じく、登録後は自動ログインせず「ログインを押して
// ください」と案内する（メール確認が必要な設定でも壊れない一番安全な流れ）。
async function txwGateSignup() {
  var e = (document.getElementById('txwGateEmail').value || '').trim();
  var p = (document.getElementById('txwGatePass').value || '').trim();
  var msgEl = document.getElementById('txwGateMsg');
  if (!e || !p) { msgEl.textContent = 'メールとパスワードを入力してください'; msgEl.style.color = '#b91c1c'; return; }
  msgEl.textContent = '登録中…';
  msgEl.style.color = '#2563eb';
  try {
    document.getElementById('email').value = e;
    document.getElementById('password').value = p;
    var roleEl = document.getElementById('role');
    if (roleEl) roleEl.value = 'tax_advisor';
    if (typeof window.signUp !== 'function') { msgEl.textContent = '新規登録機能が見つかりません'; return; }
    // signUp() は失敗しても例外を投げず、結果を隠し要素 #settingsList に書くだけ。
    // そのまま「登録しました」と出すと、実際は失敗しているのに成功したように見えてしまう
    // （メール重複・パスワードが短い等）。結果を読んで判定する。
    var out = document.getElementById('settingsList');
    if (out) out.innerHTML = '';
    await window.signUp();
    var text = out ? (out.textContent || '') : '';
    if (text && text.indexOf('登録しました') < 0) {
      msgEl.style.color = '#b91c1c';
      msgEl.textContent = '登録できませんでした: ' + text.replace(/\s*(ERROR|OK)\s*$/, '').trim();
      return;
    }
  } catch (err) { msgEl.style.color = '#b91c1c'; msgEl.textContent = '登録に失敗しました'; return; }
  msgEl.style.color = '#15803d';
  msgEl.textContent = '登録しました。続けて「ログイン」を押してください。'
    + '（確認メールが届いた場合は、先にメール内のリンクを開いてください）';
}

function txwLogout() {
  try { if (typeof window.signOut === 'function') window.signOut(); } catch (e) {}
  document.getElementById('txwGateEmail').value = '';
  document.getElementById('txwGatePass').value = '';
  txwAdminLoaded = false;
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
  // 直前の「登録しました」等の成功表示が残っていると、成功と失敗が同時に見えて
  // どちらが今の状態か分からなくなるため、エラーを出すときは必ず消す。
  txwClearInfoBanner();
  var e = document.getElementById('txwGlobalError');
  e.textContent = msg;
  e.style.display = 'block';
}
function txwClearInfoBanner() {
  var e = document.getElementById('txwInfoBanner');
  e.style.display = 'none';
  e.textContent = '';
}
/* kind: 'ok'（既定）または 'error'。
 * 招待の結果はこの枠に出す。txwLoad() が毎回消す txwGlobalError と違い、
 * こちらは消されないため、直後の一覧読み込みでメッセージが流れてしまわない
 * （招待が期限切れだったときに何も表示されない不具合があったため分けた）。 */
function txwShowInfoBanner(msg, kind) {
  // 逆向きも同じ。成功を出すときは前のエラーを消す。
  txwClearGlobalError();
  var e = document.getElementById('txwInfoBanner');
  e.textContent = msg;
  if (kind === 'error') {
    e.style.background = '#fef2f2';
    e.style.borderColor = '#fecaca';
    e.style.color = '#991b1b';
  } else {
    e.style.background = '';
    e.style.borderColor = '';
    e.style.color = '';
  }
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
  txwSetAdminVisible(!!data.is_member);
}

// ⑤タブ（税理士の管理）は is_member:true のときだけ出す。無いとき/falseのときは
// タブ自体を消し、万一そのタブが選択中だったら①へ戻す。
function txwSetAdminVisible(visible) {
  var btn = document.getElementById('txwAdminTabBtn');
  if (!btn) return;
  btn.style.display = visible ? '' : 'none';
  if (!visible && btn.classList.contains('active')) txwGoTab('unmatched');
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

/* ---------------- ⑤ 税理士の管理（社内メンバーのみ） ---------------- */
function txwFormatDateTime(iso) {
  if (!iso) return '不明';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '不明';
  return d.toLocaleString('ja-JP');
}

function txwFallbackCopy(input, done) {
  try {
    input.focus();
    input.select();
    var ok = document.execCommand('copy');
    done(!!ok);
  } catch (e) { done(false); }
}
function txwCopyInviteUrl(input, btn) {
  var origLabel = 'コピー';
  var done = function (ok) {
    btn.textContent = ok ? 'コピーしました' : 'コピーできませんでした';
    setTimeout(function () { btn.textContent = origLabel; }, 1500);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(input.value).then(function () { done(true); }).catch(function () { txwFallbackCopy(input, done); });
  } else {
    txwFallbackCopy(input, done);
  }
}

// 招待リンクを発行する。トークンは戻り値の中にしか存在しない（一覧APIはtokenを返すが、
// 表示は下のtxwRenderInvitesで状態のみ。URLを組み立てるのはこの発行直後の1回だけ）。
/* MF連携の権限を確認する。
 * Phase 1の画面は明細しか読まないため、再連携で追加したスコープ
 * （accounts.read / taxes.read / trade_partners.read）が実際に取れているかを
 * 確かめる手段がない。ここで bootstrap を1回呼んで確認できるようにする。
 * ⚠ 読み取りだけ。仕訳の作成(journal.write)はこのボタンでも一切呼ばない。 */
async function txwCheckScopes() {
  var btn = document.getElementById('txwScopeCheckBtn');
  var out = document.getElementById('txwScopeCheckResult');
  clearEl(out);
  btn.disabled = true;
  try {
    var result = await txwApiCall('bootstrap', {});
    var data = result.data || {};
    if (!data.ok) {
      var msg = data.error === 'scope_missing'
        ? '権限が足りていません。証憑ページの「再連携」をもう一度お試しください。'
        : (data.error === 'not_connected'
          ? 'MFと連携されていません。証憑ページから連携してください。'
          : 'MFの権限を確認できませんでした（' + (data.error || '不明') + '）。');
      out.appendChild(el('div', { class: 'note danger', text: msg }));
      return;
    }
    var a = (data.accounts || []).length;
    var t = (data.taxes || []).length;
    var p = (data.trade_partners || []).length;
    out.appendChild(el('div', { class: 'note ok', text: '権限は取れています。勘定科目 ' + a + '件 ／ 税区分 ' + t + '件 ／ 取引先 ' + p + '件を読み取れました。' }));
    if (!a || !t) {
      out.appendChild(el('div', { class: 'note warn', text: '※0件の項目があります。MF側にデータが無いか、権限が一部足りていない可能性があります。' }));
    }
  } catch (e) {
    out.appendChild(el('div', { class: 'note danger', text: '確認に失敗しました。時間をおいてお試しください。' }));
  } finally {
    btn.disabled = false;
  }
}

async function txwCreateInvite() {
  var btn = document.getElementById('txwInviteCreateBtn');
  var out = document.getElementById('txwInviteCreateResult');
  clearEl(out);
  btn.disabled = true;
  try {
    var result = await txwApiCall('invite_create', {});
    var data = result.data || {};
    if (!data.ok || !data.token) {
      out.appendChild(el('div', { class: 'note danger', text: '招待リンクの発行に失敗しました。' }));
      return;
    }
    var url = location.origin + '/tax-workspace#invite=' + data.token;
    var box = el('div', { class: 'invite-box' });
    var row = el('div', { class: 'invite-row' });
    var input = el('input', { type: 'text', readonly: 'readonly', class: 'invite-url-input' });
    input.value = url;
    row.appendChild(input);
    var copyBtn = el('button', { type: 'button', class: 'btn-mini', text: 'コピー' });
    copyBtn.addEventListener('click', function () { txwCopyInviteUrl(input, copyBtn); });
    row.appendChild(copyBtn);
    box.appendChild(row);
    box.appendChild(el('div', { class: 'note warn', text: '有効期限: ' + txwFormatDateTime(data.expires_at) + '（1回だけ使えます）' }));
    out.appendChild(box);
    txwLoadInvites();
  } catch (e) {
    out.appendChild(el('div', { class: 'note danger', text: '招待リンクの発行に失敗しました。' }));
  } finally {
    btn.disabled = false;
  }
}

function txwInviteStatus(inv) {
  if (inv.revoked_at) return { label: '取り消し済み', cls: 'chip-gray' };
  if (inv.used_at) return { label: '使用済み（' + (inv.used_email || '不明') + '）', cls: 'chip-blue' };
  if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) return { label: '期限切れ', cls: 'chip-gray' };
  return { label: '未使用', cls: 'chip-yellow' };
}

function txwRenderInvites(invites) {
  var body = document.getElementById('txwInviteListBody');
  clearEl(body);
  if (!invites.length) {
    body.appendChild(el('div', { class: 'evidence-empty', text: '発行済みの招待リンクはありません。' }));
    return;
  }
  var table = document.createElement('table');
  var thead = el('thead');
  var trh = el('tr');
  ['発行日時', '期限', '状態', '操作'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  invites.forEach(function (inv) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: txwFormatDateTime(inv.created_at) }));
    tr.appendChild(el('td', { text: txwFormatDateTime(inv.expires_at) }));
    var st = txwInviteStatus(inv);
    var tdSt = el('td');
    tdSt.appendChild(el('span', { class: 'chip ' + st.cls, text: st.label }));
    tr.appendChild(tdSt);
    var tdOp = el('td');
    var usable = !inv.revoked_at && !inv.used_at && inv.expires_at && new Date(inv.expires_at).getTime() >= Date.now();
    if (usable) {
      var revokeBtn = el('button', { type: 'button', class: 'btn-mini', text: '取り消す' });
      revokeBtn.addEventListener('click', function () { txwRevokeInvite(inv.token, revokeBtn); });
      tdOp.appendChild(revokeBtn);
    }
    tr.appendChild(tdOp);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
}

async function txwLoadInvites() {
  var body = document.getElementById('txwInviteListBody');
  clearEl(body);
  body.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  var result;
  try { result = await txwApiCall('invite_list', {}); }
  catch (e) { clearEl(body); body.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' })); return; }
  var data = result.data || {};
  if (!data.ok) { clearEl(body); body.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' })); return; }
  txwRenderInvites(Array.isArray(data.invites) ? data.invites : []);
}

async function txwRevokeInvite(token, btn) {
  if (!confirm('この招待リンクを取り消します。よろしいですか？')) return;
  btn.disabled = true;
  try {
    var result = await txwApiCall('invite_revoke', { invite_token: token });
    var data = result.data || {};
    if (data.ok && data.revoked) { txwLoadInvites(); }
    else { alert('取り消しに失敗しました。'); btn.disabled = false; }
  } catch (e) { alert('取り消しに失敗しました。'); btn.disabled = false; }
}

function txwRenderAdvisors(advisors) {
  var body = document.getElementById('txwAdvisorListBody');
  clearEl(body);
  if (!advisors.length) {
    body.appendChild(el('div', { class: 'evidence-empty', text: '税理士は登録されていません。' }));
    return;
  }
  var table = document.createElement('table');
  var thead = el('thead');
  var trh = el('tr');
  ['メール', '登録日時', '状態', '操作'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  advisors.forEach(function (a) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: a.email || '' }));
    tr.appendChild(el('td', { text: txwFormatDateTime(a.created_at) }));
    var tdSt = el('td');
    tdSt.appendChild(el('span', { class: 'chip ' + (a.enabled ? 'chip-green' : 'chip-gray'), text: a.enabled ? '有効' : '無効' }));
    tr.appendChild(tdSt);
    var tdOp = el('td');
    var toggleBtn = el('button', { type: 'button', class: 'btn-mini', text: a.enabled ? '無効にする' : '有効にする' });
    toggleBtn.addEventListener('click', function () { txwSetAdvisorEnabled(a.email, !a.enabled, toggleBtn); });
    tdOp.appendChild(toggleBtn);
    tr.appendChild(tdOp);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
}

async function txwLoadAdvisors() {
  var body = document.getElementById('txwAdvisorListBody');
  clearEl(body);
  body.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  var result;
  try { result = await txwApiCall('advisor_list', {}); }
  catch (e) { clearEl(body); body.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' })); return; }
  var data = result.data || {};
  if (!data.ok) { clearEl(body); body.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' })); return; }
  txwRenderAdvisors(Array.isArray(data.advisors) ? data.advisors : []);
}

async function txwSetAdvisorEnabled(emailStr, enabled, btn) {
  if (!enabled) {
    if (!confirm(emailStr + ' を無効にします。よろしいですか？')) return;
  }
  btn.disabled = true;
  try {
    var result = await txwApiCall('advisor_set_enabled', { email: emailStr, enabled: enabled });
    var data = result.data || {};
    if (data.ok && data.updated) { txwLoadAdvisors(); }
    else { alert('更新に失敗しました。'); btn.disabled = false; }
  } catch (e) { alert('更新に失敗しました。'); btn.disabled = false; }
}

/* ---------------- タブ切替 ---------------- */
function txwGoTab(t) {
  document.querySelectorAll('.tabpage').forEach(function (elx) { elx.classList.toggle('active', elx.id === 't-' + t); });
  document.querySelectorAll('.tab-btn').forEach(function (elx) { elx.classList.toggle('active', elx.dataset.t === t); });
  if (t === 'admin' && !txwAdminLoaded) {
    txwAdminLoaded = true;
    txwLoadInvites();
    txwLoadAdvisors();
  }
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
  document.getElementById('txwGateSignupBtn').addEventListener('click', txwGateSignup);
  document.getElementById('txwGatePass').addEventListener('keydown', function (e) { if (e.key === 'Enter') txwGateLogin(); });
  document.getElementById('txwGateEmail').addEventListener('keydown', function (e) { if (e.key === 'Enter') txwGateLogin(); });
  document.getElementById('txwLogoutBtn').addEventListener('click', txwLogout);
  document.getElementById('txwScopeCheckBtn').addEventListener('click', txwCheckScopes);
  document.getElementById('txwInviteCreateBtn').addEventListener('click', txwCreateInvite);
  document.getElementById('txwInviteListReloadBtn').addEventListener('click', txwLoadInvites);
  document.getElementById('txwAdvisorListReloadBtn').addEventListener('click', txwLoadAdvisors);

  var monthInput = document.getElementById('txwMonth');
  monthInput.value = txwCurrentMonthDefault();
  monthInput.addEventListener('change', txwLoad);

  if (txwIsLoggedIn()) { txwHandleLoginSuccess(); }
  else { txwShowGate(''); }

  txwWasLoggedIn = txwIsLoggedIn();
  setInterval(txwSessionWatch, 5000);
}

if (document.readyState !== 'loading') txwInit();
else document.addEventListener('DOMContentLoaded', txwInit);
