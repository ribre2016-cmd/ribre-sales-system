/* かんたんモード Ver61.0 — 既存関数を使ったガイド付きワークフロー */

function simpleToggle() {
  const on = document.body.classList.toggle('simple-mode');
  try { localStorage.setItem('ribre_simple_mode', on ? '1' : ''); } catch(e) {}
  if (on) { simpleTab('home'); }
}

function simpleTab(tab) {
  document.querySelectorAll('.smp-tab-btn').forEach(b => b.classList.toggle('smp-tab-active', b.dataset.tab === tab));
  document.querySelectorAll('.smp-nav-item').forEach(b => b.classList.toggle('smp-nav-active', b.dataset.nav === tab));
  document.querySelectorAll('.smp-screen').forEach(s => s.classList.toggle('smp-screen-active', s.dataset.screen === tab));
  if (tab === 'home') { smpRenderAuth(); smpRenderHome(); }
  if (tab === 'summary') smpSummaryEnter();
  if (tab === 'manual') smpManualInit();
  if (tab === 'list') smpRenderList();
  const c = document.querySelector('.smp-content'); if (c) c.scrollTop = 0;
}

/* ホーム画面：今月（無ければ最新データ月）のKPI＋3ヶ月グラフ */
function smpRenderHome() {
  const cur = today().slice(0, 7);
  const inM = (r, m) => (r.month || String(r.date || '').slice(0, 7)) === m;
  let month = cur;
  const curHas = sales().some(r => inM(r, cur)) || purchases().some(r => inM(r, cur));
  if (!curHas) {
    const dm = smpDataMonths().sort().reverse();
    if (dm.length) month = dm[0];
  }
  const s = sales().filter(r => inM(r, month));
  const p = purchases().filter(r => inM(r, month));
  const totalSale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
  const totalFee  = s.reduce((a, r) => a + num(r.fee), 0);
  const totalShip = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const totalPur  = p.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit    = totalSale - totalFee - totalShip - totalPur;
  const set = (id, v, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (color) el.style.color = color;
  };
  const ym = month.split('-');
  const isCur = month === cur;
  set('smpHomeMonth', '📅 ' + ym[0] + '年' + Number(ym[1]) + '月' + (isCur ? '' : '（最新データ）'));
  set('smpHomeProfitLabel', (isCur ? '今月' : Number(ym[1]) + '月') + 'の利益');
  set('smpHomeProfit', (profit >= 0 ? '＋' : '') + yen(profit), profit >= 0 ? '#15803d' : '#dc2626');
  set('smpHomeSub', '売上 ' + yen(totalSale) + ' − 仕入 ' + yen(totalPur) + ' − 経費 ' + yen(totalFee + totalShip));
  set('smpHomeSale', yen(totalSale));
  set('smpHomePur', yen(totalPur));
  set('smpHomeCount', s.length + '件');
  const miss = smpShipMissingCount(sales());
  const w = document.getElementById('smpHomeShipWarn');
  if (w) {
    if (miss > 0) { w.style.display = 'block'; w.textContent = '⚠️ 送料未入力の売上が ' + miss + ' 件（タップで確認）'; }
    else { w.style.display = 'none'; }
  }
  simpleRenderChart('smpHomeChart', 'smpHomeChartLabels');
}

/* ===== ログイン（Google / メール）＋端末またぎ同期 ===== */
function smpRenderAuth() {
  const out = document.getElementById('smpAuthOut');
  const inn = document.getElementById('smpAuthIn');
  if (!out || !inn) return;
  const em = (typeof email === 'function') ? email() : '';
  if (em) {
    out.style.display = 'none';
    inn.style.display = 'block';
    const u = document.getElementById('smpAuthUser'); if (u) u.textContent = em;
  } else {
    out.style.display = 'block';
    inn.style.display = 'none';
  }
}
function smpAuthStatus(msg, type) {
  const el = document.getElementById('smpAuthStatus');
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
  el.className = 'smp-status smp-status-' + (type || 'info');
}
function smpMarketOf(shop) {
  shop = String(shop || '');
  if (shop.indexOf('メルカリ') >= 0) return 'メルカリ';
  if (shop.indexOf('ヤフオク') >= 0) return 'ヤフオク';
  if (shop.indexOf('ラクマ') >= 0) return 'ラクマ';
  return 'その他';
}
function smpGoogleLogin() {
  const c = sb();
  if (!c.url || !c.key) { smpAuthStatus('先に「← フル画面に戻る → 設定」でSupabase URL/Keyを保存してください', 'warn'); return; }
  const redirect = location.origin + location.pathname;
  location.href = c.url.replace(/\/$/, '') + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(redirect);
}
/* OAuthリダイレクト後のhash(access_token)を処理 */
function smpHandleOAuthRedirect() {
  if (!location.hash || location.hash.indexOf('access_token=') < 0) return false;
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const at = h.get('access_token');
  if (!at) return false;
  const expIn = +(h.get('expires_in') || 3600);
  const session = {
    access_token: at,
    refresh_token: h.get('refresh_token') || '',
    token_type: h.get('token_type') || 'bearer',
    expires_in: expIn,
    expires_at: +(h.get('expires_at') || (Math.floor(Date.now() / 1000) + expIn)),
    user: null, email: '', role: 'staff'
  };
  try { setLS(LS.sess, session); } catch (e) {}
  try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {}
  if (!document.body.classList.contains('simple-mode')) {
    document.body.classList.add('simple-mode');
    try { localStorage.setItem('ribre_simple_mode', '1'); } catch (e) {}
  }
  const c = sb();
  fetch(c.url.replace(/\/$/, '') + '/auth/v1/user', { headers: { apikey: c.key, Authorization: 'Bearer ' + at } })
    .then(r => r.json())
    .then(u => {
      session.user = u; session.email = (u && u.email) || '';
      try { setLS(LS.sess, session); localStorage.setItem('ribre_current_user140', session.email); } catch (e) {}
      smpAfterLogin();
    })
    .catch(function () { smpAfterLogin(); });
  return true;
}
async function smpEmailLogin() {
  const e = (document.getElementById('smpAuthEmail').value || '').trim();
  const p = (document.getElementById('smpAuthPass').value || '').trim();
  if (!e || !p) { smpAuthStatus('メールとパスワードを入力してください', 'warn'); return; }
  smpSetVal('email', e); smpSetVal('password', p); smpSetVal('role', 'staff');
  smpAuthStatus('ログイン中...', 'info');
  try { await signIn(); } catch (err) {}
  if (typeof email === 'function' && email()) { await smpAfterLogin(); }
  else { smpAuthStatus('ログインできませんでした（メール/パスワードを確認）', 'err'); }
}
async function smpEmailSignup() {
  const e = (document.getElementById('smpAuthEmail').value || '').trim();
  const p = (document.getElementById('smpAuthPass').value || '').trim();
  if (!e || !p) { smpAuthStatus('メールとパスワードを入力してください', 'warn'); return; }
  smpSetVal('email', e); smpSetVal('password', p); smpSetVal('role', 'staff');
  smpAuthStatus('登録中...', 'info');
  try { await signUp(); } catch (err) {}
  smpAuthStatus('登録しました。続けて「ログイン」を押してください', 'ok');
}
/* ローカルの売上/仕入をクラウドへ（移行用・正準スキーマ・upsert） */
/* クラウド送信用の payload（売上/仕入）を現在のローカルデータから作る */
function smpBuildCloudBodies(em) {
  const sBody = sales().map(r => {
    const amt = num(r.amount || r.price), fee = num(r.fee), ship = num(r.ship || r.shipping);
    const profit = (r.profit !== undefined && r.profit !== '') ? num(r.profit) : (amt - fee - ship);
    const itemId = String(r.itemId || r.id || ('mig_' + (r.date || '') + '_' + (r.name || '') + '_' + amt)).slice(0, 120);
    return { user_email: em, sale_date: r.date || null, month: r.month || String(r.date || '').slice(0, 7), market: smpMarketOf(r.shop), account: r.shop || '', item_id: itemId, item_name: r.name || '', amount: amt, fee: fee, shipping_fee: ship, profit: profit, slip_number: r.slip || '', status: r.matchStatus || '手入力', memo: r.memo || '', source: 'かんたん' };
  });
  const pBody = purchases().map(r => {
    const total = num(r.total || r.amount);
    return { user_email: em, purchase_date: r.date || null, month: r.month || String(r.date || '').slice(0, 7), vendor: r.vendor || '', item_name: r.name || '', cost: total, total: total, invoice_number: '', status: r.matchStatus || '手入力', memo: r.memo || '', source: 'かんたん' };
  });
  return { sBody: sBody, pBody: pBody };
}

