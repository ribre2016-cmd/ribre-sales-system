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
  // OpenAI APIキーはサーバー側(環境変数)で管理するためクライアントでは常に「サーバー管理」表示
  document.getElementById('openaiStatus').textContent = 'サーバー管理';
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
/* OpenAI APIキーはサーバー側(環境変数)で管理するため、保存処理は廃止 */
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
    const memoRaw = String(x.memo || '');
    let memoDisplay = memoRaw
      .replace(/\s*\/\s*\[LOCK\]|\[LOCK\]\s*\/\s*/g, '')
      .replace('[LOCK]', '')
      .replace(/\[USERMEMO\]\s*/g, '')
      .trim();
    memoDisplay = escHtml(memoDisplay);
    const hasUserMemo = memoRaw.includes('[USERMEMO]');
    const profitTd = profit < 0
      ? '<td class="sale-loss-cell">' + yen(profit) + '</td>'
      : '<td>' + yen(profit) + '</td>';
    return '<tr class="' + cls + (anomaly ? ' ' + anomaly : '') + (isLocked ? ' sale-locked' : '') + '">' +
      '<td><input type="checkbox" class="sales-row-cb" data-id="' + origIdx + '" onchange="updateSalesSelectCount()"></td>' +
      '<td>' + (i + 1) + '</td>' +
      '<td>' + escHtml(x.date || '') + '</td>' +
      '<td>' + escHtml(x.shop || '') + '</td>' +
      '<td>' + escHtml(x.itemId || '') + '</td>' +
      '<td>' + escHtml(x.name || '') + '</td>' +
      '<td>' + yen(x.fee || 0) + '</td>' +
      '<td>' + yen(x.shipping || 0) + '</td>' +
      profitTd +
      '<td>' + yen(x.amount || 0) + '</td>' +
      '<td>' + yen(x.price || x.amount || 0) + '</td>' +
      '<td>' + (isLocked ? '🔒 ' : '') + memoDisplay +
        (hasUserMemo ? ' <button class="secondary sales-memo-edit-btn" onclick="editUserMemo(' + origIdx + ')">編集</button>' : '') +
      '</td>' +
      '</tr>';
  }).join('');
  document.getElementById('salesTable').innerHTML =
    '<div class="sales-table-wrap"><table class="sales-tbl">' +
    '<thead><tr><th><input type="checkbox" id="salesSelectAll" onchange="toggleAllSales(this)"></th>' +
    '<th>商品No</th><th>日付</th><th>販売先</th><th>商品ID</th><th>内容</th>' +
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
          escHtml(x.date) +
          '</td><td>' +
          escHtml(x.vendor) +
          '</td><td>' +
          escHtml(x.name) +
          '</td><td>' +
          yen(x.total || x.amount) +
          '</td><td>' +
          escHtml(x.memo) +
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
  if (document.body.classList.contains('simple-mode') && typeof smpScheduleAutosave === 'function') smpScheduleAutosave('add-sale');
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
  if (document.body.classList.contains('simple-mode') && typeof smpScheduleAutosave === 'function') smpScheduleAutosave('add-purchase');
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
  const text = memoText.trim().replace(/\[USERMEMO\]\s*/g, '');
  if (!text) { alert('メモを入力してください'); return; }
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
    s[idx].memo = existing ? existing + ' / [USERMEMO]' + text : '[USERMEMO]' + text;
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
function convertSelectedMemoToUserMemo() {
  const checked = document.querySelectorAll('.sales-row-cb:checked');
  if (!checked.length) { alert('行を選択してください'); return; }
  const ids = Array.from(checked).map(function(cb) { return cb.dataset.id; }).filter(Boolean);
  if (!ids.length) return;
  const s = sales();
  let changed = 0;
  let skippedLocked = 0;
  let skippedTagged = 0;
  let skippedNoTail = 0;
  ids.forEach(function(id) {
    const idx = Number(id);
    if (!Number.isFinite(idx) || idx < 0 || idx >= s.length) return;
    const memoRaw = String(s[idx].memo || '').trim();
    if (!memoRaw) { skippedNoTail++; return; }
    if (memoRaw.includes('[LOCK]')) { skippedLocked++; return; }
    if (memoRaw.includes('[USERMEMO]')) { skippedTagged++; return; }
    const lastSep = memoRaw.lastIndexOf(' / ');
    if (lastSep < 0) { skippedNoTail++; return; }
    const head = memoRaw.slice(0, lastSep).trim();
    const tail = memoRaw.slice(lastSep + 3).trim();
    if (!head || !tail) { skippedNoTail++; return; }
    s[idx].memo = head + ' / [USERMEMO]' + tail;
    changed++;
  });
  if (changed > 0) {
    setLS(LS.sales, s);
    logOp('選択行メモを編集可能化（' + changed + '件）');
    refreshAll();
  }
  if (skippedLocked || skippedTagged || skippedNoTail) {
    alert('変換: ' + changed + '件 / スキップ: ロック済み' + skippedLocked + '件・既に編集可能' + skippedTagged + '件・変換対象なし' + skippedNoTail + '件');
  }
}
function editUserMemo(origIdx) {
  const idx = Number(origIdx);
  if (!Number.isFinite(idx)) return;
  const s = sales();
  if (idx < 0 || idx >= s.length) return;
  const row = s[idx];
  const memoRaw = String(row.memo || '');
  const hasLock = memoRaw.includes('[LOCK]');
  const withoutLock = memoRaw
    .replace(/\s*\/\s*\[LOCK\]|\[LOCK\]\s*\/\s*/g, '')
    .replace('[LOCK]', '')
    .trim();
  const userMemoRegex = /(?:^|\s*\/\s*)\[USERMEMO\]\s*([^]*?)(?=(?:\s*\/\s*\[USERMEMO\])|$)/g;
  const userParts = [];
  let match;
  while ((match = userMemoRegex.exec(withoutLock)) !== null) {
    const v = String(match[1] || '').trim();
    if (v) userParts.push(v);
  }
  if (!userParts.length) { alert('編集対象の手入力メモがありません。'); return; }
  const currentUserMemo = userParts.join(' / ');
  const next = prompt('手入力メモを編集してください（空欄で手入力メモのみ削除）', currentUserMemo);
  if (next == null) return;
  const nextUserMemo = String(next).replace(/\[USERMEMO\]\s*/g, '').trim();
  const baseMemo = withoutLock
    .replace(userMemoRegex, '')
    .replace(/\s*\/\s*$/g, '')
    .replace(/^\s*\/\s*/g, '')
    .trim();
  let rebuilt = baseMemo;
  if (nextUserMemo) rebuilt = rebuilt ? rebuilt + ' / [USERMEMO]' + nextUserMemo : '[USERMEMO]' + nextUserMemo;
  if (hasLock) rebuilt = rebuilt ? rebuilt + ' / [LOCK]' : '[LOCK]';
  if (memoRaw === rebuilt) return;
  row.memo = rebuilt;
  setLS(LS.sales, s);
  renderSales();
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
window.convertSelectedMemoToUserMemo = convertSelectedMemoToUserMemo;
window.editUserMemo = editUserMemo;
function renderOpsFixedBar(vm, unmatched, anomaly, closed) {
  const el = document.getElementById('opsFixedBar');
  if (!el) return;
  const vmLabel = vm ? (vm.slice(0, 4) + '/' + vm.slice(5)) : '--';
  const unmatchedLevel = unmatched > 0 ? 'unmatched' : 'closed';
  const anomalyLevel = anomaly > 0 ? 'anomaly' : 'closed';
  const stateClass = closed ? 'closed' : 'open';
  const stateLabel = closed ? '締め済み' : '未締め';
  el.innerHTML = '<div class="ops-fixed-inner">'
    + '<span class="ops-chip month">月: ' + vmLabel + '</span>'
    + '<span class="ops-chip ' + unmatchedLevel + '">未一致: ' + unmatched + '件</span>'
    + '<span class="ops-chip ' + anomalyLevel + '">利益異常: ' + anomaly + '件</span>'
    + '<span class="ops-chip ' + stateClass + '">状態: ' + stateLabel + '</span>'
    + '</div>';
}
function renderEmergencyBanner(unmatched, anomaly, lsWarn) {
  const el = document.getElementById('emergencyBanner');
  if (!el) return;
  const issues = [];
  let level = '';
  if (unmatched > 20) {
    issues.push('未一致 ' + unmatched + '件（20件超）');
    level = 'alert';
  }
  if (anomaly > 10) {
    issues.push('利益異常 ' + anomaly + '件（10件超）');
    level = 'alert';
  }
  if (lsWarn) {
    issues.push('localStorage容量警告');
    if (!level) level = 'warn';
  }
  if (issues.length === 0) {
    el.style.display = 'none';
    el.className = 'emergency-banner';
    el.textContent = '';
    return;
  }
  el.className = 'emergency-banner ' + (level || 'warn');
  el.textContent = '⚠ 緊急確認: ' + issues.join(' / ');
  el.style.display = 'block';
}
function renderRecentOpMini() {
  const el = document.getElementById('recentOpMini');
  if (!el) return;
  try {
    const logs = JSON.parse(sessionStorage.getItem('ribre_op_log') || '[]');
    const items = logs
      .filter(function(x) { return x && x.msg; })
      .slice(0, 5)
      .map(function(x) {
        return '<div class="recent-op-mini-item">・' + x.ts + ' ' + x.msg + '</div>';
      }).join('');
    el.innerHTML = '<h3>🕘 最近の操作（ミニ履歴）</h3><div class="recent-op-mini-list">'
      + (items || '<div class="recent-op-mini-empty">このセッションの操作履歴はまだありません</div>')
      + '</div>';
  } catch(e) {
    el.innerHTML = '<h3>🕘 最近の操作（ミニ履歴）</h3><div class="recent-op-mini-list"><div class="recent-op-mini-empty">履歴の読み込みに失敗しました</div></div>';
  }
}
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
    ? '<span style="background:#dcfce7;color:#166534;border:1px solid #bbf7d0;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">✅ 確認済み・締め可能</span>'
    : '<span style="background:#fff7ed;color:#b45309;border:1px solid #fed7aa;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">⚠ 未確認あり</span>';
  const parts = [
    chip('全', allSales.length + '件', ''),
    chip('今月', ms.length + '件', ''),
    dispCount !== null && dispCount !== ms.length ? chip('表示中', dispCount + ' / ' + ms.length + '件', 'info') : '',
    readinessBadge,
    closed ? '<span style="background:#fef08a;color:#854d0e;border:1px solid #fbbf24;border-radius:20px;padding:3px 10px;font-size:11px;font-weight:900;white-space:nowrap">🔒 締め済み</span>' : '',
    ms.length > 0 ? chip('ロック', locked + ' / ' + ms.length + '件 (' + lockPct + '%)', lockPct === 100 ? 'ok' : '', "setQuickFilter('locked')") : '',
    chip('未一致', unmatched > 0 ? unmatched + '件' : ms.length > 0 ? '確認済み' : '0件', unmatched > 0 ? 'danger' : ms.length > 0 ? 'ok' : '', unmatched > 0 ? "setQuickFilter('unmatched')" : ''),
    chip('利益異常', anomaly > 0 ? anomaly + '件' : ms.length > 0 ? '確認済み' : '0件', anomaly > 0 ? 'caution' : ms.length > 0 ? 'ok' : '', anomaly > 0 ? "setQuickFilter('anomaly')" : ''),
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
      checklistHtml = '<div style="width:100%;margin-top:4px"><span class="normal-ok-hint">✅ 全項目確認済み — 締め作業を進められます</span></div>';
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
    else if (allOk && ms.length > 0) { hintEl.textContent = '✅ 確認済み'; hintEl.style.color = '#166534'; }
    else if (ms.length > 0) { hintEl.textContent = '⚠ ' + checkItems.map(function(i) { return i[0] + i[1]; }).join(' / '); hintEl.style.color = '#b45309'; }
    else { hintEl.textContent = ''; }
  }
  el.innerHTML = parts.join('') + checklistHtml;
  renderOpsFixedBar(vm, unmatched, anomaly, closed);
  renderEmergencyBanner(unmatched, anomaly, lsWarn);
  renderRecentOpMini();
  const salesEl = document.getElementById('sales');
  if (salesEl) salesEl.classList.toggle('month-is-closed', closed);
  renderTodayPanel();
}
function renderTodayPanel() {
  const targets = [document.getElementById('todayPanel'), document.getElementById('dashTodayPanel')].filter(Boolean);
  if (targets.length === 0) return;
  const vm = _vmMonth();
  const ms = sales().filter(x => (x.month || String(x.date || '').slice(0, 7)) === vm);
  if (ms.length === 0) { targets.forEach(function(t) { t.innerHTML = ''; }); return; }
  const closed = isMonthClosed(vm);
  const locked = ms.filter(x => String(x.memo || '').includes('[LOCK]')).length;
  const lockPct = Math.round(locked / ms.length * 100);
  const unmatched = ms.filter(x => {
    const ship = num(x.shipping || 0); const st = String(x.matchStatus || ''); const m = String(x.memo || '');
    return !(ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名')) && ship === 0;
  }).length;
  const anomaly = ms.filter(x => {
    const p = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
    return p < 0 || num(x.amount || 0) === 0 || p === 0;
  }).length;
  const noship = ms.filter(x => {
    const ship = num(x.shipping || 0); const st = String(x.matchStatus || ''); const m = String(x.memo || '');
    return ship === 0 && !(ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名'));
  }).length;
  let lsBytes = 0;
  try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); lsBytes += (k.length + (localStorage.getItem(k) || '').length) * 2; } } catch(e) {}
  const lsWarn = lsBytes > 4 * 1048576;
  function row(text, qf, level) {
    const color = level === 'danger' ? '#dc2626' : level === 'caution' ? '#b45309' : level === 'warn' ? '#854d0e' : level === 'ok' ? '#166534' : '#2563eb';
    const bg = level === 'danger' ? '#fff1f2' : level === 'caution' ? '#fff7ed' : level === 'warn' ? '#fef9c3' : level === 'ok' ? '#f0fdf4' : '#eff6ff';
    const attrs = qf ? ' onclick="setQuickFilter(\'' + qf + '\')" title="クリックでフィルタ切替" style="cursor:pointer;color:' + color + ';background:' + bg + ';border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap"'
                     : ' style="color:' + color + ';background:' + bg + ';border-radius:10px;padding:2px 8px;font-size:11px;font-weight:700;white-space:nowrap"';
    return '<span' + attrs + '>' + text + '</span>';
  }
  let body = '';
  if (closed) {
    body = '<span style="font-size:11px;color:#166534;font-weight:700">✅ この月は締め済みです</span>';
    if (lsWarn) body += ' ' + row('ストレージ容量注意', '', 'warn');
  } else {
    const hasIssues = unmatched > 0 || anomaly > 0 || noship > 0 || lsWarn;
    if (!hasIssues) {
      body = '<span class="normal-ok-hint">✅ 今月の確認事項はありません — 月締めできます</span>';
    } else {
      const chips = [];
      if (unmatched > 0) chips.push(row('未一致 ' + unmatched + '件 を確認', 'unmatched', 'danger'));
      if (anomaly > 0) chips.push(row('利益異常 ' + anomaly + '件 を確認', 'anomaly', 'caution'));
      if (noship > 0) chips.push(row('送料0 ' + noship + '件 を確認', 'noship', 'caution'));
      if (lsWarn) chips.push(row('ストレージ容量注意（' + (lsBytes / 1048576).toFixed(1) + 'MB）', '', 'warn'));
      chips.push(row('ロック率 ' + lockPct + '%（' + locked + ' / ' + ms.length + '件）', 'locked', lockPct === 100 ? 'ok' : 'info'));
      chips.push(row('今月: 未締め', '', 'info'));
      body = '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' + chips.join('') + '</div>';
    }
  }
  const html = '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:8px 12px;margin-bottom:2px"><span style="font-size:11px;font-weight:900;color:#475569;margin-right:8px">📋 今日やること</span>' + body + '</div>';
  targets.forEach(function(t) { t.innerHTML = html; });
  renderDashMonthCard();
}
function renderDashMonthCard() {
  const el = document.getElementById('dashMonthCard');
  if (!el) return;
  const vm = _vmMonth();
  const ms = sales().filter(function(x) { return (x.month || String(x.date || '').slice(0, 7)) === vm; });
  if (ms.length === 0) { el.innerHTML = ''; return; }
  const closed = isMonthClosed(vm);
  const locked = ms.filter(function(x) { return String(x.memo || '').includes('[LOCK]'); }).length;
  const lockPct = Math.round(locked / ms.length * 100);
  const unmatched = ms.filter(function(x) {
    const ship = num(x.shipping || 0); const st = String(x.matchStatus || ''); const m = String(x.memo || '');
    return !(ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名')) && ship === 0;
  }).length;
  const anomaly = ms.filter(function(x) {
    const p = (x.profit !== undefined && x.profit !== null) ? x.profit : (num(x.amount) - num(x.fee) - num(x.shipping));
    return p < 0 || num(x.amount || 0) === 0 || p === 0;
  }).length;
  const noship = ms.filter(function(x) {
    const ship = num(x.shipping || 0); const st = String(x.matchStatus || ''); const m = String(x.memo || '');
    return ship === 0 && !(ship > 0 || st === '手入力' || st === '匿名配送' || st === '配送CSV一致' || m.includes('匿名'));
  }).length;
  function item(label, value, sub, bg, color, qf, cls) {
    const cstyle = qf ? ';cursor:pointer' : '';
    const onclick = qf ? ' onclick="showSec(\'sales\',document.querySelectorAll(\'nav > button\')[1]);setQuickFilter(\'' + qf + '\')"' : '';
    return '<div class="dmc-item' + (cls ? ' ' + cls : '') + '" style="background:' + bg + ';color:' + color + cstyle + '"' + onclick + '>'
      + '<div class="dmc-label">' + label + '</div>'
      + '<div class="dmc-value">' + value + '</div>'
      + (sub ? '<div class="dmc-sub">' + sub + '</div>' : '')
      + '</div>';
  }
  const allOk = unmatched === 0 && anomaly === 0;
  const okBanner = (allOk && !closed)
    ? '<div class="dmc-ok-banner">✅ 今月の確認はすべてOKです — 月締めができます</div>'
    : '';
  let closingItem;
  if (closed) {
    closingItem = item('月締め', '締め済み', '', '#dcfce7', '#166534', '', '');
  } else if (allOk) {
    closingItem = item('月締め', '確認済み ✅', '', '#f0fdf4', '#166534', '', 'dmc-ready');
  } else {
    closingItem = item('月締め', '未確認あり', '', '#fff7ed', '#b45309', '', '');
  }
  const html = '<div class="panel" style="padding:14px 18px;margin-bottom:12px">'
    + '<div style="font-size:12px;font-weight:900;color:#64748b;margin-bottom:8px">📊 今月の状態 <span style="font-weight:700;color:#94a3b8">(' + vm + ')</span></div>'
    + okBanner
    + '<div class="dash-month-card">'
    + item('未一致', unmatched + '件', unmatched > 0 ? 'クリックで確認' : '確認済み ✅', unmatched > 0 ? '#fef2f2' : '#f0fdf4', unmatched > 0 ? '#dc2626' : '#166534', unmatched > 0 ? 'unmatched' : '', unmatched > 0 ? 'dmc-alert' : '')
    + item('利益異常', anomaly + '件', anomaly > 0 ? 'クリックで確認' : '確認済み', anomaly > 0 ? '#fff7ed' : '#f0fdf4', anomaly > 0 ? '#b45309' : '#166534', anomaly > 0 ? 'anomaly' : '', anomaly > 0 ? 'dmc-caution' : '')
    + item('送料0', noship + '件', noship > 0 ? 'クリックで確認' : '確認済み', noship > 0 ? '#fff7ed' : '#f1f5f9', noship > 0 ? '#b45309' : '#475569', noship > 0 ? 'noship' : '', noship > 0 ? 'dmc-caution' : '')
    + item('ロック率', lockPct + '%', locked + ' / ' + ms.length + '件', lockPct === 100 ? '#f0fdf4' : '#eff6ff', lockPct === 100 ? '#166534' : '#2563eb', 'locked', '')
    + closingItem
    + '</div></div>';
  el.innerHTML = html;
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
