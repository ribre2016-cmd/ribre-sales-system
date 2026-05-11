/* RIBRE — Analytics pages 移行（ver280 の最終定義を pages 側へ集約） */
function ver280Sales() {
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
  return a.filter((x) => {
    const k = String(x.itemId || x.id || x.date + '_' + x.name + '_' + x.amount);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function ver280Purchases() {
  const a = [];
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  const seen = new Set();
  return a.filter((x) => {
    const k = String(x.id || x.date + '_' + x.name + '_' + (x.total || x.cost || x.amount));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
function ver280Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver280Yen(n) {
  return (Number(n) || 0).toLocaleString() + '円';
}
function ver280Month(x) {
  return x.month || String(x.date || x.sale_date || x.purchase_date || '').slice(0, 7) || '未設定';
}
function ver280Render(rows) {
  const box = document.getElementById('analyticsList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver280BuildData() {
  const map = {};
  ver280Sales().forEach((x) => {
    const m = ver280Month(x);
    map[m] = map[m] || { sales: 0, shipping: 0, fee: 0, purchases: 0, profit: 0, countS: 0, countP: 0 };
    const amount = ver280Num(x.amount || x.price);
    const fee = ver280Num(x.fee);
    const shipping = ver280Num(x.shipping || x.ship);
    const profit = x.profit !== undefined && x.profit !== '' ? ver280Num(x.profit) : amount - fee - shipping;
    map[m].sales += amount;
    map[m].fee += fee;
    map[m].shipping += shipping;
    map[m].profit += profit;
    map[m].countS++;
  });
  ver280Purchases().forEach((x) => {
    const m = ver280Month(x);
    map[m] = map[m] || { sales: 0, shipping: 0, fee: 0, purchases: 0, profit: 0, countS: 0, countP: 0 };
    const total = ver280Num(x.total || x.cost || x.amount);
    map[m].purchases += total;
    map[m].profit -= total;
    map[m].countP++;
  });
  return map;
}
function ver280BuildAnalytics() {
  const map = ver280BuildData();
  const months = Object.keys(map).sort();
  const totalSales = months.reduce((a, m) => a + map[m].sales, 0);
  const totalShip = months.reduce((a, m) => a + map[m].shipping, 0);
  const totalProfit = months.reduce((a, m) => a + map[m].profit, 0);
  document.getElementById('ver280MonthCount').textContent = months.length;
  document.getElementById('ver280TotalSales').textContent = ver280Yen(totalSales);
  document.getElementById('ver280TotalShipping').textContent = ver280Yen(totalShip);
  document.getElementById('ver280TotalProfit').textContent = ver280Yen(totalProfit);

  ver280DrawChart(months, map);

  const rows = months
    .slice()
    .reverse()
    .map((m) => ({
      type: m,
      level: 'ok',
      msg:
        '売上 ' +
        ver280Yen(map[m].sales) +
        ' / 仕入 ' +
        ver280Yen(map[m].purchases) +
        ' / 送料 ' +
        ver280Yen(map[m].shipping) +
        ' / 利益 ' +
        ver280Yen(map[m].profit) +
        ' / 売上件数 ' +
        map[m].countS +
        '件'
    }));
  ver280Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '集計データがありません' }]);
}
function ver280DrawChart(months, map) {
  const c = document.getElementById('ver280Chart');
  if (!c) return;
  const ctx = c.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = c.getBoundingClientRect();
  c.width = rect.width * dpr;
  c.height = 260 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, 260);

  const pad = 42,
    w = rect.width - pad * 2,
    h = 200;
  const vals = months.flatMap((m) => [map[m].sales, map[m].profit]);
  const max = Math.max(1, ...vals);
  ctx.font = '12px sans-serif';
  ctx.strokeStyle = '#cbd5e1';
  ctx.beginPath();
  ctx.moveTo(pad, 20);
  ctx.lineTo(pad, 220);
  ctx.lineTo(rect.width - pad, 220);
  ctx.stroke();

  function y(v) {
    return 220 - (v / max) * h;
  }
  function x(i) {
    return pad + (months.length <= 1 ? 0 : i * (w / (months.length - 1)));
  }

  function line(key) {
    ctx.beginPath();
    months.forEach((m, i) => {
      const xx = x(i),
        yy = y(map[m][key]);
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    });
    ctx.stroke();
    months.forEach((m, i) => {
      ctx.beginPath();
      ctx.arc(x(i), y(map[m][key]), 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }
  ctx.strokeStyle = '#2563eb';
  ctx.fillStyle = '#2563eb';
  line('sales');
  ctx.strokeStyle = '#059669';
  ctx.fillStyle = '#059669';
  line('profit');

  ctx.fillStyle = '#334155';
  months.forEach((m, i) => {
    ctx.fillText(m.slice(5) || m, x(i) - 16, 238);
  });
  ctx.fillStyle = '#2563eb';
  ctx.fillText('売上', pad, 12);
  ctx.fillStyle = '#059669';
  ctx.fillText('利益', pad + 45, 12);
}
function ver280ExportAll() {
  const rows = [['区分', '商品ID', '日付', '月', '販売先/仕入先', '内容', '金額', '手数料', '送料', '利益', '伝票番号', '配送会社', '状態', 'メモ']];
  ver280Sales().forEach((x) =>
    rows.push([
      '売上',
      x.itemId || x.id || '',
      x.date || x.sale_date || '',
      ver280Month(x),
      x.shop || '',
      x.name || x.item_name || '',
      x.amount || x.price || 0,
      x.fee || 0,
      x.shipping || x.ship || 0,
      x.profit || 0,
      x.slip || x.invoiceNo || '',
      x.deliveryCompany || '',
      x.matchStatus || '',
      x.memo || ''
    ])
  );
  ver280Purchases().forEach((x) =>
    rows.push([
      '仕入',
      x.id || '',
      x.date || x.purchase_date || '',
      ver280Month(x),
      x.vendor || '',
      x.name || x.item_name || '',
      x.total || x.cost || x.amount || 0,
      '',
      '',
      '',
      x.invoiceNo || '',
      '',
      x.matchStatus || '',
      x.memo || ''
    ])
  );
  csvDownload(rows, 'all_sales_purchases_Ver28_0.csv');
}
function ver280ExportRawJoined() {
  const rows = [['元区分', 'JSON']];
  ver280Sales().forEach((x) => rows.push(['sales', JSON.stringify(x)]));
  ver280Purchases().forEach((x) => rows.push(['purchases', JSON.stringify(x)]));
  csvDownload(rows, 'raw_joined_Ver28_0.csv');
}
function ver280ShowProfitRanking() {
  const rows = ver280Sales()
    .slice()
    .sort((a, b) => ver280Num(b.profit || b.amount) - ver280Num(a.profit || a.amount))
    .slice(0, 100)
    .map((x, i) => ({
      type: i + 1 + '位',
      level: 'ok',
      msg: (x.itemId || x.id || '') + ' / ' + (x.name || '') + ' / 利益 ' + ver280Yen(x.profit || x.amount)
    }));
  ver280Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '売上データがありません' }]);
}
function ver280Guide() {
  ver280Render([
    { type: '1', level: 'ok', msg: 'ヤフオクCSV・配送照合・OCR登録後に使います' },
    { type: '2', level: 'ok', msg: '月別集計を作成で売上/送料/利益を確認' },
    { type: '3', level: 'ok', msg: '全件CSV出力で会計・確認用データを出力' },
    { type: '4', level: 'ok', msg: '元データ結合CSVで元JSONを保持した一覧を出力' }
  ]);
}
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver280Guide();
    } catch (e) {}
  }, 1200);
});

window.ver280Sales = ver280Sales;
window.ver280Purchases = ver280Purchases;
window.ver280Num = ver280Num;
window.ver280Yen = ver280Yen;
window.ver280Month = ver280Month;
window.ver280Render = ver280Render;
window.ver280BuildData = ver280BuildData;
window.ver280BuildAnalytics = ver280BuildAnalytics;
window.ver280DrawChart = ver280DrawChart;
window.ver280ExportAll = ver280ExportAll;
window.ver280ExportRawJoined = ver280ExportRawJoined;
window.ver280ShowProfitRanking = ver280ShowProfitRanking;
window.ver280Guide = ver280Guide;
