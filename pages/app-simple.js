/* かんたんモード Ver61.0 — 既存関数を使ったガイド付きワークフロー */

function simpleToggle() {
  // フル画面は廃止。常にかんたんモードを維持する（OFFにはしない）。
  document.body.classList.add('simple-mode');
  try { localStorage.setItem('ribre_simple_mode', '1'); } catch(e) {}
  simpleTab('home');
}

function simpleTab(tab) {
  document.body.classList.toggle('smp-summary-wide', tab === 'summary' || tab === 'profit');
  document.querySelectorAll('.smp-tab-btn').forEach(b => b.classList.toggle('smp-tab-active', b.dataset.tab === tab));
  document.querySelectorAll('.smp-nav-item').forEach(b => b.classList.toggle('smp-nav-active', b.dataset.nav === tab));
  document.querySelectorAll('.smp-screen').forEach(s => s.classList.toggle('smp-screen-active', s.dataset.screen === tab));
  if (tab === 'home') { smpRenderAuth(); smpRenderHome(); try { smpProfitMeiPullCloud().then(function (u) { if (u) smpRenderHome(); }); } catch (e) {} try { smpProfitProvPullCloud().then(function (u) { if (u) smpRenderHome(); }); } catch (e) {} try { smpGoalsPullCloud().then(function (u) { if (u) smpRenderGoals(); }); } catch (e) {} }
  if (tab === 'inbox') smpInitInboxMonth();
  if (tab === 'summary') smpSummaryEnter();
  if (tab === 'profit') {
    simpleRenderProfitTable();
    var _pst = document.getElementById('smpProfitSyncStatus');
    var _pcr = (typeof smpProfitMeiCreds === 'function') ? smpProfitMeiCreds() : null;
    if (_pst) _pst.textContent = _pcr ? ('ログイン中: ' + _pcr.em + '（🔄で最新取得）') : '⚠️ 未ログイン（同期にはログインが必要）';
    try { smpProfitMeiPullCloud().then(function (u) { if (u) { simpleRenderProfitTable(); if (_pst && _pcr) _pst.textContent = '✅ 最新を取得しました（' + _pcr.em + '）'; } }); } catch (e) {}
    try { smpProfitProvPullCloud().then(function (u) { if (u) simpleRenderProfitTable(); }); } catch (e) {}
    try { smpRenderLockUI(); } catch (e) {}
    try { smpLockedPullCloud().then(function (u) { if (u) smpRenderLockUI(); }); } catch (e) {}
  }
  if (tab === 'manual') smpManualInit();
  if (tab === 'list') smpRenderList();
  const c = document.querySelector('.smp-content'); if (c) c.scrollTop = 0;
}

/* 日付/月の入力欄はどこを押してもカレンダーを開く（右端のアイコンが遠い対策） */
(function () {
  if (window.__ribreDatePicker) return;
  window.__ribreDatePicker = true;
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (t && t.tagName === 'INPUT' && (t.type === 'date' || t.type === 'month')) {
      try { t.showPicker(); } catch (e) {}
    }
  }, true);
})();

/* ブラウザの「戻る」でアプリが閉じる/ログイン前に戻るのを防ぐ（戻る＝ホームへ） */
(function () {
  if (window.__ribreBackGuard) return;
  window.__ribreBackGuard = true;
  function push() { try { history.pushState({ ribre: 1 }, '', location.href); } catch (e) {} }
  window.addEventListener('load', function () { setTimeout(push, 300); });
  window.addEventListener('popstate', function () {
    push();
    try { if (typeof simpleTab === 'function') simpleTab('home'); } catch (e) {}
  });
})();

/* ホーム画面：今月（無ければ最新データ月）のKPI＋3ヶ月グラフ */
function smpMonthLabel(month) {
  const p = String(month || '').split('-');
  return p.length === 2 ? p[0] + '年' + Number(p[1]) + '月' : '今月';
}
function smpMonthFirstDay(month) {
  return /^\d{4}-\d{2}$/.test(String(month || '')) ? month + '-01' : today();
}
function smpBuildMonthChoices() {
  const set = {};
  const cur = today().slice(0, 7);
  for (let i = 0; i < 12; i++) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    set[d.toISOString().slice(0, 7)] = 1;
  }
  smpDataMonths().forEach(m => { set[m] = 1; });
  set[cur] = 1;
  return Object.keys(set).sort().reverse();
}
function smpSelectedMonth() {
  const saved = localStorage.getItem('ribre_smp_selected_month') || '';
  const choices = smpBuildMonthChoices();
  if (saved && choices.indexOf(saved) >= 0) return saved;
  const cur = today().slice(0, 7);
  if (choices.indexOf(cur) >= 0) return cur;
  return choices[0] || cur;
}
function smpSyncMonthControls(month) {
  const choices = smpBuildMonthChoices();
  const html = choices.map(m => '<option value="' + m + '">' + smpMonthLabel(m) + '</option>').join('');
  ['smpHomeMonthSelect'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = html;
    el.value = month;
  });
  const inbox = document.getElementById('smpInboxMonth');
  if (inbox && !inbox.value) inbox.value = month;
}
function smpSetHomeMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return;
  localStorage.setItem('ribre_smp_selected_month', month);
  window._ribreViewMonth = month;
  smpSyncMonthControls(month);
  smpRenderHome();
  try { refreshAll(); } catch (e) {}
}
function smpSetInboxMonth(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) return;
  localStorage.setItem('ribre_smp_selected_month', month);
  window._ribreViewMonth = month;
  smpSyncMonthControls(month);
  smpRenderHome();
}
function smpInitInboxMonth() {
  const month = smpSelectedMonth();
  const el = document.getElementById('smpInboxMonth');
  if (el) el.value = month;
}
/* ===== 月ロック（入力済みの月をCSV取込から保護） ===== */
function smpLockedMonthsGet() { try { return JSON.parse(localStorage.getItem('ribre_smp_locked_months') || '[]') || []; } catch (e) { return []; } }
function smpLockedTsGet() { return Number(localStorage.getItem('ribre_smp_locked_ts') || 0) || 0; }
function smpLockedTsSet(t) { try { localStorage.setItem('ribre_smp_locked_ts', String(t || Date.now())); } catch (e) {} }
/* 月ごとの最終操作(ロック/解除)時刻。マージで「その月を最後にどちらが触ったか」を判定するのに使う */
function smpLockedMetaGet() { try { return JSON.parse(localStorage.getItem('ribre_smp_locked_meta_v1') || '{}') || {}; } catch (e) { return {}; } }
function smpLockedMetaSet(o) { try { localStorage.setItem('ribre_smp_locked_meta_v1', JSON.stringify(o || {})); } catch (e) {} }
function smpLockedMonthsSet(arr, noPush) {
  arr = (arr || []).filter(function (v, i, a) { return v && a.indexOf(v) === i; }).sort();
  try { localStorage.setItem('ribre_smp_locked_months', JSON.stringify(arr)); } catch (e) {}
  if (!noPush) { smpLockedTsSet(Date.now()); smpLockedPushDebounced(); }
}
function smpIsMonthLocked(m) { return smpLockedMonthsGet().indexOf(m) >= 0; }
function smpToggleLockMonth(m) {
  if (!m) return;
  var arr = smpLockedMonthsGet(); var i = arr.indexOf(m);
  if (i >= 0) arr.splice(i, 1); else arr.push(m);
  var meta = smpLockedMetaGet(); meta[m] = Date.now(); smpLockedMetaSet(meta);
  smpLockedMonthsSet(arr);
  smpRenderLockUI();
}
/* 月ロックのマージ：月ごとの最終操作(ロック/解除)時刻が新しい方を採用する。
   meta の無い月(旧データ)はブロブ全体のtsにフォールバック（過渡期のみ）。 */
