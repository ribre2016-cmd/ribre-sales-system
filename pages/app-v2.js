/* RIBRE 新UI Phase A — /app（並行稼働・読み取り専用）
 * 依存: core.js(get/yen/today/LS/sb/sess/email/num), supabase-rest.js(restUrl/restHeaders), auth-gate.js
 * データ（旧UI/app-simple.js の smpProfitMonthTotals と同一のデータ源・同一の集計式に合わせている）:
 *  - 売上（チャネル）/仕入/送料/手数料: Supabase `sales`/`purchases`（フォールバックで
 *    localStorage ribre_full_sales221 / ribre_full_purchases221）。source==='明細' の行は除外
 *    （旧UIでも smpProfitMigrateFromSales で専用ストアへ移され、こちら側の集計には出てこない）。
 *  - 売上明細・仕入明細（メイン画面の「明細入力」分）: Supabase `app_settings`
 *    (user_email, skey='profit_meisai') の value.sales / value.purchases。ローカルは
 *    localStorage ribre_smp_profit_meisai_v1。
 *  - 経費（送料合計＋手数料合計）: sales行の fee / shipping_fee を月で合計したもの。
 *    当月のみ、Supabase `app_settings`(skey='profit_prov') の月ごと __ship__/__fee__ 手入力値が
 *    あればそれを優先（CSV取込前の「仮」入力を上書きしないため）。
 *  - 粗利 = 売上合計（明細＋チャネル） − 仕入合計（明細＋買取先） − 送料合計 − 手数料合計
 * 書き込み系（登録・編集・削除）は全て「Phase Bで対応予定」トースト止まり。
 */

/* signIn/signOut(supabase-auth.js)が呼ぶ共通関数の互換スタブ */
function refreshAll() {
  try { appvBoot(); } catch (e) {}
}

/* ==================== 状態 ==================== */
let appvSales = [];      // 正規化済み売上 [{date,name,amount,memo}]（取引一覧・最近の取引用）
let appvPurchases = [];  // 正規化済み仕入 [{date,name,amount,vendor,memo}]
let appvLedgerTab = 'all';
let appvViewMonth = '';  // ヘッダーの月切替で選択中の月（YYYY-MM）

/* 旧UIと同じチャネル一覧（app-simple.js の SMP_SALES_CHANNELS と同一） */
const APPV_SALES_CHANNELS = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリ', 'メルカリShops', 'ラクマ'];

/* ==================== ユーティリティ ==================== */
function appvMonthLastDay(monthStr) {
  const parts = String(monthStr).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const last = new Date(y, m, 0).getDate();
  return monthStr + '-' + String(last).padStart(2, '0');
}
function appvPrevMonth(monthStr) {
  const parts = String(monthStr).split('-');
  let y = Number(parts[0]);
  let m = Number(parts[1]) - 1;
  if (m < 1) { m = 12; y -= 1; }
  return y + '-' + String(m).padStart(2, '0');
}
function appvPctBadge(cur, prev) {
  if (!prev) return { text: '—', cls: 'gray' };
  const diff = ((cur - prev) / Math.abs(prev)) * 100;
  const sign = diff >= 0 ? '+' : '';
  const cls = diff >= 0 ? 'ok' : 'err';
  return { text: sign + diff.toFixed(1) + '%', cls: cls };
}
function appvSetText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
function appvClear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
function appvCurrentMonth() { return today().slice(0, 7); }

/* ==================== トースト ==================== */
function appvToast(msg) {
  const wrap = document.getElementById('toastWrap');
  if (!wrap) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  wrap.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }, 2400);
}
function appvPhaseBToast(label) {
  appvToast((label ? label + '：' : '') + 'Phase Bで対応予定の機能です');
}

/* ==================== ナビゲーション ==================== */
function appvGotoPage(page) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');
  document.querySelectorAll('#sideNav .nav-item').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  document.querySelectorAll('#bottomNav button[data-page]').forEach((b) => b.classList.toggle('active', b.dataset.page === page));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