/* 初回移行：ローカル→クラウド（upsert/merge。既存クラウドは消さない） */
async function smpUploadAllToCloud(em) {
  const c = sb();
  if (!c.url || !c.key) return { err: 'no config' };
  const s = sess();
  const token = s.access_token || c.key;
  const headers = { apikey: c.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' };
  const base = c.url.replace(/\/$/, '') + '/rest/v1/';
  const { sBody, pBody } = smpBuildCloudBodies(em);
  let okS = 0, okP = 0, err = null;
  try { if (sBody.length) { const res = await fetch(base + 'sales?on_conflict=user_email,item_id', { method: 'POST', headers: headers, body: JSON.stringify(sBody) }); if (res.ok) okS = sBody.length; else err = await res.text(); } } catch (e) { err = e.message; }
  try { if (pBody.length) { const res = await fetch(base + 'purchases', { method: 'POST', headers: headers, body: JSON.stringify(pBody) }); if (res.ok) okP = pBody.length; else err = err || await res.text(); } } catch (e) { err = err || e.message; }
  return { okS: okS, okP: okP, err: err };
}

/* 手動保存：このPCの「今のデータ」でクラウドを置き換える（自分の行を消して入れ直し） */
async function smpCloudSave() {
  const em = (typeof email === 'function') ? email() : '';
  if (!em) { smpAuthStatus('先にログインしてください', 'warn'); return; }
  const c = sb();
  if (!c.url || !c.key) { smpAuthStatus('Supabase設定がありません', 'warn'); return; }
  if (!confirm('このPCの「今のデータ」をクラウドに保存します。\nクラウド側のこのアカウントのデータは、今の内容に置き換わります。\nよろしいですか？')) return;
  const s = sess();
  const token = s.access_token || c.key;
  const base = c.url.replace(/\/$/, '') + '/rest/v1/';
  const delH = { apikey: c.key, Authorization: 'Bearer ' + token };
  const insH = { apikey: c.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const q = '?user_email=eq.' + encodeURIComponent(em);
  smpAuthStatus('クラウドに保存中...', 'info');
  try {
    await fetch(base + 'sales' + q, { method: 'DELETE', headers: delH });
    await fetch(base + 'purchases' + q, { method: 'DELETE', headers: delH });
    const { sBody, pBody } = smpBuildCloudBodies(em);
    let err = null;
    if (sBody.length) { const r = await fetch(base + 'sales', { method: 'POST', headers: insH, body: JSON.stringify(sBody) }); if (!r.ok) err = await r.text(); }
    if (pBody.length) { const r = await fetch(base + 'purchases', { method: 'POST', headers: insH, body: JSON.stringify(pBody) }); if (!r.ok) err = err || await r.text(); }
    if (err) smpAuthStatus('保存で一部エラー: ' + String(err).slice(0, 80), 'warn');
    else smpAuthStatus('✅ クラウドに保存しました（売上' + sBody.length + '・仕入' + pBody.length + '）', 'ok');
  } catch (e) { smpAuthStatus('保存エラー: ' + e.message, 'err'); }
}
async function smpAfterLogin() {
  smpRenderAuth();
  const em = (typeof email === 'function') ? email() : '';
  if (!em) return;
  const migKey = 'ribre_smp_migrated_' + em;
  if (!localStorage.getItem(migKey)) {
    if (sales().length || purchases().length) {
      smpAuthStatus('このPCのデータをアカウントへ移行中...', 'info');
      const r = await smpUploadAllToCloud(em);
      if (r.err) smpAuthStatus('移行で一部エラー: ' + String(r.err).slice(0, 80), 'warn');
      else smpAuthStatus('移行完了（売上' + r.okS + '・仕入' + r.okP + '）', 'ok');
    }
    try { localStorage.setItem(migKey, new Date().toISOString()); } catch (e) {}
  }
  smpAuthStatus('クラウドから読込中...', 'info');
  try { await ver460LoadNow(); } catch (e) {}
  smpRenderAuth(); smpRenderHome();
  const act = document.querySelector('.smp-screen.smp-screen-active');
  if (act && act.dataset.screen === 'summary') simpleRenderSummary();
  smpAuthStatus('✅ ログイン中：' + em, 'ok');
}
function smpCloudReload() {
  if (!confirm('クラウドの内容をこのPCに読み込みます。\nこのPCの今の表示は、クラウドの内容に置き換わります。\n（先に保存したい場合は「クラウドに保存」を押してください）\nよろしいですか？')) return;
  smpAuthStatus('クラウドから読込中...', 'info');
  Promise.resolve().then(async () => {
    try { await ver460LoadNow(); } catch (e) {}
    smpRenderHome();
    const act = document.querySelector('.smp-screen.smp-screen-active');
    if (act && act.dataset.screen === 'summary') simpleRenderSummary();
    smpAuthStatus('✅ 読込完了', 'ok');
  });
}
function smpLogout() {
  try { localStorage.removeItem(LS.sess); } catch (e) {}
  try { localStorage.removeItem('ribre_current_user140'); localStorage.removeItem('ribre_current_role140'); } catch (e) {}
  try { refreshAll(); } catch (e) {}
  smpRenderAuth(); smpRenderHome();
  smpAuthStatus('ログアウトしました（このPCのデータは残ります）', 'info');
}

/* ===== 取り込み（統合入力）: CSV・画像・キャプチャを1つの投入口で ===== */
let _smpInboxFile = null;
let _smpInboxMode = null; // 'ocr_sale' | 'ocr_purchase' | 'csv_sales' | 'csv_ship'
let _smpInboxQueue = [];  // 複数ファイルを順番に処理するためのキュー
let _smpInboxIndex = 0;

function smpSetVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }

function smpInboxHideAll() {
  ['smpInboxPreview','smpInboxKindImg','smpInboxKindCsv','smpInboxSalesCsv','smpInboxShipCsv','smpInboxOcr','smpInboxFields']
    .forEach(id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
}

function smpInboxPick(input) {
  if (!input || !input.files || !input.files.length) return;
  smpInboxAddFiles(input.files);
}

/* 複数ファイルをキューに積んで先頭から処理開始 */
function smpInboxAddFiles(fileList) {
  const files = Array.prototype.slice.call(fileList || []);
  if (!files.length) return;
  _smpInboxQueue = files;
  _smpInboxIndex = 0;
  smpInboxStartItem();
}

/* キューの現在ファイルを処理（種類を聞く） */
function smpInboxStartItem() {
  if (_smpInboxIndex >= _smpInboxQueue.length) { smpInboxFinish(); return; }
  _smpInboxFile = _smpInboxQueue[_smpInboxIndex];
  _smpInboxMode = null;
  smpInboxHideAll();
  const file = _smpInboxFile;
  const total = _smpInboxQueue.length, cur = _smpInboxIndex + 1;
  const prog = document.getElementById('smpInboxProgress');
  if (prog) {
    if (total > 1) { prog.style.display = 'block'; prog.textContent = '📂 ' + total + '件中 ' + cur + '件目： ' + file.name; }
    else { prog.style.display = 'none'; prog.textContent = ''; }
  }
  const nameEl = document.getElementById('smpInboxFileName');
  if (nameEl) nameEl.textContent = file.name;
  const prefix = total > 1 ? '(' + cur + '/' + total + ') ' : '';
  const isImage = (file.type || '').startsWith('image/');
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isCsv = (file.type || '').indexOf('csv') >= 0 || /\.csv$/i.test(file.name);
  if (isImage || isPdf) {
    smpInboxShowPreview(file, isImage);
    const k = document.getElementById('smpInboxKindImg'); if (k) k.style.display = 'block';
    smpSetStatus('smpInboxStatus', prefix + 'これは「売上」ですか？「仕入」ですか？', 'info');
  } else if (isCsv) {
    smpInboxShowCsvPreview(file);
    const k = document.getElementById('smpInboxKindCsv'); if (k) k.style.display = 'block';
    smpSetStatus('smpInboxStatus', prefix + 'これは「売上CSV」ですか？「配送CSV」ですか？', 'info');
  } else {
    smpSetStatus('smpInboxStatus', prefix + '対応していない形式のためスキップしました', 'warn');
    smpInboxNext();
  }
}

/* 次のファイルへ */
function smpInboxNext() { _smpInboxIndex += 1; smpInboxStartItem(); }

/* 1件処理し終えた後：残りがあれば次を聞く／最後なら片付け */
function smpInboxAfterItem() {
  smpRenderHome();
  if (_smpInboxIndex + 1 < _smpInboxQueue.length) {
    smpInboxNext();
  } else {
    smpInboxClearOnly();
  }
}

function smpInboxFinish() {
  smpInboxClearOnly();
  smpSetStatus('smpInboxStatus', '✅ すべて完了しました', 'ok');
  smpRenderHome();
}

/* 入力欄・キューを片付け（ステータス文は残す） */
function smpInboxClearOnly() {
  _smpInboxQueue = []; _smpInboxIndex = 0; _smpInboxFile = null; _smpInboxMode = null;
  const f = document.getElementById('smpInboxFile'); if (f) f.value = '';
  const img = document.getElementById('smpInboxImg'); if (img) img.src = '';
  const csv = document.getElementById('smpInboxCsv'); if (csv) { csv.style.display = 'none'; csv.innerHTML = ''; }
  const prog = document.getElementById('smpInboxProgress'); if (prog) { prog.style.display = 'none'; prog.textContent = ''; }
  const fn = document.getElementById('smpInboxFileName'); if (fn) fn.textContent = '';
  smpInboxHideAll();
}

function smpInboxShowPreview(file, isImage) {
  const area = document.getElementById('smpInboxPreview');
  const img = document.getElementById('smpInboxImg');
  const pdf = document.getElementById('smpInboxPdf');
  const csv = document.getElementById('smpInboxCsv');
  if (!area) return;
  area.style.display = 'block';
  if (csv) { csv.style.display = 'none'; csv.innerHTML = ''; }
  const url = URL.createObjectURL(file);
  if (isImage) {
    if (img) { img.src = url; img.style.display = 'block'; }
    if (pdf) pdf.style.display = 'none';
  } else {
    if (img) img.style.display = 'none';
    if (pdf) { pdf.src = url; pdf.style.display = 'block'; }
  }
}

/* CSVの先頭数行を表でプレビュー（読み取り専用・取込には影響しない） */
function smpInboxShowCsvPreview(file) {
  const area = document.getElementById('smpInboxPreview');
  const img = document.getElementById('smpInboxImg');
  const pdf = document.getElementById('smpInboxPdf');
  const csv = document.getElementById('smpInboxCsv');
  if (!area || !csv) return;
  area.style.display = 'block';
  if (img) img.style.display = 'none';
  if (pdf) pdf.style.display = 'none';
  csv.style.display = 'block';
  csv.innerHTML = '<div style="padding:10px;color:#64748b;font-size:12px">読み込み中...</div>';
  const reader = new FileReader();
  reader.onload = function () {
    let text = '';
    try {
      const buf = reader.result;
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.indexOf('�') >= 0) { try { text = new TextDecoder('shift-jis').decode(buf); } catch (e) {} }
    } catch (e) { text = ''; }
    const esc = s => String(s || '').replace(/[<>&]/g, m => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[m]));
    const lines = text.split(/\r?\n/).filter(l => l.length).slice(0, 6);
    if (!lines.length) { csv.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:12px">プレビューできませんでした</div>'; return; }
    let html = '<table style="border-collapse:collapse;width:100%;font-size:11px">';
    lines.forEach((line, ri) => {
      const cells = line.split(',').slice(0, 6);
      html += '<tr>';
      cells.forEach(c => {
        const tag = ri === 0 ? 'th' : 'td';
        const extra = ri === 0 ? 'background:#f1f5f9;font-weight:700;' : '';
        html += '<' + tag + ' style="border:1px solid #e2e8f0;padding:4px 6px;white-space:nowrap;' + extra + '">' + esc(c) + '</' + tag + '>';
      });
      html += '</tr>';
    });
    html += '</table><div style="padding:6px;color:#94a3b8;font-size:10px">先頭の数行のみ表示（確認用）</div>';
    csv.innerHTML = html;
  };
  reader.onerror = function () { csv.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:12px">プレビューできませんでした</div>'; };
  reader.readAsArrayBuffer(file);
}

/* ファイル名から取込元アカウントを推定 */
function smpDetectAccount(name) {
  name = String(name || '');
  const y = name.match(/ヤフオク\s*([1-8])(?![0-9])/);
  if (y) return 'ヤフオク' + y[1];
  if (name.indexOf('メルカリShops') >= 0 || /mercari[\s_-]*shops/i.test(name)) return 'メルカリShops';
  if (name.indexOf('メルカリ') >= 0 || /mercari/i.test(name)) return 'メルカリ';
  if (name.indexOf('ラクマ') >= 0 || /rakuma/i.test(name)) return 'ラクマ';
  return '';
}

/* CSV内の日付から「何月分か」を推定（非同期） */
function smpDetectCsvMonths(file, cb) {
  const reader = new FileReader();
  reader.onload = function () {
    let text = '';
    try {
      const buf = reader.result;
      text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.indexOf('�') >= 0) { try { text = new TextDecoder('shift-jis').decode(buf); } catch (e) {} }
    } catch (e) {}
    const set = {};
    const re = /(20\d{2})[\-\/年.](\d{1,2})/g;
    let mm;
    while ((mm = re.exec(text))) { const n = +mm[2]; if (n >= 1 && n <= 12) set[mm[1] + '-' + ('0' + n).slice(-2)] = 1; }
    const months = Object.keys(set).sort().map(x => { const p = x.split('-'); return p[0] + '年' + (+p[1]) + '月'; });
    cb(months);
  };
  reader.onerror = function () { cb([]); };
  reader.readAsArrayBuffer(file);
}

function smpInboxUpdateCsvInfo(acc) {
  const info = document.getElementById('smpInboxCsvInfo');
  if (!info || !_smpInboxFile) return;
  info.style.display = 'block';
  const head = acc ? '📥 ファイル名から「' + acc + '」を選択。' : '';
  info.textContent = head + ' 📅 何月分か確認中...';
  smpDetectCsvMonths(_smpInboxFile, function (months) {
    const m = months.length ? months.join('・') + ' 分' : '月を特定できませんでした';
    info.textContent = head + ' 📅 ' + m;
  });
}

function smpInboxChoose(mode) {
  _smpInboxMode = mode;
  const hide = id => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
  const show = id => { const el = document.getElementById(id); if (el) el.style.display = 'block'; };
  hide('smpInboxKindImg'); hide('smpInboxKindCsv');
  if (mode === 'csv_sales') {
    show('smpInboxSalesCsv');
    const acc = smpDetectAccount(_smpInboxFile ? _smpInboxFile.name : '');
    const sel = document.getElementById('smpInboxAccount');
    if (acc && sel) sel.value = acc;
    smpInboxUpdateCsvInfo(acc);
    smpSetStatus('smpInboxStatus', '取込元と月を確認して「取込する」を押してください', 'info');
  }
  else if (mode === 'csv_ship') { show('smpInboxShipCsv'); smpSetStatus('smpInboxStatus', '配送会社を選んで「取込んで照合する」を押してください', 'info'); }
  else {
    show('smpInboxOcr');
    const fields = document.getElementById('smpInboxFields'); if (fields) fields.style.display = 'none';
    const btn = document.getElementById('smpInboxOcrBtn'); if (btn) btn.disabled = false;
    smpSetStatus('smpInboxStatus', '「AIで読み取る」を押してください（' + (mode === 'ocr_sale' ? '売上' : '仕入') + '）', 'info');
  }
}

/* 取込済みCSVの記録（ファイル名＋サイズで判定） */
function smpImportedSigs() {
  try { return JSON.parse(localStorage.getItem('ribre_smp_imported_csv') || '[]'); } catch (e) { return []; }
}
function smpRecordImportSig(sig, acc) {
  const a = smpImportedSigs();
  if (!a.some(x => x.sig === sig)) {
    a.unshift({ sig: sig, acc: acc });
    try { localStorage.setItem('ribre_smp_imported_csv', JSON.stringify(a.slice(0, 200))); } catch (e) {}
  }
}

function smpInboxImportSales() {
  if (!_smpInboxFile) { alert('ファイルを選んでください'); return; }
  const acc = document.getElementById('smpInboxAccount').value;
  const sig = _smpInboxFile.name + '|' + _smpInboxFile.size;
  if (smpImportedSigs().some(x => x.sig === sig)) {
    if (!confirm('このCSV「' + _smpInboxFile.name + '」は取込済みです。\n更新（再取込）しますか？\n※同じ商品は重複せず、最新の内容に更新されます。')) {
      smpSetStatus('smpInboxStatus', 'このCSVは取込済みのためスキップしました', 'info');
      smpInboxAfterItem();
      return;
    }
  }
  const oA = document.getElementById('yahooAccount'), oF = document.getElementById('yahooCsvFile');
  if (!oA || !oF) { alert('ページを再読み込みしてください'); return; }
  oA.value = acc;
  const dt = new DataTransfer(); dt.items.add(_smpInboxFile); oF.files = dt.files;
  smpSetStatus('smpInboxStatus', '取込中...', 'info');
  try {
    importYahooSalesCsv();
    setTimeout(() => {
      const c = document.getElementById('yahooSalesCount') ? document.getElementById('yahooSalesCount').textContent : '?';
      smpRecordImportSig(sig, acc);
      smpSetStatus('smpInboxStatus', `✅ 売上CSV取込完了：${c}（重複する商品は自動でまとめました）`, 'ok');
      smpInboxAfterItem();
    }, 800);
  } catch (e) { smpSetStatus('smpInboxStatus', '❌ エラー：' + e.message, 'err'); }
}

function smpInboxImportShipping() {
  if (!_smpInboxFile) { alert('ファイルを選んでください'); return; }
  const type = document.getElementById('smpInboxShipType').value;
  const oT = document.getElementById('shipCsvType'), oF = document.getElementById('shipCsvFile');
  if (!oT || !oF) { alert('ページを再読み込みしてください'); return; }
  oT.value = type;
  const dt = new DataTransfer(); dt.items.add(_smpInboxFile); oF.files = dt.files;
  smpSetStatus('smpInboxStatus', '取込中...', 'info');
  try {
    importShippingCsv();
    setTimeout(() => {
      smpSetStatus('smpInboxStatus', '照合中...', 'info');
      try {
        matchShipping();
        setTimeout(() => {
          const m = document.getElementById('shipMatchCount') ? document.getElementById('shipMatchCount').textContent : '?';
          const u = document.getElementById('shipSalesUnmatched') ? document.getElementById('shipSalesUnmatched').textContent : '?';
          smpSetStatus('smpInboxStatus', `✅ 照合完了　一致：${m}　未一致：${u}（送料・伝票を売上に自動反映）`, 'ok');
          smpInboxAfterItem();
        }, 800);
      } catch (e) { smpSetStatus('smpInboxStatus', '❌ 照合エラー：' + e.message, 'err'); }
    }, 900);
  } catch (e) { smpSetStatus('smpInboxStatus', '❌ 取込エラー：' + e.message, 'err'); }
}

function smpInboxRunOcr() {
  if (!_smpInboxFile) { alert('ファイルを選んでください'); return; }
  const kind = _smpInboxMode === 'ocr_sale' ? 'sale' : 'purchase';
  const oF = document.getElementById('ocrFile'), oK = document.getElementById('ocrKind');
  if (!oF || !oK) { smpSetStatus('smpInboxStatus', '⚠ OCR機能が使えません。再読み込みしてください', 'warn'); return; }
  oK.value = kind;
  try { const dt = new DataTransfer(); dt.items.add(_smpInboxFile); oF.files = dt.files; } catch (e) {}
  const btn = document.getElementById('smpInboxOcrBtn'); if (btn) btn.disabled = true;
  smpSetStatus('smpInboxStatus', '📖 AIが読み取っています...（数秒かかります）', 'info');
  try {
    registerEvidence();
    setTimeout(() => {
      try { runOcr(); setTimeout(() => smpInboxSyncFields(kind), 4000); }
      catch (e) { smpSetStatus('smpInboxStatus', '⚠ 読み取りエラー。下の欄に手入力して保存できます', 'warn'); smpInboxShowFields(kind); }
    }, 500);
  } catch (e) { smpSetStatus('smpInboxStatus', '⚠ ファイル登録エラー。下の欄に手入力して保存できます', 'warn'); smpInboxShowFields(kind); }
}

function smpInboxShowFields(kind) {
  const f = document.getElementById('smpInboxFields'); if (f) f.style.display = 'block';
  const pl = document.getElementById('smpInboxPartnerLabel'); if (pl) pl.textContent = kind === 'sale' ? '販売先' : '仕入先';
  const kl = document.getElementById('smpInboxKindLabel'); if (kl) kl.textContent = (kind === 'sale' ? '売上' : '仕入') + '：内容を確認して保存';
  const d = document.getElementById('smpInboxDate'); if (d && !d.value) d.value = today();
}

function smpInboxSyncFields(kind) {
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  const date = g('cDate'), vendor = g('cVendor'), item = g('cItem'), amount = g('cAmount');
  smpInboxShowFields(kind);
  smpSetVal('smpInboxDate', date || today());
  smpSetVal('smpInboxPartner', vendor);
  smpSetVal('smpInboxItem', item);
  smpSetVal('smpInboxAmount', amount);
  if (date || item || amount) smpSetStatus('smpInboxStatus', '✅ 読み取り完了。確認して「保存する」を押してください', 'ok');
  else smpSetStatus('smpInboxStatus', '⚠ 読み取れませんでした。手入力して保存できます', 'warn');
}

function smpInboxSaveOcr() {
  const kind = _smpInboxMode === 'ocr_sale' ? 'sale' : 'purchase';
  const date = (document.getElementById('smpInboxDate').value || today());
  const partner = (document.getElementById('smpInboxPartner').value || '').trim();
  const item = (document.getElementById('smpInboxItem').value || '').trim();
  const amount = num(document.getElementById('smpInboxAmount').value || 0);
  if (!item) { alert('商品名を入力してください'); return; }
  if (!amount) { alert('金額を入力してください'); return; }
  if (kind === 'sale') {
    smpSetVal('saleDate', date); smpSetVal('saleShop', partner || 'その他'); smpSetVal('saleName', item); smpSetVal('saleAmount', amount);
    addSale();
  } else {
    smpSetVal('purDate', date); smpSetVal('purVendor', partner || 'その他'); smpSetVal('purName', item); smpSetVal('purAmount', amount);
    addPurchase();
  }
  smpSetStatus('smpInboxStatus', '✅ ' + (kind === 'sale' ? '売上' : '仕入') + 'を登録しました', 'ok');
  smpInboxAfterItem();
}

function smpInboxReset() {
  smpInboxClearOnly();
  smpSetStatus('smpInboxStatus', 'ファイルを選ぶか貼り付けてください', 'info');
}

/* ===== 手入力（CSV/画像を使わず直接登録） ===== */
let _smpManKind = 'sale';
function smpManualInit() {
  const d = document.getElementById('smpManDate'); if (d && !d.value) d.value = today();
  smpManualKind(_smpManKind);
}
function smpManualKind(kind) {
  _smpManKind = kind;
  const sb = document.getElementById('smpManSaleBtn'), pb = document.getElementById('smpManPurBtn');
  if (sb) sb.classList.toggle('smp-choice-active', kind === 'sale');
  if (pb) pb.classList.toggle('smp-choice-active', kind === 'purchase');
  const shopF = document.getElementById('smpManShopField'); if (shopF) shopF.style.display = kind === 'sale' ? 'block' : 'none';
  const partF = document.getElementById('smpManPartnerField'); if (partF) partF.style.display = kind === 'purchase' ? 'block' : 'none';
}
function smpManualRegister() {
  const date = (document.getElementById('smpManDate').value || today());
  const item = (document.getElementById('smpManItem').value || '').trim();
  const amount = num(document.getElementById('smpManAmount').value || 0);
  if (!item) { alert('商品名を入力してください'); return; }
  if (!amount) { alert('金額を入力してください'); return; }
  if (_smpManKind === 'sale') {
    const shop = document.getElementById('smpManShop').value;
    smpSetVal('saleDate', date); smpSetVal('saleShop', shop); smpSetVal('saleName', item); smpSetVal('saleAmount', amount);
    addSale();
  } else {
    const vendor = (document.getElementById('smpManPartner').value || '').trim() || 'その他';
    smpSetVal('purDate', date); smpSetVal('purVendor', vendor); smpSetVal('purName', item); smpSetVal('purAmount', amount);
    addPurchase();
  }
  ['smpManItem', 'smpManAmount', 'smpManPartner'].forEach(id => smpSetVal(id, ''));
  smpSetStatus('smpManStatus', '✅ ' + (_smpManKind === 'sale' ? '売上' : '仕入') + 'を登録しました', 'ok');
  smpRenderHome();
}

/* ---- 売上CSV取込 ---- */
function smpImportCsv() {
  const file = document.getElementById('smpCsvFile').files[0];
  const platform = document.getElementById('smpPlatform').value;
  if (!file) { alert('CSVファイルを選んでください'); return; }

  // 既存の要素に値をセットして既存関数を呼び出す
  const origSelect = document.getElementById('yahooAccount');
  const origFile   = document.getElementById('yahooCsvFile');
  if (!origSelect || !origFile) { alert('ページを再読み込みしてください'); return; }

  origSelect.value = platform;

  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpCsvStatus', '取込中...', 'info');
  try {
    importYahooSalesCsv();
    setTimeout(() => {
      const count = document.getElementById('yahooSalesCount')?.textContent || '?';
      smpSetStatus('smpCsvStatus', `✅ 取込完了：${count}`, 'ok');
      smpMarkDone('csv');
      simpleRenderSummary();
    }, 800);
  } catch(e) {
    smpSetStatus('smpCsvStatus', '❌ エラー：' + e.message, 'err');
  }
}

/* ---- 配送照合 ---- */
function smpImportShipping() {
  const file = document.getElementById('smpShipFile').files[0];
  const type = document.getElementById('smpShipType').value;
  if (!file) { alert('CSVファイルを選んでください'); return; }

  const origType = document.getElementById('shipCsvType');
  const origFile = document.getElementById('shipCsvFile');
  if (!origType || !origFile) { alert('ページを再読み込みしてください'); return; }

  origType.value = type;
  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpShipStatus', '取込中...', 'info');
  try {
    importShippingCsv();
    setTimeout(() => {
      smpSetStatus('smpShipStatus', '✅ 配送CSV取込完了。次に「照合する」を押してください', 'ok');
    }, 800);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ エラー：' + e.message, 'err');
  }
}

function smpMatchShipping() {
  smpSetStatus('smpShipStatus', '照合中...', 'info');
  try {
    matchShipping();
    setTimeout(() => {
      const matched   = document.getElementById('shipMatchCount')?.textContent || '?';
      const unmatched = document.getElementById('shipSalesUnmatched')?.textContent || '?';
      smpSetStatus('smpShipStatus', `✅ 照合完了　一致：${matched}　未一致：${unmatched}`, 'ok');
      smpMarkDone('ship');
      simpleRenderSummary();
    }, 800);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ エラー：' + e.message, 'err');
  }
}

/* 取込→照合をワンタップで連続実行 */
function smpImportAndMatchShipping() {
  const file = document.getElementById('smpShipFile').files[0];
  const type = document.getElementById('smpShipType').value;
  if (!file) { alert('配送CSVファイルを選んでください'); return; }

  const origType = document.getElementById('shipCsvType');
  const origFile = document.getElementById('shipCsvFile');
  if (!origType || !origFile) { alert('ページを再読み込みしてください'); return; }

  origType.value = type;
  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpShipStatus', '取込中...', 'info');
  try {
    importShippingCsv();
    setTimeout(() => {
      smpSetStatus('smpShipStatus', '照合中...', 'info');
      try {
        matchShipping();
        setTimeout(() => {
          const matched   = document.getElementById('shipMatchCount')?.textContent || '?';
          const unmatched = document.getElementById('shipSalesUnmatched')?.textContent || '?';
          smpSetStatus('smpShipStatus', `✅ 完了！　一致：${matched}　未一致：${unmatched}`, 'ok');
          smpMarkDone('ship');
          simpleRenderSummary();
        }, 800);
      } catch(e) {
        smpSetStatus('smpShipStatus', '❌ 照合エラー：' + e.message, 'err');
      }
    }, 900);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ 取込エラー：' + e.message, 'err');
  }
}

/* ---- 仕入れ（OCR） ---- */
let _smpOcrFile = null;

function smpHandleOcrFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  _smpOcrFile = file;

  const ocrLabel = document.getElementById('smpOcrFileName');
  if (ocrLabel) ocrLabel.textContent = file.name;

  // プレビュー表示（同期）
  const area   = document.getElementById('smpOcrPreviewArea');
  const img    = document.getElementById('smpOcrPreviewImg');
  const pdfBox = document.getElementById('smpOcrPreviewPdf');
  const pdfName= document.getElementById('smpOcrPreviewPdfName');

  if (area) {
    area.style.cssText = 'display:block !important; margin-bottom:10px; text-align:center';
    const blobUrl = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      if (img) { img.src = blobUrl; img.style.display = 'block'; }
      if (pdfBox) pdfBox.style.display = 'none';
    } else {
      if (img) img.style.display = 'none';
      if (pdfBox) { pdfBox.src = blobUrl; pdfBox.style.display = 'block'; }
    }
  }

  // OCRボタンを有効化してガイドメッセージ更新
  const ocrBtn = document.getElementById('smpOcrRunBtn');
  if (ocrBtn) ocrBtn.disabled = false;
  smpSetStatus('smpOcrStatus', '② 「AIで読み取る」を押してください', 'info');
}