function smpLockedMerge(aArr, aMeta, aTs, bArr, bMeta, bTs) {
  var aSet = {}; (aArr || []).forEach(function (m) { aSet[m] = 1; });
  var bSet = {}; (bArr || []).forEach(function (m) { bSet[m] = 1; });
  var months = {};
  Object.keys(aSet).forEach(function (m) { months[m] = 1; });
  Object.keys(bSet).forEach(function (m) { months[m] = 1; });
  Object.keys(aMeta || {}).forEach(function (m) { months[m] = 1; });
  Object.keys(bMeta || {}).forEach(function (m) { months[m] = 1; });
  var outMeta = {}; var outArr = [];
  Object.keys(months).forEach(function (m) {
    var ta = Number((aMeta && aMeta[m]) || (aSet[m] ? aTs : 0)) || 0;
    var tb = Number((bMeta && bMeta[m]) || (bSet[m] ? bTs : 0)) || 0;
    var useA = ta >= tb;
    var locked = useA ? !!aSet[m] : !!bSet[m];
    outMeta[m] = Math.max(ta, tb);
    if (locked) outArr.push(m);
  });
  return { arr: outArr.sort(), meta: outMeta };
}
var _smpLockPushTimer = null;
function smpLockedPushDebounced() { if (_smpLockPushTimer) clearTimeout(_smpLockPushTimer); _smpLockPushTimer = setTimeout(smpLockedPushCloud, 800); }
async function smpLockedFetchCloud(cr) {
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.locked_months&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    var d = await r.json(); var c = d && d[0] && d[0].value;
    return (c && c.data) ? c : null;
  } catch (e) { return null; }
}
async function smpLockedPushCloud() {
  if (window.__ribreSessionLost) return { ok: false };
  var cr = smpProfitMeiCreds(); if (!cr) return { ok: false };
  try {
    var body = { data: smpLockedMonthsGet(), _m: smpLockedMetaGet(), ts: smpLockedTsGet() };
    var cloud = await smpLockedFetchCloud(cr);
    if (cloud) {
      var merged = smpLockedMerge(smpLockedMonthsGet(), smpLockedMetaGet(), smpLockedTsGet(), cloud.data, cloud._m, cloud.ts || 0);
      smpLockedMetaSet(merged.meta);
      try { localStorage.setItem('ribre_smp_locked_months', JSON.stringify(merged.arr)); } catch (e) {}
      body = { data: merged.arr, _m: merged.meta, ts: Date.now() };
    }
    smpLockedTsSet(body.ts);
    var r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', { method: 'POST', headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_email: cr.em, skey: 'locked_months', value: body }]) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false }; }
}
async function smpLockedPullCloud() {
  var cr = smpProfitMeiCreds(); if (!cr) return false;
  var cloud = await smpLockedFetchCloud(cr);
  if (!cloud) return false;
  var merged = smpLockedMerge(smpLockedMonthsGet(), smpLockedMetaGet(), smpLockedTsGet(), cloud.data, cloud._m, cloud.ts || 0);
  var before = smpLockedMonthsGet();
  var changed = JSON.stringify(merged.arr) !== JSON.stringify(before);
  try { localStorage.setItem('ribre_smp_locked_months', JSON.stringify(merged.arr)); } catch (e) {}
  smpLockedMetaSet(merged.meta);
  smpLockedTsSet(Math.max(smpLockedTsGet(), Number(cloud.ts || 0)));
  if (JSON.stringify(merged.arr) !== JSON.stringify(cloud.data || [])) smpLockedPushDebounced();
  return changed;
}
function smpLockSnapshotSales() {
  if (!smpLockedMonthsGet().length) return null;
  try { return { s: (sales() || []).slice(), y: JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]') }; } catch (e) { return null; }
}
function smpLockProtectAfterImport(snap) {
  var locked = smpLockedMonthsGet(); if (!locked.length || !snap) return 0;
  var lset = {}; locked.forEach(function (m) { lset[m] = 1; });
  var mof = function (r) { return r.month || String(r.date || r.sale_date || '').slice(0, 7); };
  var reverted = 0;
  [['ribre_full_sales221', snap.s], ['ribre_yahoo_sales240', snap.y]].forEach(function (pair, i) {
    var key = pair[0], pre = pair[1] || [];
    var cur = []; try { cur = JSON.parse(localStorage.getItem(key) || '[]') || []; } catch (e) {}
    var kept = cur.filter(function (r) { return !lset[mof(r)]; });        // 取込後・ロック外
    var preLocked = pre.filter(function (r) { return lset[mof(r)]; });    // 取込前・ロック月
    // 実際に取込で“増えた”ロック月の件数だけカウント（既存のロック月データは誤カウントしない）
    if (i === 0) reverted += Math.max(0, (cur.length - kept.length) - preLocked.length);
    try { setLS(key, kept.concat(preLocked)); } catch (e) {}
  });
  try { refreshAll(); } catch (e) {}
  return reverted;
}
function smpRenderLockUI() {
  var sel = document.getElementById('smpLockMonth');
  if (sel) {
    var cur = sel.value;
    var choices = (typeof smpBuildMonthChoices === 'function') ? smpBuildMonthChoices() : [today().slice(0, 7)];
    sel.innerHTML = choices.map(function (m) { return '<option value="' + m + '">' + smpMonthLabel(m) + (smpIsMonthLocked(m) ? ' 🔒' : '') + '</option>'; }).join('');
    if (cur) sel.value = cur;
  }
  var box = document.getElementById('smpLockedList');
  if (box) {
    var arr = smpLockedMonthsGet();
    box.innerHTML = arr.length ? ('ロック中：' + arr.map(function (m) { return '<span style="display:inline-block;background:#fee2e2;color:#b91c1c;border-radius:6px;padding:2px 8px;margin:2px;cursor:pointer" onclick="smpToggleLockMonth(\'' + m + '\')" title="クリックで解除">🔒 ' + smpMonthLabel(m) + ' ✕</span>'; }).join('')) : 'ロック中の月はありません';
  }
}
function smpToggleLockSelected() {
  var sel = document.getElementById('smpLockMonth'); if (!sel || !sel.value) return;
  smpToggleLockMonth(sel.value);
}

/* ===== 全データのバックアップ／復元（EC＋明細＋仮入力＋登録先＋ロック） ===== */
function smpFullBackup() {
  var pick = function (k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  var data = {
    _type: 'ribre_full_backup_v1', createdAt: new Date().toISOString(),
    sales: pick('ribre_full_sales221'), yahooSales: pick('ribre_yahoo_sales240'), purchases: pick('ribre_full_purchases221'),
    meisai: pick('ribre_smp_profit_meisai_v1'), prov: pick('ribre_smp_profit_prov_v1'),
    partners: pick('ribre_smp_partners_v1'), lockedMonths: pick('ribre_smp_locked_months')
  };
  try {
    var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = 'ribre_full_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    var st = document.getElementById('smpFullBkStatus'); if (st) st.textContent = '✅ 全データをダウンロードしました（売上' + ((data.sales || []).length) + '／仕入' + ((data.purchases || []).length) + '／売上明細' + ((data.meisai && data.meisai.sales || []).length) + '／仕入明細' + ((data.meisai && data.meisai.purchases || []).length) + '）';
  } catch (e) { alert('バックアップに失敗: ' + e.message); }
}
function smpFullRestore(input) {
  var f = input && input.files && input.files[0]; if (!f) return;
  var st = document.getElementById('smpFullBkStatus');
  if (!confirm('全データ（EC売上・仕入・粗利明細・仮入力・登録先・ロック）を復元します。今の内容は置き換わります。よろしいですか？')) { input.value = ''; return; }
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var d = JSON.parse(rd.result);
      var put = function (k, v) { if (v != null) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
      if (d.sales) put('ribre_full_sales221', d.sales);
      put('ribre_yahoo_sales240', d.yahooSales || d.sales);
      if (d.purchases) put('ribre_full_purchases221', d.purchases);
      if (d.meisai) put('ribre_smp_profit_meisai_v1', d.meisai);
      if (d.prov) put('ribre_smp_profit_prov_v1', d.prov);
      if (d.partners) put('ribre_smp_partners_v1', d.partners);
      if (d.lockedMonths) put('ribre_smp_locked_months', d.lockedMonths);
      try { refreshAll(); } catch (e) {}
      try { smpRenderHome(); } catch (e) {}
      var li = (typeof email === 'function' && email());
      if (li && window.ribreStore && window.ribreStore.replaceCloudWithLocal) {
        if (st) st.textContent = '復元中…クラウドを置き換えています';
        window.ribreStore.replaceCloudWithLocal().then(function () {
          try { smpProfitMeiPushCloud(); } catch (e) {}
          try { smpProfitProvPushCloud(); } catch (e) {}
          try { smpLockedPushCloud(); } catch (e) {}
          if (st) st.textContent = '✅ 全データ復元＆クラウド反映完了。他端末は「☁ クラウドから最新を取得」＋粗利タブ「🔄 同期」';
          alert('全データを復元し、クラウドにも反映しました。\n他の端末では「☁ クラウドから最新を取得」と、粗利タブの「🔄 他の端末と同期」を押してください。');
        });
      } else {
        if (st) st.textContent = '✅ 復元しました（未ログイン：この端末のみ）';
        alert('復元しました（未ログインのためこの端末のみ。ログインすると同期されます）。');
      }
    } catch (e) { if (st) st.textContent = '⚠️ 復元失敗: ' + e.message; alert('復元に失敗: ' + e.message); }
    input.value = '';
  };
  rd.readAsText(f);
}

function smpFreeSpace() {
  var sizeOf = function (k) { try { var v = localStorage.getItem(k); return v ? v.length : 0; } catch (e) { return 0; } };
  var killKeys = ['ribre_auto_snapshots_v1', 'ribre_prod_sales460', 'ribre_prod_purchases460', 'ribre_realtime_logs460', 'ribre_ocr_candidates200', 'ribre_shipping_results230'];
  var freed = 0, removed = 0;
  killKeys.forEach(function (k) { var s = sizeOf(k); if (s > 0) { freed += s; removed++; try { localStorage.removeItem(k); } catch (e) {} } });
  var mb = (freed / 1024 / 1024).toFixed(2);
  var st = document.getElementById('smpFreeStatus'); if (st) st.textContent = '✅ 約 ' + mb + ' MB 空けました（不要データ ' + removed + ' 種類を削除）。もう一度取り込み・照合をお試しください';
  try { alert('不要データを削除して約 ' + mb + ' MB の空きを作りました。\n（自動バックアップ履歴・過去の生コピー・ログ・OCR一時などを削除。売上・仕入・明細・仮入力・登録先・設定は残しています）\n\nもう一度、取り込みや照合をお試しください。'); } catch (e) {}
}
async function smpReloadFromCloud() {
  var st = document.getElementById('smpReloadStatus');
  var setSt = function (m) { if (st) st.textContent = m; };
  if (!(typeof email === 'function' && email())) { setSt('⚠️ 先にログインしてください'); alert('先に Google（ribre2016@gmail.com）でログインしてください'); return; }
  if (!(window.ribreStore && window.ribreStore.hydrate)) { alert('この機能は使えません'); return; }
  setSt('クラウドから取得中…');
  try {
    var r = await window.ribreStore.hydrate();
    try { refreshAll(); } catch (e) {}
    try { smpRenderHome(); } catch (e) {}
    var s = (r && r.sales != null) ? r.sales : '?';
    var p = (r && r.purchases != null) ? r.purchases : '?';
    setSt('✅ クラウドから取得：売上 ' + s + '件 / 仕入 ' + p + '件');
    alert('クラウドの最新に揃えました。\n売上 ' + s + '件 / 仕入 ' + p + '件');
  } catch (e) { setSt('⚠️ 取得に失敗しました'); alert('取得に失敗しました: ' + (e && e.message)); }
}
/* ===== 汎用: キー付きマス（月など）のマージ =====
   value = { キー: 値, ..., _m: { キー: 更新時刻 } }。同じキーは新しい方を採用、
   _m の無いキー（旧データ）はブロブ全体のts(aTs/bTs)にフォールバック。
   片方にしか無いキーは必ず残す。180日より古い_mは破棄。
   仮入力(smpProvMerge)は月×チャネルの2階層なので専用実装のまま残すが、
   目標(goals)・月ロック(locked_months)の月1階層マップはこれを共有する。 */
function smpFlatMerge(a, aTs, b, bTs) {
  a = a || {}; b = b || {};
  var am = (a._m && typeof a._m === 'object') ? a._m : {};
  var bm = (b._m && typeof b._m === 'object') ? b._m : {};
  var keys = {};
  Object.keys(a).forEach(function (k) { if (k !== '_m') keys[k] = 1; });
  Object.keys(b).forEach(function (k) { if (k !== '_m') keys[k] = 1; });
  Object.keys(am).forEach(function (k) { keys[k] = 1; });
  Object.keys(bm).forEach(function (k) { keys[k] = 1; });
  var out = { _m: {} };
  Object.keys(keys).forEach(function (k) {
    var hasA = a[k] != null, hasB = b[k] != null;
    var ta = Number(am[k] || (hasA ? (aTs || 0) : 0)) || 0;
    var tb = Number(bm[k] || (hasB ? (bTs || 0) : 0)) || 0;
    var useA = ta >= tb;
    var val = useA ? (hasA ? a[k] : undefined) : (hasB ? b[k] : undefined);
    out._m[k] = Math.max(ta, tb);
    if (val !== undefined) out[k] = val;
  });
  var lim = Date.now() - 180 * 24 * 3600 * 1000;
  Object.keys(out._m).forEach(function (k) { if (out._m[k] < lim && out[k] == null) delete out._m[k]; });
  return out;
}
/* ===== 目標（年度／月ごと・あと何個で達成） ===== */
var _smpGoalMode = 'year';
var _smpGoalCtx = { curSale: 0, curProf: 0 };
function smpGoalsGet() { try { var o = JSON.parse(localStorage.getItem('ribre_smp_goals_v1') || '{}') || {}; o.mSale = o.mSale || {}; o.mProf = o.mProf || {}; return o; } catch (e) { return { mSale: {}, mProf: {} }; } }
function smpGoalsTsGet() { return Number(localStorage.getItem('ribre_smp_goals_ts') || 0) || 0; }
function smpGoalsTsSet(t) { try { localStorage.setItem('ribre_smp_goals_ts', String(t || Date.now())); } catch (e) {} }
function smpGoalsSet(o, noPush) { try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(o)); } catch (e) {} if (!noPush) { smpGoalsTsSet(Date.now()); smpGoalsPushDebounced(); } }
/* 月ごとの目標(mSale/mProf)はマス単位でマージ。年間目標・単位設定はブロブ全体で新しい方。 */
function smpGoalsMerge(a, aTs, b, bTs) {
  a = a || {}; b = b || {};
  var useA = (aTs || 0) >= (bTs || 0);
  var top = useA ? a : b, other = useA ? b : a;
  var out = {};
  ['yearSale', 'yearProf', 'curSaleUnit', 'curProfUnit'].forEach(function (k) {
    out[k] = (top[k] != null && top[k] !== 0) ? top[k] : other[k];
  });
  out.mSale = smpFlatMerge(a.mSale, aTs, b.mSale, bTs);
  out.mProf = smpFlatMerge(a.mProf, aTs, b.mProf, bTs);
  return out;
}
var _smpGoalsPushTimer = null;
function smpGoalsPushDebounced() { if (_smpGoalsPushTimer) clearTimeout(_smpGoalsPushTimer); _smpGoalsPushTimer = setTimeout(smpGoalsPushCloud, 800); }
async function smpGoalsFetchCloud(cr) {
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.goals&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    var d = await r.json(); var c = d && d[0] && d[0].value;
    return (c && c.data) ? c : null;
  } catch (e) { return null; }
}
async function smpGoalsPushCloud() {
  if (window.__ribreSessionLost) return { ok: false };
  var cr = smpProfitMeiCreds(); if (!cr) return { ok: false };
  try {
    var body = smpGoalsGet();
    var cloud = await smpGoalsFetchCloud(cr);
    if (cloud) {
      body = smpGoalsMerge(smpGoalsGet(), smpGoalsTsGet(), cloud.data, cloud.ts || 0);
      try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(body)); } catch (e) {}
    }
    var now = Date.now();
    smpGoalsTsSet(now);
    var r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', { method: 'POST', headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_email: cr.em, skey: 'goals', value: { data: body, ts: now } }]) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false }; }
}
async function smpGoalsPullCloud() {
  var cr = smpProfitMeiCreds(); if (!cr) return false;
  var cloud = await smpGoalsFetchCloud(cr);
  if (!cloud) return false;
  var local = smpGoalsGet();
  var merged = smpGoalsMerge(local, smpGoalsTsGet(), cloud.data, cloud.ts || 0);
  var changed = JSON.stringify(merged) !== JSON.stringify(local);
  try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(merged)); } catch (e) {}
  smpGoalsTsSet(Math.max(smpGoalsTsGet(), Number(cloud.ts || 0)));
  if (JSON.stringify(merged) !== JSON.stringify(cloud.data)) smpGoalsPushDebounced();
  return changed;
}
function smpGoalCount(m) {
  var c = 0;
  try { c = sales().filter(function (r) { return (r.month || String(r.date || '').slice(0, 7)) === m; }).length; var st = smpProfitMeiGet(); c += (st.sales || []).filter(function (e) { return (e.month || String(e.date || '').slice(0, 7)) === m; }).length; } catch (e) {}
  return c;
}
function smpGoalFiscalStart() { var cur = today().slice(0, 7); var y = parseInt(cur.slice(0, 4), 10), m = parseInt(cur.slice(5, 7), 10); return m >= 3 ? y : y - 1; }
function smpGoalYearTotals() {
  var months = smpProfitFiscalMonths(smpGoalFiscalStart()); var sale = 0, prof = 0;
  months.forEach(function (mo) { var t = smpProfitMonthTotals(mo.key); sale += t.sale; prof += t.profit; });
  return { sale: sale, prof: prof };
}
function smpGoalYearAvgUnit() {
  var cur = today().slice(0, 7); var months = smpProfitFiscalMonths(smpGoalFiscalStart());
  var saleSum = 0, profSum = 0, cnt = 0;
  months.forEach(function (mo) { if (mo.key < cur) { var t = smpProfitMonthTotals(mo.key); saleSum += t.sale; profSum += t.profit; cnt += smpGoalCount(mo.key); } });
  return { su: cnt ? Math.round(saleSum / cnt) : 0, pu: cnt ? Math.round(profSum / cnt) : 0, cnt: cnt };
}
function smpGoalSetMode(mode) { _smpGoalMode = mode; smpRenderGoals(); }
function smpGoalCalc(kind) {
  var isSale = kind === 'sale';
  var cur = isSale ? _smpGoalCtx.curSale : _smpGoalCtx.curProf;
  var t = Math.max(0, num((document.getElementById(isSale ? 'smpGoalSale' : 'smpGoalProf') || {}).value));
  var u = Math.max(1, num((document.getElementById(isSale ? 'smpGoalSaleUnit' : 'smpGoalProfUnit') || {}).value));
  var rem = Math.max(0, t - cur), pct = t > 0 ? Math.min(100, Math.round(cur / t * 100)) : 0, n = rem > 0 ? Math.ceil(rem / u) : 0;
  var pre = isSale ? 'smpGoalSale' : 'smpGoalProf';
  var setT = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
  setT(pre + 'CurTxt', yen(cur)); setT(pre + 'Tgt', yen(t)); setT(pre + 'Pct', pct + '%');
  var bar = document.getElementById(pre + 'Bar'); if (bar) bar.style.width = pct + '%';
  setT(pre + 'Rem', rem > 0 ? ('あと ' + yen(rem)) : '🎉 達成');
  setT(pre + 'N', rem > 0 ? ('＝ 約' + n.toLocaleString('ja-JP') + '個') : '');
}
function smpGoalSave() {
  var g = smpGoalsGet(); var cur = today().slice(0, 7);
  var sT = num((document.getElementById('smpGoalSale') || {}).value), pT = num((document.getElementById('smpGoalProf') || {}).value);
  var sU = num((document.getElementById('smpGoalSaleUnit') || {}).value), pU = num((document.getElementById('smpGoalProfUnit') || {}).value);
  if (_smpGoalMode === 'year') { g.yearSale = sT; g.yearProf = pT; g.curSaleUnit = sU; g.curProfUnit = pU; }
  else {
    var sel = document.getElementById('smpGoalMonth'); var m = (sel && sel.value) || cur;
    g.mSale[m] = sT; g.mProf[m] = pT;
    g.mSale._m = g.mSale._m || {}; g.mSale._m[m] = Date.now();
    g.mProf._m = g.mProf._m || {}; g.mProf._m[m] = Date.now();
    if (m === cur) { g.curSaleUnit = sU; g.curProfUnit = pU; }
  }
  smpGoalsSet(g);
}
function smpGoalOnInput(kind) { smpGoalSave(); smpGoalCalc(kind); }
function smpRenderGoals() {
  var card = document.getElementById('smpGoalCard'); if (!card) return;
  var g = smpGoalsGet(); var cur = today().slice(0, 7);
  var by = document.getElementById('smpGoalBtnYear'), bm = document.getElementById('smpGoalBtnMonth');
  if (by) by.classList.toggle('smp-choice-active', _smpGoalMode === 'year');
  if (bm) bm.classList.toggle('smp-choice-active', _smpGoalMode === 'month');
  var mw = document.getElementById('smpGoalMonthWrap'); if (mw) mw.style.display = _smpGoalMode === 'month' ? 'block' : 'none';
  var msel = document.getElementById('smpGoalMonth');
  if (msel && !msel.options.length) { var ch = (typeof smpBuildMonthChoices === 'function') ? smpBuildMonthChoices() : [cur]; msel.innerHTML = ch.map(function (m) { return '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + smpMonthLabel(m) + (m === cur ? '（当月）' : '') + '</option>'; }).join(''); }
  var curSale, curProf, sT, pT, sU, pU, src;
  if (_smpGoalMode === 'year') {
    var yt = smpGoalYearTotals(); curSale = yt.sale; curProf = yt.prof;
    sT = num(g.yearSale); pT = num(g.yearProf);
    var av = smpGoalYearAvgUnit();
    sU = (g.curSaleUnit != null && g.curSaleUnit !== '') ? num(g.curSaleUnit) : av.su;
    pU = (g.curProfUnit != null && g.curProfUnit !== '') ? num(g.curProfUnit) : av.pu;
    src = '先月までの平均（手入力で調整可）';
  } else {
    var m = (msel && msel.value) || cur; var t = smpProfitMonthTotals(m); curSale = t.sale; curProf = t.profit;
    sT = num((g.mSale || {})[m]); pT = num((g.mProf || {})[m]);
    if (m === cur) { var av2 = smpGoalYearAvgUnit(); sU = (g.curSaleUnit != null && g.curSaleUnit !== '') ? num(g.curSaleUnit) : av2.su; pU = (g.curProfUnit != null && g.curProfUnit !== '') ? num(g.curProfUnit) : av2.pu; src = '当月：手入力'; }
    else { var cnt = smpGoalCount(m); sU = cnt ? Math.round(t.sale / cnt) : 0; pU = cnt ? Math.round(t.profit / cnt) : 0; src = '件数から自動（' + cnt + '件）'; }
  }
  _smpGoalCtx = { curSale: curSale, curProf: curProf };
  var sv = function (id, v) { var el = document.getElementById(id); if (el) el.value = (v || v === 0) ? v : ''; };
  sv('smpGoalSale', sT); sv('smpGoalProf', pT); sv('smpGoalSaleUnit', sU); sv('smpGoalProfUnit', pU);
  var st1 = document.getElementById('smpGoalSaleUnitSrc'); if (st1) st1.textContent = src;
  var st2 = document.getElementById('smpGoalProfUnitSrc'); if (st2) st2.textContent = src;
  smpGoalCalc('sale'); smpGoalCalc('prof');
}
function smpRestoreBackupFile(input) {
  var file = input && input.files && input.files[0];
  if (!file) return;
  var st = document.getElementById('smpRestoreStatus');
  if (!confirm('バックアップの内容でEC売上・仕入を復元します。今の表示は置き換わります。よろしいですか？')) { input.value = ''; return; }
  var rd = new FileReader();
  rd.onload = function () {
    try {
      var data = JSON.parse(rd.result);
      var sCount = 0, pCount = 0;
      if (data.sales) { localStorage.setItem('ribre_full_sales221', JSON.stringify(data.sales)); sCount = data.sales.length; }
      if (data.yahooSales) { localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(data.yahooSales)); }
      else if (data.sales) { localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(data.sales)); }
      if (data.purchases) { localStorage.setItem('ribre_full_purchases221', JSON.stringify(data.purchases)); pCount = data.purchases.length; }
      try { refreshAll(); } catch (e) {}
      try { smpRenderHome(); } catch (e) {}
      var li = (typeof email === 'function' && email());
      if (li && window.ribreStore && window.ribreStore.replaceCloudWithLocal) {
        // クラウドをこのバックアップ内容に完全置き換え（重複・余分を掃除して一致させる）
        if (st) st.textContent = '復元中…クラウドを置き換えています（重複掃除）';
        window.ribreStore.replaceCloudWithLocal().then(function (rr) {
          if (rr && rr.ok) {
            var del = (rr.result && rr.result.sales ? rr.result.sales.del : 0);
            if (st) st.textContent = '✅ 復元＆クラウド置き換え完了（売上 ' + sCount + '件／重複・余分 ' + del + '件を掃除）。他端末は「☁ クラウドから最新を取得」';
            alert('復元しました。\n売上 ' + sCount + '件 / 仕入 ' + pCount + '件\n\nクラウドをこの内容に置き換えました（余分/重複 ' + del + '件を掃除）。\n他の端末では「☁ クラウドから最新を取得」を押してください。');
          } else {
            if (st) st.textContent = '⚠️ クラウド置き換えに失敗（' + (rr && (rr.status || rr.reason || rr.error) || '?') + '）。端末の表示は復元済み';
            alert('端末の表示は復元しましたが、クラウド置き換えに失敗しました。再ログイン後にもう一度お試しください。');
          }
        });
      } else {
        if (st) st.textContent = '✅ 復元しました（売上 ' + sCount + '件 / 仕入 ' + pCount + '件）' + (li ? '' : '。※未ログイン：この端末のみ');
        alert('復元しました。\n売上 ' + sCount + '件 / 仕入 ' + pCount + '件' + (li ? '' : '\n\n⚠️ 未ログインです。Googleでログインするとクラウドに保存され、次回も保持されます。'));
      }
    } catch (e) {
      if (st) st.textContent = '⚠️ 復元に失敗: ' + e.message;
      alert('復元に失敗しました: ' + e.message);
    }
    input.value = '';
  };
  rd.readAsText(file);
}
function smpRenderHome() {
  try { smpProfitMigrateFromSales(); } catch (e) {} // 古い source='明細' の仕入/売上を専用ストアへ移し全体集計に反映
  const cur = today().slice(0, 7);
  const inM = (r, m) => (r.month || String(r.date || '').slice(0, 7)) === m;
  const month = smpSelectedMonth();
  window._ribreViewMonth = month;
  smpSyncMonthControls(month);
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
  set('smpHomeMonth', '📅 ' + ym[0] + '年' + Number(ym[1]) + '月' + (isCur ? '' : ''));
  var tot = (typeof smpProfitMonthTotals === 'function') ? smpProfitMonthTotals(month) : { sale: totalSale, pur: totalPur, exp: totalFee + totalShip, profit: profit };
  set('smpHomeProfitLabel', (isCur ? '今月' : Number(ym[1]) + '月') + 'の粗利（全体）');
  set('smpHomeProfit', (tot.profit >= 0 ? '＋' : '') + yen(tot.profit), tot.profit >= 0 ? '#15803d' : '#dc2626');
  set('smpHomeSub', '売上 ' + yen(tot.sale) + ' − 仕入 ' + yen(tot.pur) + ' − 経費 ' + yen(tot.exp));
  set('smpHomeSale', yen(tot.sale));
  set('smpHomePur', yen(tot.pur));
  set('smpHomeCount', yen(tot.exp));
  // 年度累計（全体）
  try {
    var yy = parseInt(month.slice(0, 4), 10), mm2 = parseInt(month.slice(5, 7), 10);
    var sy = (mm2 >= 3) ? yy : yy - 1;
    var fmonths = (typeof smpProfitFiscalMonths === 'function') ? smpProfitFiscalMonths(sy) : [];
    var ys = 0, yp = 0, ye = 0;
    fmonths.forEach(function (mo) { var tt = smpProfitMonthTotals(mo.key); ys += tt.sale; yp += tt.pur; ye += tt.exp; });
    var ybox = document.getElementById('smpHomeYearBox');
    if (ybox) ybox.innerHTML = '<div style="font-weight:800;margin-bottom:4px;color:#334155">' + sy + '年度（3月〜翌2月）累計</div>総売上 ' + yen(ys) + '<br>総仕入 ' + yen(yp) + '<br>経費 ' + yen(ye) + '<br><b style="color:' + ((ys - yp - ye) >= 0 ? '#166534' : '#dc2626') + '">粗利 ' + yen(ys - yp - ye) + '</b>';
  } catch (e) {}
  try { smpRenderGoals(); } catch (e) {}
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
function smpSessionExpired() {
  const s = (typeof sess === 'function') ? sess() : {};
  const exp = Number(s.expires_at || 0);
  return !!(s.access_token && exp && exp <= Math.floor(Date.now() / 1000) + 30);
}
function smpAuthExpiredMessage() {
  return 'ログインの有効期限が切れました。ログインし直すと自動保存が再開します。';
}
function smpCloudErrorMessage(err) {
  const raw = String(err || '');
  if (/JWT expired|PGRST303|expired/i.test(raw)) return smpAuthExpiredMessage();
  try {
    const obj = JSON.parse(raw);
    const msg = [obj.code, obj.message, obj.hint, obj.details].filter(Boolean).join(' ');
    if (/JWT expired|PGRST303|expired/i.test(msg)) return smpAuthExpiredMessage();
    return obj.message || raw;
  } catch (e) {}
  return raw || '保存できませんでした';
}
function smpHandleExpiredSession(silent) {
  try { localStorage.removeItem(LS.sess); } catch (e) {}
  if (_smpAutosaveTimer) clearTimeout(_smpAutosaveTimer);
  _smpAutosaveTimer = null;
  _smpAutosaveQueued = false;
  smpRenderAuth();
  if (!silent) smpAuthStatus(smpAuthExpiredMessage(), 'warn');
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
  // prompt=select_account: ログアウト後の再ログインで必ずGoogleアカウント選択画面を出す
  location.href = c.url.replace(/\/$/, '') + '/auth/v1/authorize?provider=google&prompt=select_account&redirect_to=' + encodeURIComponent(redirect);
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
/* 初回移行：ローカル→クラウド。data-store.js の seedFromThisPC に委譲する。
   旧実装は client_id 無し(on_conflict=user_email,item_id)で直接upsertしており、
   data-store.js(on_conflict=user_email,client_id)が同じ内容を別行として再登録して
   全行が倍化する事故を起こした(2026-07-01発生・07-05クリーンアップ済み)。
   seedFromThisPC は data-store.js と同一の clientIdOf 規則で client_id を付けるため
   以後のpushSafe/reconcileと同じ行に収束し、重複を作らない。 */
async function smpUploadAllToCloud(em) {
  if (!window.ribreStore || typeof window.ribreStore.seedFromThisPC !== 'function') {
    return { err: 'data-store.js未読込のため移行を中止しました（client_id無しの直接アップロードは重複の原因になるため行いません）' };
  }
  const r = await window.ribreStore.seedFromThisPC();
  if (!r || !r.ok) return { err: (r && r.error) || '移行に失敗しました（画面上部のステータスを確認してください）' };
  return { okS: (r.sent && r.sent.sales) || 0, okP: (r.sent && r.sent.purchases) || 0, err: null };
}

let _smpAutosaveTimer = null;
let _smpAutosaveRunning = false;
let _smpAutosaveQueued = false;
const SMP_DIRTY_KEY = 'ribre_smp_dirty_v1';
const SMP_LOCAL_CHANGED_KEY = 'ribre_smp_local_changed_at_v1';
const SMP_LAST_SAVE_KEY = 'ribre_smp_last_save_at_v1';
function smpMarkDirty(reason) {
  try {
    const at = new Date().toISOString();
    localStorage.setItem(SMP_DIRTY_KEY, JSON.stringify({
      at: at,
      reason: reason || 'change'
    }));
    localStorage.setItem(SMP_LOCAL_CHANGED_KEY, at);
  } catch (e) {}
}
function smpClearDirty() {
  try { localStorage.removeItem(SMP_DIRTY_KEY); } catch (e) {}
}
function smpHasDirtyLocal() {
  try { return !!localStorage.getItem(SMP_DIRTY_KEY); } catch (e) { return false; }
}
function smpMarkSaveComplete() {
  try { localStorage.setItem(SMP_LAST_SAVE_KEY, new Date().toISOString()); } catch (e) {}
  smpClearDirty();
}
function smpHasUnsyncedLocal() {
  if (smpHasDirtyLocal()) return true;
  try {
    const changed = Date.parse(localStorage.getItem(SMP_LOCAL_CHANGED_KEY) || '');
    const saved = Date.parse(localStorage.getItem(SMP_LAST_SAVE_KEY) || '');
    return Number.isFinite(changed) && (!Number.isFinite(saved) || changed > saved);
  } catch (e) {
    return false;
  }
}
function smpLocalSnapshot() {
  return { sales: sales(), purchases: purchases() };
}
function smpRestoreSnapshot(snap) {
  if (!snap) return;
  try { setLS(LS.sales, snap.sales || []); } catch (e) {}
  try { setLS(LS.purchases, snap.purchases || []); } catch (e) {}
}
function smpCloudLoadWouldShrink(before) {
  if (!before) return false;
  if ((before.sales || []).length > sales().length || (before.purchases || []).length > purchases().length) return true;
  const afterById = new Map(sales().map(r => [smpSaleCloudId(r), r]));
  return (before.sales || []).some(r => {
    const id = smpSaleCloudId(r);
    const after = afterById.get(id);
    if (!after) return false;
    const beforeShip = num(r.ship || r.shipping || 0);
    const afterShip = num(after.ship || after.shipping || 0);
    const statusText = [r.matchStatus, r.memo].map(v => String(v || '')).join(' ');
    const hasShipEvidence = !!(r.slip || r.invoiceNo || r.deliveryCompany);
    const isMatchedShip = /配送CSV一致|配送一致|匿名配送|匿名/.test(statusText) || hasShipEvidence;
    const protectLocalShip = String(r.matchStatus || '') === '手入力' || (beforeShip > 0 && !isMatchedShip);
    return protectLocalShip && beforeShip > 0 && afterShip !== beforeShip;
  });
}
function smpSaleCloudId(r) {
  return String(r && (r.itemId || r.id || ('mig_' + (r.date || '') + '_' + (r.name || '') + '_' + num(r.amount || r.price))) || '').slice(0, 120);
}
function smpScheduleAutosave(reason) {
  smpMarkDirty(reason || 'change');
  if (!document.body.classList.contains('simple-mode')) return;
  if (!(typeof email === 'function' && email())) return;
  if (!sb().url || !sb().key) return;
  if (smpSessionExpired()) { smpHandleExpiredSession(true); return; }
  if (_smpAutosaveTimer) clearTimeout(_smpAutosaveTimer);
  _smpAutosaveTimer = setTimeout(() => smpAutosaveNow(reason || 'change'), 1200);
}
async function smpAutosaveNow(reason) {
  if (_smpAutosaveRunning) {
    _smpAutosaveQueued = true;
    return;
  }
  _smpAutosaveRunning = true;
  try {
    const r = await smpCloudSave({ silent: true, reason: reason || 'auto' });
    if (r && r.ok) {
      const at = new Date().toLocaleString('ja-JP');
      localStorage.setItem('ribre_smp_last_autosave', at);
      smpClearDirty();
      smpAuthStatus('✅ 自動保存しました ' + at, 'ok');
    }
  } catch (e) {
    smpAuthStatus('自動保存エラー: ' + e.message, 'warn');
  } finally {
    _smpAutosaveRunning = false;
    if (_smpAutosaveQueued) {
      _smpAutosaveQueued = false;
      smpScheduleAutosave('queued');
    }
  }
}

/* 手動保存：このPCの「今のデータ」でクラウドを置き換える（自分の行を消して入れ直し） */
async function smpCloudSave(opt) {
  opt = opt || {};
  const silent = !!opt.silent;
  const em = (typeof email === 'function') ? email() : '';
  if (!em) { if (!silent) smpAuthStatus('先にログインしてください', 'warn'); return { ok: false, reason: 'auth' }; }
  const c = sb();
  if (!c.url || !c.key) { if (!silent) smpAuthStatus('Supabase設定がありません', 'warn'); return { ok: false, reason: 'config' }; }
  if (smpSessionExpired()) {
    smpHandleExpiredSession(silent);
    return { ok: false, reason: 'expired' };
  }
  // data-store の reconcile（hydrate済みチェック＋大量削除ガードつき）に必ず通す。
  // 以前は自動保存もクラウド完全置換（バックアップ復元専用の無ガード処理）に
  // 委譲しており、未hydrateの端末で1回編集しただけで他端末のクラウドデータを
  // 全削除しうる危険があったため、安全な pushSafe() に統一する。
  if (!window.ribreStore || typeof window.ribreStore.pushSafe !== 'function') {
    if (!silent) smpAuthStatus('⚠ 同期モジュールが読み込めていません。ページを再読み込みしてください', 'warn');
    return { ok: false, reason: 'store-unavailable' };
  }
  if (!silent) smpAuthStatus('クラウドに保存中...', 'info');
  try {
    let rr = await window.ribreStore.pushSafe();
    // 大量削除ガードで保留された削除がある場合、手動保存（silent=false）なら
    // ユーザーに件数を示して承認をとり、承認されたときだけ削除込みで再実行する。
    // 自動保存では黙って保留のまま（誤削除の伝播を防ぐ安全側）。
    if (rr && rr.ok && rr.pendingDeletes > 0 && !silent) {
      const approve = confirm(
        'クラウドから ' + rr.pendingDeletes + ' 件の削除が保留されています。\n\n' +
        '本当にこの端末に無い ' + rr.pendingDeletes + ' 件をクラウドからも削除しますか？\n' +
        '（心当たりがない場合は「キャンセル」を押し、「☁ クラウドから最新を取得」で読み直してください）'
      );
      if (approve) rr = await window.ribreStore.pushSafe({ allowMassDelete: true });
    }
    if (rr && rr.ok) {
      const res = rr.result || {};
      const upS = (res.sales && res.sales.upserted) || 0;
      const upP = (res.purchases && res.purchases.upserted) || 0;
      smpMarkSaveComplete();
      if (!silent) {
        smpAuthStatus(rr.pendingDeletes > 0
          ? '✅ 保存しました（売上' + upS + '・仕入' + upP + '）※削除' + rr.pendingDeletes + '件は保留中'
          : '✅ 保存しました（売上' + upS + '・仕入' + upP + '）', 'ok');
      }
      return { ok: true, sales: upS, purchases: upP, pendingDeletes: rr.pendingDeletes || 0 };
    }
    if (rr && (rr.reason === 'session-lost' || rr.status === 401 || rr.status === 403)) {
      smpHandleExpiredSession(silent);
      return { ok: false, reason: 'expired' };
    }
    if (rr && rr.reason === 'not-logged-in') {
      if (!silent) smpAuthStatus('先にログインしてください', 'warn');
      return { ok: false, reason: 'auth' };
    }
    if (rr && rr.reason === 'not-hydrated') {
      // クラウド読込がまだ済んでいない（ログイン直後など）。ここで保存すると
      // 古いローカルでクラウドを縮小させる恐れがあるため待つ。編集内容は
      // dirtyフラグが立ったままなので、次回の自動保存で改めて反映される。
      if (!silent) smpAuthStatus('クラウド読込中のため少し待ってから保存します', 'info');
      return { ok: false, reason: 'not-hydrated' };
    }
    const msg = smpCloudErrorMessage((rr && (rr.error || rr.reason || rr.status)) || 'error');
    if (!silent) smpAuthStatus('保存エラー: ' + msg, 'warn');
    return { ok: false, reason: msg };
  } catch (e) {
    const msg = smpCloudErrorMessage(e.message);
    if (msg === smpAuthExpiredMessage()) smpHandleExpiredSession(silent);
    if (!silent) smpAuthStatus('保存エラー: ' + msg, 'err');
    return { ok: false, reason: msg };
  }
}
async function smpLoadCloudToSimple(opt) {
  opt = opt || {};
  const quiet = !!opt.quiet;
  if (!opt.force && smpHasUnsyncedLocal()) {
    if (!quiet) smpAuthStatus('未保存の変更があるため、クラウド読込を止めました。先に保存してください。', 'warn');
    return;
  }
  if (!(typeof email === 'function' && email())) return;
  if (typeof ver460LoadNow !== 'function') return;
  const beforeLoad = !opt.force ? smpLocalSnapshot() : null;
  if (!quiet) smpAuthStatus('クラウドから読込中...', 'info');
  try {
    await ver460LoadNow();
    if (beforeLoad && smpCloudLoadWouldShrink(beforeLoad)) {
      smpRestoreSnapshot(beforeLoad);
      smpMarkDirty('cloud-load-protected');
      smpRenderAuth();
      smpRenderHome();
      smpInitMonthOptions();
      const protectedAct = document.querySelector('.smp-screen.smp-screen-active');
      if (protectedAct && protectedAct.dataset.screen === 'summary') simpleRenderSummary();
      if (!quiet) smpAuthStatus('クラウド読み込みで件数が減るため、このPCのデータを残しました。保存を押してください。', 'warn');
      return;
    }
    smpRenderAuth();
    smpRenderHome();
    smpInitMonthOptions();
    const act = document.querySelector('.smp-screen.smp-screen-active');
    if (act && act.dataset.screen === 'summary') simpleRenderSummary();
    smpClearDirty();
    if (!quiet) smpAuthStatus('✅ クラウドから読み込みました', 'ok');
  } catch (e) {
    if (!quiet) smpAuthStatus('読込エラー: ' + e.message, 'warn');
  }
}
async function smpAfterLogin() {
  smpRenderAuth();
  const em = (typeof email === 'function') ? email() : '';
  if (!em) return;
  const migKey = 'ribre_smp_migrated_' + em;
  if (!localStorage.getItem(migKey)) {
    let migOk = true;
    if (sales().length || purchases().length) {
      smpAuthStatus('このPCのデータをアカウントへ移行中...', 'info');
      const r = await smpUploadAllToCloud(em);
      if (r.err) { migOk = false; smpAuthStatus('移行で一部エラー（次回ログインで再試行します）: ' + String(r.err).slice(0, 80), 'warn'); }
      else smpAuthStatus('移行完了（売上' + r.okS + '・仕入' + r.okP + '）', 'ok');
    }
    // 移行が成功した時だけ「移行済み」にする（一部失敗なら次回再試行）
    if (migOk) { try { localStorage.setItem(migKey, new Date().toISOString()); } catch (e) {} }
  }
  if (smpHasUnsyncedLocal()) {
    smpAuthStatus('このPCの未保存データを先に保存中...', 'info');
    const r = await smpCloudSave({ silent: true, reason: 'login-dirty' });
    if (!r || !r.ok) {
      smpAuthStatus('未保存データがあるため、古いクラウド読込を止めました。保存を押してください。', 'warn');
      return;
    }
  }
  await smpLoadCloudToSimple({ quiet: false });
  smpAuthStatus('✅ ログイン中：' + em, 'ok');
}
function smpCloudReload() {
  if (!confirm('クラウドの内容をこのPCに読み込みます。\nこのPCの今の表示は、クラウドの内容に置き換わります。\n（先に保存したい場合は「クラウドに保存」を押してください）\nよろしいですか？')) return;
  smpAuthStatus('クラウドから読込中...', 'info');
  Promise.resolve().then(async () => {
    try { await smpLoadCloudToSimple({ force: true, quiet: true }); } catch (e) {}
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

/* ===== 同時ログイン防止（後勝ち：最後にログインした端末だけ有効） =====
   app_settings(skey='active_session')に「有効端末ID」を記録。
   新規ログインした端末が自分を登録し、他端末は検知して自動ログアウトする。 */
function smpDeviceId() {
  var id = localStorage.getItem('ribre_device_id');
  if (!id) { id = 'dev_' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { localStorage.setItem('ribre_device_id', id); } catch (e) {} }
  return id;
}
async function smpClaimActiveSession() {
  var cr = smpProfitMeiCreds(); if (!cr) return false;
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'active_session', value: { deviceId: smpDeviceId(), at: Date.now() } }])
    });
    return r.ok;
  } catch (e) { return false; }
}
async function smpCheckActiveSession() {
  if (window.__ribreSuperseded) return;
  var cr = smpProfitMeiCreds(); if (!cr) return;
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.active_session&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return; // 取得失敗時は誤ログアウトしない
    var data = await r.json();
    var cloud = data && data[0] && data[0].value;
    if (cloud && cloud.deviceId && cloud.deviceId !== smpDeviceId()) smpSessionSuperseded();
  } catch (e) {}
}
function smpSessionSuperseded() {
  if (window.__ribreSuperseded) return;
  window.__ribreSuperseded = true; window.__ribreSessionLost = true;
  try { smpLogout(); } catch (e) {}
  setTimeout(function () {
    try { var m = document.getElementById('gateMsg'); if (m) { m.textContent = '別の端末でログインされたため、この端末はログアウトしました。続ける場合は再度ログインしてください。'; m.style.color = '#b91c1c'; } } catch (e) {}
  }, 200);
}
async function smpActiveSessionTick() {
  var cr = smpProfitMeiCreds();
  if (!cr) return; // 未ログインは何もしない（ガードがログイン画面を表示）
  var claimedTok = localStorage.getItem('ribre_claimed_token');
  if (claimedTok !== cr.tok) {
    // 新規/再ログイン → 後勝ちで自分を有効端末に登録
    window.__ribreSuperseded = false; window.__ribreSessionLost = false;
    if (await smpClaimActiveSession()) { try { localStorage.setItem('ribre_claimed_token', cr.tok); } catch (e) {} }
    return;
  }
  await smpCheckActiveSession();
}
(function () {
  if (window.__ribreActiveSessionBooted) return;
  window.__ribreActiveSessionBooted = true;
  window.addEventListener('load', function () {
    setTimeout(function () { try { smpActiveSessionTick(); } catch (e) {} }, 1200);
    setInterval(function () { try { smpActiveSessionTick(); } catch (e) {} }, 7000);
  });
})();

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
  smpScheduleAutosave('inbox');
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
  smpScheduleAutosave('inbox-finish');
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