/* ==================== 明細(profit_meisai)・経費仮入力(profit_prov) の取得 ====================
   旧UI(app-simple.js)と同じ app_settings テーブル(skey=profit_meisai / profit_prov)を読む。
   Supabaseに無ければ localStorage の同キーへフォールバック（旧UIと同じ優先順位）。 */
function appvCreds() {
  try {
    const c = (typeof sb === 'function') ? sb() : {};
    const s = (typeof sess === 'function') ? sess() : {};
    const tok = s.access_token || (s.session && s.session.access_token) || '';
    const em = (typeof email === 'function') ? email() : '';
    if (c.url && c.key && tok && em) return { url: c.url.replace(/\/$/, ''), key: c.key, tok: tok, em: em };
  } catch (e) {}
  return null;
}
async function appvFetchAppSetting(skey) {
  const cr = appvCreds();
  if (!cr) return null;
  try {
    const r = await fetch(
      cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.' + encodeURIComponent(skey) + '&limit=1',
      { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } }
    );
    if (!r.ok) return null;
    const data = await r.json();
    return (data && data[0] && data[0].value) || null;
  } catch (e) {
    return null;
  }
}
async function appvGetMeisai() {
  const cloud = await appvFetchAppSetting('profit_meisai');
  if (cloud && typeof cloud === 'object') {
    return { sales: Array.isArray(cloud.sales) ? cloud.sales : [], purchases: Array.isArray(cloud.purchases) ? cloud.purchases : [] };
  }
  try {
    const o = JSON.parse(localStorage.getItem('ribre_smp_profit_meisai_v1') || '{}') || {};
    return { sales: Array.isArray(o.sales) ? o.sales : [], purchases: Array.isArray(o.purchases) ? o.purchases : [] };
  } catch (e) {
    return { sales: [], purchases: [] };
  }
}
async function appvGetProv() {
  const cloud = await appvFetchAppSetting('profit_prov');
  if (cloud && typeof cloud === 'object' && cloud.data) return cloud.data;
  try {
    return JSON.parse(localStorage.getItem('ribre_smp_profit_prov_v1') || '{}') || {};
  } catch (e) {
    return {};
  }
}

/* ==================== データ取得（Supabase優先・localStorageフォールバック） ====================
   sales/purchases は「明細」(source==='明細')を除外して集計する（旧UIの smpProfitData と同じ）。 */
function appvIsMeiRow(r) { return String(r && r.source || '') === '明細'; }
function appvRowMonth(r) { return (r && (r.month || r.sale_date || r.purchase_date || r.date)) ? String(r.month || r.sale_date || r.purchase_date || r.date).slice(0, 7) : ''; }

