/* 税理士ワークスペース（Phase 4・過去の仕訳から初期値を提案 + 仕訳登録＋証憑添付
 * + 招待リンクによる自己登録 + 社内管理パネル）
 * 設計書: docs/TAX_WORKSPACE_PLAN.md
 * 依存: core.js(escHtml/sess/email/LS/yen/sb), supabase-auth.js(signIn/signUp/signOut)
 *
 * ⚠ 叩くAPIは POST /api/mf/tax-workspace のみ。action は 'bootstrap'（勘定科目・税区分・
 *   補助科目・会計期間などの選択肢マスタ）/ 'list'（明細・証憑・共有ファイル） /
 *   'suggest'（過去の仕訳から初期値を提案。listの直後に呼ぶ） /
 *   'journalize'（仕訳登録。1件ずつ） / 'set_closed_term_policy' / 'redeem_invite'（招待リンクの引き換え）/
 *   'invite_create' / 'invite_list' / 'invite_revoke' / 'advisor_list' /
 *   'advisor_set_enabled'（社内メンバー向け管理。is_member:true のときだけ⑤タブから使う）。
 *   他のAPIエンドポイントは一切叩かない。
 * ⚠ 一括登録・全件登録のボタンは作らない（設計書§5-2・§9-2）。1回の操作で1件だけ。
 * ⚠ 消費税額はアプリ側で計算しない。tax_id を渡すだけで、税額の計算はMFに任せる。
 * ⚠ 証憑候補のチェックボックスは初期状態オフ。自動では選ばない。
 * ⚠ 証憑の添付に失敗しても仕訳は取り消さない（成功と失敗を分けて表示するだけ）。
 * ⚠ Phase 4: suggestが返した提案は入力欄に「下書き」として入れるだけで、絶対に自動登録しない。
 *   提案が無い明細に「それらしい値」を勝手に入れない（suggestionsにキーが無ければ空のまま）。
 *   提案が入ったカードには必ず「前回の仕訳から入れています。確認してください」を出し、
 *   「クリア」で4項目（勘定科目・補助科目・税区分・インボイス区分）を空に戻せるようにする。
 * ⚠ innerHTMLに外部由来の文字列を入れない。DOM組み立て（el()）とtextContentのみを使う。
 * ⚠ services/auth-gate.js は読み込まない（社内メール専用の入口ガードで税理士は弾かれる）。
 *   代わりにこのファイルが自前のログインゲートを持つ。
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

/* ---------------- Phase 3: 選択欄マスタ（勘定科目・税区分・補助科目・会計期間） ----------------
 * action:'bootstrap' で取得。ログイン成功時に1回だけ読み、以後は使い回す（月を変えても再取得しない）。
 * 税区分は80件超あるため、素の<select>ではなく<datalist>付き検索入力にする（設計書§2.5・§9-9）。 */
var txwMaster = { accounts: [], taxes: [], subAccounts: [], termSettings: [], loaded: false, failedReason: null };
var txwAccountLookup = { labelToId: {}, options: [] };
var txwTaxLookup = { labelToId: {}, options: [] };
var txwSubAccountLookup = { labelToId: {}, options: [] };

/* ---------------- Phase 4: 過去の仕訳から初期値を提案 ----------------
 * txwCardRefsByTx: transaction_id → そのカードの入力欄refs（writableなカードのみ登録）。
 * txwRenderGen: 明細一覧を描画し直すたびに増える世代番号。suggestは非同期のため、
 * 応答が返ってきた時点で古い世代なら(=その間に月を変えた等)何もしない(取り違え防止)。 */
var txwCardRefsByTx = {};
var txwRenderGen = 0;

/* ---------------- Phase 6: ①一覧表示（設計書§1・§10.1） ----------------
 * 「確認の単位」をまとめるだけで、「実行の単位」は変えない。一覧のチェック行は
 * 1件ずつ順番に既存の action:'journalize' へ送る。サーバー（api/mf/tax-workspace.js）は
 * 一切変更しない。カード表示（txwCardRefsByTx）とは別に、行ごとの入力欄への参照を持つ。
 * 同じ明細のカードと行の両方が常にDOMに存在する（表示/非表示はCSSのみ）ため、
 * どちらから登録しても両方に結果を反映し、件数（txwRefreshUnmatchedCount）を一致させる。 */
var txwListRowRefsByTx = {};
var txwListCheckedCount = 0;
var txwListLastCheckedTx = null; // Shift+クリック/Shift+↑↓の起点
var txwListRunning = false;      // 一括実行中は行の編集・チェックを触らせない
var txwListAbort = false;
var TXW_LIST_MAX_CHECK = 20;
var TXW_UNMATCHED_VIEW_KEY = 'ribre_txw_unmatched_view';
var txwUnmatchedView = 'list'; // 既定は一覧表示

/* ---------------- ⑨ 月次チェック用の絞り込み(①タブと共有) ----------------
 * txwUnmatchedFilter: ⑨の各行「この科目の未仕訳明細をさがす」から①タブへ渡す絞り込み条件。
 * txwUnmatchedAllItems/txwUnmatchedWritableCache: 直近のtxwLoad()で取得した①タブの全件を
 * 保持しておき、絞り込みのON/OFFだけで再取得なしに再描画できるようにする。 */
var txwUnmatchedFilter = { active: false, account: '', ids: [] };
var txwUnmatchedAllItems = [];
var txwUnmatchedWritableCache = false;
// ⑨タブの直近の応答。確認記録(monthly_check_confirm)を送るときに件数を添えるため保持する。
var txwMonthlyLastData = null;

// 同じ表示名が複数あるときはIDを付けて区別する（2パス: 先に重複数を数えてから組み立てる）
function txwBuildLabelLookup(list, labelFn) {
  var counts = {};
  var bases = (list || []).map(function (item) {
    var b = String(labelFn(item) || ('ID:' + item.id));
    counts[b] = (counts[b] || 0) + 1;
    return b;
  });
  var labelToId = {};
  var idToLabel = {};
  var options = [];
  (list || []).forEach(function (item, i) {
    var b = bases[i];
    var label = counts[b] > 1 ? (b + '（' + item.id + '）') : b;
    labelToId[label] = String(item.id);
    idToLabel[String(item.id)] = label;
    options.push(label);
  });
  return { labelToId: labelToId, idToLabel: idToLabel, options: options };
}

// ID → datalistのラベル文字列。マスタに存在しないID(未確認・削除済みなど)は空文字を返す。
// Phase 4の提案(suggest)はこれを使ってラベルを逆引きする。見つからなければ空のまま入れる(§9-2相当の安全側)。
function txwIdToLabel(lookup, id) {
  if (id === null || id === undefined || id === '') return '';
  return (lookup && lookup.idToLabel && lookup.idToLabel[String(id)]) || '';
}

function txwBuildLookups() {
  txwAccountLookup = txwBuildLabelLookup(txwMaster.accounts, function (a) {
    return a.name || a.account_name;
  });
  txwTaxLookup = txwBuildLabelLookup(txwMaster.taxes, function (t) {
    var parts = [t.name || t.abbreviation];
    if (t.abbreviation && t.abbreviation !== t.name) parts.push('[' + t.abbreviation + ']');
    if (t.tax_rate !== undefined && t.tax_rate !== null && t.tax_rate !== '') parts.push(t.tax_rate + '%');
    return parts.join(' ');
  });
  txwSubAccountLookup = txwBuildLabelLookup(txwMaster.subAccounts, function (s) {
    return s.name;
  });
}

function txwFillDatalist(id, options) {
  var dl = document.getElementById(id);
  if (!dl) {
    dl = document.createElement('datalist');
    dl.id = id;
    document.body.appendChild(dl);
  }
  clearEl(dl);
  (options || []).forEach(function (label) {
    var opt = document.createElement('option');
    opt.value = label; // .value への代入。innerHTMLは使わない
    dl.appendChild(opt);
  });
}

// 3つのdatalistを共有(グローバル)にして、カードごとに選択肢を複製しない
function txwEnsureDatalists() {
  txwFillDatalist('txwAccountsDatalist', txwAccountLookup.options);
  txwFillDatalist('txwTaxesDatalist', txwTaxLookup.options);
  txwFillDatalist('txwSubAccountsDatalist', txwSubAccountLookup.options);
}

// datalistの入力文字列 → ID。完全一致のときだけ解決する（未確定の入力は選択なし扱い）
function txwResolveId(lookup, value) {
  var v = String(value || '').trim();
  if (!v) return null;
  return lookup.labelToId[v] || null;
}

async function txwLoadMaster() {
  txwMaster.loaded = false;
  txwMaster.failedReason = null;
  try {
    var result = await txwApiCall('bootstrap', {});
    var data = result.data || {};
    if (!data.ok) {
      txwMaster.failedReason = (data && data.error) || 'unknown';
      return;
    }
    txwMaster.accounts = Array.isArray(data.accounts) ? data.accounts : [];
    txwMaster.taxes = Array.isArray(data.taxes) ? data.taxes : [];
    txwMaster.subAccounts = Array.isArray(data.sub_accounts) ? data.sub_accounts : [];
    txwMaster.termSettings = Array.isArray(data.term_settings) ? data.term_settings : [];
    txwMaster.loaded = true;
    txwBuildLookups();
    txwEnsureDatalists();
  } catch (e) {
    txwMaster.failedReason = 'network';
  }
}

/* ---------------- Phase 3: 会計期間の警告（設計書§6-E。止めない・警告だけ） ---------------- */
function txwTodayStr() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function txwFindTermForDate(dateStr) {
  if (!dateStr) return null;
  var terms = txwMaster.termSettings || [];
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    if (t && t.start_date && t.end_date && dateStr >= t.start_date && dateStr <= t.end_date) return t;
  }
  return null;
}
function txwFormatDateSlash(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return String(iso || '');
  return m[1] + '/' + Number(m[2]) + '/' + Number(m[3]);
}
// 選んだ月が「進行中の期」(今日の日付が入る期)に含まれないなら警告を出す。登録はブロックしない。
function txwUpdateTermWarning(month) {
  var box = document.getElementById('txwTermWarning');
  if (!box) return;
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m || !txwMaster.loaded || !txwMaster.termSettings || !txwMaster.termSettings.length) {
    box.style.display = 'none'; box.textContent = ''; return;
  }
  var progressing = txwFindTermForDate(txwTodayStr());
  var selectedTerm = txwFindTermForDate(m[1] + '-' + m[2] + '-01');
  if (!selectedTerm || !progressing || selectedTerm === progressing) {
    box.style.display = 'none'; box.textContent = ''; return;
  }
  var head = '⚠ この月は ' + selectedTerm.fiscal_year + '年度（'
    + txwFormatDateSlash(selectedTerm.start_date) + '〜' + txwFormatDateSlash(selectedTerm.end_date)
    + '）のものです。この期の帳簿はすでに確定している可能性があります。';
  // 設定が 'block' のときは、押しても登録できないことを先に伝える（サーバーが実際に拒否する）
  box.textContent = head + (txwClosedTermPolicy === 'block'
    ? 'この画面の設定により、この期への登録はできません。'
    : '登録先の期と処理方法をご判断ください。');
  box.className = txwClosedTermPolicy === 'block' ? 'note danger' : 'note warn';
  box.style.display = 'block';
}

/* ---------------- 決算済みの期の扱い（税理士に選んでもらう設定・設計書§6-E） ----------------
 * 'warn'  … 警告を出すだけで登録はできる（既定）
 * 'block' … 進行中の期以外への登録を拒否する
 * ⚠ ここの表示はあくまで案内。**実際に止めるのはサーバー側**（handleJournalize）。
 *   画面のガードは迂回できるため、ここだけで守っているつもりにならないこと。 */
var txwClosedTermPolicy = 'warn';
var txwWritable = false;

