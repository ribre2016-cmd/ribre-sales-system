/* RIBRE — Storage/Cloud pages 移行（Phase1: ver290 の最終定義を pages 側へ集約） */
function ver290CreateBackup() {
  const snap = ver290Snapshot();
  const h = ver290Histories();
  h.unshift({
    id: 'backup_' + Date.now(),
    at: snap.exportedAtJp,
    salesCount: snap.sales.length || snap.yahooSales.length || 0,
    purchaseCount: snap.purchases.length,
    data: snap
  });
  ver290SaveHistories(h);
  ver290Refresh();
  ver290Set('ver290Status', '作成OK');
  ver290Render([
    { type: 'OK', msg: 'バックアップを作成しました' },
    { type: '売上', msg: '売上 ' + (snap.sales.length || snap.yahooSales.length || 0) + '件' },
    { type: '仕入', msg: '仕入 ' + snap.purchases.length + '件' }
  ]);
}
function ver290DownloadBackup() {
  const snap = ver290Snapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_sales_backup_Ver29_0_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  ver290Set('ver290Status', '保存OK');
  ver290Render([{ type: '保存', msg: 'バックアップJSONをダウンロードしました' }]);
}
function ver290RestoreBackup() {
  const file = document.getElementById('ver290BackupFile').files[0];
  if (!file) {
    alert('復元するJSONファイルを選択してください');
    return;
  }
  if (!confirm('現在のブラウザ内データをバックアップ内容で復元します。よろしいですか？')) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (data.sales) localStorage.setItem('ribre_full_sales221', JSON.stringify(data.sales));
      if (data.purchases) localStorage.setItem('ribre_full_purchases221', JSON.stringify(data.purchases));
      if (data.yahooSales) localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(data.yahooSales));
      if (data.shippingRows) localStorage.setItem('ribre_shipping_rows230', JSON.stringify(data.shippingRows));
      if (data.shippingResults) localStorage.setItem('ribre_shipping_results230', JSON.stringify(data.shippingResults));
      if (data.ocrCandidates) localStorage.setItem('ribre_ocr_candidates200', JSON.stringify(data.ocrCandidates));
      if (data.evidences) localStorage.setItem('ribre_full_evidences221', JSON.stringify(data.evidences));
      refreshAll();
      ver290Refresh();
      ver290Set('ver290Status', '復元OK');
      ver290Render([
        { type: '復元', msg: 'バックアップを復元しました' },
        { type: '売上', msg: '売上 ' + ((data.sales || []).length || (data.yahooSales || []).length) + '件' },
        { type: '仕入', msg: '仕入 ' + (data.purchases || []).length + '件' }
      ]);
    } catch (e) {
      ver290Set('ver290Status', 'エラー');
      ver290Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    }
  };
  rd.readAsText(file);
}
function ver290ShowHistory() {
  const h = ver290Histories();
  if (!h.length) {
    ver290Render([{ type: 'INFO', level: 'warn', msg: 'バックアップ履歴はありません' }]);
    return;
  }
  ver290Render(
    h.map((x) => ({
      type: '履歴',
      msg: x.at + ' / 売上 ' + x.salesCount + '件 / 仕入 ' + x.purchaseCount + '件'
    }))
  );
}
function ver290ClearOldHistory() {
  const h = ver290Histories().slice(0, 5);
  ver290SaveHistories(h);
  ver290Refresh();
  ver290Render([{ type: '整理', msg: '最新5件だけ残しました' }]);
}

window.ver290CreateBackup = ver290CreateBackup;
window.ver290DownloadBackup = ver290DownloadBackup;
window.ver290RestoreBackup = ver290RestoreBackup;
window.ver290ShowHistory = ver290ShowHistory;
window.ver290ClearOldHistory = ver290ClearOldHistory;

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
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
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