async function appvFetchFromSupabase(month) {
  const from = month + '-01';
  const to = appvMonthLastDay(month);
  const su = restUrl('sales');
  const pu = restUrl('purchases');
  if (!su || !pu) return null;
  try {
    const headers = restHeaders();
    const sRes = await fetch(
      su + '?select=*&sale_date=gte.' + encodeURIComponent(from) + '&sale_date=lte.' + encodeURIComponent(to) + '&order=sale_date.desc&limit=5000',
      { headers }
    );
    const pRes = await fetch(
      pu + '?select=*&purchase_date=gte.' + encodeURIComponent(from) + '&purchase_date=lte.' + encodeURIComponent(to) + '&order=purchase_date.desc&limit=5000',
      { headers }
    );
    if (!sRes.ok || !pRes.ok) return null;
    const sData = await sRes.json();
    const pData = await pRes.json();
    if (!Array.isArray(sData) || !Array.isArray(pData)) return null;
    return { sales: sData, purchases: pData };
  } catch (e) {
    return null;
  }
}
function appvFetchFromLocal(month) {
  const salesAll = get(LS.sales, []);
  const purchasesAll = get(LS.purchases, []);
  const inMonth = (x) => appvRowMonth(x) === month;
  return {
    sales: (Array.isArray(salesAll) ? salesAll : []).filter(inMonth),
    purchases: (Array.isArray(purchasesAll) ? purchasesAll : []).filter(inMonth)
  };
}
/* Supabase形式・ローカル形式どちらも受けて共通の内部形式へ正規化（取引一覧・最近の取引の表示用） */
function appvNormalizeSale(x) {
  return {
    date: x.sale_date || x.date || '',
    name: x.item_name || x.name || '',
    partner: x.account || x.shop || '',
    amount: num(x.amount != null ? x.amount : x.price),
    memo: x.memo || '',
    source: '明細'  // 上書きされる（呼び出し側で実ソースを設定）
  };
}
function appvNormalizePurchase(x) {
  return {
    date: x.purchase_date || x.date || '',
    name: x.item_name || x.name || '',
    partner: x.vendor || '',
    amount: num(x.total != null ? x.total : x.cost != null ? x.cost : x.amount),
    memo: x.memo || '',
    source: '明細'
  };
}
/* 対象月のsales/purchasesを読み込み、appvSales/appvPurchasesへ格納する（表示用：明細=source行含む） */
async function appvLoadMonth(month) {
  let data = await appvFetchFromSupabase(month);
  if (!data || (!data.sales.length && !data.purchases.length)) {
    const local = appvFetchFromLocal(month);
    if (local.sales.length || local.purchases.length || !data) data = local;
  }
  appvSales = (data.sales || []).map((x) => Object.assign(appvNormalizeSale(x), { srcTag: appvSrcTag(x, 'sale') }));
  appvPurchases = (data.purchases || []).map((x) => Object.assign(appvNormalizePurchase(x), { srcTag: appvSrcTag(x, 'purchase') }));
}
/* 「源」バッジ用のラベル：明細/ヤフオク/メルカリ/ラクマ/EC(その他チャネル) */
function appvSrcTag(x, kind) {
  if (appvIsMeiRow(x)) return '明細';
  if (kind === 'purchase') return '仕入';
  const shop = String(x.account || x.shop || x.market || '').trim();
  if (shop.indexOf('ヤフオク') >= 0) return 'ヤフオク';
  if (shop.indexOf('メルカリ') >= 0) return 'メルカリ';
  if (shop.indexOf('ラクマ') >= 0) return 'ラクマ';
  if (!shop) return 'EC';
  return shop;
}

/* ==================== 月次集計（KPI）====================
   旧UI smpProfitMonthTotals と同じ式:
   売上 = チャネル別sales(明細行除く)の当月合計 + 明細(meisai)売上の当月合計
   仕入 = purchases(明細行除く)の当月合計(vendor別) + 明細(meisai)仕入の当月合計
   経費 = sales(明細行除く)の fee 当月合計 + shipping_fee 当月合計
          （当月のみ、profit_prov の __fee__/__ship__ 手入力があれば優先）
   粗利 = 売上 − 仕入 − 経費 */
async function appvMonthTotals(month) {
  const data = await (async () => {
    const sup = await appvFetchFromSupabase(month);
    if (sup && (sup.sales.length || sup.purchases.length)) return sup;
    return appvFetchFromLocal(month);
  })();
  const salesRows = (data.sales || []).filter((r) => !appvIsMeiRow(r));
  const purchaseRows = (data.purchases || []).filter((r) => !appvIsMeiRow(r));

  // チャネル別売上の実数（仮入力の対象月チャネルは実数0のときのみ後で埋める）
  const chanReal = {};
  let shipSum = 0, feeSum = 0;
  salesRows.forEach((r) => {
    const c = String(r.account || r.shop || r.market || '').trim() || 'その他';
    const amt = num(r.amount != null ? r.amount : r.price);
    chanReal[c] = (chanReal[c] || 0) + amt;
    shipSum += num(r.shipping_fee != null ? r.shipping_fee : r.shipping != null ? r.shipping : r.ship);
    feeSum += num(r.fee);
  });
  let chanSale = Object.keys(chanReal).reduce((s, c) => s + chanReal[c], 0);

  const cur = appvCurrentMonth();
  if (month === cur) {
    // 当月のみ：CSV未取込チャネルの「仮」入力(profit_prov)を、実数0のチャネルに加算
    const prov = await appvGetProv();
    const provMonth = (prov && prov[month]) || {};
    APPV_SALES_CHANNELS.forEach((c) => {
      const real = chanReal[c] || 0;
      if (real > 0) return;
      const pv = num(provMonth[c]);
      if (pv) chanSale += pv;
    });
    const provShip = provMonth.__ship__;
    if (provShip != null && provShip !== '') shipSum = num(provShip);
    const provFee = provMonth.__fee__;
    if (provFee != null && provFee !== '') feeSum = num(provFee);
  }

  // 仕入（vendor別合計。venKey優先: vendor→type、旧UIと同じ）
  const purSum = purchaseRows.reduce((s, r) => s + num(r.total != null ? r.total : r.cost != null ? r.cost : r.amount), 0);

  // 明細（profit_meisai）の当月分
  const mei = await appvGetMeisai();
  const meiOf = (e) => (e.month || String(e.date || '').slice(0, 7));
  const meiSaleSum = mei.sales.filter((e) => meiOf(e) === month).reduce((s, e) => s + num(e.amount), 0);
  const meiPurSum = mei.purchases.filter((e) => meiOf(e) === month).reduce((s, e) => s + num(e.amount), 0);

  const sale = chanSale + meiSaleSum;
  const pur = purSum + meiPurSum;
  const exp = shipSum + feeSum;
  return { sale: sale, pur: pur, exp: exp, profit: sale - pur - exp, ship: shipSum, fee: feeSum };
}