function txwRenderPolicyBox() {
  var box = document.getElementById('txwPolicyBox');
  if (!box) return;
  clearEl(box);
  if (!txwWritable) { box.style.display = 'none'; return; }
  box.style.display = 'block';

  box.appendChild(el('div', {
    text: '決算が終わった期の明細に仕訳を登録しようとしたときの動作',
    style: 'font-weight:900;margin-bottom:6px'
  }));

  var row = el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:center' });
  [
    { v: 'warn', label: '警告を出すだけ（登録はできる）', hint: '前期の修正が必要な場合もあるため、こちらが既定です' },
    { v: 'block', label: '登録できないようにする', hint: '確定した期の帳簿を絶対に触らせたくない場合' }
  ].forEach(function (opt) {
    var id = 'txwPolicy_' + opt.v;
    var wrap = el('label', { class: 'txw-policy-opt', for: id });
    var radio = el('input', { type: 'radio', name: 'txwClosedTermPolicy', id: id, value: opt.v });
    radio.checked = (txwClosedTermPolicy === opt.v);
    radio.addEventListener('change', function () { if (radio.checked) txwSaveClosedTermPolicy(opt.v); });
    wrap.appendChild(radio);
    wrap.appendChild(el('span', { text: ' ' + opt.label, style: 'font-weight:800' }));
    wrap.appendChild(el('span', { text: '（' + opt.hint + '）', style: 'color:#64748b;font-weight:700;font-size:11px' }));
    row.appendChild(wrap);
  });
  box.appendChild(row);
  box.appendChild(el('div', {
    id: 'txwPolicySaved', text: '', style: 'font-weight:800;margin-top:6px;min-height:16px'
  }));
}

async function txwSaveClosedTermPolicy(policy) {
  var msg = document.getElementById('txwPolicySaved');
  if (msg) { msg.textContent = '保存中…'; msg.style.color = '#2563eb'; }
  try {
    var result = await txwApiCall('set_closed_term_policy', { policy: policy });
    var data = result.data || {};
    if (!data.ok) throw new Error(data.error || 'failed');
    txwClosedTermPolicy = policy;
    if (msg) { msg.textContent = '保存しました'; msg.style.color = '#15803d'; }
    txwUpdateTermWarning(document.getElementById('txwMonth').value);
  } catch (e) {
    if (msg) { msg.textContent = '保存できませんでした。もう一度お試しください。'; msg.style.color = '#b91c1c'; }
    txwRenderPolicyBox(); // 画面の選択を実際の設定へ戻す
  }
}

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
  // 選択欄マスタ(勘定科目・税区分・補助科目・会計期間)を先に読み、その後に明細一覧を読む。
  // 失敗しても txwLoadMaster は例外を投げない（txwMaster.loaded=false のまま進む）。
  await txwLoadMaster();
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

// 一覧表示のtbodyへ、表全体にまたがる1行だけのメッセージを出す（読み込み中・失敗・空）
function txwListSetSingleMessage(text, cls) {
  var tbody = document.getElementById('txwListTbody');
  if (!tbody) return;
  clearEl(tbody);
  var tr = document.createElement('tr');
  tr.appendChild(el('td', { colspan: '9', class: cls, text: text }));
  tbody.appendChild(tr);
}

function txwSetLoading() {
  ['txwUnmatchedList', 'txwAwaitingBody', 'txwFilesBody'].forEach(function (id) {
    var e = document.getElementById(id);
    clearEl(e);
    e.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  });
  document.getElementById('txwUnmatchedCount').textContent = '-';
  txwListSetSingleMessage('読み込み中…', 'txw-loading');
}
function txwSetLoadFailed() {
  ['txwUnmatchedList', 'txwAwaitingBody', 'txwFilesBody'].forEach(function (id) {
    var e = document.getElementById(id);
    clearEl(e);
    e.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' }));
  });
  document.getElementById('txwUnmatchedCount').textContent = '-';
  txwListSetSingleMessage('読み込めませんでした。', 'evidence-empty');
}

async function txwLoad() {
  txwClearGlobalError();
  var monthInput = document.getElementById('txwMonth');
  var month = monthInput.value;
  if (!month) return;
  txwUpdateTermWarning(month); // 会計期間の警告は月とマスタだけで判定できる。登録はブロックしない
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
    // 読み込みに失敗した＝登録できる状態ではない。前回の成功時に出した
    // 「決算が終わった期の扱い」設定欄が残っていると、登録できないのに設定だけ
    // 生きて見えて食い違うので必ず隠す。
    txwWritable = false;
    txwRenderPolicyBox();
    txwUpdateTermWarning('');
    txwShowGlobalError(txwMapError(data));
    txwSetLoadFailed();
    return;
  }

  if (data.advisor && data.advisor.email) txwSetWho(data.advisor.email);
  txwWritable = !!data.writable;
  // 決算済みの期の扱い。サーバーが返した値を正とする（画面で勝手に決めない）
  if (['warn', 'block'].indexOf(data.closed_term_policy) >= 0) txwClosedTermPolicy = data.closed_term_policy;
  txwRenderPolicyBox();
  txwUpdateTermWarning(month);
  txwRenderUnmatched(Array.isArray(data.items) ? data.items : [], txwWritable);
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

// ①タブ上部の注意書き。writableかどうかで文言を変える(§9-9・D)。
function txwUpdateUnmatchedNote(writable) {
  var note = document.getElementById('txwUnmatchedNote');
  if (!note) return;
  note.textContent = writable
    ? '1件ずつ内容を確認して登録してください。一括登録はありません。'
    : 'この明細は閲覧のみです。仕訳の登録・証憑の添付はMFクラウド会計の画面で行ってください。';
}

// ⑨月次チェックの「この科目の未仕訳明細をさがす」からの絞り込み。
// 提案されている勘定科目を明細ごとに持っていない(suggestは非同期・writableのカードのみ)ため、
// 明細の内容(content)にその科目名が含まれるものを残す。バーには「何で絞ったか」を明記する(§3)。
function txwUnmatchedFilteredItems(items) {
  if (!txwUnmatchedFilter.active) return items || [];
  var ids = txwUnmatchedFilter.ids;
  // ⑨が過去の仕訳から割り出した明細IDで絞る。
  // ⚠ 銀行明細の摘要に勘定科目名は入っていない（「フリコミ ○○フドウサン」など）ので、
  //   科目名の文字列一致で絞ると常に0件になる。IDで絞るのが唯一まともに当たる方法。
  if (ids && ids.length) {
    return (items || []).filter(function (tx) { return ids.indexOf(tx && tx.transaction_id) >= 0; });
  }
  // 候補が1件も割り出せなかった科目。**空振りを黙って隠さず、そのまま0件として見せる**
  return [];
}

function txwRenderUnmatchedFilterBar() {
  var bar = document.getElementById('txwUnmatchedFilterBar');
  if (!bar) return;
  clearEl(bar);
  if (!txwUnmatchedFilter.active) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  var row = el('div', { style: 'display:flex;align-items:center;gap:10px;flex-wrap:wrap;' });
  row.appendChild(el('span', { text: '絞り込み中: ' + txwUnmatchedFilter.account, style: 'font-weight:900' }));
  var clearBtn = el('button', { type: 'button', class: 'btn-mini', text: '絞り込みを解除' });
  clearBtn.addEventListener('click', txwClearUnmatchedFilter);
  row.appendChild(clearBtn);
  bar.appendChild(row);
  var n = (txwUnmatchedFilter.ids || []).length;
  bar.appendChild(el('div', {
    style: 'margin-top:4px;',
    text: n
      ? ('※ 過去の仕訳から「' + txwUnmatchedFilter.account + '」になりそうだと推定した明細 '
         + n + '件を表示しています。推定なので、違うものが混じっていることがあります。')
      : ('※「' + txwUnmatchedFilter.account + '」になりそうな明細は見つかりませんでした。'
         + 'この科目の取引は、過去の仕訳から推定できる摘要ではないのかもしれません。'
         + '絞り込みを解除して全件からお探しください。')
  }));
}

// ⑨タブの各行から呼ぶ。①タブへ移動し、その科目の候補として割り出した明細だけを表示する。
function txwFilterToUnmatched(account, ids) {
  txwUnmatchedFilter = {
    active: true,
    account: String(account || ''),
    ids: Array.isArray(ids) ? ids.slice() : [],
  };
  txwGoTab('unmatched');
  txwRenderUnmatched(txwUnmatchedAllItems, txwUnmatchedWritableCache);
}
function txwClearUnmatchedFilter() {
  txwUnmatchedFilter = { active: false, account: '', ids: [] };
  txwRenderUnmatched(txwUnmatchedAllItems, txwUnmatchedWritableCache);
}

