/* RIBRE — Daily/Weekly Report pages 移行（ver520-daily-report の最終定義を pages 側へ集約） */
function ver520Render(rows) {
  const box = document.getElementById('report52List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver520Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver520Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver520Yen(n) {
  return (Number(n) || 0).toLocaleString() + '円';
}
function ver520Today() {
  const d = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
  document.getElementById('ver520Date').value = d;
  ver520BuildDaily();
}
function ver520DateValue() {
  return (document.getElementById('ver520Date').value || (typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10))).trim();
}
function ver520Sales() {
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
      status: x.status,
      source: x.source
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
      status: x.matchStatus,
      source: x.source
    }));
}
function ver520Purchases() {
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
      status: x.status,
      source: x.source
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
    status: x.status,
    source: x.source
  }));
}
function ver520BuildDaily() {
  const day = ver520DateValue();
  const sales = ver520Sales().filter((x) => String(x.date || '').slice(0, 10) === day);
  const purchases = ver520Purchases().filter((x) => String(x.date || '').slice(0, 10) === day);
  const salesTotal = sales.reduce((a, x) => a + ver520Num(x.amount), 0);
  const fee = sales.reduce((a, x) => a + ver520Num(x.fee), 0);
  const ship = sales.reduce((a, x) => a + ver520Num(x.shipping), 0);
  const purchaseTotal = purchases.reduce((a, x) => a + ver520Num(x.total), 0);
  const profit = salesTotal - fee - ship - purchaseTotal;
  const warns = [];
  sales.forEach((x) => {
    if (!x.status || String(x.status).includes('未')) warns.push('未確認売上: ' + (x.item || ''));
    if (ver520Num(x.shipping) === 0) warns.push('送料0: ' + (x.item || ''));
  });
  localStorage.setItem('ribre_report520', JSON.stringify({ type: 'daily', day, sales, purchases, salesTotal, fee, ship, purchaseTotal, profit, warns }));
  ver520Set('ver520Target', day);
  ver520Set('ver520SalesCount', sales.length + '件');
  ver520Set('ver520SalesTotal', ver520Yen(salesTotal));
  ver520Set('ver520WarnCount', warns.length + '件');
  ver520Render(
    [
      { type: '売上', msg: '売上 ' + sales.length + '件 / ' + ver520Yen(salesTotal) },
      { type: '仕入', msg: '仕入 ' + purchases.length + '件 / ' + ver520Yen(purchaseTotal) },
      { type: '送料', msg: '送料 ' + ver520Yen(ship) + ' / 手数料 ' + ver520Yen(fee) },
      { type: '利益', msg: '概算利益 ' + ver520Yen(profit) },
      { type: '注意', level: warns.length ? 'warn' : 'ok', msg: '注意 ' + warns.length + '件' }
    ].concat(warns.slice(0, 80).map((w) => ({ type: '注意', level: 'warn', msg: w })))
  );
}
function ver520WeekRange(day) {
  const d = new Date(day + 'T00:00:00');
  const start = new Date(d);
  start.setDate(d.getDate() - 6);
  return { start: start.toISOString().slice(0, 10), end: day };
}
function ver520BuildWeekly() {
  const day = ver520DateValue();
  const r = ver520WeekRange(day);
  const sales = ver520Sales().filter((x) => String(x.date || '').slice(0, 10) >= r.start && String(x.date || '').slice(0, 10) <= r.end);
  const purchases = ver520Purchases().filter((x) => String(x.date || '').slice(0, 10) >= r.start && String(x.date || '').slice(0, 10) <= r.end);
  const salesTotal = sales.reduce((a, x) => a + ver520Num(x.amount), 0);
  const ship = sales.reduce((a, x) => a + ver520Num(x.shipping), 0);
  const purchaseTotal = purchases.reduce((a, x) => a + ver520Num(x.total), 0);
  const profit = salesTotal - ship - purchaseTotal;
  const daily = {};
  sales.forEach((x) => {
    const d = String(x.date || '').slice(0, 10) || '未設定';
    daily[d] = daily[d] || { count: 0, sales: 0 };
    daily[d].count++;
    daily[d].sales += ver520Num(x.amount);
  });
  localStorage.setItem('ribre_report520', JSON.stringify({ type: 'weekly', range: r, sales, purchases, salesTotal, ship, purchaseTotal, profit, daily }));
  ver520Set('ver520Target', r.start + '〜' + r.end);
  ver520Set('ver520SalesCount', sales.length + '件');
  ver520Set('ver520SalesTotal', ver520Yen(salesTotal));
  ver520Set('ver520WarnCount', '-');
  ver520Render(
    [
      { type: '週次', msg: r.start + ' 〜 ' + r.end },
      { type: '売上', msg: '売上 ' + sales.length + '件 / ' + ver520Yen(salesTotal) },
      { type: '仕入', msg: '仕入 ' + purchases.length + '件 / ' + ver520Yen(purchaseTotal) },
      { type: '利益', msg: '概算利益 ' + ver520Yen(profit) }
    ].concat(Object.keys(daily).sort().map((d) => ({ type: d, msg: '売上 ' + daily[d].count + '件 / ' + ver520Yen(daily[d].sales) })))
  );
}
function ver520OperationCheck() {
  let tasks = [];
  try {
    tasks = JSON.parse(localStorage.getItem('ribre_fix_tasks370') || '[]');
  } catch (e) {}
  let storage = [];
  try {
    storage = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
  } catch (e) {}
  const sales = ver520Sales();
  const openTasks = tasks.filter((x) => x.status === '未対応').length;
  const ai = sales.filter((x) => String(x.source || '').includes('AI') || String(x.status || '').includes('AI')).length;
  const rows = [
    { type: '本番DB', level: sales.length ? 'ok' : 'warn', msg: '売上データ ' + sales.length + '件' },
    { type: 'Storage', level: storage.length ? 'ok' : 'warn', msg: 'Storage保存 ' + storage.length + '件' },
    { type: '修正タスク', level: openTasks ? 'warn' : 'ok', msg: '未対応タスク ' + openTasks + '件' },
    { type: 'AI登録', level: ai ? 'ok' : 'warn', msg: 'AI/OCR売上 ' + ai + '件' }
  ];
  localStorage.setItem('ribre_report520', JSON.stringify({ type: 'operation', rows }));
  ver520Render(rows);
}
function ver520ExportReport() {
  let rep = {};
  try {
    rep = JSON.parse(localStorage.getItem('ribre_report520') || '{}');
  } catch (e) {}
  const rows = [['区分', '項目', '値']];
  if (rep.type === 'daily') {
    rows.push(
      ['日次', '対象日', rep.day],
      ['日次', '売上件数', rep.sales.length],
      ['日次', '売上合計', rep.salesTotal],
      ['日次', '仕入合計', rep.purchaseTotal],
      ['日次', '送料', rep.ship],
      ['日次', '利益', rep.profit]
    );
    (rep.warns || []).forEach((w) => rows.push(['注意', '内容', w]));
  } else if (rep.type === 'weekly') {
    rows.push(
      ['週次', '開始', rep.range.start],
      ['週次', '終了', rep.range.end],
      ['週次', '売上件数', rep.sales.length],
      ['週次', '売上合計', rep.salesTotal],
      ['週次', '利益', rep.profit]
    );
  } else if (rep.type === 'operation') {
    (rep.rows || []).forEach((x) => rows.push(['運用', x.type, x.msg]));
  } else {
    alert('先にレポートを作成してください');
    return;
  }
  csvDownload(rows, 'operation_report_Ver52_0.csv');
}

window.ver520Render = ver520Render;
window.ver520Set = ver520Set;
window.ver520Num = ver520Num;
window.ver520Yen = ver520Yen;
window.ver520Today = ver520Today;
window.ver520DateValue = ver520DateValue;
window.ver520Sales = ver520Sales;
window.ver520Purchases = ver520Purchases;
window.ver520BuildDaily = ver520BuildDaily;
window.ver520WeekRange = ver520WeekRange;
window.ver520BuildWeekly = ver520BuildWeekly;
window.ver520OperationCheck = ver520OperationCheck;
window.ver520ExportReport = ver520ExportReport;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      document.getElementById('ver520Date').value = typeof today === 'function' ? today() : new Date().toISOString().slice(0, 10);
    } catch (e) {}
  }, 1200);
});
