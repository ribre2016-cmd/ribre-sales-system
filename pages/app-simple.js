/* かんたんモード Ver61.0 — 仕入れる・売る・今月の3画面 */

const SIMPLE_FEE_RATES = {
  'ヤフオク': 0.088,
  'メルカリ': 0.10,
  'ラクマ': 0.06,
  'メルカリShops': 0.10,
  '直接': 0,
  'その他': 0
};

function simpleToggle() {
  const on = document.body.classList.toggle('simple-mode');
  try { localStorage.setItem('ribre_simple_mode', on ? '1' : ''); } catch(e) {}
  if (on) simpleInit();
}

function simpleInit() {
  const d = today();
  const sDate = document.getElementById('smpSaleDate');
  const pDate = document.getElementById('smpPurDate');
  if (sDate && !sDate.value) sDate.value = d;
  if (pDate && !pDate.value) pDate.value = d;
  simpleCalcProfit();
  simpleRenderMonth();
  simpleRenderRecentPur();
  simpleRenderRecentSale();
}

function simpleTab(tab) {
  document.querySelectorAll('.smp-tab-btn').forEach(b => b.classList.toggle('smp-tab-active', b.dataset.tab === tab));
  document.querySelectorAll('.smp-screen').forEach(s => s.classList.toggle('smp-screen-active', s.dataset.screen === tab));
  if (tab === 'month') simpleRenderMonth();
}

function simpleFeeRate(shop) {
  return SIMPLE_FEE_RATES[shop] ?? 0;
}

function simpleCalcProfit() {
  const price = num(document.getElementById('smpSalePrice')?.value || 0);
  const shop  = document.getElementById('smpSaleShop')?.value || '';
  const cost  = num(document.getElementById('smpSaleCost')?.value || 0);
  const rate  = simpleFeeRate(shop);
  const fee   = Math.round(price * rate);
  const profit = price - fee - cost;

  const feeEl = document.getElementById('smpFeePreview');
  const profEl = document.getElementById('smpProfitPreview');
  if (feeEl) feeEl.textContent = yen(fee) + '（' + Math.round(rate * 100) + '%）';
  if (profEl) {
    profEl.textContent = yen(profit);
    profEl.style.color = profit >= 0 ? '#166534' : '#dc2626';
  }
}

function simpleAddPurchase() {
  const date   = document.getElementById('smpPurDate').value || today();
  const name   = document.getElementById('smpPurName').value.trim();
  const vendor = document.getElementById('smpPurVendor').value.trim();
  const amount = num(document.getElementById('smpPurAmount').value);

  if (!name) { alert('商品名を入力してください'); return; }
  if (!amount) { alert('仕入れ値を入力してください'); return; }

  const a = purchases();
  a.unshift({
    id: 'p_' + Date.now(),
    date,
    month: date.slice(0, 7),
    vendor: vendor || 'その他',
    name,
    total: amount,
    memo: '',
    source: 'simple'
  });
  setLS(LS.purchases, a);

  document.getElementById('smpPurName').value = '';
  document.getElementById('smpPurVendor').value = '';
  document.getElementById('smpPurAmount').value = '';
  simpleFlash('smpPurFlash', '仕入れを保存しました');
  simpleRenderRecentPur();
}

function simpleAddSale() {
  const date  = document.getElementById('smpSaleDate').value || today();
  const name  = document.getElementById('smpSaleName').value.trim();
  const shop  = document.getElementById('smpSaleShop').value;
  const price = num(document.getElementById('smpSalePrice').value);
  const cost  = num(document.getElementById('smpSaleCost').value);
  const rate  = simpleFeeRate(shop);
  const fee   = Math.round(price * rate);
  const profit = price - fee - cost;

  if (!name) { alert('商品名を入力してください'); return; }
  if (!price) { alert('販売価格を入力してください'); return; }

  const a = sales();
  a.unshift({
    id: 's_' + Date.now(),
    date,
    month: date.slice(0, 7),
    shop,
    name,
    amount: price,
    fee,
    cost,
    profit,
    memo: '',
    source: 'simple'
  });
  setLS(LS.sales, a);

  document.getElementById('smpSaleName').value = '';
  document.getElementById('smpSalePrice').value = '';
  document.getElementById('smpSaleCost').value = '';
  simpleCalcProfit();
  simpleFlash('smpSaleFlash', '売上を保存しました');
  simpleRenderRecentSale();
}

