/* RIBRE — Schema pages 移行（ver430-schema-unify の最終定義を pages 側へ集約） */
function ver430Render(rows) {
  const box = document.getElementById('schema43List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver430Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver430Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver430Sales() {
  const arr = [];
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_registered_sales210') || '[]'));
  } catch (e) {}
  const seen = new Set();
  return arr.filter((x) => {
    const k = String(x.itemId || x.id || x.date + '_' + x.name + '_' + (x.amount || x.price));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function ver430Purchases() {
  const arr = [];
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  return arr;
}
function ver430Market(x) {
  const s = String(x.shop || x.account || x.source || x.memo || '');
  if (s.includes('メルカリ') || s.toLowerCase().includes('mercari')) return 'メルカリ';
  if (s.includes('ヤフオク') || s.toLowerCase().includes('yahoo')) return 'ヤフオク';
  return 'その他';
}
function ver430NormalizeSale(x) {
  const amount = ver430Num(x.amount || x.price);
  const fee = ver430Num(x.fee);
  const shipping = ver430Num(x.shipping || x.ship);
  const profit = x.profit !== undefined && x.profit !== '' ? ver430Num(x.profit) : amount - fee - shipping;
  const date = x.date || x.sale_date || '';
  return {
    type: 'sale',
    sale_date: date,
    month: x.month || String(date).slice(0, 7),
    market: ver430Market(x),
    account: x.shop || x.account || '',
    item_id: x.itemId || x.id || '',
    item_name: x.name || x.item_name || '',
    amount,
    fee,
    shipping_fee: shipping,
    profit,
    slip_number: x.slip || x.invoiceNo || '',
    shipping_company: x.deliveryCompany || '',
    status: x.matchStatus || '',
    memo: x.memo || '',
    evidence_url: x.evidenceUrl || '',
    source: x.source || ''
  };
}
function ver430NormalizePurchase(x) {
  const total = ver430Num(x.total || x.cost || x.amount);
  const date = x.date || x.purchase_date || '';
  return {
    type: 'purchase',
    purchase_date: date,
    month: x.month || String(date).slice(0, 7),
    vendor: x.vendor || x.shop || '',
    item_name: x.name || x.item_name || '',
    cost: ver430Num(x.cost || x.amount || total),
    shipping_fee: ver430Num(x.shipping || x.ship),
    total,
    invoice_number: x.invoiceNo || '',
    status: x.matchStatus || '',
    memo: x.memo || '',
    evidence_url: x.evidenceUrl || '',
    source: x.source || ''
  };
}
function ver430AnalyzeCurrentData() {
  const s = ver430Sales(),
    p = ver430Purchases();
  ver430Set('ver430SalesCount', s.length + '件');
  ver430Set('ver430PurchaseCount', p.length + '件');
  ver430Set('ver430Status', '診断OK');
  const mixed = [
    { type: '統一対象', msg: 'amount / price → amount' },
    { type: '統一対象', msg: 'shipping / ship / 送料 → shipping_fee' },
    { type: '統一対象', msg: 'slip / invoiceNo / 伝票番号 → slip_number' },
    { type: '統一対象', msg: 'shop / account / 販売先 → account' },
    { type: '統一対象', msg: 'name / item_name / 商品名 → item_name' }
  ];
  ver430Render([{ type: '売上', msg: '売上データ ' + s.length + '件' }, { type: '仕入', msg: '仕入データ ' + p.length + '件' }].concat(mixed));
}
function ver430NormalizePreview() {
  const rows = ver430Sales().map(ver430NormalizeSale).concat(ver430Purchases().map(ver430NormalizePurchase));
  localStorage.setItem('ribre_normalized_data430', JSON.stringify(rows.slice(0, 20000)));
  ver430Set('ver430NormalizedCount', rows.length + '件');
  ver430Set('ver430Status', '変換OK');
  ver430Render(
    rows.slice(0, 120).map((x) => ({
      type: x.type,
      msg: (x.month || '') + ' / ' + (x.item_id || '') + ' / ' + (x.item_name || '') + ' / ' + (x.amount || x.total || 0).toLocaleString() + '円'
    }))
  );
}
function ver430ExportNormalized() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_normalized_data430') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver430NormalizePreview();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_normalized_data430') || '[]');
    } catch (e) {}
  }
  const csv = [['type', 'date', 'month', 'market/account/vendor', 'item_id', 'item_name', 'amount/cost', 'fee', 'shipping_fee', 'profit/total', 'slip/invoice', 'company', 'status', 'memo', 'evidence_url', 'source']];
  rows.forEach((x) =>
    csv.push([
      x.type,
      x.sale_date || x.purchase_date || '',
      x.month || '',
      x.market || x.account || x.vendor || '',
      x.item_id || '',
      x.item_name || '',
      x.amount || x.cost || 0,
      x.fee || '',
      x.shipping_fee || 0,
      x.profit || x.total || 0,
      x.slip_number || x.invoice_number || '',
      x.shipping_company || '',
      x.status || '',
      x.memo || '',
      x.evidence_url || '',
      x.source || ''
    ])
  );
  csvDownload(csv, 'normalized_data_Ver43_0.csv');
}
function ver430SqlText() {
  return `-- RIBRE Sales Management Supabase Production Schema Ver60.0

create table if not exists sales (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  sale_date date,
  month text,
  market text,
  account text,
  item_id text,
  item_name text,
  amount numeric default 0,
  fee numeric default 0,
  shipping_fee numeric default 0,
  profit numeric default 0,
  slip_number text,
  shipping_company text,
  status text,
  memo text,
  evidence_url text,
  source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  purchase_date date,
  month text,
  vendor text,
  item_name text,
  cost numeric default 0,
  shipping_fee numeric default 0,
  total numeric default 0,
  invoice_number text,
  status text,
  memo text,
  evidence_url text,
  source text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  company text,
  item_id text,
  slip_number text,
  shipping_fee numeric default 0,
  raw_json jsonb,
  matched_sale_id uuid,
  status text default '未照合',
  created_at timestamptz default now()
);

create table if not exists evidences (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  file_name text,
  file_type text,
  storage_path text,
  public_url text,
  related_type text,
  related_id uuid,
  memo text,
  created_at timestamptz default now()
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  task_type text,
  title text,
  status text default '未対応',
  detail text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists templates (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  folder text,
  name text,
  template_type text,
  body text,
  created_at timestamptz default now()
);

create table if not exists monthly_closes (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  month text not null,
  sales_total numeric default 0,
  purchase_total numeric default 0,
  shipping_total numeric default 0,
  profit numeric default 0,
  closed_by text,
  closed_at timestamptz default now()
);

create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  user_email text not null,
  action text,
  detail text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz default now()
);

alter table sales enable row level security;
alter table purchases enable row level security;
alter table shipments enable row level security;
alter table evidences enable row level security;
alter table tasks enable row level security;
alter table templates enable row level security;
alter table monthly_closes enable row level security;
alter table logs enable row level security;

create policy "sales own rows" on sales for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "purchases own rows" on purchases for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "shipments own rows" on shipments for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "evidences own rows" on evidences for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "tasks own rows" on tasks for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "templates own rows" on templates for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "monthly_closes own rows" on monthly_closes for all using (auth.email() = user_email) with check (auth.email() = user_email);
create policy "logs own rows" on logs for all using (auth.email() = user_email) with check (auth.email() = user_email);
`;
}
function ver430ShowSql() {
  const sql = ver430SqlText();
  ver430Render([{ type: 'SQL', msg: sql.replace(/\n/g, ' / ').slice(0, 3000) }]);
}
function ver430ExportSql() {
  const blob = new Blob([ver430SqlText()], { type: 'text/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_supabase_schema_Ver43_0.sql';
  a.click();
}

window.ver430Render = ver430Render;
window.ver430Set = ver430Set;
window.ver430Num = ver430Num;
window.ver430Sales = ver430Sales;
window.ver430Purchases = ver430Purchases;
window.ver430Market = ver430Market;
window.ver430NormalizeSale = ver430NormalizeSale;
window.ver430NormalizePurchase = ver430NormalizePurchase;
window.ver430AnalyzeCurrentData = ver430AnalyzeCurrentData;
window.ver430NormalizePreview = ver430NormalizePreview;
window.ver430ExportNormalized = ver430ExportNormalized;
window.ver430SqlText = ver430SqlText;
window.ver430ShowSql = ver430ShowSql;
window.ver430ExportSql = ver430ExportSql;