function txwRenderUnmatched(items, writable) {
  // 次回の絞り込み解除・再絞り込みで再取得なしに再描画できるよう、全件をここへ保持する。
  txwUnmatchedAllItems = items || [];
  txwUnmatchedWritableCache = writable;

  var container = document.getElementById('txwUnmatchedList');
  clearEl(container);
  txwRenderUnmatchedFilterBar();
  var displayItems = txwUnmatchedFilteredItems(items);
  document.getElementById('txwUnmatchedCount').textContent = '未仕訳 ' + displayItems.length + '件'
    + (txwUnmatchedFilter.active ? '（絞り込み中）' : '');
  txwUpdateUnmatchedNote(writable);

  // 新しい世代の描画を始める。前の世代のsuggest応答が後から返ってきても無視するための番号。
  txwRenderGen += 1;
  var myGen = txwRenderGen;
  txwCardRefsByTx = {};

  // 一覧表示（Phase 6）: 実行中に月替え等で再描画されることは通常無いが、念のため状態を初期化する。
  txwListRowRefsByTx = {};
  txwListCheckedCount = 0;
  txwListLastCheckedTx = null;
  txwListRunning = false;
  txwListAbort = false;
  var listTbody = document.getElementById('txwListTbody');
  var execWrap = document.getElementById('txwListExecWrap');
  if (execWrap) execWrap.style.display = 'none';
  var execPanel = document.getElementById('txwListExecPanel');
  if (execPanel) clearEl(execPanel);
  if (listTbody) clearEl(listTbody);

  if (!displayItems.length) {
    var emptyMsg = txwUnmatchedFilter.active ? 'この絞り込み条件に一致する明細はありません。' : '未仕訳の明細はありません。';
    container.appendChild(el('div', { class: 'evidence-empty', text: emptyMsg }));
    if (listTbody) {
      var trEmpty = document.createElement('tr');
      trEmpty.appendChild(el('td', { colspan: '9', class: 'evidence-empty', text: emptyMsg }));
      listTbody.appendChild(trEmpty);
    }
    txwListUpdateCounter();
    return;
  }

  displayItems.forEach(function (tx) {
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
    var evidenceCheckboxes = [];
    if (!cands.length) {
      evBox.appendChild(el('div', { class: 'evidence-empty', text: '候補となる証憑は見つかりませんでした。' }));
    } else {
      cands.forEach(function (ev) {
        var item = el('div', { class: 'evidence-item' });
        if (writable) {
          // 初期状態は必ずオフ(設計書§3.2)。チェックされたものだけevidence_idsに載せる。
          var cbRow = document.createElement('label');
          cbRow.className = 'evidence-check-row';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = false;
          cbRow.appendChild(cb);
          cbRow.appendChild(document.createTextNode('この証憑を添付する'));
          item.appendChild(cbRow);
          evidenceCheckboxes.push({ checkbox: cb, evidence_id: ev.evidence_id });
        }
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

    if (writable) {
      txwBuildJournalForm(card, body, tx, evidenceCheckboxes);
    }

    card.appendChild(body);
    container.appendChild(card);

    // 一覧表示（新設）: 同じ明細のカードと行を両方作る。表示の切り替えはCSSのみ。
    if (listTbody) listTbody.appendChild(txwBuildListRow(tx, writable));
  });

  // 明細の描画はここで完了。suggestは続けて後から呼ぶが、描画をブロックしない(§A末尾)。
  if (writable) txwLoadSuggestions(displayItems, myGen);
  txwListUpdateCounter();
}

/* ---------------- Phase 3: 仕訳登録フォーム ---------------- */
function txwBuildSearchInput(datalistId, placeholder) {
  var input = document.createElement('input');
  input.type = 'text';
  input.setAttribute('list', datalistId);
  input.placeholder = placeholder || '';
  input.autocomplete = 'off';
  return input;
}

function txwBuildJournalForm(card, body, tx, evidenceCheckboxes) {
  var formWrap = el('div', { class: 'jcard-form' });

  if (!txwMaster.loaded) {
    // 選択肢マスタが読めていない(スコープ不足・MF未連携など)ときは、登録できないことを
    // はっきり伝える。account_idを解決できないため登録フォームは出さない。
    formWrap.appendChild(el('div', {
      class: 'note danger',
      text: '選択肢（勘定科目・税区分）を読み込めなかったため、この明細は登録できません。画面を再読み込みしてください。'
    }));
    body.appendChild(formWrap);
    return;
  }

  // Phase 4: 過去の仕訳からの提案を出す枠。中身はtxwApplySuggestionが提案があるときだけ埋める。
  // 「勝手に決めつけない」設計のため、既定は非表示(display:none)。
  var suggestNote = document.createElement('div');
  suggestNote.className = 'note warn suggest-note';
  suggestNote.style.display = 'none';
  var suggestText = document.createElement('span');
  suggestNote.appendChild(suggestText);
  var suggestClearBtn = document.createElement('button');
  suggestClearBtn.type = 'button';
  suggestClearBtn.className = 'btn-mini';
  suggestClearBtn.textContent = 'クリア';
  suggestNote.appendChild(suggestClearBtn);
  formWrap.appendChild(suggestNote);

  var row1 = el('div', { class: 'jform-row' });
  var accountField = el('div', { class: 'jform-field' });
  accountField.appendChild(el('label', { text: '勘定科目 *' }));
  var accountInput = txwBuildSearchInput('txwAccountsDatalist', '必須：入力すると候補が出ます（候補から選択）');
  accountField.appendChild(accountInput);
  row1.appendChild(accountField);

  var subField = el('div', { class: 'jform-field' });
  subField.appendChild(el('label', { text: '補助科目' }));
  var subInput = txwBuildSearchInput('txwSubAccountsDatalist', '任意：入力すると候補が出ます（候補から選択）');
  subField.appendChild(subInput);
  row1.appendChild(subField);
  formWrap.appendChild(row1);

  var row2 = el('div', { class: 'jform-row' });
  var taxField = el('div', { class: 'jform-field' });
  taxField.appendChild(el('label', { text: '税区分' }));
  var taxInput = txwBuildSearchInput('txwTaxesDatalist', '任意：入力すると候補が出ます（候補から選択）');
  taxField.appendChild(taxInput);
  row2.appendChild(taxField);

  var invoiceField = el('div', { class: 'jform-field' });
  invoiceField.appendChild(el('label', { text: 'インボイス区分 *' }));
  var invoiceSelect = document.createElement('select');
  [
    ['', '(未選択)※必ず選んでください'],
    ['INVOICE_KIND_NOT_TARGET', '対象外'],
    ['INVOICE_KIND_QUALIFIED', '適格'],
    ['INVOICE_KIND_UNQUALIFIED_80', '8割控除'],
  ].forEach(function (pair) {
    var opt = document.createElement('option');
    opt.value = pair[0];
    opt.textContent = pair[1];
    invoiceSelect.appendChild(opt);
  });
  invoiceField.appendChild(invoiceSelect);
  row2.appendChild(invoiceField);
  formWrap.appendChild(row2);

  var row3 = el('div', { class: 'jform-row' });
  var memoField = el('div', { class: 'jform-field jform-field-wide' });
  memoField.appendChild(el('label', { text: 'メモ' }));
  var memoInput = document.createElement('input');
  memoInput.type = 'text';
  memoInput.maxLength = 200;
  memoInput.placeholder = '(任意)';
  memoField.appendChild(memoInput);
  row3.appendChild(memoField);
  formWrap.appendChild(row3);

  body.appendChild(formWrap);

  var statusArea = el('div', { class: 'jform-status' });
  statusArea.style.display = 'none';

  var submitBtn = el('button', { type: 'button', class: 'btn btn-primary', text: 'この内容で登録する' });
  submitBtn.disabled = true; // 勘定科目が未選択の間は押せない

  /* 勘定科目とインボイス区分の両方が選ばれるまで登録できない。
   * インボイス区分を必須にしたのは、未選択のとき機械的に「対象外」へ倒れると
   * 気づかないまま少数派の値で登録されてしまうため（実データでは91%が「適格」）。
   * ⚠ ここは案内であって守りではない。実際に弾くのはサーバー側。 */
  function updateSubmitEnabled() {
    var okAccount = !!txwResolveId(txwAccountLookup, accountInput.value);
    var okInvoice = !!invoiceSelect.value;
    submitBtn.disabled = !(okAccount && okInvoice);
    submitBtn.title = submitBtn.disabled
      ? (!okAccount ? '勘定科目を候補から選んでください' : 'インボイス区分を選んでください')
      : '';
  }
  accountInput.addEventListener('input', updateSubmitEnabled);
  invoiceSelect.addEventListener('change', updateSubmitEnabled);

  var refs = {
    card: card, statusArea: statusArea, submitBtn: submitBtn,
    accountInput: accountInput, subInput: subInput, taxInput: taxInput,
    invoiceSelect: invoiceSelect, memoInput: memoInput, evidenceCheckboxes: evidenceCheckboxes,
    suggestNote: suggestNote, suggestText: suggestText, updateSubmitEnabled: updateSubmitEnabled,
  };
  submitBtn.addEventListener('click', function () { txwSubmitJournal(tx, refs); });

  // 「クリア」: 提案で入った4項目(勘定科目・補助科目・税区分・インボイス区分)をすべて空に戻す(§C)。
  // メモ・証憑のチェックは提案が触っていないのでそのまま残す。
  suggestClearBtn.addEventListener('click', function () {
    accountInput.value = '';
    subInput.value = '';
    taxInput.value = '';
    invoiceSelect.value = '';
    updateSubmitEnabled();
    suggestNote.style.display = 'none';
  });

  // Phase 4: この明細がsuggestの対象になるよう、transaction_idで引けるようにしておく。
  txwCardRefsByTx[tx.transaction_id] = refs;

  /* 押す直前に必ず見える位置へ注意書きを置く。
   * これまでガイドにしか書いていなかったが、ガイドを読んでいない・忘れた人への
   * 最後の砦として画面にも出す（2026-08-03のレビュー指摘）。
   * 確認ダイアログは出さない：1件ずつしか登録できず、内容も目の前に出ているため、
   * 毎回ダイアログを出すと「読まずに閉じる」癖がついて逆に危ない。 */
  body.appendChild(el('div', {
    class: 'note warn',
    text: '⚠ 登録するとMFクラウド会計に仕訳が作られます。この画面から取り消すことはできません。'
      + '間違えた場合はMFクラウド会計の仕訳帳から編集・削除してください。'
  }));
  var btnRow = el('div', { class: 'jform-btnrow' });
  btnRow.appendChild(submitBtn);
  body.appendChild(btnRow);
  body.appendChild(statusArea);
}

/* ================================================================
 * Phase 6: ①一覧表示（一括確認リスト。設計書§1・§10.1）
 * ・カード表示（上記）は変更しない。同じ明細についてカードと行の両方を毎回作り、
 *   表示の切り替えはCSS(display)のみで行う。
 * ・実行は既存どおり1件ずつ action:'journalize' を呼ぶだけ。サーバーは一切変更しない。
 * ================================================================ */

/* ---- カード表示／一覧表示の切り替え。既定は一覧表示・localStorageに記憶(txwSaveMonthと同じ書き方) ---- */
function txwSaveUnmatchedView(v) {
  try { if (v === 'card' || v === 'list') localStorage.setItem(TXW_UNMATCHED_VIEW_KEY, v); } catch (e) { /* 保存できなくても動作には影響しない */ }
}
function txwRestoreUnmatchedView() {
  try {
    var v = localStorage.getItem(TXW_UNMATCHED_VIEW_KEY);
    if (v === 'card' || v === 'list') return v;
  } catch (e) { /* 読めなければ既定へ */ }
  return 'list';
}
function txwApplyUnmatchedView(v) {
  txwUnmatchedView = (v === 'card') ? 'card' : 'list';
  var cardBtn = document.getElementById('txwViewBtnCard');
  var listBtn = document.getElementById('txwViewBtnList');
  if (cardBtn) cardBtn.classList.toggle('active', txwUnmatchedView === 'card');
  if (listBtn) listBtn.classList.toggle('active', txwUnmatchedView === 'list');
  var cardView = document.getElementById('txwCardView');
  var listView = document.getElementById('txwListView');
  if (cardView) cardView.style.display = txwUnmatchedView === 'card' ? '' : 'none';
  if (listView) listView.style.display = txwUnmatchedView === 'list' ? '' : 'none';
}
function txwViewSwitch(v) {
  txwApplyUnmatchedView(v);
  txwSaveUnmatchedView(v);
}

/* ---- 行の組み立て ---- */
function txwBuildListRow(tx, writable) {
  var tr = document.createElement('tr');
  tr.className = 'txw-lt-row';
  tr.dataset.tx = tx.transaction_id;

  if (!writable) {
    tr.appendChild(el('td', {}));
    tr.appendChild(el('td', { text: tx.date || '(日付不明)' }));
    tr.appendChild(el('td', { text: tx.content || '(内容なし)' }));
    tr.appendChild(el('td', { class: 'num', text: yen(Math.abs(Number(tx.value) || 0)) }));
    tr.appendChild(el('td', {
      colspan: '5', class: 'evidence-empty',
      text: 'この明細は閲覧のみです。仕訳の登録はMFクラウド会計の画面で行ってください。'
    }));
    return tr;
  }

  var refs = { txId: tx.transaction_id, tx: tx, tr: tr, rowState: { ready: false }, badgeEl: null };

  // 0: チェック（必須項目が埋まるまでdisabled。§1.2）
  var tdCheck = document.createElement('td');
  var checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.disabled = true;
  tdCheck.appendChild(checkbox);
  var hint = el('div', { class: 'list-hint', text: '勘定科目とインボイス区分を選ぶと選択できます' });
  tdCheck.appendChild(hint);
  tr.appendChild(tdCheck);
  refs.checkbox = checkbox;
  refs.hint = hint;

  // 1: 日付
  tr.appendChild(el('td', { text: tx.date || '(日付不明)' }));

  // 2: 摘要 + 証憑（§1.3: 日付・金額の完全一致候補が1件だけのときのみ、初期チェックONで一覧から添付可）
  var tdContent = document.createElement('td');
  tdContent.appendChild(el('div', { text: tx.content || '(内容なし)' }));
  var cands = Array.isArray(tx.evidence_candidates) ? tx.evidence_candidates : [];
  var exactMatches = cands.filter(function (ev) {
    if (!ev || !ev.ocr_date || ev.ocr_date !== tx.date) return false;
    if ((ev.ocr_currency || 'JPY') !== 'JPY') return false; // 外貨建ては金額照合の対象外(CLAUDE.md)
    var amt = Number(ev.ocr_amount);
    return Number.isFinite(amt) && amt === Math.abs(Number(tx.value) || 0);
  });
  if (exactMatches.length === 1) {
    var ev0 = exactMatches[0];
    var evLabel = document.createElement('label');
    evLabel.className = 'evi-auto';
    evLabel.style.display = 'flex';
    evLabel.style.alignItems = 'center';
    evLabel.style.gap = '5px';
    evLabel.style.color = '#15803d';
    evLabel.style.fontWeight = '800';
    var evCb = document.createElement('input');
    evCb.type = 'checkbox';
    evCb.checked = true; // 完全一致1件だけ・初期チェックON
    evLabel.appendChild(evCb);
    evLabel.appendChild(document.createTextNode(
      '証憑を添付する（日付・金額が完全一致：' + (ev0.file_name || '(ファイル名なし)') + '）'
    ));
    tdContent.appendChild(evLabel);
    refs.evidenceCheckbox = evCb;
    refs.evidenceId = ev0.evidence_id;
  } else if (cands.length) {
    tdContent.appendChild(el('div', {
      class: 'evi-auto', style: 'color:#92400e;font-weight:800;',
      text: '証憑候補があります。カード表示でご確認のうえ選んでください。'
    }));
  }
  tr.appendChild(tdContent);

  // 3: 金額
  tr.appendChild(el('td', { class: 'num', text: yen(Math.abs(Number(tx.value) || 0)) }));

  if (!txwMaster.loaded) {
    tr.appendChild(el('td', {
      colspan: '5', class: 'note danger', style: 'margin:0;',
      text: '選択肢（勘定科目・税区分）を読み込めなかったため、この明細は登録できません。画面を再読み込みしてください。'
    }));
    return tr;
  }

  // 4: 勘定科目（カード表示と同じdatalist方式）
  var tdAccount = document.createElement('td');
  var accountInput = txwBuildSearchInput('txwAccountsDatalist', '必須：候補から選択');
  tdAccount.appendChild(accountInput);
  tr.appendChild(tdAccount);
  refs.accountInput = accountInput;

  // 5: 税区分
  var tdTax = document.createElement('td');
  var taxInput = txwBuildSearchInput('txwTaxesDatalist', '任意');
  tdTax.appendChild(taxInput);
  tr.appendChild(tdTax);
  refs.taxInput = taxInput;

  // 6: インボイス区分（カードと同じ選択肢）
  var tdInvoice = document.createElement('td');
  var invoiceSelect = document.createElement('select');
  [
    ['', '(未選択)'],
    ['INVOICE_KIND_NOT_TARGET', '対象外'],
    ['INVOICE_KIND_QUALIFIED', '適格'],
    ['INVOICE_KIND_UNQUALIFIED_80', '8割控除'],
  ].forEach(function (pair) {
    var opt = document.createElement('option');
    opt.value = pair[0];
    opt.textContent = pair[1];
    invoiceSelect.appendChild(opt);
  });
  tdInvoice.appendChild(invoiceSelect);
  tr.appendChild(tdInvoice);
  refs.invoiceSelect = invoiceSelect;

  // 7: 提案の根拠 + クリア（§10.1-3・§10.1-4）
  var tdReason = document.createElement('td');
  tdReason.style.minWidth = '230px';
  var reasonText = el('span', { text: '提案を確認中…' });
  tdReason.appendChild(reasonText);
  var clearBtn = el('button', { type: 'button', class: 'btn-mini', text: 'クリア' });
  tdReason.appendChild(clearBtn);
  tr.appendChild(tdReason);
  refs.reasonText = reasonText;
  refs.tdReason = tdReason;
  refs.clearBtn = clearBtn;

  // 8: 登録（この行だけ今すぐ1件登録したい場合用）
  var tdReg = document.createElement('td');
  var registerBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '登録' });
  registerBtn.disabled = true;
  tdReg.appendChild(registerBtn);
  var statusDiv = document.createElement('div');
  tdReg.appendChild(statusDiv);
  tr.appendChild(tdReg);
  refs.registerBtn = registerBtn;
  refs.statusDiv = statusDiv;

  function updateRowEnabled() {
    var okAccount = !!txwResolveId(txwAccountLookup, accountInput.value);
    var okInvoice = !!invoiceSelect.value;
    refs.rowState.ready = okAccount && okInvoice;
    hint.style.display = refs.rowState.ready ? 'none' : '';
    registerBtn.disabled = !refs.rowState.ready || txwListRunning;
    if (!refs.rowState.ready) checkbox.checked = false;
    txwListUpdateCounter();
  }
  refs.updateRowEnabled = updateRowEnabled;
  accountInput.addEventListener('input', updateRowEnabled);
  taxInput.addEventListener('input', updateRowEnabled);
  invoiceSelect.addEventListener('change', updateRowEnabled);

  checkbox.addEventListener('click', function (ev) {
    if (checkbox.disabled) return;
    txwListHandleShiftClick(refs, ev);
  });
  checkbox.addEventListener('change', function () { txwListUpdateCounter(); });
  checkbox.addEventListener('keydown', function (ev) { txwListHandleShiftArrow(refs, ev); });

  // クリア: 提案で入った3項目を空に戻す（§10.1-3）
  clearBtn.addEventListener('click', function () {
    accountInput.value = '';
    taxInput.value = '';
    invoiceSelect.value = '';
    refs.reasonText.textContent = '該当する提案はありません';
    if (refs.badgeEl) { refs.badgeEl.remove(); refs.badgeEl = null; }
    tr.classList.remove('txw-lt-lowmatch');
    updateRowEnabled();
  });

  registerBtn.addEventListener('click', function () { txwListRegisterOne(refs); });

  txwListRowRefsByTx[tx.transaction_id] = refs;
  return tr;
}

/* ---- 提案(suggest)の反映。ratioが6〜8割のときは要確認バッジ＋行を黄色に(§10.1-4) ---- */
function txwApplySuggestionToRow(refs, sugg) {
  if (!sugg) { refs.reasonText.textContent = '該当する提案はありません'; return; }
  var accLabel = txwIdToLabel(txwAccountLookup, sugg.account_id);
  var taxLabel = txwIdToLabel(txwTaxLookup, sugg.tax_id);
  if (accLabel) refs.accountInput.value = accLabel;
  if (taxLabel) refs.taxInput.value = taxLabel;
  var validInvoiceKinds = ['INVOICE_KIND_NOT_TARGET', 'INVOICE_KIND_QUALIFIED', 'INVOICE_KIND_UNQUALIFIED_80'];
  if (sugg.invoice_kind && validInvoiceKinds.indexOf(sugg.invoice_kind) >= 0) {
    refs.invoiceSelect.value = sugg.invoice_kind;
  }

  var count = Number(sugg.count) || 0;
  var total = Number(sugg.total) || 0;
  var ratio = total > 0 ? count / total : 0;
  var pct = total > 0 ? Math.round(ratio * 100) : 0;
  var lastDateText = sugg.last_date ? txwFormatDateSlash(sugg.last_date) : '不明';
  var baseText = (total > count)
    ? ('過去' + total + '件中' + count + '件（' + pct + '%・残り' + (total - count) + '件は別内容）')
    : ('過去' + count + '件（一致していない仕訳はありません）');
  refs.reasonText.textContent = baseText + '・最終 ' + lastDateText;

  // ⚠ 一覧には補助科目の欄が無い（カード表示にはある）。提案に補助科目が含まれていても
  //    一覧から登録すると付かないため、**黙って落とさずその場で伝える**（§12の考え方）。
  //    同じ明細をカードから登録した場合と結果が変わってしまうため。
  if (refs.subHintEl) { refs.subHintEl.remove(); refs.subHintEl = null; }
  if (sugg.sub_account_id) {
    var subName = sugg.sub_account_name || '補助科目';
    var hint = el('div', {
      style: 'margin-top:2px;color:#92400e;font-weight:700;',
      text: '※ 補助科目「' + subName + '」の提案がありますが、一覧には補助科目の欄がありません。'
        + '付けたい場合はカード表示に切り替えて登録してください。'
    });
    refs.tdReason.appendChild(hint);
    refs.subHintEl = hint;
  }

  if (refs.badgeEl) { refs.badgeEl.remove(); refs.badgeEl = null; }
  var lowMatch = total > 0 && ratio >= 0.6 && ratio < 0.8;
  refs.tr.classList.toggle('txw-lt-lowmatch', lowMatch);
  if (lowMatch) {
    var badge = el('span', { class: 'chip chip-yellow', text: '要確認', style: 'margin-left:6px;' });
    refs.tdReason.insertBefore(badge, refs.clearBtn);
    refs.badgeEl = badge;
  }
  refs.updateRowEnabled();
}

/* ---- Shift+クリック／Shift+↑↓ による範囲選択（§1.2・§10.1-5。マウス無しでも伸ばせる） ----
 * 対象は「必須項目が埋まっている(disabledでない)行」のみ。DOM表示順で数える。 */
function txwListEligibleRefsInOrder() {
  var trs = Array.prototype.slice.call(document.querySelectorAll('#txwListTbody .txw-lt-row'));
  var out = [];
  trs.forEach(function (tr) {
    var r = txwListRowRefsByTx[tr.dataset.tx];
    if (r && r.rowState.ready) out.push(r);
  });
  return out;
}
function txwListCountChecked() {
  var n = 0;
  Object.keys(txwListRowRefsByTx).forEach(function (k) {
    if (txwListRowRefsByTx[k].checkbox.checked) n++;
  });
  return n;
}
function txwListHandleShiftClick(refs, ev) {
  var eligible = txwListEligibleRefsInOrder();
  var idx = eligible.indexOf(refs);
  if (ev.shiftKey && txwListLastCheckedTx) {
    var lastIdx = -1;
    eligible.forEach(function (r, i) { if (r.txId === txwListLastCheckedTx) lastIdx = i; });
    if (lastIdx >= 0 && idx >= 0) {
      var lo = Math.min(lastIdx, idx), hi = Math.max(lastIdx, idx);
      var want = refs.checkbox.checked;
      for (var i = lo; i <= hi; i++) {
        // 上限20は「押してから弾かない」(§10.1-2)。伸ばしている途中で上限に届いたらそこで止める。
        if (want && !eligible[i].checkbox.checked && txwListCountChecked() >= TXW_LIST_MAX_CHECK) break;
        eligible[i].checkbox.checked = want;
      }
    }
  }
  txwListLastCheckedTx = refs.txId;
  txwListUpdateCounter();
}
function txwListHandleShiftArrow(refs, ev) {
  if (!ev.shiftKey || (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')) return;
  ev.preventDefault();
  var eligible = txwListEligibleRefsInOrder();
  var idx = eligible.indexOf(refs);
  if (idx < 0) return;
  var nextIdx = idx + (ev.key === 'ArrowDown' ? 1 : -1);
  if (nextIdx < 0 || nextIdx >= eligible.length) return;
  var target = eligible[nextIdx];
  if (!target.checkbox.checked && txwListCountChecked() >= TXW_LIST_MAX_CHECK) return;
  target.checkbox.checked = refs.checkbox.checked;
  txwListLastCheckedTx = refs.txId;
  txwListUpdateCounter();
  try { target.checkbox.focus(); } catch (e) {}
}

/* ---- チェック数・カウンター・20行上限の反映（§10.1-2: 押してから弾かない） ---- */
function txwListUpdateCounter() {
  var refsList = Object.keys(txwListRowRefsByTx).map(function (k) { return txwListRowRefsByTx[k]; });
  var n = 0;
  refsList.forEach(function (r) {
    // 登録済み・スキップ済みの行はDOMから作り直されており、checkboxへの参照が古い(切り離し済み)ため数えない。
    if (r.tr.classList.contains('txw-lt-row-done')) return;
    if (r.checkbox.checked) n++;
  });
  txwListCheckedCount = n;

  var chip = document.getElementById('txwListCounter');
  if (chip) chip.textContent = n + '/' + TXW_LIST_MAX_CHECK;

  var btn = document.getElementById('txwListRegisterBtn');
  if (btn) {
    btn.textContent = 'チェックした' + n + '件を登録する';
    btn.disabled = txwListRunning || n === 0;
  }

  if (txwListRunning) return; // 実行中のdisabled状態はtxwListSetRunningUiが管理する
  refsList.forEach(function (r) {
    if (r.tr.classList.contains('txw-lt-row-done')) return; // 登録済みの行は触らない
    if (!r.rowState.ready) { r.checkbox.disabled = true; return; }
    if (r.checkbox.checked) { r.checkbox.disabled = false; return; }
    r.checkbox.disabled = n >= TXW_LIST_MAX_CHECK;
  });
}

/* ---- 実行中は編集欄・チェックボックスを触れないようにする ---- */
function txwListSetRunningUi(running) {
  txwListRunning = running;
  Object.keys(txwListRowRefsByTx).forEach(function (k) {
    var r = txwListRowRefsByTx[k];
    if (r.tr.classList.contains('txw-lt-row-done')) return;
    r.checkbox.disabled = running || !r.rowState.ready || (!r.checkbox.checked && txwListCheckedCount >= TXW_LIST_MAX_CHECK);
    r.accountInput.disabled = running;
    r.taxInput.disabled = running;
    r.invoiceSelect.disabled = running;
    r.clearBtn.disabled = running;
    r.registerBtn.disabled = running || !r.rowState.ready;
    if (r.evidenceCheckbox) r.evidenceCheckbox.disabled = running;
  });
  var abortBtn = document.getElementById('txwListAbortBtn');
  if (abortBtn) abortBtn.style.display = running ? '' : 'none';
  var regBtn = document.getElementById('txwListRegisterBtn');
  if (regBtn) regBtn.disabled = running || txwListCheckedCount === 0;
  if (!running) txwListUpdateCounter();
}

/* ---- 1件のjournalize呼び出し（カード表示のtxwSubmitJournalと同じAPI・同じペイロード形） ----
 * kind: 'server'（通信失敗・5xx・MF側失敗＝連続3件で自動停止の対象） /
 *       'already'（既に仕訳済み＝正常なすれ違い。失敗数に入れない §10.1-1） /
 *       'rejected'（入力内容の問題など。表示はするが自動停止のカウントには入れない） / 'auth'（要再ログイン） */
async function txwListJournalizeRow(tx, refs) {
  var accountId = txwResolveId(txwAccountLookup, refs.accountInput.value);
  if (!accountId) return { ok: false, kind: 'rejected', message: '勘定科目を候補から選んでください。' };

  var payload = { action: 'journalize', transaction_id: tx.transaction_id, date: tx.date, account_id: accountId };
  var taxId = txwResolveId(txwTaxLookup, refs.taxInput.value);
  if (taxId) payload.tax_id = taxId;
  if (refs.invoiceSelect.value) payload.invoice_kind = refs.invoiceSelect.value;
  if (refs.evidenceCheckbox && refs.evidenceCheckbox.checked && refs.evidenceId) {
    payload.evidence_ids = [refs.evidenceId];
  }

  var result;
  try {
    result = await txwApiCall('journalize', payload);
  } catch (e) {
    return { ok: false, kind: 'server', message: '通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。' };
  }
  if (result.status === 401) return { ok: false, kind: 'auth' };

  var data = result.data || {};
  if (!data.ok) {
    if (data.error === 'already_journalized') return { ok: false, kind: 'already', data: data };
    var isServerSide = result.status >= 500 || data.error === 'journalize_failed';
    return { ok: false, kind: isServerSide ? 'server' : 'rejected', data: data, message: txwJournalizeErrorMessage(data) };
  }
  return { ok: true, data: data };
}

/* ---- 行ごとの「登録」（今すぐ1件だけ登録したい場合） ---- */
async function txwListRegisterOne(refs) {
  if (refs.registerBtn.disabled) return;
  refs.registerBtn.disabled = true;
  refs.registerBtn.textContent = '登録中…';
  refs.checkbox.disabled = true;
  refs.accountInput.disabled = true;
  refs.taxInput.disabled = true;
  refs.invoiceSelect.disabled = true;
  refs.clearBtn.disabled = true;
  clearEl(refs.statusDiv);

  var r = await txwListJournalizeRow(refs.tx, refs);
  if (r.kind === 'auth') { txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }
  if (r.ok) { txwMarkListRowDone(refs, r.data); return; }
  if (r.kind === 'already') { txwMarkListRowSkipped(refs); return; }

  // 失敗: 編集できる状態に戻し、エラーを表示する
  refs.accountInput.disabled = false;
  refs.taxInput.disabled = false;
  refs.invoiceSelect.disabled = false;
  refs.clearBtn.disabled = false;
  refs.registerBtn.textContent = '登録';
  refs.registerBtn.disabled = !refs.rowState.ready;
  refs.checkbox.disabled = !refs.rowState.ready || (txwListCheckedCount >= TXW_LIST_MAX_CHECK && !refs.checkbox.checked);
  refs.statusDiv.appendChild(el('div', {
    class: 'note danger', style: 'margin:4px 0 0;padding:5px 7px;font-size:12px;',
    text: r.message || '登録に失敗しました。'
  }));
}

/* ---- 登録成功時: 行を畳んで結果を表示し、対応するカード（存在すれば）も畳んで件数を一致させる ---- */
function txwMarkListRowDone(refs, data) {
  refs.tr.classList.add('txw-lt-row-done');
  refs.tr.classList.remove('txw-lt-lowmatch');
  clearEl(refs.tr);
  var wrap = el('div');
  var msg = '登録しました（仕訳ID ' + (data && data.journal_id != null ? data.journal_id : '不明') + '）';
  var attached = data && Array.isArray(data.attached) ? data.attached : [];
  if (attached.length) msg += '　証憑' + attached.length + '件を添付しました。';
  wrap.appendChild(el('div', { class: 'note ok', style: 'margin:0;', text: msg }));
  var attachFailed = data && Array.isArray(data.attach_failed) ? data.attach_failed : [];
  if (attachFailed.length) {
    wrap.appendChild(el('div', {
      class: 'note danger', style: 'margin:4px 0 0;',
      text: '仕訳は登録できましたが、証憑' + attachFailed.length + '件の添付に失敗しました。'
    }));
  }
  if (data && data.duplicate_warning) {
    wrap.appendChild(el('div', {
      class: 'note warn', style: 'margin:4px 0 0;',
      text: '⚠ この明細から仕訳が' + data.duplicate_warning + '件見つかりました。MFの画面でご確認ください。'
    }));
  }
  var td = document.createElement('td');
  td.setAttribute('colspan', '9');
  td.appendChild(wrap);
  refs.tr.appendChild(td);

  var cardRefs = txwCardRefsByTx[refs.txId];
  if (cardRefs && cardRefs.card && !cardRefs.card.classList.contains('jcard-collapsed')) {
    txwCollapseCardSuccess(cardRefs.card, data, refs.txId);
  } else {
    txwRefreshUnmatchedCount();
  }
  txwListUpdateCounter(); // 完了した行をチェック数・上限判定から外す
}

/* ---- 既に仕訳済み（他の操作との正常なすれ違い）: スキップとして畳む。失敗扱いにしない(§10.1-1) ---- */
function txwMarkListRowSkipped(refs) {
  refs.tr.classList.add('txw-lt-row-done');
  refs.tr.classList.remove('txw-lt-lowmatch');
  clearEl(refs.tr);
  var td = document.createElement('td');
  td.setAttribute('colspan', '9');
  td.appendChild(el('div', {
    class: 'note warn', style: 'margin:0;',
    text: 'スキップ（想定内）：この明細は既に仕訳済みでした。画面を再読み込みすると一覧から消えます。'
  }));
  refs.tr.appendChild(td);

  var cardRefs = txwCardRefsByTx[refs.txId];
  if (cardRefs && cardRefs.card && !cardRefs.card.classList.contains('jcard-collapsed')) {
    clearEl(cardRefs.card);
    cardRefs.card.classList.add('jcard-collapsed');
    cardRefs.card.appendChild(el('div', {
      class: 'note warn', text: 'この明細は既に仕訳済みでした（他の操作で処理済みの可能性があります）。'
    }));
  }
  txwRefreshUnmatchedCount();
  txwListUpdateCounter(); // 完了した行をチェック数・上限判定から外す
}

/* ---- カード表示から登録されたとき、一覧側の同じ行も畳んでおく（逆方向の同期） ---- */
function txwSyncListRowFromCard(txId, data) {
  var rowRefs = txwListRowRefsByTx[txId];
  if (!rowRefs || rowRefs.tr.classList.contains('txw-lt-row-done')) return;
  rowRefs.tr.classList.add('txw-lt-row-done');
  rowRefs.tr.classList.remove('txw-lt-lowmatch');
  clearEl(rowRefs.tr);
  var msg = '登録しました（仕訳ID ' + (data && data.journal_id != null ? data.journal_id : '不明') + '）';
  var td = document.createElement('td');
  td.setAttribute('colspan', '9');
  td.appendChild(el('div', { class: 'note ok', style: 'margin:0;', text: msg }));
  rowRefs.tr.appendChild(td);
  txwListUpdateCounter(); // 完了した行をチェック数・上限判定から外す
}

/* ---- 実行中の見え方: 行を1本ずつ追加し、結果が出たら右側の状態だけ書き換える ---- */
function txwListAppendExecRow(label) {
  var panel = document.getElementById('txwListExecPanel');
  var row = el('div', { class: 'exec-row' });
  row.appendChild(el('span', { text: label }));
  var right = el('span', { class: 'exec-run', text: '⏳ 実行中…' });
  row.appendChild(right);
  if (panel) panel.appendChild(row);
  return right;
}
function txwListUpdateExecRow(rightEl, text, kind) {
  if (!rightEl) return;
  rightEl.textContent = text;
  rightEl.className = 'exec-' + kind;
}
function txwListAppendPlainRow(text, kind) {
  var panel = document.getElementById('txwListExecPanel');
  if (!panel) return;
  var row = el('div', { class: 'exec-row' });
  row.appendChild(el('span', { text: text, class: 'exec-' + (kind || 'info') }));
  panel.appendChild(row);
}

/* ---- 「チェックした◯件を登録する」: 1件ずつ順番に送るだけ。サーバーは変更しない(§1.2) ---- */
async function txwListConfirm() {
  if (txwListRunning) return;
  var trs = Array.prototype.slice.call(document.querySelectorAll('#txwListTbody .txw-lt-row'));
  var ordered = trs
    .map(function (tr) { return txwListRowRefsByTx[tr.dataset.tx]; })
    .filter(function (r) { return r && r.checkbox.checked && !r.tr.classList.contains('txw-lt-row-done'); });
  var n = ordered.length;
  if (!n) return;
  if (n > TXW_LIST_MAX_CHECK) {
    txwShowGlobalError('一度に登録できるのは' + TXW_LIST_MAX_CHECK + '行までです。');
    return;
  }
  if (!window.confirm(n + '件を1件ずつ順番に登録します。よろしいですか？')) return;

  txwListSetRunningUi(true);
  txwListAbort = false;
  var execWrap = document.getElementById('txwListExecWrap');
  var execPanel = document.getElementById('txwListExecPanel');
  if (execPanel) clearEl(execPanel);
  if (execWrap) execWrap.style.display = '';

  var consecutiveFail = 0;
  for (var i = 0; i < ordered.length; i++) {
    if (txwListAbort) {
      txwListAppendPlainRow('中止しました。ここから先は送信していません。', 'info');
      break;
    }
    var refs = ordered[i];
    var tx = refs.tx;
    var label = (tx.date || '') + '　' + (tx.content || '') + '　' + yen(Math.abs(Number(tx.value) || 0));
    var rightEl = txwListAppendExecRow(label);

    var r = await txwListJournalizeRow(tx, refs);
    if (r.kind === 'auth') {
      txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
      return;
    }
    if (r.ok) {
      txwListUpdateExecRow(rightEl, '✓ 登録済み（仕訳ID ' + (r.data.journal_id != null ? r.data.journal_id : '不明') + '）', 'ok');
      txwMarkListRowDone(refs, r.data);
      consecutiveFail = 0;
    } else if (r.kind === 'already') {
      txwListUpdateExecRow(rightEl, 'スキップ（想定内）: 既に仕訳済みでした', 'skip');
      txwMarkListRowSkipped(refs);
      consecutiveFail = 0;
    } else {
      txwListUpdateExecRow(rightEl, '✗ 失敗: ' + (r.message || '登録に失敗しました。'), 'fail');
      // §10.1-1: 数えるのは通信・サーバーエラーだけ。already_journalizedや入力内容の問題は数えない。
      consecutiveFail = (r.kind === 'server') ? (consecutiveFail + 1) : 0;
      if (consecutiveFail >= 3) {
        txwListAppendPlainRow('通信・サーバーエラーが3件連続したため、ここで自動的に停止しました。', 'info');
        break;
      }
    }
  }

  txwListSetRunningUi(false);
}
function txwListAbortRun() {
  txwListAbort = true;
}

/* ---------------- Phase 4: 過去の仕訳からの提案(suggest) ---------------- */
// suggestは補助機能。失敗しても明細一覧の表示・登録操作には一切影響させない。
async function txwLoadSuggestions(items, gen) {
  var payloadItems = (items || [])
    // カード表示・一覧表示のどちらかにその明細の入力欄がある(=writable)ものだけ対象にする。
    .filter(function (tx) { return tx && (txwCardRefsByTx[tx.transaction_id] || txwListRowRefsByTx[tx.transaction_id]); })
    .slice(0, 200)
    // side（入金か出金か）は必須。サーバーはこれで借方・貸方どちらを提案に使うか決める。
    // 入金の明細で借方を見ると「普通預金」を提案してしまう（MFが自動で埋める側のため）。
    .map(function (tx) { return { transaction_id: tx.transaction_id, content: tx.content, date: tx.date, side: tx.side }; });
  if (!payloadItems.length) return;

  var result;
  try {
    result = await txwApiCall('suggest', { items: payloadItems });
  } catch (e) {
    if (gen !== txwRenderGen) return;
    txwFillNoSuggestionText(payloadItems, {});
    return; // 通信失敗。提案が入らないだけで、明細自体は普通に操作できる
  }
  if (gen !== txwRenderGen) return; // その間に月が変わる等で描画し直されていたら捨てる

  var data = result.data || {};
  // ok:false（scope_missingなど）や note:'journals_fetch_failed' のときも suggestions は
  // 空(または存在しない)ものとして扱い、画面は通常どおり操作できる状態のままにする。
  var suggestions = (data.ok && data.suggestions && typeof data.suggestions === 'object') ? data.suggestions : {};
  Object.keys(suggestions).forEach(function (txId) {
    var cardRefs = txwCardRefsByTx[txId];
    if (cardRefs) txwApplySuggestion(cardRefs, suggestions[txId]);
    var rowRefs = txwListRowRefsByTx[txId];
    if (rowRefs) txwApplySuggestionToRow(rowRefs, suggestions[txId]);
  });
  txwFillNoSuggestionText(payloadItems, suggestions);
}

// 一覧表示の「提案の根拠」欄: 提案が無い(=suggestionsにキーが無い)行を
// 「提案を確認中…」のまま止めず、「該当する提案はありません」で確定させる。
function txwFillNoSuggestionText(payloadItems, suggestions) {
  (payloadItems || []).forEach(function (it) {
    if (suggestions[it.transaction_id]) return;
    var rowRefs = txwListRowRefsByTx[it.transaction_id];
    if (rowRefs && rowRefs.reasonText.textContent === '提案を確認中…') {
      rowRefs.reasonText.textContent = '該当する提案はありません';
    }
  });
}

// 提案1件をカードへ反映する。IDに対応するラベルが無い項目は空のままにする(§9-2, 決めつけない)。
function txwApplySuggestion(refs, sugg) {
  if (!sugg) return;
  var accLabel = txwIdToLabel(txwAccountLookup, sugg.account_id);
  var subLabel = txwIdToLabel(txwSubAccountLookup, sugg.sub_account_id);
  var taxLabel = txwIdToLabel(txwTaxLookup, sugg.tax_id);
  if (accLabel) refs.accountInput.value = accLabel;
  if (subLabel) refs.subInput.value = subLabel;
  if (taxLabel) refs.taxInput.value = taxLabel;
  var validInvoiceKinds = ['INVOICE_KIND_NOT_TARGET', 'INVOICE_KIND_QUALIFIED', 'INVOICE_KIND_UNQUALIFIED_80'];
  if (sugg.invoice_kind && validInvoiceKinds.indexOf(sugg.invoice_kind) >= 0) {
    refs.invoiceSelect.value = sugg.invoice_kind;
  }
  refs.updateSubmitEnabled();

  var count = Number(sugg.count) || 0;
  var total = Number(sugg.total) || 0;
  var countText = (total > count) ? (total + '件中' + count + '件') : (count + '件');
  var lastDateText = sugg.last_date ? txwFormatDateSlash(sugg.last_date) : '不明';
  refs.suggestText.textContent =
    '前回の仕訳から入れています。確認してください。（過去' + countText + '・最終 ' + lastDateText + '）';
  refs.suggestNote.style.display = 'flex';
}

function txwShowCardError(refs, msg) {
  clearEl(refs.statusArea);
  refs.statusArea.appendChild(el('div', { class: 'note danger', text: msg }));
  refs.statusArea.style.display = 'block';
}

function txwJournalizeErrorMessage(data) {
  switch (data && data.error) {
    case 'already_journalized':
      return 'この明細は既に仕訳済みです。画面を再読み込みしてください。';
    case 'transaction_not_found':
      return '明細が見つかりませんでした。画面を再読み込みしてください。';
    case 'closed_term_blocked': {
      // 「決算済みの期には登録しない」設定によりサーバーが拒否した
      var t = data.term;
      var when = t ? (t.fiscal_year + '年度（' + txwFormatDateSlash(t.start_date) + '〜' + txwFormatDateSlash(t.end_date) + '）') : '進行中でない期';
      return 'この明細は ' + when + ' のもので、「決算が終わった期には登録しない」設定になっているため登録できません。'
        + '登録が必要な場合は、画面上部の設定を変更してください。';
    }
    case 'journalize_failed':
      // MFが決算済みの期を拒否した場合などのため、文言を決め打ちせずそのまま出す
      /* MFが返したメッセージは英語・専門用語のことがあり、そのまま出すと
       * 何をすればよいか分からない。文言は決め打ちせず（MF側の事情を勝手に
       * 解釈しないため）、前に一言添えて「担当者に伝える」という次の行動を示す。 */
      return data.message
        ? '会計システム側でエラーが返されました。次の内容をそのままRIBRE担当者にお伝えください：「' + String(data.message) + '」'
        : '仕訳の登録に失敗しました。';
    case 'scope_missing':
      return 'MF連携の権限が不足しています。管理者による再連携が必要です。';
    case 'transaction_check_failed':
      return data.message ? String(data.message) : '明細の確認に失敗しました。もう一度お試しください。';
    case 'invoice_kind_required':
      return 'インボイス区分が選ばれていません。「対象外」「適格」「8割控除」のいずれかを選んでから登録してください。';
    case 'invalid_request':
      return '入力内容が正しくありません。勘定科目をご確認ください。';
    default:
      return '登録に失敗しました。しばらくしてからもう一度お試しください。';
  }
}

// 登録成功時: カードを畳んで結果を表示する(§B)。仕訳の成功と証憑添付の失敗は必ず分けて表示する。
// transactionId を渡すと、一覧表示の同じ行（存在すれば）も畳んで両表示の状態・件数を一致させる。
function txwCollapseCardSuccess(card, data, transactionId) {
  clearEl(card);
  card.classList.add('jcard-collapsed');
  var attached = Array.isArray(data.attached) ? data.attached : [];
  var mainMsg = '登録しました（仕訳ID ' + (data.journal_id != null ? data.journal_id : '不明') + '）';
  if (attached.length) mainMsg += '　証憑' + attached.length + '件を添付しました。';
  card.appendChild(el('div', { class: 'note ok', text: mainMsg }));

  var attachFailed = Array.isArray(data.attach_failed) ? data.attach_failed : [];
  if (attachFailed.length) {
    card.appendChild(el('div', {
      class: 'note danger',
      text: '仕訳は登録できましたが、証憑' + attachFailed.length + '件の添付に失敗しました。'
    }));
  }
  if (data.duplicate_warning) {
    card.appendChild(el('div', {
      class: 'note warn',
      text: '⚠ この明細から仕訳が' + data.duplicate_warning + '件見つかりました。MFの画面でご確認ください。'
    }));
  }
  // 残りの件数をその場で更新する（読み込み直すまで数字が減らず、
  // どこまで終わったか分からなかった）
  txwRefreshUnmatchedCount();
  // 次の未登録カードの最初の入力欄へ移す。
  // 件数をまたぐ連続作業でマウスに持ち替えずに済む。
  txwFocusNextCard(card);
  if (transactionId) txwSyncListRowFromCard(transactionId, data);
}

// まだ登録していないカードの数を数え直して表示する
function txwRefreshUnmatchedCount() {
  var el2 = document.getElementById('txwUnmatchedCount');
  if (!el2) return;
  var rest = document.querySelectorAll('.jcard:not(.jcard-collapsed)').length;
  // ⚠ 数えているのは「今表示されているカード」なので、絞り込み中は
  //   その科目の分しか見ていない。「すべて処理しました」と言い切ると
  //   他の科目に未仕訳が残っていても終わったと誤解させる。
  if (txwUnmatchedFilter && txwUnmatchedFilter.active) {
    el2.textContent = rest
      ? ('未仕訳 ' + rest + '件（絞り込み中）')
      : 'この絞り込みの分は処理しました（絞り込みを解除すると残りが見えます）';
    return;
  }
  el2.textContent = rest ? ('未仕訳 ' + rest + '件') : 'この月の未仕訳はすべて処理しました';
}

// 登録が終わったカードの次にある「まだ登録していないカード」の勘定科目欄へ移動する
function txwFocusNextCard(doneCard) {
  var cards = [].slice.call(document.querySelectorAll('.jcard'));
  var i = cards.indexOf(doneCard);
  for (var k = i + 1; k < cards.length; k++) {
    if (cards[k].classList.contains('jcard-collapsed')) continue;
    var input = cards[k].querySelector('input[list="txwAccountsDatalist"]');
    if (!input) continue;
    try {
      cards[k].scrollIntoView({ block: 'center', behavior: 'smooth' });
      input.focus();
    } catch (e) {}
    return;
  }
}

async function txwSubmitJournal(tx, refs) {
  if (refs.submitBtn.disabled) return;
  var accountId = txwResolveId(txwAccountLookup, refs.accountInput.value);
  if (!accountId) { return; } // 安全側の二重チェック(通常はボタンが無効化されている)

  // 二重送信を防ぐ: 押した直後にボタンを無効化する
  refs.submitBtn.disabled = true;
  refs.submitBtn.textContent = '登録中…';
  clearEl(refs.statusArea);
  refs.statusArea.style.display = 'none';

  var payload = { action: 'journalize', transaction_id: tx.transaction_id, date: tx.date, account_id: accountId };
  var taxId = txwResolveId(txwTaxLookup, refs.taxInput.value);
  if (taxId) payload.tax_id = taxId;
  var subId = txwResolveId(txwSubAccountLookup, refs.subInput.value);
  if (subId) payload.sub_account_id = subId;
  if (refs.invoiceSelect.value) payload.invoice_kind = refs.invoiceSelect.value;
  var memo = (refs.memoInput.value || '').trim();
  if (memo) payload.memo = memo;
  var evidenceIds = refs.evidenceCheckboxes
    .filter(function (c) { return c.checkbox.checked; })
    .map(function (c) { return c.evidence_id; });
  if (evidenceIds.length) payload.evidence_ids = evidenceIds;

  var result;
  try {
    result = await txwApiCall('journalize', payload);
  } catch (e) {
    txwShowCardError(refs, '通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。');
    refs.submitBtn.disabled = false;
    refs.submitBtn.textContent = 'この内容で登録する';
    return;
  }

  if (result.status === 401) {
    txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
    return;
  }

  var data = result.data || {};
  if (!data.ok) {
    txwShowCardError(refs, txwJournalizeErrorMessage(data));
    refs.submitBtn.disabled = false;
    refs.submitBtn.textContent = 'この内容で登録する';
    return;
  }

  txwCollapseCardSuccess(refs.card, data, tx.transaction_id);
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
  // 操作履歴は開くたびに読み直す（自分や他の人の登録が随時増えるため）
  if (t === 'history') txwLoadActionLog();
  // ⑨月次チェックも開くたびに読み直す（推移表・未仕訳件数とも随時変わるため）
  if (t === 'monthly') txwLoadMonthlyCheck();
}

/* ---------------- ④ 操作履歴 ----------------
 * MF側では仕訳が全て「連携アプリ」名義で作られ、誰が作ったか分からない。
 * そのため**この履歴がこの機能の唯一の監査証跡**（設計書§5-5）。
 * 社内メンバーは全件、税理士は自分の操作だけ見える。 */
function txwActionLabel(a) {
  if (a === 'journalize') return '仕訳の登録';
  if (a === 'set_closed_term_policy') return '設定の変更';
  return a || '-';
}
function txwResultLabel(r) {
  if (r === 'ok') return '成功';
  if (r === 'journal_ok_voucher_failed') return '仕訳のみ成功（証憑の添付は失敗）';
  if (r === 'failed') return '失敗';
  return r || '-';
}

async function txwLoadActionLog() {
  var body = document.getElementById('txwHistoryBody');
  if (!body) return;
  clearEl(body);
  body.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  var result;
  try {
    result = await txwApiCall('action_log', {});
  } catch (e) {
    clearEl(body);
    body.appendChild(el('div', { class: 'note danger', text: '操作履歴の取得に失敗しました。時間をおいてお試しください。' }));
    return;
  }
  var data = result.data || {};
  clearEl(body);
  if (!data.ok) {
    body.appendChild(el('div', { class: 'note danger', text: '操作履歴の取得に失敗しました（' + (data.error || '不明') + '）。' }));
    return;
  }
  var rows = Array.isArray(data.actions) ? data.actions : [];
  body.appendChild(el('div', {
    class: 'note info',
    text: data.scope === 'all'
      ? 'すべての方の操作を新しい順に表示しています（最大200件）。この記録は消せません。'
      : 'ご自身の操作を新しい順に表示しています（最大200件）。この記録は消せません。'
  }));
  if (!rows.length) {
    body.appendChild(el('div', { class: 'hist-empty', text: 'まだ操作の記録はありません。' }));
    return;
  }
  var wrap = el('div', { style: 'overflow-x:auto' });
  var table = el('table');
  var thead = el('thead');
  var htr = el('tr');
  // 税務調査で画面だけで答えられるように、勘定科目・税区分・証憑まで出す
  ['日時', '操作した人', '操作', '結果', '仕訳ID', '勘定科目', '税区分', '証憑', '備考']
    .forEach(function (h) { htr.appendChild(el('th', { text: h })); });
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = el('tbody');
  rows.forEach(function (a) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: a.created_at ? new Date(a.created_at).toLocaleString('ja-JP') : '-' }));
    tr.appendChild(el('td', { text: a.actor_email || '-' }));
    tr.appendChild(el('td', { text: txwActionLabel(a.action) }));
    tr.appendChild(el('td', { text: txwResultLabel(a.result) }));
    tr.appendChild(el('td', { text: a.journal_id || '-' }));
    // IDのままでは読めないので、マスタから名前へ逆引きする。見つからなければIDをそのまま出す
    tr.appendChild(el('td', { text: txwIdToLabel(txwAccountLookup, a.account_id) || a.account_id || '-' }));
    tr.appendChild(el('td', { text: txwIdToLabel(txwTaxLookup, a.tax_id) || a.tax_id || '-' }));
    tr.appendChild(el('td', { text: (a.evidence_ids && a.evidence_ids.length) ? (a.evidence_ids.length + '件') : '-' }));
    tr.appendChild(el('td', { text: a.error_message || '' }));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* ---------------- ⑨ 月次チェック ----------------
 * action:'monthly_check' は読み取り専用（MFへ書き込まない）。タブを開くたび・対象月を
 * 変えるたび・しきい値を変えて「この条件で見直す」を押すたびに呼ぶ。
 * ⚠ month_in_progress:true のときAPIはmissingを空で返す（月の途中は計上漏れ判定をしない）。
 * ⚠ 判定結果を人間が確認した記録(monthly_check_confirm)はサーバー側でもconfirmed!==trueを
 *   拒否する。画面のdisabledはあくまで案内であって、それだけに頼らない。 */
function txwMonthlyFormatMonth(month) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  return Number(m[2]) + '月';
}
function txwMonthlyFormatYearMonth(month) {
  var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '');
  return m[1] + '年' + Number(m[2]) + '月';
}

