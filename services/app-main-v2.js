/* RIBRE — 本体制御（ダッシュ・設定フォーム・売上/仕入 UI・クラウド月次。index.html から分離。ロジックは同一） */
function _vmMonth() { return window._ribreViewMonth || today().slice(0, 7); }
function prevMonth() {
  const p = _vmMonth().split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 2, 1);
  window._ribreViewMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  refreshAll();
}
function nextMonth() {
  const p = _vmMonth().split('-');
  const d = new Date(Number(p[0]), Number(p[1]), 1);
  window._ribreViewMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  refreshAll();
}
function refreshMonthDisplay() {
  const vm = _vmMonth();
  const p = vm.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  ['currentViewMonth', 'currentViewMonthSales'].forEach(function(id) {
    const el = document.getElementById(id);
    if (el) el.textContent = label;
  });
}
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
  refreshMonthDisplay();
  const vm = _vmMonth();
  const s = sales().filter(x => (x.month || String(x.date || '').slice(0, 7)) === vm);
  const p = purchases().filter(x => (x.month || String(x.date || '').slice(0, 7)) === vm);
  const st = s.reduce((a, x) => a + num(x.amount), 0);
  const pt = p.reduce((a, x) => a + num(x.total || x.amount), 0);
  document.getElementById('dashSalesCount').textContent = s.length + '件';
  document.getElementById('dashPurchaseCount').textContent = p.length + '件';
  document.getElementById('dashSalesTotal').textContent = yen(st);
  document.getElementById('dashProfit').textContent = yen(st - pt);
  renderSales();
  renderPurchases();
  const dashList = document.getElementById('dashList');
  if (dashList) dashList.innerHTML = '';
  if (typeof window.monthlySummary === 'function') window.monthlySummary('refresh');
  else monthlySummary('refresh');
}
function monthlySummary(mode) {
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
  const actionMsg =
    mode === 'refresh'
      ? { type: '再集計', msg: '再集計しました' }
      : { type: '月別集計', msg: '月別集計しました' };
  const dashList = document.getElementById('dashList');
  if (dashList) dashList.innerHTML = '';
  renderList(
    'dashList',
    [actionMsg].concat(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: 'データがありません' }])
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
  const vm = _vmMonth();
  const allSales = sales();
  const indexed = allSales.map((x, origIdx) => ({ x, origIdx }));
  const shopClsMap = {
    'ヤフオク1': 'shop-yahoo1', 'ヤフオク2': 'shop-yahoo2', 'ヤフオク3': 'shop-yahoo3',
    'ヤフオク4': 'shop-yahoo4', 'ヤフオク5': 'shop-yahoo5', 'ヤフオク6': 'shop-yahoo6',
    'ヤフオク7': 'shop-yahoo7', 'ヤフオク8': 'shop-yahoo8',
    'メルカリ': 'shop-mercari', 'メルカリShops': 'shop-mercari-shops', 'ラクマ': 'shop-rakuma'
  };
  const filterEl = document.getElementById('salesShopFilter');
  const filterVal = filterEl ? filterEl.value : '';
  const searchEl = document.getElementById('salesItemIdSearch');
  const searchVal = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const data = indexed.filter(({ x }) => (x.month || String(x.date || '').slice(0, 7)) === vm);
  const byShop = filterVal ? data.filter(({ x }) => x.shop === filterVal) : data;
  const filtered = searchVal
    ? byShop.filter(({ x }) => {
        const haystack = [x.itemId, x.id, x.name, x.title, x.content, x.itemName]
          .filter(Boolean).join(' ').toLowerCase();
        return haystack.includes(searchVal);
      })
    : byShop;
  const infoEl = document.getElementById('salesFilterInfo');
  if (infoEl) {
    infoEl.textContent = (filterVal || searchVal)
      ? filtered.length + '件 / 全' + data.length + '件'
      : '全' + data.length + '件';
  }
  const rows = filtered.map(({ x, origIdx }, i) => {
    const cls = shopClsMap[x.shop] || '';
    const profit = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
    const settle = num(x.amount || 0);
    const ship = num(x.shipping || 0);
    const ms = x.matchStatus || '';
    const shipOk = ship > 0 || ms === '手入力' || ms === '匿名配送' || ms === '配送CSV一致'
                 || String(x.memo || '').includes('匿名');
    let anomaly = '';
    if (profit < 0) anomaly = 'sale-al';
    else if (settle === 0) anomaly = 'sale-az';
    else if (profit === 0) anomaly = 'sale-zp';
    else if (!shipOk) anomaly = 'sale-ns';
    const isLocked = String(x.memo || '').includes('[LOCK]');
    const memoDisplay = String(x.memo || '').replace(/\s*\/\s*\[LOCK\]|\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim();
    const profitTd = profit < 0
      ? '<td class="sale-loss-cell">' + yen(profit) + '</td>'
      : '<td>' + yen(profit) + '</td>';
    return '<tr class="' + cls + (anomaly ? ' ' + anomaly : '') + (isLocked ? ' sale-locked' : '') + '">' +
      '<td><input type="checkbox" class="sales-row-cb" data-id="' + origIdx + '" onchange="updateSalesSelectCount()"></td>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + (x.date || '') + '</td>' +
      '<td>' + (x.shop || '') + '</td>' +
      '<td>' + (x.itemId || '') + '</td>' +
      '<td>' + (x.name || '') + '</td>' +
      '<td>' + yen(x.fee || 0) + '</td>' +
      '<td>' + yen(x.shipping || 0) + '</td>' +
      profitTd +
      '<td>' + yen(x.amount || 0) + '</td>' +
      '<td>' + yen(x.price || x.amount || 0) + '</td>' +
      '<td>' + (isLocked ? '🔒 ' : '') + memoDisplay + '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('salesTable').innerHTML =
    '<div class="sales-table-wrap"><table class="sales-tbl">' +
    '<thead><tr><th><input type="checkbox" id="salesSelectAll" onchange="toggleAllSales(this)"></th>' +
    '<th>連番</th><th>日付</th><th>販売先</th><th>商品ID</th><th>内容</th>' +
    '<th>手数料</th><th>送料</th><th>利益</th><th>決済金額</th><th>金額</th><th>メモ</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
  updateSalesSelectCount();
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
      ['日付', '販売先', '商品ID', '内容', '手数料', '送料', '利益', '決済金額', '金額', 'メモ'],
      ...sales().map((x) => {
        const profit = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
        return [x.date, x.shop, x.itemId || '', x.name, x.fee || 0, x.shipping || 0, profit, x.amount || 0, x.price || x.amount || 0, x.memo];
      })
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
  if (!window._ribreViewMonth) window._ribreViewMonth = today().slice(0, 7);
  const c = sb();
  if (c.url) document.getElementById('sbUrl').value = c.url;
  if (c.key) document.getElementById('sbKey').value = c.key;
  refreshAll();
  monthlySummary();
});

function updateSalesSelectCount() {
  const checked = document.querySelectorAll('.sales-row-cb:checked').length;
  const total = document.querySelectorAll('.sales-row-cb').length;
  const el = document.getElementById('salesSelectInfo');
  if (el) el.textContent = checked > 0 ? '選択中: ' + checked + '件' : '';
  const hdr = document.getElementById('salesSelectAll');
  if (hdr) {
    hdr.indeterminate = checked > 0 && checked < total;
    hdr.checked = total > 0 && checked === total;
  }
}
function toggleAllSales(cb) {
  document.querySelectorAll('.sales-row-cb').forEach(function(el) { el.checked = cb.checked; });
  updateSalesSelectCount();
}
function applyBulkMemo() {
  const memoText = (document.getElementById('bulkMemoInput') || {}).value;
  if (!memoText || !memoText.trim()) { alert('メモを入力してください'); return; }
  const text = memoText.trim();
  const checked = document.querySelectorAll('.sales-row-cb:checked');
  if (!checked.length) { alert('行を選択してください'); return; }
  const ids = Array.from(checked).map(function(cb) { return cb.dataset.id; }).filter(Boolean);
  if (!ids.length) return;
  const s = sales();
  let changed = 0;
  ids.forEach(function(id) {
    const idx = Number(id);
    if (!Number.isFinite(idx) || idx < 0 || idx >= s.length) return;
    const existing = String(s[idx].memo || '').trim();
    s[idx].memo = existing ? existing + ' / ' + text : text;
    changed++;
  });
  if (changed > 0) {
    setLS(LS.sales, s);
    document.getElementById('bulkMemoInput').value = '';
    refreshAll();
  }
}
function applyBulkLock() {
  const checked = document.querySelectorAll('.sales-row-cb:checked');
  if (!checked.length) { alert('行を選択してください'); return; }
  const ids = Array.from(checked).map(function(cb) { return cb.dataset.id; }).filter(Boolean);
  const s = sales();
  let changed = 0;
  ids.forEach(function(id) {
    const idx = Number(id);
    if (!Number.isFinite(idx) || idx < 0 || idx >= s.length) return;
    const memo = String(s[idx].memo || '').trim();
    if (memo.includes('[LOCK]')) return;
    s[idx].memo = memo ? memo + ' / [LOCK]' : '[LOCK]';
    changed++;
  });
  if (changed > 0) { setLS(LS.sales, s); refreshAll(); }
}
function applyBulkUnlock() {
  const checked = document.querySelectorAll('.sales-row-cb:checked');
  if (!checked.length) { alert('行を選択してください'); return; }
  const ids = Array.from(checked).map(function(cb) { return cb.dataset.id; }).filter(Boolean);
  const s = sales();
  let changed = 0;
  ids.forEach(function(id) {
    const idx = Number(id);
    if (!Number.isFinite(idx) || idx < 0 || idx >= s.length) return;
    const memo = String(s[idx].memo || '');
    if (!memo.includes('[LOCK]')) return;
    s[idx].memo = memo.replace(/\s*\/\s*\[LOCK\]/g, '').replace(/\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim();
    changed++;
  });
  if (changed > 0) { setLS(LS.sales, s); refreshAll(); }
}
window.refreshTop = refreshTop;
window.refreshAll = refreshAll;
window.monthlySummary = monthlySummary;
window.prevMonth = prevMonth;
window.nextMonth = nextMonth;
window.updateSalesSelectCount = updateSalesSelectCount;
window.toggleAllSales = toggleAllSales;
window.applyBulkMemo = applyBulkMemo;
window.applyBulkLock = applyBulkLock;
window.applyBulkUnlock = applyBulkUnlock;
