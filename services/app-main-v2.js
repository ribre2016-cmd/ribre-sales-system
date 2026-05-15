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
function isMonthClosed(vm) {
  const rows = sales().filter(x => (x.month || String(x.date || '').slice(0, 7)) === vm);
  return rows.length > 0 && rows.every(x => String(x.memo || '').includes('[LOCK]'));
}
function closeMonth() {
  const vm = _vmMonth();
  const p = vm.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  if (!confirm(label + 'のデータをすべてロックします。よろしいですか？')) return;
  const s = sales();
  let changed = 0;
  s.forEach(function(x, idx) {
    if ((x.month || String(x.date || '').slice(0, 7)) !== vm) return;
    const memo = String(x.memo || '').trim();
    if (memo.includes('[LOCK]')) return;
    s[idx].memo = memo ? memo + ' / [LOCK]' : '[LOCK]';
    changed++;
  });
  if (changed > 0) { setLS(LS.sales, s); logOp(label + 'を月締め（' + changed + '件）'); refreshAll(); }
  else { alert('対象行がないか、すでにすべてロック済みです。'); }
}
function openMonth() {
  const vm = _vmMonth();
  const p = vm.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  if (!confirm(label + 'の締めを解除します。よろしいですか？')) return;
  const s = sales();
  let changed = 0;
  s.forEach(function(x, idx) {
    if ((x.month || String(x.date || '').slice(0, 7)) !== vm) return;
    const memo = String(x.memo || '');
    if (!memo.includes('[LOCK]')) return;
    s[idx].memo = memo.replace(/\s*\/\s*\[LOCK\]/g, '').replace(/\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim();
    changed++;
  });
  if (changed > 0) { setLS(LS.sales, s); logOp(label + 'の締め解除（' + changed + '件）'); refreshAll(); }
  else { alert('ロック済みの行がありません。'); }
}
function refreshMonthDisplay() {
  const vm = _vmMonth();
  const p = vm.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  const closed = isMonthClosed(vm);
  const suffixed = closed ? label + '【締め済み】' : label;
  ['currentViewMonth', 'currentViewMonthSales'].forEach(function(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = suffixed;
    el.classList.toggle('month-closed', closed);
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
  renderOpLog();
  if (window.renderShipUnmatchAnalysis) window.renderShipUnmatchAnalysis();
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
  const qf = window._ribreQuickFilter || 'all';
  const quickFiltered = qf === 'all' ? filtered : filtered.filter(({ x }) => {
    const profit = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
    const settle = num(x.amount || 0);
    const ship = num(x.shipping || 0);
    const ms = String(x.matchStatus || '');
    const memo = String(x.memo || '');
    const isAnon = ship > 0 || ms === '手入力' || ms === '匿名配送' || ms === '配送CSV一致' || memo.includes('匿名');
    if (qf === 'unmatched') return !isAnon && ship === 0;
    if (qf === 'anomaly') return profit < 0 || settle === 0 || profit === 0;
    if (qf === 'noship') return ship === 0 && !isAnon;
    if (qf === 'locked') return memo.includes('[LOCK]');
    if (qf === 'memo') return !!memo.replace(/\s*\/\s*\[LOCK\]|\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim();
    return true;
  });
  const qfLabels = { unmatched: '未一致', anomaly: '利益異常', noship: '送料0', locked: 'ロック済', memo: 'メモあり' };
  const condParts = [vm.slice(0, 4) + '年' + vm.slice(5) + '月'];
  if (filterVal) condParts.push(filterVal);
  if (searchVal) condParts.push('検索「' + searchVal + '」');
  if (qf !== 'all') condParts.push(qfLabels[qf] || qf);
  const condLabelEl = document.getElementById('filterCondLabel');
  if (condLabelEl) condLabelEl.textContent = '表示条件：' + condParts.join(' / ') + (quickFiltered.length === 0 ? '　（該当なし）' : '');
  window._ribreDisplayedCount = quickFiltered.length;
  const infoEl = document.getElementById('salesFilterInfo');
  if (infoEl) {
    infoEl.textContent = (filterVal || searchVal || qf !== 'all')
      ? quickFiltered.length + '件 / 全' + data.length + '件'
      : '全' + data.length + '件';
  }
  const rows = quickFiltered.length === 0
    ? '<tr><td colspan="12" style="text-align:center;padding:24px;color:#94a3b8;font-size:13px">条件に一致する売上がありません</td></tr>'
    : quickFiltered.map(({ x, origIdx }, i) => {
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
  renderStatusPanel();
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
  const bar = document.getElementById('selectBar');
  if (bar) {
    if (checked > 0) {
      bar.textContent = checked + '件選択中 ― メモ適用・ロック・解除が使えます';
      bar.style.display = 'block';
    } else {
      bar.style.display = 'none';
    }
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
  let skipped = 0;
  ids.forEach(function(id) {
    const idx = Number(id);
    if (!Number.isFinite(idx) || idx < 0 || idx >= s.length) return;
    if (String(s[idx].memo || '').includes('[LOCK]')) { skipped++; return; }
    const existing = String(s[idx].memo || '').trim();
    s[idx].memo = existing ? existing + ' / ' + text : text;
    changed++;
  });
  if (skipped > 0) alert(ids.length + '件中' + skipped + '件がロック済みのため、' + changed + '件だけ更新しました。');
  if (changed > 0) {
    setLS(LS.sales, s);
    logOp('一括メモ適用（' + changed + '件）' + (skipped ? ' ※' + skipped + '件ロック済スキップ' : ''));
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
  if (changed > 0) { setLS(LS.sales, s); logOp('一括ロック（' + changed + '件）'); refreshAll(); }
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
  if (changed > 0) { setLS(LS.sales, s); logOp('一括ロック解除（' + changed + '件）'); refreshAll(); }
}
function logOp(msg) {
  try {
    const logs = JSON.parse(sessionStorage.getItem('ribre_op_log') || '[]');
    const now = new Date();
    const ts = now.getFullYear() + '/' +
      String(now.getMonth() + 1).padStart(2, '0') + '/' +
      String(now.getDate()).padStart(2, '0') + ' ' +
      String(now.getHours()).padStart(2, '0') + ':' +
      String(now.getMinutes()).padStart(2, '0');
    logs.unshift({ ts, msg });
    sessionStorage.setItem('ribre_op_log', JSON.stringify(logs.slice(0, 50)));
  } catch(e) {}
}
function renderOpLog() {
  const el = document.getElementById('opLogList');
  if (!el) return;
  try {
    const logs = JSON.parse(sessionStorage.getItem('ribre_op_log') || '[]');
    if (!logs.length) { el.innerHTML = '<div class="row"><span style="color:#64748b">ログがありません（このタブのセッション中の操作が記録されます）</span></div>'; return; }
    el.innerHTML = logs.slice(0, 10).map(function(x) {
      return '<div class="row ok"><span>' + x.ts + '　' + x.msg + '</span></div>';
    }).join('');
  } catch(e) { el.innerHTML = ''; }
}
function clearOpLog() {
  try { sessionStorage.removeItem('ribre_op_log'); } catch(e) {}
  renderOpLog();
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
function renderStatusPanel() {
  const el = document.getElementById('statusPanel');
  if (!el) return;
  const vm = _vmMonth();
  const allSales = sales();
  const ms = allSales.filter(x => (x.month || String(x.date || '').slice(0, 7)) === vm);
  const locked = ms.filter(x => String(x.memo || '').includes('[LOCK]')).length;
  const unmatched = ms.filter(x => {
    const ship = num(x.shipping || 0);
    const st = String(x.matchStatus || '');
    const m = String(x.memo || '');
    const anon = ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名');
    return !anon && ship === 0;
  }).length;
  const anomaly = ms.filter(x => {
    const profit = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
    return profit < 0 || num(x.amount || 0) === 0 || profit === 0;
  }).length;
  const noship = ms.filter(x => {
    const ship = num(x.shipping || 0);
    const st = String(x.matchStatus || '');
    const m = String(x.memo || '');
    const anon = ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名');
    return ship === 0 && !anon;
  }).length;
  const memoCount = ms.filter(x =>
    !!String(x.memo || '').replace(/\s*\/\s*\[LOCK\]|\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim()
  ).length;
  let lsBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2;
    }
  } catch(e) {}
  const lsMB = (lsBytes / 1048576).toFixed(1);
  const lsWarn = lsBytes > 4 * 1048576;
  let lastLog = '';
  try {
    const logs = JSON.parse(sessionStorage.getItem('ribre_op_log') || '[]');
    if (logs.length) lastLog = logs[0].ts;
  } catch(e) {}
  const qf = window._ribreQuickFilter || 'all';
  const shopEl = document.getElementById('salesShopFilter');
  const shopVal = shopEl ? shopEl.value : '';
  const srchEl = document.getElementById('salesItemIdSearch');
  const srchVal = srchEl ? srchEl.value.trim() : '';
  const closed = isMonthClosed(vm);
  function chip(label, val, level, onclick) {
    const bg = level === 'danger' ? '#fff1f2' : level === 'caution' ? '#fff7ed' : level === 'warn' ? '#fef9c3' : level === 'info' ? '#eff6ff' : level === 'ok' ? '#f0fdf4' : '#f1f5f9';
    const color = level === 'danger' ? '#dc2626' : level === 'caution' ? '#b45309' : level === 'warn' ? '#854d0e' : level === 'info' ? '#2563eb' : level === 'ok' ? '#166534' : '#475569';
    const style = 'background:' + bg + ';color:' + color + ';border-radius:20px;padding:3px 10px;font-size:11px;font-weight:700;white-space:nowrap' + (onclick ? ';cursor:pointer' : '');
    const attrs = onclick ? ' style="' + style + '" onclick="' + onclick + '" title="クリックでフィルタ切替"' : ' style="' + style + '"';
    return '<span' + attrs + '>' + label + '&nbsp;<strong>' + val + '</strong></span>';
  }
  const dispCount = typeof window._ribreDisplayedCount === 'number' ? window._ribreDisplayedCount : null;
  const lockPct = ms.length > 0 ? Math.round(locked / ms.length * 100) : 0;
  const allOk = ms.length > 0 && unmatched === 0 && anomaly === 0;
  const readinessBadge = ms.length === 0 ? '' : allOk
    ? '<span style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">✅ 締め可能</span>'
    : '<span style="background:#fff7ed;color:#b45309;border:1px solid #fed7aa;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">⚠ 未確認あり</span>';
  const parts = [
    chip('全', allSales.length + '件', ''),
    chip('今月', ms.length + '件', ''),
    dispCount !== null && dispCount !== ms.length ? chip('表示中', dispCount + ' / ' + ms.length + '件', 'info') : '',
    readinessBadge,
    closed ? '<span style="background:#fef08a;color:#854d0e;border:1px solid #fbbf24;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">🔒 締め済み</span>' : '',
    ms.length > 0 ? chip('ロック', locked + ' / ' + ms.length + '件 (' + lockPct + '%)', lockPct === 100 ? 'ok' : '', "setQuickFilter('locked')") : '',
    chip('未一致', unmatched > 0 ? unmatched + '件' : ms.length > 0 ? 'なし ✅' : '0件', unmatched > 0 ? 'danger' : ms.length > 0 ? 'ok' : '', unmatched > 0 ? "setQuickFilter('unmatched')" : ''),
    chip('利益異常', anomaly > 0 ? anomaly + '件' : ms.length > 0 ? 'なし ✅' : '0件', anomaly > 0 ? 'caution' : ms.length > 0 ? 'ok' : '', anomaly > 0 ? "setQuickFilter('anomaly')" : ''),
    chip('送料0', noship > 0 ? noship + '件' : 'なし', noship > 0 ? 'caution' : '', noship > 0 ? "setQuickFilter('noship')" : ''),
    memoCount > 0 ? chip('メモ', memoCount + '件', '', "setQuickFilter('memo')") : '',
    chip('容量', lsMB + 'MB', lsWarn ? 'warn' : ''),
    lastLog ? '<span style="background:#f1f5f9;color:#64748b;border-radius:20px;padding:3px 10px;font-size:11px;white-space:nowrap">最終操作: ' + lastLog + '</span>' : '',
    qf !== 'all' ? chip('絞込', qf, 'info') : '',
    shopVal ? chip('販売先', shopVal, 'info') : '',
    srchVal ? chip('検索', '&quot;' + srchVal + '&quot;', 'info') : ''
  ].filter(Boolean);
  const checkItems = [];
  if (unmatched > 0) checkItems.push(['未一致', unmatched + '件', "setQuickFilter('unmatched')", 'danger']);
  if (anomaly > 0) checkItems.push(['利益異常', anomaly + '件', "setQuickFilter('anomaly')", 'caution']);
  if (noship > 0) checkItems.push(['送料0', noship + '件', "setQuickFilter('noship')", 'caution']);
  let checklistHtml = '';
  if (ms.length > 0) {
    if (closed) {
      checklistHtml = '<div style="width:100%;margin-top:4px;font-size:11px;font-weight:700;color:#854d0e">🔒 この月は締め済みです</div>';
    } else if (checkItems.length === 0) {
      checklistHtml = '<div style="width:100%;margin-top:4px;font-size:11px;font-weight:700;color:#166534">✅ 全項目確認済み — 締め作業を進められます</div>';
    } else {
      const itemLinks = checkItems.map(function(item) {
        const c = item[3] === 'danger' ? '#dc2626' : '#b45309';
        const b = item[3] === 'danger' ? '#fff1f2' : '#fff7ed';
        return '<span onclick="' + item[2] + '" style="cursor:pointer;color:' + c + ';background:' + b + ';border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap">▸ ' + item[0] + ' ' + item[1] + '</span>';
      }).join('');
      checklistHtml = '<div style="width:100%;margin-top:4px;display:flex;flex-wrap:wrap;align-items:center;gap:5px"><span style="font-size:11px;color:#475569;font-weight:700">確認必要:</span>' + itemLinks + '</div>';
    }
  }
  const hintEl = document.getElementById('closeMonthHint');
  if (hintEl) {
    if (closed) { hintEl.textContent = '締め済み'; hintEl.style.color = '#854d0e'; }
    else if (allOk && ms.length > 0) { hintEl.textContent = '✅ 締め可能'; hintEl.style.color = '#166534'; }
    else if (ms.length > 0) { hintEl.textContent = '⚠ ' + checkItems.map(function(i) { return i[0] + i[1]; }).join(' / '); hintEl.style.color = '#b45309'; }
    else { hintEl.textContent = ''; }
  }
  el.innerHTML = parts.join('') + checklistHtml;
}
function setQuickFilter(qf) {
  window._ribreQuickFilter = qf;
  document.querySelectorAll('.qf-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.qf === qf);
  });
  renderSales();
}
window.setQuickFilter = setQuickFilter;
window.isMonthClosed = isMonthClosed;
window.closeMonth = closeMonth;
window.openMonth = openMonth;
window.logOp = logOp;
window.renderOpLog = renderOpLog;
window.clearOpLog = clearOpLog;