function txwMonthlyMapError(data) {
  switch (data && data.error) {
    case 'report_scope_missing':
      return '月次チェックにはMF連携のやり直しが必要です。証憑インボックスの「再連携」を押してください。';
    case 'scope_missing':
      return 'MF連携の権限が不足しています。管理者による再連携が必要です。';
    case 'no_term_for_month':
      return data.message ? String(data.message) : 'その月を含む会計年度がMFに見つかりません。';
    case 'invalid_month':
      return '対象月の指定が正しくありません。';
    case 'not_connected':
      return 'MFと連携されていません。管理者にご連絡ください。';
    default:
      // ⚠ 原因の分からないエラーで「しばらくしてからお試しください」とだけ出すと、
      //   こちらも利用者も何が起きたか分からない。**必ず手がかりを添える。**
      return (data && data.message ? String(data.message) : 'エラーが発生しました。')
        + '（種別: ' + ((data && data.error) || '不明') + '）';
  }
}

function txwShowMonthlyError(msg) {
  var box = document.getElementById('txwMonthlyGlobalError');
  box.textContent = msg;
  box.style.display = 'block';
  document.getElementById('txwMonthlyBody').style.display = 'none';
  clearEl(document.getElementById('txwMonthlyStatusBox'));
}

// 先頭: 対象月の未仕訳の残件数と、登録の進み具合(§11.1)。partial/registration_done/
// unjournalized_countの組み合わせで文言と色を切り替える。3つは互いに排他になるよう
// サーバー側で設計されている(unjournalized_count===nullのときはpartialも常にtrueだが、
// 「件数が取れなかった」を先に判定することでこの文言だけを出す)。
function txwRenderMonthlyStatus(data) {
  var box = document.getElementById('txwMonthlyStatusBox');
  clearEl(box);
  var monthLabel = txwMonthlyFormatMonth(data.month);
  var cnt = data.unjournalized_count;
  if (cnt === null || cnt === undefined) {
    box.appendChild(el('div', {
      class: 'note warn',
      text: '未仕訳の件数が取れませんでした。登録が終わっているかご自身でご確認ください。'
    }));
  } else if (data.partial === true) {
    box.appendChild(el('div', {
      class: 'note warn', style: 'font-weight:900;',
      text: monthLabel + 'の未仕訳明細が' + cnt + '件残っています。登録が終わっていない月では、'
        + '下の「まだ無い科目」は当然の結果です。まず①未仕訳の明細を片付けてから、このチェックを見てください。'
    }));
  } else if (data.registration_done === true) {
    box.appendChild(el('div', {
      class: 'note danger',
      text: monthLabel + 'の未仕訳明細は0件です。登録は終わっています。下の「まだ無い科目」は、計上漏れの疑いがあります。'
    }));
  }
  if (data.month_in_progress === true) {
    box.appendChild(el('div', {
      class: 'note danger', style: 'margin-top:8px;',
      text: txwMonthlyFormatYearMonth(data.month) + 'はまだ月の途中です。計上漏れの判定は月が終わってから行います。'
    }));
    box.appendChild(el('div', {
      class: 'note info', style: 'margin-top:8px;',
      text: '②③はこの月についての参考情報として表示しています（月が終わっていないため、計上漏れの判定そのものは行いません）。'
    }));
  }
}

