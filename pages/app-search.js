/* RIBRE — Search pages 移行（ver330-search-filter の最終定義を pages 側へ集約） */
function ver330Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver330AllSales() {
  const a = [];
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_registered_sales210') || '[]'));
  } catch (e) {}
  const seen = new Set();
  return a
    .filter((x) => {
      const k = String(x.itemId || x.id || x.date + '_' + x.name + '_' + (x.amount || x.price));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x) => Object.assign({ __kind: '売上' }, x));
}
function ver330AllPurchases() {
  const a = [];
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  const seen = new Set();
  return a
    .filter((x) => {
      const k = String(x.id || x.date + '_' + x.name + '_' + (x.total || x.cost || x.amount));
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((x) => Object.assign({ __kind: '仕入' }, x));
}
function ver330Text(x) {
  return [
    x.__kind,
    x.itemId,
    x.id,
    x.date,
    x.month,
    x.shop,
    x.vendor,
    x.name,
    x.item_name,
    x.amount,
    x.price,
    x.total,
    x.cost,
    x.slip,
    x.invoiceNo,
    x.deliveryCompany,
    x.matchStatus,
    x.memo
  ]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
}
function ver330Month(x) {
  return x.month || String(x.date || x.sale_date || x.purchase_date || '').slice(0, 7) || '';
}
function ver330IsMatched(x) {
  return !!(x.deliveryCompany || x.slip || x.matchStatus === '配送一致' || Number(x.shipping || x.ship || 0) > 0);
}
function ver330Render(rows) {
  const box = document.getElementById('searchList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((x) => {
      const amount = x.__kind === '売上' ? ver330Num(x.amount || x.price) : ver330Num(x.total || x.cost || x.amount);
      const id = x.itemId || x.id || '';
      const name = x.name || x.item_name || '';
      const partner = x.shop || x.vendor || '';
      const slip = x.slip || x.invoiceNo || '';
      const ship = x.shipping || x.ship || 0;
      return (
        '<div class="row ' +
        (x.__kind === '売上' ? 'ok' : 'warn') +
        '"><span>' +
        x.__kind +
        ' / ' +
        (x.date || x.sale_date || x.purchase_date || '') +
        ' / ' +
        partner +
        ' / ' +
        id +
        ' / ' +
        name +
        ' / 金額:' +
        amount.toLocaleString() +
        '円 / 送料:' +
        ship +
        ' / 伝票:' +
        slip +
        '</span><span class="badge">' +
        (x.matchStatus || x.__kind) +
        '</span></div>'
      );
    })
    .join('');
}
function ver330Search() {
  const kw = (document.getElementById('ver330Keyword').value || '').toLowerCase().trim();
  const type = document.getElementById('ver330Type').value;
  const month = (document.getElementById('ver330Month').value || '').trim();

  let rows = [];
  if (type === 'sales' || type === 'unmatched' || type === 'zeroShipping') rows = ver330AllSales();
  else if (type === 'purchases') rows = ver330AllPurchases();
  else rows = ver330AllSales().concat(ver330AllPurchases());

  if (kw) rows = rows.filter((x) => ver330Text(x).includes(kw));
  if (month) rows = rows.filter((x) => ver330Month(x) === month);
  if (type === 'unmatched') rows = rows.filter((x) => x.__kind === '売上' && !ver330IsMatched(x));
  if (type === 'zeroShipping') rows = rows.filter((x) => x.__kind === '売上' && Number(x.shipping || x.ship || 0) === 0);

  localStorage.setItem('ribre_search_results330', JSON.stringify(rows.slice(0, 5000)));
  document.getElementById('ver330ResultCount').textContent = rows.length + '件';
  document.getElementById('ver330SalesCount').textContent = rows.filter((x) => x.__kind === '売上').length + '件';
  document.getElementById('ver330PurchaseCount').textContent = rows.filter((x) => x.__kind === '仕入').length + '件';
  document.getElementById('ver330Status').textContent = '検索OK';
  ver330Render(rows);
}
function ver330Clear() {
  document.getElementById('ver330Keyword').value = '';
  document.getElementById('ver330Month').value = '';
  document.getElementById('ver330Type').value = 'all';
  localStorage.removeItem('ribre_search_results330');
  document.getElementById('ver330ResultCount').textContent = '0件';
  document.getElementById('ver330SalesCount').textContent = '0件';
  document.getElementById('ver330PurchaseCount').textContent = '0件';
  document.getElementById('ver330Status').textContent = '待機';
  document.getElementById('searchList').innerHTML = '';
}
function ver330ExportSearch() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_search_results330') || '[]');
  } catch (e) {}
  if (!rows.length) {
    alert('先に検索してください');
    return;
  }
  const csvRows = [['区分', '商品ID', '日付', '月', '販売先/仕入先', '内容', '金額', '送料', '伝票番号', '配送会社', '状態', 'メモ']];
  rows.forEach((x) =>
    csvRows.push([
      x.__kind,
      x.itemId || x.id || '',
      x.date || x.sale_date || x.purchase_date || '',
      ver330Month(x),
      x.shop || x.vendor || '',
      x.name || x.item_name || '',
      x.amount || x.price || x.total || x.cost || 0,
      x.shipping || x.ship || 0,
      x.slip || x.invoiceNo || '',
      x.deliveryCompany || '',
      x.matchStatus || '',
      x.memo || ''
    ])
  );
  csvDownload(csvRows, 'search_results_Ver33_0.csv');
}

window.ver330Num = ver330Num;
window.ver330AllSales = ver330AllSales;
window.ver330AllPurchases = ver330AllPurchases;
window.ver330Text = ver330Text;
window.ver330Month = ver330Month;
window.ver330IsMatched = ver330IsMatched;
window.ver330Render = ver330Render;
window.ver330Search = ver330Search;
window.ver330Clear = ver330Clear;
window.ver330ExportSearch = ver330ExportSearch;