function smpRunOcr() {
  if (!_smpOcrFile) { alert('先にファイルを選んでください'); return; }
  smpRunOcrProcess(_smpOcrFile);
  const ocrBtn = document.getElementById('smpOcrRunBtn');
  if (ocrBtn) ocrBtn.disabled = true;
}

function smpRunOcrProcess(file) {
  const origFile = document.getElementById('ocrFile');
  const origKind = document.getElementById('ocrKind');
  if (!origFile || !origKind) {
    smpSetStatus('smpOcrStatus', '⚠ OCR機能が利用できません。ページを再読み込みしてください', 'warn');
    return;
  }

  origKind.value = 'purchase';
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    origFile.files = dt.files;
  } catch(e) {}

  smpSetStatus('smpOcrStatus', '📖 AIが読み取っています...（数秒かかります）', 'info');
  try {
    registerEvidence();
    setTimeout(() => {
      try {
        runOcr();
        setTimeout(() => smpSyncOcrFields(), 4000);
      } catch(e) {
        smpSetStatus('smpOcrStatus', '⚠ OCR処理でエラーが発生しました。手動で入力してください', 'warn');
      }
    }, 500);
  } catch(e) {
    smpSetStatus('smpOcrStatus', '⚠ ファイル登録でエラーが発生しました。手動で入力してください', 'warn');
  }
}