/* ファイル名から月を推定（"2026年6月"/"2026-06"/"202606"/"6月" 等）。年つきは'YYYY-MM'、月のみは'M6'、無ければnull */
function smpFilenameMonth(name) {
  var s = String(name || '');
  var m = s.match(/(20\d{2})\s*[-_年.\/]?\s*(\d{1,2})\s*月/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0');
  m = s.match(/(20\d{2})[-_.]?(0[1-9]|1[0-2])(?!\d)/);
  if (m) return m[1] + '-' + m[2];
  m = s.match(/(?:^|[^0-9])([1-9]|1[0-2])\s*月/);
  if (m) return 'M' + m[1];
  return null;
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
  const _lockSnap = smpLockSnapshotSales();
  // 取込対象月を指定していれば、その月に反映させる（CSVの日付に依らない）
  var _forceMonth = (document.getElementById('smpInboxMonth') || {}).value || '';
  // ファイル名の月と取込対象月が食い違う場合はブロック（別月への誤取込防止）
  if (/^\d{4}-\d{2}$/.test(_forceMonth)) {
    var _fnM = smpFilenameMonth(_smpInboxFile.name);
    if (_fnM) {
      var _tgtNum = parseInt(_forceMonth.slice(5, 7), 10);
      var _mismatch = (_fnM.charAt(0) === 'M') ? (parseInt(_fnM.slice(1), 10) !== _tgtNum) : (_fnM !== _forceMonth);
      if (_mismatch) {
        var _fnLabel = (_fnM.charAt(0) === 'M') ? (_fnM.slice(1) + '月') : smpMonthLabel(_fnM);
        smpSetStatus('smpInboxStatus', '❌ ファイル名は「' + _fnLabel + '」ですが取込対象月は「' + smpMonthLabel(_forceMonth) + '」です。月を合わせてください', 'err');
        try { alert('❌ ファイル名は「' + _fnLabel + '」ですが、取込対象月は「' + smpMonthLabel(_forceMonth) + '」です。\n\n上の「取込対象月」をファイルに合わせるか、正しいファイルを選んでから取り込んでください。'); } catch (e) {}
        return;
      }
    }
  }
  window.__ribreImportMonth = /^\d{4}-\d{2}$/.test(_forceMonth) ? _forceMonth : '';
  try {
    importYahooSalesCsv();
    setTimeout(() => {
      window.__ribreImportMonth = '';
      const rv = smpLockProtectAfterImport(_lockSnap);
      const c = document.getElementById('yahooSalesCount') ? document.getElementById('yahooSalesCount').textContent : '?';
      smpRecordImportSig(sig, acc);
      // 保存済みの配送CSVで自動照合（先月に入れた配送CSVも、一致した売上に送料・伝票を自動反映）
      var shipMatched = false;
      try { if (typeof shipRows === 'function' && shipRows().length && typeof matchShipping === 'function') { matchShipping(); shipMatched = true; } } catch (e) {}
      var li = window.__ribreLastImport || {};
      var diag = '【診断】CSV ' + (li.rows != null ? li.rows : '?') + '行 → 新規 ' + (li.added != null ? li.added : '?') + '件・更新 ' + (li.patched != null ? li.patched : '?') + '件・スキップ ' + (li.skipped != null ? li.skipped : '?') + '件／取込元 ' + (li.account || '?') + '／対象月 ' + (li.month || '?');
      if (rv > 0) {
        var lm = smpLockedMonthsGet().map(function (m) { return smpMonthLabel(m); }).join('・');
        smpSetStatus('smpInboxStatus', `⚠️ ロック中の月（${lm}）があり ${rv} 件は取り込みませんでした。粗利タブ→月のロックで解除してください　` + diag, 'warn');
        try { alert('🔒 ロック中の月（' + lm + '）があるため ' + rv + ' 件は取り込みませんでした。\n\nその月を取り込むには、「粗利」タブ →「月のロック」で対象の月を解除してから、もう一度取り込んでください。'); } catch (e) {}
      } else {
        smpSetStatus('smpInboxStatus', `✅ 売上CSV取込完了：${c}（重複する商品は自動でまとめました）` + (shipMatched ? '／配送CSVと自動照合' : '') + '　' + diag, 'ok');
      }
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
  const _lockSnapSh = smpLockSnapshotSales();
  try {
    importShippingCsv();
    setTimeout(() => {
      smpSetStatus('smpInboxStatus', '照合中...', 'info');
      try {
        matchShipping();
        setTimeout(() => {
          const rv = smpLockProtectAfterImport(_lockSnapSh);
          const m = document.getElementById('shipMatchCount') ? document.getElementById('shipMatchCount').textContent : '?';
          const u = document.getElementById('shipSalesUnmatched') ? document.getElementById('shipSalesUnmatched').textContent : '?';
          smpSetStatus('smpInboxStatus', `✅ 照合完了　一致：${m}　未一致：${u}（送料・伝票を売上に自動反映）` + (rv ? `／🔒ロック月は保護` : ''), 'ok');
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
  const d = document.getElementById('smpInboxDate'); if (d && !d.value) d.value = smpMonthFirstDay((document.getElementById('smpInboxMonth') || {}).value || smpSelectedMonth());
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
  const d = document.getElementById('smpManDate'); if (d && !d.value) d.value = smpMonthFirstDay(smpSelectedMonth());
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
  smpScheduleAutosave('manual');
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
  smpScheduleAutosave('ocr-purchase');
}

/* ---- 月次サマリー ---- */
/* 集計タブを開いた時：選択月にデータが無ければ、データのある月へ自動で合わせる */
let _smpReportTab = 'summary';
function smpSetReportTab(tab) {
  const next = ['summary', 'sales', 'purchases', 'raw'].indexOf(tab) >= 0 ? tab : 'summary';
  _smpReportTab = next;
  document.querySelectorAll('.smp-report-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.reportTab === next);
  });
  document.querySelectorAll('[data-report-panel]').forEach(el => {
    el.classList.toggle('smp-report-panel-hidden', el.dataset.reportPanel !== next);
  });
  if (next === 'raw') smpRenderReportRawTables();
}
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

  const s = smpSortReportSalesRows(sales().filter(inMonth));
  const p = purchases().filter(inMonth);

  const totalFee  = s.reduce((a, r) => a + num(r.fee), 0); // 手数料はEC分（明細・仮入力に手数料なし）

  // 粗利タブの明細・仮入力も含めた「全体」に（smpProfitMonthTotalsで整合）
  let mt = { sale: 0, pur: 0, exp: 0, profit: 0 };
  try {
    if (all) {
      const _set = {};
      (typeof smpProfitMonthsPresent === 'function' ? smpProfitMonthsPresent() : []).forEach(function (m) { _set[m] = 1; });
      try { const st0 = smpProfitMeiGet(); (st0.sales || []).concat(st0.purchases || []).forEach(function (e) { const m = e.month || String(e.date || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) _set[m] = 1; }); } catch (e) {}
      Object.keys(_set).forEach(function (mm) { const t = smpProfitMonthTotals(mm); mt.sale += t.sale; mt.pur += t.pur; mt.exp += t.exp; mt.profit += t.profit; });
    } else {
      mt = smpProfitMonthTotals(month);
    }
  } catch (e) {}
  const gSale = mt.sale, gPur = mt.pur, gProfit = mt.profit;
  const gFee = totalFee;
  const gShip = Math.max(0, mt.exp - gFee); // 送料＝経費合計−手数料
  let meiSaleCount = 0, meiPurCount = 0;
  try { const stc = smpProfitMeiGet(); const inM2 = function (e) { return all || (e.month || String(e.date || '').slice(0, 7)) === month; }; meiSaleCount = (stc.sales || []).filter(inM2).length; meiPurCount = (stc.purchases || []).filter(inM2).length; } catch (e) {}
  const saleCount = s.length + meiSaleCount;
  const tax = Math.floor(gSale / 11);
  const netSale = gSale - tax;
  const avgUnit = saleCount ? Math.round(gSale / saleCount) : 0;
  const avgProfit = saleCount ? Math.round(gProfit / saleCount) : 0;

  const set = (id, v, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (color) el.style.color = color;
  };
  set('smpTotalSale',  yen(gSale));
  set('smpTotalFee',   yen(gFee));
  set('smpTotalShip',  yen(gShip));
  set('smpTotalPur',   yen(gPur));
  set('smpTotalProfit', (gProfit >= 0 ? '+' : '') + yen(gProfit), gProfit >= 0 ? '#166534' : '#dc2626');
  set('smpNetSale', yen(netSale));
  set('smpSalesTax', yen(tax));
  set('smpAvgUnit', saleCount + '件 / ' + yen(avgUnit));
  set('smpAvgProfit', yen(avgProfit), avgProfit >= 0 ? '#166534' : '#dc2626');
  set('smpSaleCount',  saleCount + '件');
  set('smpPurCount',   (p.length + meiPurCount) + '件');
  set('smpAllCount', '全体（EC＋ヤフオク＋メルカリ＋明細＋仮入力）の合計です。下の内訳はEC分です');
  const missing = smpShipMissingCount(s);
  const warnEl = document.getElementById('smpShipWarn');
  if (warnEl) {
    if (missing > 0) { warnEl.style.display = 'block'; warnEl.textContent = '⚠️ 送料が入っていない売上が ' + missing + ' 件あります（匿名配送は除く）'; }
    else { warnEl.style.display = 'none'; }
  }
  smpRenderRecent();
  smpRenderReportTypeOptions();
  smpRenderReportTables(s, p);
  smpRenderReportRawTables(s, p);
  smpRenderReportCharts(month);
  smpSetReportTab(_smpReportTab);
}

/* ===== 粗利表（年間・月を横並び・チャネル別）粗利=売上−仕入−送料 ===== */
function smpProfitFiscalMonths(startYear) {
  var arr = [];
  for (var i = 0; i < 12; i++) {
    var m = 3 + i;
    var y = startYear + (m > 12 ? 1 : 0);
    var mm = ((m - 1) % 12) + 1;
    arr.push({ key: y + '-' + String(mm).padStart(2, '0'), label: mm + '月' });
  }
  return arr;
}
function smpProfitMonthsPresent() {
  var set = {};
  sales().forEach(function (r) { var m = r.month || String(r.date || r.sale_date || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) set[m] = 1; });
  purchases().forEach(function (r) { var m = r.month || String(r.date || r.purchase_date || '').slice(0, 7); if (/^\d{4}-\d{2}$/.test(m)) set[m] = 1; });
  return Object.keys(set).sort();
}
function smpProfitDefaultStartYear() {
  var ms = smpProfitMonthsPresent();
  var latest = ms.length ? ms[ms.length - 1] : today().slice(0, 7);
  var y = parseInt(latest.slice(0, 4), 10) || (new Date()).getFullYear();
  var m = parseInt(latest.slice(5, 7), 10) || 1;
  return m >= 3 ? y : y - 1;
}
var SMP_SALES_CHANNELS = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリ', 'メルカリShops', 'ラクマ'];
function smpProfitProvGet() { try { return JSON.parse(localStorage.getItem('ribre_smp_profit_prov_v1') || '{}') || {}; } catch (e) { return {}; } }
function smpProfitProvTsGet() { return Number(localStorage.getItem('ribre_smp_profit_prov_ts') || 0) || 0; }
function smpProfitProvTsSet(t) { try { localStorage.setItem('ribre_smp_profit_prov_ts', String(t || Date.now())); } catch (e) {} }
function smpProfitProvSet(o, noPush) { try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(o)); } catch (e) {} if (!noPush) { smpProfitProvTsSet(Date.now()); smpProfitProvPushDebounced(); } }
var _smpProvPushTimer = null;
function smpProfitProvPushDebounced() { if (_smpProvPushTimer) clearTimeout(_smpProvPushTimer); _smpProvPushTimer = setTimeout(smpProfitProvPushCloud, 800); }
/* 仮入力のマージ：マスごと（月×チャネル）に更新時刻(_m)を持ち、新しい方を採用。
   一方の端末にしか無い入力は必ず残す（塊ごとの上書きで消さない）。 */
function smpProvMerge(aData, aTs, bData, bTs) {
  var a = aData || {}, b = bData || {};
  var am = (a._m && typeof a._m === 'object') ? a._m : {};
  var bm = (b._m && typeof b._m === 'object') ? b._m : {};
  var keys = {};
  var collect = function (o, m) {
    Object.keys(o).forEach(function (mo) {
      if (mo === '_m') return;
      var row = o[mo];
      if (row && typeof row === 'object') Object.keys(row).forEach(function (ch) { keys[mo + '|' + ch] = 1; });
    });
    Object.keys(m).forEach(function (k) { keys[k] = 1; });
  };
  collect(a, am); collect(b, bm);
  var out = { _m: {} };
  Object.keys(keys).forEach(function (k) {
    var i = k.indexOf('|'); if (i < 0) return;
    var mo = k.slice(0, i), ch = k.slice(i + 1);
    var hasA = a[mo] && a[mo][ch] != null, hasB = b[mo] && b[mo][ch] != null;
    var ta = Number(am[k] || (hasA ? (aTs || 0) : 0)) || 0;
    var tb = Number(bm[k] || (hasB ? (bTs || 0) : 0)) || 0;
    var useA = ta >= tb; // 同時刻はローカル優先（merge(local, cloud)で呼ぶ）
    var val = useA ? (hasA ? a[mo][ch] : undefined) : (hasB ? b[mo][ch] : undefined);
    out._m[k] = Math.max(ta, tb);
    if (val != null) { out[mo] = out[mo] || {}; out[mo][ch] = val; }
  });
  var lim = Date.now() - 180 * 24 * 3600 * 1000;
  Object.keys(out._m).forEach(function (k) { var i = k.indexOf('|'); var mo = k.slice(0, i); var ch = k.slice(i + 1); if (out._m[k] < lim && !(out[mo] && out[mo][ch] != null)) delete out._m[k]; });
  return out;
}
async function smpProfitProvFetchCloud(cr) {
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.profit_prov&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    var data = await r.json();
    var cloud = data && data[0] && data[0].value;
    return (cloud && typeof cloud === 'object' && cloud.data) ? cloud : null;
  } catch (e) { return null; }
}
async function smpProfitProvPushCloud() {
  if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
  var cr = smpProfitMeiCreds(); if (!cr) return { ok: false, reason: 'no-login' };
  try {
    // 先にクラウドを読んでマスごとに合成してから保存
    var body = smpProfitProvGet();
    var cloud = await smpProfitProvFetchCloud(cr);
    if (cloud) {
      body = smpProvMerge(smpProfitProvGet(), smpProfitProvTsGet(), cloud.data, cloud.ts || 0);
      try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(body)); } catch (e) {}
    }
    var now = Date.now();
    smpProfitProvTsSet(now);
    var r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'profit_prov', value: { data: body, ts: now } }])
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}
async function smpProfitProvPullCloud() {
  var cr = smpProfitMeiCreds(); if (!cr) return false;
  var cloud = await smpProfitProvFetchCloud(cr);
  if (!cloud) return false;
  var local = smpProfitProvGet();
  var merged = smpProvMerge(local, smpProfitProvTsGet(), cloud.data, cloud.ts || 0);
  var changed = JSON.stringify(merged) !== JSON.stringify(local);
  try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(merged)); } catch (e) {}
  smpProfitProvTsSet(Math.max(smpProfitProvTsGet(), Number(cloud.ts || 0)));
  // この端末にしか無い入力があればクラウドへ押し戻す
  if (JSON.stringify(merged) !== JSON.stringify(cloud.data)) smpProfitProvPushDebounced();
  return changed;
}
function smpProfitSetProv(month, chan, val) {
  var o = smpProfitProvGet(); o[month] = o[month] || {};
  o._m = (o._m && typeof o._m === 'object') ? o._m : {};
  var n = Number(String(val == null ? '' : val).replace(/[^0-9.-]/g, '')) || 0;
  if (n) o[month][chan] = n; else if (o[month]) delete o[month][chan];
  o._m[month + '|' + chan] = Date.now(); // マス単位の更新時刻（消した操作も記録され、同期で復活しない）
  smpProfitProvSet(o);
  simpleRenderProfitTable();
}
/* 明細は「粗利ページ専用」の別データ（売上一覧/ダッシュボード/集計には反映しない）。Supabaseで他PCと同期。 */
/* ===== 端末間マージ =====
   以前は「データ塊ごと時刻の新しい方が勝ち」だったため、別端末の入力が
   丸ごと消えることがあった。行単位で合成する方式に変更：
   - 各行に up(更新時刻) を持たせ、同じ行は新しい方を採用
   - 削除は tomb(墓標: id→削除時刻) に記録し、全端末で削除を維持
   - どちらか一方にしか無い行は必ず残す（＝入力が消えない） */
