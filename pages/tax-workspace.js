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
 *   'advisor_set_enabled'（社内メンバー向け管理。is_member:true のときだけ⑤タブから使う）/
 *   'request_list'（⑩承認待ちの一覧。adminは全員分・担当者は自分の分） /
 *   'request_approve' / 'request_reject'（承認・差し戻し。adminのみ） /
 *   'action_log_csv'（④操作履歴のCSVダウンロード）。
 *   他のAPIエンドポイントは一切叩かない。
 * ⚠ Phase 6: 役割(role)の変更・承認要否(approval_policy)の変更は、サーバー側の関数
 *   （setAdvisorRole/saveApprovalPolicy）はあるが、それを呼ぶ action がディスパッチに
 *   まだ無い。画面側で action を作って叩くことはしない（無いAPIを画面が先回りして
 *   作らない）。⑤タブでは現在値の表示と、Supabase SQL Editorで実行するSQL例の提示だけ行う。
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
// ⑩承認待ち・⑤承認の設定で共有する直近の承認要否設定('none'/'required')。表示専用。
var txwApprovalPolicyValue = 'none';

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
// 提案の根拠がこの件数未満なら「要確認」にする（過去1〜2件は根拠として弱い）
var TXW_THIN_EVIDENCE = 3;
// 証憑の一覧を取れなかったときの理由（空なら成功）
var txwEvidenceLoadFailed = '';
// ③共有ファイルの一覧。①の「共有ファイルから選ぶ」でも使うので画面全体で持つ
var txwSharedFiles = [];
// 証憑にできる形式（PDF・PNG・JPG）だけを返す。判定はサーバーが付けた attachable に従う
function txwAttachableSharedFiles() {
  return (txwSharedFiles || []).filter(function (f) { return f && f.attachable && f.key; });
}
var txwUnmatchedFilter = { active: false, account: '', ids: [] };
// 口座・カードでの絞り込み（''なら全部）。⑨からの科目の絞り込みとは別物で、併用できる
var txwAcctFilter = '';
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
    wrap.appendChild(el('span', { text: '（' + opt.hint + '）', style: 'color:var(--hm-muted);font-weight:700;font-size:11px' }));
    row.appendChild(wrap);
  });
  box.appendChild(row);
  box.appendChild(el('div', {
    id: 'txwPolicySaved', text: '', style: 'font-weight:800;margin-top:6px;min-height:16px'
  }));
}

async function txwSaveClosedTermPolicy(policy) {
  var msg = document.getElementById('txwPolicySaved');
  if (msg) { msg.textContent = '保存中…'; msg.style.color = 'var(--hm-blue)'; }
  try {
    var result = await txwApiCall('set_closed_term_policy', { policy: policy });
    var data = result.data || {};
    if (!data.ok) throw new Error(data.error || 'failed');
    txwClosedTermPolicy = policy;
    if (msg) { msg.textContent = '保存しました'; msg.style.color = 'var(--hm-green-dark)'; }
    txwUpdateTermWarning(document.getElementById('txwMonth').value);
  } catch (e) {
    if (msg) { msg.textContent = '保存できませんでした。もう一度お試しください。'; msg.style.color = 'var(--hm-danger)'; }
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
  m.style.color = 'var(--hm-danger)';
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
      // 招待からの登録は管理者になる。何になったかを本人にも伝える（2026-08-05）
      txwShowInfoBanner('税理士（管理者）として登録しました（' + (data.email || '') + '）');
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
  if (!e || !p) { msgEl.textContent = 'メールとパスワードを入力してください'; msgEl.style.color = 'var(--hm-danger)'; return; }
  msgEl.textContent = 'ログイン中…';
  msgEl.style.color = 'var(--hm-blue)';
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
  if (!e || !p) { msgEl.textContent = 'メールとパスワードを入力してください'; msgEl.style.color = 'var(--hm-danger)'; return; }
  msgEl.textContent = '登録中…';
  msgEl.style.color = 'var(--hm-blue)';
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
      msgEl.style.color = 'var(--hm-danger)';
      msgEl.textContent = '登録できませんでした: ' + text.replace(/\s*(ERROR|OK)\s*$/, '').trim();
      return;
    }
  } catch (err) { msgEl.style.color = 'var(--hm-danger)'; msgEl.textContent = '登録に失敗しました'; return; }
  msgEl.style.color = 'var(--hm-green-dark)';
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
    e.style.background = 'var(--hm-orange-soft)';
    e.style.borderColor = 'var(--hm-danger)';
    e.style.color = 'var(--hm-danger)';
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
  // 列数は表の見出しと合わせること（今は8列）
  tr.appendChild(el('td', { colspan: '8', class: cls, text: text }));
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
  /* ⚠ ①のカードを描く前に用意しておくこと。
   *   txwRenderUnmatched は txwEvidenceLoadFailed と txwSharedFiles を読む。
   *   後から代入すると、初回は前回の値（初回は空）で描かれてしまい、
   *   証憑の取得に失敗しても「候補が見つかりません」に化ける（制約20と同じ穴）。 */
  txwEvidenceLoadFailed = data.evidence_load_failed || '';
  txwSharedFiles = Array.isArray(data.shared_files) ? data.shared_files : [];
  txwRenderUnmatched(Array.isArray(data.items) ? data.items : [], txwWritable);
  txwRenderAwaiting(Number(data.open_evidence_count) || 0,
    !!data.open_evidence_truncated, Number(data.open_evidence_shown) || 0,
    Array.isArray(data.open_evidence) ? data.open_evidence : []);
  txwRenderFiles(txwSharedFiles, data.shared_files_load_failed || '');
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
  var list = items || [];
  // 口座・カードの絞り込みは科目の絞り込みとは独立して効く
  if (txwAcctFilter) {
    list = list.filter(function (tx) { return txwAccountKey(tx) === txwAcctFilter; });
  }
  if (!txwUnmatchedFilter.active) return list;
  var ids = txwUnmatchedFilter.ids;
  // ⑨が過去の仕訳から割り出した明細IDで絞る。
  // ⚠ 銀行明細の摘要に勘定科目名は入っていない（「フリコミ ○○フドウサン」など）ので、
  //   科目名の文字列一致で絞ると常に0件になる。IDで絞るのが唯一まともに当たる方法。
  if (ids && ids.length) {
    return list.filter(function (tx) { return ids.indexOf(tx && tx.transaction_id) >= 0; });
  }
  // 候補が1件も割り出せなかった科目。**空振りを黙って隠さず、そのまま0件として見せる**
  return [];
}

/* 口座・カードごとの絞り込み。件数つきで並べる（MFの画面と同じ考え方）。
 * ここで数えるのは「口座の絞り込みを外した状態」の件数にする。
 * 自分で自分を絞った件数を出すと、他の口座が常に0件に見えてしまう。 */
function txwRenderAcctFilterBar() {
  var bar = document.getElementById('txwAcctFilterBar');
  if (!bar) return;
  clearEl(bar);
  var all = txwUnmatchedAllItems || [];
  // ⑨からの科目の絞り込みが効いているときは、その範囲の中で数える
  var base = all;
  if (txwUnmatchedFilter.active) {
    var ids = txwUnmatchedFilter.ids || [];
    base = ids.length ? all.filter(function (tx) { return ids.indexOf(tx.transaction_id) >= 0; }) : [];
  }
  var counts = {};
  base.forEach(function (tx) {
    var k = txwAccountKey(tx);
    counts[k] = (counts[k] || 0) + 1;
  });
  var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
  if (keys.length <= 1 && !txwAcctFilter) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';

  var row = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;' });
  row.appendChild(el('span', { text: '口座・カードで絞る:', style: 'font-weight:800;margin-right:4px;' }));
  function chip(label, key, count) {
    var b = el('button', {
      type: 'button',
      class: 'btn-mini' + (txwAcctFilter === key ? ' btn-mini-on' : ''),
      text: label + '（' + count + '）'
    });
    b.addEventListener('click', function () {
      txwAcctFilter = (txwAcctFilter === key) ? '' : key;
      txwRenderUnmatched(txwUnmatchedAllItems, txwUnmatchedWritableCache);
    });
    row.appendChild(b);
  }
  chip('すべて', '', base.length);
  keys.forEach(function (k) { chip(k, k, counts[k]); });
  bar.appendChild(row);
}

/* 口座が10前後あると、初回は開閉のクリックが最大10回必要になる（中堅レビューの指摘）。
 * まとめて開く・閉じるを用意する。既定は閉じているので「全部開く」の方をよく使う想定。 */