/* ==================== KPI（選択月・前月比） ==================== */
async function appvRenderKpi() {
  const month = appvViewMonth || appvCurrentMonth();
  const prevMonth = appvPrevMonth(month);

  const cur = await appvMonthTotals(month);
  const prev = await appvMonthTotals(prevMonth);

  appvSetText('kpiSales', yen(cur.sale));
  appvSetText('kpiPurchases', yen(cur.pur));
  appvSetText('kpiExpenses', yen(cur.exp));
  appvSetText('kpiProfit', (cur.profit >= 0 ? '+' : '−') + yen(Math.abs(cur.profit)));

  appvRenderKpiFoot('kpiSalesFoot', appvPctBadge(cur.sale, prev.sale));
  appvRenderKpiFoot('kpiPurchasesFoot', appvPctBadge(cur.pur, prev.pur));
  appvRenderKpiFoot('kpiExpensesFoot', appvPctBadge(cur.exp, prev.exp));
  appvRenderKpiFoot('kpiProfitFoot', appvPctBadge(cur.profit, prev.profit));

  appvSetText('kpiScopeNote', '対象: EC＋ヤフオク＋メルカリ＋明細（' + month + '）');
}
function appvRenderKpiFoot(id, badge) {
  const el = document.getElementById(id);
  if (!el) return;
  appvClear(el);
  const b = document.createElement('span');
  b.className = 'badge ' + badge.cls;
  b.textContent = badge.text;
  const label = document.createElement('span');
  label.className = 'muted';
  label.style.fontSize = '12px';
  label.textContent = '前月比';
  el.appendChild(b);
  el.appendChild(label);
}

/* ==================== やることインボックス ==================== */
async function appvFetchEvidenceCount(query) {
  const u = restUrl('mf_evidence');
  if (!u) return null;
  try {
    const res = await fetch(u + query, { headers: Object.assign({}, restHeaders(), { Prefer: 'count=exact' }) });
    if (!res.ok) return null;
    const range = res.headers.get('content-range') || '';
    const m = /\/(\d+)$/.exec(range);
    if (m) return Number(m[1]);
    const data = await res.json();
    return Array.isArray(data) ? data.length : null;
  } catch (e) {
    return null;
  }
}
async function appvRenderTodos() {
  const wrap = document.getElementById('todoList');
  if (!wrap) return;
  const pendingCount = await appvFetchEvidenceCount('?select=id&status=eq.pending');
  const boxTodoCount = await appvFetchEvidenceCount('?select=id&box_meta_done=is.false&status=in.(box_saved,attached)');

  const todos = [];
  if (pendingCount) todos.push({ icon: '📧', text: '承認待ちの証憑', count: pendingCount });
  if (boxTodoCount) todos.push({ icon: '📋', text: 'Box入力待ち', count: boxTodoCount });

  appvClear(wrap);
  if (!todos.length) {
    const done = document.createElement('div');
    done.className = 'muted';
    done.style.padding = '10px 4px';
    done.textContent = '今日のやることはありません 🎉';
    wrap.appendChild(done);
    return;
  }
  todos.forEach((t) => {
    const row = document.createElement('div');
    row.className = 'todo-row';
    const left = document.createElement('div');
    left.className = 'todo-left';
    const icon = document.createElement('span');
    icon.textContent = t.icon;
    const cb = document.createElement('span');
    cb.className = 'count-badge';
    cb.textContent = String(t.count);
    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = t.text + ' ' + t.count + '件';
    left.appendChild(icon);
    left.appendChild(cb);
    left.appendChild(txt);
    const btn = document.createElement('button');
    btn.className = 'btn sm primary';
    btn.textContent = '対応する';
    btn.addEventListener('click', () => { window.location.href = '/mf-evidence'; });
    row.appendChild(left);
    row.appendChild(btn);
    wrap.appendChild(row);
  });
}