// ① いつもあるのに今月まだ無い科目(missing)。partialのときは見出しに「参考表示」を付け、
// 行の見た目もグレーにする。partialでないときだけ赤くする(§11.1)。
function txwRenderMonthlyMissing(data) {
  var heading = document.getElementById('txwMonthlyMissingHeading');
  heading.textContent = '① いつもあるのに今月まだ無い科目' + (data.partial ? '（登録作業中のため参考表示）' : '');

  var list = document.getElementById('txwMonthlyMissingList');
  clearEl(list);

  if (data.month_in_progress) {
    list.appendChild(el('div', { class: 'evidence-empty', text: '月が終わっていないため、この判定は行いません。' }));
    return;
  }

  var missing = Array.isArray(data.missing) ? data.missing : [];
  if (!missing.length) {
    list.appendChild(el('div', { class: 'evidence-empty', text: '該当する科目はありません。' }));
    return;
  }
  missing.forEach(function (row) {
    var item = el('div', { class: 'txw-monthly-item ' + (data.partial ? 'gray' : 'danger') });
    var pastText = (Array.isArray(row.past) ? row.past : []).map(function (v) { return yen(v); }).join(' → ');
    item.appendChild(el('div', { class: 'txw-mi-title', text: row.account + ' — 過去: ' + pastText + ' → 当月 0円' }));
    var btnRow = el('div', { class: 'txw-mi-btnrow' });
    var n = (row.candidate_transaction_ids || []).length;
    // 候補が0件のときにボタンだけ出すと、押して空振りしてから気づくことになる。
    // 件数を先に見せて、無いなら押させない（§12「見つけられないもの」の考え方）。
    var btn = el('button', {
      type: 'button', class: 'btn-mini',
      text: n ? ('この科目の未仕訳明細をさがす（候補 ' + n + '件）') : '候補になりそうな未仕訳明細はありません'
    });
    if (!n) btn.disabled = true;
    btn.addEventListener('click', function () { txwFilterToUnmatched(row.account, row.candidate_transaction_ids); });
    btnRow.appendChild(btn);
    item.appendChild(btnRow);
    list.appendChild(item);
  });
}