function smpSyncOcrFields() {
  const date   = document.getElementById('cDate')?.value   || '';
  const vendor = document.getElementById('cVendor')?.value || '';
  const item   = document.getElementById('cItem')?.value   || '';
  const amount = document.getElementById('cAmount')?.value || '';

  if (document.getElementById('smpOcrDate'))   document.getElementById('smpOcrDate').value   = date;
  if (document.getElementById('smpOcrVendor')) document.getElementById('smpOcrVendor').value = vendor;
  if (document.getElementById('smpOcrItem'))   document.getElementById('smpOcrItem').value   = item;
  if (document.getElementById('smpOcrAmount')) document.getElementById('smpOcrAmount').value = amount;

  if (date || item || amount) {
    smpSetStatus('smpOcrStatus', '✅ OCR完了。内容を確認してから「仕入れとして登録」を押してください', 'ok');
  } else {
    smpSetStatus('smpOcrStatus', '⚠ OCR結果が空です。手動で入力してください', 'warn');
  }
}

function smpRegisterPurchase() {
  const date   = document.getElementById('smpOcrDate')?.value.trim()   || today();
  const vendor = document.getElementById('smpOcrVendor')?.value.trim() || 'その他';
  const item   = document.getElementById('smpOcrItem')?.value.trim();
  const amount = num(document.getElementById('smpOcrAmount')?.value || 0);

  if (!item)   { alert('商品名を入力してください'); return; }
  if (!amount) { alert('金額を入力してください'); return; }

  // 既存フィールドに反映して addPurchase を呼ぶ
  if (document.getElementById('purDate'))   document.getElementById('purDate').value   = date;
  if (document.getElementById('purVendor')) document.getElementById('purVendor').value = vendor;
  if (document.getElementById('purName'))   document.getElementById('purName').value   = item;
  if (document.getElementById('purAmount')) document.getElementById('purAmount').value = amount;

  addPurchase();

  // フォームリセット
  ['smpOcrDate','smpOcrVendor','smpOcrItem','smpOcrAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('smpOcrFileInput').value = '';
  smpSetStatus('smpOcrStatus', '✅ 仕入れを登録しました', 'ok');
  smpMarkDone('ocr');
  simpleRenderSummary();
}

/* ---- 月次サマリー ---- */
/* 集計タブを開いた時：選択月にデータが無ければ、データのある月へ自動で合わせる */
function smpSummaryEnter() {
  smpInitMonthOptions();
  const sel = document.getElementById('smpSummaryMonth');
  if (sel) {
    const dm = smpDataMonths();
    const v = sel.value;
    const hasData = v === 'all' || dm.indexOf(v) >= 0;
    if (!hasData && dm.length) {
      const cur = today().slice(0, 7);
      sel.value = dm.indexOf(cur) >= 0 ? cur : dm.slice().sort().reverse()[0];
    }
  }
  simpleRenderSummary();
  simpleRenderChart();
}

function simpleRenderSummary() {
  const sel = document.getElementById('smpSummaryMonth');
  if (!sel) return;
  smpInitMonthOptions();              // データに合わせて月候補を更新（取込分も出る）
  const month = sel.value || today().slice(0, 7);
  const all = month === 'all';
  const inMonth = r => all || (r.month || String(r.date || '').slice(0, 7)) === month;

  const s = sales().filter(inMonth);
  const p = purchases().filter(inMonth);

  const totalSale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
  const totalFee  = s.reduce((a, r) => a + num(r.fee), 0);
  const totalShip = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const totalPur  = p.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit    = totalSale - totalFee - totalShip - totalPur;

  const set = (id, v, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (color) el.style.color = color;
  };
  set('smpTotalSale',  yen(totalSale));
  set('smpTotalFee',   yen(totalFee));
  set('smpTotalShip',  yen(totalShip));
  set('smpTotalPur',   yen(totalPur));
  set('smpTotalProfit', (profit >= 0 ? '+' : '') + yen(profit), profit >= 0 ? '#166534' : '#dc2626');
  set('smpSaleCount',  s.length + '件');
  set('smpPurCount',   p.length + '件');
  set('smpAllCount', '全データ：売上 ' + sales().length + '件 / 仕入 ' + purchases().length + '件');
  const missing = smpShipMissingCount(s);
  const warnEl = document.getElementById('smpShipWarn');
  if (warnEl) {
    if (missing > 0) { warnEl.style.display = 'block'; warnEl.textContent = '⚠️ 送料が入っていない売上が ' + missing + ' 件あります（匿名配送は除く）'; }
    else { warnEl.style.display = 'none'; }
  }
  smpRenderRecent();
}

/* 送料が入っていない売上か（匿名配送・配送一致・手入力済みは除く）— フル画面の shipOk と同基準 */
function smpNeedsShip(r) {
  if (num(r.ship || r.shipping || 0) > 0) return false;
  const ms = String(r.matchStatus || '');
  if (ms === '手入力' || ms === '匿名配送' || ms === '配送CSV一致' || ms === '配送一致') return false;
  if (String(r.memo || '').includes('匿名')) return false;
  return true;
}

/* 送料未入力の件数（匿名配送除く） */
function smpShipMissingCount(list) {
  return (list || []).filter(smpNeedsShip).length;
}

/* 最近の取引（タップでアカウント修正・削除／送料未入力を警告） */
const SMP_ACCS = ['ヤフオク1','ヤフオク2','ヤフオク3','ヤフオク4','ヤフオク5','ヤフオク6','ヤフオク7','ヤフオク8','メルカリ','メルカリShops','ラクマ','その他'];
function smpEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[m]));
}
function smpJs(s) { return "'" + String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'"; }
function smpSaleId(r) { return String(r.id || r.itemId || ''); }

const _smpUnlocked = new Set(); // 送料ロックを解除した売上id

/* 売上1行のHTML（最近の取引・一覧で共通） */
function smpSaleRowHtml(r) {
  const id = smpSaleId(r);
  const known = SMP_ACCS.indexOf(r.shop || '') >= 0;
  const opts = SMP_ACCS.map(a => `<option value="${a}"${r.shop === a ? ' selected' : ''}>${a}</option>`).join('')
    + (known ? '' : `<option value="${smpEsc(r.shop || '')}" selected>${smpEsc(r.shop || '(未設定)')}</option>`);
  const needs = smpNeedsShip(r);
  const warn = needs ? '<span class="smp-ship-warn">⚠️送料未入力</span>' : '';
  const ship = num(r.ship || r.shipping || 0);
  const editable = needs || _smpUnlocked.has(id);
  let shipCtrl;
  if (editable) {
    shipCtrl = '<input class="smp-ship-input" type="number" inputmode="numeric" placeholder="送料¥" value="' + (ship > 0 ? ship : '') + '" onchange="smpSetShip(' + smpJs(id) + ', this.value)">';
  } else {
    shipCtrl = '<span class="smp-ship-locked">送料 ' + yen(ship) + ' 🔒</span>' +
      '<button class="smp-ship-unlock" onclick="smpUnlockShip(' + smpJs(id) + ')">解除</button>';
  }
  return '<div class="smp-recent-row' + (needs ? ' smp-need-ship' : '') + '">' +
    '<div class="smp-recent-info"><div class="smp-recent-name">' + smpEsc(r.name || '(無題)') + warn + '</div>' +
    '<div class="smp-recent-sub">' + (r.date || '') + ' / ' + yen(r.amount || r.price || 0) + '</div></div>' +
    '<div class="smp-recent-ctrls">' +
    '<select class="smp-recent-acc" onchange="smpFixSaleAccount(' + smpJs(id) + ', this.value)">' + opts + '</select>' +
    shipCtrl +
    '<button class="smp-recent-del" onclick="smpDeleteSale(' + smpJs(id) + ')">🗑</button>' +
    '</div></div>';
}

/* 入力済み送料のロック解除（編集可能にする） */
function smpUnlockShip(id) {
  _smpUnlocked.add(String(id));
  smpRenderRecent();
  smpRenderList();
}

/* 送料を入力・変更（利益も再計算、取込ストアにも反映） */
function smpSetShip(id, val) {
  const a = sales();
  const i = smpSaleIndexById(id);
  if (i < 0) return;
  const v = num(val);
  a[i].shipping = v;
  a[i].ship = v;
  const amount = num(a[i].amount || a[i].price);
  const fee = num(a[i].fee);
  a[i].profit = amount - fee - v;
  if (v > 0 && !a[i].matchStatus) a[i].matchStatus = '手入力';
  setLS(LS.sales, a);
  smpSyncYahooShip(a[i], v, a[i].profit);
  _smpUnlocked.delete(String(id));
  smpAfterRecordChange();
}

function smpSyncYahooShip(rec, ship, profit) {
  try {
    const key = 'ribre_yahoo_sales240';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const match = r => (rec.id && r.id === rec.id) || (rec.itemId && r.itemId === rec.itemId);
    arr.forEach(r => { if (match(r)) { r.shipping = ship; r.ship = ship; r.profit = profit; } });
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {}
}

function smpRenderRecent() {
  const box = document.getElementById('smpRecentList');
  if (!box) return;
  const s = sales().slice(0, 20);
  if (!s.length) { box.innerHTML = '<div style="font-size:12px;color:#94a3b8">まだ売上がありません</div>'; return; }
  box.innerHTML = s.map(smpSaleRowHtml).join('');
}

/* ribre_yahoo_sales240 側も同期（取込データの一貫性維持） */
function smpSyncYahoo(rec, shop, mode) {
  try {
    const key = 'ribre_yahoo_sales240';
    const arr = JSON.parse(localStorage.getItem(key) || '[]');
    const match = r => (rec.id && r.id === rec.id) || (rec.itemId && r.itemId === rec.itemId);
    if (mode === 'delete') {
      localStorage.setItem(key, JSON.stringify(arr.filter(r => !match(r))));
    } else {
      arr.forEach(r => { if (match(r)) r.shop = shop; });
      localStorage.setItem(key, JSON.stringify(arr));
    }
  } catch (e) {}
}

function smpSaleIndexById(id) {
  const a = sales();
  for (let i = 0; i < a.length; i++) { if (smpSaleId(a[i]) === String(id)) return i; }
  return -1;
}
function smpPurIndexById(id) {
  const a = purchases();
  for (let i = 0; i < a.length; i++) { if (String(a[i].id || '') === String(id)) return i; }
  return -1;
}

function smpAfterRecordChange() {
  smpRenderRecent();
  smpRenderList();
  smpRenderHome();
}

function smpFixSaleAccount(id, shop) {
  const a = sales();
  const i = smpSaleIndexById(id);
  if (i < 0) return;
  const rec = a[i];
  a[i].shop = shop;
  setLS(LS.sales, a);
  smpSyncYahoo(rec, shop, 'edit');
  smpAfterRecordChange();
}

function smpDeleteSale(id) {
  const a = sales();
  const i = smpSaleIndexById(id);
  if (i < 0) return;
  if (!confirm('この売上を削除しますか？')) return;
  const rec = a[i];
  a.splice(i, 1);
  setLS(LS.sales, a);
  smpSyncYahoo(rec, null, 'delete');
  smpAfterRecordChange();
}

function smpDeletePurchase(id) {
  const a = purchases();
  const i = smpPurIndexById(id);
  if (i < 0) return;
  if (!confirm('この仕入を削除しますか？')) return;
  a.splice(i, 1);
  setLS(LS.purchases, a);
  smpAfterRecordChange();
}

/* ===== 売上／仕入 一覧 ===== */
let _smpListKind = 'sale';
function smpListToggle(kind) {
  _smpListKind = kind;
  const sb = document.getElementById('smpListSaleBtn'), pb = document.getElementById('smpListPurBtn');
  if (sb) sb.classList.toggle('smp-choice-active', kind === 'sale');
  if (pb) pb.classList.toggle('smp-choice-active', kind === 'purchase');
  const fw = document.getElementById('smpListShipFilterWrap'); if (fw) fw.style.display = kind === 'sale' ? 'flex' : 'none';
  const aw = document.getElementById('smpListAccWrap'); if (aw) aw.style.display = kind === 'sale' ? 'block' : 'none';
  const mw = document.getElementById('smpListMonthWrap'); if (mw) mw.style.display = kind === 'sale' ? 'block' : 'none';
  const cb = document.getElementById('smpListCsvBtn'); if (cb) cb.style.display = kind === 'sale' ? 'block' : 'none';
  const t = document.getElementById('smpListTitle'); if (t) t.textContent = kind === 'sale' ? '📋 売上一覧' : '🧾 仕入一覧';
  if (kind === 'sale') smpListBuildMonths();
  smpRenderList();
}
function smpOpenList(kind, shipOnly) {
  _smpListKind = kind;
  const so = document.getElementById('smpListShipOnly'); if (so) so.checked = !!shipOnly;
  simpleTab('list');
  smpListToggle(kind);
}
function smpRenderList() {
  const box = document.getElementById('smpListBox');
  if (!box) return;
  const countEl = document.getElementById('smpListCount');
  if (_smpListKind === 'purchase') {
    const arr = purchases();
    if (countEl) countEl.textContent = arr.length + '件';
    if (!arr.length) { box.innerHTML = '<div style="font-size:12px;color:#94a3b8">まだ仕入がありません</div>'; return; }
    box.innerHTML = arr.map(r => {
      const id = String(r.id || '');
      return '<div class="smp-recent-row"><div class="smp-recent-info">' +
        '<div class="smp-recent-name">' + smpEsc(r.name || '(無題)') + '</div>' +
        '<div class="smp-recent-sub">' + (r.date || '') + ' / ' + smpEsc(r.vendor || '') + ' / ' + yen(r.total || r.amount || 0) + '</div></div>' +
        '<button class="smp-recent-del" onclick="smpDeletePurchase(' + smpJs(id) + ')">🗑</button></div>';
    }).join('');
    return;
  }
  let arr = sales();
  const so = document.getElementById('smpListShipOnly');
  if (so && so.checked) arr = arr.filter(smpNeedsShip);
  const accFilter = (document.getElementById('smpListAccFilter') || {}).value || 'all';
  if (accFilter !== 'all') arr = arr.filter(r => (r.shop || '') === accFilter);
  const monFilter = (document.getElementById('smpListMonth') || {}).value || 'all';
  if (monFilter !== 'all') arr = arr.filter(r => (r.month || String(r.date || '').slice(0, 7)) === monFilter);
  arr = smpSortByAccount(arr);
  if (countEl) countEl.textContent = arr.length + '件';
  if (!arr.length) { box.innerHTML = '<div style="font-size:12px;color:#94a3b8">該当する売上はありません</div>'; return; }
  if (accFilter !== 'all') {
    box.innerHTML = arr.map(smpSaleRowHtml).join('');
    return;
  }
  // すべて：アカウント順にまとめて見出し付きで表示
  let html = '', lastShop = null;
  arr.forEach(r => {
    const shop = r.shop || '(未設定)';
    if (shop !== lastShop) {
      const grp = arr.filter(x => (x.shop || '(未設定)') === shop);
      const sub = grp.reduce((s, x) => s + num(x.amount || x.price), 0);
      html += '<div class="smp-acc-group">' + smpEsc(shop) + '<span class="smp-acc-count">' + grp.length + '件・' + yen(sub) + '</span></div>';
      lastShop = shop;
    }
    html += smpSaleRowHtml(r);
  });
  box.innerHTML = html;
}

/* アカウント順（ヤフオク1〜8→メルカリ等）で並べ替え。同一内は日付の新しい順 */
function smpAccRank(shop) {
  const i = SMP_ACCS.indexOf(shop || '');
  return i < 0 ? 999 : i;
}
function smpSortByAccount(arr) {
  return arr.slice().sort((a, b) => {
    const ra = smpAccRank(a.shop), rb = smpAccRank(b.shop);
    if (ra !== rb) return ra - rb;
    return String(b.date || '').localeCompare(String(a.date || ''));
  });
}

/* 年月セレクタを売上データの月で構築 */
function smpListBuildMonths() {
  const sel = document.getElementById('smpListMonth');
  if (!sel) return;
  const prev = sel.value;
  const set = {};
  sales().forEach(r => { const m = r.month || String(r.date || '').slice(0, 7); if (m) set[m] = 1; });
  const months = Object.keys(set).sort().reverse();
  sel.innerHTML = '<option value="all">すべての月</option>' +
    months.map(m => { const p = m.split('-'); return '<option value="' + m + '">' + p[0] + '年' + (+p[1]) + '月</option>'; }).join('');
  if (prev && Array.prototype.some.call(sel.options, o => o.value === prev)) sel.value = prev; else sel.value = 'all';
}

/* 売上をCSVでダウンロード（選択中のアカウント・年月の範囲、アカウント順） */
function smpDownloadSalesCsv() {
  let arr = sales();
  const acc = (document.getElementById('smpListAccFilter') || {}).value || 'all';
  const mon = (document.getElementById('smpListMonth') || {}).value || 'all';
  if (acc !== 'all') arr = arr.filter(r => (r.shop || '') === acc);
  if (mon !== 'all') arr = arr.filter(r => (r.month || String(r.date || '').slice(0, 7)) === mon);
  arr = smpSortByAccount(arr);
  const rows = [['日付', '月', '取込元', '商品名', '金額', '手数料', '送料', '利益', '商品ID', 'メモ']];
  arr.forEach(r => {
    const amt = num(r.amount || r.price), fee = num(r.fee), ship = num(r.ship || r.shipping);
    const profit = (r.profit !== undefined && r.profit !== '') ? num(r.profit) : (amt - fee - ship);
    rows.push([r.date || '', r.month || String(r.date || '').slice(0, 7), r.shop || '', r.name || '', amt, fee, ship, profit, r.itemId || r.id || '', r.memo || '']);
  });
  if (rows.length <= 1) { alert('該当する売上データがありません'); return; }
  const part = (acc !== 'all' ? acc : '全アカウント') + '_' + (mon !== 'all' ? mon : '全期間');
  if (typeof csvDownload === 'function') csvDownload(rows, '売上_' + part + '.csv');
}

/* データが存在する月の一覧 */
function smpDataMonths() {
  const set = {};
  const add = r => { const m = r.month || String(r.date || '').slice(0, 7); if (m) set[m] = 1; };
  sales().forEach(add);
  purchases().forEach(add);
  return Object.keys(set);
}

function smpInitMonthOptions() {
  const sel = document.getElementById('smpSummaryMonth');
  if (!sel) return;
  const cur = today().slice(0, 7);
  const prev = sel.value;
  const monthsSet = {};
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    monthsSet[d.toISOString().slice(0, 7)] = 1;
  }
  smpDataMonths().forEach(m => { monthsSet[m] = 1; });
  const months = Object.keys(monthsSet).sort().reverse();
  sel.innerHTML = '<option value="all">全期間</option>' + months.map(m => `<option value="${m}">${m}</option>`).join('');
  // 選択：前回値を維持／無ければ今月（データあれば）→最新データ月→全期間
  let want = prev;
  if (!want) {
    const dm = smpDataMonths().sort().reverse();
    if (dm.indexOf(cur) >= 0) want = cur;
    else if (dm.length) want = dm[0];
    else want = cur;
  }
  if (!Array.prototype.some.call(sel.options, o => o.value === want)) want = 'all';
  sel.value = want;
}

/* ---- ユーティリティ ---- */
/* タブに完了チェック✓を付ける */
function smpMarkDone(tab) {
  const btn = document.querySelector('.smp-tab-btn[data-tab="' + tab + '"]');
  if (btn) btn.classList.add('smp-tab-done');
}

function smpSetStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'smp-status smp-status-' + (type || 'info');
}