/* ==================== 最近の取引（ホーム） ==================== */
function appvMergeRecent(sales, purchases, limit) {
  const merged = []
    .concat(sales.map((x) => Object.assign({ type: 'sale' }, x)))
    .concat(purchases.map((x) => Object.assign({ type: 'purchase' }, x)));
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return merged.slice(0, limit);
}
function appvSrcBadgeCls(tag) {
  if (tag === '明細') return 'gray';
  if (tag === 'ヤフオク') return 'info';
  if (tag === 'メルカリ') return 'warn';
  if (tag === '仕入') return 'err';
  return 'ok';
}
function appvRenderRecent() {
  const body = document.getElementById('recentTxBody');
  if (!body) return;
  appvClear(body);
  const list = appvMergeRecent(appvSales, appvPurchases, 5);
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4;
    td.className = 'muted';
    td.textContent = '対象月の取引はまだありません';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  list.forEach((t) => {
    const sign = t.type === 'sale' ? 1 : -1;
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td');
    tdDate.textContent = String(t.date || '').slice(5);
    const tdType = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'badge ' + (t.type === 'sale' ? 'ok' : 'info');
    badge.textContent = t.type === 'sale' ? '売上' : '仕入';
    tdType.appendChild(badge);
    const tdPartner = document.createElement('td');
    tdPartner.textContent = t.partner || '';
    const tdAmount = document.createElement('td');
    tdAmount.className = 'num ' + (sign > 0 ? 'amt-plus' : 'amt-minus');
    tdAmount.textContent = (sign > 0 ? '+' : '-') + yen(t.amount).replace('円', '');
    tr.appendChild(tdDate);
    tr.appendChild(tdType);
    tr.appendChild(tdPartner);
    tr.appendChild(tdAmount);
    body.appendChild(tr);
  });
}

