/* RIBRE — Upsert pages 移行（ver450-dedupe-upsert の最終定義を pages 側へ集約） */
function ver450Render(rows) {
  const box = document.getElementById('dedupe45List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver450Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver450Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver450Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver450Email() {
  const s = ver450Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver450Headers(extra = {}) {
  const c = ver450Config(),
    s = ver450Session();
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (s.access_token || c.key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    extra
  );
}
function ver450Url(table, query = '') {
  const c = ver450Config();
  if (!c.url || !c.key) {
    alert('Supabase設定がありません');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/rest/v1/' + table + query;
}
async function ver450Rest(table, opt = {}) {
  const url = ver450Url(table, opt.query || '');
  if (!url) return { error: { message: 'Supabase設定なし' } };
  try {
    const res = await fetch(url, {
      method: opt.method || 'GET',
      headers: ver450Headers(opt.headers || {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
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
function ver450SqlText() {
  return `-- RIBRE Ver60.0 重複防止SQL
-- Supabase SQL Editorで実行してください。
-- 目的:
-- 1. user_email + item_id の売上重複を防止
-- 2. user_email + slip_number の伝票重複を確認しやすくする
-- 3. 再保存時は upsert で更新できるようにする

-- 既存重複がある場合、unique index作成でエラーになります。
-- その場合は先に「本番重複チェック」で重複を確認してください。

create unique index if not exists sales_user_item_unique
on sales (user_email, item_id)
where item_id is not null and item_id <> '';

create index if not exists sales_user_slip_index
on sales (user_email, slip_number)
where slip_number is not null and slip_number <> '';

create index if not exists sales_user_month_index
on sales (user_email, month);

create index if not exists purchases_user_month_index
on purchases (user_email, month);

create unique index if not exists purchases_user_invoice_item_unique
on purchases (user_email, invoice_number, item_name)
where invoice_number is not null and invoice_number <> '' and item_name is not null and item_name <> '';

-- updated_at自動更新用
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sales_set_updated_at on sales;
create trigger sales_set_updated_at
before update on sales
for each row execute function set_updated_at();

drop trigger if exists purchases_set_updated_at on purchases;
create trigger purchases_set_updated_at
before update on purchases
for each row execute function set_updated_at();
`;
}
function ver450ShowSql() {
  const sql = ver450SqlText();
  ver450Render([{ type: 'SQL', msg: sql.replace(/\n/g, ' / ').slice(0, 3500) }]);
}
function ver450ExportSql() {
  const blob = new Blob([ver450SqlText()], { type: 'text/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_duplicate_prevention_Ver45_0.sql';
  a.click();
}
async function ver450CheckDuplicates() {
  const email = ver450Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  const res = await ver450Rest('sales', {
    query: '?select=id,item_id,item_name,amount,slip_number,created_at&user_email=eq.' + encodeURIComponent(email) + '&limit=10000'
  });
  if (res.error) {
    ver450Render([{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  const rows = res.data || [];
  const map = {};
  rows.forEach((x) => {
    const key = x.item_id || '';
    if (!key) return;
    map[key] = map[key] || [];
    map[key].push(x);
  });
  const dups = [];
  Object.keys(map).forEach((k) => {
    if (map[k].length > 1) dups.push({ item_id: k, count: map[k].length, items: map[k] });
  });
  localStorage.setItem('ribre_prod_duplicates450', JSON.stringify(dups));
  ver450Set('ver450ProdSales', rows.length + '件');
  ver450Set('ver450DupCount', dups.length + '件');
  ver450Set('ver450Status', '確認OK');
  ver450Render(
    [
      { type: '本番売上', msg: '本番sales読込 ' + rows.length + '件' },
      { type: '重複候補', level: dups.length ? 'warn' : 'ok', msg: 'item_id重複候補 ' + dups.length + '件' }
    ].concat(dups.slice(0, 120).map((x) => ({ type: '重複', level: 'warn', msg: '商品ID ' + x.item_id + ' / ' + x.count + '件' })))
  );
}
function ver450Normalized() {
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
function ver450MapSale(x) {
  return {
    user_email: ver450Email(),
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
    source: x.source || 'upsert Ver60.0'
  };
}
function ver450MapPurchase(x) {
  return {
    user_email: ver450Email(),
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
    source: x.source || 'upsert Ver60.0'
  };
}
function ver450PrepareUpsert() {
  const rows = ver450Normalized();
  const sales = rows
    .filter((x) => x.type === 'sale')
    .map(ver450MapSale)
    .filter((x) => x.item_id);
  const purchases = rows.filter((x) => x.type === 'purchase').map(ver450MapPurchase);
  localStorage.setItem('ribre_upsert_sales450', JSON.stringify(sales));
  localStorage.setItem('ribre_upsert_purchases450', JSON.stringify(purchases));
  ver450Set('ver450UpsertSalesCount', sales.length + '件');
  ver450Set('ver450Status', '準備OK');
  ver450Render([
    { type: '売上', msg: '更新保存用 売上 ' + sales.length + '件' },
    { type: '仕入', msg: '更新保存用 仕入 ' + purchases.length + '件' },
    { type: '注意', level: 'warn', msg: '重複防止SQLをSupabaseで実行してから更新保存してください' }
  ]);
}
async function ver450UpsertSales() {
  if (!ver450Email()) {
    alert('先にログインしてください');
    return;
  }
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_upsert_sales450') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver450PrepareUpsert();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_upsert_sales450') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    alert('更新保存する売上データがありません');
    return;
  }
  const res = await ver450Rest('sales', {
    method: 'POST',
    query: '?on_conflict=user_email,item_id',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows
  });
  if (res.error) {
    ver450Render([
      { type: 'ERROR', level: 'danger', msg: res.error.message },
      { type: '確認', level: 'warn', msg: 'Supabaseで重複防止SQLを実行済みか確認してください' }
    ]);
    return;
  }
  ver450Set('ver450Status', '売上更新OK');
  ver450Render([{ type: '売上', msg: '売上を重複防止で更新保存しました：' + rows.length + '件' }]);
}
async function ver450UpsertPurchases() {
  if (!ver450Email()) {
    alert('先にログインしてください');
    return;
  }
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_upsert_purchases450') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver450PrepareUpsert();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_upsert_purchases450') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    ver450Render([{ type: '仕入', level: 'warn', msg: '更新保存する仕入データがありません' }]);
    return;
  }
  const res = await ver450Rest('purchases', {
    method: 'POST',
    query: '?on_conflict=user_email,invoice_number,item_name',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows
  });
  if (res.error) {
    ver450Render([{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  ver450Render([{ type: '仕入', msg: '仕入を重複防止で更新保存しました：' + rows.length + '件' }]);
}
async function ver450UpsertAll() {
  await ver450UpsertSales();
  await ver450UpsertPurchases();
}
function ver450ExportDuplicateReport() {
  let dups = [];
  try {
    dups = JSON.parse(localStorage.getItem('ribre_prod_duplicates450') || '[]');
  } catch (e) {}
  if (!dups.length) {
    alert('先に本番重複チェックを押してください');
    return;
  }
  const csv = [['商品ID', '重複件数', '内容']];
  dups.forEach((d) => csv.push([d.item_id, d.count, JSON.stringify(d.items)]));
  csvDownload(csv, 'production_duplicates_Ver45_0.csv');
}

window.ver450Render = ver450Render;
window.ver450Set = ver450Set;
window.ver450Config = ver450Config;
window.ver450Session = ver450Session;
window.ver450Email = ver450Email;
window.ver450Headers = ver450Headers;
window.ver450Url = ver450Url;
window.ver450Rest = ver450Rest;
window.ver450SqlText = ver450SqlText;
window.ver450ShowSql = ver450ShowSql;
window.ver450ExportSql = ver450ExportSql;
window.ver450CheckDuplicates = ver450CheckDuplicates;
window.ver450Normalized = ver450Normalized;
window.ver450MapSale = ver450MapSale;
window.ver450MapPurchase = ver450MapPurchase;
window.ver450PrepareUpsert = ver450PrepareUpsert;
window.ver450UpsertSales = ver450UpsertSales;
window.ver450UpsertPurchases = ver450UpsertPurchases;
window.ver450UpsertAll = ver450UpsertAll;
window.ver450ExportDuplicateReport = ver450ExportDuplicateReport;
