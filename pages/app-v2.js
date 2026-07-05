/* RIBRE 新UI Phase A — /app（並行稼働・読み取り専用）
 * 依存: core.js(get/yen/today/LS/sb/sess/email/num), supabase-rest.js(restUrl/restHeaders), auth-gate.js
 * KPI（売上/仕入/経費/粗利）のデータ源は旧UI(app-simple.js の smpProfitData/smpProfitMonthTotals)と
 * 完全に同一にしてある（appvMonthTotals参照）。旧UIはSupabaseのsales/purchasesテーブルを
 * 一切読まず、常にローカル(core.jsのsales()/purchases() = localStorage
 * ribre_full_sales221 / ribre_full_purchases221)だけを見ているため、KPIも同じくローカルのみを見る:
 *  - 売上（チャネル）/仕入/送料/手数料: localStorage ribre_full_sales221 / ribre_full_purchases221。
 *    source==='明細' の行は除外（旧UIでも smpProfitMigrateFromSales で専用ストアへ移され、
 *    こちら側の集計には出てこない）。
 *    ※Supabase `sales`/`purchases` テーブルは旧UIからの一方向アップロード先（移行/バックアップ用）
 *    であり、重複/古い行が残っている場合があるためKPIの参照元にはしない
 *    （取引一覧の表示（appvLoadMonth）は従来通りSupabase優先のまま）。
 *  - 売上明細・仕入明細（メイン画面の「明細入力」分）: Supabase `app_settings`
 *    (user_email, skey='profit_meisai') の value.sales / value.purchases。ローカルは
 *    localStorage ribre_smp_profit_meisai_v1。
 *  - 経費（送料合計＋手数料合計）: ローカルsales行の fee / ship(送料) を月で合計したもの。
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

/* ==================== 行の同定（services/data-store.js の clientIdOf/stableJson/hashStr と同一規則） ====================
 * 目的: 取引一覧の行(Supabase由来/ローカル由来どちらもありえる)から、
 * localStorage(ribre_full_sales221 / ribre_full_purchases221)側の実配列の行を
 * 一意に特定するため。id/clientがあればそれを使う。無ければ内容のハッシュ(h_...)。
 * 同一内容の行が複数ある場合はハッシュが重複し「一意に特定できない」状態になるため、
 * 編集・削除側でその場合は候補数を数えて中断する（誤削除防止）。 */
function appvStableJson(o) {
  if (o === null || typeof o !== 'object') return JSON.stringify(o);
  if (Array.isArray(o)) return '[' + o.map(appvStableJson).join(',') + ']';
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + appvStableJson(o[k])).join(',') + '}';
}
function appvHashStr(s) {
  let h = 5381, i = s.length;
  while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
  return (h >>> 0).toString(36);
}
function appvClientIdOf(x, prefix) {
  if (x && (x.id || x.client)) return String(x.client || x.id);
  return 'h_' + (prefix || '') + appvHashStr(appvStableJson(x || {}));
}

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
/* Supabase形式・ローカル形式どちらも受けて共通の内部形式へ正規化（取引一覧・最近の取引の表示用）
 * _cid: 編集・削除で行を同定するための識別子（clientIdOf相当。services/data-store.jsのclientIdOfと同じ規則）。
 * _shop/_vendor: 編集モーダルへ値を戻すための元フィールド（正規化前の値）。 */