function smpMeiMergeLists(aList, bList, tomb) {
  var byId = {};
  function addAll(list) {
    (list || []).forEach(function (r) {
      if (!r || r.id == null) return;
      var id = String(r.id);
      var up = Number(r.up || 0) || 0;
      var cur = byId[id];
      if (!cur || up >= (Number(cur.up || 0) || 0)) byId[id] = r;
    });
  }
  addAll(aList); addAll(bList);
  var out = [];
  Object.keys(byId).forEach(function (id) {
    var delAt = Number((tomb || {})[id] || 0);
    if (delAt && delAt >= (Number(byId[id].up || 0) || 0)) return; // 削除の方が新しい
    out.push(byId[id]);
  });
  out.sort(function (x, y) { return String(y.date || '').localeCompare(String(x.date || '')) || ((Number(y.up || 0) || 0) - (Number(x.up || 0) || 0)); });
  return out;
}
function smpMeiMerge(a, b) {
  a = a || {}; b = b || {};
  var tomb = {};
  [a.tomb, b.tomb].forEach(function (t) {
    if (t && typeof t === 'object') Object.keys(t).forEach(function (k) { tomb[k] = Math.max(Number(tomb[k] || 0), Number(t[k] || 0)); });
  });
  var lim = Date.now() - 180 * 24 * 3600 * 1000; // 180日より古い墓標は破棄
  Object.keys(tomb).forEach(function (k) { if (tomb[k] < lim) delete tomb[k]; });
  return {
    sales: smpMeiMergeLists(a.sales, b.sales, tomb),
    purchases: smpMeiMergeLists(a.purchases, b.purchases, tomb),
    tomb: tomb,
    ts: Math.max(Number(a.ts || 0), Number(b.ts || 0))
  };
}
function smpProfitMeiGet() { try { var o = JSON.parse(localStorage.getItem('ribre_smp_profit_meisai_v1') || '{}') || {}; o.sales = o.sales || []; o.purchases = o.purchases || []; return o; } catch (e) { return { sales: [], purchases: [] }; } }
function smpProfitMeiSet(o, noPush) { o.ts = Date.now(); try { localStorage.setItem('ribre_smp_profit_meisai_v1', JSON.stringify(o)); } catch (e) {} if (!noPush) smpProfitMeiPushDebounced(); }
var _smpMeiPushTimer = null;
function smpProfitMeiPushDebounced() { if (_smpMeiPushTimer) clearTimeout(_smpMeiPushTimer); _smpMeiPushTimer = setTimeout(smpProfitMeiPushCloud, 800); }
function smpProfitMeiCreds() {
  try { var c = (typeof sb === 'function') ? sb() : {}; var s = (typeof sess === 'function') ? sess() : {}; var tok = s.access_token || (s.session && s.session.access_token) || ''; var em = (typeof email === 'function') ? email() : ''; if (c.url && c.key && tok && em) return { url: c.url.replace(/\/$/, ''), key: c.key, tok: tok, em: em }; } catch (e) {} return null;
}
async function smpProfitMeiFetchCloud(cr) {
  try {
    var r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.profit_meisai&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    var data = await r.json();
    var cloud = data && data[0] && data[0].value;
    return (cloud && typeof cloud === 'object') ? cloud : null;
  } catch (e) { return null; }
}
async function smpProfitMeiPushCloud() {
  if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
  var cr = smpProfitMeiCreds(); if (!cr) return { ok: false, reason: 'no-login' };
  try {
    // 先にクラウドを読んで行単位で合成してから保存（塊ごとの上書きで他端末の入力を消さない）
    var body = smpProfitMeiGet();
    var cloud = await smpProfitMeiFetchCloud(cr);
    if (cloud) {
      body = smpMeiMerge(smpProfitMeiGet(), cloud);
      try { localStorage.setItem('ribre_smp_profit_meisai_v1', JSON.stringify(body)); } catch (e) {}
    }
    body.ts = Date.now();
    var r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'profit_meisai', value: body }])
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}
async function smpProfitMeiPullCloud() {
  var cr = smpProfitMeiCreds(); if (!cr) return false;
  var cloud = await smpProfitMeiFetchCloud(cr);
  if (!cloud) return false;
  var local = smpProfitMeiGet();
  var merged = smpMeiMerge(local, cloud);
  var mergedKey = JSON.stringify({ s: merged.sales, p: merged.purchases });
  var changed = mergedKey !== JSON.stringify({ s: local.sales, p: local.purchases });
  try { localStorage.setItem('ribre_smp_profit_meisai_v1', JSON.stringify(merged)); } catch (e) {}
  // クラウド側に無い行をこの端末が持っていた場合は押し戻して復元する
  var cloudNorm = smpMeiMerge(cloud, cloud);
  if (mergedKey !== JSON.stringify({ s: cloudNorm.sales, p: cloudNorm.purchases })) smpProfitMeiPushDebounced();
  return changed;
}
/* 手動同期（ログイン中アカウントを表示。両PC/携帯で同じ ribre2016@gmail.com が必要） */
async function smpProfitSyncNow() {
  var st = document.getElementById('smpProfitSyncStatus');
  var setSt = function (m) { if (st) st.textContent = m; };
  var cr = smpProfitMeiCreds();
  if (!cr) { setSt('⚠️ 未ログイン。Google（ribre2016@gmail.com）でログインしてください'); return; }
  setSt('同期中…（' + cr.em + '）');
  try {
    var pushRes = await smpProfitMeiPushCloud(); // このPCの明細をクラウドへ（成否を確認）
    // 仮入力：データがある端末だけ上げる（空端末で上書きしない）。旧データ(ts無し)にはtsを付与
    var provData = smpProfitProvGet(), hasProv = false;
    for (var _mk in provData) { if (provData[_mk] && typeof provData[_mk] === 'object' && Object.keys(provData[_mk]).length) { hasProv = true; break; } }
    if (hasProv) { if (!smpProfitProvTsGet()) smpProfitProvTsSet(Date.now()); try { await smpProfitProvPushCloud(); } catch (e) {} }
    try { await smpLockedPushCloud(); } catch (e) {}
    await smpProfitMeiPullCloud(); // 最新を取得（新しい方が優先）
    try { await smpProfitProvPullCloud(); } catch (e) {}
    try { await smpLockedPullCloud(); } catch (e) {}
    var store = smpProfitMeiGet();
    var ns = (store.sales || []).length, np = (store.purchases || []).length;
    try { simpleRenderProfitTable(); } catch (e) {}
    try { smpRenderHome(); } catch (e) {}
    if (pushRes && pushRes.ok) {
      setSt('✅ 同期OK：クラウドに保存しました（売上明細 ' + ns + '件・仕入明細 ' + np + '件／' + cr.em + '）。他端末で🔄を押すと反映されます');
    } else {
      var why = pushRes ? (pushRes.status ? ('HTTP ' + pushRes.status) : (pushRes.reason || '不明')) : '不明';
      setSt('⚠️ クラウド保存に失敗（' + why + '／' + cr.em + '）。404＝app_settings未作成 / 401＝再ログイン / 403＝RLS の可能性');
    }
  } catch (e) {
    setSt('⚠️ 同期に失敗しました（' + cr.em + '）');
  }
}
/* 旧仕様で売上/仕入に混ざった source='明細' を専用ストアへ移動（ダッシュボードから除外） */
function smpProfitMigrateFromSales() {
  var isMei = function (r) { return String(r.source || '') === '明細'; };
  var mei = smpProfitMeiGet(); var changed = false;
  var s = sales(); var meiS = s.filter(isMei);
  if (meiS.length) {
    meiS.forEach(function (r) { mei.sales.push({ id: String(r.id || r.client || ('s_' + Date.now() + Math.floor(Math.random() * 1e6))), date: r.date || '', month: r.month || String(r.date || '').slice(0, 7), name: String(r.shop || r.name || ''), amount: num(r.amount != null ? r.amount : r.price) }); });
    setLS(LS.sales, s.filter(function (r) { return !isMei(r); }));
    try { setLS('ribre_yahoo_sales240', (get('ribre_yahoo_sales240', [])).filter(function (r) { return !isMei(r); })); } catch (e) {}
    changed = true;
  }
  var p = purchases(); var meiP = p.filter(isMei);
  if (meiP.length) {
    meiP.forEach(function (r) { mei.purchases.push({ id: String(r.id || r.client || ('p_' + Date.now() + Math.floor(Math.random() * 1e6))), date: r.date || '', month: r.month || String(r.date || '').slice(0, 7), name: String(r.vendor || r.name || ''), amount: num(r.total != null ? r.total : r.amount) }); });
    setLS(LS.purchases, p.filter(function (r) { return !isMei(r); }));
    changed = true;
  }
  if (changed) { smpProfitMeiSet(mei); try { smpScheduleAutosave('mei-migrate'); } catch (e) {} try { refreshAll(); } catch (e) {} }
}
function smpProfitData(startYear) {
  var months = smpProfitFiscalMonths(startYear);
  var keyset = {}; months.forEach(function (m) { keyset[m.key] = 1; });
  var monthOf = function (r) { return r.month || String(r.date || r.sale_date || r.purchase_date || '').slice(0, 7); };
  var mOf = function (e) { return e.month || String(e.date || '').slice(0, 7); };
  var chanKey = function (r) { return String(r.shop || r.type || r.matchStatus || '').trim() || 'その他'; };
  var venKey = function (r) { return String(r.vendor || r.type || '').trim() || 'その他'; };
  var isMei = function (r) { return String(r.source || '') === '明細'; };
  var chanReal = {}, chanFee = {}, venReal = {}, shipByM = {}, feeByM = {};
  months.forEach(function (m) { shipByM[m.key] = 0; feeByM[m.key] = 0; });
  sales().forEach(function (r) {
    var mk = monthOf(r); if (!keyset[mk] || isMei(r)) return;
    shipByM[mk] += num(r.ship != null ? r.ship : r.shipping); // 送料
    feeByM[mk] += num(r.fee); // 手数料
    var c = chanKey(r);
    chanReal[c] = chanReal[c] || {}; chanReal[c][mk] = (chanReal[c][mk] || 0) + num(r.amount != null ? r.amount : r.price);
    chanFee[c] = chanFee[c] || {}; chanFee[c][mk] = (chanFee[c][mk] || 0) + num(r.fee); // チャネル別の手数料
  });
  purchases().forEach(function (r) {
    var mk = monthOf(r); if (!keyset[mk] || isMei(r)) return;
    var v = venKey(r);
    venReal[v] = venReal[v] || {}; venReal[v][mk] = (venReal[v][mk] || 0) + num(r.total != null ? r.total : r.amount);
  });
  var store = smpProfitMeiGet();
  var meiSales = store.sales.filter(function (e) { return keyset[mOf(e)]; }).map(function (e) { return { id: e.id, date: e.date, name: e.name, amount: num(e.amount), mk: mOf(e) }; });
  var meiPur = store.purchases.filter(function (e) { return keyset[mOf(e)]; }).map(function (e) { return { id: e.id, date: e.date, name: e.name, amount: num(e.amount), mk: mOf(e) }; });
  meiSales.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  meiPur.sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
  return { months: months, chanReal: chanReal, chanFee: chanFee, venReal: venReal, shipByM: shipByM, feeByM: feeByM, meiSales: meiSales, meiPur: meiPur };
}
function simpleRenderProfitTable() {
  var wrap = document.getElementById('smpProfitTableWrap');
  if (!wrap) return;
  try { smpProfitMigrateFromSales(); } catch (e) {}
  var ms = smpProfitMonthsPresent();
  var years = {};
  ms.forEach(function (m) { var y = parseInt(m.slice(0, 4), 10), mm = parseInt(m.slice(5, 7), 10); years[mm >= 3 ? y : y - 1] = 1; });
  var defY = smpProfitDefaultStartYear(); years[defY] = 1;
  var sel = document.getElementById('smpProfitYear');
  var startYear = (sel && sel.value) ? parseInt(sel.value, 10) : defY;
  if (sel) {
    var ylist = Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    if (ylist.indexOf(startYear) < 0) startYear = defY;
    sel.innerHTML = ylist.map(function (y) { return '<option value="' + y + '"' + (y === startYear ? ' selected' : '') + '>' + y + '年度（' + y + '/3〜' + (y + 1) + '/2）</option>'; }).join('');
  }
  var d = smpProfitData(startYear);
  var prov = smpProfitProvGet();
  var curMonth = today().slice(0, 7);
  var provShip = (prov[curMonth] && prov[curMonth]['__ship__']);
  if (provShip != null && provShip !== '' && d.shipByM[curMonth] != null) d.shipByM[curMonth] = num(provShip); // 当月の送料は手入力を優先
  var provFee = (prov[curMonth] && prov[curMonth]['__fee__']);
  if (provFee != null && provFee !== '' && d.feeByM[curMonth] != null) d.feeByM[curMonth] = num(provFee); // 当月の手数料は手入力を優先
  var months = d.months;
  var fmt = function (n) { return (Math.round(n) || 0).toLocaleString(); };
  var bd = function (extra) { return 'border:1px solid #e5e7eb;padding:1px 3px;white-space:nowrap;' + (extra || ''); };
  // 売上チャネル：ヤフオク1〜8・メルカリ等を固定順、その後にデータにある他チャネル
  var totC = function (c) { return months.reduce(function (s, m) { return s + ((d.chanReal[c] && d.chanReal[c][m.key]) || 0); }, 0); };
  var others = Object.keys(d.chanReal).filter(function (c) { return SMP_SALES_CHANNELS.indexOf(c) < 0; }).sort(function (a, b) { return totC(b) - totC(a); });
  var chans = SMP_SALES_CHANNELS.concat(others);
  var saleEff = function (c, mk) { var real = (d.chanReal[c] && d.chanReal[c][mk]) || 0; if (real > 0) return real; if (mk === curMonth) return (prov[mk] && prov[mk][c]) || 0; return 0; };
  var chanSaleByM = function (mk) { return chans.reduce(function (s, c) { return s + saleEff(c, mk); }, 0); };
  var meiSaleByM = function (mk) { return d.meiSales.reduce(function (s, e) { return s + (e.mk === mk ? e.amount : 0); }, 0); };
  var saleByM = function (mk) { return chanSaleByM(mk) + meiSaleByM(mk); };
  // 仕入：買取先（vendor）別
  var totV = function (v) { return months.reduce(function (s, m) { return s + ((d.venReal[v] && d.venReal[v][m.key]) || 0); }, 0); };
  var vendors = Object.keys(d.venReal).sort(function (a, b) { return totV(b) - totV(a); });
  var venPurByM = function (mk) { return vendors.reduce(function (s, v) { return s + ((d.venReal[v] && d.venReal[v][mk]) || 0); }, 0); };
  var meiPurByM = function (mk) { return d.meiPur.reduce(function (s, e) { return s + (e.mk === mk ? e.amount : 0); }, 0); };
  var purByM = function (mk) { return venPurByM(mk) + meiPurByM(mk); };

  var th = '<th style="position:sticky;left:0;z-index:1;text-align:left;' + bd('background:#f1f5f9') + '">区分</th>' +
    months.map(function (m) { return '<th onclick="smpProfitToggleMonth(\'' + m.key + '\')" title="押すと販売先/仕入先・日付を表示" style="cursor:pointer;text-align:right;min-width:56px;' + bd(m.key === curMonth ? 'background:#fffbeb;color:#b45309' : 'background:#f1f5f9') + '">' + m.label + ' ▾</th>'; }).join('') +
    '<th style="text-align:right;' + bd('background:#eef2ff') + '">年計</th>';
  var ncols = months.length + 2;
  function sectionRow(label, color) { return '<tr><td colspan="' + ncols + '" style="' + bd('background:' + color + ';font-weight:800') + '">' + label + '</td></tr>'; }
  function dataRow(name, getter, opt) {
    opt = opt || {}; var t = 0;
    var cells = months.map(function (m) { var v = getter(m.key); t += v; return '<td style="text-align:right;' + bd(m.key === curMonth ? 'background:#fffef5' : '') + '">' + fmt(v) + '</td>'; }).join('');
    return '<tr style="' + (opt.rowStyle || '') + '"><td style="position:sticky;left:0;white-space:nowrap;' + bd('background:' + (opt.nameBg || '#fff') + ';' + (opt.nameStyle || '')) + '">' + smpEsc(name) + '</td>' + cells + '<td style="text-align:right;font-weight:700;' + bd('background:#f8fafc') + '">' + fmt(t) + '</td></tr>';
  }
  function salesRow(c) {
    var t = 0;
    var cells = months.map(function (m) {
      var mk = m.key; var eff = saleEff(c, mk); t += eff;
      var real = (d.chanReal[c] && d.chanReal[c][mk]) || 0;
      if (mk === curMonth && !(real > 0)) {
        var pv = (prov[mk] && prov[mk][c]) || '';
        return '<td onclick="smpProfitEditCell(this,\'' + mk + '\',\'' + c + '\')" style="cursor:pointer;text-align:right;' + bd('background:#fffef5') + '">' + (pv ? fmt(pv) : '<span style="color:#cbd5e1">仮</span>') + '</td>';
      }
      var cFee = (d.chanFee[c] && d.chanFee[c][mk]) || 0;
      if (eff > 0 && cFee > 0) {
        return '<td onclick="smpProfitToggleNet(this)" data-gross="' + Math.round(eff) + '" data-net="' + Math.round(eff - cFee) + '" title="クリックで手数料引き後↔総額（手数料 ' + fmt(cFee) + '）" style="cursor:pointer;text-align:right;' + bd(mk === curMonth ? 'background:#fffef5' : '') + '">' + fmt(eff) + '</td>';
      }
      return '<td style="text-align:right;' + bd(mk === curMonth ? 'background:#fffef5' : '') + '">' + fmt(eff) + '</td>';
    }).join('');
    return '<tr><td style="position:sticky;left:0;white-space:nowrap;' + bd('background:#fff') + '">' + smpEsc(c) + '</td>' + cells + '<td style="text-align:right;font-weight:700;' + bd('background:#f8fafc') + '">' + fmt(t) + '</td></tr>';
  }

  // 明細グリッド：行＝各月のN件目を同じ行に並べる（月ごとに行がずれないよう整列）
  function meiGridRows(entries) {
    var byM = {};
    entries.forEach(function (e) { (byM[e.mk] = byM[e.mk] || []).push(e); });
    var maxN = 0;
    months.forEach(function (m) { var n = (byM[m.key] || []).length; if (n > maxN) maxN = n; });
    var html = '';
    for (var i = 0; i < maxN; i++) {
      var rowSum = 0;
      var cells = months.map(function (m) {
        var e = (byM[m.key] || [])[i];
        if (e) {
          rowSum += num(e.amount);
          var dp = String(e.date || '').split('-');
          var md = dp.length === 3 ? (Number(dp[1]) + '/' + Number(dp[2])) : (e.date || '');
          var detail = smpEsc(e.name || '') + (md ? ' ' + md : '');
          return '<td onclick="smpProfitToggleDetail(this)" title="' + detail + '" style="cursor:pointer;text-align:right;' + bd(m.key === curMonth ? 'background:#fffef5' : '') + '"><span class="smp-meili" data-mk="' + m.key + '" style="display:none">' + detail + ' </span><span style="font-weight:700">' + fmt(e.amount) + '</span></td>';
        }
        return '<td style="' + bd(m.key === curMonth ? 'background:#fffef5' : '') + '"></td>';
      }).join('');
      html += '<tr><td style="position:sticky;left:0;text-align:center;color:#cbd5e1;' + bd('background:#fff') + '">・</td>' + cells + '<td style="text-align:right;color:#94a3b8;' + bd('background:#f8fafc') + '">' + (rowSum ? fmt(rowSum) : '') + '</td></tr>';
    }
    return html;
  }
  var body = '';
  // 仕入（明細を個別行で表示）
  body += sectionRow('仕入（明細）', '#fef3c7');
  body += meiGridRows(d.meiPur);
  vendors.forEach(function (v) { body += dataRow(v, function (mk) { return (d.venReal[v] && d.venReal[v][mk]) || 0; }); });
  if (!d.meiPur.length && !vendors.length) body += '<tr><td colspan="' + ncols + '" style="' + bd('color:#94a3b8') + '">仕入データがありません（下の「明細入力」から追加）</td></tr>';
  body += dataRow('仕入 合計', purByM, { rowStyle: 'font-weight:800', nameBg: '#fff7ed' });
  // 売上明細（追加分）＝チャネルの「上」に積む
  body += sectionRow('売上明細（追加分）', '#dcfce7');
  body += meiGridRows(d.meiSales);
  if (!d.meiSales.length) body += '<tr><td colspan="' + ncols + '" style="' + bd('color:#94a3b8') + '">明細はまだありません（下の「明細入力」から追加）</td></tr>';
  body += dataRow('売上明細 合計', meiSaleByM, { rowStyle: 'font-weight:800', nameBg: '#dcfce7' });
  // 売上（チャネル別）
  body += sectionRow('売上（チャネル別）', '#dbeafe');
  chans.forEach(function (c) { body += salesRow(c); });
  body += dataRow('チャネル 合計', chanSaleByM, { rowStyle: 'font-weight:700', nameBg: '#eff6ff' });
  body += dataRow('売上 合計（明細＋チャネル）', saleByM, { rowStyle: 'font-weight:800', nameBg: '#dbeafe' });
  // 送料 合計（当月は入力欄＝手入力で上書き。CSV取込後は実数）
  var shT = 0;
  var shCells = months.map(function (m) {
    var mk = m.key; var v = d.shipByM[mk] || 0; shT += v;
    if (mk === curMonth) {
      return '<td onclick="smpProfitEditCell(this,\'' + mk + '\',\'__ship__\')" style="cursor:pointer;text-align:right;' + bd('background:#fffef5') + '">' + (v ? fmt(v) : '<span style="color:#cbd5e1">送料</span>') + '</td>';
    }
    return '<td style="text-align:right;' + bd() + '">' + fmt(v) + '</td>';
  }).join('');
  body += '<tr><td style="position:sticky;left:0;font-weight:700;' + bd('background:#fff') + '">送料 合計</td>' + shCells + '<td style="text-align:right;font-weight:700;' + bd('background:#f8fafc') + '">' + fmt(shT) + '</td></tr>';
  // 手数料 合計（当月は手入力で上書き。CSV取込後は実数＝落札システム利用料/手数料）
  var feT = 0;
  var feCells = months.map(function (m) {
    var mk = m.key; var v = d.feeByM[mk] || 0; feT += v;
    if (mk === curMonth) {
      return '<td onclick="smpProfitEditCell(this,\'' + mk + '\',\'__fee__\')" style="cursor:pointer;text-align:right;' + bd('background:#fffef5') + '">' + (v ? fmt(v) : '<span style="color:#cbd5e1">手数料</span>') + '</td>';
    }
    return '<td style="text-align:right;' + bd() + '">' + fmt(v) + '</td>';
  }).join('');
  body += '<tr><td style="position:sticky;left:0;font-weight:700;' + bd('background:#fff') + '">手数料 合計</td>' + feCells + '<td style="text-align:right;font-weight:700;' + bd('background:#f8fafc') + '">' + fmt(feT) + '</td></tr>';
  var gT = 0;
  var gCells = months.map(function (m) { var v = saleByM(m.key) - purByM(m.key) - (d.shipByM[m.key] || 0) - (d.feeByM[m.key] || 0); gT += v; return '<td style="text-align:right;font-weight:800;color:' + (v >= 0 ? '#166534' : '#dc2626') + ';' + bd('background:#ecfdf5') + '">' + fmt(v) + '</td>'; }).join('');
  body += '<tr><td style="position:sticky;left:0;font-weight:800;' + bd('background:#ecfdf5') + '">粗利（売上−仕入−送料−手数料）</td>' + gCells + '<td style="text-align:right;font-weight:800;color:' + (gT >= 0 ? '#166534' : '#dc2626') + ';' + bd('background:#d1fae5') + '">' + fmt(gT) + '</td></tr>';

  wrap.innerHTML =
    '<div style="font-size:11px;color:#92400e;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:6px 8px;margin-bottom:8px">黄色の列＝当月（' + curMonth + '）。ヤフオク1〜8・メルカリの空欄に<b>仮の数字</b>を入力できます。CSVを取り込むと自動で実数に切り替わります。</div>' +
    '<table style="border-collapse:collapse;font-size:11px;width:max-content;table-layout:auto"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
  try { smpProfitRenderEntry(); } catch (e) {}
}
function smpProfitExportCsv() {
  var sel = document.getElementById('smpProfitYear');
  var startYear = (sel && sel.value) ? parseInt(sel.value, 10) : smpProfitDefaultStartYear();
  var d = smpProfitData(startYear);
  var prov = smpProfitProvGet();
  var curMonth = today().slice(0, 7);
  var provShipE = (prov[curMonth] && prov[curMonth]['__ship__']);
  if (provShipE != null && provShipE !== '' && d.shipByM[curMonth] != null) d.shipByM[curMonth] = num(provShipE);
  var provFeeE = (prov[curMonth] && prov[curMonth]['__fee__']);
  if (provFeeE != null && provFeeE !== '' && d.feeByM[curMonth] != null) d.feeByM[curMonth] = num(provFeeE);
  var months = d.months;
  var totC = function (c) { return months.reduce(function (s, m) { return s + ((d.chanReal[c] && d.chanReal[c][m.key]) || 0); }, 0); };
  var others = Object.keys(d.chanReal).filter(function (c) { return SMP_SALES_CHANNELS.indexOf(c) < 0; }).sort(function (a, b) { return totC(b) - totC(a); });
  var chans = SMP_SALES_CHANNELS.concat(others);
  var saleEff = function (c, mk) { var real = (d.chanReal[c] && d.chanReal[c][mk]) || 0; if (real > 0) return real; if (mk === curMonth) return (prov[mk] && prov[mk][c]) || 0; return 0; };
  var vendors = Object.keys(d.venReal);
  var rows = [];
  rows.push(['区分'].concat(months.map(function (m) { return m.label; })).concat(['年計']));
  function pushRow(label, getter) { var t = 0; var a = [label]; months.forEach(function (m) { var v = Math.round(getter(m.key)); t += v; a.push(v); }); a.push(t); rows.push(a); }
  rows.push(['【仕入】']);
  vendors.forEach(function (v) { pushRow(v, function (mk) { return (d.venReal[v] && d.venReal[v][mk]) || 0; }); });
  d.meiPur.forEach(function (e) { pushRow((e.name || '(無名)') + ' ' + (e.date || ''), function (mk) { return e.mk === mk ? e.amount : 0; }); });
  var venPur = function (mk) { return vendors.reduce(function (s, v) { return s + ((d.venReal[v] && d.venReal[v][mk]) || 0); }, 0); };
  var meiPurM = function (mk) { return d.meiPur.reduce(function (s, e) { return s + (e.mk === mk ? e.amount : 0); }, 0); };
  pushRow('仕入 合計', function (mk) { return venPur(mk) + meiPurM(mk); });
  rows.push(['【売上明細】']);
  d.meiSales.forEach(function (e) { pushRow((e.name || '(無名)') + ' ' + (e.date || ''), function (mk) { return e.mk === mk ? e.amount : 0; }); });
  var meiSaleM = function (mk) { return d.meiSales.reduce(function (s, e) { return s + (e.mk === mk ? e.amount : 0); }, 0); };
  pushRow('売上明細 合計', meiSaleM);
  rows.push(['【売上（チャネル別）】']);
  chans.forEach(function (c) { pushRow(c, function (mk) { return saleEff(c, mk); }); });
  var chanSale = function (mk) { return chans.reduce(function (s, c) { return s + saleEff(c, mk); }, 0); };
  pushRow('売上 合計', function (mk) { return chanSale(mk) + meiSaleM(mk); });
  pushRow('送料 合計', function (mk) { return d.shipByM[mk] || 0; });
  pushRow('手数料 合計', function (mk) { return d.feeByM[mk] || 0; });
  pushRow('粗利', function (mk) { return chanSale(mk) + meiSaleM(mk) - venPur(mk) - meiPurM(mk) - (d.shipByM[mk] || 0) - (d.feeByM[mk] || 0); });
  csvDownload(rows, 'gross_profit_' + startYear + '.csv');
}