function simpleFlash(id, msg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 2000);
}

function simpleRenderRecentPur() {
  const el = document.getElementById('smpRecentPur');
  if (!el) return;
  const rows = purchases().slice(0, 5);
  if (!rows.length) { el.innerHTML = '<div class="smp-empty">まだ仕入れがありません</div>'; return; }
  el.innerHTML = rows.map(r =>
    `<div class="smp-row">
      <span class="smp-row-date">${r.date}</span>
      <span class="smp-row-name">${r.name || '—'}</span>
      <span class="smp-row-amount">${yen(r.total || r.amount || 0)}</span>
    </div>`
  ).join('');
}

function simpleRenderRecentSale() {
  const el = document.getElementById('smpRecentSale');
  if (!el) return;
  const rows = sales().slice(0, 5);
  if (!rows.length) { el.innerHTML = '<div class="smp-empty">まだ売上がありません</div>'; return; }
  el.innerHTML = rows.map(r => {
    const profit = r.profit !== undefined ? r.profit : (num(r.amount) - num(r.fee));
    return `<div class="smp-row">
      <span class="smp-row-date">${r.date}</span>
      <span class="smp-row-name">${r.name || '—'}</span>
      <span class="smp-row-amount" style="color:${profit >= 0 ? '#166534' : '#dc2626'}">${yen(profit)}利益</span>
    </div>`;
  }).join('');
}

function simpleRenderMonth() {
  const sel = document.getElementById('smpMonth');
  if (!sel) return;
  const month = sel.value || today().slice(0, 7);

  const s = sales().filter(r => (r.month || r.date?.slice(0,7)) === month);
  const p = purchases().filter(r => (r.month || r.date?.slice(0,7)) === month);

  const totalSale = s.reduce((acc, r) => acc + num(r.amount), 0);
  const totalFee  = s.reduce((acc, r) => acc + num(r.fee), 0);
  const totalPur  = p.reduce((acc, r) => acc + num(r.total || r.amount), 0);
  const profit    = totalSale - totalFee - totalPur;

  document.getElementById('smpMSale').textContent   = yen(totalSale);
  document.getElementById('smpMFee').textContent    = yen(totalFee);
  document.getElementById('smpMPur').textContent    = yen(totalPur);
  document.getElementById('smpMProfit').textContent = yen(profit);
  document.getElementById('smpMProfit').style.color = profit >= 0 ? '#166534' : '#dc2626';
  document.getElementById('smpMSaleCount').textContent = s.length + '件';
  document.getElementById('smpMPurCount').textContent  = p.length + '件';

  const listEl = document.getElementById('smpMonthList');
  const allRows = [
    ...s.map(r => ({ date: r.date, type: '売', name: r.name, amount: num(r.amount), note: r.shop || '' })),
    ...p.map(r => ({ date: r.date, type: '仕', name: r.name, amount: num(r.total || r.amount), note: r.vendor || '' }))
  ].sort((a, b) => b.date > a.date ? 1 : -1);

  if (!allRows.length) {
    listEl.innerHTML = '<div class="smp-empty">この月のデータはありません</div>';
    return;
  }
  listEl.innerHTML = allRows.map(r =>
    `<div class="smp-row">
      <span class="smp-row-type smp-type-${r.type === '売' ? 'sale' : 'pur'}">${r.type}</span>
      <span class="smp-row-date">${r.date}</span>
      <span class="smp-row-name">${r.name || '—'}${r.note ? ' <small style="color:#94a3b8">'+r.note+'</small>' : ''}</span>
      <span class="smp-row-amount">${yen(r.amount)}</span>
    </div>`
  ).join('');
}

function simpleInitMonthOptions() {
  const sel = document.getElementById('smpMonth');
  if (!sel) return;
  const cur = today().slice(0, 7);
  const opts = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const m = d.toISOString().slice(0, 7);
    opts.push(`<option value="${m}"${m === cur ? ' selected' : ''}>${m}</option>`);
  }
  sel.innerHTML = opts.join('');
}

window.addEventListener('load', function() {
  simpleInitMonthOptions();
  try {
    if (localStorage.getItem('ribre_simple_mode') === '1') {
      document.body.classList.add('simple-mode');
      simpleInit();
    }
  } catch(e) {}
});