/* ---- 3ヶ月グラフ ---- */
function simpleRenderChart(canvasId, labelsId) {
  canvasId = canvasId || 'smpChart';
  labelsId = labelsId || 'smpChartLabels';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // 直近3ヶ月のデータを取得
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }

  const allSales = sales();
  const allPur   = purchases();

  const data = months.map(m => {
    const s = allSales.filter(r => (r.month || String(r.date||'').slice(0,7)) === m);
    const p = allPur.filter(r   => (r.month || String(r.date||'').slice(0,7)) === m);
    const sale   = s.reduce((a, r) => a + num(r.amount || r.price), 0);
    const fee    = s.reduce((a, r) => a + num(r.fee), 0);
    const ship   = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
    const pur    = p.reduce((a, r) => a + num(r.total || r.amount), 0);
    const profit = sale - fee - ship - pur;
    return { month: m, sale, pur, profit };
  });

  // ラベル更新
  const labelEl = document.getElementById(labelsId);
  if (labelEl) labelEl.innerHTML = months.map(m => `<span>${m.slice(5)}月</span>`).join('');

  // Canvas描画
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 300;
  const H   = 160;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(1, ...data.map(d => Math.max(d.sale, d.pur, Math.abs(d.profit))));
  const padL = 8, padR = 8, padT = 10, padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const groupW = chartW / 3;
  const barW   = Math.min(groupW * 0.22, 20);
  const gap    = barW * 0.6;

  // ゼロライン
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  ctx.lineTo(W - padR, padT + chartH);
  ctx.stroke();

  // グリッド（上半分）
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 0.5;
  [0.5].forEach(ratio => {
    const y = padT + chartH * (1 - ratio);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  });

  data.forEach((d, i) => {
    const cx = padL + groupW * i + groupW / 2;

    const drawBar = (val, color, offsetX) => {
      const bh = Math.max(2, Math.abs(val) / maxVal * chartH * 0.88);
      const x  = cx + offsetX - barW / 2;
      const y  = val >= 0 ? padT + chartH - bh : padT + chartH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, bh, [3, 3, 0, 0]) : ctx.rect(x, y, barW, bh);
      ctx.fill();
    };

    drawBar(d.sale,   '#2563eb', -(barW + gap));
    drawBar(d.pur,    '#f59e0b', 0);
    drawBar(d.profit, d.profit >= 0 ? '#16a34a' : '#dc2626', barW + gap);

    // 利益の数字
    const profitLabel = d.profit >= 0
      ? '+' + Math.round(d.profit / 1000) + 'k'
      : Math.round(d.profit / 1000) + 'k';
    ctx.fillStyle = d.profit >= 0 ? '#166534' : '#dc2626';
    ctx.font = `bold ${Math.min(10, barW + 2)}px system-ui`;
    ctx.textAlign = 'center';
    const profBH = Math.max(2, Math.abs(d.profit) / maxVal * chartH * 0.88);
    const profY  = d.profit >= 0 ? padT + chartH - profBH - 3 : padT + chartH + 12;
    ctx.fillText(profitLabel, cx + barW + gap, profY);
  });
}