/* ===== 全体ダッシュボード（EC＋ヤフオク＋メルカリ＋明細の合算） ===== */
function smpProfitMonthTotals(month) {
  var y = parseInt(String(month).slice(0, 4), 10), m = parseInt(String(month).slice(5, 7), 10);
  var startYear = (m >= 3) ? y : y - 1;
  var d = smpProfitData(startYear);
  var prov = smpProfitProvGet();
  var cur = today().slice(0, 7);
  var provShip = (prov[cur] && prov[cur]['__ship__']);
  if (provShip != null && provShip !== '' && d.shipByM[cur] != null) d.shipByM[cur] = num(provShip);
  var provFee = (prov[cur] && prov[cur]['__fee__']);
  if (provFee != null && provFee !== '' && d.feeByM[cur] != null) d.feeByM[cur] = num(provFee);
  var chans = SMP_SALES_CHANNELS.concat(Object.keys(d.chanReal).filter(function (c) { return SMP_SALES_CHANNELS.indexOf(c) < 0; }));
  var saleEff = function (c, mk) { var real = (d.chanReal[c] && d.chanReal[c][mk]) || 0; if (real > 0) return real; if (mk === cur) return (prov[mk] && prov[mk][c]) || 0; return 0; };
  var sale = chans.reduce(function (s, c) { return s + saleEff(c, month); }, 0) + d.meiSales.reduce(function (s, e) { return s + (e.mk === month ? e.amount : 0); }, 0);
  var pur = Object.keys(d.venReal).reduce(function (s, v) { return s + ((d.venReal[v] && d.venReal[v][month]) || 0); }, 0) + d.meiPur.reduce(function (s, e) { return s + (e.mk === month ? e.amount : 0); }, 0);
  var exp = (d.shipByM[month] || 0) + (d.feeByM[month] || 0);
  return { sale: sale, pur: pur, exp: exp, profit: sale - pur - exp };
}
function smpRenderTotalDash() {
  var sel = document.getElementById('smpTotalMonth');
  if (sel && !sel.options.length) {
    var choices = (typeof smpBuildMonthChoices === 'function') ? smpBuildMonthChoices() : [today().slice(0, 7)];
    sel.innerHTML = choices.map(function (mm) { return '<option value="' + mm + '">' + smpMonthLabel(mm) + '</option>'; }).join('');
  }
  var M = (sel && sel.value) || today().slice(0, 7);
  var t = smpProfitMonthTotals(M);
  var set = function (id, v, color) { var el = document.getElementById(id); if (el) { el.textContent = v; if (color) el.style.color = color; } };
  set('smpTotalProfit', (t.profit >= 0 ? '+' : '') + yen(t.profit), t.profit >= 0 ? '#166534' : '#dc2626');
  set('smpTotalSub', '売上 ' + yen(t.sale) + ' − 仕入 ' + yen(t.pur) + ' − 経費 ' + yen(t.exp));
  set('smpTotalSale', yen(t.sale));
  set('smpTotalPur', yen(t.pur));
  set('smpTotalExp', yen(t.exp));
  var y = parseInt(String(M).slice(0, 4), 10), mm2 = parseInt(String(M).slice(5, 7), 10);
  var startYear = (mm2 >= 3) ? y : y - 1;
  var months = smpProfitFiscalMonths(startYear);
  var ys = 0, yp = 0, ye = 0;
  months.forEach(function (mo) { var tt = smpProfitMonthTotals(mo.key); ys += tt.sale; yp += tt.pur; ye += tt.exp; });
  var box = document.getElementById('smpTotalYearBox');
  if (box) box.innerHTML = '<div style="font-weight:800;margin-bottom:4px;color:#334155">' + startYear + '年度（3月〜翌2月）合計</div>総売上 ' + yen(ys) + '<br>総仕入 ' + yen(yp) + '<br>経費 ' + yen(ye) + '<br><b style="color:' + ((ys - yp - ye) >= 0 ? '#166534' : '#dc2626') + '">粗利 ' + yen(ys - yp - ye) + '</b>';
}