/* ==================== 取引一覧（台帳・読み取り専用） ==================== */
function appvRenderLedger() {
  const body = document.getElementById('ledgerBody');
  if (!body) return;
  const searchEl = document.getElementById('searchFilter');
  const search = searchEl ? searchEl.value.trim() : '';
  appvClear(body);

  let list = appvMergeRecent(appvSales, appvPurchases, 100000);
  if (appvLedgerTab !== 'all') list = list.filter((t) => t.type === appvLedgerTab);
  if (search) list = list.filter((t) => (t.name || '').includes(search) || (t.partner || '').includes(search));

  let sum = 0;
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'muted';
    td.textContent = '該当する取引はありません';
    tr.appendChild(td);
    body.appendChild(tr);
  } else {
    list.forEach((t) => {
      const sign = t.type === 'sale' ? 1 : -1;
      sum += t.amount * sign;
      const tr = document.createElement('tr');
      tr.className = 'rowclick';
      const tdDate = document.createElement('td');
      tdDate.textContent = t.date || '';
      const tdType = document.createElement('td');
      const badge = document.createElement('span');
      badge.className = 'badge ' + (t.type === 'sale' ? 'ok' : 'info');
      badge.textContent = t.type === 'sale' ? '売上' : '仕入';
      tdType.appendChild(badge);
      const tdSrc = document.createElement('td');
      const srcBadge = document.createElement('span');
      srcBadge.className = 'badge ' + appvSrcBadgeCls(t.srcTag);
      srcBadge.textContent = t.srcTag || '';
      tdSrc.appendChild(srcBadge);
      const tdName = document.createElement('td');
      tdName.textContent = t.name || '';
      const tdPartner = document.createElement('td');
      tdPartner.textContent = t.partner || '';
      const tdAmount = document.createElement('td');
      tdAmount.style.textAlign = 'right';
      tdAmount.className = 'num ' + (sign > 0 ? 'amt-plus' : 'amt-minus');
      tdAmount.textContent = (sign > 0 ? '+' : '-') + yen(t.amount).replace('円', '');
      tr.appendChild(tdDate);
      tr.appendChild(tdType);
      tr.appendChild(tdSrc);
      tr.appendChild(tdName);
      tr.appendChild(tdPartner);
      tr.appendChild(tdAmount);
      tr.addEventListener('click', () => appvOpenDrawer(t));
      body.appendChild(tr);
    });
  }
  appvSetText('ledgerCount', list.length + '件');
  const sumEl = document.getElementById('ledgerSum');
  if (sumEl) {
    sumEl.textContent = (sum >= 0 ? '+' : '-') + yen(Math.abs(sum)).replace('円', '');
    sumEl.className = 'num ' + (sum >= 0 ? 'amt-plus' : 'amt-minus');
  }
}

/* ==================== 粗利タブ（月合計サマリー：旧UIと同一式） ==================== */
async function appvRenderProfit() {
  appvSetText('profitNote', '売上・仕入・経費は旧UI（かんたんモード）ホームと同じ集計（EC＋ヤフオク＋メルカリ＋明細の合算、経費＝送料合計＋手数料合計）です。');
  const body = document.getElementById('profitBody');
  if (!body) return;
  appvClear(body);
  const month = appvViewMonth || appvCurrentMonth();
  const t = await appvMonthTotals(month);
  const tr = document.createElement('tr');
  const tdMonth = document.createElement('td');
  tdMonth.textContent = month;
  const tdSales = document.createElement('td');
  tdSales.style.textAlign = 'right';
  tdSales.className = 'num';
  tdSales.textContent = yen(t.sale);
  const tdPurchases = document.createElement('td');
  tdPurchases.style.textAlign = 'right';
  tdPurchases.className = 'num';
  tdPurchases.textContent = yen(t.pur);
  const tdExp = document.createElement('td');
  tdExp.style.textAlign = 'right';
  tdExp.className = 'num';
  tdExp.textContent = yen(t.exp);
  const tdProfit = document.createElement('td');
  tdProfit.style.textAlign = 'right';
  tdProfit.className = 'num ' + (t.profit >= 0 ? 'amt-plus' : 'amt-minus');
  tdProfit.textContent = (t.profit >= 0 ? '+' : '-') + yen(Math.abs(t.profit)).replace('円', '');
  tr.appendChild(tdMonth);
  tr.appendChild(tdSales);
  tr.appendChild(tdPurchases);
  tr.appendChild(tdExp);
  tr.appendChild(tdProfit);
  body.appendChild(tr);
}

/* ==================== 詳細ドロワー（表示のみ） ==================== */
function appvOpenDrawer(t) {
  const body = document.getElementById('drawerBody');
  if (!body) return;
  appvClear(body);
  const sign = t.type === 'sale' ? 1 : -1;
  const rows = [
    ['種別', t.type === 'sale' ? '売上' : '仕入'],
    ['源', t.srcTag || ''],
    ['日付', t.date || ''],
    ['品目・内容', t.name || ''],
    ['相手先', t.partner || ''],
    ['金額', (sign > 0 ? '+' : '-') + yen(t.amount).replace('円', '')],
    ['メモ', t.memo || '（なし）']
  ];
  rows.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'dl-row';
    const kEl = document.createElement('span');
    kEl.className = 'k';
    kEl.textContent = k;
    const vEl = document.createElement('span');
    vEl.className = 'v';
    vEl.textContent = v;
    row.appendChild(kEl);
    row.appendChild(vEl);
    body.appendChild(row);
  });
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.add('show');
}
function appvCloseDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.remove('show');
}

