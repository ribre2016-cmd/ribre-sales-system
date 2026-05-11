/* RIBRE — Migration pages 移行（ver440-migration の最終定義を pages 側へ集約） */
function ver440Render(rows) {
  const box = document.getElementById('migration44List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver440Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver440Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver440Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver440Email() {
  const s = ver440Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver440Headers() {
  const c = ver440Config(),
    s = ver440Session();
  return {
    apikey: c.key,
    Authorization: 'Bearer ' + (s.access_token || c.key),
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}
function ver440Url(table, query = '') {
  const c = ver440Config();
  if (!c.url || !c.key) {
    alert('Supabase設定がありません');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/rest/v1/' + table + query;
}
async function ver440Rest(table, opt = {}) {
  const url = ver440Url(table, opt.query || '');
  if (!url) return { error: { message: 'Supabase設定なし' } };
  const sessionValue = ver440Session();
  const token = sessionValue.access_token || (sessionValue.session && sessionValue.session.access_token) || '';
  if (!token) return { error: { message: '再ログインしてください', authRequired: true, status: 401 } };
  try {
    const res = await fetch(url, { method: opt.method || 'GET', headers: ver440Headers(), body: opt.body ? JSON.stringify(opt.body) : undefined });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (res.status === 401) return { error: { message: '再ログインしてください', authRequired: true, status: 401 } };
    if (!res.ok) return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    return { data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
async function ver440CheckTables() {
  const s = await ver440Rest('sales', { query: '?select=id&limit=1' });
  const p = await ver440Rest('purchases', { query: '?select=id&limit=1' });
  if ((s.error && s.error.authRequired) || (p.error && p.error.authRequired)) {
    ver440Set('ver440SalesTable', 'エラー');
    ver440Set('ver440PurchasesTable', 'エラー');
    ver440Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
    return;
  }
  ver440Set('ver440SalesTable', s.error ? 'エラー' : 'OK');
  ver440Set('ver440PurchasesTable', p.error ? 'エラー' : 'OK');
  ver440Render([
    { type: 'sales', level: s.error ? 'danger' : 'ok', msg: s.error ? s.error.message : 'salesテーブルOK' },
    { type: 'purchases', level: p.error ? 'danger' : 'ok', msg: p.error ? p.error.message : 'purchasesテーブルOK' }
  ]);
}
function ver440Normalized() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_normalized_data430') || '[]');
  } catch (e) {}
  if (!rows.length && typeof ver430NormalizePreview === 'function') {
    ver430NormalizePreview();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_normalized_data430') || '[]');
    } catch (e) {}
  }
  return rows;
}
function ver440MapSale(x) {
  return {
    user_email: ver440Email(),
    sale_date: x.sale_date || null,
    month: x.month || '',
    market: x.market || '',
    account: x.account || '',
    item_id: x.item_id || '',
    item_name: x.item_name || '',
    amount: Number(x.amount || 0),
    fee: Number(x.fee || 0),
    shipping_fee: Number(x.shipping_fee || 0),
    profit: Number(x.profit || 0),
    slip_number: x.slip_number || '',
    shipping_company: x.shipping_company || '',
    status: x.status || '',
    memo: x.memo || '',
    evidence_url: x.evidence_url || '',
    source: x.source || 'migration Ver60.0'
  };
}
function ver440MapPurchase(x) {
  return {
    user_email: ver440Email(),
    purchase_date: x.purchase_date || null,
    month: x.month || '',
    vendor: x.vendor || '',
    item_name: x.item_name || '',
    cost: Number(x.cost || 0),
    shipping_fee: Number(x.shipping_fee || 0),
    total: Number(x.total || 0),
    invoice_number: x.invoice_number || '',
    status: x.status || '',
    memo: x.memo || '',
    evidence_url: x.evidence_url || '',
    source: x.source || 'migration Ver60.0'
  };
}
function ver440PrepareMigration() {
  const rows = ver440Normalized();
  const s = rows.filter((x) => x.type === 'sale').map(ver440MapSale);
  const p = rows.filter((x) => x.type === 'purchase').map(ver440MapPurchase);
  localStorage.setItem('ribre_migration_sales440', JSON.stringify(s));
  localStorage.setItem('ribre_migration_purchases440', JSON.stringify(p));
  ver440Set('ver440SalesCount', s.length + '件');
  ver440Set('ver440PurchaseCount', p.length + '件');
  ver440Render([
    { type: '売上', msg: '移行売上 ' + s.length + '件を準備しました' },
    { type: '仕入', msg: '移行仕入 ' + p.length + '件を準備しました' }
  ]);
}
async function ver440UploadSales() {
  if (!ver440Email()) {
    alert('先にログインしてください');
    return;
  }
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_migration_sales440') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver440PrepareMigration();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_migration_sales440') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    alert('移行する売上データがありません');
    return;
  }
  const res = await ver440Rest('sales', { method: 'POST', body: rows });
  if (res.error) {
    if (res.error.authRequired) {
      ver440Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver440Render([{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  ver440Render([{ type: '売上', msg: '本番salesへ保存しました：' + rows.length + '件' }]);
}
async function ver440UploadPurchases() {
  if (!ver440Email()) {
    alert('先にログインしてください');
    return;
  }
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_migration_purchases440') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver440PrepareMigration();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_migration_purchases440') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    alert('移行する仕入データがありません');
    return;
  }
  const res = await ver440Rest('purchases', { method: 'POST', body: rows });
  if (res.error) {
    if (res.error.authRequired) {
      ver440Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver440Render([{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  ver440Render([{ type: '仕入', msg: '本番purchasesへ保存しました：' + rows.length + '件' }]);
}
async function ver440UploadAll() {
  await ver440UploadSales();
  await ver440UploadPurchases();
}
async function ver440LoadProduction() {
  const email = ver440Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  const s = await ver440Rest('sales', { query: '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=5000&order=created_at.desc' });
  const p = await ver440Rest('purchases', { query: '?select=*&user_email=eq.' + encodeURIComponent(email) + '&limit=5000&order=created_at.desc' });
  if (s.error || p.error) {
    const e = s.error || p.error;
    if (e.authRequired) {
      ver440Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver440Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    return;
  }
  localStorage.setItem('ribre_prod_sales440', JSON.stringify(s.data || []));
  localStorage.setItem('ribre_prod_purchases440', JSON.stringify(p.data || []));
  ver440Render([
    { type: '売上', msg: '本番売上読込 ' + (s.data || []).length + '件' },
    { type: '仕入', msg: '本番仕入読込 ' + (p.data || []).length + '件' }
  ]);
}

window.ver440Render = ver440Render;
window.ver440Set = ver440Set;
window.ver440Config = ver440Config;
window.ver440Session = ver440Session;
window.ver440Email = ver440Email;
window.ver440Headers = ver440Headers;
window.ver440Url = ver440Url;
window.ver440Rest = ver440Rest;
window.ver440CheckTables = ver440CheckTables;
window.ver440Normalized = ver440Normalized;
window.ver440MapSale = ver440MapSale;
window.ver440MapPurchase = ver440MapPurchase;
window.ver440PrepareMigration = ver440PrepareMigration;
window.ver440UploadSales = ver440UploadSales;
window.ver440UploadPurchases = ver440UploadPurchases;
window.ver440UploadAll = ver440UploadAll;
window.ver440LoadProduction = ver440LoadProduction;