/* ===== 明細入力（販売先・日付・金額／通常の売上・仕入として保存） ===== */
function smpProfitEntryMonthVal() {
  var el = document.getElementById('smpProfitEntryMonth');
  if (el && el.value) return el.value;
  var m = today().slice(0, 7);
  if (el) el.value = m;
  return m;
}
var _smpProfitUnlocked = {};
function smpProfitToggleDetail(td) {
  try { var s = td.querySelector('.smp-meili'); if (s) s.style.display = (!s.style.display || s.style.display === 'none') ? 'inline' : 'none'; } catch (e) {}
}
function smpProfitEditCell(td, mk, chan) {
  if (td.querySelector('input')) return;
  var prov = smpProfitProvGet();
  var v = (prov[mk] && prov[mk][chan]); v = (v != null ? v : '');
  td.innerHTML = '<input type="text" inputmode="numeric" value="' + v + '" style="box-sizing:border-box;width:58px;text-align:right;border:1px solid #f59e0b;border-radius:4px;padding:1px 2px;font-size:10px" onblur="smpProfitSetProv(\'' + mk + '\',\'' + chan + '\',this.value)" onkeydown="if(event.key===\'Enter\'){this.blur();}">';
  var inp = td.querySelector('input'); if (inp) { inp.focus(); try { inp.select(); } catch (e) {} }
}
function smpProfitToggleNet(td) {
  var net = td.getAttribute('data-net'), gross = td.getAttribute('data-gross');
  if (net == null || gross == null) return;
  var f = function (n) { return (Math.round(+n) || 0).toLocaleString(); };
  if (td.getAttribute('data-mode') === 'net') { td.setAttribute('data-mode', 'gross'); td.innerHTML = f(gross); }
  else { td.setAttribute('data-mode', 'net'); td.innerHTML = '<span style="color:#b45309" title="手数料引き後">' + f(net) + '</span>'; }
}
function smpProfitToggleMonth(mk) {
  try {
    var spans = document.querySelectorAll('#smpProfitTableWrap .smp-meili[data-mk="' + mk + '"]');
    if (!spans.length) return;
    var show = (!spans[0].style.display || spans[0].style.display === 'none');
    spans.forEach(function (s) { s.style.display = show ? 'inline' : 'none'; });
  } catch (e) {}
}
function smpProfitUnlock(id) { _smpProfitUnlocked[id] = true; smpProfitRenderEntry(); }
function smpProfitSetShip(val) { smpProfitSetProv(today().slice(0, 7), '__ship__', val); }
function smpProfitListHtml(rows, kind) {
  if (!rows.length) return '<div style="color:#94a3b8;font-size:12px;padding:4px 0">明細はありません</div>';
  var label = kind === 'sale' ? '販売先' : '仕入先';
  return '<div style="max-height:260px;overflow-y:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<tr style="color:#94a3b8;font-size:11px"><th style="text-align:right;padding:3px 6px">金額</th><th style="text-align:left;padding:3px 6px">' + label + '</th><th style="text-align:left;padding:3px 6px">日付</th><th style="padding:3px 6px"></th></tr>' +
    rows.map(function (r) {
      var id = String(r.id || r.client || '');
      var name = r.name || r.shop || r.vendor || '';
      var amt = num(r.amount != null ? r.amount : (r.total != null ? r.total : r.price));
      var op = _smpProfitUnlocked[id]
        ? '<button onclick="smpProfitDeleteRow(\'' + kind + '\',\'' + id + '\')" style="border:1px solid #fecaca;background:#fef2f2;color:#dc2626;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer">🗑 削除</button>'
        : '<button onclick="smpProfitUnlock(\'' + id + '\')" style="border:1px solid #cbd5e1;background:#f8fafc;color:#475569;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer">🔒 ロック解除</button>';
      return '<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 6px;text-align:right;font-weight:700;white-space:nowrap">' + amt.toLocaleString() + '</td><td style="padding:4px 6px">' + smpEsc(name) + '</td><td style="padding:4px 6px;white-space:nowrap;color:#64748b">' + smpEsc(r.date || '') + '</td><td style="padding:4px 6px;text-align:right">' + op + '</td></tr>';
    }).join('') + '</table></div>';
}
/* ===== 販売先／買取先の登録・プルダウン ===== */
function smpPartnersGet() { try { var o = JSON.parse(localStorage.getItem('ribre_smp_partners_v1') || '{}') || {}; o.sales = o.sales || []; o.purchases = o.purchases || []; return o; } catch (e) { return { sales: [], purchases: [] }; } }
function smpPartnersSet(o) { try { localStorage.setItem('ribre_smp_partners_v1', JSON.stringify(o)); } catch (e) {} }
function smpPartnersAdd(kind, name) {
  name = String(name || '').trim(); if (!name) return;
  var o = smpPartnersGet(); var k = (kind === 'sale') ? 'sales' : 'purchases';
  if (o[k].indexOf(name) < 0) { o[k].push(name); o[k].sort(function (a, b) { return String(a).localeCompare(String(b), 'ja'); }); smpPartnersSet(o); }
}
function smpPartnerOptions(kind) {
  var store = smpProfitMeiGet();
  var arr = (kind === 'sale') ? (store.sales || []) : (store.purchases || []);
  var names = {};
  arr.forEach(function (e) { var n = String(e.name || '').trim(); if (n) names[n] = 1; });
  var master = smpPartnersGet();
  (kind === 'sale' ? master.sales : master.purchases).forEach(function (n) { n = String(n || '').trim(); if (n) names[n] = 1; });
  return Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'ja'); });
}
function smpRenderPartnerSelects() {
  [['sale', 'smpPEntSaleShopSel', '販売先を選択'], ['purchase', 'smpPEntPurVendorSel', '買取先を選択']].forEach(function (p) {
    var sel = document.getElementById(p[1]); if (!sel) return;
    var keep = sel.value;
    var opts = smpPartnerOptions(p[0]);
    sel.innerHTML = '<option value="">（' + p[2] + '）</option>' + opts.map(function (n) { return '<option value="' + smpEsc(n) + '">' + smpEsc(n) + '</option>'; }).join('') + '<option value="__new__">＋ 新規入力</option>';
    if (keep && (keep === '__new__' || opts.indexOf(keep) >= 0)) sel.value = keep;
  });
}
function smpPartnerSelChange(kind) {
  var sel = document.getElementById(kind === 'sale' ? 'smpPEntSaleShopSel' : 'smpPEntPurVendorSel');
  var inp = document.getElementById(kind === 'sale' ? 'smpPEntSaleShop' : 'smpPEntPurVendor');
  if (!sel || !inp) return;
  if (sel.value === '__new__') { inp.style.display = ''; inp.value = ''; try { inp.focus(); } catch (e) {} }
  else { inp.style.display = 'none'; inp.value = ''; }
}
function smpProfitRenderEntry() {
  smpRenderPartnerSelects();
  var M = smpProfitEntryMonthVal();
  var cur = today().slice(0, 7);
  var inM = function (r) { return (r.month || String(r.date || r.sale_date || r.purchase_date || '').slice(0, 7)) === M; };
  var sIn = sales().filter(inM);
  var ec = sIn.reduce(function (a, r) { return a + num(r.amount != null ? r.amount : r.price); }, 0);
  var ecShip = sIn.reduce(function (a, r) { return a + num(r.ship != null ? r.ship : r.shipping); }, 0); // 送料
  var ecFee = sIn.reduce(function (a, r) { return a + num(r.fee); }, 0); // 手数料
  var prov = smpProfitProvGet();
  var provShip = (prov[cur] && prov[cur]['__ship__']);
  var provFee = (prov[cur] && prov[cur]['__fee__']);
  var expShip = (M === cur && provShip != null && provShip !== '') ? num(provShip) : ecShip;
  var expFee = (M === cur && provFee != null && provFee !== '') ? num(provFee) : ecFee;
  var exp = expShip + expFee;
  var net = (M === cur) ? (ec - exp) : ec;
  var ecEl = document.getElementById('smpProfitEcNet');
  if (ecEl) ecEl.innerHTML = 'EC売上 − 経費（' + M + '）：¥' + Math.round(net).toLocaleString() +
    '<span style="font-weight:600;font-size:12px;color:#475569"> ' + (M === cur ? '（当月：売上 ' + Math.round(ec).toLocaleString() + ' − 経費 ' + Math.round(exp).toLocaleString() + '）' : '（過去月：CSV取込値・経費考慮済み）') + '</span>';
  // 明細(専用ストア)＋通常データ(チャネル以外の売上・全仕入)を一覧表示し、どちらも削除可能に
  var store = smpProfitMeiGet();
  var meiInM = function (e) { return (e.month || String(e.date || '').slice(0, 7)) === M; };
  var inM = function (r) { return (r.month || String(r.date || r.sale_date || r.purchase_date || '').slice(0, 7)) === M; };
  var saleListable = function (r) { return SMP_SALES_CHANNELS.indexOf(String(r.shop || '').trim()) < 0; };
  var sl = document.getElementById('smpPEntSaleList'); if (sl) sl.innerHTML = smpProfitListHtml(store.sales.filter(meiInM).concat(sales().filter(inM).filter(saleListable)), 'sale');
  var pl = document.getElementById('smpPEntPurList'); if (pl) pl.innerHTML = smpProfitListHtml(store.purchases.filter(meiInM).concat(purchases().filter(inM)), 'purchase');
  var sd = document.getElementById('smpPEntSaleDate'); if (sd && !sd.value) sd.value = (M === cur ? today() : M + '-01');
  var pd = document.getElementById('smpPEntPurDate'); if (pd && !pd.value) pd.value = (M === cur ? today() : M + '-01');
}
function smpProfitAddSale() {
  var sel = document.getElementById('smpPEntSaleShopSel');
  var inp = document.getElementById('smpPEntSaleShop');
  var shop = (sel && sel.value && sel.value !== '__new__') ? sel.value : ((inp && inp.value) || '').trim();
  var date = document.getElementById('smpPEntSaleDate').value || (smpProfitEntryMonthVal() + '-01');
  var amt = num(document.getElementById('smpPEntSaleAmt').value || 0);
  if (!shop) { alert('販売先を選択または入力してください'); return; }
  if (!amt) { alert('金額を入力してください'); return; }
  smpPartnersAdd('sale', shop);
  var mei = smpProfitMeiGet();
  mei.sales.unshift({ id: 's_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), date: date, month: String(date).slice(0, 7), name: shop, amount: amt, up: Date.now() });
  smpProfitMeiSet(mei);
  if (sel) sel.value = ''; if (inp) { inp.value = ''; inp.style.display = 'none'; }
  document.getElementById('smpPEntSaleAmt').value = '';
  simpleRenderProfitTable();
}
function smpProfitAddPurchase() {
  var sel = document.getElementById('smpPEntPurVendorSel');
  var inp = document.getElementById('smpPEntPurVendor');
  var vendor = (sel && sel.value && sel.value !== '__new__') ? sel.value : ((inp && inp.value) || '').trim();
  var date = document.getElementById('smpPEntPurDate').value || (smpProfitEntryMonthVal() + '-01');
  var amt = num(document.getElementById('smpPEntPurAmt').value || 0);
  if (!vendor) { alert('買取先を選択または入力してください'); return; }
  if (!amt) { alert('金額を入力してください'); return; }
  smpPartnersAdd('purchase', vendor);
  var mei = smpProfitMeiGet();
  mei.purchases.unshift({ id: 'p_' + Date.now() + '_' + Math.floor(Math.random() * 1e6), date: date, month: String(date).slice(0, 7), name: vendor, amount: amt, up: Date.now() });
  smpProfitMeiSet(mei);
  if (sel) sel.value = ''; if (inp) { inp.value = ''; inp.style.display = 'none'; }
  document.getElementById('smpPEntPurAmt').value = '';
  simpleRenderProfitTable();
}
function smpProfitDeleteRow(kind, id) {
  if (!id) return;
  if (!confirm('この明細を削除します。よろしいですか？')) return;
  delete _smpProfitUnlocked[id];
  var mei = smpProfitMeiGet();
  var key = kind === 'sale' ? 'sales' : 'purchases';
  var before = (mei[key] || []).length;
  mei[key] = (mei[key] || []).filter(function (e) { return String(e.id) !== String(id); });
  if (mei[key].length !== before) {
    // 墓標を記録（他端末でもこの削除が維持され、同期で復活しない）
    mei.tomb = (mei.tomb && typeof mei.tomb === 'object') ? mei.tomb : {};
    mei.tomb[String(id)] = Date.now();
    smpProfitMeiSet(mei); // 明細ストアから削除
  } else {
    // 通常データ（売上一覧/ダッシュボード側）から削除
    var keep = function (r) { return String(r.id || r.client || '') !== String(id); };
    if (kind === 'sale') { setLS(LS.sales, sales().filter(keep)); try { setLS('ribre_yahoo_sales240', (get('ribre_yahoo_sales240', [])).filter(keep)); } catch (e) {} }
    else { setLS(LS.purchases, purchases().filter(keep)); }
    try { refreshAll(); } catch (e) {}
    smpScheduleAutosave('profit-delete');
  }
  simpleRenderProfitTable();
}

const SMP_TYPE_DEFAULTS = {
  sale: ['EC', '店頭', 'Book', '小売', '委託販売'],
  purchase: ['出張買取', '店頭買取', '宅配買取', '業者仕入']
};
function smpTypeKey(kind) { return kind === 'purchase' ? 'ribre_smp_purchase_types_v1' : 'ribre_smp_sale_types_v1'; }
function smpGetTypeOptions(kind) {
  try {
    const rows = JSON.parse(localStorage.getItem(smpTypeKey(kind)) || 'null');
    if (Array.isArray(rows) && rows.length) return rows;
  } catch (e) {}
  return (SMP_TYPE_DEFAULTS[kind] || []).slice();
}
function smpSetTypeOptions(kind, rows) {
  try { localStorage.setItem(smpTypeKey(kind), JSON.stringify((rows || []).filter(Boolean))); } catch (e) {}
}
function smpTypeSelectHtml(kind, selected) {
  const cur = String(selected || '');
  const opts = smpGetTypeOptions(kind);
  if (cur && opts.indexOf(cur) < 0) opts.unshift(cur);
  return opts.map(x => '<option value="' + smpEsc(x) + '"' + (x === cur ? ' selected' : '') + '>' + smpEsc(x) + '</option>').join('');
}
function smpRenderReportTypeOptions() {
  [
    ['sale', 'smpReportSaleType', 'smpSaleTypeTags'],
    ['purchase', 'smpReportPurchaseType', 'smpPurchaseTypeTags']
  ].forEach(([kind, selectId, tagsId]) => {
    const opts = smpGetTypeOptions(kind);
    const sel = document.getElementById(selectId);
    if (sel) sel.innerHTML = opts.map(x => '<option value="' + smpEsc(x) + '">' + smpEsc(x) + '</option>').join('');
    const tags = document.getElementById(tagsId);
    if (tags) tags.innerHTML = opts.map(x => '<span class="smp-type-tag ' + (kind === 'purchase' ? 'purchase' : '') + '">' + smpEsc(x) + '</span>').join('');
  });
}
function smpAddTypeOption(kind) {
  const id = kind === 'purchase' ? 'smpPurchaseTypeNew' : 'smpSaleTypeNew';
  const input = document.getElementById(id);
  const v = (input && input.value || '').trim();
  if (!v) return;
  const opts = smpGetTypeOptions(kind);
  if (opts.indexOf(v) < 0) opts.push(v);
  smpSetTypeOptions(kind, opts);
  if (input) input.value = '';
  smpRenderReportTypeOptions();
}
function smpSaleTax(r) {
  if (r.tax != null && r.tax !== '') return num(r.tax);
  return Math.floor(num(r.amount || r.price || 0) / 11);
}
function smpSaleProfit(r) {
  if (r.profit != null && r.profit !== '') return num(r.profit);
  return num(r.amount || r.price || 0) - num(r.fee) - num(r.ship || r.shipping);
}
function smpPurchaseTax(r) {
  if (r.tax != null && r.tax !== '') return num(r.tax);
  return Math.floor(num(r.total || r.amount || 0) / 11);
}
function smpRenderReportTables(sRows, pRows) {
  const saleTbl = document.getElementById('smpReportSalesTable');
  if (saleTbl) {
    saleTbl.innerHTML =
      '<thead><tr><th>No</th><th>日付</th><th>販売先</th><th>商品ID</th><th>内容</th><th>種別</th><th class="num">手数料</th><th class="num">送料</th><th class="num">消費税</th><th class="num">利益</th><th class="num">金額</th></tr></thead><tbody>' +
      (sRows || []).map((r, i) => {
        const id = smpSaleId(r);
        return '<tr><td>' + (i + 1) + '</td><td>' + smpEsc(r.date || '') + '</td><td>' + smpEsc(r.shop || '') + '</td><td>' + smpEsc(r.itemId || r.id || '') + '</td><td class="clip">' + smpEsc(r.name || '') + '</td>' +
          '<td><select onchange="smpSetSaleType(' + smpJs(id) + ', this.value)">' + smpTypeSelectHtml('sale', r.type || r.category || '') + '</select></td>' +
          '<td class="num">' + yen(r.fee || 0) + '</td><td class="num">' + yen(r.ship || r.shipping || 0) + '</td><td class="num">' + yen(smpSaleTax(r)) + '</td><td class="num">' + yen(smpSaleProfit(r)) + '</td><td class="num">' + yen(r.amount || r.price || 0) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  const purTbl = document.getElementById('smpReportPurchaseTable');
  if (purTbl) {
    purTbl.innerHTML =
      '<thead><tr><th>No</th><th>日付</th><th>仕入れ先</th><th class="num">金額</th><th class="num">消費税</th><th class="num">手数料</th><th>種別</th><th>メモ</th></tr></thead><tbody>' +
      (pRows || []).map((r, i) => {
        const id = String(r.id || '');
        return '<tr><td>' + (i + 1) + '</td><td>' + smpEsc(r.date || '') + '</td><td>' + smpEsc(r.vendor || '') + '</td><td class="num">' + yen(r.total || r.amount || 0) + '</td><td class="num">' + yen(smpPurchaseTax(r)) + '</td><td class="num">' + yen(r.fee || 0) + '</td>' +
          '<td><select onchange="smpSetPurchaseType(' + smpJs(id) + ', this.value)">' + smpTypeSelectHtml('purchase', r.type || '') + '</select></td><td>' + smpEsc(r.memo || '') + '</td></tr>';
      }).join('') + '</tbody>';
  }
}
function smpReportRowsForMonth() {
  const sel = document.getElementById('smpSummaryMonth');
  const month = (sel && sel.value) || smpSelectedMonth();
  const all = month === 'all';
  const inMonth = r => all || (r.month || String(r.date || '').slice(0, 7)) === month;
  return {
    salesRows: smpSortReportSalesRows(sales().filter(inMonth)),
    purchaseRows: purchases().filter(inMonth)
  };
}
function smpRenderReportRawTables(sRows, pRows) {
  if (!sRows || !pRows) {
    const rows = smpReportRowsForMonth();
    sRows = rows.salesRows;
    pRows = rows.purchaseRows;
  }
  const salesTbl = document.getElementById('smpReportRawSalesTable');
  if (salesTbl) {
    salesTbl.innerHTML =
      '<thead><tr><th>No</th><th>種別</th><th>日付</th><th>販売先</th><th>商品ID</th><th>金額</th><th>手数料</th><th>送料</th><th>状態</th><th>元データ</th></tr></thead><tbody>' +
      (sRows || []).map((r, i) => '<tr><td>' + (i + 1) + '</td><td>売上</td><td>' + smpEsc(r.date || '') + '</td><td>' + smpEsc(r.shop || '') + '</td><td>' + smpEsc(r.itemId || r.id || '') + '</td><td class="num">' + yen(r.amount || r.price || 0) + '</td><td class="num">' + yen(r.fee || 0) + '</td><td class="num">' + yen(r.ship || r.shipping || 0) + '</td><td>' + smpEsc(r.matchStatus || '') + '</td><td class="clip">' + smpEsc(r.source || r.memo || '') + '</td></tr>').join('') +
      '</tbody>';
  }
  const purchaseTbl = document.getElementById('smpReportRawPurchaseTable');
  if (purchaseTbl) {
    purchaseTbl.innerHTML =
      '<thead><tr><th>No</th><th>種別</th><th>日付</th><th>仕入れ先</th><th>内容</th><th>金額</th><th>状態</th><th>元データ</th></tr></thead><tbody>' +
      (pRows || []).map((r, i) => '<tr><td>' + (i + 1) + '</td><td>仕入</td><td>' + smpEsc(r.date || '') + '</td><td>' + smpEsc(r.vendor || '') + '</td><td class="clip">' + smpEsc(r.name || '') + '</td><td class="num">' + yen(r.total || r.amount || 0) + '</td><td>' + smpEsc(r.matchStatus || '') + '</td><td class="clip">' + smpEsc(r.source || r.memo || '') + '</td></tr>').join('') +
      '</tbody>';
  }
}
function smpSetSaleType(id, type) {
  const a = sales();
  const i = smpSaleIndexById(id);
  if (i < 0) return;
  a[i].type = type;
  setLS(LS.sales, a);
  smpScheduleAutosave('sale-type');
}
function smpSetPurchaseType(id, type) {
  const a = purchases();
  const i = smpPurIndexById(id);
  if (i < 0) return;
  a[i].type = type;
  setLS(LS.purchases, a);
  smpScheduleAutosave('purchase-type');
}
function smpShowReportOcr(kind) {
  const id = kind === 'purchase' ? 'smpReportPurchaseOcr' : 'smpReportSaleOcr';
  const panel = document.getElementById(id);
  if (panel) panel.style.display = 'block';
  smpBindReportOcrPaste(kind);
  const dateId = kind === 'purchase' ? 'smpReportPurchaseDate' : 'smpReportSaleDate';
  const d = document.getElementById(dateId);
  if (d && !d.value) d.value = smpMonthFirstDay(smpSelectedMonth());
}
function smpHideReportOcr(kind) {
  const id = kind === 'purchase' ? 'smpReportPurchaseOcr' : 'smpReportSaleOcr';
  const panel = document.getElementById(id);
  if (panel) panel.style.display = 'none';
}
function smpReportPrefix(kind) { return kind === 'purchase' ? 'smpReportPurchase' : 'smpReportSale'; }
function smpReportOcrFile(kind) {
  smpShowReportOcr(kind);
}
function smpBindReportOcrPaste(kind) {
  const pfx = smpReportPrefix(kind);
  const zone = document.getElementById(pfx + 'PasteZone');
  const sub = document.getElementById(pfx + 'PasteSub');
  const input = document.getElementById(pfx + 'File');
  if (!zone || !input || zone.dataset.pasteReady === '1') return;
  zone.dataset.pasteReady = '1';
  zone.addEventListener('click', () => zone.focus());
  zone.addEventListener('focus', () => zone.classList.add('active'));
  zone.addEventListener('blur', () => zone.classList.remove('active'));
  zone.addEventListener('paste', (event) => {
    const items = event.clipboardData && event.clipboardData.items ? event.clipboardData.items : [];
    let imageFile = null;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        imageFile = item.getAsFile();
        break;
      }
    }
    if (!imageFile) return;
    event.preventDefault();
    const ext = String(imageFile.type || 'image/png').split('/')[1] || 'png';
    const file = new File([imageFile], 'clipboard-' + Date.now() + '.' + ext, {
      type: imageFile.type || 'image/png',
      lastModified: Date.now()
    });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
    } catch (e) {
      alert('貼り付け画像をセットできませんでした。ファイル選択から追加してください。');
      return;
    }
    if (sub) sub.textContent = '貼り付け画像をセットしました。「AIで読み取る」を押してください';
    smpReportOcrFile(kind);
  });
}
function smpRunReportOcr(kind) {
  const pfx = smpReportPrefix(kind);
  const input = document.getElementById(pfx + 'File');
  const file = input && input.files && input.files[0];
  if (!file) { alert('画像・PDFを選んでください'); return; }
  const oF = document.getElementById('ocrFile'), oK = document.getElementById('ocrKind');
  if (!oF || !oK) { alert('OCR機能が見つかりません。ページを再読み込みしてください'); return; }
  oK.value = kind === 'purchase' ? 'purchase' : 'sale';
  try { const dt = new DataTransfer(); dt.items.add(file); oF.files = dt.files; } catch (e) {}
  try {
    registerEvidence();
    setTimeout(() => {
      try {
        runOcr();
        setTimeout(() => smpSyncReportOcrFields(kind), 4000);
      } catch (e) { alert('OCR読み取りに失敗しました。手入力してください。'); }
    }, 500);
  } catch (e) { alert('ファイル登録に失敗しました。手入力してください。'); }
}
function smpSyncReportOcrFields(kind) {
  const pfx = smpReportPrefix(kind);
  const g = id => { const el = document.getElementById(id); return el ? el.value : ''; };
  smpSetVal(pfx + 'Date', g('cDate') || smpMonthFirstDay(smpSelectedMonth()));
  smpSetVal(pfx + 'Partner', g('cVendor'));
  smpSetVal(pfx + 'Amount', g('cAmount'));
}
function smpAddReportRecord(kind) {
  const pfx = smpReportPrefix(kind);
  const date = (document.getElementById(pfx + 'Date') || {}).value || today();
  const partner = ((document.getElementById(pfx + 'Partner') || {}).value || '').trim();
  const amount = num((document.getElementById(pfx + 'Amount') || {}).value || 0);
  const tax = num((document.getElementById(pfx + 'Tax') || {}).value || 0);
  const fee = num((document.getElementById(pfx + 'Fee') || {}).value || 0);
  const type = ((document.getElementById(pfx + 'Type') || {}).value || '').trim();
  if (!amount) { alert('金額を入力してください'); return; }
  if (kind === 'purchase') {
    const a = purchases();
    a.unshift({ id: 'p_' + Date.now(), date, month: date.slice(0, 7), vendor: partner || 'その他', name: type || '仕入', total: amount, tax, fee, type, memo: 'OCR追加', source: 'simple-report-ocr' });
    setLS(LS.purchases, a);
  } else {
    const a = sales();
    a.unshift({ id: 's_' + Date.now(), date, month: date.slice(0, 7), shop: partner || 'その他', name: type || '売上', amount, tax, fee, shipping: 0, ship: 0, type, memo: 'OCR追加', source: 'simple-report-ocr' });
    setLS(LS.sales, a);
  }
  smpHideReportOcr(kind);
  simpleRenderSummary();
  smpRenderHome();
  smpScheduleAutosave('report-ocr');
}
function smpMonthStats(month) {
  const s = sales().filter(r => (r.month || String(r.date || '').slice(0, 7)) === month);
  const p = purchases().filter(r => (r.month || String(r.date || '').slice(0, 7)) === month);
  const sale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
  const fee = s.reduce((a, r) => a + num(r.fee), 0);
  const ship = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const pur = p.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit = sale - fee - ship - pur;
  const tax = Math.floor(sale / 11);
  return { month, sale, fee, ship, pur, profit, tax, count: s.length };
}
function smpMonthsAround(baseMonth, count) {
  const base = /^\d{4}-\d{2}$/.test(String(baseMonth || '')) ? baseMonth : today().slice(0, 7);
  const d = new Date(base + '-01T00:00:00');
  const rows = [];
  for (let i = count - 1; i >= 0; i--) {
    const x = new Date(d);
    x.setMonth(x.getMonth() - i);
    rows.push(x.toISOString().slice(0, 7));
  }
  return rows;
}
function smpQuarterStats(baseMonth) {
  const months = smpMonthsAround(baseMonth, 12);
  const qs = [
    { label: '1Q', rows: months.slice(0, 3) },
    { label: '2Q', rows: months.slice(3, 6) },
    { label: '3Q', rows: months.slice(6, 9) },
    { label: '4Q', rows: months.slice(9, 12) }
  ];
  return qs.map(q => {
    const stats = q.rows.map(smpMonthStats);
    return {
      label: q.label,
      sale: stats.reduce((a, x) => a + x.sale, 0),
      profit: stats.reduce((a, x) => a + x.profit, 0)
    };
  });
}
function smpDrawBarChart(canvasId, bars, maxVal) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth || 320;
  const H = 190;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 22, r: 10, t: 22, b: 34 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const max = Math.max(1, maxVal || Math.max(...bars.map(b => Math.abs(b.value))));
  ctx.strokeStyle = '#e2e8f0';
  ctx.beginPath(); ctx.moveTo(pad.l, pad.t + chartH); ctx.lineTo(W - pad.r, pad.t + chartH); ctx.stroke();
  const gap = 8;
  const bw = Math.max(12, Math.min(34, (chartW - gap * (bars.length - 1)) / bars.length));
  const start = pad.l + Math.max(0, (chartW - (bw * bars.length + gap * (bars.length - 1))) / 2);
  bars.forEach((b, i) => {
    const h = Math.max(2, Math.abs(b.value) / max * chartH * 0.88);
    const x = start + i * (bw + gap);
    const y = pad.t + chartH - h;
    ctx.fillStyle = b.color || '#2563eb';
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, bw, h, [4, 4, 0, 0]); else ctx.rect(x, y, bw, h);
    ctx.fill();
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 10px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(b.short || Math.round(b.value / 10000) + '万', x + bw / 2, Math.max(10, y - 5));
    ctx.fillStyle = '#64748b';
    ctx.fillText(b.label, x + bw / 2, H - 12);
  });
}
function smpRenderReportCharts(month) {
  const base = month === 'all' ? (smpDataMonths().sort().reverse()[0] || today().slice(0, 7)) : month;
  const qs = smpQuarterStats(base);
  const qBars = [];
  qs.forEach(q => {
    qBars.push({ label: q.label + '売上', value: q.sale, color: '#2563eb' });
    qBars.push({ label: q.label + '利益', value: q.profit, color: q.profit >= 0 ? '#16a34a' : '#dc2626' });
  });
  smpDrawBarChart('smpQuarterChart', qBars);
  const months = smpMonthsAround(base, 12);
  const yBars = months.map(m => {
    const st = smpMonthStats(m);
    return { label: Number(m.slice(5)) + '月', value: st.sale, color: '#2563eb' };
  });
  const cur = smpMonthStats(base);
  yBars.push({ label: Number(base.slice(5)) + '月税', value: cur.tax, color: '#f59e0b', short: Math.round(cur.tax / 10000) + '万' });
  smpDrawBarChart('smpYearChart', yBars);
}
function smpHtmlCell(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function smpExportReportExcel() {
  const sel = document.getElementById('smpSummaryMonth');
  const month = (sel && sel.value) || smpSelectedMonth();
  const all = month === 'all';
  const inMonth = r => all || (r.month || String(r.date || '').slice(0, 7)) === month;
  const sRows = smpSortReportSalesRows(sales().filter(inMonth));
  const pRows = purchases().filter(inMonth);
  const st = all ? null : smpMonthStats(month);
  const totalSale = sRows.reduce((a, r) => a + num(r.amount || r.price), 0);
  const totalFee = sRows.reduce((a, r) => a + num(r.fee), 0);
  const totalShip = sRows.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const totalPur = pRows.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit = totalSale - totalFee - totalShip - totalPur;
  const tax = st ? st.tax : Math.floor(totalSale / 11);
  const sheetStyle = '<style>body{font-family:Yu Gothic,Meiryo,sans-serif}table{border-collapse:collapse;margin:12px 0}th{background:#eaf1fb}th,td{border:1px solid #cbd5e1;padding:6px 8px;white-space:nowrap}.num{text-align:right}.title{font-size:18px;font-weight:900}</style>';
  const summary = [
    ['対象月', all ? '全期間' : smpMonthLabel(month)],
    ['売上', totalSale],
    ['税抜売上', totalSale - tax],
    ['消費税', tax],
    ['仕入', totalPur],
    ['手数料', totalFee],
    ['送料', totalShip],
    ['利益', profit],
    ['商品数', sRows.length],
    ['平均単価', sRows.length ? Math.round(totalSale / sRows.length) : 0]
  ];
  const table = rows => '<table>' + rows.map((r, i) => '<tr>' + r.map((c, j) => (i === 0 ? '<th' : '<td') + (typeof c === 'number' ? ' class="num"' : '') + '>' + smpHtmlCell(c) + (i === 0 ? '</th>' : '</td>')).join('') + '</tr>').join('') + '</table>';
  const salesRows = [['No', '日付', '販売先', '商品ID', '内容', '種別', '手数料', '送料', '消費税', '利益', '金額']]
    .concat(sRows.map((r, i) => [i + 1, r.date || '', r.shop || '', r.itemId || r.id || '', r.name || '', r.type || '', num(r.fee), num(r.ship || r.shipping), smpSaleTax(r), smpSaleProfit(r), num(r.amount || r.price)]));
  const purRows = [['No', '日付', '仕入れ先', '金額', '消費税', '手数料', '種別', 'メモ']]
    .concat(pRows.map((r, i) => [i + 1, r.date || '', r.vendor || '', num(r.total || r.amount), smpPurchaseTax(r), num(r.fee), r.type || '', r.memo || '']));
  const html = '<html><head><meta charset="utf-8">' + sheetStyle + '</head><body><div class="title">RIBRE 月次レポート</div>' + table(summary) + '<h2>売上明細</h2>' + table(salesRows) + '<h2>仕入明細</h2>' + table(purRows) + '</body></html>';
  const blob = new Blob(['\ufeff' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'RIBRE_売上仕入レポート_' + (all ? '全期間' : month) + '.xls';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
const SMP_SHIP_COPY_ACCS = ['ヤフオク1','ヤフオク2','ヤフオク3','ヤフオク4','ヤフオク5','ヤフオク6','ヤフオク7','ヤフオク8','メルカリShops'];
const SMP_REPORT_ACCS = ['ヤフオク1','ヤフオク2','ヤフオク3','ヤフオク4','ヤフオク5','ヤフオク6','ヤフオク7','ヤフオク8','メルカリShops','メルカリ','ラクマ','その他'];
function smpNormAccount(shop) {
  return String(shop || '')
    .replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/\s+/g, '');
}
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
function smpSaleNaturalKey(r) {
  return [
    r.date || '',
    r.shop || '',
    r.name || '',
    num(r.amount || r.price || 0),
    num(r.fee || 0),
    num(r.ship || r.shipping || 0),
    r.slip || '',
    r.order || '',
    r.memo || ''
  ].join('\u001f');
}
function smpSaleId(r) {
  const id = String(r.id || r.itemId || '');
  return id ? 'id:' + id : 'key:' + smpSaleNaturalKey(r);
}
function smpSaleDetailCell(label, value, cls) {
  return '<div class="smp-sale-detail">' +
    '<div class="smp-sale-detail-label">' + smpEsc(label) + '</div>' +
    '<div class="smp-sale-detail-value' + (cls ? ' ' + cls : '') + '">' + smpEsc(value) + '</div>' +
    '</div>';
}

const _smpUnlocked = new Set(); // 送料ロックを解除した売上id

/* 売上1行のHTML（最近の取引・一覧で共通） */
function smpSaleRowHtml(r, rowNo) {
  const id = smpSaleId(r);
  const shopNorm = smpNormAccount(r.shop);
  const known = SMP_ACCS.indexOf(shopNorm) >= 0;
  const opts = SMP_ACCS.map(a => `<option value="${a}"${shopNorm === a ? ' selected' : ''}>${a}</option>`).join('')
    + (known ? '' : `<option value="${smpEsc(r.shop || '')}" selected>${smpEsc(r.shop || '(未設定)')}</option>`);
  const needs = smpNeedsShip(r);
  const warn = needs ? '<span class="smp-ship-warn">⚠️送料未入力</span>' : '';
  const ship = num(r.ship || r.shipping || 0);
  const amount = num(r.amount || 0);
  const price = num(r.price || r.amount || 0);
  const fee = num(r.fee || 0);
  const profit = (r.profit !== undefined && r.profit !== '') ? num(r.profit) : (amount - fee - ship);
  const itemId = r.itemId || r.id || '';
  const detailHtml =
    '<div class="smp-sale-detail-grid">' +
    smpSaleDetailCell('商品No', rowNo || '-') +
    smpSaleDetailCell('商品ID', itemId || '-') +
    smpSaleDetailCell('手数料', yen(fee)) +
    smpSaleDetailCell('送料', yen(ship)) +
    smpSaleDetailCell('利益', yen(profit), profit < 0 ? 'profit-minus' : 'profit-plus') +
    smpSaleDetailCell('決済金額', yen(amount)) +
    smpSaleDetailCell('金額', yen(price)) +
    '</div>';
  const unlocked = _smpUnlocked.has(id);
  const editable = needs || unlocked;
  let shipCtrl;
  if (editable) {
    shipCtrl = '<input class="smp-ship-input" type="number" inputmode="numeric" placeholder="送料¥" value="' + (ship > 0 ? ship : '') + '" onchange="smpSetShip(' + smpJs(id) + ', this.value)">';
  } else {
    shipCtrl = '<span class="smp-ship-locked">送料 ' + yen(ship) + ' 🔒</span>' +
      '<button class="smp-ship-unlock" onclick="smpUnlockShip(' + smpJs(id) + ')">ロック解除</button>';
  }
  return '<div class="smp-recent-row' + (needs ? ' smp-need-ship' : '') + '">' +
    '<div class="smp-recent-info"><div class="smp-recent-name">' + smpEsc(r.name || '(無題)') + warn + '</div>' +
    '<div class="smp-recent-sub">' + (r.date || '') + ' / ' + yen(r.amount || r.price || 0) + '</div></div>' +
    (unlocked ? detailHtml : '') +
    '<div class="smp-recent-ctrls">' +
    (unlocked ? '<select class="smp-recent-acc" onchange="smpFixSaleAccount(' + smpJs(id) + ', this.value)">' + opts + '</select>' : '') +
    shipCtrl +
    (unlocked ? '<button class="smp-recent-del" onclick="smpDeleteSale(' + smpJs(id) + ')">🗑</button>' : '') +
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
  if (v > 0) a[i].matchStatus = '手入力';
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
    arr.forEach(r => { if (match(r)) { r.shipping = ship; r.ship = ship; r.profit = profit; if (ship > 0) r.matchStatus = '手入力'; } });
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {}
}

function smpRenderRecent() {
  const box = document.getElementById('smpRecentList');
  if (!box) return;
  const s = sales().slice(0, 20);
  if (!s.length) { box.innerHTML = '<div style="font-size:12px;color:#94a3b8">まだ売上がありません</div>'; return; }
  box.innerHTML = s.map((r, i) => smpSaleRowHtml(r, i + 1)).join('');
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
  const key = String(id || '');
  const targetId = key.indexOf('id:') === 0 ? key.slice(3) : '';
  const targetNatural = key.indexOf('key:') === 0 ? key.slice(4) : '';
  const a = sales();
  for (let i = 0; i < a.length; i++) {
    if (targetId && String(a[i].id || a[i].itemId || '') === targetId) return i;
    if (targetNatural && smpSaleNaturalKey(a[i]) === targetNatural) return i;
    if (!targetId && !targetNatural && smpSaleId(a[i]) === key) return i;
  }
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
  smpScheduleAutosave('edit');
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
function smpListToggle(view) {
  // view: 'dash'(EC集計ダッシュボード) | 'list'(EC売上リスト) | 'purchase'(仕入リスト)
  var isDash = view === 'dash';
  _smpListKind = (view === 'purchase') ? 'purchase' : 'sale';
  const sb = document.getElementById('smpListSaleBtn'), pb = document.getElementById('smpListPurBtn');
  if (sb) sb.classList.toggle('smp-choice-active', view === 'dash');
  if (pb) pb.classList.toggle('smp-choice-active', view !== 'dash');
  const dash = document.getElementById('smpListDash'); if (dash) dash.style.display = isDash ? 'block' : 'none';
  const showCtrls = (view === 'list');
  const fw = document.getElementById('smpListShipFilterWrap'); if (fw) fw.style.display = showCtrls ? 'flex' : 'none';
  const aw = document.getElementById('smpListAccWrap'); if (aw) aw.style.display = showCtrls ? 'block' : 'none';
  const mw = document.getElementById('smpListMonthWrap'); if (mw) mw.style.display = showCtrls ? 'block' : 'none';
  const cb = document.getElementById('smpListCsvBtn'); if (cb) cb.style.display = showCtrls ? 'block' : 'none';
  const sc = document.getElementById('smpListShipCopyBtn'); if (sc) sc.style.display = showCtrls ? 'block' : 'none';
  const ce = document.getElementById('smpListCount'); if (ce) ce.style.display = isDash ? 'none' : 'block';
  const lb = document.getElementById('smpListBox'); if (lb) lb.style.display = isDash ? 'none' : 'block';
  const t = document.getElementById('smpListTitle'); if (t) t.textContent = isDash ? '📊 EC集計' : (view === 'purchase' ? '🧾 仕入一覧' : '📋 売上一覧');
  if (isDash) { smpRenderEcDash(); }
  else { if (view !== 'purchase') smpListBuildMonths(); smpRenderList(); }
}
function smpEcDashMonthVal() {
  const s = document.getElementById('smpEcDashMonth');
  return (s && s.value) || today().slice(0, 7);
}
function smpRenderEcDash() {
  const sel = document.getElementById('smpEcDashMonth');
  if (sel && !sel.options.length) {
    const choices = smpBuildMonthChoices();
    sel.innerHTML = choices.map(function (mm) { return '<option value="' + mm + '">' + smpMonthLabel(mm) + '</option>'; }).join('');
  }
  const M = smpEcDashMonthVal();
  const cur = today().slice(0, 7);
  const inM = function (r) { return (r.month || String(r.date || '').slice(0, 7)) === M; };
  const rows = sales().filter(inM);
  const ec = rows.reduce(function (a, r) { return a + num(r.amount || r.price); }, 0);
  const exp = rows.reduce(function (a, r) { return a + num(r.fee) + num(r.ship || r.shipping); }, 0);
  const profit = ec - exp;
  const set = function (id, v, color) { const el = document.getElementById(id); if (el) { el.textContent = v; if (color) el.style.color = color; } };
  const ym = M.split('-');
  set('smpEcDashLabel', (M === cur ? '今月' : Number(ym[1]) + '月') + 'のEC粗利（EC売上−経費）');
  set('smpEcDashProfit', (profit >= 0 ? '＋' : '') + yen(profit), profit >= 0 ? '#15803d' : '#dc2626');
  set('smpEcDashSub', 'EC売上 ' + yen(ec) + ' − 経費 ' + yen(exp));
  set('smpEcDashSale', yen(ec));
  set('smpEcDashExp', yen(exp));
  set('smpEcDashCount', rows.length + '件');
  try { simpleRenderChart('smpEcChart', 'smpEcChartLabels', 'ec'); } catch (e) {}
}
function smpOpenList(view, shipOnly) {
  // 後方互換: 'sale'→集計(配送確認時はリスト) / 'purchase'→仕入リスト
  if (view === 'sale') view = shipOnly ? 'list' : 'dash';
  _smpListKind = (view === 'purchase') ? 'purchase' : 'sale';
  const so = document.getElementById('smpListShipOnly'); if (so) so.checked = !!shipOnly;
  simpleTab('list');
  smpListToggle(view);
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
  const accFilter = smpListAccFilter();
  let arr = smpVisibleSalesRows();
  if (countEl) {
    var ecSum = arr.reduce(function (a, r) { return a + num(r.amount || r.price); }, 0);
    var khSum = arr.reduce(function (a, r) { return a + num(r.fee) + num(r.ship || r.shipping); }, 0);
    countEl.innerHTML = arr.length + '件 ／ EC売上 ' + yen(ecSum) + ' − 経費 ' + yen(khSum) + ' ＝ <b style="color:#166534">' + yen(ecSum - khSum) + '</b>';
  }
  if (!arr.length) { box.innerHTML = '<div style="font-size:12px;color:#94a3b8">該当する売上はありません</div>'; return; }
  if (accFilter !== 'all') {
    box.innerHTML = arr.map((r, i) => smpSaleRowHtml(r, i + 1)).join('');
    return;
  }
  // すべて：アカウント順にまとめて見出し付きで表示
  let html = '', lastShop = null;
  arr.forEach((r, i) => {
    const shop = smpNormAccount(r.shop) || '(未設定)';
    if (shop !== lastShop) {
      const grp = arr.filter(x => (smpNormAccount(x.shop) || '(未設定)') === shop);
      const sub = grp.reduce((s, x) => s + num(x.amount || x.price), 0);
      html += '<div class="smp-acc-group">' + smpEsc(shop) + '<span class="smp-acc-count">' + grp.length + '件・' + yen(sub) + '</span></div>';
      lastShop = shop;
    }
    html += smpSaleRowHtml(r, i + 1);
  });
  box.innerHTML = html;
}

function smpListAccFilter() {
  return (document.getElementById('smpListAccFilter') || {}).value || 'all';
}
function smpListMonthFilter() {
  return (document.getElementById('smpListMonth') || {}).value || 'all';
}
function smpVisibleSalesRows() {
  let arr = sales();
  const so = document.getElementById('smpListShipOnly');
  if (so && so.checked) arr = arr.filter(smpNeedsShip);
  const accFilter = smpListAccFilter();
  if (accFilter !== 'all') arr = arr.filter(r => smpNormAccount(r.shop) === accFilter);
  const monFilter = smpListMonthFilter();
  if (monFilter !== 'all') arr = arr.filter(r => (r.month || String(r.date || '').slice(0, 7)) === monFilter);
  return smpSortByAccount(arr);
}

/* アカウント順（ヤフオク1〜8→メルカリ等）で並べ替え。同一アカウント内はCSV取込順を維持 */
function smpAccRank(shop) {
  const i = SMP_ACCS.indexOf(smpNormAccount(shop));
  return i < 0 ? 999 : i;
}
function smpCsvOrder(row, fallback) {
  const order = Number(row && row.order);
  return Number.isFinite(order) && order > 0 ? order : fallback;
}
function smpSortByAccount(arr) {
  return arr.map((row, idx) => ({ row, idx })).sort((a, b) => {
    const ra = smpAccRank(a.row.shop), rb = smpAccRank(b.row.shop);
    if (ra !== rb) return ra - rb;
    const oa = smpCsvOrder(a.row, a.idx + 1);
    const ob = smpCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map(x => x.row);
}

function smpSortReportSalesRows(arr) {
  return (arr || []).map((row, idx) => ({ row, idx })).sort((a, b) => {
    const ra = SMP_REPORT_ACCS.indexOf(smpNormAccount(a.row.shop));
    const rb = SMP_REPORT_ACCS.indexOf(smpNormAccount(b.row.shop));
    const aa = ra < 0 ? 999 : ra;
    const bb = rb < 0 ? 999 : rb;
    if (aa !== bb) return aa - bb;
    const oa = smpCsvOrder(a.row, a.idx + 1);
    const ob = smpCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map(x => x.row);
}

function smpSortShippingCopyRows(arr) {
  return (arr || []).map((row, idx) => ({ row, idx })).sort((a, b) => {
    const ra = SMP_SHIP_COPY_ACCS.indexOf(smpNormAccount(a.row.shop));
    const rb = SMP_SHIP_COPY_ACCS.indexOf(smpNormAccount(b.row.shop));
    const aa = ra < 0 ? 999 : ra;
    const bb = rb < 0 ? 999 : rb;
    if (aa !== bb) return aa - bb;
    const oa = smpCsvOrder(a.row, a.idx + 1);
    const ob = smpCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map(x => x.row);
}
async function smpWriteClipboardText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
async function smpCopyShippingOnly() {
  const status = document.getElementById('smpListCopyStatus');
  let arr = smpVisibleSalesRows();
  const acc = smpListAccFilter();
  if (acc === 'all') arr = arr.filter(r => SMP_SHIP_COPY_ACCS.indexOf(smpNormAccount(r.shop)) >= 0);
  arr = smpSortShippingCopyRows(arr);
  const lines = arr.map(r => String(num(r.ship || r.shipping || 0)));
  if (!lines.length) {
    if (status) status.textContent = 'コピーできる送料がありません';
    return;
  }
  const text = lines.join('\n');
  const ok = await smpWriteClipboardText(text);
  if (status) {
    const range = acc === 'all' ? 'ヤフオク1〜8・メルカリShops順' : acc;
    status.textContent = ok
      ? '送料だけコピーしました（' + lines.length + '件 / ' + range + '）'
      : 'コピーできませんでした。ブラウザの権限を確認してください';
  }
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
  let arr = smpVisibleSalesRows();
  const acc = smpListAccFilter();
  const mon = smpListMonthFilter();
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
function simpleRenderChart(canvasId, labelsId, mode) {
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

  const data = months.map(m => {
    if (mode === 'ec') {
      const s = sales().filter(r => (r.month || String(r.date || '').slice(0, 7)) === m);
      const sale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
      const exp = s.reduce((a, r) => a + num(r.fee) + num(r.ship || r.shipping), 0);
      return { month: m, sale: sale, pur: 0, profit: sale - exp };
    }
    const t = (typeof smpProfitMonthTotals === 'function') ? smpProfitMonthTotals(m) : { sale: 0, pur: 0, profit: 0 };
    return { month: m, sale: t.sale, pur: t.pur, profit: t.profit };
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

/* 画面に戻ってきたら明細・仮入力・目標をクラウドとマージして最新化
   （携帯⇔PCの行き来で古いまま操作して上書きする事故を防ぐ） */
var _smpLastFocusPull = 0;
document.addEventListener('visibilitychange', function () {
  try {
    if (document.visibilityState !== 'visible') return;
    if (!document.body.classList.contains('simple-mode')) return;
    if (!(typeof email === 'function' && email())) return;
    var now = Date.now();
    if (now - _smpLastFocusPull < 30000) return; // 30秒に1回まで
    _smpLastFocusPull = now;
    Promise.all([
      smpProfitMeiPullCloud().catch(function () { return false; }),
      smpProfitProvPullCloud().catch(function () { return false; }),
      smpGoalsPullCloud().catch(function () { return false; }),
      smpLockedPullCloud().catch(function () { return false; })
    ]).then(function (r) {
      if (r[0] || r[1] || r[2]) {
        try { simpleRenderProfitTable(); } catch (e) {}
        try { smpRenderHome(); } catch (e) {}
      }
      if (r[3]) { try { smpRenderLockUI(); } catch (e) {} }
    });
  } catch (e) {}
});

window.addEventListener('load', function() {
  smpInitMonthOptions();
  smpSyncMonthControls(smpSelectedMonth());
  smpBindFileLabels();
  smpInboxBindPaste();
  var oauth = false;
  try { oauth = smpHandleOAuthRedirect(); } catch (e) {}
  try {
    // フル画面は廃止。常にかんたんモードを有効化する。
    document.body.classList.add('simple-mode');
    try { localStorage.setItem('ribre_simple_mode', '1'); } catch (e) {}
    simpleTab('home');
    if (!oauth && typeof email === 'function' && email()) {
      setTimeout(() => smpLoadCloudToSimple({ quiet: true }), 800);
    }
  } catch(e) {}
  try { smpRenderAuth(); } catch (e) {}
});
