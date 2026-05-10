/* RIBRE — Dashboard pages 移行（Phase3: dashboard 関連の最終定義を pages 側へ集約） */
function monthlySummary() {
  const map = {};
  sales().forEach((x) => {
    const m = x.month || String(x.date || '').slice(0, 7) || '未設定';
    map[m] = map[m] || { s: 0, p: 0 };
    map[m].s += num(x.amount);
  });
  purchases().forEach((x) => {
    const m = x.month || String(x.date || '').slice(0, 7) || '未設定';
    map[m] = map[m] || { s: 0, p: 0 };
    map[m].p += num(x.total || x.amount);
  });
  const rows = Object.keys(map)
    .sort()
    .reverse()
    .map((m) => ({
      type: m,
      msg: '売上 ' + yen(map[m].s) + ' / 仕入 ' + yen(map[m].p) + ' / 利益 ' + yen(map[m].s - map[m].p)
    }));
  renderList(
    'dashList',
    rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: 'データがありません' }]
  );
}

function ver420Render(rows) {
  const box = document.getElementById('dashboard42List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver420Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver420Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver420Yen(n) {
  return (Number(n) || 0).toLocaleString() + '円';
}
function ver420Sales() {
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
function ver420Purchases() {
  const arr = [];
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  return arr;
}
function ver420BuildDashboard() {
  const sales = ver420Sales();
  const purchases = ver420Purchases();

  const salesTotal = sales.reduce((a, x) => a + ver420Num(x.amount || x.price), 0);
  const fee = sales.reduce((a, x) => a + ver420Num(x.fee), 0);
  const ship = sales.reduce((a, x) => a + ver420Num(x.shipping || x.ship), 0);
  const purchaseTotal = purchases.reduce((a, x) => a + ver420Num(x.total || x.cost || x.amount), 0);
  const profit = salesTotal - fee - ship - purchaseTotal;

  const unmatched = sales.filter(
    (x) => !(x.deliveryCompany || x.slip || x.matchStatus === '配送一致' || Number(x.shipping || 0) > 0)
  );
  const unmatchedRate = sales.length ? ((unmatched.length / sales.length) * 100).toFixed(1) : 0;

  let ocrCount = 0;
  try {
    ocrCount = (JSON.parse(localStorage.getItem('ribre_ai_classify350') || '[]') || []).length;
  } catch (e) {}

  ver420Set('ver420Sales', ver420Yen(salesTotal));
  ver420Set('ver420Profit', ver420Yen(profit));
  ver420Set('ver420Unmatched', unmatchedRate + '%');
  ver420Set('ver420Ocr', ocrCount + '件');

  const monthMap = {};
  sales.forEach((x) => {
    const m = x.month || String(x.date || x.sale_date || '').slice(0, 7) || '未設定';
    monthMap[m] = monthMap[m] || { sales: 0, fee: 0, ship: 0, count: 0 };
    monthMap[m].sales += ver420Num(x.amount || x.price);
    monthMap[m].fee += ver420Num(x.fee);
    monthMap[m].ship += ver420Num(x.shipping || x.ship);
    monthMap[m].count++;
  });

  localStorage.setItem('ribre_dashboard_months420', JSON.stringify(monthMap));

  ver420Render([
    { type: '売上', msg: '総売上 ' + ver420Yen(salesTotal) },
    { type: '利益', msg: '概算利益 ' + ver420Yen(profit) },
    {
      type: '未一致',
      level: unmatched.length ? 'warn' : 'ok',
      msg: '配送未一致 ' + unmatched.length + '件 / ' + unmatchedRate + '%'
    },
    { type: 'OCR', msg: 'AI/OCR登録 ' + ocrCount + '件' }
  ]);
}
function ver420ShowMonthly() {
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem('ribre_dashboard_months420') || '{}');
  } catch (e) {}
  const rows = Object.keys(map)
    .sort()
    .reverse()
    .map((m) => {
      const x = map[m];
      const profit = x.sales - x.fee - x.ship;
      return {
        type: m,
        msg: '売上 ' + ver420Yen(x.sales) + ' / 利益目安 ' + ver420Yen(profit) + ' / 件数 ' + x.count + '件'
      };
    });
  ver420Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '先に分析更新を押してください' }]);
}
function ver420ShowAccounts() {
  const sales = ver420Sales();
  const map = {};
  sales.forEach((x) => {
    const shop = x.shop || x.account || '未設定';
    map[shop] = map[shop] || { sales: 0, count: 0 };
    map[shop].sales += ver420Num(x.amount || x.price);
    map[shop].count++;
  });
  const rows = Object.keys(map)
    .sort((a, b) => map[b].sales - map[a].sales)
    .map((k) => ({
      type: k,
      msg: '売上 ' + ver420Yen(map[k].sales) + ' / 件数 ' + map[k].count + '件'
    }));
  ver420Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: 'アカウントデータがありません' }]);
}
function ver420ShowStaff() {
  const tasks = JSON.parse(localStorage.getItem('ribre_fix_tasks370') || '[]');
  const map = {};
  tasks.forEach((x) => {
    const u = x.user || '未設定';
    map[u] = map[u] || { done: 0, open: 0 };
    if (x.status === '修正済み') map[u].done++;
    else if (x.status === '未対応') map[u].open++;
  });
  const rows = Object.keys(map).map((k) => ({
    type: k,
    msg: '修正済み ' + map[k].done + '件 / 未対応 ' + map[k].open + '件'
  }));
  ver420Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: 'スタッフデータがありません' }]);
}
function ver420AiComment() {
  const sales = document.getElementById('ver420Sales').textContent;
  const profit = document.getElementById('ver420Profit').textContent;
  const unmatched = document.getElementById('ver420Unmatched').textContent;
  const comments = [
    '利益率改善には未一致率の低下と送料入力精度改善が有効です。',
    'OCR登録数が増えるほど入力工数削減効果が高まります。',
    'ヤフオクアカウント別利益比較を定期確認すると回転率改善につながります。',
    '月締め前に修正タスク0件を目標にすると会計作業が安定します。'
  ];
  ver420Render([{ type: 'AI分析', msg: '総売上 ' + sales + ' / 総利益 ' + profit + ' / 未一致率 ' + unmatched }].concat(comments.map((x) => ({ type: 'コメント', msg: x }))));
}
function ver420ExportDashboard() {
  const sales = document.getElementById('ver420Sales').textContent;
  const profit = document.getElementById('ver420Profit').textContent;
  const unmatched = document.getElementById('ver420Unmatched').textContent;
  const ocr = document.getElementById('ver420Ocr').textContent;

  const rows = [
    ['項目', '値'],
    ['総売上', sales],
    ['総利益', profit],
    ['未一致率', unmatched],
    ['OCR登録数', ocr]
  ];
  csvDownload(rows, 'dashboard_analysis_Ver42_0.csv');
}