// ② 金額が普段と大きく違う科目(outliers)。中央値と比べて何倍かを添える。
// suppressed_low_outliers>0のときは黙って減らさず、必ずその旨を出す(§12)。
function txwRenderMonthlyOutliers(data) {
  var suppressedBox = document.getElementById('txwMonthlySuppressedNote');
  var suppressed = Number(data.suppressed_low_outliers) || 0;
  if (suppressed > 0) {
    suppressedBox.style.display = 'block';
    suppressedBox.textContent = '※ 登録が途中のため、「普段より少ない」側の' + suppressed + '件は表示していません。'
      + '登録が終わっていない月ではほとんどが「少ない」と判定され、役に立たないためです。登録が終わってからもう一度ご覧ください。';
  } else {
    suppressedBox.style.display = 'none';
    suppressedBox.textContent = '';
  }

  var list = document.getElementById('txwMonthlyOutlierList');
  clearEl(list);
  var outliers = Array.isArray(data.outliers) ? data.outliers : [];
  if (!outliers.length) {
    list.appendChild(el('div', { class: 'evidence-empty', text: '該当する科目はありません。' }));
    return;
  }
  var monthLabel = txwMonthlyFormatMonth(data.month);
  outliers.forEach(function (row) {
    var med = Number(row.past_median) || 0;
    var val = Math.abs(Number(row.value) || 0);
    var multipleText = '';
    if (row.direction === 'low' && val > 0) {
      multipleText = '中央値の約1/' + Math.max(1, Math.round(med / val));
    } else if (med > 0) {
      multipleText = '中央値の約' + Math.max(1, Math.round(val / med)) + '倍';
    }
    var item = el('div', { class: 'txw-monthly-item warn' });
    item.appendChild(el('div', {
      class: 'txw-mi-title',
      text: row.account + ' — 普段は約' + yen(med) + 'ですが、' + monthLabel + 'は' + yen(val) + 'です'
        + (multipleText ? '（' + multipleText + '）' : '')
    }));
    var btnRow = el('div', { class: 'txw-mi-btnrow' });
    var n = (row.candidate_transaction_ids || []).length;
    // 候補が0件のときにボタンだけ出すと、押して空振りしてから気づくことになる。
    // 件数を先に見せて、無いなら押させない（§12「見つけられないもの」の考え方）。
    var btn = el('button', {
      type: 'button', class: 'btn-mini',
      text: n ? ('この科目の未仕訳明細をさがす（候補 ' + n + '件）') : '候補になりそうな未仕訳明細はありません'
    });
    if (!n) btn.disabled = true;
    btn.addEventListener('click', function () { txwFilterToUnmatched(row.account, row.candidate_transaction_ids); });
    btnRow.appendChild(btn);
    btnRow.appendChild(el('a', {
      class: 'btn-mini', href: 'https://biz.moneyforward.com/', target: '_blank', rel: 'noopener noreferrer',
      text: 'MFクラウド会計で見る'
    }));
    item.appendChild(btnRow);
    list.appendChild(item);
  });
}

