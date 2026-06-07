/* =====================================================================
 * RIBRE Ver61.0 — Data Store
 * Supabaseを「データの正」にし、localStorageは表示用キャッシュにする層。
 *  - 起動時/ログイン時: Supabase から sales/purchases を読み込みキャッシュへ（hydrate）
 *  - 保存時(write-through): キャッシュへの書き込みを検知し、変更行をSupabaseへ自動upsert／削除
 * 既存の sales()/purchases() 同期読み出しはそのまま利用できる（キャッシュを読むため）。
 * Supabase接続設定・ログインセッション・APIキーは端末保存のまま（クラウドに置かない）。
 * 依存: core.js(get/sb/sess/email/role/num/refreshAll/createLocalSnapshot)
 * ===================================================================== */
(function () {
  'use strict';

  var SALES_KEYS = ['ribre_full_sales221', 'ribre_yahoo_sales240'];
  var PURCHASE_KEYS = ['ribre_full_purchases221'];
  var SYNCED_KEY = 'ribre_store_synced_v1';   // {sales:{client_id:hash}, purchases:{...}}
  var HYDRATED_AT = 'ribre_store_hydrated_at';
  var SETTINGS_TABLE = 'app_settings';

  // 画面設定の同期対象（小さく安全なものだけ）。接続設定/セッション/APIキーは対象外。
  var SETTINGS_ALLOW = [
    'ribre_storage_bucket400',
    'ribre_auto_sync320',
    'ribre_auto_reload460',
    'ribre_device_name540',
    'ribre_sync_enabled540'
  ];

  // ---- 状態 -----------------------------------------------------------
  var nativeSetItem = window.localStorage.setItem.bind(window.localStorage);
  var __hydrating = false;           // hydrate中はwrite-throughを止める
  var __setupNeeded = false;         // 初期SQL未実行
  var __authNeeded = false;          // 再ログイン必要
  var timers = { sales: null, purchases: null };
  var pushing = { sales: false, purchases: false };
  var settingTimer = null, pendingSettings = {};

  function rawSet(k, v) { try { nativeSetItem(k, v); } catch (e) {} }

  // ---- 接続/認証 ------------------------------------------------------
  function cfg() { try { return (typeof sb === 'function') ? sb() : {}; } catch (e) { return {}; } }
  function token() {
    try {
      var s = (typeof sess === 'function') ? sess() : {};
      return s.access_token || (s.session && s.session.access_token) || '';
    } catch (e) { return ''; }
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
      method: opt.method || 'GET',
      headers: headers(opt.headers),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    var text = await res.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    return { ok: res.ok, status: res.status, data: data, text: text };
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

  // ---- mapping local <-> remote --------------------------------------
  function mapSaleOut(x) {
    var d = x.date || x.sale_date || null;
    return {
      user_email: mail(), user_role: urole(),
      client_id: clientIdOf(x, 's'),
      sale_date: d || null,
      month: x.month || (d ? String(d).slice(0, 7) : ''),
      market: x.market || '',
      account: x.shop || x.account || '',
      item_id: x.itemId || x.item_id || '',
      item_name: x.name || x.item_name || x.title || '',
      amount: n(x.amount),
      fee: n(x.fee),
      shipping_fee: n(x.shipping != null ? x.shipping : x.shipping_fee),
      profit: (x.profit != null && x.profit !== '') ? n(x.profit) : n(x.amount),
      slip_number: x.slip || x.slip_number || '',
      shipping_company: x.deliveryCompany || x.shipping_company || '',
      status: x.matchStatus || x.status || '',
      memo: x.memo || '',
      evidence_url: x.evidenceUrl || x.evidence_url || '',
      source: x.source || 'app'
    };
  }
  function mapSaleIn(x) {
    var cid = x.client_id || ('db_' + x.id);
    return {
      id: cid, client: cid,
      itemId: x.item_id || '',
      date: x.sale_date || '',
      month: x.month || String(x.sale_date || '').slice(0, 7),
      shop: x.account || x.market || '',
      name: x.item_name || '',
      amount: n(x.amount), fee: n(x.fee),
      shipping: n(x.shipping_fee), ship: n(x.shipping_fee),
      profit: n(x.profit),
      slip: x.slip_number || '',
      deliveryCompany: x.shipping_company || '',
      matchStatus: x.status || '',
      memo: x.memo || '',
      evidenceUrl: x.evidence_url || '',
      source: x.source || 'Supabase'
    };
  }
  function mapPurchaseOut(x) {
    var d = x.date || x.purchase_date || null;
    return {
      user_email: mail(), user_role: urole(),
      client_id: clientIdOf(x, 'p'),
      purchase_date: d || null,
      month: x.month || (d ? String(d).slice(0, 7) : ''),
      vendor: x.vendor || '',
      item_name: x.name || x.item_name || '',
      cost: n(x.cost != null ? x.cost : (x.total != null ? x.total : x.amount)),
      shipping_fee: n(x.shipping != null ? x.shipping : x.shipping_fee),
      total: n(x.total != null ? x.total : x.amount),
      invoice_number: x.invoiceNo || x.invoice_number || '',
      status: x.matchStatus || x.status || '',
      memo: x.memo || '',
      evidence_url: x.evidenceUrl || x.evidence_url || '',
      source: x.source || 'app'
    };
  }
  function mapPurchaseIn(x) {
    var cid = x.client_id || ('db_' + x.id);
    return {
      id: cid, client: cid,
      date: x.purchase_date || '',
      month: x.month || String(x.purchase_date || '').slice(0, 7),
      vendor: x.vendor || '',
      name: x.item_name || '',
      amount: n(x.total != null ? x.total : x.cost),
      total: n(x.total != null ? x.total : x.cost),
      cost: n(x.cost),
      shipping: n(x.shipping_fee),
      invoiceNo: x.invoice_number || '',
      matchStatus: x.status || '',
      memo: x.memo || '',
      evidenceUrl: x.evidence_url || '',
      source: x.source || 'Supabase'
    };
  }

  // ---- 正規化されたキャッシュ（sales は full_sales ∪ yahoo を id で統合） ----
  function canonical(kind) {
    if (kind === 'purchases') return arr('ribre_full_purchases221');
    var map = {};
    arr('ribre_yahoo_sales240').forEach(function (r) { map[clientIdOf(r, 's')] = r; });
    arr('ribre_full_sales221').forEach(function (r) { map[clientIdOf(r, 's')] = r; }); // full_sales優先
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  // ---- 変更行の検出と送信 --------------------------------------------
  function buildCurrent(kind) {
    var mapOut = kind === 'sales' ? mapSaleOut : mapPurchaseOut;
    var cur = {};
    canonical(kind).forEach(function (row) {
      var out = mapOut(row);
      if (!out.client_id) return;
      cur[out.client_id] = { out: out, hash: hashStr(stableJson(out)) };
    });
    return cur;
  }

  async function upsert(table, rows) {
    return api(table + '?on_conflict=user_email,client_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: rows
    });
  }
  async function removeRows(table, cids) {
    var inlist = '(' + cids.map(function (c) { return '"' + String(c).replace(/[")(]/g, '') + '"'; }).join(',') + ')';
    return api(table + '?user_email=eq.' + encodeURIComponent(mail()) + '&client_id=in.' + encodeURIComponent(inlist),
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  }

  function handleErr(r, where) {
    if (!r) return;
    if (r.status === 401) { __authNeeded = true; note('再ログインしてください（保存はSupabaseに反映されていません）', 'warn'); return; }
    var msg = (r.data && r.data.message) || r.text || ('HTTP ' + r.status);
    if (/client_id|column|app_settings|schema cache|does not exist|relation/i.test(String(msg))) {
      __setupNeeded = true;
      note('Supabaseの初期SQL(supabase_store_setup.sql)を実行してください。', 'warn');
      return;
    }
    note('クラウド保存エラー: ' + msg, 'danger');
  }

  async function reconcile(kind) {
    if (__hydrating || pushing[kind]) return;
    if (!loggedIn()) return;
    pushing[kind] = true;
    try {
      var cur = buildCurrent(kind);
      var synced = loadSynced();
      var last = synced[kind] || {};
      var ups = [], cids = Object.keys(cur);
      cids.forEach(function (cid) { if (last[cid] !== cur[cid].hash) ups.push(cur[cid].out); });
      var dels = Object.keys(last).filter(function (cid) { return !cur[cid]; });

      if (!ups.length && !dels.length) { pushing[kind] = false; return; }

      if (ups.length) {
        // 大量時は分割
        for (var i = 0; i < ups.length; i += 500) {
          var r = await upsert(kind, ups.slice(i, i + 500));
          if (!r.ok) { handleErr(r, 'upsert ' + kind); pushing[kind] = false; return; }
        }
      }
      if (dels.length) {
        for (var j = 0; j < dels.length; j += 200) {
          var rd = await removeRows(kind, dels.slice(j, j + 200));
          if (!rd.ok) { handleErr(rd, 'delete ' + kind); pushing[kind] = false; return; }
        }
      }
      // 成功 → 同期済みスナップショット更新
      var fresh = {}; cids.forEach(function (cid) { fresh[cid] = cur[cid].hash; });
      synced[kind] = fresh; saveSynced(synced);
      __setupNeeded = false; __authNeeded = false;
      setStatus('保存OK（クラウド同期）');
    } catch (e) {
      note('クラウド保存に失敗: ' + e.message, 'danger');
    } finally {
      pushing[kind] = false;
    }
  }

  function schedule(kind) {
    if (!loggedIn()) return; // 未ログイン時はクラウド送信しない（端末キャッシュには保存済み）
    if (timers[kind]) clearTimeout(timers[kind]);
    setStatus('クラウド保存中…');
    timers[kind] = setTimeout(function () { reconcile(kind); }, 900);
  }

  // ---- hydrate: Supabase → キャッシュ --------------------------------
  async function hydrate() {
    if (!loggedIn()) return { ok: false, reason: 'not-logged-in' };
    __hydrating = true;
    try {
      var e = encodeURIComponent(mail());
      var rs = await api('sales?select=*&user_email=eq.' + e + '&limit=10000&order=updated_at.desc');
      if (!rs.ok) { handleErr(rs, 'hydrate sales'); return { ok: false, status: rs.status }; }
      var rp = await api('purchases?select=*&user_email=eq.' + e + '&limit=10000&order=updated_at.desc');
      if (!rp.ok) { handleErr(rp, 'hydrate purchases'); return { ok: false, status: rp.status }; }

      var sIn = (rs.data || []).map(mapSaleIn);
      var pIn = (rp.data || []).map(mapPurchaseIn);
      rawSet('ribre_full_sales221', JSON.stringify(sIn));
      rawSet('ribre_yahoo_sales240', JSON.stringify(sIn));
      rawSet('ribre_full_purchases221', JSON.stringify(pIn));

      var synced = loadSynced();
      synced.sales = {}; sIn.forEach(function (r) { var o = mapSaleOut(r); synced.sales[o.client_id] = hashStr(stableJson(o)); });
      synced.purchases = {}; pIn.forEach(function (r) { var o = mapPurchaseOut(r); synced.purchases[o.client_id] = hashStr(stableJson(o)); });
      saveSynced(synced);
      rawSet(HYDRATED_AT, new Date().toLocaleString('ja-JP'));
      __setupNeeded = false; __authNeeded = false;
      return { ok: true, sales: sIn.length, purchases: pIn.length };
    } catch (e) {
      note('クラウド読込に失敗: ' + e.message, 'danger');
      return { ok: false, error: e.message };
    } finally {
      __hydrating = false;
    }
  }

  // ---- 初回移行: 端末のローカルデータを先にSupabaseへ push ------------
  function hasLocalData() { return canonical('sales').length > 0 || canonical('purchases').length > 0; }
  function hasSyncedMarker() { var s = loadSynced(); return !!(s.sales || s.purchases); }

  async function initialMigrate() {
    try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before initial cloud migrate'); } catch (e) {}
    // last を空とみなして全件 upsert
    var ok = true;
    for (var ki = 0; ki < 2; ki++) {
      var kind = ki === 0 ? 'sales' : 'purchases';
      var cur = buildCurrent(kind);
      var rows = Object.keys(cur).map(function (cid) { return cur[cid].out; });
      if (!rows.length) { continue; }
      for (var i = 0; i < rows.length; i += 500) {
        var r = await upsert(kind, rows.slice(i, i + 500));
        if (!r.ok) { handleErr(r, 'migrate ' + kind); ok = false; break; }
      }
    }
    return ok;
  }

  // ---- 設定の同期（任意・失敗しても無視） ----------------------------
  function scheduleSetting(key, rawValue) {
    if (!loggedIn()) return;
    pendingSettings[key] = rawValue;
    if (settingTimer) clearTimeout(settingTimer);
    settingTimer = setTimeout(flushSettings, 1200);
  }
  async function flushSettings() {
    if (!loggedIn() || __setupNeeded) return;
    var keys = Object.keys(pendingSettings); pendingSettings = {};
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var body = [{ user_email: mail(), skey: k, value: readSettingJson(k) }];
      try {
        var r = await api(SETTINGS_TABLE + '?on_conflict=user_email,skey',
          { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: body });
        if (!r.ok && /app_settings|schema cache|relation|does not exist/i.test(r.text || '')) return; // 表が無ければ静かに終了
      } catch (e) { return; }
    }
  }
  function readSettingJson(k) {
    var raw = window.localStorage.getItem(k);
    if (raw == null) return null;
    try { return JSON.parse(raw); } catch (e) { return raw; } // 文字列はそのまま
  }
  async function hydrateSettings() {
    if (!loggedIn()) return;
    try {
      var r = await api(SETTINGS_TABLE + '?select=skey,value&user_email=eq.' + encodeURIComponent(mail()) + '&limit=1000');
      if (!r.ok) return;
      (r.data || []).forEach(function (row) {
        if (SETTINGS_ALLOW.indexOf(row.skey) < 0) return;
        var v = row.value;
        rawSet(row.skey, typeof v === 'string' ? v : JSON.stringify(v));
      });
    } catch (e) {}
  }

  // ---- 通知/状態表示（邪魔しない範囲で） -----------------------------
  function setStatus(msg) {
    try {
      var el = document.getElementById('storeStatus');
      if (el) el.textContent = msg;
    } catch (e) {}
  }
  function note(msg, level) {
    try { console[(level === 'danger' ? 'error' : 'warn')]('[RIBRE store] ' + msg); } catch (e) {}
    setStatus(msg);
  }

  function afterHydrate(res) {
    if (res && res.ok) { try { if (typeof refreshAll === 'function') refreshAll(); } catch (e) {} setStatus('クラウド読込OK（' + res.sales + '件/' + res.purchases + '件）'); }
    hydrateSettings();
  }

  // ---- localStorage.setItem を1か所のfunnelとしてラップ ---------------
  window.localStorage.setItem = function (k, v) {
    nativeSetItem(k, v);
    try {
      if (__hydrating) return;
      if (SALES_KEYS.indexOf(k) >= 0) schedule('sales');
      else if (PURCHASE_KEYS.indexOf(k) >= 0) schedule('purchases');
      else if (SETTINGS_ALLOW.indexOf(k) >= 0) scheduleSetting(k, v);
    } catch (e) {}
  };

  // ---- 公開API -------------------------------------------------------
  window.ribreStore = {
    hydrate: function () { return hydrate().then(function (r) { afterHydrate(r); return r; }); },
    pushNow: function () { reconcile('sales'); reconcile('purchases'); },
    status: function () { return { loggedIn: loggedIn(), setupNeeded: __setupNeeded, authNeeded: __authNeeded, hydratedAt: window.localStorage.getItem(HYDRATED_AT) || null }; }
  };

  // ---- 初期化 --------------------------------------------------------
  async function boot() {
    // ログイン/ログアウトをフックして hydrate
    if (typeof window.signIn === 'function' && !window.__storeWrapSignIn) {
      var origSignIn = window.signIn;
      window.signIn = async function () {
        var r = await origSignIn.apply(this, arguments);
        setTimeout(function () { ribreStore.hydrate(); }, 400);
        return r;
      };
      window.__storeWrapSignIn = true;
    }
    if (!loggedIn()) { setStatus('未ログイン（クラウド同期は停止中）'); return; }

    // 初回（このブラウザの未送信データがある／同期マーカー無し）→ 先に移行してから読込
    if (!hasSyncedMarker() && hasLocalData()) {
      setStatus('初回移行: 端末データをクラウドへ送信中…');
      var ok = await initialMigrate();
      if (!ok) { setStatus('初回移行に失敗（初期SQL未実行の可能性）。端末データは保持しています。'); return; }
    }
    var res = await hydrate();
    afterHydrate(res);
  }

  if (window.__ribreStoreBooted) return;
  window.__ribreStoreBooted = true;
  window.addEventListener('load', function () { setTimeout(boot, 1800); });
})();
