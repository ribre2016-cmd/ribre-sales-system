/* RIBRE — 本体制御（ダッシュ・設定フォーム・売上/仕入 UI・クラウド月次。index.html から分離。ロジックは同一） */
function refreshTop() {
  document.getElementById('topUser').textContent = email()
    ? email() + ' / ' + role()
    : '未ログイン';
  document.getElementById('userView').textContent = email() || '未ログイン';
  document.getElementById('loginStatus').textContent = email() ? 'ログイン中' : '未ログイン';
  document.getElementById('cloudUser').textContent = email() || '未ログイン';
  document.getElementById('sbStatus').textContent = sb().url ? '設定済' : '未設定';
  document.getElementById('openaiStatus').textContent =
    localStorage.getItem(LS.openai) || localStorage.getItem('ribre_openai_key180')
      ? '保存済'
      : '未設定';
}
function refreshAll() {
  refreshTop();
  const s = sales(),
    p = purchases();
  const st = s.reduce((a, x) => a + num(x.amount), 0);
  const pt = p.reduce((a, x) => a + num(x.total || x.amount), 0);
  document.getElementById('dashSalesCount').textContent = s.length + '件';
  document.getElementById('dashPurchaseCount').textContent = p.length + '件';
  document.getElementById('dashSalesTotal').textContent = yen(st);
  document.getElementById('dashProfit').textContent = yen(st - pt);
  renderSales();
  renderPurchases();
  if (typeof window.monthlySummary === 'function') window.monthlySummary();
  else monthlySummary();
}
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
function saveSupabase() {
  const url = document.getElementById('sbUrl').value.trim();
  const key = document.getElementById('sbKey').value.trim();
  if (!url || !key) {
    alert('URLとkeyを入れてください');
    return;
  }
  setLS(LS.sb, { url, key });
  refreshAll();
  renderList('settingsList', [{ type: 'OK', msg: 'Supabase設定を保存しました' }]);
}
async function checkSupabase() {
  const r = await rest('sales', '?select=id&limit=1');
  document.getElementById('sbStatus').textContent = r.error ? 'エラー' : 'OK';
  renderList('settingsList', [
    {
      type: r.error ? 'ERROR' : 'OK',
      level: r.error ? 'danger' : 'ok',
      msg: r.error ? r.error.message : 'Supabase接続OK'
    }
  ]);
}
function saveOpenAI() {
  const k = document.getElementById('openaiKey').value.trim();
  if (!k) {
    alert('APIキーを入れてください');
    return;
  }
  localStorage.setItem(LS.openai, k);
  localStorage.setItem('ribre_openai_key180', k);
  document.getElementById('openaiKey').value = '';
  refreshAll();
  renderList('settingsList', [{ type: 'OK', msg: 'OpenAI APIキーを保存しました' }]);
}
function renderSales() {
  const data = sales();
  document.getElementById('salesTable').innerHTML =
    '<table><tr><th>日付</th><th>販売先</th><th>内容</th><th>金額</th><th>メモ</th></tr>' +
    data
      .slice(0, 200)
      .map(
        (x) =>
          '<tr><td>' +
          x.date +
          '</td><td>' +
          x.shop +
          '</td><td>' +
          x.name +
          '</td><td>' +
          yen(x.amount) +
          '</td><td>' +
          x.memo +
          '</td></tr>'
      )
      .join('') +
    '</table>';
}
function renderPurchases() {
  const data = purchases();
  document.getElementById('purchasesTable').innerHTML =
    '<table><tr><th>日付</th><th>仕入先</th><th>内容</th><th>金額</th><th>メモ</th></tr>' +
    data
      .slice(0, 200)
      .map(
        (x) =>
          '<tr><td>' +
          x.date +
          '</td><td>' +
          x.vendor +
          '</td><td>' +
          x.name +
          '</td><td>' +
          yen(x.total || x.amount) +
          '</td><td>' +
          x.memo +
          '</td></tr>'
      )
      .join('') +
    '</table>';
}
function addSale() {
  const row = {
    id: 's_' + Date.now(),
    date: document.getElementById('saleDate').value || today(),
    month: (document.getElementById('saleDate').value || today()).slice(0, 7),
    shop: document.getElementById('saleShop').value,
    name: document.getElementById('saleName').value,
    amount: num(document.getElementById('saleAmount').value),
    memo: document.getElementById('saleMemo').value,
    source: 'manual'
  };
  const a = sales();
  a.unshift(row);
  setLS(LS.sales, a);
  refreshAll();
}
function addPurchase() {
  const row = {
    id: 'p_' + Date.now(),
    date: document.getElementById('purDate').value || today(),
    month: (document.getElementById('purDate').value || today()).slice(0, 7),
    vendor: document.getElementById('purVendor').value,
    name: document.getElementById('purName').value,
    total: num(document.getElementById('purAmount').value),
    memo: document.getElementById('purMemo').value,
    source: 'manual'
  };
  const a = purchases();
  a.unshift(row);
  setLS(LS.purchases, a);
  refreshAll();
}
function exportSalesCsv() {
  csvDownload(
    [
      ['日付', '販売先', '内容', '金額', 'メモ'],
      ...sales().map((x) => [x.date, x.shop, x.name, x.amount, x.memo])
    ],
    'sales_Ver22_1.csv'
  );
}
function exportPurchasesCsv() {
  csvDownload(
    [
      ['日付', '仕入先', '内容', '金額', 'メモ'],
      ...purchases().map((x) => [x.date, x.vendor, x.name, x.total || x.amount, x.memo])
    ],
    'purchases_Ver22_1.csv'
  );
}
function cloudMonthly() {
  const s = get('ribre_cloud_sales221', []),
    p = get('ribre_cloud_purchases221', []),
    map = {};
  s.forEach((x) => {
    const m = x.month || String(x.sale_date || '').slice(0, 7) || '未設定';
    map[m] = map[m] || { s: 0, p: 0 };
    map[m].s += num(x.amount);
  });
  p.forEach((x) => {
    const m = x.month || String(x.purchase_date || '').slice(0, 7) || '未設定';
    map[m] = map[m] || { s: 0, p: 0 };
    map[m].p += num(x.total || x.cost);
  });
  renderList(
    'cloudList',
    Object.keys(map)
      .sort()
      .reverse()
      .map((m) => ({
        type: m,
        msg:
          '売上 ' +
          yen(map[m].s) +
          ' / 仕入 ' +
          yen(map[m].p) +
          ' / 利益 ' +
          yen(map[m].s - map[m].p)
      }))
  );
}
window.addEventListener('load', () => {
  const c = sb();
  if (c.url) document.getElementById('sbUrl').value = c.url;
  if (c.key) document.getElementById('sbKey').value = c.key;
  refreshAll();
  monthlySummary();
});

window.refreshTop = refreshTop;
window.refreshAll = refreshAll;
window.monthlySummary = monthlySummary;
