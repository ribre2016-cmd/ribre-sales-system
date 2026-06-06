/* RIBRE — Realtime Sync pages 移行（ver460-realtime-sync の最終定義を pages 側へ集約） */
function ver460GetTimer() {
  return window.__ver460Timer || null;
}
function ver460SetTimer(timerId) {
  window.__ver460Timer = timerId || null;
}
function ver460Render(rows) {
  const box = document.getElementById('realtime46List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 300)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver460Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver460Logs() {
  try {
    return JSON.parse(localStorage.getItem('ribre_realtime_logs460') || '[]');
  } catch (e) {
    return [];
  }
}
function ver460SaveLogs(arr) {
  localStorage.setItem('ribre_realtime_logs460', JSON.stringify(arr.slice(0, 500)));
}
function ver460Log(type, msg, level = 'ok') {
  const arr = ver460Logs();
  arr.unshift({ at: new Date().toLocaleString('ja-JP'), type, msg, level, device: ver460DeviceName() });
  ver460SaveLogs(arr);
}
function ver460Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver460Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver460Email() {
  const s = ver460Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver460Headers() {
  const c = ver460Config(),
    s = ver460Session();
  return {
    apikey: c.key,
    Authorization: 'Bearer ' + (s.access_token || c.key),
    'Content-Type': 'application/json'
  };
}
function ver460Url(table, query = '') {
  const c = ver460Config();
  if (!c.url || !c.key) {
    alert('Supabase設定がありません');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/rest/v1/' + table + query;
}
function ver460DeviceName() {
  const ua = navigator.userAgent || '';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) return 'Android';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Mac/i.test(ua)) return 'Mac';
  return 'Unknown';
}
async function ver460Rest(table, query) {
  const url = ver460Url(table, query);
  if (!url) return { error: { message: 'Supabase設定なし' } };
  try {
    const res = await fetch(url, { headers: ver460Headers() });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    return { data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
function ver460MapProdSales(rows) {
  return (rows || []).map((x) => ({
    id: x.item_id || x.id,
    itemId: x.item_id || '',
    date: x.sale_date || '',
    month: x.month || '',
    shop: x.account || x.market || '',
    name: x.item_name || '',
    amount: Number(x.amount || 0),
    fee: Number(x.fee || 0),
    shipping: Number(x.shipping_fee || 0),
    ship: Number(x.shipping_fee || 0),
    profit: Number(x.profit || 0),
    slip: x.slip_number || '',
    deliveryCompany: x.shipping_company || '',
    matchStatus: x.status || '本番DB',
    memo: x.memo || '',
    evidenceUrl: x.evidence_url || '',
    source: 'Supabase本番DB Ver60.0'
  }));
}
function ver460MapProdPurchases(rows) {
  return (rows || []).map((x) => ({
    id: x.id || ('p_' + (x.purchase_date || '') + '_' + (x.item_name || '')),
    date: x.purchase_date || '',
    month: x.month || String(x.purchase_date || '').slice(0, 7),
    vendor: x.vendor || '',
    name: x.item_name || '',
    amount: Number(x.total || x.cost || 0),
    total: Number(x.total || x.cost || 0),
    invoiceNo: x.invoice_number || '',
    matchStatus: x.status || '本番DB',
    memo: x.memo || '',
    source: 'Supabase本番DB Ver60.0'
  }));
}
async function ver460LoadNow() {
  const email = ver460Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  ver460Set('ver460Watch', '読込中');
  const sales = await ver460Rest('sales', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=10000&order=updated_at.desc');
  const purchases = await ver460Rest('purchases', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=10000&order=updated_at.desc');
  if (sales.error || purchases.error) {
    const msg = (sales.error || purchases.error).message;
    ver460Set('ver460Watch', 'エラー');
    ver460Log('ERROR', msg, 'danger');
    ver460Render([{ type: 'ERROR', level: 'danger', msg }]);
    return;
  }
  const mapped = ver460MapProdSales(sales.data || []);
  const mappedPurchases = ver460MapProdPurchases(purchases.data || []);
  localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(mapped));
  localStorage.setItem('ribre_full_sales221', JSON.stringify(mapped));
  localStorage.setItem('ribre_full_purchases221', JSON.stringify(mappedPurchases));
  localStorage.setItem('ribre_prod_sales460', JSON.stringify(sales.data || []));
  localStorage.setItem('ribre_prod_purchases460', JSON.stringify(purchases.data || []));
  const at = new Date().toLocaleString('ja-JP');
  localStorage.setItem('ribre_realtime_last460', at);
  ver460Set('ver460Sales', (sales.data || []).length + '件');
  ver460Set('ver460Last', at);
  ver460Set('ver460Watch', '読込OK');
  try {
    refreshAll();
  } catch (e) {}
  ver460Log('読込', '本番DBから売上 ' + (sales.data || []).length + '件 / 仕入 ' + (purchases.data || []).length + '件を読込');
  ver460Render([
    { type: '売上', msg: '本番DB売上 ' + (sales.data || []).length + '件を読込' },
    { type: '仕入', msg: '本番DB仕入 ' + (purchases.data || []).length + '件を読込' },
    { type: '端末', msg: ver460DeviceName() + ' で同期しました' }
  ]);
}
function ver460Refresh() {
  const auto = localStorage.getItem('ribre_auto_reload460') === '1';
  ver460Set('ver460Auto', auto ? 'ON' : 'OFF');
  ver460Set('ver460Last', localStorage.getItem('ribre_realtime_last460') || 'なし');
  const rows = JSON.parse(localStorage.getItem('ribre_prod_sales460') || '[]');
  ver460Set('ver460Sales', rows.length ? rows.length + '件' : '未読込');
}
function ver460ToggleAutoReload() {
  const now = localStorage.getItem('ribre_auto_reload460') === '1';
  localStorage.setItem('ribre_auto_reload460', now ? '0' : '1');
  ver460Refresh();
  if (now) ver460StopWatcher();
  else ver460StartWatcher();
}
function ver460StartWatcher() {
  const timer = ver460GetTimer();
  if (timer) clearInterval(timer);
  localStorage.setItem('ribre_auto_reload460', '1');
  ver460Set('ver460Auto', 'ON');
  ver460Set('ver460Watch', '監視中');
  ver460Render([{ type: '監視', msg: '60秒ごとに本番DBを確認します' }]);
  ver460SetTimer(
    setInterval(() => {
      try {
        ver460LoadNow();
      } catch (e) {}
    }, 60000)
  );
}
function ver460StopWatcher() {
  const timer = ver460GetTimer();
  if (timer) clearInterval(timer);
  ver460SetTimer(null);
  localStorage.setItem('ribre_auto_reload460', '0');
  ver460Set('ver460Auto', 'OFF');
  ver460Set('ver460Watch', '停止中');
  ver460Render([{ type: '監視', level: 'warn', msg: '自動読込を停止しました' }]);
}
function ver460ShowDeviceInfo() {
  ver460Render([
    { type: '端末', msg: ver460DeviceName() },
    { type: 'ログイン', msg: ver460Email() || '未ログイン' },
    { type: '使い方', msg: 'iPhoneで登録後、倉庫PC側で「今すぐ本番DB読込」を押すと反映されます' },
    { type: '自動', msg: '自動読込ONにすると60秒ごとに確認します' }
  ]);
}
function ver460ExportSyncLog() {
  const rows = [['日時', '端末', '種類', '内容', '状態']];
  ver460Logs().forEach((x) => rows.push([x.at, x.device, x.type, x.msg, x.level]));
  csvDownload(rows, 'realtime_sync_logs_Ver46_0.csv');
}

window.ver460GetTimer = ver460GetTimer;
window.ver460SetTimer = ver460SetTimer;
window.ver460Render = ver460Render;
window.ver460Set = ver460Set;
window.ver460Logs = ver460Logs;
window.ver460SaveLogs = ver460SaveLogs;
window.ver460Log = ver460Log;
window.ver460Config = ver460Config;
window.ver460Session = ver460Session;
window.ver460Email = ver460Email;
window.ver460Headers = ver460Headers;
window.ver460Url = ver460Url;
window.ver460DeviceName = ver460DeviceName;
window.ver460Rest = ver460Rest;
window.ver460MapProdSales = ver460MapProdSales;
window.ver460MapProdPurchases = ver460MapProdPurchases;
window.ver460LoadNow = ver460LoadNow;
window.ver460Refresh = ver460Refresh;
window.ver460ToggleAutoReload = ver460ToggleAutoReload;
window.ver460StartWatcher = ver460StartWatcher;
window.ver460StopWatcher = ver460StopWatcher;
window.ver460ShowDeviceInfo = ver460ShowDeviceInfo;
window.ver460ExportSyncLog = ver460ExportSyncLog;

if (!window.__ver460LoadInitBound) {
  window.__ver460LoadInitBound = true;
  window.addEventListener('load', () => {
    setTimeout(() => {
      ver460Refresh();
      if (localStorage.getItem('ribre_auto_reload460') === '1') ver460StartWatcher();
    }, 1500);
  });
}