function smpClearOcr() {
  ['smpOcrDate','smpOcrVendor','smpOcrItem','smpOcrAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fi = document.getElementById('smpOcrFileInput');
  if (fi) fi.value = '';
  const pa = document.getElementById('smpOcrPreviewArea');
  if (pa) pa.style.display = 'none';
  const pi = document.getElementById('smpOcrPreviewImg');
  if (pi) pi.src = '';
  smpSetStatus('smpOcrStatus', '画像を選ぶとAIが自動で読み取ります', 'info');
  document.getElementById('smpOcrFileName').textContent = '';
}

/* ファイル選択時のイベントを一括バインド */
function smpBindFileLabels() {
  // CSV・配送はファイル名表示のみ
  [
    ['smpCsvFile',  'smpCsvFileName'],
    ['smpShipFile', 'smpShipFileName'],
  ].forEach(([inputId, labelId]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input && label) {
      input.addEventListener('change', () => {
        label.textContent = input.files[0] ? input.files[0].name : '';
      });
    }
  });

}

/* 取り込み画面で画像を貼り付け（キャプチャ）対応 */
function smpInboxBindPaste() {
  window.addEventListener('paste', function(e) {
    if (!document.body.classList.contains('simple-mode')) return;
    const inbox = document.querySelector('.smp-screen[data-screen="inbox"]');
    if (!inbox || !inbox.classList.contains('smp-screen-active')) return;
    const items = (e.clipboardData && e.clipboardData.items) ? e.clipboardData.items : [];
    const imgs = [];
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (it && it.kind === 'file' && String(it.type || '').startsWith('image/')) {
        const raw = it.getAsFile();
        if (!raw) continue;
        const ext = String(raw.type || 'image/png').split('/')[1] || 'png';
        imgs.push(new File([raw], 'capture' + (i + 1) + '.' + ext, { type: raw.type || 'image/png' }));
      }
    }
    if (imgs.length) { e.preventDefault(); smpInboxAddFiles(imgs); }
  });
}

window.addEventListener('load', function() {
  smpInitMonthOptions();
  smpBindFileLabels();
  smpInboxBindPaste();
  var oauth = false;
  try { oauth = smpHandleOAuthRedirect(); } catch (e) {}
  try {
    if (oauth || localStorage.getItem('ribre_simple_mode') === '1') {
      document.body.classList.add('simple-mode');
      simpleTab('home');
    }
  } catch(e) {}
  try { smpRenderAuth(); } catch (e) {}
});
