/* RIBRE — Storage backup split (ver290 + ver530) */

/* RIBRE — Storage/Cloud pages 移行（Phase1: ver290 の最終定義を pages 側へ集約） */
function ver290Histories() {
  try {
    return JSON.parse(localStorage.getItem('ribre_backup_histories290') || '[]');
  } catch (e) {
    return [];
  }
}
function ver290SlimHistoryRecord(x) {
  const src = x && typeof x === 'object' ? x : {};
  const n = (v) => {
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  };
  return {
    id: src.id || 'backup_' + Date.now(),
    createdAt: src.createdAt || src.at || new Date().toLocaleString('ja-JP'),
    salesCount: n(src.salesCount),
    purchasesCount: n(src.purchasesCount != null ? src.purchasesCount : src.purchaseCount),
    staffCount: n(src.staffCount),
    note: String(src.note || ''),
    status: String(src.status || '')
  };
}
function ver290SaveHistories(arr) {
  const rows = (arr || []).map((x) => ver290SlimHistoryRecord(x)).slice(0, 5);
  const saveDirect = (n) => {
    const payload = n === 0 ? [] : rows.slice(0, n);
    localStorage.removeItem('ribre_backup_histories290');
    localStorage.setItem('ribre_backup_histories290', JSON.stringify(payload));
  };
  try {
    saveDirect(5);
    return;
  } catch (e) {}
  try {
    saveDirect(3);
    return;
  } catch (e) {}
  try {
    saveDirect(1);
    return;
  } catch (e) {}
  try {
    saveDirect(0);
  } catch (e) {}
}
function ver290Render(rows) {
  const box = document.getElementById('backupList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver290Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver290Snapshot() {
  return {
    version: 'Ver60.0',
    exportedAt: new Date().toISOString(),
    exportedAtJp: new Date().toLocaleString('ja-JP'),
    user: typeof email === 'function' ? email() : '',
    sales: typeof sales === 'function' ? sales() : [],
    purchases: typeof purchases === 'function' ? purchases() : [],
    yahooSales: (() => {
      try {
        return JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]');
      } catch (e) {
        return [];
      }
    })(),
    shippingRows: (() => {
      try {
        return JSON.parse(localStorage.getItem('ribre_shipping_rows230') || '[]');
      } catch (e) {
        return [];
      }
    })(),
    shippingResults: (() => {
      try {
        return JSON.parse(localStorage.getItem('ribre_shipping_results230') || '[]');
      } catch (e) {
        return [];
      }
    })(),
    ocrCandidates: (() => {
      try {
        return JSON.parse(localStorage.getItem('ribre_ocr_candidates200') || '[]');
      } catch (e) {
        return [];
      }
    })(),
    evidences: (() => {
      try {
        return JSON.parse(localStorage.getItem('ribre_full_evidences221') || '[]');
      } catch (e) {
        return [];
      }
    })(),
    settings: {
      supabase: (() => {
        try {
          return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
        } catch (e) {
          return {};
        }
      })()
    }
  };
}
function ver290Refresh() {
  const h = ver290Histories();
  const snap = ver290Snapshot();
  ver290Set('ver290HistoryCount', h.length + '件');
  ver290Set('ver290SalesCount', (snap.sales.length || snap.yahooSales.length || 0) + '件');
  ver290Set('ver290PurchaseCount', snap.purchases.length + '件');
}
function ver290CreateBackup() {
  const snap = ver290Snapshot();
  const h = ver290Histories();
  let staffs = [];
  try {
    staffs = JSON.parse(localStorage.getItem('ribre_staffs470') || '[]');
  } catch (e) {}
  h.unshift({
    id: 'backup_' + Date.now(),
    createdAt: snap.exportedAtJp,
    salesCount: snap.sales.length || snap.yahooSales.length || 0,
    purchasesCount: snap.purchases.length,
    staffCount: staffs.length,
    note: 'ver290 backup',
    status: 'created'
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
      msg:
        (x.createdAt || x.at || '') +
        ' / 売上 ' +
        (x.salesCount || 0) +
        '件 / 仕入 ' +
        (x.purchasesCount != null ? x.purchasesCount : x.purchaseCount || 0) +
        '件'
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
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver290Refresh();
    } catch (e) {}
  }, 1300);
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