function txwRenderAcctBulkToggle(items) {
  var bar = document.getElementById('txwAcctFilterBar');
  if (!bar) return;
  clearEl(bar);
  var groups = txwGroupByAccount(txwUnmatchedFilteredItems(items || []));
  if (groups.length <= 1) { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  var row = el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;' });
  row.appendChild(el('span', {
    class: 'note', style: 'margin:0;',
    text: '口座・カード ' + groups.length + '件にまとめています。'
  }));
  function bulk(label, open) {
    var b = el('button', { type: 'button', class: 'btn-mini', text: label });
    b.addEventListener('click', function () {
      txwSaveOpenAccts(open ? groups.map(function (g) { return g.key; }) : []);
      txwRenderUnmatched(txwUnmatchedAllItems, txwUnmatchedWritableCache);
    });
    row.appendChild(b);
  }
  bulk('全部開く', true);
  bulk('全部閉じる', false);
  bar.appendChild(row);
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

/* 口座・カードごとにまとめる（MFの画面と同じ並べ方）。
 * ひと続きの一覧だと「何の明細か分からない」という指摘を受けた対応（2026-08-04）。
 * 件数の多い口座から並べる。開閉の状態は口座ごとに端末へ覚える。 */
// ⚠ 既定は「閉じた状態」。口座が10前後あり、全部開くと最初から
//    とても長い画面になるため（MFの画面も口座ごとに畳まれている）。
//    そこで「開いた口座」を覚える方式にする（記録が無い＝閉じている）。
var TXW_ACCT_OPEN_KEY = 'ribre_txw_acct_open';
function txwLoadOpenAccts() {
  try {
    var raw = localStorage.getItem(TXW_ACCT_OPEN_KEY);
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function txwSaveOpenAccts(list) {
  try { localStorage.setItem(TXW_ACCT_OPEN_KEY, JSON.stringify(list || [])); } catch (e) {}
}
function txwIsAcctClosed(key) { return txwLoadOpenAccts().indexOf(key) < 0; }
function txwToggleAcct(key) {
  var list = txwLoadOpenAccts();
  var i = list.indexOf(key);
  if (i >= 0) list.splice(i, 1); else list.push(key);
  txwSaveOpenAccts(list);
}

// 明細を口座・カードごとに分ける。[{key, label, items}] を件数の多い順で返す
function txwGroupByAccount(items) {
  var map = {};
  (items || []).forEach(function (tx) {
    var k = txwAccountKey(tx);
    if (!map[k]) map[k] = { key: k, label: txwAccountText(tx) || k, items: [] };
    map[k].items.push(tx);
  });
  return Object.keys(map).map(function (k) { return map[k]; })
    .sort(function (a, b) { return b.items.length - a.items.length; });
}

function txwRenderUnmatched(items, writable) {
  // 次回の絞り込み解除・再絞り込みで再取得なしに再描画できるよう、全件をここへ保持する。
  txwUnmatchedAllItems = items || [];
  txwUnmatchedWritableCache = writable;

  var container = document.getElementById('txwUnmatchedList');
  clearEl(container);
  txwRenderUnmatchedFilterBar();
  txwRenderAcctBulkToggle(items);
  var displayItems = txwUnmatchedFilteredItems(items);
  // 絞り込み中は「全体で何件あるか」も必ず添える。絞った件数だけを出すと
  // 未仕訳が減ったように見えてしまう。
  var filtering = txwUnmatchedFilter.active || !!txwAcctFilter;
  document.getElementById('txwUnmatchedCount').textContent = '未仕訳 ' + displayItems.length + '件'
    + (filtering ? '（絞り込み中／全' + (items || []).length + '件）' : '');
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
    var emptyMsg = (txwUnmatchedFilter.active || txwAcctFilter)
      ? 'この絞り込み条件に一致する明細はありません。' : '未仕訳の明細はありません。';
    container.appendChild(el('div', { class: 'evidence-empty', text: emptyMsg }));
    if (listTbody) {
      var trEmpty = document.createElement('tr');
      // 列数は表の見出しと合わせる（口座・カードの列を足したので10）
      trEmpty.appendChild(el('td', { colspan: '8', class: 'evidence-empty', text: emptyMsg }));
      listTbody.appendChild(trEmpty);
    }
    txwListUpdateCounter();
    return;
  }

  /* 口座・カードごとにまとめて描く（MFの画面と同じ並べ方）。
   * ⚠ 開閉は**表示の切り替えだけ**にして、行は必ず全部作る。
   *   畳むたびに作り直すと、チェック済みの行の選択が消えてしまうため。 */
  var groups = txwGroupByAccount(displayItems);
  groups.forEach(function (g) {
    var closed = txwIsAcctClosed(g.key);
    var cardRows = [];
    var listRows = [];

    function applyOpen(open) {
      cardRows.forEach(function (n) { n.style.display = open ? '' : 'none'; });
      listRows.forEach(function (n) { n.style.display = open ? '' : 'none'; });
    }

    // --- カード表示の見出し ---
    var gh = el('div', { class: 'txw-acct-head' });
    gh.appendChild(el('span', { class: 'txw-acct-name', text: g.label }));
    gh.appendChild(el('span', { class: 'chip chip-yellow', text: '未仕訳 ' + g.items.length + '件' }));
    var ghToggle = el('span', { class: 'txw-acct-toggle', text: closed ? '開く ▸' : '閉じる ▾' });
    gh.appendChild(ghToggle);
    container.appendChild(gh);

    // --- 一覧表示の見出し（表の中に1行として入れる） ---
    var ghTd = null, ghTrToggle = null;
    if (listTbody) {
      var ghTr = document.createElement('tr');
      ghTr.className = 'txw-lt-group';
      ghTd = el('td', { colspan: '8' });
      ghTd.appendChild(el('span', { class: 'txw-acct-name', text: g.label }));
      ghTd.appendChild(el('span', { class: 'chip chip-yellow', text: '未仕訳 ' + g.items.length + '件', style: 'margin-left:8px;' }));
      ghTrToggle = el('span', { class: 'txw-acct-toggle', text: closed ? '開く ▸' : '閉じる ▾' });
      ghTd.appendChild(ghTrToggle);
      ghTr.appendChild(ghTd);
      listTbody.appendChild(ghTr);
      ghTr.addEventListener('click', function () { toggle(); });
    }
    gh.addEventListener('click', function () { toggle(); });

    function toggle() {
      txwToggleAcct(g.key);
      var open = !txwIsAcctClosed(g.key);
      applyOpen(open);
      var label = open ? '閉じる ▾' : '開く ▸';
      ghToggle.textContent = label;
      if (ghTrToggle) ghTrToggle.textContent = label;
    }

    g.items.forEach(function (tx) {
    var card = el('div', { class: 'jcard' });

    var head = el('div', { class: 'jcard-head' });
    var titleWrap = el('div');
    titleWrap.appendChild(el('span', { class: 'title', text: (tx.date || '(日付不明)') + '　' + (tx.content || '(内容なし)') }));
    var acctText = txwAccountText(tx);
    var sub = el('div', {
      class: 'sub',
      text: txwSideLabel(tx) + ' ' + yen(Math.abs(Number(tx.value) || 0))
        + (acctText ? '　/　' + acctText : '')
    });
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
      evBox.appendChild(txwEvidenceLoadFailed
        ? el('div', { class: 'note danger', style: 'margin:0;',
            text: '証憑の一覧を取得できませんでした（' + txwEvidenceLoadFailed + '）。'
              + '候補が無いのではなく、確認できていません。時間をおいて画面を読み込み直してください。' })
        : el('div', { class: 'evidence-empty', text: '候補となる証憑は見つかりませんでした。' }));
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

    /* 共有ファイルからも選べるようにする（税理士がご自身の判断で・2026-08-05）。
     * 上の「関連しそうな証憑」は日付と取引先で機械が見つけた候補。
     * こちらは機械が候補にしないもの（請求書・明細など）を人が選ぶための欄。 */
    var sharedCheckboxes = [];
    if (writable) {
      var atts = txwAttachableSharedFiles();
      if (atts.length) {
        var shBox = el('details', { class: 'txw-shared-pick' });
        shBox.appendChild(el('summary', { text: '共有ファイルから選ぶ（' + atts.length + '件）' }));
        var inner = el('div', { class: 'txw-shared-pick-body' });
        inner.appendChild(el('div', {
          class: 'note',
          text: 'ご自身の判断で証憑にできます。同じファイルは二度送られません。'
            + 'MFへ送った証憑は取り消せませんのでご注意ください。',
        }));
        atts.forEach(function (f) {
          var lab = document.createElement('label');
          lab.className = 'evidence-check-row';
          var cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.checked = false;   // 初期は必ずオフ（自動では選ばない）
          lab.appendChild(cb);
          lab.appendChild(document.createTextNode((f.month || '') + '　' + (f.name || f.key)));
          inner.appendChild(lab);
          sharedCheckboxes.push({ checkbox: cb, key: f.key, name: f.name });
        });
        shBox.appendChild(inner);
        evBox.appendChild(shBox);
      }
    }
    body.appendChild(evBox);

    if (writable) {
      txwBuildJournalForm(card, body, tx, evidenceCheckboxes, sharedCheckboxes);
    }

    card.appendChild(body);
    container.appendChild(card);

    // 一覧表示（新設）: 同じ明細のカードと行を両方作る。表示の切り替えはCSSのみ。
    if (listTbody) {
      var ltr = txwBuildListRow(tx, writable);
      listTbody.appendChild(ltr);
      listRows.push(ltr);
    }
    cardRows.push(card);
    });
    applyOpen(!closed);
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

function txwBuildJournalForm(card, body, tx, evidenceCheckboxes, sharedCheckboxes) {
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
    sharedCheckboxes: sharedCheckboxes || [],
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
/* どの銀行・カードの明細かを1行で表す。
 * MFの画面は連携サービスごとに未仕訳を並べるので、この画面でも必ず出す
 * （出さないと「何の仕訳か分からない」。利用者の指摘 2026-08-04）。 */
function txwAccountText(tx) {
  var a = tx && tx.account_label;
  if (!a) return '';
  if (a.account && a.service) return a.service + ' / ' + a.account;
  return a.service || a.account || '';
}
// 絞り込みの単位はサービス名（銀行・カード）にする。口座まで分けると細かすぎる
function txwAccountKey(tx) {
  var a = tx && tx.account_label;
  return (a && (a.service || a.account)) || '(不明)';
}

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
      colspan: '4', class: 'evidence-empty',
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

  // ⚠ 口座・カードは列に出さない。口座ごとにまとめて表示しているので
  //    行ごとに繰り返すと幅を食うだけになる（見出しに出ている）。

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
    evLabel.style.color = 'var(--hm-green-dark)';
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
      class: 'evi-auto', style: 'color:var(--hm-amber);font-weight:800;',
      text: '証憑候補があります。カード表示でご確認のうえ選んでください。'
    }));
  }
  tr.appendChild(tdContent);

  // 3: 金額
  tr.appendChild(el('td', { class: 'num', text: yen(Math.abs(Number(tx.value) || 0)) }));

  if (!txwMaster.loaded) {
    tr.appendChild(el('td', {
      colspan: '4', class: 'note danger', style: 'margin:0;',
      text: '選択肢（勘定科目・税区分）を読み込めなかったため、この明細は登録できません。画面を再読み込みしてください。'
    }));
    return tr;
  }

  // 4: 勘定科目（カード表示と同じdatalist方式）
  var tdAccount = document.createElement('td');
  var accountInput = txwBuildSearchInput('txwAccountsDatalist', '必須：候補から選択');
  accountInput.addEventListener('input', function () { txwSyncInputTitle(accountInput); });
  tdAccount.appendChild(accountInput);
  tr.appendChild(tdAccount);
  refs.accountInput = accountInput;

  // 5: 税区分とインボイス区分（MFの画面と同じく1列に2段）
  var tdTax = document.createElement('td');
  var taxBox = el('div', { class: 'txw-lt-taxbox' });
  var taxInput = txwBuildSearchInput('txwTaxesDatalist', '税区分（任意）');
  taxInput.addEventListener('input', function () { txwSyncInputTitle(taxInput); });
  taxBox.appendChild(taxInput);
  refs.taxInput = taxInput;

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
  taxBox.appendChild(invoiceSelect);
  tdTax.appendChild(taxBox);
  tr.appendChild(tdTax);
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
// 入力欄は幅の都合で切れることがある。マウスを乗せれば全文が読めるようにしておく
/* 登録した内容が「提案そのまま」か「人が直した」か「提案なしで手入力」かを返す。
 * MF側には操作者すら残らないため、後から機械の判断と人の判断を切り分けられるのは
 * この記録だけになる（所長レビューの指摘・2026-08-04）。 */
function txwInputSource(refs) {
  var snap = refs && refs.suggestedSnapshot;
  if (!snap) return 'manual';   // 提案が出なかった＝全部人が入れた
  var same = snap.account === refs.accountInput.value
    && snap.tax === refs.taxInput.value
    && snap.invoice === refs.invoiceSelect.value;
  return same ? 'suggested' : 'edited';
}

function txwSyncInputTitle(input) {
  if (!input) return;
  input.title = input.value || '';
}

function txwApplySuggestionToRow(refs, sugg) {
  if (!sugg) { refs.reasonText.textContent = '該当する提案はありません'; return; }
  var accLabel = txwIdToLabel(txwAccountLookup, sugg.account_id);
  var taxLabel = txwIdToLabel(txwTaxLookup, sugg.tax_id);
  if (accLabel) refs.accountInput.value = accLabel;
  if (taxLabel) refs.taxInput.value = taxLabel;
  // 「提案どおり」か「人が直した」かを後で判定するため、提案した時点の値を覚える
  refs.suggestedSnapshot = {
    account: refs.accountInput.value,
    tax: refs.taxInput.value,
    invoice: sugg.invoice_kind || '',
  };
  txwSyncInputTitle(refs.accountInput);
  txwSyncInputTitle(refs.taxInput);
  var validInvoiceKinds = ['INVOICE_KIND_NOT_TARGET', 'INVOICE_KIND_QUALIFIED', 'INVOICE_KIND_UNQUALIFIED_80'];
  if (sugg.invoice_kind && validInvoiceKinds.indexOf(sugg.invoice_kind) >= 0) {
    refs.invoiceSelect.value = sugg.invoice_kind;
  }

  var count = Number(sugg.count) || 0;
  var total = Number(sugg.total) || 0;
  var ratio = total > 0 ? count / total : 0;
  var pct = total > 0 ? Math.round(ratio * 100) : 0;
  var lastDateText = sugg.last_date ? txwFormatDateSlash(sugg.last_date) : '不明';
  var kindText = (sugg.match_kind === 'exact') ? '摘要が同じ' : '摘要が似ている';
  var baseText = (total > count)
    ? (kindText + '過去' + total + '件中' + count + '件（' + pct + '%・残り' + (total - count) + '件は別内容）')
    : (kindText + '過去' + count + '件（一致していない仕訳はありません）');
  refs.reasonText.textContent = baseText + '・最終 ' + lastDateText;
  refs.reasonText.className = 'txw-lt-reason';

  // ⚠ 一覧には補助科目の欄が無い（カード表示にはある）。提案に補助科目が含まれていても
  //    一覧から登録すると付かないため、**黙って落とさずその場で伝える**（§12の考え方）。
  //    同じ明細をカードから登録した場合と結果が変わってしまうため。
  if (refs.subHintEl) { refs.subHintEl.remove(); refs.subHintEl = null; }
  if (sugg.sub_account_id) {
    var subName = sugg.sub_account_name || '補助科目';
    var hint = el('div', {
      style: 'margin-top:2px;color:var(--hm-amber);font-weight:700;',
      text: '※ 補助科目「' + subName + '」の提案がありますが、一覧には補助科目の欄がありません。'
        + '付けたい場合はカード表示に切り替えて登録してください。'
    });
    refs.tdReason.appendChild(hint);
    refs.subHintEl = hint;
  }

  if (refs.badgeEl) { refs.badgeEl.remove(); refs.badgeEl = null; }
  /* 要確認にする条件は2つ。
   * (a) 候補が割れている（6〜8割）
   * (b) 根拠がごく少ない（過去1〜2件）
   *   ⚠ (b)を入れていなかったため、「過去1件だけ」の提案が「過去44件」と
   *     まったく同じ見た目で並んでいた。割合は1/1でも100%になるので
   *     (a)の条件には引っかからない。新人・所長の両方から指摘（2026-08-04）。
   *     とくに『税金→預り金』のように、摘要が同じでも中身が毎回変わる科目が危ない。 */
  var splitMatch = total > 0 && ratio >= 0.6 && ratio < 0.8;
  var thinEvidence = count > 0 && count < TXW_THIN_EVIDENCE;
  var lowMatch = splitMatch || thinEvidence;
  refs.tr.classList.toggle('txw-lt-lowmatch', lowMatch);
  if (lowMatch) {
    var badge = el('span', { class: 'chip chip-yellow', text: '要確認', style: 'margin-left:6px;' });
    refs.tdReason.insertBefore(badge, refs.clearBtn);
    refs.badgeEl = badge;
  }
  if (refs.thinEl) { refs.thinEl.remove(); refs.thinEl = null; }
  /* 候補が割れているときにも、なぜ黄色なのかを言葉で書く。
   * 札だけだと根拠テキストを読み込まないと理由が分からず、注意喚起が一段弱い
   * （新人レビューの指摘・2026-08-04）。 */
  if (splitMatch && !thinEvidence) {
    var split = el('div', {
      style: 'margin-top:2px;color:var(--hm-amber);font-weight:800;',
      text: '過去の仕訳が' + total + '件中' + count + '件でこの内容、残り' + (total - count)
        + '件は別の内容でした。今回がどちらかは決められないので、'
        + '金額と内容をご自身で確かめてから登録してください。'
    });
    refs.tdReason.appendChild(split);
    refs.thinEl = split;   // 次の描画で消す対象は同じ扱いでよい
  }
  if (thinEvidence) {
    var thin = el('div', {
      style: 'margin-top:2px;color:var(--hm-amber);font-weight:800;',
      text: '根拠は過去' + count + '件だけです。同じ摘要でも中身が毎回変わる取引（税金・預り金・仮払金など）は、'
        + '金額と内容をご自身で確かめてから登録してください。'
    });
    refs.tdReason.appendChild(thin);
    refs.thinEl = thin;
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

  var payload = {
    action: 'journalize', transaction_id: tx.transaction_id, date: tx.date, account_id: accountId,
    input_source: txwInputSource(refs),
  };
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
  // ⚠ 承認制のときは journalize が{ok:true, requested:true}を返す(MFへはまだ何も送っていない)。
  //   「登録しました」と混同しない（txwCollapseCardSuccessと同じ理由）。
  if (data && data.requested) {
    wrap.appendChild(el('div', {
      class: 'note warn', style: 'margin:0;',
      text: '承認を依頼しました。管理者が承認するとMFへ登録されます。まだMFには送られていません。'
    }));
    var td0 = document.createElement('td');
    td0.setAttribute('colspan', '8');
    td0.appendChild(wrap);
    refs.tr.appendChild(td0);
    var cardRefs0 = txwCardRefsByTx[refs.txId];
    if (cardRefs0 && cardRefs0.card && !cardRefs0.card.classList.contains('jcard-collapsed')) {
      txwCollapseCardSuccess(cardRefs0.card, data, refs.txId);
    } else {
      txwRefreshUnmatchedCount();
    }
    txwListUpdateCounter();
    return;
  }
  var msg = '登録しました（仕訳ID ' + (data && data.journal_id != null ? data.journal_id : '不明') + '）';
  var attached = data && Array.isArray(data.attached) ? data.attached : [];
  if (attached.length) msg += '　証憑' + attached.length + '件を添付しました。';
  wrap.appendChild(el('div', { class: 'note ok', style: 'margin:0;', text: msg }));
  var attachFailed = data && Array.isArray(data.attach_failed) ? data.attach_failed : [];
  if (attachFailed.length) {
    wrap.appendChild(el('div', {
      class: 'note danger', style: 'margin:4px 0 0;',
      text: txwAttachFailText(attachFailed)
    }));
  }
  if (data && data.duplicate_warning) {
    wrap.appendChild(el('div', {
      class: 'note warn', style: 'margin:4px 0 0;',
      text: '⚠ この明細から仕訳が' + data.duplicate_warning + '件見つかりました。MFの画面でご確認ください。'
    }));
  }
  var td = document.createElement('td');
  td.setAttribute('colspan', '8');
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
  td.setAttribute('colspan', '8');
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
  var requested = !!(data && data.requested);
  var msg = requested
    ? '承認を依頼しました。管理者が承認するとMFへ登録されます。まだMFには送られていません。'
    : '登録しました（仕訳ID ' + (data && data.journal_id != null ? data.journal_id : '不明') + '）';
  var td = document.createElement('td');
  td.setAttribute('colspan', '8');
  td.appendChild(el('div', { class: 'note ' + (requested ? 'warn' : 'ok'), style: 'margin:0;', text: msg }));
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
      if (r.data && r.data.requested) {
        txwListUpdateExecRow(rightEl, '📨 承認を依頼しました（まだMFには送っていません）', 'skip');
      } else {
        txwListUpdateExecRow(rightEl, '✓ 登録済み（仕訳ID ' + (r.data.journal_id != null ? r.data.journal_id : '不明') + '）', 'ok');
      }
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
    txwFillNoSuggestionText(payloadItems, {}, '提案を取得できませんでした（通信）');
    return; // 通信失敗。提案が入らないだけで、明細自体は普通に操作できる
  }
  if (gen !== txwRenderGen) return; // その間に月が変わる等で描画し直されていたら捨てる

  var data = result.data || {};
  // ok:false（scope_missingなど）や note:'journals_fetch_failed' のときも suggestions は
  // 空(または存在しない)ものとして扱い、画面は通常どおり操作できる状態のままにする。
  var suggestions = (data.ok && data.suggestions && typeof data.suggestions === 'object') ? data.suggestions : {};
  /* ⚠「提案が0件」と「提案を取れなかった」は意味がまったく違う。
   *   同じ文言にすると、不具合が『該当なし』に化けて見えなくなる。
   *   実際にこれで、サーバーが500を返しているのに気づけなかった（2026-08-04）。 */
  var failNote = '';
  if (!data.ok) {
    failNote = '提案を取得できませんでした（' + (data.error || ('HTTP ' + result.status)) + '）';
  } else if (data.note === 'journals_fetch_failed') {
    failNote = '提案を取得できませんでした（過去の仕訳を読めませんでした）';
  }
  Object.keys(suggestions).forEach(function (txId) {
    var cardRefs = txwCardRefsByTx[txId];
    if (cardRefs) txwApplySuggestion(cardRefs, suggestions[txId]);
    var rowRefs = txwListRowRefsByTx[txId];
    if (rowRefs) txwApplySuggestionToRow(rowRefs, suggestions[txId]);
  });
  txwFillNoSuggestionText(payloadItems, suggestions, failNote, data.reasons || {});
}

/* 提案が出なかった理由を日本語にする。
 * 「該当する提案はありません」だけだと、なぜ出ないのかが分からず
 * 税理士が自分で過去を調べ直すことになる（資産税の税理士の指摘・2026-08-04）。 */
function txwSuggestReasonText(d) {
  if (!d) return '該当する提案はありません';
  if (d.kind === 'split') {
    var b = (d.detail && d.detail.breakdown) || [];
    var head = (d.detail && d.detail.similar) ? '似た摘要の過去の仕訳が' : '同じ摘要の過去の仕訳が';
    var list = b.map(function (x) {
      return x.account_name + (x.tax_name ? '／' + x.tax_name : '') + ' ' + x.count + '件';
    }).join('・');
    return head + '科目で割れているため、自動では入れていません（' + list + '）。'
      + 'どちらかはご自身でご判断ください。';
  }
  if (d.kind === 'no_usable_side') {
    return '同じ摘要の過去の仕訳はありますが、' + ((d.detail && d.detail.side) || '')
      + 'が1本に定まらない仕訳（複合仕訳など）ばかりのため、参考にできませんでした。';
  }
  if (d.kind === 'thin') {
    return '似た摘要が' + ((d.detail && d.detail.count) || 0) + '件しかなく、根拠として弱いので入れていません。';
  }
  if (d.kind === 'no_history') {
    return '同じ摘要・似た摘要の過去の仕訳が見つかりませんでした（初めての取引先かもしれません）。';
  }
  return '該当する提案はありません';
}

// 一覧表示の「提案の根拠」欄: 提案が無い(=suggestionsにキーが無い)行を
// 「提案を確認中…」のまま止めず、「該当する提案はありません」で確定させる。
function txwFillNoSuggestionText(payloadItems, suggestions, failNote, reasons) {
  (payloadItems || []).forEach(function (it) {
    if (suggestions[it.transaction_id]) return;
    var text = failNote || txwSuggestReasonText(reasons && reasons[it.transaction_id]);
    var rowRefs = txwListRowRefsByTx[it.transaction_id];
    if (rowRefs && rowRefs.reasonText.textContent === '提案を確認中…') {
      rowRefs.reasonText.textContent = text;
      if (failNote) rowRefs.reasonText.style.color = 'var(--hm-danger)';
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
  refs.suggestedSnapshot = {
    account: refs.accountInput.value,
    tax: refs.taxInput.value,
    invoice: sugg.invoice_kind || '',
  };
  var validInvoiceKinds = ['INVOICE_KIND_NOT_TARGET', 'INVOICE_KIND_QUALIFIED', 'INVOICE_KIND_UNQUALIFIED_80'];
  if (sugg.invoice_kind && validInvoiceKinds.indexOf(sugg.invoice_kind) >= 0) {
    refs.invoiceSelect.value = sugg.invoice_kind;
  }
  refs.updateSubmitEnabled();

  var count = Number(sugg.count) || 0;
  var total = Number(sugg.total) || 0;
  var countText = (total > count) ? (total + '件中' + count + '件') : (count + '件');
  var lastDateText = sugg.last_date ? txwFormatDateSlash(sugg.last_date) : '不明';
  // 摘要が完全に同じ過去の仕訳から入れたのか、語が似ているだけなのかで確からしさが違う。
  // 同じ表現にすると、弱い根拠まで同じ強さに見えてしまう。
  var kindText = (sugg.match_kind === 'exact')
    ? '摘要がまったく同じ過去の仕訳'
    : '摘要の一部が似ている過去の仕訳';
  refs.suggestText.textContent =
    kindText + 'から入れています。確認してください。（過去' + countText + '・最終 ' + lastDateText + '）'
    + (count > 0 && count < TXW_THIN_EVIDENCE
      ? '　⚠ 根拠は過去' + count + '件だけです。金額と内容をご自身で確かめてください。' : '');
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
// ⚠ 承認制（approval_policy:'required'）のとき、担当者の登録は journalize が
//   { ok:true, requested:true } を返す（MFへはまだ何も送っていない）。
//   「登録しました」とここを混同すると、送っていないのに送ったと誤解させてしまう。必ず分ける。
function txwCollapseCardSuccess(card, data, transactionId) {
  clearEl(card);
  card.classList.add('jcard-collapsed');
  if (data && data.requested) {
    card.appendChild(el('div', {
      class: 'note warn',
      text: '承認を依頼しました。管理者が承認するとMFへ登録されます。まだMFには送られていません。'
    }));
    txwRefreshUnmatchedCount();
    txwFocusNextCard(card);
    if (transactionId) txwSyncListRowFromCard(transactionId, data);
    return;
  }
  var attached = Array.isArray(data.attached) ? data.attached : [];
  var mainMsg = '登録しました（仕訳ID ' + (data.journal_id != null ? data.journal_id : '不明') + '）';
  if (attached.length) mainMsg += '　証憑' + attached.length + '件を添付しました。';
  card.appendChild(el('div', { class: 'note ok', text: mainMsg }));

  var attachFailed = Array.isArray(data.attach_failed) ? data.attach_failed : [];
  if (attachFailed.length) {
    card.appendChild(el('div', {
      class: 'note danger',
      text: txwAttachFailText(attachFailed)
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
  if ((txwUnmatchedFilter && txwUnmatchedFilter.active) || txwAcctFilter) {
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

  var payload = {
    action: 'journalize', transaction_id: tx.transaction_id, date: tx.date, account_id: accountId,
    input_source: txwInputSource(refs),
  };
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
  var sharedKeys = (refs.sharedCheckboxes || [])
    .filter(function (c) { return c.checkbox.checked; })
    .map(function (c) { return { key: c.key, name: c.name }; });
  if (sharedKeys.length) payload.shared_file_keys = sharedKeys;

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
/* ② 仕訳待ちの証憑。
 * ⚠ 以前は件数しか出しておらず、税理士は中身も見られず手も出せなかった。
 *   証憑インボックスは社内メンバー専用なので、詰まったら御社頼みだった
 *   （2026-08-05の指摘）。中身を見せて、③と同じ「仕訳を選んで添付」を出す。 */
function txwRenderAwaiting(count, truncated, shown, rows) {
  var body = document.getElementById('txwAwaitingBody');
  clearEl(body);
  body.appendChild(el('span', { class: 'chip ' + (count > 0 ? 'chip-yellow' : 'chip-green'), text: '仕訳待ちの証憑 ' + count + '件' }));
  body.appendChild(el('div', {
    class: 'note',
    text: '仕訳が無いために送信を保留している証憑です。①未仕訳の明細で該当する明細の仕訳を作れば自動で解消します。'
      + '自動で見つからないものは、下の「仕訳を選んで添付」からご自身で付けられます。'
  }));
  /* ⚠ 件数は本当の数だが、①に出す候補は上限で切れていることがある。
   *   黙って隠すと「候補が無い＝証憑が無い」と読み違える（制約20）。 */
  if (truncated) {
    body.appendChild(el('div', {
      class: 'note danger',
      text: '証憑が多いため、①の候補には新しい ' + shown + '件だけを使っています。'
        + '古い分は候補に出ません。まず溜まっている分を片付けてください。'
    }));
  }

  var list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  var table = document.createElement('table');
  var thead = el('thead');
  var trh = el('tr');
  ['日付', '取引先', '金額', 'ファイル', '状態', '操作'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  list.forEach(function (ev) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: ev.ocr_date || '日付不明' }));
    tr.appendChild(el('td', { text: ev.ocr_vendor || '取引先不明' }));
    tr.appendChild(el('td', { class: 'num', text: txwEvidenceAmountText(ev) }));
    var tdF = el('td');
    if (ev.url && /^https:\/\//.test(ev.url)) {
      tdF.appendChild(el('a', { href: ev.url, target: '_blank', rel: 'noopener noreferrer', text: ev.file_name || '(ファイル名なし)' }));
    } else {
      tdF.textContent = ev.file_name || '(ファイル名なし)';
      tdF.appendChild(el('div', { class: 'file-attach-note', text: '中身を表示できませんでした' }));
    }
    tr.appendChild(tdF);
    tr.appendChild(el('td', { text: txwEvidenceStatusText(ev.status) }));

    var tdA = el('td');
    var btn = el('button', { type: 'button', class: 'btn-mini', text: '仕訳を選んで添付' });
    var panel = el('div', { style: 'display:none;margin-top:8px;' });
    btn.addEventListener('click', function () {
      var open = panel.style.display !== 'none';
      panel.style.display = open ? 'none' : 'block';
      btn.textContent = open ? '仕訳を選んで添付' : '閉じる';
      if (!open && !panel.dataset.built) {
        // ③と同じ枠を使う。既定の月は証憑の日付から
        txwBuildAttachPanel(panel, {
          evidence_id: ev.evidence_id,
          name: ev.file_name,
          month: (ev.ocr_date || '').slice(0, 7),
        });
        panel.dataset.built = '1';
      }
    });
    tdA.appendChild(btn);
    tdA.appendChild(panel);
    tr.appendChild(tdA);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  var wrap = el('div', { class: 'tblwrap', style: 'margin-top:12px;' });
  wrap.appendChild(table);
  body.appendChild(wrap);
  body.appendChild(el('div', {
    class: 'note',
    text: '※ ここから証憑を消すことはできません。不要な証憑は御社にご連絡ください。'
      + 'MFへ送った証憑は取り消せないため、消す操作は社内の画面だけに置いています。'
  }));
}

function txwEvidenceStatusText(st) {
  if (st === 'awaiting_match') return '仕訳待ち';
  if (st === 'pending') return '送信前';
  if (st === 'box_saved') return 'MF保存済み';
  return st || '不明';
}

/* 添付に失敗した理由を日本語にする。
 * ⚠「N件失敗しました」だけだと、重複なのかMFが落ちたのか分からず手の打ちようがない
 *   （制約20と同じ穴。2026-08-05のレビューで発見）。必ず理由まで出す。 */
function txwAttachFailText(list) {
  var reasons = (list || []).map(function (f) {
    var name = f.shared_key ? String(f.shared_key).split('/').pop() : '';
    var why = TXW_ATTACH_ERRORS[f.error] || (f.error || '理由不明');
    return name ? (name + '：' + why) : why;
  });
  return '仕訳は登録できましたが、証憑' + (list || []).length + '件の添付に失敗しました。'
    + (reasons.length ? '（' + reasons.join(' ／ ') + '）' : '');
}

/* ---------------- ③ 共有ファイル ---------------- */
function txwFormatSize(n) {
  var v = Number(n) || 0;
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + 'MB';
  if (v >= 1024) return Math.round(v / 1024) + 'KB';
  return v + 'B';
}

function txwRenderFiles(files, loadFailed) {
  var body = document.getElementById('txwFilesBody');
  clearEl(body);
  if (!files.length) {
    body.appendChild(loadFailed
      ? el('div', { class: 'note danger', style: 'margin:0;',
          text: '共有ファイルの一覧を取得できませんでした（' + loadFailed + '）。'
            + 'ファイルが無いのではなく、確認できていません。時間をおいて画面を読み込み直してください。' })
      : el('div', { class: 'evidence-empty', text: '共有ファイルはありません。' }));
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
    ['ファイル名', 'サイズ', '種別', '証憑にする'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
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
      tdKind.appendChild(el('span', { class: 'chip ' + (f.attachable ? 'chip-blue' : 'chip-gray'), text: f.attachable ? 'PDF・画像' : 'Excelなど' }));
      tr.appendChild(tdKind);

      /* 証憑として添付する。MFへ送ると取り消せないので、
       * 押してすぐ送らず「仕訳を選ぶ」段を必ず挟む。 */
      var tdAct = el('td');
      if (f.attachable) {
        var btn = el('button', { type: 'button', class: 'btn-mini', text: '仕訳を選んで添付' });
        var panel = el('div', { style: 'display:none;margin-top:8px;' });
        btn.addEventListener('click', function () {
          var open = panel.style.display !== 'none';
          panel.style.display = open ? 'none' : 'block';
          btn.textContent = open ? '仕訳を選んで添付' : '閉じる';
          if (!open && !panel.dataset.built) { txwBuildAttachPanel(panel, f); panel.dataset.built = '1'; }
        });
        tdAct.appendChild(btn);
        tdAct.appendChild(panel);
      } else {
        tdAct.appendChild(el('span', { class: 'txw-muted', text: '—' }));
      }
      tr.appendChild(tdAct);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  });
}

/* 共有ファイルを証憑として添付するための、仕訳を選ぶ枠。
 * ⚠ MFの証憑は送ったら取り消せない。だから
 *   ・押してすぐ送らない（探す→選ぶ→確認、の3段）
 *   ・すでに証憑が付いている仕訳は**選べなくする**（サーバーでも弾く）
 *   ・同じ中身のファイルはサーバーが弾く（画面では理由を出すだけ） */
function txwBuildAttachPanel(panel, file) {
  clearEl(panel);
  panel.appendChild(el('div', {
    class: 'note warn',
    text: 'MFへ送った証憑は取り消せません。添付先の仕訳をよくお確かめください。',
  }));

  var row = el('div', { class: 'jform-row' });
  function field(labelText, input) {
    var w = el('div', { class: 'jform-field' });
    w.appendChild(el('label', { text: labelText }));
    w.appendChild(input);
    return w;
  }
  // 既定は共有ファイルの月。月をまたぐ検索はMFが受け付けない（制約18）ので月単位にする
  var monthVal = (file.month && /^\d{4}-\d{2}$/.test(file.month)) ? file.month : txwCurrentMonth();
  var monthInput = el('input', { type: 'month', value: monthVal });
  var kwInput = el('input', { type: 'text', placeholder: '摘要・勘定科目で絞る（任意）' });
  var searchBtn = el('button', { type: 'button', class: 'btn btn-primary', text: '仕訳をさがす' });
  row.appendChild(field('対象月', monthInput));
  row.appendChild(field('絞り込み', kwInput));
  panel.appendChild(row);
  panel.appendChild(searchBtn);

  var result = el('div', { style: 'margin-top:10px;' });
  panel.appendChild(result);

  searchBtn.addEventListener('click', async function () {
    var m = String(monthInput.value || '');
    if (!/^\d{4}-\d{2}$/.test(m)) { alert('対象月を選んでください。'); return; }
    searchBtn.disabled = true;
    clearEl(result);
    result.appendChild(el('div', { class: 'txw-loading', text: 'さがしています…' }));
    try {
      var r = await txwApiCall('journal_search', {
        start_date: m + '-01', end_date: txwMonthEnd(m), keyword: kwInput.value || '',
      });
      var d = (r && r.data) || {};
      clearEl(result);
      if (!d.ok) {
        result.appendChild(el('div', { class: 'note danger', text: '仕訳をさがせませんでした（' + (d.error || '') + '）。' }));
        return;
      }
      txwRenderAttachCandidates(result, d, file);
    } catch (e) {
      clearEl(result);
      result.appendChild(el('div', { class: 'note danger', text: '仕訳をさがせませんでした。' }));
    } finally {
      searchBtn.disabled = false;
    }
  });
}

function txwMonthEnd(m) {
  var y = Number(m.slice(0, 4));
  var mo = Number(m.slice(5, 7));
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}
function txwCurrentMonth() {
  var sel = document.getElementById('txwMonth');
  var v = sel && sel.value;
  return /^\d{4}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 7);
}

function txwRenderAttachCandidates(box, data, file) {
  var list = Array.isArray(data.journals) ? data.journals : [];
  if (!list.length) {
    box.appendChild(el('div', { class: 'evidence-empty', text: 'この月に仕訳は見つかりませんでした。' }));
    return;
  }
  if (data.truncated) {
    box.appendChild(el('div', {
      class: 'note danger',
      text: '仕訳が多いため ' + list.length + '件だけ出しています（全部で ' + data.total + '件）。'
        + '絞り込みを使ってください。',
    }));
  }
  var table = document.createElement('table');
  var thead = el('thead');
  var trh = el('tr');
  ['日付', '金額', '勘定科目', '摘要', ''].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  list.forEach(function (j) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: j.date || '' }));
    tr.appendChild(el('td', { class: 'num', text: yen(j.amount) }));
    tr.appendChild(el('td', { text: (j.accounts || []).join(' / ') }));
    tr.appendChild(el('td', { text: j.remark || '' }));
    var td = el('td');
    if (j.has_voucher) {
      // すでに証憑が付いている仕訳には足せない（MFで外せないため）
      td.appendChild(el('span', { class: 'chip chip-gray', text: '証憑あり' }));
    } else {
      var b = el('button', { type: 'button', class: 'btn-mini', text: 'この仕訳に添付' });
      b.addEventListener('click', function () { txwAttachSharedFile(file, j, b, box); });
      td.appendChild(b);
    }
    tr.appendChild(td);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  var wrap = el('div', { class: 'tblwrap' });
  wrap.appendChild(table);
  box.appendChild(wrap);
  box.appendChild(el('div', {
    class: 'note',
    text: '※「証憑あり」の仕訳には追加できません。MFでは証憑を後から外せないためです。',
  }));
}

var TXW_ATTACH_ERRORS = {
  already_has_voucher: 'この仕訳にはすでに証憑が付いています。MFでは後から外せないため、追加できません。',
  duplicate_file: 'このファイルは既に証憑として取り込まれています。同じものは二度送りません。',
  not_attachable: 'この形式は証憑にできません（PDF・PNG・JPGのみ）。',
  read_failed: '共有ファイルを読み込めませんでした。',
  dup_check_failed: '重複の確認ができなかったため、送信を中止しました。時間をおいてお試しください。',
  store_failed: '証憑の保存に失敗しました。',
  insert_failed: '証憑台帳への登録に失敗しました。',
  journal_check_failed: '仕訳の状態を確認できなかったため、送信を中止しました。',
  attach_failed: 'MFへの送信に失敗しました。',
  already_attached: 'この証憑は既に別の仕訳へ送信済みです。',
  /* 承認が必要な設定のときは管理者だけ。証憑は送ると取り消せないため、
   * 承認待ちに積む方式ではなく管理者限定にしている。 */
  admin_only_when_approval: '承認が必要な設定のため、証憑の添付は管理者のみが行えます。管理者にご依頼ください。',
};

async function txwAttachSharedFile(file, journal, btn, box) {
  var msg = (file.name || '') + '\n↓\n' + (journal.date || '') + ' ' + yen(journal.amount)
    + ' ' + ((journal.accounts || []).join(' / '))
    + '\n\nこの仕訳に証憑として添付します。\nMFへ送った証憑は取り消せません。よろしいですか？';
  if (!confirm(msg)) return;
  btn.disabled = true;
  btn.textContent = '送信中…';
  try {
    /* file は ③共有ファイル（key）でも ②仕訳待ちの証憑（evidence_id）でもよい。
     * サーバー側は同じ関門を通す。 */
    var r = await txwApiCall('attach_shared_file', {
      key: file.key, evidence_id: file.evidence_id, name: file.name, journal_id: journal.id,
    });
    var d = (r && r.data) || {};
    if (d.ok) {
      btn.replaceWith(el('span', { class: 'chip chip-green', text: '添付しました' }));
      box.appendChild(el('div', {
        class: 'note ok',
        text: (file.name || '') + ' を ' + (journal.date || '') + ' の仕訳へ添付しました。',
      }));
      return;
    }
    box.appendChild(el('div', {
      class: 'note danger',
      text: TXW_ATTACH_ERRORS[d.error] || ('添付できませんでした（' + (d.error || '理由不明') + '）。'),
    }));
  } catch (e) {
    box.appendChild(el('div', { class: 'note danger', text: '添付できませんでした。' }));
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = 'この仕訳に添付'; }
  }
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

// 役割(role)の表示名。'admin'（管理者）以外はすべて担当者扱い（サーバーの既定と同じ）。
function txwRoleLabel(role) {
  return role === 'admin' ? '管理者' : '担当者';
}
/* 役割を変える。押し間違いが権限の事故になるので必ず確認を出す。
 * 失敗したら一覧を触らない（画面だけ変わって実際は変わっていない、を避ける）。 */
async function txwSetAdvisorRole(emailStr, newRole, btn) {
  var label = txwRoleLabel(newRole);
  var msg = newRole === 'admin'
    ? emailStr + ' を「管理者」にします。'
      + '承認・差し戻しができるようになり、事務所全員分の操作履歴も見られるようになります。よろしいですか？'
    : emailStr + ' を「担当者」に戻します。'
      + '承認・差し戻しができなくなり、操作履歴はご自身の分だけになります。よろしいですか？';
  if (!confirm(msg)) return;
  btn.disabled = true;
  var before = btn.textContent;
  btn.textContent = '変更中…';
  try {
    var r = await txwApiCall('advisor_set_role', { email: emailStr, role: newRole });
    var d = (r && r.data) || {};
    if (d.ok) { txwLoadAdvisors(); return; }
    alert(d.error === 'member_only'
      ? 'この操作はRIBREのメンバーだけが行えます。'
      : '役割を変えられませんでした（' + (d.error || '理由不明') + '）。変更していません。');
  } catch (e) {
    alert('役割を変えられませんでした。変更していません。');
  }
  btn.disabled = false;
  btn.textContent = before;
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
  ['メール', '登録日時', '役割', '状態', '操作'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  advisors.forEach(function (a) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: a.email || '' }));
    tr.appendChild(el('td', { text: txwFormatDateTime(a.created_at) }));
    var tdRole = el('td');
    tdRole.appendChild(el('span', { class: 'chip ' + (a.role === 'admin' ? 'chip-blue' : 'chip-gray'), text: txwRoleLabel(a.role) }));
    tr.appendChild(tdRole);
    var tdSt = el('td');
    tdSt.appendChild(el('span', { class: 'chip ' + (a.enabled ? 'chip-green' : 'chip-gray'), text: a.enabled ? '有効' : '無効' }));
    tr.appendChild(tdSt);
    var tdOp = el('td');
    var toggleBtn = el('button', { type: 'button', class: 'btn-mini', text: a.enabled ? '無効にする' : '有効にする' });
    toggleBtn.addEventListener('click', function () { txwSetAdvisorEnabled(a.email, !a.enabled, toggleBtn); });
    tdOp.appendChild(toggleBtn);

    /* 役割の切り替え。
     * ⚠ 以前はSQLの文字列を見せるだけだった。保存処理(setAdvisorRole)は
     *   サーバーに前からあり、**呼ぶ口が無かっただけ**（2026-08-05の指摘）。
     *   このパネルは社内メンバーにしか出ないので、押せる形にする。 */
    var newRole = a.role === 'admin' ? 'staff' : 'admin';
    var roleBtn = el('button', {
      type: 'button', class: 'btn-mini',
      text: txwRoleLabel(newRole) + 'にする',
    });
    roleBtn.addEventListener('click', function () {
      txwSetAdvisorRole(a.email, newRole, roleBtn);
    });
    tdOp.appendChild(roleBtn);

    tr.appendChild(tdOp);
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  body.appendChild(table);
}

/* ---------------- Phase 6: 承認の設定 ----------------
 * ⚠ 以前はラジオを出しておきながら「この画面からは変更できません」とSQLを見せていた。
 *   保存処理(saveApprovalPolicy)はサーバーに前からあり、**呼ぶ口が無かっただけ**。
 *   しかもSQLの案内文は古い設計の名残で `'"none"'::jsonb` と書かれており、
 *   そのまま実行しても失敗する内容だった（2026-08-05の指摘で発覚）。
 *   選んだらその場で保存する。SQLは見せない。 */
function txwApprovalPolicyLabel(v) {
  return v === 'required' ? '承認する（管理者の承認が必要）' : '承認しない（担当者がそのまま登録できます）';
}

async function txwLoadApprovalPolicyBlock() {
  var box = document.getElementById('txwApprovalPolicyBox');
  if (!box) return;
  clearEl(box);
  box.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' }));
  var result;
  try {
    result = await txwApiCall('request_list', {});
  } catch (e) {
    clearEl(box);
    box.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' }));
    return;
  }
  var data = result.data || {};
  clearEl(box);
  if (!data.ok) {
    box.appendChild(el('div', { class: 'evidence-empty', text: '読み込めませんでした。' }));
    return;
  }
  var policy = (data.approval_policy === 'required') ? 'required' : 'none';
  txwApprovalPolicyValue = policy;
  // 変えられるのは管理者だけ（サーバーでも弾く）。担当者には選べない形で今の値を見せる
  var canEdit = !!data.is_admin;

  var note = el('div', { class: 'note' });
  var row = el('div', { style: 'display:flex;gap:16px;flex-wrap:wrap;align-items:center;' });
  var radios = [];
  [
    { v: 'none', label: '承認しない（既定）' },
    { v: 'required', label: '承認する（管理者の承認が必要）' }
  ].forEach(function (opt) {
    var id = 'txwApprovalPolicyView_' + opt.v;
    var wrap = el('label', { class: 'txw-policy-opt', for: id });
    var attrs = { type: 'radio', name: 'txwApprovalPolicyRadio', id: id, value: opt.v };
    if (!canEdit) attrs.disabled = 'disabled';
    var radio = el('input', attrs);
    radio.checked = (policy === opt.v);
    radios.push(radio);
    if (canEdit) {
      radio.addEventListener('change', function () {
        if (!radio.checked) return;
        txwSaveApprovalPolicy(opt.v, radios, note);
      });
    }
    wrap.appendChild(radio);
    wrap.appendChild(el('span', { text: ' ' + opt.label, style: 'font-weight:800' }));
    row.appendChild(wrap);
  });
  box.appendChild(row);
  note.textContent = '現在の設定: ' + txwApprovalPolicyLabel(policy);
  box.appendChild(note);
  if (!canEdit) {
    box.appendChild(el('div', {
      class: 'note warn',
      text: 'この設定を変えられるのは管理者だけです。',
    }));
  }
}

/* 選んだ値をその場で保存する。失敗したら**いま実際に保存されている値へ戻す**。
 * ⚠ 戻す先に「画面を開いたときの値」を使ってはいけない。
 *   一度成功したあとに失敗すると、実際は required なのに画面は none に戻り、
 *   **画面だけ変わって実際は違う**という一番まずい状態になる
 *   （2026-08-05、自動テストで発見）。現在値は txwApprovalPolicyValue が持つ。 */
async function txwSaveApprovalPolicy(policy, radios, note) {
  var prev = (txwApprovalPolicyValue === 'required') ? 'required' : 'none';
  var label = txwApprovalPolicyLabel(policy);
  var TXW_NL = String.fromCharCode(10);   // 改行（エスケープが化けるのを避ける）
  if (policy === 'required'
    && !confirm('担当者の登録に管理者の承認を必須にします。' + TXW_NL + TXW_NL
      + '担当者が登録しても、管理者が承認するまでMFへは送られません。' + TXW_NL + TXW_NL
      + 'よろしいですか？')) {
    radios.forEach(function (r) { r.checked = (r.value === prev); });
    return;
  }
  radios.forEach(function (r) { r.disabled = true; });
  note.className = 'note';
  note.textContent = '保存しています…';
  try {
    var r = await txwApiCall('set_approval_policy', { policy: policy });
    var d = (r && r.data) || {};
    if (d.ok) {
      txwApprovalPolicyValue = policy;
      note.className = 'note ok';
      note.textContent = '「' + label + '」に変えました。';
    } else {
      radios.forEach(function (x) { x.checked = (x.value === prev); });
      note.className = 'note danger';
      note.textContent = d.error === 'admin_only'
        ? '管理者だけが変えられます。変更していません。'
        : '保存できませんでした（' + (d.error || '理由不明') + '）。変更していません。';
    }
  } catch (e) {
    radios.forEach(function (x) { x.checked = (x.value === prev); });
    note.className = 'note danger';
    note.textContent = '保存できませんでした。変更していません。';
  } finally {
    radios.forEach(function (x) { x.disabled = false; });
  }
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

/* ---------------- Phase 6: ⑩ 承認待ち ----------------
 * 設計書: docs/TAX_WORKSPACE_PHASE6_PLAN.md §2.3 / §10.2
 * action:'request_list' が返す is_admin で表示を分ける。
 * ⚠ admin向けの一覧は「承認待ち」(status==='pending')だけに絞る。決定済みの依頼は
 *   ④操作履歴（approve_journalize/reject_journalize）で追える。
 * ⚠ 担当者向けの一覧はステータスを問わず全件見せる（承認待ち／承認済み／差し戻しが分かるように）。 */
function txwInvoiceKindLabel(v) {
  if (v === 'INVOICE_KIND_NOT_TARGET') return '対象外';
  if (v === 'INVOICE_KIND_QUALIFIED') return '適格';
  if (v === 'INVOICE_KIND_UNQUALIFIED_80') return '8割控除';
  return '（未選択）';
}
function txwApprovalSnapshotText(snap) {
  if (!snap) return '(不明)';
  return (snap.date || '(日付不明)') + '　' + yen(Math.abs(Number(snap.value) || 0)) + '　' + (snap.content || '(内容なし)');
}

async function txwLoadApprovalTab() {
  var descEl = document.getElementById('txwApprovalPolicyDesc');
  var body = document.getElementById('txwApprovalBody');
  if (descEl) descEl.textContent = '現在の設定を確認しています…';
  if (body) { clearEl(body); body.appendChild(el('div', { class: 'txw-loading', text: '読み込み中…' })); }

  var result;
  try {
    result = await txwApiCall('request_list', {});
  } catch (e) {
    if (descEl) descEl.textContent = '現在の設定を確認できませんでした。';
    if (body) { clearEl(body); body.appendChild(el('div', { class: 'note danger', text: '通信に失敗しました。もう一度お試しください。' })); }
    return;
  }
  if (result.status === 401) { txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }

  var data = result.data || {};
  if (!data.ok) {
    if (descEl) descEl.textContent = '現在の設定を確認できませんでした。';
    if (body) { clearEl(body); body.appendChild(el('div', { class: 'note danger', text: '読み込めませんでした（' + (data.error || data.message || '不明') + '）。' })); }
    return;
  }

  var policy = (data.approval_policy === 'required') ? 'required' : 'none';
  txwApprovalPolicyValue = policy;
  if (descEl) descEl.textContent = '現在の設定: ' + txwApprovalPolicyLabel(policy);

  var rows = Array.isArray(data.requests) ? data.requests : [];
  if (data.is_admin) txwRenderApprovalAdmin(rows);
  else txwRenderApprovalStaff(rows);

  /* ⚠ 承認待ちが上限で切れているのに黙っていると、承認漏れがそのまま埋もれる。
   *   件数だけは本当の数をサーバーが返すので必ず伝える（制約20）。
   *   ⚠ 描画関数が clearEl するので、**描いた後に**足すこと。 */
  if (data.truncated) {
    var box = document.getElementById('txwApprovalBody');
    if (box) {
      box.appendChild(el('div', {
        class: 'note danger',
        text: '依頼が全部で ' + data.total + '件あり、新しい ' + rows.length + '件だけを表示しています。'
          + '残りは処理を進めると出てきます。'
      }));
    }
  }
}

function txwApprovalErrorMessage(data) {
  switch (data && data.error) {
    case 'request_not_found': return 'この依頼は見つかりませんでした。一覧を更新してください。';
    case 'already_decided': return '既に他の操作で処理済みでした（他の管理者が先に処理した可能性があります）。一覧を更新してください。';
    case 'already_journalized': return 'この明細は既に仕訳済みです。一覧を更新してください。';
    case 'transaction_not_found': return '明細が見つかりませんでした。一覧を更新してください。';
    case 'transaction_check_failed': return data.message ? String(data.message) : '明細の確認に失敗しました。もう一度お試しください。';
    case 'admin_only': return '管理者のみ実行できます。';
    case 'reason_required': return '理由を入力してください。';
    default: return txwJournalizeErrorMessage(data);
  }
}

function txwRenderApprovalAdmin(rows) {
  var body = document.getElementById('txwApprovalBody');
  clearEl(body);
  var pending = (rows || []).filter(function (r) { return r && r.status === 'pending'; });
  if (!pending.length) {
    body.appendChild(el('div', { class: 'evidence-empty', text: '承認待ちの依頼はありません。' }));
    return;
  }
  var wrap = el('div', { style: 'overflow-x:auto' });
  var table = el('table');
  var thead = el('thead');
  var htr = el('tr');
  ['依頼者', '依頼日時', '明細（依頼時点）', '勘定科目', '税区分', 'インボイス区分', '証憑', '操作']
    .forEach(function (h) { htr.appendChild(el('th', { text: h })); });
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = el('tbody');

  pending.forEach(function (r) {
    var p = r.payload || {};
    var tr = el('tr');
    tr.appendChild(el('td', { text: r.requested_by || '-' }));
    tr.appendChild(el('td', { text: txwFormatDateTime(r.created_at) }));
    tr.appendChild(el('td', { text: txwApprovalSnapshotText(r.snapshot) }));
    tr.appendChild(el('td', { text: txwIdToLabel(txwAccountLookup, p.account_id) || String(p.account_id || '-') }));
    tr.appendChild(el('td', { text: p.tax_id ? (txwIdToLabel(txwTaxLookup, p.tax_id) || String(p.tax_id)) : '（未指定）' }));
    tr.appendChild(el('td', { text: txwInvoiceKindLabel(p.invoice_kind) }));
    tr.appendChild(el('td', { text: (p.evidence_ids && p.evidence_ids.length) ? (p.evidence_ids.length + '件') : '0件' }));

    var tdOp = el('td', { style: 'min-width:230px;' });
    var diffBox = el('div', { style: 'margin-top:6px;' });
    var approveBtn = el('button', { type: 'button', class: 'btn-mini', text: '承認して登録する', style: 'margin-left:0;' });
    var reasonInput = el('input', { type: 'text', placeholder: '差し戻す理由（必須）', style: 'width:150px;' });
    var rejectBtn = el('button', { type: 'button', class: 'btn-mini', text: '差し戻す' });
    rejectBtn.disabled = true;
    reasonInput.addEventListener('input', function () { rejectBtn.disabled = !reasonInput.value.trim(); });
    var controls = [approveBtn, rejectBtn, reasonInput];
    approveBtn.addEventListener('click', function () { txwApproveRequest(r, controls, diffBox); });
    rejectBtn.addEventListener('click', function () { txwRejectRequest(r, reasonInput, controls, diffBox); });

    tdOp.appendChild(approveBtn);
    tdOp.appendChild(el('div', { style: 'margin-top:6px;display:flex;align-items:center;gap:0;' }, [reasonInput, rejectBtn]));
    tdOp.appendChild(diffBox);
    tr.appendChild(tdOp);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* 承認する（危険な操作なので確認を1回はさむ。押した後はボタン類を無効化して二重送信を防ぐ）。
 * 依頼時点の明細と今の明細が変わっていた場合はサーバーが実行せず before/after を返す
 * （handleApproveRequestのtransaction_changed）。この場合は一覧を作り直さず、その場に差分を出す。 */
async function txwApproveRequest(req, controls, diffBox) {
  if (!window.confirm('この依頼を承認してMFへ登録します。よろしいですか？この操作は取り消せません。')) return;
  controls.forEach(function (c) { c.disabled = true; });
  clearEl(diffBox);

  var result;
  try {
    result = await txwApiCall('request_approve', { request_id: req.id });
  } catch (e) {
    diffBox.appendChild(el('div', { class: 'note danger', text: '通信に失敗しました。もう一度お試しください。' }));
    controls.forEach(function (c) { c.disabled = false; });
    return;
  }
  if (result.status === 401) { txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }

  var data = result.data || {};
  if (data.ok) {
    var msg = '承認して登録しました（仕訳ID ' + (data.journal_id != null ? data.journal_id : '不明') + '）。';
    if (Array.isArray(data.attached) && data.attached.length) msg += '証憑' + data.attached.length + '件を添付しました。';
    txwShowInfoBanner(msg);
    txwLoadApprovalTab();
    return;
  }
  if (data.error === 'transaction_changed') {
    diffBox.appendChild(el('div', { class: 'note danger' }, [
      el('div', { text: '依頼されたときと明細の内容が変わっています。登録していません。' }),
      el('div', { style: 'margin-top:4px;', text: '依頼されたとき: ' + txwApprovalSnapshotText(data.before) }),
      el('div', { text: '今の内容　　: ' + txwApprovalSnapshotText(data.after) }),
    ]));
    controls.forEach(function (c) { c.disabled = false; });
    return;
  }
  diffBox.appendChild(el('div', { class: 'note danger', text: txwApprovalErrorMessage(data) }));
  controls.forEach(function (c) { c.disabled = false; });
}

/* 差し戻す。理由は必須（空なら押せない。reasonInputのinputイベントでボタンの有効/無効を制御済み）。 */
async function txwRejectRequest(req, reasonInput, controls, diffBox) {
  var reason = (reasonInput.value || '').trim();
  if (!reason) return;
  if (!window.confirm('この依頼を差し戻します。よろしいですか？')) return;
  controls.forEach(function (c) { c.disabled = true; });
  clearEl(diffBox);

  var result;
  try {
    result = await txwApiCall('request_reject', { request_id: req.id, reason: reason });
  } catch (e) {
    diffBox.appendChild(el('div', { class: 'note danger', text: '通信に失敗しました。もう一度お試しください。' }));
    controls.forEach(function (c) { c.disabled = false; });
    return;
  }
  if (result.status === 401) { txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }

  var data = result.data || {};
  if (data.ok) {
    txwShowInfoBanner('差し戻しました。');
    txwLoadApprovalTab();
    return;
  }
  diffBox.appendChild(el('div', { class: 'note danger', text: txwApprovalErrorMessage(data) }));
  controls.forEach(function (c) { c.disabled = false; });
}

function txwApprovalStatusChip(r) {
  if (r.status === 'approved') return { label: '承認されました', cls: 'chip-green' };
  if (r.status === 'rejected') return { label: '差し戻されました', cls: 'chip-red' };
  return { label: '承認待ち', cls: 'chip-yellow' };
}

function txwRenderApprovalStaff(rows) {
  var body = document.getElementById('txwApprovalBody');
  clearEl(body);
  var list = rows || [];
  if (!list.length) {
    body.appendChild(el('div', { class: 'evidence-empty', text: 'あなたの依頼はまだありません。' }));
    return;
  }
  var wrap = el('div', { style: 'overflow-x:auto' });
  var table = el('table');
  var thead = el('thead');
  var htr = el('tr');
  ['依頼日時', '明細（依頼時点）', '勘定科目', '状態', '結果']
    .forEach(function (h) { htr.appendChild(el('th', { text: h })); });
  thead.appendChild(htr);
  table.appendChild(thead);
  var tbody = el('tbody');

  list.forEach(function (r) {
    var p = r.payload || {};
    var tr = el('tr');
    tr.appendChild(el('td', { text: txwFormatDateTime(r.created_at) }));
    tr.appendChild(el('td', { text: txwApprovalSnapshotText(r.snapshot) }));
    tr.appendChild(el('td', { text: txwIdToLabel(txwAccountLookup, p.account_id) || String(p.account_id || '-') }));
    var st = txwApprovalStatusChip(r);
    var tdSt = el('td');
    tdSt.appendChild(el('span', { class: 'chip ' + st.cls, text: st.label }));
    tr.appendChild(tdSt);

    var tdMsg = el('td');
    if (r.status === 'approved') {
      tdMsg.appendChild(el('div', {
        class: 'note ok', style: 'margin:0;',
        text: 'あなたの依頼が承認され、MFへ登録されました（仕訳ID ' + (r.journal_id || '不明') + '）。承認者: ' + (r.decided_by || '-')
      }));
    } else if (r.status === 'rejected') {
      tdMsg.appendChild(el('div', {
        class: 'note danger', style: 'margin:0;',
        text: 'あなたの依頼は差し戻されました。理由: ' + (r.decided_reason || '(理由なし)') + '　差し戻した人: ' + (r.decided_by || '-')
      }));
    } else {
      tdMsg.appendChild(el('span', { text: '管理者の承認をお待ちください。' }));
    }
    tr.appendChild(tdMsg);
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* ---------------- タブ切替 ---------------- */
function txwGoTab(t) {
  document.querySelectorAll('.tabpage').forEach(function (elx) { elx.classList.toggle('active', elx.id === 't-' + t); });
  document.querySelectorAll('.tab-btn').forEach(function (elx) { elx.classList.toggle('active', elx.dataset.t === t); });
  if (t === 'admin' && !txwAdminLoaded) {
    txwAdminLoaded = true;
    txwLoadInvites();
    txwLoadAdvisors();
    txwLoadApprovalPolicyBlock();
  }
  // 操作履歴は開くたびに読み直す（自分や他の人の登録が随時増えるため）
  if (t === 'history') txwLoadActionLog();
  // ⑨月次チェックも開くたびに読み直す（推移表・未仕訳件数とも随時変わるため）
  if (t === 'monthly') txwLoadMonthlyCheck();
  // ⑩承認待ちも開くたびに読み直す（承認待ちの件数・状況が随時変わるため）
  if (t === 'approval') txwLoadApprovalTab();
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
/* 提案をそのまま使ったのか、人が直したのかの表示。
 * 「提案どおり」が多い月は、職員が根拠を見ずに押している可能性がある、という
 * 所長の見方ができるようにするための列（所長レビューの指摘・2026-08-04）。 */
function txwInputSourceLabel(v) {
  if (v === 'suggested') return '提案どおり';
  if (v === 'edited') return '提案を直した';
  if (v === 'manual') return '手入力';
  return '-';   // この列を付ける前の記録
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
  ['日時', '操作した人', '操作', '結果', '仕訳ID', '勘定科目', '税区分', '入力', '証憑', '備考']
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
    // 機械の判断（提案どおり）か人の判断（直した・手入力）かを区別して残す
    tr.appendChild(el('td', { text: txwInputSourceLabel(a.payload && a.payload.input_source) }));
    tr.appendChild(el('td', { text: (a.evidence_ids && a.evidence_ids.length) ? (a.evidence_ids.length + '件') : '-' }));
    tr.appendChild(el('td', { text: a.error_message || '' }));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  body.appendChild(wrap);
}

/* 操作履歴のCSVダウンロード（設計書§2.4）。
 * ⚠ この記録はRIBRE側（service roleの鍵を持つ側）には技術的に書き換え可能。
 *   事務所が自分でダウンロードして手元（RIBREが触れない場所）に保管することだけが担保になる。
 *   ボタンの近くにその旨の注意書きを常時表示している（tax-workspace.html側）。 */
function txwCsvFilename(scope, month) {
  return scope === 'month'
    ? ('税理士ワークスペース_操作履歴_' + month + '.csv')
    : '税理士ワークスペース_操作履歴_全期間.csv';
}
async function txwDownloadActionLogCsv(scope) {
  var btn = document.getElementById(scope === 'month' ? 'txwCsvMonthBtn' : 'txwCsvAllBtn');
  var monthInput = document.getElementById('txwMonth');
  var month = monthInput ? monthInput.value : '';
  if (scope === 'month' && !month) { alert('対象月が選ばれていません。'); return; }
  if (btn) btn.disabled = true;
  try {
    var result = await txwApiCall('action_log_csv', scope === 'month' ? { month: month } : {});
    if (result.status === 401) { txwShowGate('ログインの有効期限が切れました。もう一度ログインしてください。'); return; }
    var data = result.data || {};
    if (!data.ok || typeof data.csv !== 'string') {
      alert('CSVの取得に失敗しました。時間をおいてもう一度お試しください。');
      return;
    }
    var blob = new Blob([data.csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = txwCsvFilename(scope, month);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);

    /* ⚠ 何件出たかを必ず出す。件数を出さないと「全部揃っていると思って提出したら
     *   古い分が抜けていた」に気づけない（所長レビューの指摘・2026-08-04）。 */
    var note = document.getElementById('txwCsvResultNote');
    if (note) {
      var n = Number(data.rows) || 0;
      if (data.truncated) {
        note.className = 'note danger';
        note.textContent = n + '件を出力しましたが、上限（' + (data.hard_limit || '?')
          + '件）に達したため、これより古い記録は含まれていません。'
          + '月ごとのダウンロードに分けて、抜けが無いようにしてください。';
      } else {
        note.className = 'note ok';
        note.textContent = n + '件を出力しました（この条件の記録はすべて含まれています）。';
      }
      note.style.display = '';
    }
  } catch (e) {
    alert('CSVのダウンロードに失敗しました。時間をおいてもう一度お試しください。');
  } finally {
    if (btn) btn.disabled = false;
  }
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
    /* 「対象外」の明細は未仕訳の件数に入らない。あるのに「登録は終わっています」と
     * 言い切ると、帳簿から抜けている分を見落とす（CLAUDE.md 制約22）。 */
    var exCount = (data.excluded && Number(data.excluded.count)) || 0;
    box.appendChild(el('div', {
      class: 'note danger',
      text: monthLabel + 'の未仕訳明細は0件です。'
        + (exCount > 0
          ? 'ただし「対象外」にされた明細が' + exCount + '件あります（下に出しています）。この分は帳簿に入っていません。'
          : '登録は終わっています。')
        + '下の「まだ無い科目」は、計上漏れの疑いがあります。'
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

// ④ 貸借対照表の確認(bs)。行データはaccount/parent/valueなど固定の形（候補検索ボタンは無い＝
// APIがcandidate_transaction_idsを返さないため作らない）。
function txwRenderMonthlyBsItemList(containerId, rows, textFn, cls) {
  var list = document.getElementById(containerId);
  clearEl(list);
  var arr = Array.isArray(rows) ? rows : [];
  if (!arr.length) {
    list.appendChild(el('div', { class: 'evidence-empty', text: '該当する科目はありません。' }));
    return;
  }
  arr.forEach(function (row) {
    var item = el('div', { class: 'txw-monthly-item ' + cls });
    item.appendChild(el('div', { class: 'txw-mi-title', text: textFn(row) }));
    list.appendChild(item);
  });
}

/* 「対象外」にされた明細を出す。
 * これが無いと⑨は「未仕訳0件＝登録が終わった」と表示するが、対象外の明細は
 * 未仕訳にも仕訳帳にも出ないため、実際は帳簿から抜けている（CLAUDE.md 制約22）。
 * ⚠ 対象外が正しいこともある（私用の引き落としなど）。正誤の判定はしない。 */
function txwRenderMonthlyExcluded(data) {
  var box = document.getElementById('txwMonthlyExcludedBox');
  if (!box) return;
  clearEl(box);
  var ex = data.excluded || null;
  if (!ex) { box.style.display = 'none'; return; }

  // 取れなかったことを「0件」と混同させない
  if (ex.available === false) {
    box.style.display = 'block';
    box.appendChild(el('div', {
      class: 'note danger',
      text: '「対象外」にされた明細は確認できませんでした。'
        + (ex.reason ? String(ex.reason) : '') + ' 0件という意味ではありません。',
    }));
    return;
  }

  var count = Number(ex.count) || 0;
  if (count === 0) { box.style.display = 'none'; return; }

  box.style.display = 'block';
  box.appendChild(el('div', {
    class: 'note warn',
    text: 'この月には「対象外」にされた明細が ' + count + '件あります。'
      + '対象外の明細は未仕訳にも仕訳帳にも出てこないため、'
      + '未仕訳が0件でも帳簿には入っていません。',
  }));

  var rows = Array.isArray(ex.rows) ? ex.rows : [];
  var table = document.createElement('table');
  var thead = el('thead');
  var trh = el('tr');
  ['日付', '金額', '収支', '内容'].forEach(function (h) { trh.appendChild(el('th', { text: h })); });
  thead.appendChild(trh);
  table.appendChild(thead);
  var tbody = document.createElement('tbody');
  rows.forEach(function (r) {
    var tr = el('tr');
    tr.appendChild(el('td', { text: r.date || '' }));
    tr.appendChild(el('td', { class: 'num', text: yen(r.value) }));
    tr.appendChild(el('td', { text: r.side === 'INCOME' ? '入金' : '出金' }));
    tr.appendChild(el('td', { text: r.content || '' }));
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  var wrap = el('div', { class: 'tblwrap' });
  wrap.appendChild(table);
  box.appendChild(wrap);

  if (ex.truncated) {
    box.appendChild(el('div', {
      class: 'note danger',
      text: '※ 多いため ' + rows.length + '件だけ表示しています（全部で ' + count + '件）。',
    }));
  }

  box.appendChild(el('div', {
    class: 'note',
    text: '※ 対象外が正しいこともあります（私用の引き落としなど）。'
      + 'この画面では正しいかどうかの判定はしません。件数と中身をお見せしているだけです。',
  }));
  box.appendChild(el('div', {
    class: 'note',
    text: '※ 対象外を解除するには、MFの「連携サービスから入力」→ 右上の「登録済一覧」'
      + ' → 対象の連携サービスの「明細一覧」→「対象外を解除」です。この画面からは戻せません。',
  }));
}

function txwRenderMonthlyBs(data) {
  var bs = data.bs || null;
  var unavailBox = document.getElementById('txwMonthlyBsUnavailable');
  var suppressedBox = document.getElementById('txwMonthlyBsSuppressedNote');
  var body = document.getElementById('txwMonthlyBsBody');

  // available:false のときは「異常なし」と誤解させないよう、必ず理由を出す。
  if (!bs || bs.available === false) {
    unavailBox.style.display = 'block';
    unavailBox.textContent = '貸借対照表の確認は表示できません。'
      + ((bs && bs.reason) ? String(bs.reason) : '理由不明のため取得できませんでした。');
    suppressedBox.style.display = 'none';
    suppressedBox.textContent = '';
    body.style.display = 'none';
    return;
  }
  unavailBox.style.display = 'none';
  unavailBox.textContent = '';
  body.style.display = 'block';

  // 登録が途中のとき、サーバーはnegative/changed/equityを空で返しsuppressedに件数を入れる(§bs仕様)。
  // 黙って0件に見せず、必ず件数を伝える。
  var suppressed = Number(bs.suppressed) || 0;
  if (suppressed > 0) {
    suppressedBox.style.display = 'block';
    suppressedBox.textContent = '※ 登録が途中のため、残高のマイナス・急な増減・純資産の確認 '
      + suppressed + '件は表示していません。登録が終わってからもう一度ご覧ください。';
  } else {
    suppressedBox.style.display = 'none';
    suppressedBox.textContent = '';
  }

  txwRenderMonthlyBsItemList('txwMonthlyBsFrozenList', bs.frozen, function (row) {
    return row.account + '（' + row.parent + '）' + yen(row.value) + 'が' + row.months + 'ヶ月間まったく動いていません。'
      + '棚卸を期末にまとめて行っている場合は正常です。そうでない場合は確認してください。';
  }, 'warn');

  txwRenderMonthlyBsItemList('txwMonthlyBsNegativeList', bs.negative, function (row) {
    return row.account + ' ' + yen(row.value);
  }, 'danger');

  // 純資産のマイナス(債務超過)は不具合ではなく経営の状態。危険色ではなく注意色(amber)で、煽らない文言にする。
  txwRenderMonthlyBsItemList('txwMonthlyBsEquityList', bs.equity, function (row) {
    return row.account + ' ' + yen(row.value) + '。債務超過の状態です。';
  }, 'warn');

  txwRenderMonthlyBsItemList('txwMonthlyBsChangedList', bs.changed, function (row) {
    return row.account + ' ' + yen(row.prev) + ' → ' + yen(row.value);
  }, 'warn');
}

// ⑤ 事業区分別の課税売上高(sales_by_tax)。simple_taxがtrueのときだけ区画ごと出す。
// 正誤の判定はしない。区画の最後に必ず「区分の正誤はこの画面では判定できない」旨を出す。
function txwRenderMonthlySalesByTax(data) {
  var section = document.getElementById('txwMonthlySalesByTaxSection');
  var s = data.sales_by_tax;
  if (!s || s.simple_tax !== true) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';

  var wrap = document.getElementById('txwMonthlySalesByTaxTableWrap');
  clearEl(wrap);
  var months = Array.isArray(s.months) ? s.months : [];
  var rows = Array.isArray(s.rows) ? s.rows : [];

  var table = el('table');
  var thead = el('thead');
  var htr = el('tr');
  htr.appendChild(el('th', { text: '事業区分（税区分）' }));
  months.forEach(function (m) { htr.appendChild(el('th', { class: 'num', text: txwMonthlyFormatYearMonth(m) })); });
  htr.appendChild(el('th', { class: 'num', text: '合計' }));
  thead.appendChild(htr);
  table.appendChild(thead);

  var tbody = el('tbody');
  if (!rows.length) {
    var trEmpty = el('tr');
    trEmpty.appendChild(el('td', { colspan: String(months.length + 2), class: 'evidence-empty', text: '該当する税区分はありません。' }));
    tbody.appendChild(trEmpty);
  } else {
    rows.forEach(function (r) {
      var tr = el('tr');
      tr.appendChild(el('td', { text: r.tax_name }));
      var rowTotal = 0;
      (Array.isArray(r.values) ? r.values : []).forEach(function (v) {
        var n = Number(v) || 0;
        rowTotal += n;
        tr.appendChild(el('td', { class: 'num', text: n.toLocaleString() }));
      });
      tr.appendChild(el('td', { class: 'num', text: rowTotal.toLocaleString() }));
      tbody.appendChild(tr);
    });

    // 合計行はAPIが返したtotals(月ごと)をそのまま使う。行の再計算(月の合計)はしない。
    var trTotal = el('tr');
    trTotal.appendChild(el('td', { text: '合計', style: 'font-weight:900;' }));
    var grand = 0;
    (Array.isArray(s.totals) ? s.totals : []).forEach(function (v) {
      var n = Number(v) || 0;
      grand += n;
      trTotal.appendChild(el('td', { class: 'num', style: 'font-weight:900;', text: n.toLocaleString() }));
    });
    trTotal.appendChild(el('td', { class: 'num', style: 'font-weight:900;', text: grand.toLocaleString() }));
    tbody.appendChild(trTotal);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);

  var shiftBox = document.getElementById('txwMonthlySalesByTaxShiftNote');
  if (Array.isArray(s.shift) && s.shift.length) {
    var parts = s.shift.map(function (x) {
      return x.tax_name + ' ' + Math.round(x.prev_ratio * 100) + '% → ' + Math.round(x.ratio * 100) + '%';
    });
    shiftBox.style.display = 'block';
    shiftBox.textContent = '構成比が大きく変わっています。' + parts.join('／') + '。区分の付け間違いが無いかご確認ください。';
  } else {
    shiftBox.style.display = 'none';
    shiftBox.textContent = '';
  }

  // ⚠ 5,000万円を超えているかどうかの判定はしない。数字を出すだけ。
  var annualBox = document.getElementById('txwMonthlySalesByTaxAnnualNote');
  var monthsUsed = s.months_used != null ? s.months_used : 0;
  annualBox.textContent = '直近' + monthsUsed + 'ヶ月の平均から年換算すると' + yen(s.annualized) + 'です'
    + '（簡易課税は基準期間の課税売上高が5,000万円を超えると、翌々期から本則課税になります）。';
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
  txwRenderMonthlyExcluded(data);
  txwRenderMonthlyOutliers(data);
  txwRenderMonthlySignIssues(data);
  txwRenderMonthlyBs(data);
  txwRenderMonthlySalesByTax(data);
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
  document.getElementById('txwCsvMonthBtn').addEventListener('click', function () { txwDownloadActionLogCsv('month'); });
  document.getElementById('txwCsvAllBtn').addEventListener('click', function () { txwDownloadActionLogCsv('all'); });

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
