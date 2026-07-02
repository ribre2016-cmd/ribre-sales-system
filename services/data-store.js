/* =====================================================================
 * RIBRE Ver61.1 — Data Store v2
 * Supabaseを「データの正」にし、localStorageは表示用キャッシュにする層。
 *  - ログイン時: Supabase から sales/purchases を読込みキャッシュへ（hydrate）
 *  - 保存時(write-through): キャッシュ書込を検知し、変更行を「検証つき」でupsert/削除
 *  - 初期投入(seed)は自動では行わず、正しいPCで手動ボタンから1回だけ実行
 *  - ログアウト時はキャッシュを消去（auth-gate.js から呼ばれる）
 * 前回(v1)の事故対策: 桁外れ金額を弾く / 自動でローカルを押し上げない / 空クラウドで上書きしない
 * 依存: core.js(get/sb/sess/email/role/num/refreshAll/createLocalSnapshot)
 * ===================================================================== */
(function () {
  'use strict';

  var SALES_KEYS = ['ribre_full_sales221', 'ribre_yahoo_sales240'];
  var PURCHASE_KEYS = ['ribre_full_purchases221'];
  var DATA_CACHE_KEYS = [
    'ribre_full_sales221', 'ribre_yahoo_sales240', 'ribre_full_purchases221',
    'ribre_full_evidences221', 'ribre_full_candidates221',
    'ribre_store_synced_v1', 'ribre_store_hydrated_at'
  ];
  var SYNCED_KEY = 'ribre_store_synced_v1';
  var HYDRATED_AT = 'ribre_store_hydrated_at';
  var MAX_ROW_AMOUNT = 1000000000; // 1行あたり10億円超は異常値として弾く（3.5兆円事故対策）

  var nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
  var __hydrating = false;
  var __hydratedOnce = false; // この読込(セッション)で一度クラウドを読み込むまでは保存(push)しない＝古いローカルがクラウドを汚すのを防ぐ
  var __setupNeeded = false;
  var __authNeeded = false;
  var timers = { sales: null, purchases: null };
  var pushing = { sales: false, purchases: false };
  var lastSkipped = 0;

  function rawSet(k, v) { try { nativeSetItem(k, v); } catch (e) {} }

  // ---- 接続/認証 ------------------------------------------------------
  function cfg() { try { return (typeof sb === 'function') ? sb() : {}; } catch (e) { return {}; } }
  function token() {
    try { var s = (typeof sess === 'function') ? sess() : {}; return s.access_token || (s.session && s.session.access_token) || ''; }
    catch (e) { return ''; }
  }
  function mail() { try { return (typeof email === 'function') ? (email() || '') : ''; } catch (e) { return ''; } }
  function urole() { try { return (typeof role === 'function') ? (role() || 'staff') : 'staff'; } catch (e) { return 'staff'; } }
  function loggedIn() { return !!(mail() && token()); }
  function base() { return String(cfg().url || '').replace(/\/$/, ''); }
  function headers(extra) {
    var c = cfg();
    var o = { apikey: c.key, Authorization: 'Bearer ' + (token() || c.key), 'Content-Type': 'application/json' };
    if (extra) { for (var k in extra) o[k] = extra[k]; }
    return o;
  }
  async function api(path, opt) {
    opt = opt || {};
    var res = await fetch(base() + '/rest/v1/' + path, {
      method: opt.method || 'GET', headers: headers(opt.headers),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    var text = await res.text(); var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data: data, text: text };
  }
  // PostgRESTは1回の取得が最大1000件などに制限されるため、分割取得で全件読む
  async function fetchAllRows(table, emailEnc) {
    var all = [], page = 0, size = 1000, MAXP = 200;
    while (page < MAXP) {
      var r = await api(table + '?select=*&user_email=eq.' + emailEnc + '&order=client_id.asc&limit=' + size + '&offset=' + (page * size));
      if (!r.ok) return { ok: false, status: r.status, data: r.data, text: r.text };
      var rows = r.data || [];
      all = all.concat(rows);
      if (rows.length < size) break;
      page++;
    }
    return { ok: true, data: all };
  }

  // ---- ユーティリティ -------------------------------------------------
  function n(v) { try { return (typeof num === 'function') ? num(v) : (Number(v) || 0); } catch (e) { return Number(v) || 0; } }
  function arr(key) { try { return JSON.parse(window.localStorage.getItem(key) || '[]') || []; } catch (e) { return []; } }
  function stableJson(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(stableJson).join(',') + ']';
    return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + stableJson(o[k]); }).join(',') + '}';
  }
  function hashStr(s) { var h = 5381, i = s.length; while (i) { h = (h * 33) ^ s.charCodeAt(--i); } return (h >>> 0).toString(36); }
  function clientIdOf(x, prefix) {
    if (x && (x.id || x.client)) return String(x.client || x.id);
    return 'h_' + (prefix || '') + hashStr(stableJson(x || {}));
  }
  function loadSynced() { try { return JSON.parse(window.localStorage.getItem(SYNCED_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function saveSynced(o) { rawSet(SYNCED_KEY, JSON.stringify(o)); }

  // ---- 異常値チェック -------------------------------------------------
  function isSaneSale(out) {
    return Math.abs(n(out.amount)) <= MAX_ROW_AMOUNT &&
           Math.abs(n(out.fee)) <= MAX_ROW_AMOUNT &&
           Math.abs(n(out.shipping_fee)) <= MAX_ROW_AMOUNT &&
           Math.abs(n(out.profit)) <= MAX_ROW_AMOUNT;
  }
  function isSanePurchase(out) {
    return Math.abs(n(out.total)) <= MAX_ROW_AMOUNT &&
           Math.abs(n(out.cost)) <= MAX_ROW_AMOUNT &&
           Math.abs(n(out.shipping_fee)) <= MAX_ROW_AMOUNT;
  }

  // ---- mapping local <-> remote --------------------------------------
  function mapSaleOut(x) {
    var d = x.date || x.sale_date || null;
    return {
      user_email: mail(), user_role: urole(), client_id: clientIdOf(x, 's'),
      sale_date: d || null, month: x.month || (d ? String(d).slice(0, 7) : ''),
      market: x.market || '', account: x.shop || x.account || '',
      item_id: x.itemId || x.item_id || '', item_name: x.name || x.item_name || x.title || '',
      amount: n(x.amount), fee: n(x.fee), shipping_fee: n(x.shipping != null ? x.shipping : x.shipping_fee),
      profit: (x.profit != null && x.profit !== '') ? n(x.profit) : n(x.amount),
      slip_number: x.slip || x.slip_number || '', shipping_company: x.deliveryCompany || x.shipping_company || '',
      status: x.matchStatus || x.status || '', memo: x.memo || '',
      evidence_url: x.evidenceUrl || x.evidence_url || '', source: x.source || 'app'
    };
  }
  function mapSaleIn(x) {
    var cid = x.client_id || ('db_' + x.id);
    return {
      id: cid, client: cid, itemId: x.item_id || '', date: x.sale_date || '',
      month: x.month || String(x.sale_date || '').slice(0, 7), shop: x.account || x.market || '',
      name: x.item_name || '', amount: n(x.amount), fee: n(x.fee),
      shipping: n(x.shipping_fee), ship: n(x.shipping_fee), profit: n(x.profit),
      slip: x.slip_number || '', deliveryCompany: x.shipping_company || '',
      matchStatus: x.status || '', memo: x.memo || '', evidenceUrl: x.evidence_url || '', source: x.source || 'Supabase'
    };
  }
  function mapPurchaseOut(x) {
    var d = x.date || x.purchase_date || null;
    return {
      user_email: mail(), user_role: urole(), client_id: clientIdOf(x, 'p'),
      purchase_date: d || null, month: x.month || (d ? String(d).slice(0, 7) : ''),
      vendor: x.vendor || '', item_name: x.name || x.item_name || '',
      cost: n(x.cost != null ? x.cost : (x.total != null ? x.total : x.amount)),
      shipping_fee: n(x.shipping != null ? x.shipping : x.shipping_fee),
      total: n(x.total != null ? x.total : x.amount),
      invoice_number: x.invoiceNo || x.invoice_number || '', status: x.matchStatus || x.status || '',
      memo: x.memo || '', evidence_url: x.evidenceUrl || x.evidence_url || '', source: x.source || 'app'
    };
  }
  function mapPurchaseIn(x) {
    var cid = x.client_id || ('db_' + x.id);
    return {
      id: cid, client: cid, date: x.purchase_date || '',
      month: x.month || String(x.purchase_date || '').slice(0, 7), vendor: x.vendor || '',
      name: x.item_name || '', amount: n(x.total != null ? x.total : x.cost),
      total: n(x.total != null ? x.total : x.cost), cost: n(x.cost), shipping: n(x.shipping_fee),
      invoiceNo: x.invoice_number || '', matchStatus: x.status || '', memo: x.memo || '',
      evidenceUrl: x.evidence_url || '', source: x.source || 'Supabase'
    };
  }

  function canonical(kind) {
    if (kind === 'purchases') return arr('ribre_full_purchases221');
    var map = {};
    arr('ribre_yahoo_sales240').forEach(function (r) { map[clientIdOf(r, 's')] = r; });
    arr('ribre_full_sales221').forEach(function (r) { map[clientIdOf(r, 's')] = r; });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // ---- 変更検出（検証つき） -------------------------------------------
  function buildCurrent(kind) {
    var mapOut = kind === 'sales' ? mapSaleOut : mapPurchaseOut;
    var sane = kind === 'sales' ? isSaneSale : isSanePurchase;
    var cur = {}; var skipped = 0;
    canonical(kind).forEach(function (row) {
      var out = mapOut(row);
      if (!out.client_id) return;
      if (!sane(out)) { skipped++; return; } // 桁外れは送らない
      cur[out.client_id] = { out: out, hash: hashStr(stableJson(out)) };
    });
    lastSkipped = skipped;
    return cur;
  }

  async function upsert(table, rows) {
    return api(table + '?on_conflict=user_email,client_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: rows
    });
  }
  async function removeRows(table, cids) {
    var inlist = '(' + cids.map(function (c) { return '"' + String(c).replace(/[")(]/g, '') + '"'; }).join(',') + ')';
    return api(table + '?user_email=eq.' + encodeURIComponent(mail()) + '&client_id=in.' + encodeURIComponent(inlist),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }

  function handleErr(r) {
    if (!r) return;
    if (r.status === 401) { __authNeeded = true; note('再ログインしてください（クラウド保存は未反映）', 'warn'); return; }
    var msg = (r.data && r.data.message) || r.text || ('HTTP ' + r.status);
    if (/client_id|column|app_settings|schema cache|does not exist|relation/i.test(String(msg))) {
      __setupNeeded = true; note('Supabaseの初期SQL(supabase_store_setup.sql)を実行してください。', 'warn'); return;
    }
    note('クラウド保存エラー: ' + msg, 'danger');
  }

  async function reconcile(kind) {
    if (__hydrating || pushing[kind] || !loggedIn()) return { ok: false, reason: 'busy' };
    if (!__hydratedOnce) return { ok: false, reason: 'not-hydrated' }; // クラウド未読込のうちは保存しない（古いローカルでクラウドを上書き/重複させない）
    if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' }; // 別端末にログインされ無効化された端末は保存しない
    pushing[kind] = true;
    try {
      var cur = buildCurrent(kind);
      var synced = loadSynced(); var last = synced[kind] || {};
      var ups = [], cids = Object.keys(cur);
      cids.forEach(function (cid) { if (last[cid] !== cur[cid].hash) ups.push(cur[cid].out); });
      var dels = Object.keys(last).filter(function (cid) { return !cur[cid]; });
      // 大量削除ガード：壊れた/部分的/古いローカルキャッシュがクラウドの行を縮小させる事故を防ぐ。
      // 5件超 かつ 既存の20%超 の一括削除は異常とみなしスキップ（upsertは実施）。意図的な一括削除は seed で対応。
      var delsSkipped = false;
      if (dels.length > 5 && dels.length > Object.keys(last).length * 0.2) {
        note('安全のためクラウドの大量削除(' + dels.length + '件)を中止しました。正しいデータなら「クラウドから最新を取得」で読み直してください。', 'warn');
        dels = []; delsSkipped = true;
      }
      if (!ups.length && !dels.length) return { ok: true, upserted: 0, deleted: 0, delsSkipped: delsSkipped };
      if (ups.length) for (var i = 0; i < ups.length; i += 500) {
        var r = await upsert(kind, ups.slice(i, i + 500));
        if (!r.ok) { handleErr(r); return { ok: false, status: r.status }; }
      }
      if (dels.length) for (var j = 0; j < dels.length; j += 200) {
        var rd = await removeRows(kind, dels.slice(j, j + 200));
        if (!rd.ok) { handleErr(rd); return { ok: false, status: rd.status }; }
      }
      var fresh = {}; cids.forEach(function (cid) { fresh[cid] = cur[cid].hash; });
      synced[kind] = fresh; saveSynced(synced);
      __setupNeeded = false; __authNeeded = false;
      setStatus('保存OK（クラウド同期）' + (lastSkipped ? '／異常値' + lastSkipped + '件は除外' : ''));
      return { ok: true, upserted: ups.length, deleted: dels.length, delsSkipped: delsSkipped };
    } catch (e) { note('クラウド保存に失敗: ' + e.message, 'danger'); return { ok: false, error: e.message }; }
    finally { pushing[kind] = false; }
  }

  function schedule(kind) {
    if (!loggedIn()) return;
    if (timers[kind]) clearTimeout(timers[kind]);
    setStatus('クラウド保存中…');
    timers[kind] = setTimeout(function () { reconcile(kind); }, 900);
  }

  // ---- 安全な即時保存（write-through と同じ検証つきupsert/削除を使う） ----
  //  自動保存・手動保存ボタン共通の入口。reconcile() の大量削除ガード／
  //  hydrate前ガードを必ず通すため、replaceCloudWithLocal（無条件の完全置換・
  //  バックアップ復元専用）より安全。呼び出し側が結果を待って表示できるよう
  //  Promiseで返す。
  async function pushSafe() {
    if (!loggedIn()) return { ok: false, reason: 'not-logged-in' };
    if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
    if (!__hydratedOnce) return { ok: false, reason: 'not-hydrated' };
    var out = {};
    for (var ki = 0; ki < 2; ki++) {
      var kind = ki === 0 ? 'sales' : 'purchases';
      for (var w = 0; w < 20 && pushing[kind]; w++) { await new Promise(function (r) { setTimeout(r, 200); }); }
      var r = await reconcile(kind);
      out[kind] = r;
      if (r && r.ok === false && r.reason !== 'busy') {
        return { ok: false, status: r.status, error: r.error, reason: r.reason, kind: kind, result: out };
      }
    }
    return { ok: true, result: out };
  }

  // ---- hydrate: Supabase → キャッシュ（空クラウドでは上書きしない） ----
  async function hydrate() {
    if (!loggedIn()) return { ok: false, reason: 'not-logged-in' };
    __hydrating = true;
    try {
      var e = encodeURIComponent(mail());
      var rs = await fetchAllRows('sales', e);
      if (!rs.ok) { handleErr(rs); return { ok: false, status: rs.status }; }
      var rp = await fetchAllRows('purchases', e);
      if (!rp.ok) { handleErr(rp); return { ok: false, status: rp.status }; }

      var rawS = rs.data || [], rawP = rp.data || [];
      // クラウドが空で、端末にデータがある場合は上書きしない（初期投入前のデータ保護）
      if (rawS.length === 0 && rawP.length === 0 && (canonical('sales').length > 0 || canonical('purchases').length > 0)) {
        __hydratedOnce = true;
        return { ok: true, empty: true, sales: 0, purchases: 0, localHasData: true };
      }
      var sIn = rawS.map(mapSaleIn), pIn = rawP.map(mapPurchaseIn);
      rawSet('ribre_full_sales221', JSON.stringify(sIn));
      rawSet('ribre_yahoo_sales240', JSON.stringify(sIn));
      rawSet('ribre_full_purchases221', JSON.stringify(pIn));
      var synced = loadSynced();
      synced.sales = {}; sIn.forEach(function (r) { var o = mapSaleOut(r); synced.sales[o.client_id] = hashStr(stableJson(o)); });
      synced.purchases = {}; pIn.forEach(function (r) { var o = mapPurchaseOut(r); synced.purchases[o.client_id] = hashStr(stableJson(o)); });
      saveSynced(synced);
      rawSet(HYDRATED_AT, new Date().toLocaleString('ja-JP'));
      __setupNeeded = false; __authNeeded = false; __hydratedOnce = true;
      return { ok: true, sales: sIn.length, purchases: pIn.length };
    } catch (e) { note('クラウド読込に失敗: ' + e.message, 'danger'); return { ok: false, error: e.message }; }
    finally { __hydrating = false; }
  }

  // ---- seed: このPCのデータでSupabaseを初期化（手動・1回） -----------
  async function seedFromThisPC() {
    if (!loggedIn()) { alert('先にログインしてください'); return { ok: false }; }
    try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before seed to cloud'); } catch (e) {}
    setStatus('クラウドへ初期投入中…');
    var totalSkipped = 0, sent = { sales: 0, purchases: 0 };
    for (var ki = 0; ki < 2; ki++) {
      var kind = ki === 0 ? 'sales' : 'purchases';
      var cur = buildCurrent(kind);
      totalSkipped += lastSkipped;
      var rows = Object.keys(cur).map(function (cid) { return cur[cid].out; });
      sent[kind] = rows.length;
      for (var i = 0; i < rows.length; i += 500) {
        var r = await upsert(kind, rows.slice(i, i + 500));
        if (!r.ok) { handleErr(r); setStatus('初期投入に失敗'); return { ok: false }; }
      }
      var synced = loadSynced(); var fresh = {};
      Object.keys(cur).forEach(function (cid) { fresh[cid] = cur[cid].hash; });
      synced[kind] = fresh; saveSynced(synced);
    }
    __hydratedOnce = true;
    setStatus('初期投入OK（売上' + sent.sales + '／仕入' + sent.purchases + (totalSkipped ? '／異常値' + totalSkipped + '件除外' : '') + '）');
    return { ok: true, sent: sent, skipped: totalSkipped };
  }

  // ---- クラウドをこの端末の内容に「完全置き換え」（重複・余分を掃除） -----
  //  バックアップ復元など意図的な操作専用。大量削除ガードを通さず、cur(=ローカル)に
  //  無いクラウド行を削除し、curを upsert する。結果としてクラウド==ローカルになる。
  async function replaceCloudWithLocal() {
    if (!loggedIn()) return { ok: false, reason: 'not-logged-in' };
    if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
    var out = { sales: { up: 0, del: 0 }, purchases: { up: 0, del: 0 } };
    for (var ki = 0; ki < 2; ki++) {
      var kind = ki === 0 ? 'sales' : 'purchases';
      // 進行中の自動同期と衝突しないよう待つ
      for (var w = 0; w < 20 && pushing[kind]; w++) { await new Promise(function (r) { setTimeout(r, 200); }); }
      pushing[kind] = true;
      try {
        var cur = buildCurrent(kind);
        var curCids = {}; Object.keys(cur).forEach(function (c) { curCids[c] = 1; });
        var e = encodeURIComponent(mail());
        var rr = await fetchAllRows(kind, e);
        if (!rr.ok) { handleErr(rr); pushing[kind] = false; return { ok: false, status: rr.status }; }
        var cloudCids = (rr.data || []).map(function (x) { return x.client_id || ('db_' + x.id); });
        var ups = Object.keys(cur).map(function (c) { return cur[c].out; });
        for (var i = 0; i < ups.length; i += 500) {
          var u = await upsert(kind, ups.slice(i, i + 500));
          if (!u.ok) { handleErr(u); pushing[kind] = false; return { ok: false, status: u.status }; }
        }
        var dels = cloudCids.filter(function (c) { return c && !curCids[c]; });
        for (var j = 0; j < dels.length; j += 200) {
          var d = await removeRows(kind, dels.slice(j, j + 200));
          if (!d.ok) { handleErr(d); pushing[kind] = false; return { ok: false, status: d.status }; }
        }
        var synced = loadSynced(); var fresh = {}; Object.keys(cur).forEach(function (c) { fresh[c] = cur[c].hash; }); synced[kind] = fresh; saveSynced(synced);
        out[kind] = { up: ups.length, del: dels.length };
      } catch (er) { note('クラウド置き換え失敗: ' + er.message, 'danger'); pushing[kind] = false; return { ok: false, error: er.message }; }
      pushing[kind] = false;
    }
    __hydratedOnce = true;
    setStatus('クラウドを置き換えました（売上 ' + out.sales.up + '件・余分削除' + out.sales.del + '／仕入 ' + out.purchases.up + '件・余分削除' + out.purchases.del + '）');
    return { ok: true, result: out };
  }

  // ---- ログアウト時にキャッシュ消去（auth-gate から呼ばれる） --------
  function clearCache() {
    __hydrating = true;
    try { DATA_CACHE_KEYS.forEach(function (k) { window.localStorage.removeItem(k); }); } catch (e) {}
    __hydrating = false;
    try { if (typeof refreshAll === 'function') refreshAll(); } catch (e) {}
  }

  // ---- 状態表示 -------------------------------------------------------
  function setStatus(msg) { try { var el = document.getElementById('storeStatus'); if (el) el.textContent = msg; } catch (e) {} }
  function note(msg, level) { try { console[(level === 'danger' ? 'error' : 'warn')]('[RIBRE store] ' + msg); } catch (e) {} setStatus(msg); }

  function renderSimpleIfActive() {
    try {
      if (!document.body.classList.contains('simple-mode')) return;
      if (typeof smpRenderHome === 'function') smpRenderHome();
      var act = document.querySelector('.smp-screen.smp-screen-active');
      if (act && act.dataset && act.dataset.screen === 'summary' && typeof simpleRenderSummary === 'function') simpleRenderSummary();
    } catch (e) {}
  }
  function afterHydrate(res) {
    if (res && res.ok && !res.empty) { try { if (typeof refreshAll === 'function') refreshAll(); } catch (e) {} renderSimpleIfActive(); setStatus('クラウド読込OK（' + res.sales + '件/' + res.purchases + '件）'); }
    else if (res && res.empty && res.localHasData) { setStatus('クラウドは空です。正しいPCなら「クラウドへ初期投入」を実行してください'); }
  }

  // ---- localStorage.setItem を funnel 化 ------------------------------
  window.localStorage.setItem = function (k, v) {
    nativeSetItem(k, v);
    try {
      if (__hydrating) return;
      if (SALES_KEYS.indexOf(k) >= 0) schedule('sales');
      else if (PURCHASE_KEYS.indexOf(k) >= 0) schedule('purchases');
    } catch (e) {}
  };

  // ---- 公開API -------------------------------------------------------
  window.ribreStore = {
    hydrate: function () { return hydrate().then(function (r) { afterHydrate(r); return r; }); },
    seedFromThisPC: seedFromThisPC,
    replaceCloudWithLocal: replaceCloudWithLocal,
    pushNow: function () { reconcile('sales'); reconcile('purchases'); },
    pushSafe: pushSafe,
    clearCache: clearCache,
    status: function () { return { loggedIn: loggedIn(), setupNeeded: __setupNeeded, authNeeded: __authNeeded, hydratedAt: window.localStorage.getItem(HYDRATED_AT) || null }; }
  };

  // ---- 初期化 --------------------------------------------------------
  async function boot() {
    if (typeof window.signIn === 'function' && !window.__storeWrapSignIn) {
      var origSignIn = window.signIn;
      window.signIn = async function () { var r = await origSignIn.apply(this, arguments); setTimeout(function () { ribreStore.hydrate(); }, 400); return r; };
      window.__storeWrapSignIn = true;
    }
    if (!loggedIn()) { setStatus('未ログイン'); return; }
    var res = await hydrate(); afterHydrate(res);
  }

  if (window.__ribreStoreBooted) return;
  window.__ribreStoreBooted = true;
  window.addEventListener('load', function () { setTimeout(boot, 1800); });
})();