// ③ 符号がおかしい科目(sign_issues)
function txwRenderMonthlySignIssues(data) {
  var list = document.getElementById('txwMonthlySignIssueList');
  clearEl(list);
  var rows = Array.isArray(data.sign_issues) ? data.sign_issues : [];
  if (!rows.length) {
    list.appendChild(el('div', { class: 'evidence-empty', text: '該当する科目はありません。' }));
    return;
  }
  var monthLabel = txwMonthlyFormatMonth(data.month);
  rows.forEach(function (row) {
    var item = el('div', { class: 'txw-monthly-item danger' });
    item.appendChild(el('div', {
      class: 'txw-mi-title',
      text: row.account + ' — ' + monthLabel + 'が' + yen(row.value) + 'です。取消や振替が入っていないか確認してください。'
    }));
    var btnRow = el('div', { class: 'txw-mi-btnrow' });
    var n = (row.candidate_transaction_ids || []).length;
    // 候補が0件のときにボタンだけ出すと、押して空振りしてから気づくことになる。
    // 件数を先に見せて、無いなら押させない（§12「見つけられないもの」の考え方）。
    var btn = el('button', {
      type: 'button', class: 'btn-mini',
      text: n ? ('この科目の未仕訳明細をさがす（候補 ' + n + '件）') : '候補になりそうな未仕訳明細はありません'
    });
    if (!n) btn.disabled = true;
    btn.addEventListener('click', function () { txwFilterToUnmatched(row.account, row.candidate_transaction_ids); });
    btnRow.appendChild(btn);
    btnRow.appendChild(el('a', {
      class: 'btn-mini', href: 'https://biz.moneyforward.com/', target: '_blank', rel: 'noopener noreferrer',
      text: 'MFクラウド会計で見る'
    }));
    item.appendChild(btnRow);
    list.appendChild(item);
  });
}