/* ==================== ヘッダー月切替 ==================== */
async function appvOnHomeMonthChange(value) {
  if (!/^\d{4}-\d{2}$/.test(String(value || ''))) return;
  appvViewMonth = value;
  const monthFilterEl = document.getElementById('monthFilter');
  if (monthFilterEl) monthFilterEl.value = value;
  await appvLoadMonth(value);
  await appvRenderKpi();
  appvRenderRecent();
  appvRenderLedger();
  const ledgerActive = document.querySelector('#ledgerTabs .tab.active');
  if (ledgerActive && ledgerActive.dataset.type === 'profit') await appvRenderProfit();
}

/* ==================== 起動 ==================== */
async function appvBoot() {
  const now = new Date();
  const wd = ['日', '月', '火', '水', '木', '金', '土'][now.getDay()];
  appvSetText('todayDate', now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日（' + wd + '）');
  const em = (typeof email === 'function' && email()) || '';
  appvSetText('greeting', em ? 'こんにちは、' + em : 'ホーム');

  if (!appvViewMonth) appvViewMonth = appvCurrentMonth();
  const homeMonthEl = document.getElementById('homeMonthFilter');
  if (homeMonthEl && !homeMonthEl.value) homeMonthEl.value = appvViewMonth;
  const monthFilter = document.getElementById('monthFilter');
  if (monthFilter && !monthFilter.value) monthFilter.value = appvViewMonth;

  await appvLoadMonth(appvViewMonth);
  await appvRenderKpi();
  appvRenderRecent();
  appvRenderLedger();
  appvRenderTodos();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#sideNav .nav-item').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.page)));
  document.querySelectorAll('#bottomNav button[data-page]').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.page)));
  document.querySelectorAll('[data-page-link]').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.pageLink)));
  document.querySelectorAll('[data-action="phaseb-toast"]').forEach((b) => b.addEventListener('click', () => appvPhaseBToast(b.dataset.label || '')));
  document.querySelectorAll('[data-action="goto-evidence"]').forEach((b) => b.addEventListener('click', () => { window.location.href = '/mf-evidence'; }));

  document.querySelectorAll('#ledgerTabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#ledgerTabs .tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      appvLedgerTab = tab.dataset.type;
      const isProfit = appvLedgerTab === 'profit';
      const filterRow = document.getElementById('ledgerFilterRow');
      const tableCard = document.getElementById('ledgerTableCard');
      const profitCard = document.getElementById('profitCard');
      if (filterRow) filterRow.style.display = isProfit ? 'none' : 'flex';
      if (tableCard) tableCard.style.display = isProfit ? 'none' : 'block';
      if (profitCard) profitCard.style.display = isProfit ? 'block' : 'none';
      if (isProfit) appvRenderProfit(); else appvRenderLedger();
    });
  });
  const searchFilter = document.getElementById('searchFilter');
  if (searchFilter) searchFilter.addEventListener('input', appvRenderLedger);
  const monthFilterEl = document.getElementById('monthFilter');
  if (monthFilterEl) {
    monthFilterEl.addEventListener('change', async () => {
      await appvOnHomeMonthChange(monthFilterEl.value);
    });
  }
  const homeMonthEl = document.getElementById('homeMonthFilter');
  if (homeMonthEl) {
    homeMonthEl.addEventListener('change', async () => {
      await appvOnHomeMonthChange(homeMonthEl.value);
    });
  }

  const drawerOverlay = document.getElementById('drawerOverlay');
  if (drawerOverlay) drawerOverlay.addEventListener('click', (e) => { if (e.target === drawerOverlay) appvCloseDrawer(); });
  const drawerCloseBtn = document.getElementById('drawerCloseBtn');
  if (drawerCloseBtn) drawerCloseBtn.addEventListener('click', appvCloseDrawer);

  appvBoot();
});