function ver510Render(rows) {
  const box = document.getElementById('analytics51List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver510Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver510Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver510Yen(n) {
  return (Number(n) || 0).toLocaleString() + '円';
}
function ver510Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver510Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver510Email() {
  const s = ver510Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver510Headers() {
  const c = ver510Config(),
    s = ver510Session();
  return { apikey: c.key, Authorization: 'Bearer ' + (s.access_token || c.key), 'Content-Type': 'application/json' };
}
async function ver510Rest(table, query) {
  const c = ver510Config();
  if (!c.url || !c.key) {
    alert('Supabase設定がありません');
    return { error: { message: 'Supabase設定なし' } };
  }
  try {
    const res = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + table + query, {
      headers: ver510Headers()
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
async function ver510LoadProduction() {
  const emailValue = ver510Email();
  if (!emailValue) {
    alert('先にログインしてください');
    return;
  }
  const s = await ver510Rest('sales', '?select=*&user_email=eq.' + encodeURIComponent(emailValue) + '&limit=10000');
  const p = await ver510Rest('purchases', '?select=*&user_email=eq.' + encodeURIComponent(emailValue) + '&limit=10000');
  if (s.error || p.error) {
    ver510Render([{ type: 'ERROR', level: 'danger', msg: (s.error || p.error).message }]);
    return;
  }
  localStorage.setItem('ribre_prod_sales510', JSON.stringify(s.data || []));
  localStorage.setItem('ribre_prod_purchases510', JSON.stringify(p.data || []));
  ver510Render([
    { type: '本番DB', msg: '売上 ' + (s.data || []).length + '件を読込' },
    { type: '本番DB', msg: '仕入 ' + (p.data || []).length + '件を読込' }
  ]);
  ver510Build();
}
function ver510SalesRows() {
  let prod = [];
  try {
    prod = JSON.parse(localStorage.getItem('ribre_prod_sales510') || '[]');
  } catch (e) {}
  if (prod.length)
    return prod.map((x) => ({
      date: x.sale_date,
      month: x.month,
      account: x.account || x.market,
      item: x.item_name,
      amount: x.amount,
      fee: x.fee,
      shipping: x.shipping_fee,
      profit: x.profit,
      source: x.source,
      status: x.status
    }));
  let rows = [];
  try {
    rows.push(...JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]'));
  } catch (e) {}
  try {
    rows.push(...JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]'));
  } catch (e) {}
  const seen = new Set();
  return rows
    .filter((x) => {
      const k = String(x.itemId || x.id || x.date + '_' + x.name + '_' + (x.amount || x.price));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x) => ({
      date: x.date,
      month: x.month || String(x.date || '').slice(0, 7),
      account: x.shop,
      item: x.name,
      amount: x.amount || x.price,
      fee: x.fee,
      shipping: x.shipping || x.ship,
      profit: x.profit,
      source: x.source,
      status: x.matchStatus
    }));
}
function ver510PurchaseRows() {
  let prod = [];
  try {
    prod = JSON.parse(localStorage.getItem('ribre_prod_purchases510') || '[]');
  } catch (e) {}
  if (prod.length)
    return prod.map((x) => ({
      date: x.purchase_date,
      month: x.month,
      vendor: x.vendor,
      item: x.item_name,
      total: x.total || x.cost,
      source: x.source,
      status: x.status
    }));
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]');
  } catch (e) {}
  return rows.map((x) => ({
    date: x.date || x.purchase_date,
    month: x.month || String(x.date || x.purchase_date || '').slice(0, 7),
    vendor: x.vendor,
    item: x.name || x.item_name,
    total: x.total || x.cost || x.amount,
    source: x.source,
    status: x.status
  }));
}
function ver510BuildData() {
  const salesRows = ver510SalesRows(),
    purchaseRows = ver510PurchaseRows();
  const months = {},
    accounts = {};
  let salesTotal = 0,
    feeTotal = 0,
    shipTotal = 0,
    purchaseTotal = 0,
    profitTotal = 0,
    aiCount = 0;
  salesRows.forEach((x) => {
    const amount = ver510Num(x.amount),
      fee = ver510Num(x.fee),
      ship = ver510Num(x.shipping);
    const profit = x.profit !== undefined && x.profit !== '' ? ver510Num(x.profit) : amount - fee - ship;
    const m = x.month || String(x.date || '').slice(0, 7) || '未設定';
    months[m] = months[m] || { sales: 0, profit: 0, ship: 0, purchase: 0, count: 0 };
    months[m].sales += amount;
    months[m].profit += profit;
    months[m].ship += ship;
    months[m].count++;
    const a = x.account || '未設定';
    accounts[a] = accounts[a] || { sales: 0, profit: 0, count: 0 };
    accounts[a].sales += amount;
    accounts[a].profit += profit;
    accounts[a].count++;
    salesTotal += amount;
    feeTotal += fee;
    shipTotal += ship;
    profitTotal += profit;
    if (String(x.source || '').includes('AI') || String(x.status || '').includes('AI')) aiCount++;
  });
  purchaseRows.forEach((x) => {
    const total = ver510Num(x.total);
    purchaseTotal += total;
    const m = x.month || String(x.date || '').slice(0, 7) || '未設定';
    months[m] = months[m] || { sales: 0, profit: 0, ship: 0, purchase: 0, count: 0 };
    months[m].purchase += total;
    months[m].profit -= total;
    if (String(x.source || '').includes('AI') || String(x.status || '').includes('AI')) aiCount++;
  });
  return {
    sales: salesRows,
    purchases: purchaseRows,
    months,
    accounts,
    salesTotal,
    feeTotal,
    shipTotal,
    purchaseTotal,
    profitTotal: profitTotal - purchaseTotal,
    aiCount
  };
}
function ver510Build() {
  const d = ver510BuildData();
  const shipRate = d.salesTotal ? ((d.shipTotal / d.salesTotal) * 100).toFixed(1) : 0;
  ver510Set('ver510Sales', ver510Yen(d.salesTotal));
  ver510Set('ver510Profit', ver510Yen(d.profitTotal));
  ver510Set('ver510ShipRate', shipRate + '%');
  ver510Set('ver510AiCount', d.aiCount + '件');
  ver510Draw(d.months);
  ver510Render([
    { type: '売上', msg: '総売上 ' + ver510Yen(d.salesTotal) + ' / 件数 ' + d.sales.length + '件' },
    { type: '仕入', msg: '総仕入 ' + ver510Yen(d.purchaseTotal) + ' / 件数 ' + d.purchases.length + '件' },
    { type: '送料', msg: '送料 ' + ver510Yen(d.shipTotal) + ' / 送料率 ' + shipRate + '%' },
    { type: '利益', msg: '概算利益 ' + ver510Yen(d.profitTotal) },
    { type: 'AI', msg: 'AI/OCR登録 ' + d.aiCount + '件' }
  ]);
}
function ver510Draw(months) {
  const c = document.getElementById('ver510Chart');
  if (!c) return;
  const ctx = c.getContext('2d');
  const rect = c.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  c.width = rect.width * dpr;
  c.height = 260 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, 260);
  const keys = Object.keys(months).sort();
  const pad = 44,
    h = 190,
    w = rect.width - pad * 2;
  const max = Math.max(
    1,
    ...keys.flatMap((m) => [months[m].sales, months[m].profit])
  );
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(pad, 20);
  ctx.lineTo(pad, 220);
  ctx.lineTo(rect.width - pad, 220);
  ctx.stroke();
  function x(i) {
    return pad + (keys.length <= 1 ? 0 : i * (w / (keys.length - 1)));
  }
  function y(v) {
    return 220 - (v / max) * h;
  }
  function line(key) {
    ctx.beginPath();
    keys.forEach((m, i) => {
      const xx = x(i),
        yy = y(months[m][key]);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    keys.forEach((m, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(months[m][key]), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  line('sales');
  ctx.strokeStyle = '#059669';
  ctx.fillStyle = '#059669';
  line('profit');
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#334155';
  keys.forEach((m, i) => ctx.fillText(m.slice(5) || m, x(i) - 14, 238));
  ctx.fillStyle = '#2563eb';
  ctx.fillText('売上', pad, 14);
  ctx.fillStyle = '#059669';
  ctx.fillText('利益', pad + 45, 14);
}
function ver510Monthly() {
  const d = ver510BuildData();
  const rows = Object.keys(d.months)
    .sort()
    .reverse()
    .map((m) => ({
      type: m,
      msg:
        '売上 ' +
        ver510Yen(d.months[m].sales) +
        ' / 仕入 ' +
        ver510Yen(d.months[m].purchase) +
        ' / 送料 ' +
        ver510Yen(d.months[m].ship) +
        ' / 利益 ' +
        ver510Yen(d.months[m].profit) +
        ' / 売上件数 ' +
        d.months[m].count +
        '件'
    }));
  ver510Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '分析データがありません' }]);
}
function ver510Account() {
  const d = ver510BuildData();
  const rows = Object.keys(d.accounts)
    .sort((a, b) => d.accounts[b].sales - d.accounts[a].sales)
    .map((k) => ({
      type: k,
      msg:
        '売上 ' +
        ver510Yen(d.accounts[k].sales) +
        ' / 利益 ' +
        ver510Yen(d.accounts[k].profit) +
        ' / 件数 ' +
        d.accounts[k].count +
        '件'
    }));
  ver510Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '販売先データがありません' }]);
}
function ver510AiOcr() {
  const d = ver510BuildData();
  const aiSales = d.sales.filter(
    (x) => String(x.source || '').includes('AI') || String(x.status || '').includes('AI')
  ).length;
  const aiPur = d.purchases.filter(
    (x) => String(x.source || '').includes('AI') || String(x.status || '').includes('AI')
  ).length;
  ver510Render([
    { type: 'AI売上', msg: 'AI/OCR売上登録 ' + aiSales + '件' },
    { type: 'AI仕入', msg: 'AI/OCR仕入・経費登録 ' + aiPur + '件' },
    { type: '改善', msg: 'AI登録を増やすほど手入力と証憑探しが減ります' },
    { type: '確認', level: 'warn', msg: 'AI登録後は月締め前にデータ確認・修正タスクで確認してください' }
  ]);
}
function ver510Export() {
  const d = ver510BuildData();
  const rows = [['区分', 'キー', '売上', '仕入', '送料', '利益', '件数']];
  Object.keys(d.months)
    .sort()
    .forEach((m) =>
      rows.push([
        '月別',
        m,
        d.months[m].sales,
        d.months[m].purchase,
        d.months[m].ship,
        d.months[m].profit,
        d.months[m].count
      ])
    );
  Object.keys(d.accounts).forEach((a) =>
    rows.push(['販売先', a, d.accounts[a].sales, '', '', d.accounts[a].profit, d.accounts[a].count])
  );
  csvDownload(rows, 'analytics_Ver51_0.csv');
}

window.monthlySummary = monthlySummary;
window.ver420Render = ver420Render;
window.ver420Set = ver420Set;
window.ver420Num = ver420Num;
window.ver420Yen = ver420Yen;
window.ver420Sales = ver420Sales;
window.ver420Purchases = ver420Purchases;
window.ver420BuildDashboard = ver420BuildDashboard;
window.ver420ShowMonthly = ver420ShowMonthly;
window.ver420ShowAccounts = ver420ShowAccounts;
window.ver420ShowStaff = ver420ShowStaff;
window.ver420AiComment = ver420AiComment;
window.ver420ExportDashboard = ver420ExportDashboard;
window.ver510Render = ver510Render;
window.ver510Set = ver510Set;
window.ver510Num = ver510Num;
window.ver510Yen = ver510Yen;
window.ver510Config = ver510Config;
window.ver510Session = ver510Session;
window.ver510Email = ver510Email;
window.ver510Headers = ver510Headers;
window.ver510Rest = ver510Rest;
window.ver510LoadProduction = ver510LoadProduction;
window.ver510SalesRows = ver510SalesRows;
window.ver510PurchaseRows = ver510PurchaseRows;
window.ver510BuildData = ver510BuildData;
window.ver510Build = ver510Build;
window.ver510Draw = ver510Draw;
window.ver510Monthly = ver510Monthly;
window.ver510Account = ver510Account;
window.ver510AiOcr = ver510AiOcr;
window.ver510Export = ver510Export;
