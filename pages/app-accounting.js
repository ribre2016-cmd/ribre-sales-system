/* RIBRE — Accounting pages 移行（ver380/390 の最終定義を pages 側へ集約） */
function ver380Closed() {
  try {
    return JSON.parse(localStorage.getItem('ribre_closed_months380') || '[]');
  } catch (e) {
    return [];
  }
}
function ver380SaveClosed(arr) {
  localStorage.setItem('ribre_closed_months380', JSON.stringify(arr.slice(0, 120)));
}
function ver380Render(rows) {
  const box = document.getElementById('monthCloseList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver380Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver380Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver380Yen(n) {
  return (Number(n) || 0).toLocaleString() + '円';
}
function ver380MonthValue() {
  return (document.getElementById('ver380Month').value || new Date().toISOString().slice(0, 7)).trim();
}
function ver380SalesData() {
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
function ver380PurchaseData() {
  const arr = [];
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  return arr;
}
function ver380MonthOf(x) {
  return x.month || String(x.date || x.sale_date || x.purchase_date || '').slice(0, 7) || '未設定';
}
function ver380Calc(month) {
  const s = ver380SalesData().filter((x) => ver380MonthOf(x) === month);
  const p = ver380PurchaseData().filter((x) => ver380MonthOf(x) === month);
  const salesTotal = s.reduce((a, x) => a + ver380Num(x.amount || x.price), 0);
  const shipping = s.reduce((a, x) => a + ver380Num(x.shipping || x.ship), 0);
  const fee = s.reduce((a, x) => a + ver380Num(x.fee), 0);
  const purchaseTotal = p.reduce((a, x) => a + ver380Num(x.total || x.cost || x.amount), 0);
  const profit = salesTotal - fee - shipping - purchaseTotal;
  const unmatched = s.filter((x) => !(x.deliveryCompany || x.slip || x.matchStatus === '配送一致' || Number(x.shipping || 0) > 0));
  return { month, s, p, salesTotal, shipping, fee, purchaseTotal, profit, unmatched };
}
function ver380PreviewClose() {
  const m = ver380MonthValue();
  const c = ver380Calc(m);
  ver380Set('ver380Target', m);
  ver380Set('ver380Sales', ver380Yen(c.salesTotal));
  ver380Set('ver380Purchase', ver380Yen(c.purchaseTotal));
  ver380Set('ver380Profit', ver380Yen(c.profit));
  ver380Render([
    { type: '売上', msg: '売上件数 ' + c.s.length + '件 / 売上 ' + ver380Yen(c.salesTotal) },
    { type: '送料', msg: '送料 ' + ver380Yen(c.shipping) + ' / 手数料 ' + ver380Yen(c.fee) },
    { type: '仕入', msg: '仕入件数 ' + c.p.length + '件 / 仕入 ' + ver380Yen(c.purchaseTotal) },
    { type: '利益', msg: '利益 ' + ver380Yen(c.profit) },
    { type: '未一致', level: c.unmatched.length ? 'warn' : 'ok', msg: '配送未一致 ' + c.unmatched.length + '件' }
  ]);
}
function ver380CloseMonth() {
  const m = ver380MonthValue();
  const c = ver380Calc(m);
  if (c.unmatched.length && !confirm('配送未一致が ' + c.unmatched.length + '件あります。このまま締めますか？')) return;
  const arr = ver380Closed().filter((x) => x.month !== m);
  arr.unshift({
    month: m,
    closedAt: new Date().toLocaleString('ja-JP'),
    user: typeof email === 'function' ? email() || '' : '',
    salesCount: c.s.length,
    purchaseCount: c.p.length,
    salesTotal: c.salesTotal,
    shipping: c.shipping,
    fee: c.fee,
    purchaseTotal: c.purchaseTotal,
    profit: c.profit,
    unmatchedCount: c.unmatched.length
  });
  ver380SaveClosed(arr);
  localStorage.setItem('ribre_closed_month300', m);
  ver380PreviewClose();
  ver380Render(
    [{ type: '月締め', msg: m + ' を締めました' }].concat(
      ver380Closed()
        .slice(0, 20)
        .map((x) => ({ type: x.month, msg: x.closedAt + ' / 利益 ' + ver380Yen(x.profit) + ' / 未一致 ' + x.unmatchedCount + '件' }))
    )
  );
}
function ver380ShowClosedMonths() {
  const arr = ver380Closed();
  ver380Render(
    arr.length
      ? arr.map((x) => ({
          type: x.month,
          msg: x.closedAt + ' / 売上 ' + ver380Yen(x.salesTotal) + ' / 仕入 ' + ver380Yen(x.purchaseTotal) + ' / 利益 ' + ver380Yen(x.profit)
        }))
      : [{ type: 'INFO', level: 'warn', msg: '締め済み月はありません' }]
  );
}
function ver380UnlockMonth() {
  const m = ver380MonthValue();
  if (!confirm(m + ' の締めを解除しますか？')) return;
  ver380SaveClosed(ver380Closed().filter((x) => x.month !== m));
  if (localStorage.getItem('ribre_closed_month300') === m) localStorage.removeItem('ribre_closed_month300');
  ver380Render([{ type: '解除', level: 'warn', msg: m + ' の締めを解除しました' }]);
}
function ver380ExportMonthlyReport() {
  const arr = ver380Closed();
  if (!arr.length) {
    alert('締め済み月がありません');
    return;
  }
  const rows = [['月', '締め日時', 'ユーザー', '売上件数', '仕入件数', '売上', '送料', '手数料', '仕入', '利益', '未一致']];
  arr.forEach((x) => rows.push([x.month, x.closedAt, x.user, x.salesCount, x.purchaseCount, x.salesTotal, x.shipping, x.fee, x.purchaseTotal, x.profit, x.unmatchedCount]));
  csvDownload(rows, 'monthly_close_report_Ver38_0.csv');
}

function ver390Render(rows) {
  const box = document.getElementById('accountingList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver390Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver390Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver390Month() {
  return (document.getElementById('ver390Month').value || new Date().toISOString().slice(0, 7)).trim();
}
function ver390MonthOf(x) {
  return x.month || String(x.date || x.sale_date || x.purchase_date || '').slice(0, 7) || '未設定';
}
function ver390Sales() {
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
function ver390Purchases() {
  const arr = [];
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    arr.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  return arr;
}
function ver390BuildJournal() {
  const month = ver390Month();
  const sales = ver390Sales().filter((x) => ver390MonthOf(x) === month);
  const purchases = ver390Purchases().filter((x) => ver390MonthOf(x) === month);
  const rows = [];

  sales.forEach((x) => {
    const date = x.date || x.sale_date || month + '-01';
    const amount = ver390Num(x.amount || x.price);
    const fee = ver390Num(x.fee);
    const shipping = ver390Num(x.shipping || x.ship);
    const memo = [x.itemId || x.id || '', x.name || x.item_name || '', x.shop || '', x.slip || ''].filter(Boolean).join(' / ');
    if (amount > 0) rows.push({ date, debit: '売掛金', credit: '売上高', amount, tax: '課税売上10%', memo });
    if (fee > 0) rows.push({ date, debit: '支払手数料', credit: '売掛金', amount: fee, tax: '課税仕入10%', memo: '手数料 / ' + memo });
    if (shipping > 0) rows.push({ date, debit: '荷造運賃', credit: '売掛金', amount: shipping, tax: '課税仕入10%', memo: '送料 / ' + memo });
  });

  purchases.forEach((x) => {
    const date = x.date || x.purchase_date || month + '-01';
    const amount = ver390Num(x.total || x.cost || x.amount);
    const memo = [x.vendor || '', x.name || x.item_name || '', x.invoiceNo || ''].filter(Boolean).join(' / ');
    if (amount > 0) rows.push({ date, debit: '仕入高', credit: '現金', amount, tax: '課税仕入10%', memo });
  });

  return { month, sales, purchases, rows };
}
function ver390Preview() {
  const data = ver390BuildJournal();
  ver390Set('ver390SalesJ', data.sales.length + '件');
  ver390Set('ver390PurJ', data.purchases.length + '件');
  ver390Set('ver390ShipJ', data.rows.filter((x) => x.debit === '荷造運賃').length + '件');
  ver390Set('ver390Target', data.month);
  localStorage.setItem('ribre_journal_preview390', JSON.stringify(data.rows.slice(0, 10000)));
  ver390Render(
    data.rows.slice(0, 120).map((x) => ({
      type: x.debit,
      msg: x.date + ' / 借方:' + x.debit + ' / 貸方:' + x.credit + ' / ' + Number(x.amount).toLocaleString() + '円 / ' + x.memo
    }))
  );
}
function ver390RowsByFormat(rows, fmt) {
  if (fmt === 'freee') {
    return [['発生日', '借方勘定科目', '貸方勘定科目', '金額', '税区分', '備考']].concat(rows.map((x) => [x.date, x.debit, x.credit, x.amount, x.tax, x.memo]));
  }
  if (fmt === 'mf') {
    return [['取引日', '借方勘定科目', '貸方勘定科目', '金額', '税区分', '摘要']].concat(rows.map((x) => [x.date, x.debit, x.credit, x.amount, x.tax, x.memo]));
  }
  return [['日付', '借方', '貸方', '金額', '税区分', '摘要']].concat(rows.map((x) => [x.date, x.debit, x.credit, x.amount, x.tax, x.memo]));
}
function ver390ExportJournal() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_journal_preview390') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver390Preview();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_journal_preview390') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    alert('出力する仕訳がありません');
    return;
  }
  const fmt = document.getElementById('ver390Format').value;
  csvDownload(ver390RowsByFormat(rows, fmt), 'journal_' + fmt + '_Ver39_0.csv');
}
function ver390ExportSummary() {
  const data = ver390BuildJournal();
  const salesTotal = data.sales.reduce((a, x) => a + ver390Num(x.amount || x.price), 0);
  const feeTotal = data.sales.reduce((a, x) => a + ver390Num(x.fee), 0);
  const shipTotal = data.sales.reduce((a, x) => a + ver390Num(x.shipping || x.ship), 0);
  const purTotal = data.purchases.reduce((a, x) => a + ver390Num(x.total || x.cost || x.amount), 0);
  const rows = [
    ['対象月', '売上件数', '仕入件数', '売上合計', '手数料', '送料', '仕入合計', '利益目安'],
    [data.month, data.sales.length, data.purchases.length, salesTotal, feeTotal, shipTotal, purTotal, salesTotal - feeTotal - shipTotal - purTotal]
  ];
  csvDownload(rows, 'accounting_summary_Ver39_0.csv');
}
function ver390Guide() {
  ver390Render([
    { type: '1', msg: '月締め後に対象月を入力します' },
    { type: '2', msg: '仕訳プレビューで売上・手数料・送料・仕入の仕訳を確認します' },
    { type: '3', msg: 'freee / マネーフォワード / 汎用形式でCSV出力できます' },
    { type: '注意', level: 'warn', msg: '勘定科目や税区分は会計担当者に合わせて調整してください' }
  ]);
}

window.ver380Closed = ver380Closed;
window.ver380SaveClosed = ver380SaveClosed;
window.ver380Render = ver380Render;
window.ver380Set = ver380Set;
window.ver380Num = ver380Num;
window.ver380Yen = ver380Yen;
window.ver380MonthValue = ver380MonthValue;
window.ver380SalesData = ver380SalesData;
window.ver380PurchaseData = ver380PurchaseData;
window.ver380MonthOf = ver380MonthOf;
window.ver380Calc = ver380Calc;
window.ver380PreviewClose = ver380PreviewClose;
window.ver380CloseMonth = ver380CloseMonth;
window.ver380ShowClosedMonths = ver380ShowClosedMonths;
window.ver380UnlockMonth = ver380UnlockMonth;
window.ver380ExportMonthlyReport = ver380ExportMonthlyReport;

window.ver390Render = ver390Render;
window.ver390Set = ver390Set;
window.ver390Num = ver390Num;
window.ver390Month = ver390Month;
window.ver390MonthOf = ver390MonthOf;
window.ver390Sales = ver390Sales;
window.ver390Purchases = ver390Purchases;
window.ver390BuildJournal = ver390BuildJournal;
window.ver390Preview = ver390Preview;
window.ver390RowsByFormat = ver390RowsByFormat;
window.ver390ExportJournal = ver390ExportJournal;
window.ver390ExportSummary = ver390ExportSummary;
window.ver390Guide = ver390Guide;