/* RIBRE — Storage/Cloud pages 移行（Phase4: ver530 の最終定義を pages 側へ集約） */
function ver530Render(rows) {
  const box = document.getElementById('backup53List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver530Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver530Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver530Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver530Email() {
  const s = ver530Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver530Headers(extra = {}) {
  const c = ver530Config(),
    s = ver530Session();
  return Object.assign({ apikey: c.key, Authorization: 'Bearer ' + (s.access_token || c.key), 'Content-Type': 'application/json' }, extra);
}
async function ver530Rest(table, query) {
  const c = ver530Config();
  if (!c.url || !c.key) return { error: { message: 'Supabase設定なし' } };
  try {
    const res = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + table + query, { headers: ver530Headers() });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    return { data: data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
async function ver530LoadProduction() {
  const email = ver530Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  ver530Set('ver530Status', '読込中');
  const sales = await ver530Rest('sales', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=20000');
  const purchases = await ver530Rest('purchases', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=20000');
  const staffs = await ver530Rest('staffs', '?select=*&or=(owner_email.eq.' + encodeURIComponent(email) + ',staff_email.eq.' + encodeURIComponent(email) + ')&limit=2000');

  if (sales.error || purchases.error) {
    ver530Set('ver530Status', 'エラー');
    ver530Render([{ type: 'ERROR', level: 'danger', msg: (sales.error || purchases.error).message }]);
    return;
  }
  const staffRows = staffs.error ? [] : staffs.data || [];
  localStorage.setItem('ribre_backup_prod_sales530', JSON.stringify(sales.data || []));
  localStorage.setItem('ribre_backup_prod_purchases530', JSON.stringify(purchases.data || []));
  localStorage.setItem('ribre_backup_prod_staffs530', JSON.stringify(staffRows));
  ver530Set('ver530SalesCount', (sales.data || []).length + '件');
  ver530Set('ver530PurchaseCount', (purchases.data || []).length + '件');
  ver530Set('ver530StaffCount', staffRows.length + '件');
  ver530Set('ver530Status', '読込OK');
  ver530Render([
    { type: '売上', msg: '本番売上 ' + (sales.data || []).length + '件' },
    { type: '仕入', msg: '本番仕入 ' + (purchases.data || []).length + '件' },
    { type: 'スタッフ', msg: '本番スタッフ ' + staffRows.length + '件' },
    { type: 'Storage', msg: 'Storage URL一覧は端末保存分を含めます' }
  ]);
}
function ver530Snapshot() {
  let sales = [],
    purchases = [],
    staffs = [],
    storage = [],
    tasks = [],
    templates = [],
    closes = [];
  try {
    sales = JSON.parse(localStorage.getItem('ribre_backup_prod_sales530') || '[]');
  } catch (e) {}
  try {
    purchases = JSON.parse(localStorage.getItem('ribre_backup_prod_purchases530') || '[]');
  } catch (e) {}
  try {
    staffs = JSON.parse(localStorage.getItem('ribre_backup_prod_staffs530') || '[]');
  } catch (e) {}
  try {
    storage = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
  } catch (e) {}
  try {
    tasks = JSON.parse(localStorage.getItem('ribre_fix_tasks370') || '[]');
  } catch (e) {}
  try {
    templates = JSON.parse(localStorage.getItem('ribre_templates340') || '[]');
  } catch (e) {}
  try {
    closes = JSON.parse(localStorage.getItem('ribre_closed_months380') || '[]');
  } catch (e) {}
  return {
    version: 'Ver60.0',
    exportedAt: new Date().toISOString(),
    exportedAtJp: new Date().toLocaleString('ja-JP'),
    user: ver530Email(),
    sales: sales,
    purchases: purchases,
    staffs: staffs,
    storage: storage,
    tasks: tasks,
    templates: templates,
    monthly_closes: closes,
    settings: {
      supabase: ver530Config()
    }
  };
}
function ver530SaveHistory(snapshot) {
  let h = [];
  try {
    h = JSON.parse(localStorage.getItem('ribre_backup_history530') || '[]');
  } catch (e) {}
  h.unshift({ at: snapshot.exportedAtJp, user: snapshot.user, sales: snapshot.sales.length, purchases: snapshot.purchases.length, staffs: snapshot.staffs.length });
  localStorage.setItem('ribre_backup_history530', JSON.stringify(h.slice(0, 50)));
}
function ver530CreateBackup() {
  const snap = ver530Snapshot();
  ver530SaveHistory(snap);
  localStorage.setItem('ribre_latest_backup530', JSON.stringify(snap));
  ver530Set('ver530SalesCount', snap.sales.length + '件');
  ver530Set('ver530PurchaseCount', snap.purchases.length + '件');
  ver530Set('ver530StaffCount', snap.staffs.length + '件');
  ver530Set('ver530Status', '作成OK');
  ver530Render([
    { type: '作成', msg: 'バックアップを作成しました' },
    { type: '売上', msg: snap.sales.length + '件' },
    { type: '仕入', msg: snap.purchases.length + '件' },
    { type: 'スタッフ', msg: snap.staffs.length + '件' },
    { type: 'Storage', msg: snap.storage.length + '件' }
  ]);
}
function ver530DownloadJson() {
  let snap = {};
  try {
    snap = JSON.parse(localStorage.getItem('ribre_latest_backup530') || '{}');
  } catch (e) {}
  if (!snap.version) {
    ver530CreateBackup();
    snap = JSON.parse(localStorage.getItem('ribre_latest_backup530') || '{}');
  }
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_production_backup_Ver53_0_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  ver530Render([{ type: '保存', msg: 'JSONバックアップを保存しました' }]);
}
function ver530Csv(rows, headers) {
  return [headers].concat(rows.map((r) => headers.map((h) => r[h] ?? '')));
}
function ver530DownloadCsv() {
  let snap = {};
  try {
    snap = JSON.parse(localStorage.getItem('ribre_latest_backup530') || '{}');
  } catch (e) {}
  if (!snap.version) {
    ver530CreateBackup();
    snap = JSON.parse(localStorage.getItem('ribre_latest_backup530') || '{}');
  }
  const rows = [
    ['backup_type', 'count'],
    ['sales', snap.sales.length],
    ['purchases', snap.purchases.length],
    ['staffs', snap.staffs.length],
    ['storage', snap.storage.length],
    ['tasks', snap.tasks.length],
    ['templates', snap.templates.length]
  ];
  csvDownload(rows, 'ribre_backup_summary_Ver53_0.csv');
}
function ver530PreviewRestore() {
  const file = document.getElementById('ver530RestoreFile').files[0];
  if (!file) {
    alert('復元するJSONを選択してください');
    return;
  }
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      const dropKeys = new Set(['dataUrl', 'data_url', 'imageDataUrl', 'image_data_url', 'base64', 'image', 'fileData', 'blob', 'raw', 'content']);
      const sanitize = (v) => {
        if (Array.isArray(v)) return v.map(sanitize).slice(0, 20);
        if (v && typeof v === 'object') {
          const out = {};
          Object.keys(v).forEach((k) => {
            if (dropKeys.has(k)) return;
            out[k] = sanitize(v[k]);
          });
          return out;
        }
        return v;
      };
      const preview = sanitize(data);
      try {
        localStorage.setItem('ribre_restore_preview530', JSON.stringify(preview));
      } catch (e) {
        if (e && e.name === 'QuotaExceededError') {
          localStorage.setItem('ribre_restore_preview530', '[]');
          ver530Set('ver530Status', '容量調整');
          ver530Render([{ type: '容量', level: 'warn', msg: 'プレビュー容量を超えたため軽量化しました' }]);
          return;
        }
        throw e;
      }
      ver530Render([
        { type: '復元候補', msg: 'version ' + (preview.version || '不明') },
        { type: '売上', msg: (preview.sales || []).length + '件' },
        { type: '仕入', msg: (preview.purchases || []).length + '件' },
        { type: 'スタッフ', msg: (preview.staffs || []).length + '件' },
        { type: 'Storage', msg: (preview.storage || []).length + '件' }
      ]);
      ver530Set('ver530Status', 'プレビューOK');
    } catch (e) {
      ver530Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    }
  };
  r.readAsText(file);
}
function ver530MapSalesToLocal(rows) {
  return (rows || []).map((x) => ({
    id: x.item_id || x.id,
    itemId: x.item_id || '',
    date: x.sale_date || '',
    month: x.month || '',
    shop: x.account || x.market || '',
    name: x.item_name || '',
    amount: x.amount || 0,
    price: x.amount || 0,
    fee: x.fee || 0,
    shipping: x.shipping_fee || 0,
    ship: x.shipping_fee || 0,
    profit: x.profit || 0,
    slip: x.slip_number || '',
    deliveryCompany: x.shipping_company || '',
    matchStatus: x.status || '復元',
    memo: x.memo || '',
    evidenceUrl: x.evidence_url || '',
    source: x.source || 'backup restore Ver60.0'
  }));
}
function ver530MapPurchasesToLocal(rows) {
  return (rows || []).map((x) => ({
    id: x.id,
    date: x.purchase_date || '',
    purchase_date: x.purchase_date || '',
    month: x.month || '',
    vendor: x.vendor || '',
    name: x.item_name || '',
    item_name: x.item_name || '',
    cost: x.cost || 0,
    total: x.total || x.cost || 0,
    invoiceNo: x.invoice_number || '',
    status: x.status || '復元',
    memo: x.memo || '',
    evidenceUrl: x.evidence_url || '',
    source: x.source || 'backup restore Ver60.0'
  }));
}
function ver530RestoreToLocal() {
  let data = {};
  try {
    data = JSON.parse(localStorage.getItem('ribre_restore_preview530') || '{}');
  } catch (e) {}
  if (Array.isArray(data) && !data.length) {
    ver530Set('ver530Status', '容量調整');
    ver530Render([{ type: '容量', level: 'warn', msg: 'プレビュー容量を超えたため軽量化しました' }]);
    return;
  }
  if (!data.version) {
    alert('先に復元プレビューを押してください');
    return;
  }
  if (!confirm('バックアップをこの端末のローカルデータへ復元しますか？')) return;
  localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(ver530MapSalesToLocal(data.sales || [])));
  localStorage.setItem('ribre_full_sales221', JSON.stringify(ver530MapSalesToLocal(data.sales || [])));
  localStorage.setItem('ribre_full_purchases221', JSON.stringify(ver530MapPurchasesToLocal(data.purchases || [])));
  localStorage.setItem(
    'ribre_staff470',
    JSON.stringify((data.staffs || []).map((x) => ({ email: x.staff_email, role: x.role, status: x.status, addedAt: x.created_at, addedBy: x.owner_email })))
  );
  localStorage.setItem('ribre_storage_files490', JSON.stringify(data.storage || []));
  localStorage.setItem('ribre_fix_tasks370', JSON.stringify(data.tasks || []));
  localStorage.setItem('ribre_templates340', JSON.stringify(data.templates || []));
  try {
    refreshAll();
  } catch (e) {}
  ver530Set('ver530Status', '復元OK');
  ver530Render([{ type: '復元', msg: 'ローカルへ復元しました。必要なら本番DBへ再保存してください' }]);
}
function ver530ShowHistory() {
  let h = [];
  try {
    h = JSON.parse(localStorage.getItem('ribre_backup_history530') || '[]');
  } catch (e) {}
  ver530Render(
    h.length
      ? h.map((x) => ({ type: '履歴', msg: x.at + ' / 売上 ' + x.sales + '件 / 仕入 ' + x.purchases + '件 / staff ' + x.staffs + '件' }))
      : [{ type: 'INFO', level: 'warn', msg: '履歴はありません' }]
  );
}

window.ver530LoadProduction = ver530LoadProduction;
window.ver530CreateBackup = ver530CreateBackup;
window.ver530DownloadJson = ver530DownloadJson;
window.ver530DownloadCsv = ver530DownloadCsv;
window.ver530PreviewRestore = ver530PreviewRestore;
window.ver530RestoreToLocal = ver530RestoreToLocal;
window.ver530ShowHistory = ver530ShowHistory;

/* RIBRE — Storage/Cloud pages 移行（Phase5: ver540 の最終定義を pages 側へ集約） */
function ver540Render(rows) {
  const box = document.getElementById('sync54List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
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

/* RIBRE — Storage/Cloud pages 移行（Phase6: ver550 の最終定義を pages 側へ集約） */
function ver550Render(rows) {
  const box = document.getElementById('audit55List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 700)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver550Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver550Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver550Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver550Email() {
  const s = ver550Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver550Device() {
  return localStorage.getItem('ribre_device_name540') || navigator.userAgent.slice(0, 40) || 'unknown';
}
function ver550Headers(extra = {}) {
  const c = ver550Config(),
    s = ver550Session();
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
async function ver550Rest(table, query = '', method = 'GET', body = null) {
  const c = ver550Config();
  if (!c.url || !c.key) return { error: { message: 'Supabase設定なし' } };
  const s = ver550Session();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  if ((table === 'sync_logs' || table === 'audit_logs') && !token) {
    return { error: { message: '再ログインしてください' }, authRequired: true, status: 401 };
  }
  try {
    const res = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + table + query, {
      method: method,
      headers: ver550Headers(),
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
function ver550Local() {
  try {
    return JSON.parse(localStorage.getItem('ribre_audit_logs550') || '[]');
  } catch (e) {
    return [];
  }
}
function ver550SlimLog(x) {
  const src = x && typeof x === 'object' ? x : {};
  const out = {
    user_email: src.user_email || '',
    device_name: src.device_name || '',
    action_type: src.action_type || '',
    action_detail: src.action_detail || '',
    target_table: src.target_table || '',
    target_id: src.target_id || '',
    created_at: src.created_at || new Date().toISOString()
  };
  if ('before_json' in src) out.before_json = null;
  if ('after_json' in src) out.after_json = null;
  return out;
}
function ver550SaveLocal(arr) {
  const isQuota = (e) => !!(e && (e.name === 'QuotaExceededError' || e.code === 22 || String(e.message || '').includes('quota')));
  const rows = (arr || []).map(ver550SlimLog).slice(0, 200);
  const save = (n) => localStorage.setItem('ribre_audit_logs550', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(200);
  } catch (e) {
    if (!isQuota(e)) return;
    try {
      save(100);
    } catch (e2) {
      if (!isQuota(e2)) return;
      try {
        save(50);
      } catch (e3) {
        save(0);
      }
    }
    ver550Set('ver550Status', '容量調整');
    ver550Render([{ type: '容量', level: 'warn', msg: '保存容量がいっぱいです。古いログを削除しました' }]);
  }
}
function ver550Sql() {
  return `create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  user_email text,
  device_name text,
  action_type text,
  action_detail text,
  target_table text,
  target_id text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz default now()
);

alter table audit_logs enable row level security;

drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select"
on audit_logs
for select
using (auth.email() = user_email);

drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_insert"
on audit_logs
for insert
with check (auth.email() = user_email);

create index if not exists audit_logs_user_created_idx
on audit_logs (user_email, created_at desc);

create index if not exists audit_logs_action_idx
on audit_logs (action_type);`;
}
function ver550ShowSql() {
  ver550Render([{ type: 'SQL', msg: ver550Sql().replace(/\n/g, ' / ') }]);
}
function ver550ExportSql() {
  const blob = new Blob([ver550Sql()], { type: 'text/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_audit_logs_Ver55_0.sql';
  a.click();
}
async function ver550CreateLog(action, detail, targetTable = '', targetId = '', beforeObj = null, afterObj = null) {
  const email = ver550Email();
  const log = {
    user_email: email || '未ログイン',
    device_name: ver550Device(),
    action_type: action,
    action_detail: detail,
    target_table: targetTable,
    target_id: targetId,
    before_json: null,
    after_json: null,
    created_at: new Date().toISOString()
  };
  const local = ver550Local();
  local.unshift(log);
  ver550SaveLocal(local);
  ver550Set('ver550LocalCount', ver550Local().length + '件');
  ver550Set('ver550User', email || '未ログイン');

  if (email) {
    const r = await ver550Rest('audit_logs', '', 'POST', [log]);
    if (r.error) {
      if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
        ver550Set('ver550Status', '再ログイン必要');
        ver550Render([{ type: '認証', level: 'warn', msg: '再ログインしてください' }]);
        return;
      }
      ver550Set('ver550Status', '端末保存のみ');
      ver550Render([{ type: '注意', level: 'warn', msg: '端末ログには保存しました。本番ログ保存エラー: ' + r.error.message }]);
      return;
    }
  }
  ver550Set('ver550Status', '記録OK');
  ver550Render([{ type: action, msg: detail + ' / ' + (email || '未ログイン') }]);
}
async function ver550LoadLogs() {
  const email = ver550Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  const r = await ver550Rest('audit_logs', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc&limit=1000');
  if (r.error) {
    if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
      ver550Set('ver550Status', '再ログイン必要');
      ver550Render([{ type: '認証', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver550Set('ver550Status', 'エラー');
    ver550Render([
      { type: 'ERROR', level: 'danger', msg: r.error.message },
      { type: '確認', level: 'warn', msg: '先にログSQLをSupabase SQL Editorで実行してください' }
    ]);
    return;
  }
  localStorage.setItem('ribre_audit_prod550', JSON.stringify(r.data || []));
  ver550Set('ver550ProdCount', (r.data || []).length + '件');
  ver550Set('ver550Status', '読込OK');
  ver550Render(
    (r.data || []).map((x) => ({
      type: x.action_type || 'LOG',
      msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
    }))
  );
}
function ver550ShowLocalLogs() {
  const rows = ver550Local();
  ver550Set('ver550LocalCount', rows.length + '件');
  ver550Render(
    rows.length
      ? rows.map((x) => ({
          type: x.action_type || 'LOG',
          msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
        }))
      : [{ type: 'INFO', level: 'warn', msg: '端末ログはありません' }]
  );
}
function ver550FilterLogs() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_audit_prod550') || '[]');
  } catch (e) {}
  if (!rows.length) rows = ver550Local();
  const kw = (document.getElementById('ver550Filter').value || '').toLowerCase();
  const type = document.getElementById('ver550Type').value;
  if (type) rows = rows.filter((x) => String(x.action_type || '').includes(type));
  if (kw) rows = rows.filter((x) => [x.user_email, x.device_name, x.action_type, x.action_detail, x.target_table, x.target_id].join(' ').toLowerCase().includes(kw));
  ver550Render(
    rows.map((x) => ({
      type: x.action_type || 'LOG',
      msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
    }))
  );
}
function ver550ExportCsv() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_audit_prod550') || '[]');
  } catch (e) {}
  if (!rows.length) rows = ver550Local();
  const csv = [['日時', 'ユーザー', '端末', '操作', '内容', '対象テーブル', '対象ID']];
  rows.forEach((x) => csv.push([x.created_at, x.user_email, x.device_name, x.action_type, x.action_detail, x.target_table, x.target_id]));
  csvDownload(csv, 'audit_logs_Ver55_0.csv');
}
function ver550WrapFunctions() {
  const targets = [
    ['ver500SaveToProduction', 'AI', 'AI自動登録を本番DBへ保存'],
    ['ver490Upload', 'Storage', 'Storageへファイル保存'],
    ['ver540ManualSync', '同期', '手動同期'],
    ['ver540Push', '同期', '端末→本番'],
    ['ver540Pull', '同期', '本番→端末'],
    ['ver530DownloadJson', 'バックアップ', 'JSONバックアップ保存'],
    ['ver530CreateBackup', 'バックアップ', 'バックアップ作成'],
    ['ver450UpsertAll', '売上', '重複防止まとめて更新保存']
  ];
  targets.forEach(([name, type, detail]) => {
    if (typeof window[name] === 'function' && !window['__ver550_' + name]) {
      const old = window[name];
      window[name] = async function () {
        const result = await old.apply(this, arguments);
        Promise.resolve(ver550CreateLog(type, detail)).catch(() => {});
        return result;
      };
      window['__ver550_' + name] = true;
    }
  });
}

window.ver550Render = ver550Render;
window.ver550Set = ver550Set;
window.ver550Config = ver550Config;
window.ver550Session = ver550Session;
window.ver550Email = ver550Email;
window.ver550Device = ver550Device;
window.ver550Headers = ver550Headers;
window.ver550Rest = ver550Rest;
window.ver550Local = ver550Local;
window.ver550SaveLocal = ver550SaveLocal;
window.ver550Sql = ver550Sql;
window.ver550ShowSql = ver550ShowSql;
window.ver550ExportSql = ver550ExportSql;
window.ver550CreateLog = ver550CreateLog;
window.ver550LoadLogs = ver550LoadLogs;
window.ver550ShowLocalLogs = ver550ShowLocalLogs;
window.ver550FilterLogs = ver550FilterLogs;
window.ver550ExportCsv = ver550ExportCsv;
window.ver550WrapFunctions = ver550WrapFunctions;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver550InitDone) return;
      window.__ver550InitDone = true;
      ver550Set('ver550User', ver550Email() || '未ログイン');
      ver550Set('ver550LocalCount', ver550Local().length + '件');
      ver550WrapFunctions();
    } catch (e) {}
  }, 1500);
});

/* RIBRE — Storage/Cloud pages 移行（Phase7: ver560 の最終定義を pages 側へ集約） */
function ver560Render(rows) {
  const box = document.getElementById('organize56List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 800)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver560Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver560ShowOverview() {
  ver560Set('ver560Status', '表示OK');
  ver560Render([
    { type: '概要', msg: 'RIBRE 売上管理システムは、売上CSV・配送照合・OCR/AI登録・Supabase本番DB・Storage・同期・分析・バックアップ・操作ログまで対応しています。' },
    { type: 'DB', msg: 'Supabase: sales / purchases / staffs / sync_logs / audit_logs を使用' },
    { type: 'Storage', msg: 'Storage: evidence / ocr / csv bucket に画像・PDF・CSVを保存' },
    { type: 'AI', msg: 'AI自動登録: Storage証憑または画像から売上/仕入/送料/経費候補を作成' },
    { type: '同期', msg: '自動同期: sync_logs に端末データを保存し、複数端末で読み込み' },
    { type: '監査', msg: '操作ログ: audit_logs に主要操作を記録' },
    { type: '注意', level: 'warn', msg: '現在は index.html に多くの機能が入っています。次フェーズで安全に分割していきます。' }
  ]);
}
function ver560ShowCodexGuide() {
  ver560Set('ver560Status', 'Codex用');
  ver560Render([
    { type: '1', msg: 'GitHubの ribre-sales-system リポジトリをCodex/Cursorで開く' },
    { type: '2', msg: '最初の依頼は「この巨大なindex.htmlを機能ごとに安全に分割してください」がおすすめ' },
    { type: '3', msg: '分割候補: services/supabase.js, services/storage.js, services/ai.js, services/sync.js, services/audit.js' },
    { type: '4', msg: '画面候補: pages/dashboard.js, pages/sales.js, pages/ocr.js, pages/settings.js, pages/reports.js' },
    { type: '5', msg: 'CSS候補: styles/base.css, styles/mobile.css' },
    { type: '注意', level: 'warn', msg: '一度に全部React化せず、まずはファイル分割→動作確認→UI整理の順が安全です。' }
  ]);
}
function ver560ShowRefactorPlan() {
  ver560Set('ver560Status', '分割計画');
  ver560Render([
    { type: 'Step1', msg: '現状維持版を main-backup.html として残す' },
    { type: 'Step2', msg: 'Supabase設定・ログイン処理を services/supabase.js へ分離' },
    { type: 'Step3', msg: 'CSV読込・出力処理を services/csv.js へ分離' },
    { type: 'Step4', msg: 'Storage保存処理を services/storage.js へ分離' },
    { type: 'Step5', msg: 'AI OCR/AI分類を services/ai.js へ分離' },
    { type: 'Step6', msg: '自動同期・監査ログを services/sync.js / services/audit.js へ分離' },
    { type: 'Step7', msg: '画面ごとに pages/ へ分離' },
    { type: 'Step8', msg: '初心者モードをトップページ化して、詳細機能は管理者メニューへ格納' }
  ]);
}
function ver560ShowBeginnerFlow() {
  ver560Set('ver560Status', '初心者用');
  ver560Render([
    { type: '今日やること', msg: '1. ログイン → 2. CSV取込またはAI自動登録 → 3. 配送照合 → 4. データ確認 → 5. 日次レポート' },
    { type: '売上CSV', msg: 'ヤフオクCSVを取り込む場合は「ヤフオクCSV」画面を使います。' },
    { type: '証憑', msg: '画像やPDFは「Storage保存」→「AI自動登録」の順で登録します。' },
    { type: '配送', msg: 'ヤマト/佐川CSVは「配送照合」で読み込みます。' },
    { type: '確認', msg: '月締め前に「データ確認」と「修正タスク」を確認します。' },
    { type: '保存', msg: '重要作業後は「本番バックアップ」でJSON保存します。' },
    { type: '迷ったら', level: 'warn', msg: 'スタッフは「日次レポート」「AI自動登録」「配送照合」だけ覚えればOKです。管理者は本番DB・Storage・操作ログも確認します。' }
  ]);
}
function ver560DocsText() {
  return `RIBRE 売上管理システム Ver60.0 引き継ぎメモ

主要機能:
- ヤフオク売上CSV取込
- 配送CSV照合
- 未一致診断
- AI OCR自動登録
- Supabase本番DB保存
- Supabase Storage保存
- 自動同期
- スタッフ共有
- 本番バックアップ
- 操作ログ
- 日次/週次レポート
- 経営分析

Supabaseテーブル:
- sales
- purchases
- staffs
- sync_logs
- audit_logs

Storage bucket:
- evidence
- ocr
- csv

次の開発方針:
1. index.htmlを安全に機能分割
2. 初心者モード追加
3. スマホ最適化
4. 安定化・エラー対策
5. 商品化準備

Codexに最初に依頼する文:
「このプロジェクトのindex.htmlが巨大化しているので、動作を壊さずに services / pages / styles に分割してください。まずはSupabase、Storage、AI、同期、監査ログを分離し、READMEに構成を書いてください。」
`;
}
function ver560ExportDocs() {
  const blob = new Blob([ver560DocsText()], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'RIBRE_handoff_Ver56_0.txt';
  a.click();
  ver560Set('ver560Status', '保存OK');
  ver560Render([{ type: '保存', msg: '引き継ぎメモを保存しました' }]);
}

window.ver560Render = ver560Render;
window.ver560Set = ver560Set;
window.ver560ShowOverview = ver560ShowOverview;
window.ver560ShowCodexGuide = ver560ShowCodexGuide;
window.ver560ShowRefactorPlan = ver560ShowRefactorPlan;
window.ver560ShowBeginnerFlow = ver560ShowBeginnerFlow;
window.ver560DocsText = ver560DocsText;
window.ver560ExportDocs = ver560ExportDocs;

/* RIBRE — Storage/Cloud pages 移行（Phase8: ver570 の最終定義を pages 側へ集約） */
function ver570Render(rows) {
  const box = document.getElementById('beginner57List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver570Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver570TodayFlow() {
  ver570Set('ver570Step', '今日やること');
  ver570Set('ver570Status', '案内中');
  ver570Render([
    { type: 'STEP1', msg: 'ログイン確認' },
    { type: 'STEP2', msg: 'ヤフオクCSV または AI自動登録' },
    { type: 'STEP3', msg: '配送照合（ヤマト/佐川）' },
    { type: 'STEP4', msg: '未一致・修正タスク確認' },
    { type: 'STEP5', msg: '日次レポート確認' },
    { type: 'STEP6', msg: '必要なら本番バックアップ' }
  ]);
}
function ver570SimpleSales() {
  ver570Set('ver570Step', '売上登録');
  ver570Render([
    { type: '方法1', msg: 'ヤフオクCSVを取り込む' },
    { type: '方法2', msg: 'AI自動登録で画像/PDFから登録' },
    { type: '確認', msg: '金額・送料・件数を確認' },
    { type: '注意', level: 'warn', msg: '未一致がある場合は配送照合を行ってください' }
  ]);
}
function ver570SimpleOCR() {
  ver570Set('ver570Step', '画像/PDF登録');
  ver570Render([
    { type: '1', msg: 'Storage保存を開く' },
    { type: '2', msg: '画像/PDFを選択' },
    { type: '3', msg: 'Storageへ保存' },
    { type: '4', msg: 'AI自動登録を開く' },
    { type: '5', msg: 'AI解析 → 候補を登録' }
  ]);
}
function ver570SimpleShipping() {
  ver570Set('ver570Step', '配送確認');
  ver570Render([
    { type: 'ヤマト', msg: 'ヤマトCSVを取り込む' },
    { type: '佐川', msg: '佐川CSVを取り込む' },
    { type: '確認', msg: '未一致件数を確認' },
    { type: '対応', msg: '必要なら手動修正' }
  ]);
}
function ver570SimpleCheck() {
  ver570Set('ver570Step', '最終確認');
  ver570Render([
    { type: '確認1', msg: '日次レポートを見る' },
    { type: '確認2', msg: '未対応タスク確認' },
    { type: '確認3', msg: '利益・送料率確認' },
    { type: '確認4', msg: '本番バックアップ保存' }
  ]);
}
function ver570ManagerMode() {
  ver570Set('ver570Target', '管理者');
  ver570Render([
    { type: '管理者', msg: '本番DB・Storage・同期・監査ログを確認します' },
    { type: '重要', msg: 'バックアップを定期保存してください' },
    { type: '同期', msg: '複数端末は自動同期をON' },
    { type: '監査', msg: '操作ログでスタッフ作業確認可能' },
    { type: '推奨', level: 'warn', msg: 'スタッフには初心者モード中心で運用するのがおすすめです' }
  ]);
}

window.ver570Render = ver570Render;
window.ver570Set = ver570Set;
window.ver570TodayFlow = ver570TodayFlow;
window.ver570SimpleSales = ver570SimpleSales;
window.ver570SimpleOCR = ver570SimpleOCR;
window.ver570SimpleShipping = ver570SimpleShipping;
window.ver570SimpleCheck = ver570SimpleCheck;
window.ver570ManagerMode = ver570ManagerMode;

/* RIBRE — Storage/Cloud pages 移行（Phase9: ver580 の最終定義を pages 側へ集約） */
function ver580Render(rows) {
  const box = document.getElementById('mobile58List');
  if (!box) return;
  box.innerHTML = (rows || []).map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>').join('');
}
function ver580Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver580ApplyBase() {
  document.body.classList.add('ver580-mobile');
  localStorage.setItem('ribre_mobile_mode580', '1');
  ver580Set('ver580Mode', 'スマホ');
  ver580Set('ver580Status', '適用OK');
}
function ver580EnableMobile() {
  ver580ApplyBase();

  const style = document.createElement('style');
  style.id = 'ver580-style';
  style.innerHTML = `
body.ver580-mobile{
  font-size:18px;
}
body.ver580-mobile button{
  min-height:54px;
  font-size:17px;
  border-radius:12px;
}
body.ver580-mobile input,
body.ver580-mobile select{
  min-height:50px;
  font-size:17px;
}
body.ver580-mobile .controls{
  display:flex;
  flex-wrap:wrap;
  gap:10px;
}
body.ver580-mobile .controls button{
  flex:1 1 45%;
}
body.ver580-mobile .grid{
  grid-template-columns:1fr 1fr;
}
body.ver580-mobile .panel{
  padding:14px;
}
body.ver580-mobile .row{
  padding:12px;
  font-size:16px;
}
`;
  const old = document.getElementById('ver580-style');
  if (old) old.remove();
  document.head.appendChild(style);

  ver580Render([
    { type: '適用', msg: 'スマホ向けUIを適用しました' },
    { type: '改善', msg: 'ボタン・入力欄を大きくしました' },
    { type: '改善', msg: '片手操作しやすい配置へ変更' }
  ]);
}
function ver580DisableMobile() {
  document.body.classList.remove('ver580-mobile');
  localStorage.removeItem('ribre_mobile_mode580');
  const old = document.getElementById('ver580-style');
  if (old) old.remove();

  ver580Set('ver580Mode', '通常');
  ver580Set('ver580Hand', 'OFF');
  ver580Set('ver580Button', '通常');
  ver580Set('ver580Status', '通常UI');

  ver580Render([{ type: '解除', msg: '通常UIへ戻しました' }]);
}
function ver580LargeButtons() {
  ver580ApplyBase();

  let style = document.getElementById('ver580-large-style');
  if (style) style.remove();

  style = document.createElement('style');
  style.id = 'ver580-large-style';
  style.innerHTML = `
body.ver580-mobile button{
  min-height:64px !important;
  font-size:19px !important;
  padding:14px !important;
}
`;
  document.head.appendChild(style);

  ver580Set('ver580Button', '大');
  ver580Render([{ type: 'ボタン', msg: '大きいボタンへ変更しました' }]);
}
function ver580CompactMode() {
  let style = document.getElementById('ver580-compact-style');
  if (style) style.remove();

  style = document.createElement('style');
  style.id = 'ver580-compact-style';
  style.innerHTML = `
body.ver580-mobile .panel{
  padding:8px !important;
}
body.ver580-mobile .row{
  padding:8px !important;
  font-size:14px !important;
}
`;
  document.head.appendChild(style);

  ver580Render([{ type: 'コンパクト', msg: '情報量を増やしました' }]);
}
function ver580BottomMenu() {
  let menu = document.getElementById('ver580-bottom-menu');
  if (menu) {
    menu.remove();
    ver580Set('ver580Hand', 'OFF');
    return;
  }

  menu = document.createElement('div');
  menu.id = 'ver580-bottom-menu';
  menu.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#0f172a;padding:10px;display:flex;gap:8px;z-index:9999;';

  const items = [
    ['初心者', 'beginner57'],
    ['OCR', 'aiauto50'],
    ['売上', 'analytics51'],
    ['同期', 'sync54']
  ];

  items.forEach((i) => {
    const b = document.createElement('button');
    b.textContent = i[0];
    b.style.cssText = 'flex:1;background:#2563eb;color:#fff;border:none;border-radius:10px;padding:12px;';
    b.onclick = () => {
      try {
        showSec(i[1], b);
      } catch (e) {}
    };
    menu.appendChild(b);
  });

  document.body.appendChild(menu);

  ver580Set('ver580Hand', 'ON');

  ver580Render([{ type: '下部メニュー', msg: '片手操作向け下部メニューを表示しました' }]);
}
function ver580Guide() {
  ver580Render([
    { type: 'おすすめ', msg: 'iPhoneでは「スマホUI ON」を先に押してください' },
    { type: 'OCR', msg: '画像/PDF登録はAI自動登録を使用' },
    { type: '片手操作', msg: '下部メニューで主要機能へ移動可能' },
    { type: 'スタッフ', msg: '初心者モード中心の運用がおすすめ' },
    { type: '管理者', msg: '分析・同期・監査ログはPC推奨' }
  ]);
}

window.ver580Render = ver580Render;
window.ver580Set = ver580Set;
window.ver580ApplyBase = ver580ApplyBase;
window.ver580EnableMobile = ver580EnableMobile;
window.ver580DisableMobile = ver580DisableMobile;
window.ver580LargeButtons = ver580LargeButtons;
window.ver580CompactMode = ver580CompactMode;
window.ver580BottomMenu = ver580BottomMenu;
window.ver580Guide = ver580Guide;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver580InitDone) return;
      window.__ver580InitDone = true;
      if (localStorage.getItem('ribre_mobile_mode580') === '1') {
        try {
          ver580EnableMobile();
        } catch (e) {}
      }
    } catch (e) {}
  }, 1000);
});