// 判定条件（criteriaの実際の値を使う。§5）
function txwRenderMonthlyCriteria(data) {
  var c = data.criteria || {};
  var lookback = c.lookback != null ? c.lookback : 4;
  var ratio = c.ratio != null ? c.ratio : 3;
  var minDiff = c.min_diff != null ? c.min_diff : 10000;
  document.getElementById('txwMonthlyCriteriaNote').textContent =
    '判定条件: 過去' + lookback + 'ヶ月すべてに計上があり当月0／中央値の' + ratio + '倍以上または1/' + ratio
    + '以下かつ差額' + yen(minDiff) + '以上';
}

function txwRenderMonthlyCheck(data) {
  txwRenderMonthlyStatus(data);
  document.getElementById('txwMonthlyBody').style.display = 'block';
  txwRenderMonthlyMissing(data);
  txwRenderMonthlyOutliers(data);
  txwRenderMonthlySignIssues(data);
  txwRenderMonthlyCriteria(data);

  // しきい値入力欄を、サーバーが実際に使った値に合わせる(不正な入力は既定へ戻されるため)。
  var c = data.criteria || {};
  if (c.ratio != null) document.getElementById('txwMonthlyRatioInput').value = c.ratio;
  if (c.min_diff != null) document.getElementById('txwMonthlyMinDiffInput').value = c.min_diff;

  // 新しいデータを見たので、確認記録は毎回チェックし直してもらう(押しっぱなし連投を防ぐ)。
  document.getElementById('txwMonthlyConfirmCheck').checked = false;
  document.getElementById('txwMonthlyConfirmBtn').disabled = true;
  var resultBox = document.getElementById('txwMonthlyConfirmResult');
  resultBox.style.display = 'none';
  resultBox.textContent = '';
}

async function txwLoadMonthlyCheck() {
  var month = document.getElementById('txwMonth').value;
  if (!month) return;

  document.getElementById('txwMonthlyGlobalError').style.display = 'none';
  document.getElementById('txwMonthlyGlobalError').textContent = '';

  var ratioInput = document.getElementById('txwMonthlyRatioInput');
  var minDiffInput = document.getElementById('txwMonthlyMinDiffInput');
  var payload = { month: month };
  var ratioVal = Number(ratioInput.value);
  var minDiffVal = Number(minDiffInput.value);
  if (Number.isFinite(ratioVal)) payload.ratio = ratioVal;
  if (Number.isFinite(minDiffVal)) payload.min_diff = minDiffVal;

  var recheckBtn = document.getElementById('txwMonthlyRecheckBtn');
  recheckBtn.disabled = true;

  var result;
  try {
    result = await txwApiCall('monthly_check', payload);
  } catch (e) {
    recheckBtn.disabled = false;
    txwShowMonthlyError('通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。');
    return;
  }
  recheckBtn.disabled = false;

  if (result.status === 401) {
    txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
    return;
  }
  var data = result.data || {};
  if (!data.ok) {
    // サーバーが理由を返せずに落ちた場合はHTTPの状態しか手がかりが無い。それも出す。
    var extra = (!data.error && result.status !== 200) ? '（HTTP ' + result.status + '）' : '';
    txwShowMonthlyError(txwMonthlyMapError(data) + extra);
    return;
  }
  txwMonthlyLastData = data;
  txwRenderMonthlyCheck(data);
}

// チェックが入っているときだけ「確認を記録する」を押せるようにする。
// ⚠ HTML側にも静的にdisabledを書いてあるため、JSが動かなくても押せないまま側に壊れる。
function txwMonthlyConfirmToggle() {
  var checked = document.getElementById('txwMonthlyConfirmCheck').checked;
  document.getElementById('txwMonthlyConfirmBtn').disabled = !checked;
}

// 「機械が出したフラグの有無にかかわらず、人間が全科目を確認した」という記録。
// サーバー側(handleMonthlyCheckConfirm)でもconfirmed!==trueを拒否する。二重の安全側。
async function txwMonthlyConfirmRecord() {
  var checkEl = document.getElementById('txwMonthlyConfirmCheck');
  var btn = document.getElementById('txwMonthlyConfirmBtn');
  if (!checkEl.checked) return;

  var month = document.getElementById('txwMonth').value;
  var data = txwMonthlyLastData || {};
  btn.disabled = true;
  var resultBox = document.getElementById('txwMonthlyConfirmResult');
  resultBox.style.display = 'none';

  var payload = {
    month: month,
    confirmed: true,
    flag_counts: {
      missing: Array.isArray(data.missing) ? data.missing.length : 0,
      outliers: Array.isArray(data.outliers) ? data.outliers.length : 0,
      sign_issues: Array.isArray(data.sign_issues) ? data.sign_issues.length : 0,
    },
    unjournalized_count: (data.unjournalized_count === null || data.unjournalized_count === undefined)
      ? null : Number(data.unjournalized_count),
  };

  var result;
  try {
    result = await txwApiCall('monthly_check_confirm', payload);
  } catch (e) {
    alert('通信に失敗しました。ネットワークをご確認のうえ、もう一度お試しください。');
    btn.disabled = !checkEl.checked;
    return;
  }
  if (result.status === 401) {
    txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。');
    return;
  }
  var resData = result.data || {};
  if (!resData.ok) {
    alert('記録に失敗しました。もう一度お試しください。');
    btn.disabled = !checkEl.checked;
    return;
  }
  var when = resData.recorded_at ? new Date(resData.recorded_at).toLocaleString('ja-JP') : '';
  resultBox.textContent = '操作履歴に記録しました（' + (resData.by || '') + '・' + when + '）';
  resultBox.style.display = 'block';
  checkEl.checked = false;
  btn.disabled = true;
}

/* ---------------- 初期化 ---------------- */
function txwCurrentMonthDefault() {
  var d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// 対象月は端末に覚えておく。月をまたぐ作業（7月分を8月に登録する等）が普通なので、
// 更新のたびに今月へ戻ると毎回選び直すことになる。
var TXW_MONTH_KEY = 'ribre_txw_month';
function txwSaveMonth(month) {
  try {
    if (/^\d{4}-\d{2}$/.test(String(month || ''))) localStorage.setItem(TXW_MONTH_KEY, month);
  } catch (e) { /* 保存できなくても動作には影響しない */ }
}
function txwRestoreMonth() {
  try {
    var m = localStorage.getItem(TXW_MONTH_KEY);
    if (/^\d{4}-\d{2}$/.test(String(m || ''))) return m;
  } catch (e) { /* 読めなければ既定へ */ }
  return txwCurrentMonthDefault();
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
  document.getElementById('txwMonthlyRecheckBtn').addEventListener('click', txwLoadMonthlyCheck);
  document.getElementById('txwMonthlyConfirmCheck').addEventListener('change', txwMonthlyConfirmToggle);
  document.getElementById('txwMonthlyConfirmBtn').addEventListener('click', txwMonthlyConfirmRecord);

  // ①未仕訳の明細: カード表示／一覧表示の切り替え（既定は一覧表示。端末に記憶する）
  document.getElementById('txwViewBtnCard').addEventListener('click', function () { txwViewSwitch('card'); });
  document.getElementById('txwViewBtnList').addEventListener('click', function () { txwViewSwitch('list'); });
  txwApplyUnmatchedView(txwRestoreUnmatchedView());
  document.getElementById('txwListRegisterBtn').addEventListener('click', txwListConfirm);
  document.getElementById('txwListAbortBtn').addEventListener('click', txwListAbortRun);

  var monthInput = document.getElementById('txwMonth');
  monthInput.value = txwRestoreMonth();
  // 対象月を変えたら①〜⑤に加え、⑨月次チェックも(表示中なら)読み直す。
  // ⑨は「対象月に連動」が要件のため、開いていないタブへの無駄な取得はしない。
  monthInput.addEventListener('change', function () {
    txwSaveMonth(monthInput.value);
    txwLoad();
    var monthlyPage = document.getElementById('t-monthly');
    if (monthlyPage && monthlyPage.classList.contains('active')) txwLoadMonthlyCheck();
  });

  if (txwIsLoggedIn()) { txwHandleLoginSuccess(); }
  else { txwShowGate(''); }

  txwWasLoggedIn = txwIsLoggedIn();
  setInterval(txwSessionWatch, 5000);
}

if (document.readyState !== 'loading') txwInit();
else document.addEventListener('DOMContentLoaded', txwInit);