function appvNormalizeSale(x) {
  return {
    date: x.sale_date || x.date || '',
    name: x.item_name || x.name || '',
    partner: x.account || x.shop || '',
    amount: num(x.amount != null ? x.amount : x.price),
    memo: x.memo || '',
    source: '明細',  // 上書きされる（呼び出し側で実ソースを設定）
    _cid: appvClientIdOf(x, 's'),
    _shop: x.account || x.shop || ''
  };
}
function appvNormalizePurchase(x) {
  const memo = x.memo || '';
  return {
    date: x.purchase_date || x.date || '',
    name: x.item_name || x.name || '',
    partner: x.vendor || '',
    amount: num(x.total != null ? x.total : x.cost != null ? x.cost : x.amount),
    memo: memo,
    source: '明細',
    _cid: appvClientIdOf(x, 'p'),
    _vendor: x.vendor || '',
    expense: /^\[経費\]/.test(String(memo).trim())
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
   旧UI smpProfitData/smpProfitMonthTotals と完全に同じデータ源・同じ式にする。
   旧UIはSupabaseのsales/purchasesテーブルを一切参照せず、常にローカル
   (core.jsのsales()/purchases() = localStorage `ribre_full_sales221` /
   `ribre_full_purchases221`)だけを見ている。新UIが以前Supabaseを優先して
   読んでいたため、移行用に一方向アップロードされた古い/重複行までKPIに
   混入し、売上・経費が旧UIより毎月多く出ていた。KPIはローカルのみを見るように統一する。
   売上 = チャネル別sales(明細行除く)の当月合計 + 明細(meisai)売上の当月合計
   仕入 = purchases(明細行除く)の当月合計(vendor別) + 明細(meisai)仕入の当月合計
   経費 = sales(明細行除く)の fee 当月合計 + ship(送料) 当月合計
          （当月のみ、profit_prov の __fee__/__ship__ 手入力があれば優先）
   粗利 = 売上 − 仕入 − 経費 */
function appvIsMeiRowLocal(r) { return String(r && r.source || '') === '明細'; }
function appvMonthOfLocal(r) { return r.month || String(r.date || r.sale_date || r.purchase_date || '').slice(0, 7); }
async function appvMonthTotals(month) {
  const salesAll = get(LS.sales, []);
  const purchasesAll = get(LS.purchases, []);
  const salesRows = (Array.isArray(salesAll) ? salesAll : []).filter((r) => appvMonthOfLocal(r) === month && !appvIsMeiRowLocal(r));
  const purchaseRows = (Array.isArray(purchasesAll) ? purchasesAll : []).filter((r) => appvMonthOfLocal(r) === month && !appvIsMeiRowLocal(r));

  // チャネル別売上の実数（旧UIのchanKeyと同じ: shop→type→matchStatus）。仮入力の対象月チャネルは実数0のときのみ後で埋める
  const chanReal = {};
  let shipSum = 0, feeSum = 0;
  salesRows.forEach((r) => {
    const c = String(r.shop || r.type || r.matchStatus || '').trim() || 'その他';
    const amt = num(r.amount != null ? r.amount : r.price);
    chanReal[c] = (chanReal[c] || 0) + amt;
    shipSum += num(r.ship != null ? r.ship : r.shipping);
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

/* ==================== 詳細ドロワー（表示＋編集・削除） ==================== */
let appvDrawerRow = null; // 現在ドロワーに表示中の行（appvSales/appvPurchasesの正規化済み1件）
function appvOpenDrawer(t) {
  appvDrawerRow = t;
  const body = document.getElementById('drawerBody');
  if (!body) return;
  appvClear(body);
  const sign = t.type === 'sale' ? 1 : -1;
  const rows = [
    ['種別', t.type === 'sale' ? '売上' : (t.expense ? '経費' : '仕入')],
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
  // ローカル配列上で一意に同定できない行（同一内容の重複行など）は編集・削除を無効化する
  const canEdit = appvFindLocalRowIndex(t) >= 0;
  const editBtn = document.getElementById('drawerEditBtn');
  const delBtn = document.getElementById('drawerDeleteBtn');
  if (editBtn) editBtn.disabled = !canEdit;
  if (delBtn) delBtn.disabled = !canEdit;
  const warnEl = document.getElementById('drawerEditWarn');
  if (warnEl) warnEl.style.display = canEdit ? 'none' : 'block';
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.add('show');
}
function appvCloseDrawer() {
  const overlay = document.getElementById('drawerOverlay');
  if (overlay) overlay.classList.remove('show');
}

/* =====================================================================
 * Phase B — 取引の登録・編集・削除＋テンプレート
 * 大原則: 新UIは独自の保存経路を作らない。旧UIの addSale()/addPurchase()
 * (services/app-main-v2.js) と「同じ形・同じ書き込み先」でlocalStorageへ
 * 書く。クラウド同期は services/data-store.js が window.localStorage.setItem
 * を差し替えて自動検知しているため(schedule→reconcile)、setLS()経由で
 * 書けば旧UIと全く同じ経路でSupabaseにも反映される。
 *
 * 経費の扱い: 旧UI（かんたんモード手入力タブ）には「経費」という独立した
 * 登録種別・保存先は存在しない。手入力は 売上(sale)/仕入(purchase) の
 * 2種類のみで、旧UIダッシュボードの「経費」は sales行のfee(手数料)と
 * ship(送料)を月合計しただけの“計算値”であり、個別入力の対象ではない。
 * そのため新UIの経費登録も独自ストアは作らず、既存の purchases 配列に
 * 旧UIと全く同じ形(addPurchaseと同形)で保存する。他の仕入と区別できるよう
 * メモ先頭に "[経費]" タグを付与するのみ(キー構成・保存先・同期は仕入と同一)。
 * ===================================================================== */

/* ---- クラウド同期: 旧UIと同じ即時プッシュ（window.ribreStore.pushSafe） ----
 * setLS()による書込みは data-store.js の setItemフックで自動的に
 * debounce(900ms)同期されるが、モーダル保存直後に結果をトーストへ
 * 出したいため、旧UIのsmpCloudSave()と同様に明示的にもpushSafe()を呼ぶ。 */
async function appvPushCloudSafe() {
  try {
    if (window.ribreStore && typeof window.ribreStore.pushSafe === 'function') {
      return await window.ribreStore.pushSafe();
    }
  } catch (e) {}
  return { ok: false, reason: 'unavailable' };
}

/* ---- ローカル配列上での行の同定 ----
 * appvClientIdOf(旧: services/data-store.js clientIdOf)と同じ規則で
 * 対象行のIDを求め、ribre_full_sales221 / ribre_full_purchases221 の
 * 実配列から一致するindexを探す。同一内容の行が複数あり一意に決まらない
 * 場合は -1 を返し、編集・削除側で安全に中断させる（誤操作防止）。 */
function appvFindLocalRowIndex(t) {
  if (!t) return -1;
  const isSale = t.type === 'sale';
  const arrKey = isSale ? LS.sales : LS.purchases;
  const list = get(arrKey, []);
  if (!Array.isArray(list)) return -1;
  const targetCid = t._cid || appvClientIdOf(t, isSale ? 's' : 'p');
  let foundIdx = -1, count = 0;
  for (let i = 0; i < list.length; i++) {
    const cid = appvClientIdOf(list[i], isSale ? 's' : 'p');
    if (cid === targetCid) { count++; foundIdx = i; }
  }
  return count === 1 ? foundIdx : -1;
}

/* ---- 登録モーダル ---- */
let appvModalMode = 'add'; // 'add' | 'edit'
let appvModalEditTarget = null; // 編集対象（appvOpenDrawerで開いた行）

function appvModalKindLabel(kind) { return kind === 'sale' ? '売上' : (kind === 'expense' ? '経費' : '仕入'); }

function appvOpenModal(kind, opt) {
  opt = opt || {};
  appvModalMode = opt.mode || 'add';
  appvModalEditTarget = opt.editTarget || null;
  const modal = document.getElementById('txModalOverlay');
  if (!modal) return;
  document.querySelectorAll('#txModalKind .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  appvSetModalKind(kind);
  document.getElementById('txModalTitle').textContent = (appvModalMode === 'edit' ? '編集: ' : '＋ 登録: ') + appvModalKindLabel(kind);
  const dateEl = document.getElementById('txDate');
  const nameEl = document.getElementById('txName');
  const partnerEl = document.getElementById('txPartner');
  const amountEl = document.getElementById('txAmount');
  const memoEl = document.getElementById('txMemo');
  if (opt.mode === 'edit' && opt.editTarget) {
    const t = opt.editTarget;
    dateEl.value = t.date || today();
    nameEl.value = t.name || '';
    partnerEl.value = t.partner || '';
    amountEl.value = t.amount || '';
    memoEl.value = (t.memo || '').replace(/^\[経費\]\s*/, '');
  } else {
    dateEl.value = today();
    nameEl.value = '';
    partnerEl.value = '';
    amountEl.value = '';
    memoEl.value = '';
  }
  document.getElementById('txSaveBtn').textContent = appvModalMode === 'edit' ? '更新する' : '登録する';
  appvRenderTemplateChips(kind);
  modal.classList.add('show');
}
function appvCloseModal() {
  const modal = document.getElementById('txModalOverlay');
  if (modal) modal.classList.remove('show');
}
function appvSetModalKind(kind) {
  document.querySelectorAll('#txModalKind .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  document.getElementById('txModalForm').dataset.kind = kind;
  const partnerLabel = document.getElementById('txPartnerLabel');
  if (partnerLabel) partnerLabel.textContent = kind === 'sale' ? '販売先' : (kind === 'expense' ? '支払先' : '仕入先');
  appvRenderTemplateChips(kind);
}

/* ---- 保存（新規登録）----
 * 旧UI addSale() / addPurchase() (services/app-main-v2.js) と同形・同じ
 * localStorageキーへ書く。keyの並び・値の作り方を完全に揃えている。 */
function appvValidateModal() {
  const amount = num(document.getElementById('txAmount').value || 0);
  const dateVal = document.getElementById('txDate').value;
  if (!dateVal) { alert('日付を入力してください'); return null; }
  if (!amount) { alert('金額を入力してください（数値・0円不可）'); return null; }
  return { date: dateVal, amount: amount };
}
function appvSaveModal() {
  const kind = document.getElementById('txModalForm').dataset.kind || 'sale';
  const v = appvValidateModal();
  if (!v) return;
  const name = document.getElementById('txName').value.trim();
  const partner = document.getElementById('txPartner').value.trim();
  const memoRaw = document.getElementById('txMemo').value.trim();

  if (appvModalMode === 'edit' && appvModalEditTarget) {
    appvUpdateRow(appvModalEditTarget, kind, v.date, name, partner, v.amount, memoRaw);
  } else {
    appvInsertRow(kind, v.date, name, partner, v.amount, memoRaw);
  }
}

/* 旧UI addSale() と同形（id/date/month/shop/name/amount/memo/source）で
 * sales配列の先頭へ追加する。addPurchase()も同様(vendor/total)。 */
async function appvInsertRow(kind, date, name, partner, amount, memoRaw) {
  if (kind === 'sale') {
    const row = {
      id: 's_' + Date.now(),
      date: date,
      month: date.slice(0, 7),
      shop: partner || 'その他',
      name: name,
      amount: amount,
      memo: memoRaw,
      source: 'manual'
    };
    const a = sales();
    a.unshift(row);
    setLS(LS.sales, a);
  } else {
    // 仕入・経費は同形（addPurchaseと同一）。経費のみメモ先頭に[経費]タグを付与して区別する。
    const memo = kind === 'expense' ? ('[経費] ' + memoRaw).trim() : memoRaw;
    const row = {
      id: 'p_' + Date.now(),
      date: date,
      month: date.slice(0, 7),
      vendor: partner || 'その他',
      name: name,
      total: amount,
      memo: memo,
      source: 'manual'
    };
    const a = purchases();
    a.unshift(row);
    setLS(LS.purchases, a);
  }
  appvCloseModal();
  appvToast('✅ ' + appvModalKindLabel(kind) + 'を登録しました');
  await appvAfterWrite();
  const r = await appvPushCloudSafe();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
}

/* ---- 更新（編集）----
 * 対象行をappvFindLocalRowIndexで一意特定してから、その要素だけを書き換える。
 * 配列の置換・spliceミスでの全消しを避けるため、対象indexの要素のみ更新する。 */
async function appvUpdateRow(target, kind, date, name, partner, amount, memoRaw) {
  const idx = appvFindLocalRowIndex(target);
  if (idx < 0) { alert('この行は一意に特定できないため編集できません（同一内容の行が複数存在する可能性があります）'); return; }
  const isSale = target.type === 'sale';
  const arrKey = isSale ? LS.sales : LS.purchases;
  const a = get(arrKey, []);
  if (!Array.isArray(a) || idx >= a.length) { alert('編集対象の行が見つかりませんでした'); return; }
  const row = a[idx];
  row.date = date;
  row.month = date.slice(0, 7);
  row.name = name;
  if (isSale) {
    row.shop = partner || 'その他';
    row.amount = amount;
    row.memo = memoRaw;
  } else {
    row.vendor = partner || 'その他';
    row.total = amount;
    row.memo = target.expense ? ('[経費] ' + memoRaw).trim() : memoRaw;
  }
  setLS(arrKey, a);
  appvCloseModal();
  appvCloseDrawer();
  appvToast('✅ 更新しました');
  await appvAfterWrite();
  const r = await appvPushCloudSafe();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
}

/* ---- 削除 ----
 * confirm必須。対象行をappvFindLocalRowIndexで一意特定し、その1件だけを
 * splice()で除去する（配列丸ごとの置換は行わない＝誤って全消しにならない）。
 * 削除前にcreateLocalSnapshot()でスナップショットを取る
 * （services/data-store.js seedFromThisPC/storage-sync.js の「危険操作の前に
 * スナップショット」という既存パターンに合わせる。旧UIのaddSale/addPurchase
 * 自体はスナップショットを取らないが、削除は取消不能なため個別に追加）。 */
async function appvDeleteRow(target) {
  const idx = appvFindLocalRowIndex(target);
  if (idx < 0) { alert('この行は一意に特定できないため削除できません（同一内容の行が複数存在する可能性があります）'); return; }
  const label = (target.type === 'sale' ? '売上' : (target.expense ? '経費' : '仕入')) + '「' + (target.name || '') + '」（' + yen(target.amount) + '）';
  if (!confirm(label + ' を削除します。よろしいですか？\nこの操作は取り消せません。')) return;
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv delete'); } catch (e) {}
  const isSale = target.type === 'sale';
  const arrKey = isSale ? LS.sales : LS.purchases;
  const a = get(arrKey, []);
  if (!Array.isArray(a) || idx >= a.length) { alert('削除対象の行が見つかりませんでした'); return; }
  a.splice(idx, 1);
  setLS(arrKey, a);
  appvCloseDrawer();
  appvToast('🗑 削除しました');
  await appvAfterWrite();
  const r = await appvPushCloudSafe();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
}

/* 保存・更新・削除後の再描画（KPI・最近の取引・一覧を作り直す） */
async function appvAfterWrite() {
  const month = appvViewMonth || appvCurrentMonth();
  await appvLoadMonth(month);
  await appvRenderKpi();
  appvRenderRecent();
  appvRenderLedger();
  const ledgerActive = document.querySelector('#ledgerTabs .tab.active');
  if (ledgerActive && ledgerActive.dataset.type === 'profit') await appvRenderProfit();
}

/* ==================== テンプレート（新UI専用機能。localStorageの新規キー ribre_appv2_templates_v1 のみ使用。旧UIデータには一切触れない） ==================== */
const APPV_TEMPLATES_KEY = 'ribre_appv2_templates_v1';
function appvGetTemplates() {
  try { return JSON.parse(localStorage.getItem(APPV_TEMPLATES_KEY) || '[]') || []; } catch (e) { return []; }
}
function appvSetTemplates(list) {
  try { localStorage.setItem(APPV_TEMPLATES_KEY, JSON.stringify(list.slice(0, 30))); } catch (e) {}
}
function appvSaveCurrentAsTemplate() {
  const kind = document.getElementById('txModalForm').dataset.kind || 'sale';
  const name = document.getElementById('txName').value.trim();
  const partner = document.getElementById('txPartner').value.trim();
  const amount = document.getElementById('txAmount').value;
  const memo = document.getElementById('txMemo').value.trim();
  if (!name && !partner && !amount) { alert('テンプレートにする内容がありません'); return; }
  const list = appvGetTemplates();
  list.unshift({ id: 't_' + Date.now(), kind: kind, name: name, partner: partner, amount: amount, memo: memo });
  appvSetTemplates(list);
  appvRenderTemplateChips(kind);
  appvToast('📌 テンプレートに保存しました');
}
function appvApplyTemplate(tpl) {
  document.getElementById('txName').value = tpl.name || '';
  document.getElementById('txPartner').value = tpl.partner || '';
  document.getElementById('txAmount').value = tpl.amount || '';
  document.getElementById('txMemo').value = tpl.memo || '';
}
function appvDeleteTemplate(id) {
  if (!confirm('このテンプレートを削除しますか？')) return;
  appvSetTemplates(appvGetTemplates().filter((t) => t.id !== id));
  const kind = document.getElementById('txModalForm').dataset.kind || 'sale';
  appvRenderTemplateChips(kind);
}
let appvChipPressTimer = null;
function appvRenderTemplateChips(kind) {
  const wrap = document.getElementById('txTemplateChips');
  if (!wrap) return;
  appvClear(wrap);
  const list = appvGetTemplates().filter((t) => t.kind === kind);
  if (!list.length) {
    const empty = document.createElement('span');
    empty.className = 'muted';
    empty.style.fontSize = '12px';
    empty.textContent = 'テンプレートはまだありません';
    wrap.appendChild(empty);
    return;
  }
  list.forEach((tpl) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'tpl-chip';
    chip.textContent = (tpl.name || tpl.partner || '無題') + (tpl.amount ? '（' + yen(num(tpl.amount)) + '）' : '');
    chip.title = '長押しまたは×ボタンで削除';
    chip.addEventListener('click', () => appvApplyTemplate(tpl));
    // 長押しで削除（モバイル対応）
    chip.addEventListener('pointerdown', () => {
      appvChipPressTimer = setTimeout(() => appvDeleteTemplate(tpl.id), 600);
    });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => chip.addEventListener(ev, () => { if (appvChipPressTimer) clearTimeout(appvChipPressTimer); }));
    const delBtn = document.createElement('span');
    delBtn.className = 'tpl-chip-x';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); appvDeleteTemplate(tpl.id); });
    chip.appendChild(delBtn);
    wrap.appendChild(chip);
  });
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

  /* クイックアクション／＋登録／FAB: 種別プリセット済みの登録モーダルを開く */
  document.querySelectorAll('[data-action="open-tx-modal"]').forEach((b) => {
    b.addEventListener('click', () => appvOpenModal(b.dataset.kind || 'sale', { mode: 'add' }));
  });
  document.querySelectorAll('#txModalKind .choice-btn').forEach((b) => {
    b.addEventListener('click', () => appvSetModalKind(b.dataset.kind));
  });
  const txModalOverlay = document.getElementById('txModalOverlay');
  if (txModalOverlay) txModalOverlay.addEventListener('click', (e) => { if (e.target === txModalOverlay) appvCloseModal(); });
  const txModalCloseBtn = document.getElementById('txModalCloseBtn');
  if (txModalCloseBtn) txModalCloseBtn.addEventListener('click', appvCloseModal);
  const txModalCancelBtn = document.getElementById('txModalCancelBtn');
  if (txModalCancelBtn) txModalCancelBtn.addEventListener('click', appvCloseModal);
  const txSaveBtn = document.getElementById('txSaveBtn');
  if (txSaveBtn) txSaveBtn.addEventListener('click', appvSaveModal);
  const txSaveTplBtn = document.getElementById('txSaveTplBtn');
  if (txSaveTplBtn) txSaveTplBtn.addEventListener('click', appvSaveCurrentAsTemplate);

  /* ドロワーの編集・削除 */
  const drawerEditBtn = document.getElementById('drawerEditBtn');
  if (drawerEditBtn) drawerEditBtn.addEventListener('click', () => {
    if (!appvDrawerRow) return;
    const kind = appvDrawerRow.type === 'sale' ? 'sale' : (appvDrawerRow.expense ? 'expense' : 'purchase');
    appvOpenModal(kind, { mode: 'edit', editTarget: appvDrawerRow });
  });
  const drawerDeleteBtn = document.getElementById('drawerDeleteBtn');
  if (drawerDeleteBtn) drawerDeleteBtn.addEventListener('click', () => {
    if (!appvDrawerRow) return;
    appvDeleteRow(appvDrawerRow);
  });

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
