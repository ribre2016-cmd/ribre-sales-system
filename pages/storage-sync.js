/* RIBRE — Storage sync split (ver320 + ver540) */

/* RIBRE — Storage/Cloud pages 移行（Phase2/3: ver320 の最終定義を pages 側へ集約） */
function ver320Logs() {
  try {
    return JSON.parse(localStorage.getItem('ribre_sync_logs320') || '[]');
  } catch (e) {
    return [];
  }
}
function ver320SaveLogs(arr) {
  localStorage.setItem('ribre_sync_logs320', JSON.stringify((arr || []).slice(0, 300)));
}
function ver320Render(rows) {
  const box = document.getElementById('autosyncList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + safeLevel(r.level) + '"><span>' + escHtml(r.msg) + '</span><span class="badge">' + escHtml(r.type) + '</span></div>')
    .join('');
}
function ver320Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver320Log(type, msg, level = 'ok') {
  const arr = ver320Logs();
  arr.unshift({ at: new Date().toLocaleString('ja-JP'), type: type, msg: msg, level: level, user: typeof email === 'function' ? email() : '' });
  ver320SaveLogs(arr);
}
function ver320Hash() {
  try {
    const payload = {
      sales: typeof sales === 'function' ? sales() : [],
      purchases: typeof purchases === 'function' ? purchases() : [],
      yahoo: JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]')
    };
    return JSON.stringify(payload).length + ':' + JSON.stringify(payload).slice(0, 200);
  } catch (e) {
    return String(Date.now());
  }
}
function ver320MarkDirty(reason) {
  localStorage.setItem('ribre_dirty320', '1');
  localStorage.setItem('ribre_dirty_reason320', reason || '変更あり');
  ver320Refresh();
}
function ver320ClearDirty() {
  localStorage.setItem('ribre_dirty320', '0');
  localStorage.setItem('ribre_last_hash320', ver320Hash());
}
function ver320Refresh() {
  const auto = localStorage.getItem('ribre_auto_sync320') === '1';
  const dirty = localStorage.getItem('ribre_dirty320') === '1';
  ver320Set('ver320AutoStatus', auto ? 'ON' : 'OFF');
  ver320Set('ver320DirtyStatus', dirty ? 'あり' : 'なし');
  ver320Set('ver320LastSync', localStorage.getItem('ribre_last_sync320') || 'なし');
}
function ver320ToggleAutoSync() {
  const now = localStorage.getItem('ribre_auto_sync320') === '1';
  localStorage.setItem('ribre_auto_sync320', now ? '0' : '1');
  ver320Refresh();
  ver320Render([{ type: '設定', msg: '自動同期を ' + (now ? 'OFF' : 'ON') + ' にしました' }]);
}
function ver320CheckDirty() {
  const last = localStorage.getItem('ribre_last_hash320') || '';
  const now = ver320Hash();
  const dirty = localStorage.getItem('ribre_dirty320') === '1' || last !== now;
  localStorage.setItem('ribre_dirty320', dirty ? '1' : '0');
  ver320Refresh();
  ver320Render([{ type: dirty ? '変更あり' : 'OK', level: dirty ? 'warn' : 'ok', msg: dirty ? '未同期の変更があります' : '未同期変更はありません' }]);
}
async function ver320SyncNow() {
  if (typeof email === 'function' && !email()) {
    alert('先にログインしてください');
    return;
  }
  if (typeof cloudCheck === 'function') {
    ver320Set('ver320SyncStatus', '接続確認中');
    try {
      await cloudCheck();
    } catch (e) {}
  }
  ver320Set('ver320SyncStatus', '同期中');
  const rows = [];
  try {
    if (typeof uploadSales === 'function') {
      await uploadSales();
      rows.push({ type: '売上', msg: '売上をクラウド同期しました' });
    }
    if (typeof uploadPurchases === 'function') {
      await uploadPurchases();
      rows.push({ type: '仕入', msg: '仕入をクラウド同期しました' });
    }
    const at = new Date().toLocaleString('ja-JP');
    localStorage.setItem('ribre_last_sync320', at);
    ver320ClearDirty();
    ver320Set('ver320SyncStatus', '同期OK');
    ver320Log('同期', 'クラウド同期完了');
    ver320Refresh();
    ver320Render(rows.concat([{ type: 'OK', msg: '同期完了：' + at }]));
  } catch (e) {
    ver320Set('ver320SyncStatus', 'エラー');
    ver320Log('ERROR', e.message, 'danger');
    ver320Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function ver320ShowSyncLogs() {
  const logs = ver320Logs();
  if (!logs.length) {
    ver320Render([{ type: 'INFO', level: 'warn', msg: '同期履歴はありません' }]);
    return;
  }
  ver320Render(logs.slice(0, 120).map((x) => ({ type: x.type, level: x.level, msg: x.at + ' / ' + x.user + ' / ' + x.msg })));
}
function ver320ExportSyncLogs() {
  const rows = [['日時', 'ユーザー', '区分', '内容', '状態']];
  ver320Logs().forEach((x) => rows.push([x.at, x.user, x.type, x.msg, x.level]));
  csvDownload(rows, 'sync_logs_Ver32_0.csv');
}
function ver320WrapChangeFunctions() {
  const names = ['addSale', 'addPurchase', 'ocrToSale', 'ocrToPurchase', 'ocrAutoRegister', 'importYahooSalesCsv', 'autoMatchShippingFromYahoo', 'ver250ImproveUnmatched'];
  names.forEach((name) => {
    if (typeof window[name] === 'function' && !window['__ver320_' + name]) {
      const old = window[name];
      window[name] = function () {
        const result = old.apply(this, arguments);
        ver320MarkDirty(name);
        if (localStorage.getItem('ribre_auto_sync320') === '1') {
          setTimeout(() => {
            try {
              ver320SyncNow();
            } catch (e) {}
          }, 1200);
        }
        return result;
      };
      window['__ver320_' + name] = true;
    }
  });
}

window.ver320ToggleAutoSync = ver320ToggleAutoSync;
window.ver320SyncNow = ver320SyncNow;
window.ver320CheckDirty = ver320CheckDirty;
window.ver320ShowSyncLogs = ver320ShowSyncLogs;
window.ver320ExportSyncLogs = ver320ExportSyncLogs;

window.addEventListener('load', () => {
  setTimeout(() => {
    ver320Refresh();
    ver320WrapChangeFunctions();
    ver320Render([{ type: '案内', msg: '自動同期をONにすると、登録後にクラウド保存を実行します' }]);
  }, 1600);
});

/* RIBRE — Storage/Cloud pages 移行（Phase5: ver540 の最終定義を pages 側へ集約） */
function ver540Render(rows) {
  const box = document.getElementById('sync54List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + safeLevel(r.level) + '"><span>' + escHtml(r.msg) + '</span><span class="badge">' + escHtml(r.type) + '</span></div>')
    .join('');
}
function ver540Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver540Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver540Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver540Email() {
  const s = ver540Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver540Headers(extra = {}) {
  const c = ver540Config(),
    s = ver540Session();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (token || c.key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    extra
  );
}
async function ver540Rest(table, query, method = 'GET', body = null) {
  const c = ver540Config();
  if (!c.url || !c.key) return { error: { message: 'Supabase設定なし' } };
  const s = ver540Session();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  if ((table === 'sync_logs' || table === 'audit_logs') && !token) {
    return { error: { message: '再ログインしてください' }, authRequired: true, status: 401 };
  }
  try {
    const res = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + table + query, {
      method: method,
      headers: ver540Headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) {
      if (res.status === 401) {
        return { error: { message: '再ログインしてください' }, authRequired: true, status: 401 };
      }
      return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    }
    return { data: data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
function ver540GetTimer() {
  return window.__ver540TimerPages || null;
}
function ver540SetTimer(timerId) {
  window.__ver540TimerPages = timerId || null;
}
function ver540HandleAuthRequired() {
  if (ver540GetTimer() || localStorage.getItem('ribre_sync_enabled540') === '1') {
    ver540StopSync();
  }
  ver540Set('ver540Status', '再ログイン必要');
  ver540Render([{ type: '認証', level: 'warn', msg: '再ログインしてください' }]);
}
function ver540Device() {
  const input = document.getElementById('ver540DeviceName');
  let d = (input && input.value ? input.value : '').trim();
  if (!d) {
    d = localStorage.getItem('ribre_device_name540') || 'device_' + Math.random().toString(36).slice(2, 8);
    if (input) input.value = d;
  }
  localStorage.setItem('ribre_device_name540', d);
  return d;
}
function ver540Sales() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]');
  } catch (e) {}
  return rows.slice(0, 5000);
}
function ver540Purchases() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]');
  } catch (e) {}
  return rows.slice(0, 5000);
}
function ver540SaveHistory(type, msg) {
  let h = [];
  try {
    h = JSON.parse(localStorage.getItem('ribre_sync_history540') || '[]');
  } catch (e) {}
  h.unshift({
    at: new Date().toLocaleString('ja-JP'),
    type: type,
    msg: msg
  });
  localStorage.setItem('ribre_sync_history540', JSON.stringify(h.slice(0, 300)));
}
function ver540Log(type, msg) {
  ver540SaveHistory(type, msg);
}
function ver540HistoryAdd(type, msg) {
  ver540SaveHistory(type, msg);
}
async function ver540Push() {
  const email = ver540Email();
  if (!email) {
    ver540HandleAuthRequired();
    return { authRequired: true };
  }
  const sales = ver540Sales();
  const purchases = ver540Purchases();

  const payload = {
    user_email: email,
    device_name: ver540Device(),
    synced_at: new Date().toISOString(),
    sales_count: sales.length,
    purchases_count: purchases.length,
    payload: {
      sales: sales,
      purchases: purchases
    }
  };

  const r = await ver540Rest('sync_logs', '', 'POST', [payload]);
  if (r.error) {
    if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
      ver540HandleAuthRequired();
      return { authRequired: true };
    }
    ver540Set('ver540Status', 'エラー');
    ver540Render([{ type: 'ERROR', level: 'danger', msg: r.error.message }]);
    return { authRequired: false };
  }

  localStorage.setItem('ribre_last_push540', JSON.stringify(payload));
  ver540SaveHistory('送信', 'sales ' + sales.length + '件 / purchases ' + purchases.length + '件');
  ver540Render([
    { type: '送信', msg: 'sales ' + sales.length + '件' },
    { type: '送信', msg: 'purchases ' + purchases.length + '件' },
    { type: '端末', msg: ver540Device() }
  ]);
  ver540Set('ver540Status', '送信OK');
  return { authRequired: false };
}
async function ver540Pull() {
  const email = ver540Email();
  if (!email) {
    ver540HandleAuthRequired();
    return { authRequired: true };
  }
  const r = await ver540Rest('sync_logs', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&order=synced_at.desc&limit=1');
  if (r.error) {
    if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
      ver540HandleAuthRequired();
      return { authRequired: true };
    }
    ver540Set('ver540Status', 'エラー');
    ver540Render([{ type: 'ERROR', level: 'danger', msg: r.error.message }]);
    return { authRequired: false };
  }

  const row = (r.data || [])[0];
  if (!row) {
    ver540Render([{ type: 'INFO', level: 'warn', msg: '同期データなし' }]);
    return { authRequired: false };
  }

  const payload = row.payload || {};
  if (typeof createLocalSnapshot === 'function') {
    createLocalSnapshot('before ver540 pull');
  }
  if (payload.sales) {
    localStorage.setItem('ribre_full_sales221', JSON.stringify(payload.sales));
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(payload.sales));
  }
  if (payload.purchases) {
    localStorage.setItem('ribre_full_purchases221', JSON.stringify(payload.purchases));
  }
  try {
    refreshAll();
  } catch (e) {}

  ver540SaveHistory('受信', 'sales ' + (payload.sales || []).length + '件');
  ver540Render([
    { type: '受信', msg: 'sales ' + (payload.sales || []).length + '件' },
    { type: '受信', msg: 'purchases ' + (payload.purchases || []).length + '件' },
    { type: '送信元', msg: row.device_name || 'unknown' }
  ]);
  ver540Set('ver540Status', '受信OK');
  return { authRequired: false };
}
async function ver540ManualSync() {
  ver540Set('ver540Status', '同期中');
  let authRequired = false;

  const autoPushEl = document.getElementById('ver540AutoPush');
  if (autoPushEl && autoPushEl.checked) {
    const r = await ver540Push();
    authRequired = authRequired || (r && r.authRequired);
  }
  const autoPullEl = document.getElementById('ver540AutoPull');
  if (!authRequired && autoPullEl && autoPullEl.checked) {
    const r = await ver540Pull();
    authRequired = authRequired || (r && r.authRequired);
  }
  if (authRequired) return;

  const now = new Date().toLocaleString('ja-JP');
  ver540Set('ver540LastSync', now);

  let c = Number(localStorage.getItem('ribre_sync_count540') || '0');
  c++;
  localStorage.setItem('ribre_sync_count540', String(c));
  ver540Set('ver540SyncCount', c + '回');
  ver540Set('ver540CurrentDevice', ver540Device());
}
function ver540StartSync() {
  const intervalEl = document.getElementById('ver540Interval');
  const sec = Number((intervalEl && intervalEl.value) || 30);

  const running = ver540GetTimer();
  if (running) clearInterval(running);

  ver540ManualSync();
  const timerId = setInterval(() => {
    ver540ManualSync();
  }, sec * 1000);
  ver540SetTimer(timerId);

  localStorage.setItem('ribre_sync_enabled540', '1');
  ver540Set('ver540Status', '自動同期中');
  ver540Render([
    { type: '開始', msg: '自動同期 ' + sec + '秒' },
    { type: '端末', msg: ver540Device() }
  ]);
}
function ver540StopSync() {
  const running = ver540GetTimer();
  if (running) clearInterval(running);
  ver540SetTimer(null);
  localStorage.setItem('ribre_sync_enabled540', '0');
  ver540Set('ver540Status', '停止');
  ver540Render([{ type: '停止', msg: '自動同期を停止しました' }]);
}
function ver540ShowHistory() {
  let h = [];
  try {
    h = JSON.parse(localStorage.getItem('ribre_sync_history540') || '[]');
  } catch (e) {}
  ver540Render(
    h.length
      ? h.map((x) => ({
          type: x.type,
          msg: x.at + ' / ' + x.msg
        }))
      : [{ type: 'INFO', level: 'warn', msg: '履歴なし' }]
  );
}

window.ver540Render = ver540Render;
window.ver540Rest = ver540Rest;
window.ver540HandleAuthRequired = ver540HandleAuthRequired;
window.ver540Push = ver540Push;
window.ver540Pull = ver540Pull;
window.ver540ManualSync = ver540ManualSync;
window.ver540StartSync = ver540StartSync;
window.ver540StopSync = ver540StopSync;
window.ver540ShowHistory = ver540ShowHistory;
window.ver540Log = ver540Log;
window.ver540SaveHistory = ver540SaveHistory;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver540InitDone) return;
      window.__ver540InitDone = true;
      const d = localStorage.getItem('ribre_device_name540');
      const input = document.getElementById('ver540DeviceName');
      if (d && input) input.value = d;
      ver540Set('ver540SyncCount', (localStorage.getItem('ribre_sync_count540') || '0') + '回');
      ver540Set('ver540CurrentDevice', d || '未設定');
      if (localStorage.getItem('ribre_sync_enabled540') === '1') {
        ver540StartSync();
      }
    } catch (e) {}
  }, 1200);
});
