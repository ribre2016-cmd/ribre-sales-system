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
  if (page === 'import' && typeof appvRenderMailImportStatus === 'function') appvRenderMailImportStatus();
  if (page === 'import' && typeof appvRenderShipPersistentTable === 'function') appvRenderShipPersistentTable();
  if (page === 'analysis' && typeof appvRenderProvPanel === 'function') appvRenderProvPanel();
  if (page === 'analysis' && typeof appvRenderAnalysisPage === 'function') appvRenderAnalysisPage();
  if (page === 'settings') {
    if (typeof appvRenderCloseChecklist === 'function') appvRenderCloseChecklist();
    if (typeof appvRenderSettingsPage === 'function') appvRenderSettingsPage();
  }
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
    _shop: x.account || x.shop || '',
    // 商品ID・CSV取込順（旧: app-simple.js smpSaleDetailCell('商品ID',...) 2870行目 / smpCsvOrder 3136行目 が参照する row.itemId/row.order と同一フィールドをそのまま保持する）
    itemId: x.itemId || x.id || '',
    order: x.order
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
    expense: /^\[経費\]/.test(String(memo).trim()),
    // 商品ID・CSV取込順（旧UIの仕入CSVには商品ID/order概念がないため通常は空。将来仕入CSVにorderが付く場合の互換のため保持）
    itemId: x.itemId || x.id || '',
    order: x.order
  };
}
/* profit_meisai(明細ストア)の当月分を取引一覧の内部形式へ正規化。
 * _meiKind/_meiId: 明細行の編集・削除で対象を一意特定するためのキー
 * （通常行の_cidとは別に持つ。明細ストアはローカル配列インデックスではなくid一致で同定する）。 */
function appvNormalizeMeisai(e, kind) {
  return {
    date: e.date || '',
    name: '',
    partner: e.name || '',
    amount: num(e.amount),
    memo: '',
    source: '明細',
    srcTag: '明細',
    _meiKind: kind,
    _meiId: String(e.id || ''),
    _locked: appvIsMonthLocked(e.month || String(e.date || '').slice(0, 7))
  };
}
/* 対象月のsales/purchasesを読み込み、appvSales/appvPurchasesへ格納する（表示用：明細=source行含む）
 * ＋profit_meisai（明細方式で登録した行）も統合して表示する。
 * 旧UI(app-simple.js)は取引一覧を含め常にローカル(core.jsのsales()/purchases()=localStorage
 * ribre_full_sales221/ribre_full_purchases221)だけを見る設計のため、こちらもローカルを優先する。
 * Supabaseの sales/purchases テーブルは旧UIからの一方向アップロード先（移行/バックアップ用）で
 * 重複/古い行が残っている場合があるため、ローカルが空のときだけのフォールバックに降格する
 * （KPI集計のappvMonthTotalsは元々ローカル直読みのため、これで表示とKPIのデータ源が一致する）。 */
async function appvLoadMonth(month) {
  let data = appvFetchFromLocal(month);
  if (!data.sales.length && !data.purchases.length) {
    const remote = await appvFetchFromSupabase(month);
    if (remote && (remote.sales.length || remote.purchases.length)) data = remote;
  }
  appvSales = (data.sales || []).map((x) => Object.assign(appvNormalizeSale(x), { srcTag: appvSrcTag(x, 'sale') }));
  appvPurchases = (data.purchases || []).map((x) => Object.assign(appvNormalizePurchase(x), { srcTag: appvSrcTag(x, 'purchase') }));

  const mei = await appvGetMeisai();
  const meiOf = (e) => (e.month || String(e.date || '').slice(0, 7));
  appvSales = appvSales.concat(mei.sales.filter((e) => meiOf(e) === month).map((e) => appvNormalizeMeisai(e, 'sale')));
  appvPurchases = appvPurchases.concat(mei.purchases.filter((e) => meiOf(e) === month).map((e) => appvNormalizeMeisai(e, 'purchase')));
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
/* 配送照合の不一致件数（旧: pages/app-shipping.js shipResults() と同一ストア ribre_shipping_results230 を読むだけ） */
function appvShipUnmatchCount() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_shipping_results230') || '[]') || [];
    return Array.isArray(rows) ? rows.filter((r) => r.status === '未一致').length : 0;
  } catch (e) { return 0; }
}
async function appvRenderTodos() {
  const wrap = document.getElementById('todoList');
  if (!wrap) return;
  const pendingCount = await appvFetchEvidenceCount('?select=id&status=eq.pending');
  const boxTodoCount = await appvFetchEvidenceCount('?select=id&box_meta_done=is.false&status=in.(box_saved,attached)');
  const shipUnmatched = appvShipUnmatchCount();

  const todos = [];
  if (pendingCount) todos.push({ icon: '📧', text: '承認待ちの証憑', count: pendingCount });
  if (boxTodoCount) todos.push({ icon: '📋', text: 'Box入力待ち', count: boxTodoCount });
  if (shipUnmatched) todos.push({ icon: '🚚', text: '配送照合の不一致', count: shipUnmatched, page: 'import' });

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
    btn.addEventListener('click', () => {
      if (t.page === 'import') {
        appvGotoPage('import');
        const card = document.getElementById('impShipCard');
        if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else { window.location.href = '/mf-evidence?from=app'; }
    });
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
/* チャネルの表示順キー（旧: app-simple.js SMP_ACCS 2808行目 / smpAccRank 3132-3135行目 と同一の序列。
 * SMP_ACCS = ['ヤフオク1'..'ヤフオク8','メルカリ','メルカリShops','ラクマ','その他'] の並び順そのまま）。
 * 旧UIのsmpNormAccountは全角数字→半角・空白除去も行うため、同様に正規化してから照合する。 */
const APPV_SMP_ACCS = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリ', 'メルカリShops', 'ラクマ', 'その他'];
function appvNormAccount(shop) {
  const z = '０１２３４５６７８９';
  return String(shop || '').replace(/[０-９]/g, (ch) => String(z.indexOf(ch))).replace(/\s+/g, '');
}
function appvChannelOrderKey(partner) {
  const i = APPV_SMP_ACCS.indexOf(appvNormAccount(partner));
  return i < 0 ? 999 : i;
}
/* 行のCSV取込順（旧: app-simple.js smpCsvOrder 3136-3139行目と同一。row.orderが正の数ならそれを、
 * 無ければ配列添字(fallback)を使う） */
function appvCsvOrder(row, fallback) {
  const order = Number(row && row.order);
  return Number.isFinite(order) && order > 0 ? order : fallback;
}

/* ==================== 売上CSVダウンロード／送料だけコピー(旧UIから移植) ====================
 * 旧: index.html 1199-1200行目のボタン → app-simple.js smpCopyShippingOnly(3194-3213行目) /
 *     smpDownloadSalesCsv(3229-3242行目)。対象データ・列構成・並び順・ファイル名を完全に同一にする。
 * 旧UIの一覧はアカウント絞り込み(all/個別)・年月絞り込み(all/個別)・送料未入力のみ表示チェックボックスを
 * 持つが、新UI「取引」ページにはそれらが無いため、対象は「ローカル全期間・全アカウント」固定
 * （旧UIの初期状態＝smpListAccFilter='all'・smpListMonth='all'・smpListShipOnly=false と同じ範囲）。 */
const APPV_SHIP_COPY_ACCS = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリShops'];

/* 旧: smpVisibleSalesRows(app-simple.js 3120-3129行目)相当。旧UIは一覧の絞り込み状態で
 * CSV/送料コピーしていたため、新UIでも取引ページの月フィルタを尊重する
 * （月フィルタが空のときのみ全期間）。並びは smpSortByAccount(3140-3149行目)と同一。 */
function appvLedgerSalesRows() {
  const salesAll = get(LS.sales, []);
  let arr = Array.isArray(salesAll) ? salesAll.slice() : [];
  const monthEl = document.getElementById('monthFilter');
  const m = monthEl && monthEl.value;
  if (m) arr = arr.filter((r) => (r.month || String(r.date || '').slice(0, 7)) === m);
  return arr.map((row, idx) => ({ row: row, idx: idx })).sort((a, b) => {
    const ra = appvChannelOrderKey(a.row.shop), rb = appvChannelOrderKey(b.row.shop);
    if (ra !== rb) return ra - rb;
    const oa = appvCsvOrder(a.row, a.idx + 1), ob = appvCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map((x) => x.row);
}

/* 旧: smpDownloadSalesCsv(app-simple.js 3229-3242行目)と同一の列構成・値・BOM付きCSV。
 * 旧のファイル名規則 '売上_' + (アカウント名 or '全アカウント') + '_' + (年月 or '全期間') + '.csv' のうち、
 * 新UIにはアカウント/年月の絞り込みUIが無いため、常に「全アカウント」「全期間」で出力する。
 * ボタンからは外し、Excel出力(appvExportReportExcel)に差し替え済み。関数自体は互換のため残す。 */
function appvDownloadSalesCsv() {
  const arr = appvLedgerSalesRows();
  const rows = [['日付', '月', '取込元', '商品名', '金額', '手数料', '送料', '利益', '商品ID', 'メモ']];
  arr.forEach((r) => {
    const amt = num(r.amount || r.price), fee = num(r.fee), ship = num(r.ship || r.shipping);
    const profit = (r.profit !== undefined && r.profit !== '') ? num(r.profit) : (amt - fee - ship);
    rows.push([r.date || '', r.month || String(r.date || '').slice(0, 7), r.shop || '', r.name || '', amt, fee, ship, profit, r.itemId || r.id || '', r.memo || '']);
  });
  if (rows.length <= 1) { appvToast('該当する売上データがありません'); return; }
  const monthEl = document.getElementById('monthFilter');
  const mSel = (monthEl && monthEl.value) || '全期間';
  csvDownload(rows, '売上_全アカウント_' + mSel + '.csv');
}

/* ==================== Excel出力(旧UIから移植) ====================
 * 旧: index.html 集計タブの「Excel出力」ボタン → app-simple.js smpExportReportExcel
 * (2752-2791行目)。出力の実体はxlsxではなく、HTMLテーブルをSpreadsheetML以前の単純な
 * <table>ベースのHTMLとして組み立て、MIME "application/vnd.ms-excel" + 拡張子 .xls で
 * 保存する“HTML-as-.xls”方式（BOM付きUTF-8）。Excelはこの拡張子とcharsetから
 * HTML文書と認識して開く。列構成・行順・値の計算式を全て同一ロジックで移植する。
 * 対象期間は旧UIの#smpSummaryMonth(月選択, all=全期間)に相当するものが新UIには無いため、
 * 取引ページの#monthFilter(空なら全期間)に連動させる。 */

/* 旧: SMP_REPORT_ACCS(app-simple.js 2810行目)と同一の並び順。注意: 通常の一覧表示で使う
 * SMP_ACCS/APPV_SMP_ACCS(メルカリ→メルカリShopsの順)とは異なり、Excel出力(集計タブ)だけは
 * メルカリShops→メルカリの順になっているため、専用の定数・キー関数を用意する。 */
const APPV_REPORT_ACCS = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリShops', 'メルカリ', 'ラクマ', 'その他'];
function appvReportChannelOrderKey(partner) {
  const i = APPV_REPORT_ACCS.indexOf(appvNormAccount(partner));
  return i < 0 ? 999 : i;
}
/* 旧: smpSortReportSalesRows(app-simple.js 3151-3163行目)と同一。並び順はAPPV_REPORT_ACCS基準。 */
function appvSortReportSalesRows(arr) {
  return (arr || []).map((row, idx) => ({ row: row, idx: idx })).sort((a, b) => {
    const ra = appvReportChannelOrderKey(a.row.shop), rb = appvReportChannelOrderKey(b.row.shop);
    if (ra !== rb) return ra - rb;
    const oa = appvCsvOrder(a.row, a.idx + 1), ob = appvCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map((x) => x.row);
}

/* 旧: smpSaleTax(app-simple.js 2467-2470行目)と同一。r.taxがあればそれを、無ければ金額/11の切り捨て。 */
function appvSaleTax(r) {
  if (r.tax != null && r.tax !== '') return num(r.tax);
  return Math.floor(num(r.amount || r.price || 0) / 11);
}
/* 旧: smpSaleProfit(app-simple.js 2471-2474行目)と同一。r.profitがあればそれを、無ければ金額-手数料-送料。 */
function appvSaleProfit(r) {
  if (r.profit != null && r.profit !== '') return num(r.profit);
  return num(r.amount || r.price || 0) - num(r.fee) - num(r.ship || r.shipping);
}
/* 旧: smpPurchaseTax(app-simple.js 2475-2478行目)と同一。r.taxがあればそれを、無ければ合計/11の切り捨て。 */
function appvPurchaseTax(r) {
  if (r.tax != null && r.tax !== '') return num(r.tax);
  return Math.floor(num(r.total || r.amount || 0) / 11);
}
/* 旧: smpMonthStats(app-simple.js 2655-2665行目)と同一。指定月の売上・仕入から集計値と消費税を算出する。 */
function appvMonthReportStats(month, salesAll, purchasesAll) {
  const s = (salesAll || []).filter((r) => (r.month || String(r.date || '').slice(0, 7)) === month);
  const p = (purchasesAll || []).filter((r) => (r.month || String(r.date || '').slice(0, 7)) === month);
  const sale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
  const fee = s.reduce((a, r) => a + num(r.fee), 0);
  const ship = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const pur = p.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit = sale - fee - ship - pur;
  const tax = Math.floor(sale / 11);
  return { month: month, sale: sale, fee: fee, ship: ship, pur: pur, profit: profit, tax: tax, count: s.length };
}
/* 旧: smpMonthLabel(app-simple.js 58-61行目)と同一。'2026-07' → '2026年7月'。 */
function appvMonthLabel(month) {
  const p = String(month || '').split('-');
  return p.length === 2 ? p[0] + '年' + Number(p[1]) + '月' : '今月';
}
/* ==================== xlsx生成エンジン（外部ライブラリ不使用） ====================
 * 本物の.xlsx（ZIP+OOXML）をスクラッチ生成する。旧: HTMLテーブルを.xls拡張子で保存する
 * 方式(smpExportReportExcel互換)だとExcelで「ファイルの形式と拡張子が一致しません」警告が
 * 出るため、これを解消する。方式: ZIPはSTORED(無圧縮)、ファイル名はUTF-8フラグ(bit11)。
 * rows(2次元配列: セルはstring|number)を渡すとUint8Array(.xlsxバイト列)を返す純関数。 */

/* CRC32(テーブル方式)。ZIPの各エントリに必要。 */
const APPV_XLSX_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function appvXlsxCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = APPV_XLSX_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function appvXlsxUtf8Bytes(str) {
  return new TextEncoder().encode(str);
}
/* DOS日時は固定値（xlsxの実行時刻はレポート内容と無関係なため固定でよい）。 */
const APPV_XLSX_DOS_TIME = 0;
const APPV_XLSX_DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/* ZIPライター（STORED / UTF-8ファイル名フラグ bit11）。ローカルヘッダ+セントラルディレクトリ+EOCD。 */
function appvXlsxMakeZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = appvXlsxUtf8Bytes(f.name);
    const data = f.data;
    const crc = appvXlsxCrc32(data);
    const size = data.length;

    const lfh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, APPV_XLSX_DOS_TIME, true);
    lv.setUint16(12, APPV_XLSX_DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    lfh.set(nameBytes, 30);
    localParts.push(lfh, data);

    const localHeaderOffset = offset;
    offset += lfh.length + data.length;

    const cdh = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, APPV_XLSX_DOS_TIME, true);
    cv.setUint16(14, APPV_XLSX_DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, localHeaderOffset, true);
    cdh.set(nameBytes, 46);
    centralParts.push(cdh);
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const p of centralParts) centralSize += p.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralStart, true);
  ev.setUint16(20, 0, true);

  const totalLen = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalLen);
  let p = 0;
  for (const part of localParts) { out.set(part, p); p += part.length; }
  for (const part of centralParts) { out.set(part, p); p += part.length; }
  out.set(eocd, p);
  return out;
}

function appvXlsxEscape(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[m]));
}
function appvXlsxColLetter(idx) {
  let n = idx + 1, s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
/* rows(2次元配列) -> xl/worksheets/sheet1.xml。文字列はinlineStr、数値は数値セル。空行は<row/>のみ。 */
function appvXlsxBuildSheetXml(rows) {
  const rowXmls = rows.map((row, rIdx) => {
    if (!row || row.length === 0) return '<row r="' + (rIdx + 1) + '"/>';
    const cells = row.map((cell, cIdx) => {
      const ref = appvXlsxColLetter(cIdx) + (rIdx + 1);
      if (cell == null || cell === '') return '';
      if (typeof cell === 'number' && isFinite(cell)) {
        return '<c r="' + ref + '"><v>' + cell + '</v></c>';
      }
      return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + appvXlsxEscape(cell) + '</t></is></c>';
    }).join('');
    return '<row r="' + (rIdx + 1) + '">' + cells + '</row>';
  }).join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' + rowXmls + '</sheetData>' +
    '</worksheet>';
}
const APPV_XLSX_CONTENT_TYPES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '</Types>';
const APPV_XLSX_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';
const APPV_XLSX_WORKBOOK_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  '<sheets><sheet name="レポート" sheetId="1" r:id="rId1"/></sheets>' +
  '</workbook>';
const APPV_XLSX_WORKBOOK_RELS_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '</Relationships>';
/* rows(2次元配列) -> Uint8Array(.xlsxバイト列)。ブラウザ非依存の純関数（Node動作検証済み）。 */
function appvBuildXlsx(rows) {
  const sheetXml = appvXlsxBuildSheetXml(rows);
  const files = [
    { name: '[Content_Types].xml', data: appvXlsxUtf8Bytes(APPV_XLSX_CONTENT_TYPES_XML) },
    { name: '_rels/.rels', data: appvXlsxUtf8Bytes(APPV_XLSX_RELS_XML) },
    { name: 'xl/workbook.xml', data: appvXlsxUtf8Bytes(APPV_XLSX_WORKBOOK_XML) },
    { name: 'xl/_rels/workbook.xml.rels', data: appvXlsxUtf8Bytes(APPV_XLSX_WORKBOOK_RELS_XML) },
    { name: 'xl/worksheets/sheet1.xml', data: appvXlsxUtf8Bytes(sheetXml) }
  ];
  return appvXlsxMakeZip(files);
}

/* 旧: smpExportReportExcel(app-simple.js 2752-2791行目)相当の集計ロジックはそのまま踏襲しつつ、
 * 出力自体は上記xlsx生成エンジンで本物の.xlsxファイルとして書き出す（HTML-as-.xls方式は廃止）。
 * 対象期間のみ、旧の#smpSummaryMonth(月選択select)の代わりに新UIの#monthFilter(空なら全期間)を使う。 */
function appvExportReportExcel() {
  const monthEl = document.getElementById('monthFilter');
  const month = (monthEl && monthEl.value) || 'all';
  const all = month === 'all';
  const salesAll = get(LS.sales, []);
  const purchasesAll = get(LS.purchases, []);
  const inMonth = (r) => all || (r.month || String(r.date || '').slice(0, 7)) === month;
  const sRows = appvSortReportSalesRows((Array.isArray(salesAll) ? salesAll : []).filter(inMonth));
  const pRows = (Array.isArray(purchasesAll) ? purchasesAll : []).filter(inMonth);
  const st = all ? null : appvMonthReportStats(month, salesAll, purchasesAll);
  const totalSale = sRows.reduce((a, r) => a + num(r.amount || r.price), 0);
  const totalFee = sRows.reduce((a, r) => a + num(r.fee), 0);
  const totalShip = sRows.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const totalPur = pRows.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit = totalSale - totalFee - totalShip - totalPur;
  const tax = st ? st.tax : Math.floor(totalSale / 11);
  const summary = [
    ['対象月', all ? '全期間' : appvMonthLabel(month)],
    ['売上', totalSale],
    ['税抜売上', totalSale - tax],
    ['消費税', tax],
    ['仕入', totalPur],
    ['手数料', totalFee],
    ['送料', totalShip],
    ['利益', profit],
    ['商品数', sRows.length],
    ['平均単価', sRows.length ? Math.round(totalSale / sRows.length) : 0]
  ];
  const salesRows = [['No', '日付', '販売先', '商品ID', '内容', '種別', '手数料', '送料', '消費税', '利益', '金額']]
    .concat(sRows.map((r, i) => [i + 1, r.date || '', r.shop || '', r.itemId || r.id || '', r.name || '', r.type || '', num(r.fee), num(r.ship || r.shipping), appvSaleTax(r), appvSaleProfit(r), num(r.amount || r.price)]));
  const purRows = [['No', '日付', '仕入れ先', '金額', '消費税', '手数料', '種別', 'メモ']]
    .concat(pRows.map((r, i) => [i + 1, r.date || '', r.vendor || '', num(r.total || r.amount), appvPurchaseTax(r), num(r.fee), r.type || '', r.memo || '']));
  // シート内容: サマリ表 → 空行 → 「売上明細」見出し+ヘッダ+行 → 空行 → 「仕入明細」…（旧HTML版と同一の並び）
  const sheetRows = []
    .concat(summary)
    .concat([[]])
    .concat([['売上明細']])
    .concat(salesRows)
    .concat([[]])
    .concat([['仕入明細']])
    .concat(purRows);
  const xlsxBytes = appvBuildXlsx(sheetRows);
  const blob = new Blob([xlsxBytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'RIBRE_売上仕入レポート_' + (all ? '全期間' : month) + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* 旧: smpCopyShippingOnly(app-simple.js 3194-3213行目)と同一。全件表示相当(acc='all')なので
 * SMP_SHIP_COPY_ACCS(ヤフオク1〜8・メルカリShops)に絞り込み、smpSortShippingCopyRows
 * (3165-3177行目)と同じ規則で並べ替え、送料の数値だけを改行区切りでコピーする。 */
function appvSortShippingCopyRows(arr) {
  return arr.map((row, idx) => ({ row: row, idx: idx })).sort((a, b) => {
    const ra = APPV_SHIP_COPY_ACCS.indexOf(appvNormAccount(a.row.shop)), rb = APPV_SHIP_COPY_ACCS.indexOf(appvNormAccount(b.row.shop));
    const aa = ra < 0 ? 999 : ra, bb = rb < 0 ? 999 : rb;
    if (aa !== bb) return aa - bb;
    const oa = appvCsvOrder(a.row, a.idx + 1), ob = appvCsvOrder(b.row, b.idx + 1);
    if (oa !== ob) return oa - ob;
    return a.idx - b.idx;
  }).map((x) => x.row);
}
async function appvWriteClipboardText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch (e) {}
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
async function appvCopyShippingOnly() {
  let arr = appvLedgerSalesRows().filter((r) => APPV_SHIP_COPY_ACCS.indexOf(appvNormAccount(r.shop)) >= 0);
  arr = appvSortShippingCopyRows(arr);
  const lines = arr.map((r) => String(num(r.ship || r.shipping || 0)));
  if (!lines.length) { appvToast('コピーできる送料がありません'); return; }
  const text = lines.join('\n');
  const ok = await appvWriteClipboardText(text);
  appvToast(ok ? '送料だけコピーしました（' + lines.length + '件 / ヤフオク1〜8・メルカリShops順）' : 'コピーできませんでした。ブラウザの権限を確認してください');
}

/* 「取引」タブが売上を含む(すべて/売上)ときだけ、CSV/送料コピーのボタンを表示（旧UI一覧の文脈に合わせる） */
function appvUpdateLedgerSalesToolsVisibility() {
  const show = appvLedgerTab === 'all' || appvLedgerTab === 'sale';
  const csvBtn = document.getElementById('ledgerCsvBtn');
  const shipBtn = document.getElementById('ledgerShipCopyBtn');
  if (csvBtn) csvBtn.style.display = show ? 'inline-block' : 'none';
  if (shipBtn) shipBtn.style.display = show ? 'inline-block' : 'none';
}

function appvRenderLedger() {
  const body = document.getElementById('ledgerBody');
  if (!body) return;
  const searchEl = document.getElementById('searchFilter');
  const search = searchEl ? searchEl.value.trim() : '';
  appvClear(body);

  // 並び順: 旧UI smpSortByAccount(app-simple.js 3140-3149行目)と同一規則。
  // チャネル順（appvChannelOrderKey）→ order（CSV取込順。無ければ添字+1）→ 添字。
  let list = []
    .concat(appvSales.map((x, i) => Object.assign({ type: 'sale', _oi: i }, x)))
    .concat(appvPurchases.map((x, i) => Object.assign({ type: 'purchase', _oi: 100000 + i }, x)));
  list.sort((a, b) => {
    const ka = appvChannelOrderKey(a.partner), kb = appvChannelOrderKey(b.partner);
    if (ka !== kb) return ka - kb;
    const oa = appvCsvOrder(a, a._oi + 1), ob = appvCsvOrder(b, b._oi + 1);
    if (oa !== ob) return oa - ob;
    return a._oi - b._oi;
  });
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

/* ==================== 粗利タブ（年間グリッド：旧UI app-simple.js simpleRenderProfitTable/smpProfitData と同一式） ====================
 * 旧: smpProfitData 2006-2035行目 / simpleRenderProfitTable 2036-2173行目 を新UI(取引→粗利タブ)へ移植。
 * データ源はappvMonthTotalsと同じくローカル(LS.sales/LS.purchases、明細=source"明細"は除外)＋
 * profit_meisai(明細ストア)＋profit_prov(当月の仮入力)。行の単位は「仕入=買取先(vendor)ごと」
 * 「売上明細=1件ごとに個別行」「売上チャネル=ヤフオク1〜8・メルカリ・メルカリShops・ラクマ固定＋その他」。
 * 年計列＝当該年度(3月〜翌2月)12ヶ月分の単純合計（旧UIのdataRow/salesRowのtと同一）。 */
let appvProfitStartYear = null;
function appvProfitDefaultStartYear() {
  const cur = appvCurrentMonth();
  const y = parseInt(cur.slice(0, 4), 10), m = parseInt(cur.slice(5, 7), 10);
  return m >= 3 ? y : y - 1;
}
/* 旧: smpProfitData(app-simple.js 2006-2035行目)と同一の集計。月ごとのチャネル別売上実数(chanReal)・
 * チャネル別手数料(chanFee)・買取先別仕入実数(venReal)・送料/手数料の月合計・明細(meisai)一覧を返す。 */
async function appvProfitYearData(startYear) {
  const months = appvFiscalMonths(startYear);
  const keyset = {}; months.forEach((m) => { keyset[m.key] = 1; });
  const salesAll = get(LS.sales, []);
  const purchasesAll = get(LS.purchases, []);
  const chanReal = {}, chanFee = {}, venReal = {}, shipByM = {}, feeByM = {};
  months.forEach((m) => { shipByM[m.key] = 0; feeByM[m.key] = 0; });
  (Array.isArray(salesAll) ? salesAll : []).forEach((r) => {
    if (appvIsMeiRowLocal(r)) return;
    const mk = appvMonthOfLocal(r); if (!keyset[mk]) return;
    shipByM[mk] += num(r.ship != null ? r.ship : r.shipping);
    feeByM[mk] += num(r.fee);
    const c = String(r.shop || r.type || r.matchStatus || '').trim() || 'その他';
    chanReal[c] = chanReal[c] || {}; chanReal[c][mk] = (chanReal[c][mk] || 0) + num(r.amount != null ? r.amount : r.price);
    chanFee[c] = chanFee[c] || {}; chanFee[c][mk] = (chanFee[c][mk] || 0) + num(r.fee);
  });
  (Array.isArray(purchasesAll) ? purchasesAll : []).forEach((r) => {
    if (appvIsMeiRowLocal(r)) return;
    const mk = appvMonthOfLocal(r); if (!keyset[mk]) return;
    const v = String(r.vendor || r.type || '').trim() || 'その他';
    /* 旧: smpProfitData（app-simple.js 2027行目）と同一に修正（B3）。costへの余計なフォールバックを除去。 */
    venReal[v] = venReal[v] || {}; venReal[v][mk] = (venReal[v][mk] || 0) + num(r.total != null ? r.total : r.amount);
  });
  const mei = await appvGetMeisai();
  const meiOf = (e) => (e.month || String(e.date || '').slice(0, 7));
  const meiSales = mei.sales.filter((e) => keyset[meiOf(e)]).map((e) => ({ id: e.id, date: e.date, name: e.name, amount: num(e.amount), mk: meiOf(e) }));
  const meiPur = mei.purchases.filter((e) => keyset[meiOf(e)]).map((e) => ({ id: e.id, date: e.date, name: e.name, amount: num(e.amount), mk: meiOf(e) }));
  meiSales.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  meiPur.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { months, chanReal, chanFee, venReal, shipByM, feeByM, meiSales, meiPur };
}
function appvProfitFmt(n) { return (Math.round(n) || 0).toLocaleString(); }
/* <td>を組み立てる共通ヘルパー。全てtextContentで設定する（instructions準拠）。 */
function appvProfitTd(text, opts) {
  opts = opts || {};
  const td = document.createElement('td');
  if (opts.className) td.className = opts.className;
  if (opts.cur) td.classList.add('pg-cur');
  td.textContent = text;
  return td;
}
async function appvRenderProfit() {
  appvSetText('profitNote', '売上・仕入・経費は旧UI（かんたんモード）「粗利」タブと同じ集計（EC＋ヤフオク＋メルカリ＋明細の合算）です。黄色＝当月。チャネル・送料・手数料の当月空欄は仮の数字を入力できます。');
  const head = document.getElementById('profitGridHead');
  const body = document.getElementById('profitGridBody');
  if (!head || !body) return;

  if (appvProfitStartYear == null) appvProfitStartYear = appvProfitDefaultStartYear();
  const sel = document.getElementById('profitYearSel');
  if (sel) {
    const years = [];
    for (let y = appvProfitDefaultStartYear() + 1; y >= appvProfitDefaultStartYear() - 6; y--) years.push(y);
    if (years.indexOf(appvProfitStartYear) < 0) years.push(appvProfitStartYear);
    years.sort((a, b) => b - a);
    appvClear(sel);
    years.forEach((y) => {
      const opt = document.createElement('option');
      opt.value = String(y);
      opt.textContent = y + '年度（' + y + '/3〜' + (y + 1) + '/2）';
      if (y === appvProfitStartYear) opt.selected = true;
      sel.appendChild(opt);
    });
  }

  const startYear = appvProfitStartYear;
  const d = await appvProfitYearData(startYear);
  const prov = appvProvGet();
  const curMonth = appvCurrentMonth();
  const provShip = prov[curMonth] && prov[curMonth]['__ship__'];
  if (provShip != null && provShip !== '' && d.shipByM[curMonth] != null) d.shipByM[curMonth] = num(provShip);
  const provFee = prov[curMonth] && prov[curMonth]['__fee__'];
  if (provFee != null && provFee !== '' && d.feeByM[curMonth] != null) d.feeByM[curMonth] = num(provFee);
  const months = d.months;

  // 売上チャネル：固定順(APPV_SMP_ACCS相当。旧UIはSMP_SALES_CHANNELSでその他を含まない)＋データにある他チャネルを金額降順で追加
  const totC = (c) => months.reduce((s, m) => s + ((d.chanReal[c] && d.chanReal[c][m.key]) || 0), 0);
  const others = Object.keys(d.chanReal).filter((c) => APPV_SALES_CHANNELS.indexOf(c) < 0).sort((a, b) => totC(b) - totC(a));
  const chans = APPV_SALES_CHANNELS.concat(others);
  const saleEff = (c, mk) => {
    const real = (d.chanReal[c] && d.chanReal[c][mk]) || 0;
    if (real > 0) return real;
    if (mk === curMonth) return (prov[mk] && prov[mk][c]) || 0;
    return 0;
  };
  const chanSaleByM = (mk) => chans.reduce((s, c) => s + saleEff(c, mk), 0);
  const meiSaleByM = (mk) => d.meiSales.reduce((s, e) => s + (e.mk === mk ? e.amount : 0), 0);
  const saleByM = (mk) => chanSaleByM(mk) + meiSaleByM(mk);
  // 仕入：買取先(vendor)別
  const totV = (v) => months.reduce((s, m) => s + ((d.venReal[v] && d.venReal[v][m.key]) || 0), 0);
  const vendors = Object.keys(d.venReal).sort((a, b) => totV(b) - totV(a));
  const venPurByM = (mk) => vendors.reduce((s, v) => s + ((d.venReal[v] && d.venReal[v][mk]) || 0), 0);
  const meiPurByM = (mk) => d.meiPur.reduce((s, e) => s + (e.mk === mk ? e.amount : 0), 0);
  const purByM = (mk) => venPurByM(mk) + meiPurByM(mk);

  // ---- ヘッダー行 ----
  appvClear(head);
  const thLabel = document.createElement('th');
  thLabel.className = 'pg-label';
  thLabel.textContent = '区分';
  head.appendChild(thLabel);
  months.forEach((m) => {
    const th = document.createElement('th');
    th.className = 'pg-num' + (m.key === curMonth ? ' pg-cur' : '');
    th.textContent = m.label;
    head.appendChild(th);
  });
  const thYear = document.createElement('th');
  thYear.className = 'pg-num';
  thYear.textContent = '年計';
  head.appendChild(thYear);

  appvClear(body);
  const ncols = months.length + 2;

  function sectionRow(label) {
    const tr = document.createElement('tr');
    tr.className = 'pg-section';
    const td = document.createElement('td');
    td.colSpan = ncols;
    td.textContent = label;
    tr.appendChild(td);
    body.appendChild(tr);
  }
  function dataRow(name, getter, isTotal) {
    const tr = document.createElement('tr');
    if (isTotal) tr.className = 'pg-total';
    const tdName = document.createElement('td');
    tdName.className = 'pg-label';
    tdName.textContent = name;
    tr.appendChild(tdName);
    let total = 0;
    months.forEach((m) => {
      const v = getter(m.key); total += v;
      tr.appendChild(appvProfitTd(appvProfitFmt(v), { className: 'pg-num', cur: m.key === curMonth }));
    });
    tr.appendChild(appvProfitTd(appvProfitFmt(total), { className: 'pg-num pg-year' }));
    body.appendChild(tr);
    return total;
  }
  // 仮入力セル（チャネル・送料・手数料）：クリックでinputに切り替え、blurでappvProvSetOne経由で保存
  function editableCell(mk, chanKey, displayVal, placeholder) {
    const td = document.createElement('td');
    td.className = 'pg-num pg-cur pg-editable';
    const span = document.createElement('span');
    if (displayVal) {
      span.textContent = appvProfitFmt(displayVal);
    } else {
      span.className = 'pg-placeholder';
      span.textContent = placeholder;
    }
    td.appendChild(span);
    td.addEventListener('click', () => {
      if (td.querySelector('input')) return;
      appvClear(td);
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      const cur = appvProvGet();
      const v = (cur[mk] && cur[mk][chanKey]);
      input.value = (v != null ? v : '');
      td.appendChild(input);
      input.focus();
      try { input.select(); } catch (e) {}
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') input.blur(); });
      input.addEventListener('blur', async () => {
        const o = appvProvGet();
        appvProvSetOne(o, mk, chanKey, input.value);
        try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(o)); } catch (e) {}
        appvProvTsSet(Date.now());
        try { await appvProvPushCloud(); } catch (e) {}
        await appvRenderProfit();
        await appvRenderKpi();
      });
    });
    return td;
  }
  function salesRow(c) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.className = 'pg-label';
    tdName.textContent = c;
    tr.appendChild(tdName);
    let total = 0;
    months.forEach((m) => {
      const mk = m.key;
      const eff = saleEff(c, mk); total += eff;
      const real = (d.chanReal[c] && d.chanReal[c][mk]) || 0;
      if (mk === curMonth && !(real > 0)) {
        const pv = (prov[mk] && prov[mk][c]) || 0;
        tr.appendChild(editableCell(mk, c, pv, '仮'));
        return;
      }
      tr.appendChild(appvProfitTd(appvProfitFmt(eff), { className: 'pg-num', cur: mk === curMonth }));
    });
    tr.appendChild(appvProfitTd(appvProfitFmt(total), { className: 'pg-num pg-year' }));
    body.appendChild(tr);
    return total;
  }
  // 明細グリッド：月ごとのN件目を同じ行に並べる（旧: meiGridRows 2104-2127行目と同一方式）
  function meiGridRows(entries) {
    const byM = {};
    entries.forEach((e) => { (byM[e.mk] = byM[e.mk] || []).push(e); });
    let maxN = 0;
    months.forEach((m) => { const n = (byM[m.key] || []).length; if (n > maxN) maxN = n; });
    for (let i = 0; i < maxN; i++) {
      const tr = document.createElement('tr');
      const tdMark = document.createElement('td');
      tdMark.className = 'pg-label';
      tdMark.style.textAlign = 'center';
      tdMark.textContent = '・';
      tr.appendChild(tdMark);
      let rowSum = 0;
      months.forEach((m) => {
        const e = (byM[m.key] || [])[i];
        const td = document.createElement('td');
        td.className = 'pg-num' + (m.key === curMonth ? ' pg-cur' : '');
        if (e) {
          rowSum += num(e.amount);
          const dp = String(e.date || '').split('-');
          const md = dp.length === 3 ? (Number(dp[1]) + '/' + Number(dp[2])) : (e.date || '');
          td.title = (e.name || '') + (md ? ' ' + md : '');
          td.textContent = appvProfitFmt(e.amount);
        }
        tr.appendChild(td);
      });
      tr.appendChild(appvProfitTd(rowSum ? appvProfitFmt(rowSum) : '', { className: 'pg-num pg-year' }));
      body.appendChild(tr);
    }
  }
  function emptyNote(text) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = ncols;
    td.className = 'muted';
    td.textContent = text;
    tr.appendChild(td);
    body.appendChild(tr);
  }

  // 仕入（明細）
  sectionRow('仕入（明細）');
  meiGridRows(d.meiPur);
  vendors.forEach((v) => dataRow(v, (mk) => (d.venReal[v] && d.venReal[v][mk]) || 0));
  if (!d.meiPur.length && !vendors.length) emptyNote('仕入データがありません');
  dataRow('仕入 合計', purByM, true);
  // 売上明細（追加分）
  sectionRow('売上明細（追加分）');
  meiGridRows(d.meiSales);
  if (!d.meiSales.length) emptyNote('明細はまだありません');
  dataRow('売上明細 合計', meiSaleByM, true);
  // 売上（チャネル別）
  sectionRow('売上（チャネル別）');
  chans.forEach((c) => salesRow(c));
  dataRow('チャネル 合計', chanSaleByM, true);
  dataRow('売上 合計（明細＋チャネル）', saleByM, true);
  // 送料 合計（当月は仮入力可）
  (function () {
    const tr = document.createElement('tr');
    tr.className = 'pg-total';
    const tdName = document.createElement('td');
    tdName.className = 'pg-label';
    tdName.textContent = '送料 合計';
    tr.appendChild(tdName);
    let total = 0;
    months.forEach((m) => {
      const mk = m.key; const v = d.shipByM[mk] || 0; total += v;
      if (mk === curMonth) { tr.appendChild(editableCell(mk, '__ship__', v, '送料')); return; }
      tr.appendChild(appvProfitTd(appvProfitFmt(v), { className: 'pg-num' }));
    });
    tr.appendChild(appvProfitTd(appvProfitFmt(total), { className: 'pg-num pg-year' }));
    body.appendChild(tr);
  })();
  // 手数料 合計（当月は仮入力可）
  (function () {
    const tr = document.createElement('tr');
    tr.className = 'pg-total';
    const tdName = document.createElement('td');
    tdName.className = 'pg-label';
    tdName.textContent = '手数料 合計';
    tr.appendChild(tdName);
    let total = 0;
    months.forEach((m) => {
      const mk = m.key; const v = d.feeByM[mk] || 0; total += v;
      if (mk === curMonth) { tr.appendChild(editableCell(mk, '__fee__', v, '手数料')); return; }
      tr.appendChild(appvProfitTd(appvProfitFmt(v), { className: 'pg-num' }));
    });
    tr.appendChild(appvProfitTd(appvProfitFmt(total), { className: 'pg-num pg-year' }));
    body.appendChild(tr);
  })();
  // 粗利（マイナスは赤）
  (function () {
    const tr = document.createElement('tr');
    tr.className = 'pg-total';
    const tdName = document.createElement('td');
    tdName.className = 'pg-label';
    tdName.textContent = '粗利（売上−仕入−送料−手数料）';
    tr.appendChild(tdName);
    let gTotal = 0;
    months.forEach((m) => {
      const mk = m.key;
      const v = saleByM(mk) - purByM(mk) - (d.shipByM[mk] || 0) - (d.feeByM[mk] || 0);
      gTotal += v;
      tr.appendChild(appvProfitTd(appvProfitFmt(v), { className: 'pg-num pg-profit ' + (v >= 0 ? 'pos' : 'neg') }));
    });
    tr.appendChild(appvProfitTd(appvProfitFmt(gTotal), { className: 'pg-num pg-year pg-profit ' + (gTotal >= 0 ? 'pos' : 'neg') }));
    body.appendChild(tr);
  })();
}

/* =====================================================================
 * 分析ページ本実装（Phase D）
 * 月次推移グラフ・年度累計・目標進捗・チャネル構成比。
 * データ源はいずれもappvMonthTotals/旧UI(app-simple.js)と同一にする。
 * ===================================================================== */

/* ---- 年度の月列挙（旧: app-simple.js smpProfitFiscalMonths 1749-1758行目と同一。3月〜翌2月） ---- */
function appvFiscalMonths(startYear) {
  const arr = [];
  for (let i = 0; i < 12; i++) {
    const m = 3 + i;
    const y = startYear + (m > 12 ? 1 : 0);
    const mm = ((m - 1) % 12) + 1;
    arr.push({ key: y + '-' + String(mm).padStart(2, '0'), label: mm + '月' });
  }
  return arr;
}
/* 現在月からの年度開始年（旧: smpGoalFiscalStart 412行目と同一ロジック） */
function appvFiscalStartYear() {
  const cur = appvCurrentMonth();
  const y = parseInt(cur.slice(0, 4), 10), m = parseInt(cur.slice(5, 7), 10);
  return m >= 3 ? y : y - 1;
}
function appvMonthLabel(month) {
  const p = String(month || '').split('-');
  return p.length === 2 ? p[0] + '年' + Number(p[1]) + '月' : '今月';
}

/* ==================== 月次推移グラフ（直近6ヶ月・インラインSVG棒グラフ） ==================== */
async function appvLast6Months() {
  const cur = appvCurrentMonth();
  const months = [];
  let m = cur;
  for (let i = 0; i < 6; i++) { months.unshift(m); m = appvPrevMonth(m); }
  const out = [];
  for (const mo of months) {
    const t = await appvMonthTotals(mo);
    out.push({ month: mo, sale: t.sale, profit: t.profit });
  }
  return out;
}
function appvSvgEl(tag, attrs) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.keys(attrs || {}).forEach((k) => el.setAttribute(k, attrs[k]));
  return el;
}
async function appvRenderTrendChart() {
  const svg = document.getElementById('trendChart');
  const tooltip = document.getElementById('trendTooltip');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const data = await appvLast6Months();
  const W = 640, H = 220, padTop = 14, padBottom = 28, padSide = 10;
  const chartH = H - padTop - padBottom;
  const maxAbs = Math.max(1, ...data.map((d) => Math.max(Math.abs(d.sale), Math.abs(d.profit))));
  const groupW = (W - padSide * 2) / data.length;
  const barW = Math.min(28, groupW / 3);
  const zeroY = padTop + chartH * (maxAbs === 0 ? 0.5 : (Math.max(0, maxAbs) / (maxAbs * 2 || 1)));
  // ゼロ基準線（マイナス粗利があり得るため中央基準にする簡易スケール）
  const hasNeg = data.some((d) => d.profit < 0);
  const scaleMax = maxAbs || 1;
  const baseline = hasNeg ? padTop + chartH * 0.7 : padTop + chartH;
  const posH = hasNeg ? chartH * 0.7 : chartH;
  const negH = hasNeg ? chartH * 0.3 : 0;
  svg.appendChild(appvSvgEl('line', { x1: padSide, y1: baseline, x2: W - padSide, y2: baseline, stroke: '#E4E7E3', 'stroke-width': 1 }));
  data.forEach((d, i) => {
    const cx = padSide + groupW * i + groupW / 2;
    const saleH = scaleMax ? (Math.abs(d.sale) / scaleMax) * posH : 0;
    const saleY = baseline - saleH;
    const saleBar = appvSvgEl('rect', {
      x: cx - barW - 2, y: saleY, width: barW, height: Math.max(1, saleH),
      fill: 'var(--accent)', rx: 3, class: 'trend-bar', 'data-month': d.month, 'data-kind': 'sale', 'data-val': d.sale
    });
    svg.appendChild(saleBar);
    const profNeg = d.profit < 0;
    const profH = scaleMax ? (Math.abs(d.profit) / scaleMax) * (profNeg ? negH : posH) : 0;
    const profY = profNeg ? baseline : baseline - profH;
    const profBar = appvSvgEl('rect', {
      x: cx + 2, y: profY, width: barW, height: Math.max(1, profH),
      fill: profNeg ? 'var(--err)' : 'var(--info)', rx: 3, class: 'trend-bar', 'data-month': d.month, 'data-kind': 'profit', 'data-val': d.profit
    });
    svg.appendChild(profBar);
    const label = appvSvgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#67716B' });
    label.textContent = Number(d.month.slice(5, 7)) + '月';
    svg.appendChild(label);
  });
  const showTip = (e) => {
    const t = e.target;
    if (!t || !t.dataset || !t.dataset.month) { if (tooltip) tooltip.style.display = 'none'; return; }
    if (!tooltip) return;
    const kindLabel = t.dataset.kind === 'sale' ? '売上' : '粗利';
    tooltip.textContent = appvMonthLabel(t.dataset.month) + ' ' + kindLabel + ' ' + yen(Number(t.dataset.val));
    const rect = t.getBoundingClientRect();
    const wrapRect = svg.parentElement.getBoundingClientRect();
    tooltip.style.left = (rect.left - wrapRect.left + rect.width / 2) + 'px';
    tooltip.style.top = (rect.top - wrapRect.top) + 'px';
    tooltip.style.display = 'block';
  };
  svg.addEventListener('mousemove', showTip);
  svg.addEventListener('mouseleave', () => { if (tooltip) tooltip.style.display = 'none'; });
  svg.addEventListener('click', showTip);
}

/* ==================== 年度累計カード（旧UIホーム smpGoalYearTotals と同一計算） ==================== */
async function appvRenderFiscalYearCard() {
  const startYear = appvFiscalStartYear();
  appvSetText('fiscalYearTitle', startYear + '年度（3月〜翌2月）累計');
  const months = appvFiscalMonths(startYear);
  let sale = 0, pur = 0, exp = 0, profit = 0;
  for (const mo of months) {
    const t = await appvMonthTotals(mo.key);
    sale += t.sale; pur += t.pur; exp += t.exp; profit += t.profit;
  }
  appvSetText('fyTotalSale', yen(sale));
  appvSetText('fyTotalPur', yen(pur));
  appvSetText('fyTotalExp', yen(exp));
  appvSetText('fyTotalProfit', (profit >= 0 ? '+' : '−') + yen(Math.abs(profit)));
  return { sale, pur, exp, profit, months };
}

/* ==================== 目標進捗（旧UIホーム「🎯目標」と同一ストア・同一同期規則） ====================
 * ストア: localStorage 'ribre_smp_goals_v1' = { yearSale, yearProf, curSaleUnit, curProfUnit, mSale:{}, mProf:{} }
 * 同期: 旧 smpGoalsGet/Set/PushCloud/PullCloud（app-simple.js 349-406行目）と全く同じキー・同じ手順で移植。 */
let appvGoalMode = 'year';
function appvGoalsGet() {
  try { const o = JSON.parse(localStorage.getItem('ribre_smp_goals_v1') || '{}') || {}; o.mSale = o.mSale || {}; o.mProf = o.mProf || {}; return o; }
  catch (e) { return { mSale: {}, mProf: {} }; }
}
function appvGoalsTsGet() { return Number(localStorage.getItem('ribre_smp_goals_ts') || 0) || 0; }
function appvGoalsTsSet(t) { try { localStorage.setItem('ribre_smp_goals_ts', String(t || Date.now())); } catch (e) {} }
function appvGoalsSet(o) { try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(o)); } catch (e) {} appvGoalsTsSet(Date.now()); appvGoalsPushDebounced(); }
/* 旧: smpFlatMerge（app-simple.js 326-348行目）と完全同一のマス単位マージ規則に修正（B4）。
   修正前は `ta = am[k] != null ? am[k] : aTs` のようにキー有無を見ずブロブ全体tsへ
   フォールバックしており、片方の端末にしか無い月別目標が消える不具合があった。
   旧実装同様、hasA/hasBでキー存在を判定してからtsフォールバックする。 */
function appvFlatMerge(a, aTs, b, bTs) {
  a = a || {}; b = b || {};
  const am = (a._m && typeof a._m === 'object') ? a._m : {};
  const bm = (b._m && typeof b._m === 'object') ? b._m : {};
  const keys = {};
  Object.keys(a).forEach((k) => { if (k !== '_m') keys[k] = 1; });
  Object.keys(b).forEach((k) => { if (k !== '_m') keys[k] = 1; });
  Object.keys(am).forEach((k) => { keys[k] = 1; });
  Object.keys(bm).forEach((k) => { keys[k] = 1; });
  const out = { _m: {} };
  Object.keys(keys).forEach((k) => {
    const hasA = a[k] != null, hasB = b[k] != null;
    const ta = Number(am[k] || (hasA ? (aTs || 0) : 0)) || 0;
    const tb = Number(bm[k] || (hasB ? (bTs || 0) : 0)) || 0;
    const useA = ta >= tb;
    const val = useA ? (hasA ? a[k] : undefined) : (hasB ? b[k] : undefined);
    out._m[k] = Math.max(ta, tb);
    if (val !== undefined) out[k] = val;
  });
  const lim = Date.now() - 180 * 24 * 3600 * 1000;
  Object.keys(out._m).forEach((k) => { if (out._m[k] < lim && out[k] == null) delete out._m[k]; });
  return out;
}
/* 旧: smpGoalsMerge（app-simple.js 357-368行目）と同一 */
function appvGoalsMerge(a, aTs, b, bTs) {
  a = a || {}; b = b || {};
  const useA = (aTs || 0) >= (bTs || 0);
  const top = useA ? a : b, other = useA ? b : a;
  const out = {};
  ['yearSale', 'yearProf', 'curSaleUnit', 'curProfUnit'].forEach((k) => {
    out[k] = (top[k] != null && top[k] !== 0) ? top[k] : other[k];
  });
  out.mSale = appvFlatMerge(a.mSale, aTs, b.mSale, bTs);
  out.mProf = appvFlatMerge(a.mProf, aTs, b.mProf, bTs);
  return out;
}
async function appvGoalsFetchCloud(cr) {
  try {
    const r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.goals&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    const d = await r.json();
    const c = d && d[0] && d[0].value;
    return (c && c.data) ? c : null;
  } catch (e) { return null; }
}
let appvGoalsPushTimer = null;
function appvGoalsPushDebounced() { if (appvGoalsPushTimer) clearTimeout(appvGoalsPushTimer); appvGoalsPushTimer = setTimeout(appvGoalsPushCloud, 800); }
async function appvGoalsPushCloud() {
  const cr = appvCreds(); if (!cr) return { ok: false };
  try {
    let body = appvGoalsGet();
    const cloud = await appvGoalsFetchCloud(cr);
    if (cloud) {
      body = appvGoalsMerge(appvGoalsGet(), appvGoalsTsGet(), cloud.data, cloud.ts || 0);
      try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(body)); } catch (e) {}
    }
    const now = Date.now();
    appvGoalsTsSet(now);
    const r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'goals', value: { data: body, ts: now } }])
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false }; }
}
async function appvGoalsPullCloud() {
  const cr = appvCreds(); if (!cr) return false;
  const cloud = await appvGoalsFetchCloud(cr);
  if (!cloud) return false;
  const local = appvGoalsGet();
  const merged = appvGoalsMerge(local, appvGoalsTsGet(), cloud.data, cloud.ts || 0);
  const changed = JSON.stringify(merged) !== JSON.stringify(local);
  try { localStorage.setItem('ribre_smp_goals_v1', JSON.stringify(merged)); } catch (e) {}
  appvGoalsTsSet(Math.max(appvGoalsTsGet(), Number(cloud.ts || 0)));
  if (JSON.stringify(merged) !== JSON.stringify(cloud.data)) appvGoalsPushDebounced();
  return changed;
}
/* 「あと何個で達成」カウント（旧: smpGoalCount 407-411行目と同一。sales()＋profit_meisai売上の件数） */
async function appvGoalCount(m) {
  let c = 0;
  try {
    c = sales().filter((r) => (r.month || String(r.date || '').slice(0, 7)) === m).length;
    const mei = await appvGetMeisai();
    c += mei.sales.filter((e) => (e.month || String(e.date || '').slice(0, 7)) === m).length;
  } catch (e) {}
  return c;
}
/* 先月までの平均単価（旧: smpGoalYearAvgUnit 418-423行目と同一） */
async function appvGoalYearAvgUnit() {
  const cur = appvCurrentMonth();
  const months = appvFiscalMonths(appvFiscalStartYear());
  let saleSum = 0, profSum = 0, cnt = 0;
  for (const mo of months) {
    if (mo.key < cur) {
      const t = await appvMonthTotals(mo.key);
      saleSum += t.sale; profSum += t.profit; cnt += await appvGoalCount(mo.key);
    }
  }
  return { su: cnt ? Math.round(saleSum / cnt) : 0, pu: cnt ? Math.round(profSum / cnt) : 0, cnt: cnt };
}
function appvGoalSetMode(mode) {
  appvGoalMode = mode;
  const by = document.getElementById('goalBtnYear'), bm = document.getElementById('goalBtnMonth');
  if (by) by.classList.toggle('active', mode === 'year');
  if (bm) bm.classList.toggle('active', mode === 'month');
  const mw = document.getElementById('goalMonthWrap');
  if (mw) mw.style.display = mode === 'month' ? 'block' : 'none';
  appvRenderGoals();
}
function appvGoalCalc(kind, curSale, curProf) {
  const isSale = kind === 'sale';
  const cur = isSale ? curSale : curProf;
  const t = Math.max(0, num((document.getElementById(isSale ? 'goalSaleInput' : 'goalProfInput') || {}).value));
  const u = Math.max(1, num((document.getElementById(isSale ? 'goalSaleUnitInput' : 'goalProfUnitInput') || {}).value));
  const rem = Math.max(0, t - cur), pct = t > 0 ? Math.min(100, Math.round(cur / t * 100)) : 0, n = rem > 0 ? Math.ceil(rem / u) : 0;
  const pre = isSale ? 'goalSale' : 'goalProf';
  appvSetText(pre + 'CurTxt', yen(cur));
  appvSetText(pre + 'Tgt', yen(t));
  appvSetText(pre + 'Pct', pct + '%');
  const bar = document.getElementById(pre + 'Bar'); if (bar) bar.style.width = pct + '%';
  appvSetText(pre + 'Rem', rem > 0 ? ('あと ' + yen(rem)) : '🎉 達成');
  appvSetText(pre + 'N', rem > 0 ? ('＝ 約' + n.toLocaleString('ja-JP') + '個') : '');
}
/* 保存（旧: smpGoalSave 438-451行目と同一）。年度モードはyearSale/yearProf、月ごとモードはmSale[m]/mProf[m]。 */
function appvGoalSave() {
  const g = appvGoalsGet();
  const cur = appvCurrentMonth();
  const sT = num((document.getElementById('goalSaleInput') || {}).value);
  const pT = num((document.getElementById('goalProfInput') || {}).value);
  const sU = num((document.getElementById('goalSaleUnitInput') || {}).value);
  const pU = num((document.getElementById('goalProfUnitInput') || {}).value);
  if (appvGoalMode === 'year') {
    g.yearSale = sT; g.yearProf = pT; g.curSaleUnit = sU; g.curProfUnit = pU;
  } else {
    const sel = document.getElementById('goalMonthSel');
    const m = (sel && sel.value) || cur;
    g.mSale[m] = sT; g.mProf[m] = pT;
    g.mSale._m = g.mSale._m || {}; g.mSale._m[m] = Date.now();
    g.mProf._m = g.mProf._m || {}; g.mProf._m[m] = Date.now();
    if (m === cur) { g.curSaleUnit = sU; g.curProfUnit = pU; }
  }
  appvGoalsSet(g);
}
async function appvGoalOnInput(kind, curSale, curProf) {
  appvGoalSave();
  appvGoalCalc(kind, curSale, curProf);
  if (typeof appvRenderPacemaker === 'function') { try { await appvRenderPacemaker(); } catch (e) {} }
}
async function appvRenderGoals() {
  const card = document.getElementById('goalSaleBar');
  if (!card) return;
  const g = appvGoalsGet();
  const cur = appvCurrentMonth();
  const msel = document.getElementById('goalMonthSel');
  if (msel && !msel.options.length) {
    const months = appvFiscalMonths(appvFiscalStartYear()).map((mo) => mo.key).concat([cur]);
    const uniq = Array.from(new Set(months)).sort().reverse();
    msel.innerHTML = uniq.map((m) => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + appvMonthLabel(m) + (m === cur ? '（当月）' : '') + '</option>').join('');
  }
  let curSale, curProf, sT, pT, sU, pU, src;
  if (appvGoalMode === 'year') {
    const yt = await appvRenderFiscalYearCard();
    curSale = yt.sale; curProf = yt.profit;
    sT = num(g.yearSale); pT = num(g.yearProf);
    const av = await appvGoalYearAvgUnit();
    sU = (g.curSaleUnit != null && g.curSaleUnit !== '') ? num(g.curSaleUnit) : av.su;
    pU = (g.curProfUnit != null && g.curProfUnit !== '') ? num(g.curProfUnit) : av.pu;
    src = '先月までの平均（手入力で調整可）';
  } else {
    const m = (msel && msel.value) || cur;
    const t = await appvMonthTotals(m);
    curSale = t.sale; curProf = t.profit;
    sT = num((g.mSale || {})[m]); pT = num((g.mProf || {})[m]);
    const av = await appvGoalYearAvgUnit();
    sU = (g.curSaleUnit != null && g.curSaleUnit !== '') ? num(g.curSaleUnit) : av.su;
    pU = (g.curProfUnit != null && g.curProfUnit !== '') ? num(g.curProfUnit) : av.pu;
    src = '先月までの平均（手入力で調整可）';
  }
  const saleInput = document.getElementById('goalSaleInput');
  if (saleInput && document.activeElement !== saleInput) saleInput.value = sT || '';
  const profInput = document.getElementById('goalProfInput');
  if (profInput && document.activeElement !== profInput) profInput.value = pT || '';
  const saleUnitInput = document.getElementById('goalSaleUnitInput');
  if (saleUnitInput && document.activeElement !== saleUnitInput) saleUnitInput.value = sU || '';
  const profUnitInput = document.getElementById('goalProfUnitInput');
  if (profUnitInput && document.activeElement !== profUnitInput) profUnitInput.value = pU || '';
  appvSetText('goalUnitSrc', src);
  appvGoalCalc('sale', curSale, curProf);
  appvGoalCalc('prof', curSale, curProf);
}

/* ==================== チャネル構成比（選択月・旧UIのsaleEffルール＝実数優先＋当月のみ仮入力） ==================== */
async function appvChannelSaleMap(month) {
  const salesAll = get(LS.sales, []);
  const chanReal = {};
  (Array.isArray(salesAll) ? salesAll : []).forEach((r) => {
    if (appvIsMeiRowLocal(r)) return;
    if (appvMonthOfLocal(r) !== month) return;
    const c = String(r.shop || r.type || r.matchStatus || '').trim() || 'その他';
    chanReal[c] = (chanReal[c] || 0) + num(r.amount != null ? r.amount : r.price);
  });
  const map = {};
  APPV_SALES_CHANNELS.forEach((c) => { map[c] = chanReal[c] || 0; });
  Object.keys(chanReal).forEach((c) => { if (map[c] == null) map[c] = chanReal[c]; });
  const cur = appvCurrentMonth();
  if (month === cur) {
    const prov = await appvGetProv();
    const provMonth = (prov && prov[month]) || {};
    Object.keys(map).forEach((c) => {
      if (map[c] > 0) return;
      const pv = num(provMonth[c]);
      if (pv) map[c] = pv;
    });
  }
  // 明細(profit_meisai)の売上はチャネル別ではないため「明細」として別枠追加
  const mei = await appvGetMeisai();
  const meiSum = mei.sales.filter((e) => (e.month || String(e.date || '').slice(0, 7)) === month).reduce((s, e) => s + num(e.amount), 0);
  if (meiSum) map['明細'] = (map['明細'] || 0) + meiSum;
  return map;
}
async function appvRenderChannelMix() {
  const sel = document.getElementById('channelMixMonthSel');
  const body = document.getElementById('channelMixBody');
  if (!sel || !body) return;
  const cur = appvCurrentMonth();
  if (!sel.options.length) {
    const months = [];
    let m = cur;
    for (let i = 0; i < 12; i++) { months.push(m); m = appvPrevMonth(m); }
    sel.innerHTML = months.map((mo) => '<option value="' + mo + '"' + (mo === cur ? ' selected' : '') + '>' + appvMonthLabel(mo) + '</option>').join('');
  }
  const month = sel.value || cur;
  const map = await appvChannelSaleMap(month);
  const entries = Object.keys(map).filter((c) => map[c] > 0).sort((a, b) => map[b] - map[a]);
  const total = entries.reduce((s, c) => s + map[c], 0);
  appvClear(body);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '対象月の売上データがありません';
    body.appendChild(empty);
    return;
  }
  entries.forEach((c) => {
    const pct = total ? Math.round(map[c] / total * 100) : 0;
    const row = document.createElement('div');
    row.className = 'chmix-row';
    const label = document.createElement('div');
    label.className = 'chmix-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = c;
    const valSpan = document.createElement('span');
    valSpan.className = 'num';
    valSpan.textContent = yen(map[c]) + '（' + pct + '%）';
    label.appendChild(nameSpan);
    label.appendChild(valSpan);
    const barWrap = document.createElement('div');
    barWrap.className = 'chmix-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'chmix-bar';
    bar.style.width = pct + '%';
    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    body.appendChild(row);
  });
}

/* ==================== A. 個数・平均単価カード ====================
 * 個数 = CSV由来売上行（sales, source!=='明細'）のうち対象月に属する行数。
 * 平均単価 = チャネル売上金額(chanReal合計。当月のみ実数0チャネルへ仮入力を加算) ÷ 個数。
 * 明細（まとめ売り）・仮入力（CSV未取込チャネルの手入力額）は金額のみを持ち商品行を持たないため、
 * 個数には一切含めない（既存のappvMonthTotals/appvChannelSaleMapと同じ「実数優先＋当月のみ仮入力」ルールを流用）。 */
function appvSalesCsvRowsInMonth(month) {
  const salesAll = get(LS.sales, []);
  return (Array.isArray(salesAll) ? salesAll : []).filter((r) => appvMonthOfLocal(r) === month && !appvIsMeiRowLocal(r));
}
async function appvUnitPriceStats(month) {
  const rows = appvSalesCsvRowsInMonth(month);
  const count = rows.length;
  const map = await appvChannelSaleMap(month); // 実数優先＋当月のみ仮入力込みのチャネル別売上（明細は別枠'明細'として入るが個数対象外なので合計から除く）
  const chanSale = Object.keys(map).filter((c) => c !== '明細').reduce((s, c) => s + map[c], 0);
  const avg = count ? Math.round(chanSale / count) : 0;
  return { count: count, chanSale: chanSale, avg: avg };
}
async function appvUnitPriceYearStats(startYear) {
  const months = appvFiscalMonths(startYear);
  let count = 0, chanSale = 0;
  for (const mo of months) {
    const st = await appvUnitPriceStats(mo.key);
    count += st.count; chanSale += st.chanSale;
  }
  return { count: count, chanSale: chanSale, avg: count ? Math.round(chanSale / count) : 0 };
}
async function appvUnitPriceChannelTable(month) {
  const rows = appvSalesCsvRowsInMonth(month);
  const byChan = {};
  rows.forEach((r) => {
    const c = String(r.shop || r.type || r.matchStatus || '').trim() || 'その他';
    const amt = num(r.amount != null ? r.amount : r.price);
    byChan[c] = byChan[c] || { count: 0, sale: 0 };
    byChan[c].count += 1;
    byChan[c].sale += amt;
  });
  // 並びは固定のチャネル順（ヤフオク1〜8→メルカリ→メルカリShops→ラクマ→その他）
  return Object.keys(byChan).sort((a, b) => appvChannelOrderKey(a) - appvChannelOrderKey(b) || String(a).localeCompare(String(b), 'ja')).map((c) => ({
    chan: c, count: byChan[c].count, sale: byChan[c].sale,
    avg: byChan[c].count ? Math.round(byChan[c].sale / byChan[c].count) : 0
  }));
}
async function appvRenderUnitPriceCard() {
  const sel = document.getElementById('unitPriceMonthSel');
  const body = document.getElementById('unitPriceChanBody');
  if (!sel || !body) return;
  const cur = appvCurrentMonth();
  if (!sel.options.length) {
    const months = [];
    let m = cur;
    for (let i = 0; i < 12; i++) { months.push(m); m = appvPrevMonth(m); }
    sel.innerHTML = months.map((mo) => '<option value="' + mo + '"' + (mo === cur ? ' selected' : '') + '>' + appvMonthLabel(mo) + '</option>').join('');
  }
  const month = sel.value || cur;
  const prevMonth = appvPrevMonth(month);
  const st = await appvUnitPriceStats(month);
  const prevSt = await appvUnitPriceStats(prevMonth);
  appvSetText('unitPriceCount', st.count.toLocaleString('ja-JP') + '件');
  appvSetText('unitPriceAvg', yen(st.avg));
  const badge = appvPctBadge(st.count, prevSt.count);
  const footEl = document.getElementById('unitPriceCountFoot');
  if (footEl) {
    appvClear(footEl);
    const b = document.createElement('span');
    b.className = 'badge ' + badge.cls;
    b.textContent = badge.text;
    footEl.appendChild(b);
  }
  const startYear = appvFiscalStartYear();
  const yst = await appvUnitPriceYearStats(startYear);
  appvSetText('unitPriceYearCount', yst.count.toLocaleString('ja-JP') + '件');
  appvSetText('unitPriceYearAvg', yen(yst.avg));

  const table = await appvUnitPriceChannelTable(month);
  appvClear(body);
  if (!table.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 4; td.className = 'muted'; td.textContent = '対象月のCSV売上データがありません';
    tr.appendChild(td); body.appendChild(tr);
    return;
  }
  table.forEach((row) => {
    const tr = document.createElement('tr');
    const tdC = document.createElement('td'); tdC.textContent = row.chan;
    const tdN = document.createElement('td'); tdN.style.textAlign = 'right'; tdN.textContent = row.count.toLocaleString('ja-JP') + '件';
    const tdS = document.createElement('td'); tdS.style.textAlign = 'right'; tdS.textContent = yen(row.sale);
    const tdA = document.createElement('td'); tdA.style.textAlign = 'right'; tdA.textContent = yen(row.avg);
    tr.appendChild(tdC); tr.appendChild(tdN); tr.appendChild(tdS); tr.appendChild(tdA);
    body.appendChild(tr);
  });
}

/* ==================== B. 価格帯分布 ==================== */
const APPV_PRICE_BINS = [
  { label: '〜999円', min: 0, max: 999 },
  { label: '1,000〜2,999円', min: 1000, max: 2999 },
  { label: '3,000〜4,999円', min: 3000, max: 4999 },
  { label: '5,000〜9,999円', min: 5000, max: 9999 },
  { label: '10,000〜29,999円', min: 10000, max: 29999 },
  { label: '30,000円〜', min: 30000, max: Infinity }
];
function appvPriceDistData(month) {
  const rows = appvSalesCsvRowsInMonth(month);
  const bins = APPV_PRICE_BINS.map((b) => ({ label: b.label, min: b.min, max: b.max, count: 0, sale: 0 }));
  rows.forEach((r) => {
    const amt = num(r.amount != null ? r.amount : r.price);
    const bin = bins.find((b) => amt >= b.min && amt <= b.max) || bins[bins.length - 1];
    bin.count += 1;
    bin.sale += amt;
  });
  return bins;
}
async function appvRenderPriceDist() {
  const body = document.getElementById('priceDistBody');
  const sel = document.getElementById('unitPriceMonthSel'); // 個数・平均単価カードの選択月と共用
  if (!body) return;
  const month = (sel && sel.value) || appvCurrentMonth();
  const bins = appvPriceDistData(month);
  const totalCount = bins.reduce((s, b) => s + b.count, 0);
  const totalSale = bins.reduce((s, b) => s + b.sale, 0);
  appvClear(body);
  if (!totalCount) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '対象月のCSV売上データがありません';
    body.appendChild(empty);
    return;
  }
  bins.forEach((b) => {
    const pct = totalSale ? Math.round(b.sale / totalSale * 100) : 0;
    const row = document.createElement('div');
    row.className = 'dist-row';
    const label = document.createElement('div');
    label.className = 'dist-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = b.label;
    const valSpan = document.createElement('span');
    valSpan.className = 'num';
    valSpan.textContent = b.count.toLocaleString('ja-JP') + '件 / ' + yen(b.sale) + '（' + pct + '%）';
    label.appendChild(nameSpan);
    label.appendChild(valSpan);
    const barWrap = document.createElement('div');
    barWrap.className = 'dist-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'dist-bar';
    bar.style.width = pct + '%';
    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    body.appendChild(row);
  });
}

/* ==================== C. 当月の日別売上推移＋着地予測 ====================
 * 選択月のCSV売上行（source!=='明細'）＋明細(profit_meisai)を日別に合算。
 * 着地予測 = 経過日数までの合計 ÷ 経過日数 × 当月日数（当月選択時のみ。過去月は実績のみ表示）。 */
async function appvDailySalesData(month) {
  const rows = appvSalesCsvRowsInMonth(month);
  const mei = await appvGetMeisai();
  const meiOf = (e) => (e.month || String(e.date || '').slice(0, 7));
  const meiRows = mei.sales.filter((e) => meiOf(e) === month);
  const parts = String(month).split('-');
  const lastDay = new Date(Number(parts[0]), Number(parts[1]), 0).getDate();
  const byDay = {};
  for (let d = 1; d <= lastDay; d++) byDay[d] = 0;
  rows.forEach((r) => {
    const dp = String(r.date || '').split('-');
    const d = dp.length === 3 ? Number(dp[2]) : null;
    if (d && byDay[d] != null) byDay[d] += num(r.amount != null ? r.amount : r.price);
  });
  meiRows.forEach((e) => {
    const dp = String(e.date || '').split('-');
    const d = dp.length === 3 ? Number(dp[2]) : null;
    if (d && byDay[d] != null) byDay[d] += num(e.amount);
  });
  return { byDay: byDay, lastDay: lastDay };
}
async function appvRenderDailyTrend() {
  const sel = document.getElementById('dailyTrendMonthSel');
  const svg = document.getElementById('dailyTrendChart');
  const foot = document.getElementById('dailyTrendForecast');
  if (!sel || !svg) return;
  const cur = appvCurrentMonth();
  if (!sel.options.length) {
    const months = [];
    let m = cur;
    for (let i = 0; i < 12; i++) { months.push(m); m = appvPrevMonth(m); }
    sel.innerHTML = months.map((mo) => '<option value="' + mo + '"' + (mo === cur ? ' selected' : '') + '>' + appvMonthLabel(mo) + '</option>').join('');
  }
  const month = sel.value || cur;
  const data = await appvDailySalesData(month);
  const days = Object.keys(data.byDay).map(Number).sort((a, b) => a - b);
  const vals = days.map((d) => data.byDay[d]);
  const maxV = Math.max(1, ...vals);

  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const W = 640, H = 200, padTop = 10, padBottom = 22, padSide = 8;
  const chartH = H - padTop - padBottom;
  const groupW = (W - padSide * 2) / days.length;
  const barW = Math.max(2, Math.min(14, groupW * 0.7));
  svg.appendChild(appvSvgEl('line', { x1: padSide, y1: H - padBottom, x2: W - padSide, y2: H - padBottom, stroke: '#E4E7E3', 'stroke-width': 1 }));
  days.forEach((d, i) => {
    const v = data.byDay[d];
    const h = maxV ? (v / maxV) * chartH : 0;
    const x = padSide + groupW * i + (groupW - barW) / 2;
    const y = H - padBottom - h;
    const rect = appvSvgEl('rect', { x: x, y: y, width: barW, height: Math.max(0, h), fill: 'var(--accent)', rx: 2 });
    svg.appendChild(rect);
    if (d === 1 || d % 5 === 0 || d === days.length) {
      const label = appvSvgEl('text', { x: x + barW / 2, y: H - 6, 'text-anchor': 'middle', 'font-size': 9, fill: '#67716B' });
      label.textContent = String(d);
      svg.appendChild(label);
    }
  });

  const total = vals.reduce((s, v) => s + v, 0);
  if (month === cur) {
    const todayD = Number(today().slice(8, 10));
    const elapsedDays = Math.max(1, Math.min(todayD, data.lastDay));
    const elapsedSum = days.filter((d) => d <= elapsedDays).reduce((s, d) => s + data.byDay[d], 0);
    const forecast = Math.round((elapsedSum / elapsedDays) * data.lastDay);
    appvSetText('dailyTrendForecast', '経過' + elapsedDays + '日／' + data.lastDay + '日：合計' + yen(elapsedSum) + ' ÷ ' + elapsedDays + '日 × ' + data.lastDay + '日 ＝ 着地予測 ' + yen(forecast));
  } else {
    appvSetText('dailyTrendForecast', '実績合計 ' + yen(total) + '（過去月のため着地予測はありません）');
  }
}

/* ==================== D. 手数料率・送料率の推移（直近6ヶ月） ====================
 * 手数料率 = fee合計 ÷ 売上(chanSale+meiSale)合計 × 100（appvMonthTotalsのexp内訳と同じ集計源）。
 * 送料率も同様。売上0の月は0除算になるため一覧から除外する。 */
async function appvFeeShipRateLast6Months() {
  const cur = appvCurrentMonth();
  const months = [];
  let m = cur;
  for (let i = 0; i < 6; i++) { months.unshift(m); m = appvPrevMonth(m); }
  const out = [];
  for (const mo of months) {
    const t = await appvMonthTotals(mo);
    if (!t.sale) continue; // 売上0の月は表示スキップ
    out.push({ month: mo, feeRate: (t.fee / t.sale) * 100, shipRate: (t.ship / t.sale) * 100 });
  }
  return out;
}
async function appvRenderFeeRateChart() {
  const svg = document.getElementById('feeRateChart');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const data = await appvFeeShipRateLast6Months();
  const W = 640, H = 200, padTop = 14, padBottom = 26, padSide = 10;
  const chartH = H - padTop - padBottom;
  if (!data.length) {
    const label = appvSvgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', 'font-size': 13, fill: '#67716B' });
    label.textContent = '対象月の売上データがありません';
    svg.appendChild(label);
    return;
  }
  const maxRate = Math.max(5, ...data.map((d) => Math.max(d.feeRate, d.shipRate)));
  const groupW = (W - padSide * 2) / data.length;
  const barW = Math.min(24, groupW / 3);
  svg.appendChild(appvSvgEl('line', { x1: padSide, y1: H - padBottom, x2: W - padSide, y2: H - padBottom, stroke: '#E4E7E3', 'stroke-width': 1 }));
  data.forEach((d, i) => {
    const cx = padSide + groupW * i + groupW / 2;
    const feeH = (d.feeRate / maxRate) * chartH;
    const shipH = (d.shipRate / maxRate) * chartH;
    const feeBar = appvSvgEl('rect', { x: cx - barW - 2, y: H - padBottom - feeH, width: barW, height: Math.max(1, feeH), fill: 'var(--warn)', rx: 3 });
    const feeTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    feeTitle.textContent = appvMonthLabel(d.month) + ' 手数料率 ' + d.feeRate.toFixed(1) + '%';
    feeBar.appendChild(feeTitle);
    svg.appendChild(feeBar);
    const shipBar = appvSvgEl('rect', { x: cx + 2, y: H - padBottom - shipH, width: barW, height: Math.max(1, shipH), fill: 'var(--info)', rx: 3 });
    const shipTitle = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    shipTitle.textContent = appvMonthLabel(d.month) + ' 送料率 ' + d.shipRate.toFixed(1) + '%';
    shipBar.appendChild(shipTitle);
    svg.appendChild(shipBar);
    const label = appvSvgEl('text', { x: cx, y: H - 8, 'text-anchor': 'middle', 'font-size': 11, fill: '#67716B' });
    label.textContent = Number(d.month.slice(5, 7)) + '月';
    svg.appendChild(label);
  });
}

/* ==================== E. 目標ペースメーカー ====================
 * 年度末（翌2月末）までの残り日数 = appvFiscalMonths最終月の月末日 − 今日。
 * 1日あたり必要額 = (年間売上目標 − 年度累計売上) ÷ 残り日数。商品単価はappvGoalsGetのcurSaleUnitを流用。 */
function appvFiscalYearEndDate(startYear) {
  const months = appvFiscalMonths(startYear);
  const lastKey = months[months.length - 1].key; // 翌年2月
  return new Date(appvMonthLastDay(lastKey) + 'T23:59:59');
}
async function appvRenderPacemaker() {
  const body = document.getElementById('pacemakerBody');
  if (!body) return;
  const g = appvGoalsGet();
  const yearSale = num(g.yearSale);
  appvClear(body);
  if (!yearSale) {
    const note = document.createElement('div');
    note.className = 'muted';
    note.textContent = '目標を設定してください（上の「🎯 目標」カードの年度モードで売上目標額を入力）';
    body.appendChild(note);
    return;
  }
  const startYear = appvFiscalStartYear();
  const yt = await appvRenderFiscalYearCard();
  const remainAmount = Math.max(0, yearSale - yt.sale);
  const endDate = appvFiscalYearEndDate(startYear);
  const now = new Date();
  const msPerDay = 24 * 3600 * 1000;
  const remainDays = Math.max(1, Math.ceil((endDate.getTime() - now.getTime()) / msPerDay));
  const perDay = Math.round(remainAmount / remainDays);
  const unit = num(g.curSaleUnit);
  const perDayCount = unit > 0 ? Math.ceil(perDay / unit) : 0;

  const line1 = document.createElement('div');
  line1.className = 'flex-between';
  const l1a = document.createElement('span'); l1a.className = 'muted'; l1a.textContent = '年度累計売上 / 目標';
  const l1b = document.createElement('span'); l1b.className = 'num'; l1b.textContent = yen(yt.sale) + ' / ' + yen(yearSale);
  line1.appendChild(l1a); line1.appendChild(l1b);
  body.appendChild(line1);

  const line2 = document.createElement('div');
  line2.className = 'flex-between section-gap';
  line2.style.marginTop = '6px';
  const l2a = document.createElement('span'); l2a.className = 'muted'; l2a.textContent = '残り金額 / 年度末までの残り日数';
  const l2b = document.createElement('span'); l2b.className = 'num'; l2b.textContent = yen(remainAmount) + ' / ' + remainDays + '日';
  line2.appendChild(l2a); line2.appendChild(l2b);
  body.appendChild(line2);

  const line3 = document.createElement('div');
  line3.style.marginTop = '10px';
  line3.style.fontSize = '15px';
  line3.style.fontWeight = '700';
  line3.style.color = 'var(--accent)';
  line3.textContent = '1日あたり ' + yen(perDay) + (unit > 0 ? '（商品単価' + yen(unit) + 'なら約' + perDayCount.toLocaleString('ja-JP') + '個/日）' : '');
  body.appendChild(line3);
}

/* ==================== E2. 年間着地予測 ====================
 * 年度（appvFiscalMonths）の各月を3種に分類して年間の着地を予測する。
 *  1) 確定月（当月より前の月）＝ appvMonthTotals の実績をそのまま合算。
 *  2) 当月　＝ 機能C（appvDailySalesData）と同じ日割り着地予測を使う。
 *     売上は「経過日数までの合計 ÷ 経過日数 × 当月日数」。
 *     粗利は当月のsale/pur/expを同じ日割り率（月日数÷経過日数）で月末換算してから
 *     profit = sale - pur - exp を計算する（＝sale/pur/expそれぞれを同率で日割り）。
 *  3) 未来月（当月より後の月）＝ 直近3ヶ月（当月を除く確定月のうち直近3つ）の
 *     月平均（売上・粗利それぞれ）× 残り月数。確定月が3ヶ月未満ならある分の平均を使う。
 * 予測年間売上 = 1)+2)+3)の売上、予測年間粗利も同様に合算。 */
async function appvYearForecastData() {
  const cur = appvCurrentMonth();
  const startYear = appvFiscalStartYear();
  const months = appvFiscalMonths(startYear);

  const settled = []; // 確定月のt（sale/pur/exp/profit）
  let curForecast = null; // 当月の日割り着地予測 {sale, pur, exp, profit}
  let futureCount = 0;

  for (const mo of months) {
    if (mo.key < cur) {
      const t = await appvMonthTotals(mo.key);
      settled.push(t);
    } else if (mo.key === cur) {
      // 当月：機能Cと同じ日割り着地予測ロジックを流用
      const data = await appvDailySalesData(mo.key);
      const days = Object.keys(data.byDay).map(Number).sort((a, b) => a - b);
      const todayD = Number(today().slice(8, 10));
      const elapsedDays = Math.max(1, Math.min(todayD, data.lastDay));
      const elapsedSum = days.filter((d) => d <= elapsedDays).reduce((s, d) => s + data.byDay[d], 0);
      const saleForecast = Math.round((elapsedSum / elapsedDays) * data.lastDay);

      // 粗利も同率で日割り：当月のsale/pur/expを（月日数÷経過日数）倍して月末換算する
      const t = await appvMonthTotals(mo.key);
      const ratio = data.lastDay / elapsedDays;
      const purForecast = Math.round(t.pur * ratio);
      const expForecast = Math.round(t.exp * ratio);
      curForecast = { sale: saleForecast, pur: purForecast, exp: expForecast, profit: saleForecast - purForecast - expForecast };
    } else {
      futureCount += 1;
    }
  }

  // 未来月の予測＝直近3ヶ月（当月を除く確定月のうち直近3つ）の平均 × 残り月数
  const recent3 = settled.slice(-3);
  const recentN = recent3.length;
  const recentAvgSale = recentN ? recent3.reduce((s, t) => s + t.sale, 0) / recentN : 0;
  const recentAvgProfit = recentN ? recent3.reduce((s, t) => s + t.profit, 0) / recentN : 0;
  const futureSale = recentAvgSale * futureCount;
  const futureProfit = recentAvgProfit * futureCount;

  const settledSale = settled.reduce((s, t) => s + t.sale, 0);
  const settledProfit = settled.reduce((s, t) => s + t.profit, 0);
  const curSale = curForecast ? curForecast.sale : 0;
  const curProfit = curForecast ? curForecast.profit : 0;

  const forecastSale = settledSale + curSale + futureSale;
  const forecastProfit = settledProfit + curProfit + futureProfit;

  return {
    settledCount: settled.length,
    settledSale: settledSale,
    settledProfit: settledProfit,
    curForecast: curForecast,
    futureCount: futureCount,
    recentN: recentN,
    recentAvgSale: recentAvgSale,
    recentAvgProfit: recentAvgProfit,
    futureSale: futureSale,
    futureProfit: futureProfit,
    forecastSale: forecastSale,
    forecastProfit: forecastProfit
  };
}
async function appvRenderYearForecast() {
  const body = document.getElementById('yearForecastBody');
  if (!body) return;
  appvClear(body);
  const d = await appvYearForecastData();
  const g = appvGoalsGet();
  const yearSale = num(g.yearSale);

  const big = document.createElement('div');
  big.className = 'grid2';
  big.style.marginTop = '2px';
  const bigSale = document.createElement('div');
  bigSale.innerHTML = '<div class="kpi-label">予測年間売上</div>';
  const bigSaleVal = document.createElement('div');
  bigSaleVal.className = 'kpi-value big num';
  bigSaleVal.textContent = yen(Math.round(d.forecastSale));
  bigSale.appendChild(bigSaleVal);
  const bigProfit = document.createElement('div');
  bigProfit.innerHTML = '<div class="kpi-label">予測年間粗利</div>';
  const bigProfitVal = document.createElement('div');
  bigProfitVal.className = 'kpi-value big num';
  bigProfitVal.style.color = 'var(--accent)';
  bigProfitVal.textContent = yen(Math.round(d.forecastProfit));
  bigProfit.appendChild(bigProfitVal);
  big.appendChild(bigSale); big.appendChild(bigProfit);
  body.appendChild(big);

  if (yearSale) {
    const diff = Math.round(d.forecastSale - yearSale);
    const pct = yearSale ? Math.round((d.forecastSale / yearSale) * 100) : 0;
    const goalLine = document.createElement('div');
    goalLine.className = 'section-gap';
    goalLine.style.fontSize = '14px';
    goalLine.style.fontWeight = '700';
    goalLine.style.color = diff >= 0 ? 'var(--accent)' : 'var(--err)';
    goalLine.textContent = '目標 ' + yen(yearSale) + ' に対し ' + (diff >= 0 ? '+' : '−') + yen(Math.abs(diff)) + '円（達成率' + pct + '%見込み）';
    body.appendChild(goalLine);
  }

  const table = document.createElement('div');
  table.className = 'section-gap';
  table.style.fontSize = '12.5px';
  const rows = [
    ['確定実績（' + d.settledCount + 'ヶ月分）', yen(Math.round(d.settledSale)) + '（粗利' + yen(Math.round(d.settledProfit)) + '）'],
    ['当月着地予測', d.curForecast ? (yen(Math.round(d.curForecast.sale)) + '（粗利' + yen(Math.round(d.curForecast.profit)) + '）') : '―'],
    ['残り' + d.futureCount + 'ヶ月の予測（直近' + d.recentN + 'ヶ月平均 ' + yen(Math.round(d.recentAvgSale)) + '/月ベース）', yen(Math.round(d.futureSale)) + '（粗利' + yen(Math.round(d.futureProfit)) + '）']
  ];
  rows.forEach((r) => {
    const row = document.createElement('div');
    row.className = 'flex-between';
    row.style.marginTop = '4px';
    const l = document.createElement('span'); l.className = 'muted'; l.textContent = r[0];
    const v = document.createElement('span'); v.className = 'num'; v.textContent = r[1];
    row.appendChild(l); row.appendChild(v);
    table.appendChild(row);
  });
  body.appendChild(table);

  const note = document.createElement('div');
  note.className = 'muted section-gap';
  note.style.fontSize = '11.5px';
  note.textContent = '予測は直近3ヶ月の平均ペースに基づく参考値です。';
  body.appendChild(note);
}

/* ==================== F. 販売先ランキング ====================
 * 明細売上（appvGetMeisai().sales）を相手先(name)別に年度合計し、トップ10を横棒表示。 */
async function appvPartnerRankData(startYear) {
  const months = appvFiscalMonths(startYear);
  const keyset = {}; months.forEach((m) => { keyset[m.key] = 1; });
  const mei = await appvGetMeisai();
  const meiOf = (e) => (e.month || String(e.date || '').slice(0, 7));
  const byPartner = {};
  mei.sales.filter((e) => keyset[meiOf(e)]).forEach((e) => {
    const p = String(e.name || '').trim() || '(相手先未設定)';
    byPartner[p] = (byPartner[p] || 0) + num(e.amount);
  });
  return Object.keys(byPartner).map((p) => ({ partner: p, amount: byPartner[p] })).sort((a, b) => b.amount - a.amount).slice(0, 10);
}
async function appvRenderPartnerRank() {
  const body = document.getElementById('partnerRankBody');
  if (!body) return;
  const startYear = appvFiscalStartYear();
  const ranked = await appvPartnerRankData(startYear);
  appvClear(body);
  if (!ranked.length) {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.textContent = '年度内の明細（まとめ売り）データがありません';
    body.appendChild(empty);
    return;
  }
  const total = ranked.reduce((s, r) => s + r.amount, 0);
  ranked.forEach((r) => {
    const pct = total ? Math.round(r.amount / total * 100) : 0;
    const row = document.createElement('div');
    row.className = 'dist-row';
    const label = document.createElement('div');
    label.className = 'dist-label';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = r.partner;
    const valSpan = document.createElement('span');
    valSpan.className = 'num';
    valSpan.textContent = yen(r.amount) + '（' + pct + '%）';
    label.appendChild(nameSpan);
    label.appendChild(valSpan);
    const barWrap = document.createElement('div');
    barWrap.className = 'dist-bar-wrap';
    const bar = document.createElement('div');
    bar.className = 'dist-bar';
    bar.style.width = pct + '%';
    barWrap.appendChild(bar);
    row.appendChild(label);
    row.appendChild(barWrap);
    body.appendChild(row);
  });
}

/* ==================== 分析ページ全体の描画エントリ ==================== */
async function appvRenderAnalysisPage() {
  await appvRenderTrendChart();
  await appvRenderUnitPriceCard();
  await appvRenderPriceDist();
  await appvRenderDailyTrend();
  await appvRenderFeeRateChart();
  await appvRenderGoals();
  await appvRenderPacemaker();
  await appvRenderYearForecast();
  await appvRenderChannelMix();
  await appvRenderPartnerRank();
  try { await appvGoalsPullCloud(); await appvRenderGoals(); await appvRenderPacemaker(); await appvRenderYearForecast(); } catch (e) {}
}

/* =====================================================================
 * 分析ページ「当月の仮入力」編集パネル（Phase D本実装の先行実装）
 * 保存先・同期規則は旧UI(app-simple.js)と完全同一にする:
 *  - ストア構造: localStorage 'ribre_smp_profit_prov_v1' = { [month]: { [チャネル名]: 額, __ship__: 額, __fee__: 額 }, _m: { 'month|チャネル': 更新時刻(ms) } }
 *    （旧: smpProfitProvGet/smpProfitProvSet 1773-1776行目）
 *  - マス単位マージ: 月×チャネルごとに _m の更新時刻を比較し新しい方を採用。
 *    同時刻はローカル優先（旧: smpProvMerge 1781-1810行目、呼び出しは常に merge(local, cloud)）
 *  - クラウド同期: 保存前に必ずクラウドを取得→マージ→保存の順（旧: smpProfitProvPushCloud 1820-1839行目）。
 *    Supabase app_settings (user_email, skey='profit_prov') に { data, ts } を upsert。
 *  - 実数優先ルール: CSV実数(chanReal)が1件でもあるチャネルは仮入力を無視して実数を表示する
 *    （旧: saleEff 2065行目 "if (real > 0) return real;"）。取込側がprovを消すのではなく、
 *    表示側（saleEff/appvMonthTotals）が実数を優先するだけ＝実数0に戻ればまた仮が使われる。
 * ===================================================================== */
function appvProvGet() {
  try { return JSON.parse(localStorage.getItem('ribre_smp_profit_prov_v1') || '{}') || {}; } catch (e) { return {}; }
}
function appvProvTsGet() { return Number(localStorage.getItem('ribre_smp_profit_prov_ts') || 0) || 0; }
function appvProvTsSet(t) { try { localStorage.setItem('ribre_smp_profit_prov_ts', String(t || Date.now())); } catch (e) {} }
/* 旧: smpProvMerge（app-simple.js 1781-1810行目）と同一規則で移植。 */
function appvProvMerge(aData, aTs, bData, bTs) {
  const a = aData || {}, b = bData || {};
  const am = (a._m && typeof a._m === 'object') ? a._m : {};
  const bm = (b._m && typeof b._m === 'object') ? b._m : {};
  const keys = {};
  const collect = (o, m) => {
    Object.keys(o).forEach((mo) => {
      if (mo === '_m') return;
      const row = o[mo];
      if (row && typeof row === 'object') Object.keys(row).forEach((ch) => { keys[mo + '|' + ch] = 1; });
    });
    Object.keys(m).forEach((k) => { keys[k] = 1; });
  };
  collect(a, am); collect(b, bm);
  const out = { _m: {} };
  Object.keys(keys).forEach((k) => {
    const i = k.indexOf('|'); if (i < 0) return;
    const mo = k.slice(0, i), ch = k.slice(i + 1);
    const hasA = a[mo] && a[mo][ch] != null, hasB = b[mo] && b[mo][ch] != null;
    const ta = Number(am[k] || (hasA ? (aTs || 0) : 0)) || 0;
    const tb = Number(bm[k] || (hasB ? (bTs || 0) : 0)) || 0;
    const useA = ta >= tb; // 同時刻はローカル優先（merge(local, cloud)で呼ぶ）
    const val = useA ? (hasA ? a[mo][ch] : undefined) : (hasB ? b[mo][ch] : undefined);
    out._m[k] = Math.max(ta, tb);
    if (val != null) { out[mo] = out[mo] || {}; out[mo][ch] = val; }
  });
  const lim = Date.now() - 180 * 24 * 3600 * 1000;
  Object.keys(out._m).forEach((k) => { const i = k.indexOf('|'); const mo = k.slice(0, i); const ch = k.slice(i + 1); if (out._m[k] < lim && !(out[mo] && out[mo][ch] != null)) delete out._m[k]; });
  return out;
}
/* 旧: smpProfitProvFetchCloud（1811-1819行目）と同一。 */
async function appvProvFetchCloud(cr) {
  try {
    const r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.profit_prov&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    const data = await r.json();
    const cloud = data && data[0] && data[0].value;
    return (cloud && typeof cloud === 'object' && cloud.data) ? cloud : null;
  } catch (e) { return null; }
}
/* 旧: smpProfitProvPushCloud（1820-1839行目）と同一手順：
   クラウド先取得→マージ→ローカル保存→upsert。 */
async function appvProvPushCloud() {
  const cr = appvCreds(); if (!cr) return { ok: false, reason: 'no-login' };
  try {
    let body = appvProvGet();
    const cloud = await appvProvFetchCloud(cr);
    if (cloud) {
      body = appvProvMerge(appvProvGet(), appvProvTsGet(), cloud.data, cloud.ts || 0);
      try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(body)); } catch (e) {}
    }
    const now = Date.now();
    appvProvTsSet(now);
    const r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'profit_prov', value: { data: body, ts: now } }])
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}
/* 旧: smpProfitSetProv（1854-1862行目）と同一のマス単位更新（1回のフィールド更新につき1回呼ぶ）。 */
function appvProvSetOne(o, month, chan, val) {
  o[month] = o[month] || {};
  o._m = (o._m && typeof o._m === 'object') ? o._m : {};
  const n = Number(String(val == null ? '' : val).replace(/[^0-9.-]/g, '')) || 0;
  if (n) o[month][chan] = n; else if (o[month]) delete o[month][chan];
  o._m[month + '|' + chan] = Date.now();
}
/* 分析ページのカードを描画：実数(>0)があるチャネルはバッジ表示・入力不可、実数0のチャネルは入力欄。 */
async function appvRenderProvPanel() {
  const body = document.getElementById('provChannelBody');
  if (!body) return;
  const month = appvCurrentMonth(); // 旧UIと同じく仮入力は当月のみ
  appvSetText('provMonthLabel', month);
  const salesAll = get(LS.sales, []);
  const chanReal = {};
  (Array.isArray(salesAll) ? salesAll : []).forEach((r) => {
    if (appvIsMeiRowLocal(r)) return;
    if (appvMonthOfLocal(r) !== month) return;
    const c = String(r.shop || r.type || r.matchStatus || '').trim() || 'その他';
    chanReal[c] = (chanReal[c] || 0) + num(r.amount != null ? r.amount : r.price);
  });
  const prov = appvProvGet();
  const provMonth = prov[month] || {};
  appvClear(body);
  APPV_SALES_CHANNELS.forEach((c) => {
    const real = chanReal[c] || 0;
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = c;
    const tdVal = document.createElement('td');
    tdVal.style.textAlign = 'right';
    if (real > 0) {
      const badge = document.createElement('span');
      badge.className = 'prov-badge';
      badge.textContent = '実数あり';
      const amt = document.createElement('span');
      amt.className = 'num';
      amt.style.marginLeft = '8px';
      amt.textContent = yen(real);
      tdVal.appendChild(amt);
      tdVal.appendChild(badge);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.className = 'prov-input';
      input.placeholder = '0';
      input.dataset.chan = c;
      const v = provMonth[c];
      input.value = (v != null ? v : '');
      tdVal.appendChild(input);
    }
    tr.appendChild(tdName);
    tr.appendChild(tdVal);
    body.appendChild(tr);
  });
  const shipInput = document.getElementById('provShipInput');
  if (shipInput) shipInput.value = (provMonth.__ship__ != null ? provMonth.__ship__ : '');
  const feeInput = document.getElementById('provFeeInput');
  if (feeInput) feeInput.value = (provMonth.__fee__ != null ? provMonth.__fee__ : '');
  appvSetText('provSaveStatus', '');
}
/* 保存ボタン：フォームの全入力値をprovストアへ反映→push（旧UIと同一の同期手順）→KPI再計算・トースト。 */
async function appvSaveProvPanel() {
  const btn = document.getElementById('provSaveBtn');
  const month = appvCurrentMonth();
  const o = appvProvGet();
  document.querySelectorAll('#provChannelBody input.prov-input').forEach((input) => {
    appvProvSetOne(o, month, input.dataset.chan, input.value);
  });
  const shipInput = document.getElementById('provShipInput');
  if (shipInput) appvProvSetOne(o, month, '__ship__', shipInput.value);
  const feeInput = document.getElementById('provFeeInput');
  if (feeInput) appvProvSetOne(o, month, '__fee__', feeInput.value);
  try { localStorage.setItem('ribre_smp_profit_prov_v1', JSON.stringify(o)); } catch (e) {}
  appvProvTsSet(Date.now());
  if (btn) btn.disabled = true;
  appvSetText('provSaveStatus', '保存中…');
  try {
    const res = await appvProvPushCloud();
    appvSetText('provSaveStatus', res && res.ok ? '✅ 保存しました' : '⚠️ クラウド保存に失敗しました（ローカルには保存済み）');
  } catch (e) {
    appvSetText('provSaveStatus', '⚠️ クラウド保存に失敗しました（ローカルには保存済み）');
  }
  if (btn) btn.disabled = false;
  await appvRenderProvPanel();
  if (appvViewMonth === month || !appvViewMonth) await appvRenderKpi();
  appvToast('仮入力を保存しました');
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
    // 商品ID（旧: app-simple.js smpSaleDetailCell('商品ID', itemId||'-') 2866-2870行目 と同一表示。無ければ「-」）
    ['商品ID', t.itemId || '-'],
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
  const editBtn = document.getElementById('drawerEditBtn');
  const delBtn = document.getElementById('drawerDeleteBtn');
  const warnEl = document.getElementById('drawerEditWarn');
  if (t._meiId) {
    // 明細方式の行：編集は明細フォームを開き直し、削除はappvDeleteMeisaiRow（tomb記録・月ロック尊重）
    const locked = t._locked;
    if (editBtn) editBtn.disabled = locked;
    if (delBtn) delBtn.disabled = locked;
    if (warnEl) { warnEl.style.display = locked ? 'block' : 'none'; warnEl.textContent = '🔒 この月はロックされています。編集・削除はできません。'; }
  } else {
    // ローカル配列上で一意に同定できない行（同一内容の重複行など）は編集・削除を無効化する
    // （appvFindLocalRowIndexはcid＋order＋一覧添字(_oi)の複合キーで、一覧のその行から
    // 開いた場合はできる限り一意特定を試みる。それでも決まらない＝同一商品IDの行が
    // 複数あり行番号の情報が失われているケースなど）
    const canEdit = appvFindLocalRowIndex(t) >= 0;
    if (editBtn) editBtn.disabled = !canEdit;
    if (delBtn) delBtn.disabled = !canEdit;
    if (warnEl) {
      warnEl.style.display = canEdit ? 'none' : 'block';
      warnEl.textContent = '同じ商品IDの行が複数あります。行の特定には商品IDに加え行番号が必要なため、この行の編集はCSV再取込で行ってください';
    }
  }
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
/* 同定キーの拡張: 同一商品ID(数量2以上の落札等)で内容が完全一致する行が複数存在する場合、
 * cid(内容ハッシュ)だけでは一意に決まらない。CSV取込順(order)と、一覧を描画した時点の
 * 配列添字(_oi。appvRenderLedgerが各行に付与)を複合キーに加えることで、一覧のその行から
 * 開いた場合は一意特定できるようにする（同定キー = cid＋order＋添字）。
 * 一覧を経由せず _oi が無い呼び出し(明細方式以外の想定外経路)の場合はcidのみで判定し、
 * 候補が2件以上あれば従来通り安全側で編集・削除を拒否する。 */
function appvFindLocalRowIndex(t) {
  if (!t) return -1;
  const isSale = t.type === 'sale';
  const arrKey = isSale ? LS.sales : LS.purchases;
  const list = get(arrKey, []);
  if (!Array.isArray(list)) return -1;
  const targetCid = t._cid || appvClientIdOf(t, isSale ? 's' : 'p');
  const candidates = [];
  for (let i = 0; i < list.length; i++) {
    const cid = appvClientIdOf(list[i], isSale ? 's' : 'p');
    if (cid === targetCid) candidates.push(i);
  }
  if (candidates.length <= 1) return candidates.length === 1 ? candidates[0] : -1;
  // cidだけでは複数候補：order＋一覧添字(_oi)で絞り込む
  if (typeof t._oi === 'number') {
    const targetOrder = appvCsvOrder(t, t._oi + 1);
    const narrowed = candidates.filter((i) => appvCsvOrder(list[i], i + 1) === targetOrder);
    if (narrowed.length === 1) return narrowed[0];
  }
  // それでも一意に決まらない場合は安全側で編集・削除を拒否する（誤操作防止）
  return -1;
}

/* ---- 登録モーダル ----
 * モードは「明細」（旧UI手入力タブ互換・デフォルト）と「その他」（Phase Bの自由入力＋テンプレート）の2つ。 */
let appvModalMode = 'add'; // 'add' | 'edit'
let appvModalEditTarget = null; // 編集対象（appvOpenDrawerで開いた行）
let appvTxMode = 'meisai'; // 'meisai' | 'free'

function appvModalKindLabel(kind) { return kind === 'sale' ? '売上' : (kind === 'expense' ? '経費' : '仕入'); }

function appvSetTxMode(mode) {
  appvTxMode = mode;
  document.querySelectorAll('#txModeChoice .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  const meisaiForm = document.getElementById('txMeisaiForm');
  const freeForm = document.getElementById('txModalForm');
  if (meisaiForm) meisaiForm.style.display = mode === 'meisai' ? '' : 'none';
  if (freeForm) freeForm.style.display = mode === 'free' ? '' : 'none';
  const saveBtn = document.getElementById('txSaveBtn');
  if (mode === 'meisai') {
    if (saveBtn) saveBtn.textContent = '登録する';
    appvUpdateMeisaiLockWarn();
  } else if (saveBtn) {
    saveBtn.disabled = false;
    saveBtn.textContent = appvModalMode === 'edit' ? '更新する' : '登録する';
  }
}

function appvOpenModal(kind, opt) {
  opt = opt || {};
  appvModalMode = opt.mode || 'add';
  appvModalEditTarget = opt.editTarget || null;
  const modal = document.getElementById('txModalOverlay');
  if (!modal) return;

  // 編集の場合：明細方式の行(_meiId有り)は明細フォーム、それ以外は自由入力フォームを開く
  const isMeiEdit = appvModalMode === 'edit' && opt.editTarget && opt.editTarget._meiId;
  const mode = isMeiEdit ? 'meisai' : (opt.mode === 'edit' ? 'free' : (opt.mode2 || 'meisai'));
  // モード切替UIは新規登録時のみ操作可能（編集時は行の種類に固定）
  const modeChoiceWrap = document.getElementById('txModeChoice');
  if (modeChoiceWrap) modeChoiceWrap.style.display = appvModalMode === 'edit' ? 'none' : 'flex';
  appvSetTxMode(mode);

  document.getElementById('txModalTitle').textContent = (appvModalMode === 'edit' ? '編集: ' : '＋ 登録');

  if (mode === 'meisai') {
    if (isMeiEdit) {
      // 明細の編集は「削除して登録し直す」のではなく、フォームへ値を戻して保存時に上書きする
      appvSetMeisaiKind(opt.editTarget._meiKind);
      document.getElementById('txMeisaiDate').value = opt.editTarget.date || today();
      document.getElementById('txMeisaiAmount').value = opt.editTarget.amount || '';
      const sel = document.getElementById('txMeisaiPartnerSel');
      const newInp = document.getElementById('txMeisaiPartnerNew');
      appvRenderMeisaiPartnerSelect();
      if (sel && opt.editTarget.partner && Array.prototype.some.call(sel.options, (o) => o.value === opt.editTarget.partner)) {
        sel.value = opt.editTarget.partner;
        if (newInp) newInp.style.display = 'none';
      } else if (sel) {
        sel.value = '__new__';
        if (newInp) { newInp.style.display = ''; newInp.value = opt.editTarget.partner || ''; }
      }
      appvUpdateMeisaiLockWarn();
    } else {
      appvOpenMeisaiForm(kind === 'purchase' ? 'purchase' : 'sale');
    }
    modal.classList.add('show');
    return;
  }

  document.querySelectorAll('#txModalKind .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  appvSetModalKind(kind);
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
  if (appvTxMode === 'meisai') {
    if (appvModalMode === 'edit' && appvModalEditTarget && appvModalEditTarget._meiId) {
      appvUpdateMeisaiRow(appvModalEditTarget);
    } else {
      appvSaveMeisai();
    }
    return;
  }
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

/* 保存・更新・削除後の再描画（KPI・最近の取引・一覧を作り直す）
 * ＋クラウド同期の結果確認。pushSafeが失敗/不可の場合は明示的に警告する
 * （ローカルだけの保存は、旧UI起動時のhydrate(クラウド→ローカル置換)で消えるため危険） */
async function appvAfterWrite() {
  try {
    if (window.ribreStore && typeof window.ribreStore.pushSafe === 'function') {
      const r = await window.ribreStore.pushSafe();
      if (!r || r.ok === false) {
        appvToast('⚠ クラウド未同期です。通信状態を確認して、もう一度保存し直してください');
      }
    } else {
      appvToast('⚠ 同期エンジン未読込のためクラウド保存できません（この状態で保存した行は消える可能性があります）');
    }
  } catch (e) {
    appvToast('⚠ クラウド同期エラー: ' + e.message);
  }
  const month = appvViewMonth || appvCurrentMonth();
  await appvLoadMonth(month);
  await appvRenderKpi();
  appvRenderRecent();
  appvRenderLedger();
  const ledgerActive = document.querySelector('#ledgerTabs .tab.active');
  if (ledgerActive && ledgerActive.dataset.type === 'profit') await appvRenderProfit();
}

/* =====================================================================
 * 明細方式（旧UI app-simple.js「手入力」タブと完全互換）
 * ユーザーの日常入力は旧UIの「販売先を選択」「買取先を選択」プルダウン
 * ＋日付＋金額で、profit_meisai(localStorage ribre_smp_profit_meisai_v1/
 * Supabase app_settings skey='profit_meisai')に保存される（Phase Bの
 * addSale/addPurchase＝ribre_full_sales221系とは別ストア）。
 * 以下は旧UI(pages/app-simple.js)の同名関数と同一ロジックの移植。
 * 旧関数はDOM(手入力タブの実要素)に依存しているため直接は呼べず、
 * ロジックのみをこちらのDOM(txMeisai系)向けに移植している。
 * ===================================================================== */

/* ---- 月ロック（旧: app-simple.js smpIsMonthLocked と同一。ストアも同一） ---- */
function appvLockedMonthsGet() { try { return JSON.parse(localStorage.getItem('ribre_smp_locked_months') || '[]') || []; } catch (e) { return []; } }
function appvIsMonthLocked(m) { return appvLockedMonthsGet().indexOf(m) >= 0; }
/* 旧: smpLockedTsGet/Set・smpLockedMetaGet/Set（app-simple.js 120-124行目）と同一キー・同一形（B6で追加）。
   クラウド反映(appvLockedPushCloud)のために必要な、月ごとの最終操作時刻。 */
function appvLockedTsGet() { return Number(localStorage.getItem('ribre_smp_locked_ts') || 0) || 0; }
function appvLockedTsSet(t) { try { localStorage.setItem('ribre_smp_locked_ts', String(t || Date.now())); } catch (e) {} }
function appvLockedMetaGet() { try { return JSON.parse(localStorage.getItem('ribre_smp_locked_meta_v1') || '{}') || {}; } catch (e) { return {}; } }
function appvLockedMetaSet(o) { try { localStorage.setItem('ribre_smp_locked_meta_v1', JSON.stringify(o || {})); } catch (e) {} }
/* 旧: smpLockedMerge（app-simple.js 141-158行目）と同一（B6で追加）。 */
function appvLockedMerge(aArr, aMeta, aTs, bArr, bMeta, bTs) {
  const aSet = {}; (aArr || []).forEach((m) => { aSet[m] = 1; });
  const bSet = {}; (bArr || []).forEach((m) => { bSet[m] = 1; });
  const months = {};
  Object.keys(aSet).forEach((m) => { months[m] = 1; });
  Object.keys(bSet).forEach((m) => { months[m] = 1; });
  Object.keys(aMeta || {}).forEach((m) => { months[m] = 1; });
  Object.keys(bMeta || {}).forEach((m) => { months[m] = 1; });
  const outMeta = {}; const outArr = [];
  Object.keys(months).forEach((m) => {
    const ta = Number((aMeta && aMeta[m]) || (aSet[m] ? aTs : 0)) || 0;
    const tb = Number((bMeta && bMeta[m]) || (bSet[m] ? bTs : 0)) || 0;
    const useA = ta >= tb;
    const locked = useA ? !!aSet[m] : !!bSet[m];
    outMeta[m] = Math.max(ta, tb);
    if (locked) outArr.push(m);
  });
  return { arr: outArr.sort(), meta: outMeta };
}
/* 旧: smpLockedFetchCloud（app-simple.js 162-169行目）と同一（B6で追加）。 */
async function appvLockedFetchCloud(cr) {
  try {
    const r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.locked_months&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    const d = await r.json(); const c = d && d[0] && d[0].value;
    return (c && c.data) ? c : null;
  } catch (e) { return null; }
}
/* 旧: smpLockedPushCloud（app-simple.js 170-186行目）と同一（B6で追加。バックアップ復元後の反映漏れ対策）。 */
async function appvLockedPushCloud() {
  if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
  const cr = appvCreds(); if (!cr) return { ok: false, reason: 'no-login' };
  try {
    let body = { data: appvLockedMonthsGet(), _m: appvLockedMetaGet(), ts: appvLockedTsGet() };
    const cloud = await appvLockedFetchCloud(cr);
    if (cloud) {
      const merged = appvLockedMerge(appvLockedMonthsGet(), appvLockedMetaGet(), appvLockedTsGet(), cloud.data, cloud._m, cloud.ts || 0);
      appvLockedMetaSet(merged.meta);
      try { localStorage.setItem('ribre_smp_locked_months', JSON.stringify(merged.arr)); } catch (e) {}
      body = { data: merged.arr, _m: merged.meta, ts: Date.now() };
    }
    appvLockedTsSet(body.ts);
    const r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', { method: 'POST', headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ user_email: cr.em, skey: 'locked_months', value: body }]) });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/* ---- 明細ストア（旧: smpProfitMeiGet/Set と同一キー・同一形） ---- */
function appvMeiGet() {
  try { const o = JSON.parse(localStorage.getItem('ribre_smp_profit_meisai_v1') || '{}') || {}; o.sales = o.sales || []; o.purchases = o.purchases || []; return o; }
  catch (e) { return { sales: [], purchases: [] }; }
}
function appvMeiSet(o) { o.ts = Date.now(); try { localStorage.setItem('ribre_smp_profit_meisai_v1', JSON.stringify(o)); } catch (e) {} }

/* ---- クラウドへの明細プッシュ（旧: smpProfitMeiPushCloud と同一の行単位マージ同期） ---- */
async function appvMeiFetchCloud(cr) {
  try {
    const r = await fetch(cr.url + '/rest/v1/app_settings?select=value&user_email=eq.' + encodeURIComponent(cr.em) + '&skey=eq.profit_meisai&limit=1', { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
    if (!r.ok) return null;
    const data = await r.json();
    const cloud = data && data[0] && data[0].value;
    return (cloud && typeof cloud === 'object') ? cloud : null;
  } catch (e) { return null; }
}
/* 旧: smpMeiMergeLists/smpMeiMerge と同一のマージ規則（行単位・up時刻優先・tomb墓標で削除維持） */
function appvMeiMergeLists(aList, bList, tomb) {
  const byId = {};
  const addAll = (list) => (list || []).forEach((r) => {
    if (!r || r.id == null) return;
    const id = String(r.id);
    const up = Number(r.up || 0) || 0;
    const cur = byId[id];
    if (!cur || up >= (Number(cur.up || 0) || 0)) byId[id] = r;
  });
  addAll(aList); addAll(bList);
  const out = [];
  Object.keys(byId).forEach((id) => {
    const delAt = Number((tomb || {})[id] || 0);
    if (delAt && delAt >= (Number(byId[id].up || 0) || 0)) return;
    out.push(byId[id]);
  });
  out.sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || ((Number(y.up || 0) || 0) - (Number(x.up || 0) || 0)));
  return out;
}
function appvMeiMerge(a, b) {
  a = a || {}; b = b || {};
  const tomb = {};
  [a.tomb, b.tomb].forEach((t) => { if (t && typeof t === 'object') Object.keys(t).forEach((k) => { tomb[k] = Math.max(Number(tomb[k] || 0), Number(t[k] || 0)); }); });
  const lim = Date.now() - 180 * 24 * 3600 * 1000;
  Object.keys(tomb).forEach((k) => { if (tomb[k] < lim) delete tomb[k]; });
  return {
    sales: appvMeiMergeLists(a.sales, b.sales, tomb),
    purchases: appvMeiMergeLists(a.purchases, b.purchases, tomb),
    tomb: tomb,
    ts: Math.max(Number(a.ts || 0), Number(b.ts || 0))
  };
}
async function appvMeiPushCloud() {
  if (window.__ribreSessionLost) return { ok: false, reason: 'session-lost' };
  const cr = appvCreds(); if (!cr) return { ok: false, reason: 'no-login' };
  try {
    let body = appvMeiGet();
    const cloud = await appvMeiFetchCloud(cr);
    if (cloud) {
      body = appvMeiMerge(appvMeiGet(), cloud);
      try { localStorage.setItem('ribre_smp_profit_meisai_v1', JSON.stringify(body)); } catch (e) {}
    }
    body.ts = Date.now();
    const r = await fetch(cr.url + '/rest/v1/app_settings?on_conflict=user_email,skey', {
      method: 'POST',
      headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ user_email: cr.em, skey: 'profit_meisai', value: body }])
    });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, reason: e.message }; }
}

/* ---- 販売先／買取先の一覧（旧: smpPartnersGet/Add/smpPartnerOptions と同一キー ribre_smp_partners_v1） ---- */
function appvPartnersGet() { try { const o = JSON.parse(localStorage.getItem('ribre_smp_partners_v1') || '{}') || {}; o.sales = o.sales || []; o.purchases = o.purchases || []; return o; } catch (e) { return { sales: [], purchases: [] }; } }
function appvPartnersSet(o) { try { localStorage.setItem('ribre_smp_partners_v1', JSON.stringify(o)); } catch (e) {} }
function appvPartnersAdd(kind, name) {
  name = String(name || '').trim(); if (!name) return;
  const o = appvPartnersGet(); const k = (kind === 'sale') ? 'sales' : 'purchases';
  if (o[k].indexOf(name) < 0) { o[k].push(name); o[k].sort((a, b) => String(a).localeCompare(String(b), 'ja')); appvPartnersSet(o); }
}
/* 選択肢は「明細ストアに登場した名前」∪「登録先マスタ(ribre_smp_partners_v1)」の和集合（旧UIと同じ規則） */
function appvPartnerOptions(kind) {
  const store = appvMeiGet();
  const arr = (kind === 'sale') ? (store.sales || []) : (store.purchases || []);
  const names = {};
  arr.forEach((e) => { const n = String(e.name || '').trim(); if (n) names[n] = 1; });
  const master = appvPartnersGet();
  (kind === 'sale' ? master.sales : master.purchases).forEach((n) => { n = String(n || '').trim(); if (n) names[n] = 1; });
  return Object.keys(names).sort((a, b) => a.localeCompare(b, 'ja'));
}

/* ---- 明細フォームの状態 ---- */
let appvMeiKind = 'sale'; // 'sale' | 'purchase'

function appvMeiEsc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function appvRenderMeisaiPartnerSelect() {
  const sel = document.getElementById('txMeisaiPartnerSel');
  if (!sel) return;
  const keep = sel.value;
  const opts = appvPartnerOptions(appvMeiKind);
  sel.innerHTML = '<option value="">（' + (appvMeiKind === 'sale' ? '販売先を選択' : '買取先を選択') + '）</option>' +
    opts.map((n) => '<option value="' + appvMeiEsc(n) + '">' + appvMeiEsc(n) + '</option>').join('') +
    '<option value="__new__">＋ 新しい相手先</option>';
  if (keep && (keep === '__new__' || opts.indexOf(keep) >= 0)) sel.value = keep;
}
function appvMeiPartnerSelChange() {
  const sel = document.getElementById('txMeisaiPartnerSel');
  const inp = document.getElementById('txMeisaiPartnerNew');
  if (!sel || !inp) return;
  if (sel.value === '__new__') { inp.style.display = ''; inp.value = ''; try { inp.focus(); } catch (e) {} }
  else { inp.style.display = 'none'; inp.value = ''; }
}
function appvSetMeisaiKind(kind) {
  appvMeiKind = kind;
  document.querySelectorAll('#txMeisaiKind .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  const label = document.getElementById('txMeisaiPartnerLabel');
  if (label) label.textContent = kind === 'sale' ? '販売先を選択' : '買取先を選択';
  appvRenderMeisaiPartnerSelect();
  appvUpdateMeisaiLockWarn();
}
function appvUpdateMeisaiLockWarn() {
  const dateEl = document.getElementById('txMeisaiDate');
  const month = (dateEl && dateEl.value) ? dateEl.value.slice(0, 7) : appvCurrentMonth();
  const locked = appvIsMonthLocked(month);
  const warn = document.getElementById('txMeisaiLockWarn');
  if (warn) warn.style.display = locked ? 'block' : 'none';
  const saveBtn = document.getElementById('txSaveBtn');
  if (saveBtn && document.getElementById('txModeChoice').querySelector('.choice-btn.active').dataset.mode === 'meisai') {
    saveBtn.disabled = locked;
  }
  return locked;
}
function appvOpenMeisaiForm(kind) {
  document.querySelectorAll('#txMeisaiKind .choice-btn').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
  appvMeiKind = kind || 'sale';
  const dateEl = document.getElementById('txMeisaiDate');
  const amtEl = document.getElementById('txMeisaiAmount');
  const sel = document.getElementById('txMeisaiPartnerSel');
  const newInp = document.getElementById('txMeisaiPartnerNew');
  if (dateEl) dateEl.value = today();
  if (amtEl) amtEl.value = '';
  if (sel) sel.value = '';
  if (newInp) { newInp.value = ''; newInp.style.display = 'none'; }
  const label = document.getElementById('txMeisaiPartnerLabel');
  if (label) label.textContent = appvMeiKind === 'sale' ? '販売先を選択' : '買取先を選択';
  appvRenderMeisaiPartnerSelect();
  appvUpdateMeisaiLockWarn();
}

/* ---- 明細の保存（旧: smpProfitAddSale/smpProfitAddPurchase と同一のオブジェクト形・同一の保存先・同期） ---- */
async function appvSaveMeisai() {
  const kind = appvMeiKind;
  const sel = document.getElementById('txMeisaiPartnerSel');
  const newInp = document.getElementById('txMeisaiPartnerNew');
  const partner = (sel && sel.value && sel.value !== '__new__') ? sel.value : ((newInp && newInp.value) || '').trim();
  const date = document.getElementById('txMeisaiDate').value || today();
  const amt = num(document.getElementById('txMeisaiAmount').value || 0);
  if (!partner) { alert((kind === 'sale' ? '販売先' : '買取先') + 'を選択または入力してください'); return; }
  if (!amt) { alert('金額を入力してください'); return; }
  const month = date.slice(0, 7);
  if (appvIsMonthLocked(month)) { alert('この月（' + month + '）はロックされています。登録できません。'); return; }

  appvPartnersAdd(kind, partner);
  const mei = appvMeiGet();
  const key = kind === 'sale' ? 'sales' : 'purchases';
  const prefix = kind === 'sale' ? 's_' : 'p_';
  mei[key].unshift({ id: prefix + Date.now() + '_' + Math.floor(Math.random() * 1e6), date: date, month: month, name: partner, amount: amt, up: Date.now() });
  appvMeiSet(mei);

  appvCloseModal();
  appvToast('✅ ' + (kind === 'sale' ? '売上明細' : '仕入明細') + 'を登録しました');
  const r = await appvMeiPushCloud();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
  else appvToast('⚠ クラウド未同期です。通信状態を確認して、もう一度保存し直してください');
  await appvAfterWrite();
}

/* ---- 明細行の編集（旧UIには編集機能自体が無い＝削除＋再登録のみだが、
 * 新UIでは行を直接書き換える。id/upを保持しつつ内容を更新し、行単位マージ
 * (appvMeiMerge)の対象になれるよう up(更新時刻)を現在時刻に更新する。
 * 保存前後どちらの月もロックされていれば拒否する（月をまたぐ編集で
 * ロック月へ移動する／ロック月から動かす、をどちらも防止）。 ---- */
async function appvUpdateMeisaiRow(target) {
  const kind = target._meiKind;
  const key = kind === 'sale' ? 'sales' : 'purchases';
  const sel = document.getElementById('txMeisaiPartnerSel');
  const newInp = document.getElementById('txMeisaiPartnerNew');
  const partner = (sel && sel.value && sel.value !== '__new__') ? sel.value : ((newInp && newInp.value) || '').trim();
  const date = document.getElementById('txMeisaiDate').value || today();
  const amt = num(document.getElementById('txMeisaiAmount').value || 0);
  if (!partner) { alert((kind === 'sale' ? '販売先' : '買取先') + 'を選択または入力してください'); return; }
  if (!amt) { alert('金額を入力してください'); return; }
  const newMonth = date.slice(0, 7);
  if (target._locked || appvIsMonthLocked(newMonth)) { alert('ロックされている月のため編集できません。'); return; }

  appvPartnersAdd(kind, partner);
  const mei = appvMeiGet();
  const idx = (mei[key] || []).findIndex((e) => String(e.id) === String(target._meiId));
  if (idx < 0) { alert('編集対象の明細が見つかりませんでした'); return; }
  mei[key][idx] = Object.assign({}, mei[key][idx], { date: date, month: newMonth, name: partner, amount: amt, up: Date.now() });
  appvMeiSet(mei);

  appvCloseModal();
  appvCloseDrawer();
  appvToast('✅ 明細を更新しました');
  const r = await appvMeiPushCloud();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
  else appvToast('⚠ クラウド未同期です。通信状態を確認して、もう一度保存し直してください');
  await appvAfterWrite();
}

/* ---- 明細行の削除（旧: smpProfitDeleteRow と同一。tombで他端末の復活を防止。月ロック中は不可） ---- */
async function appvDeleteMeisaiRow(kind, id) {
  if (!id) return;
  const key = kind === 'sale' ? 'sales' : 'purchases';
  const mei = appvMeiGet();
  const row = (mei[key] || []).find((e) => String(e.id) === String(id));
  const month = row ? (row.month || String(row.date || '').slice(0, 7)) : '';
  if (month && appvIsMonthLocked(month)) { alert('この月（' + month + '）はロックされています。削除できません。'); return; }
  if (!confirm('この明細を削除します。よろしいですか？')) return;
  const before = (mei[key] || []).length;
  mei[key] = (mei[key] || []).filter((e) => String(e.id) !== String(id));
  if (mei[key].length !== before) {
    mei.tomb = (mei.tomb && typeof mei.tomb === 'object') ? mei.tomb : {};
    mei.tomb[String(id)] = Date.now();
    appvMeiSet(mei);
  }
  appvToast('🗑 明細を削除しました');
  const r = await appvMeiPushCloud();
  if (r && r.ok) appvToast('☁ クラウドに同期しました');
  await appvAfterWrite();
  appvCloseDrawer();
}

/* =====================================================================
 * Phase C — 取込画面（ヤフオクCSV・配送照合・メール取込状況）
 * 旧UI(pages/app-shipping.js)のパーサ・保存先・照合ロジックを移植する。
 * 旧関数(importYahooSalesCsv/importShippingCsv/matchShipping)はDOM
 * (index.htmlの旧「取り込み」タブの実要素・ySet/yRenderのステータス表示等)
 * に依存しており直接は呼べないため、パーサ・マージ・照合部分のみを
 * こちらのDOM(imp系)向けに移植している。保存先(localStorageキー)・
 * マージ規則は完全に同一なので、旧UIから見ても取り込んだデータは同じ形。
 * ===================================================================== */

/* ---- CSV文字列パース（旧: pages/app-shipping.js yCsvLine/yParseCsv と同一） ---- */
function appvYCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function appvYParseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  return text.split(/\r?\n/).filter((x) => x.trim()).map(appvYCsvLine);
}
function appvYFindIndex(headers, patterns, fallback) {
  for (const p of patterns) {
    const idx = headers.findIndex((h) => String(h || '').includes(p));
    if (idx >= 0) return idx;
  }
  return fallback;
}
function appvYItemId(v) {
  const m = String(v || '').match(/[a-z]?\d{9,12}/i);
  return m ? m[0] : '';
}
function appvYNum(v) {
  const n = Number(String(v == null ? '' : v).replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function appvYDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return s || today();
}
/* 文字化け判定（旧: pages/app-shipping.js 543-546行目 isGarbled と同一。空文字・置換文字（�）・文字化け時の□含みを判定） */
function appvYIsGarbled(s) {
  const v = String(s || '');
  return !v || v.includes('�') || v.includes('□');
}
/* 保存先(旧: yRows/ySave と同一キー ribre_yahoo_sales240。ySaveと同様にribre_full_sales221(LS.sales)にも反映) */
function appvYRows() { try { return JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]') || []; } catch (e) { return []; } }
function appvYSave(arr) {
  const data = arr.slice(0, 20000);
  localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(data));
  setLS(LS.sales, data);
}
/* 並び順（旧: Y_SALES_ACCOUNT_ORDER/yAccountRank/ySortImportedSalesRows と同一） */
const APPV_Y_SALES_ACCOUNT_ORDER = ['ヤフオク1', 'ヤフオク2', 'ヤフオク3', 'ヤフオク4', 'ヤフオク5', 'ヤフオク6', 'ヤフオク7', 'ヤフオク8', 'メルカリShops'];
function appvYAccountRank(name) {
  const z = '０１２３４５６７８９';
  const normalized = String(name || '').replace(/[０-９]/g, (ch) => String(z.indexOf(ch))).replace(/\s+/g, '');
  const idx = APPV_Y_SALES_ACCOUNT_ORDER.indexOf(normalized);
  return idx >= 0 ? idx : 999;
}
function appvYSortImportedSalesRows(rows) {
  return (rows || []).map((row, idx) => ({ row, idx })).sort((a, b) => {
    const accountDiff = appvYAccountRank(a.row.shop) - appvYAccountRank(b.row.shop);
    if (accountDiff) return accountDiff;
    const ao = Number(a.row.order);
    const bo = Number(b.row.order);
    const orderDiff = (Number.isFinite(ao) && ao > 0 ? ao : a.idx + 1) - (Number.isFinite(bo) && bo > 0 ? bo : b.idx + 1);
    if (orderDiff) return orderDiff;
    return a.idx - b.idx;
  }).map((x) => x.row);
}

/* ---- 通常モードの締め月保護（旧: services/app-main-v2.js isMonthClosed 15-18行目 と同一ロジック） ----
 * [LOCK]メモタグ方式：対象月に1件以上sales行があり、かつ全行のmemoに"[LOCK]"を含む場合に締め済みとみなす。
 * services/app-main-v2.js（かんたんモードのダッシュボード）はapp.htmlでは読み込まれておらず
 * window.isMonthClosed が存在しないため、同一ロジックをappv側にも移植して直接使えるようにする。
 * ローカルのsales()を対象にする点も旧実装と同じ（Supabase上の値は見ない）。 */
function appvIsMonthClosed(vm) {
  const rows = sales().filter((x) => (x.month || String(x.date || '').slice(0, 7)) === vm);
  return rows.length > 0 && rows.every((x) => String(x.memo || '').includes('[LOCK]'));
}
/* CSV取込行（{month,...}の配列）の中に締め済み月への行が含まれていれば、旧UIと同じ文言でconfirm()し、
 * キャンセルされたら true（中止すべき）を返す。旧: pages/app-shipping.js 697-705行目と同一の確認文言・挙動。 */
function appvConfirmClosedMonthsOrCancel(rowsWithMonth) {
  const closedMonths = Array.from(new Set(rowsWithMonth.map((r) => r.month).filter((m) => m && appvIsMonthClosed(m))));
  if (!closedMonths.length) return false;
  return !confirm('締め済みの月（' + closedMonths.join(', ') + '）へのデータが含まれています。取り込みを続行しますか？');
}

/* =====================================================================
 * 月締めチェックリスト（Phase D。台帳・設定ページ）
 * 「月締めを完了する」の実処理は旧UI services/app-main-v2.js closeMonth（19-35行目）と
 * 同一（対象月のsales行のmemoへ[LOCK]タグを付与）。appvIsMonthClosedが判定に使う
 * ロジックと表裏一体。実行前に必ずcreateLocalSnapshotでスナップショットを取る。
 * ===================================================================== */
function appvCloseChecklistMonth() {
  const sel = document.getElementById('closeMonthSel');
  if (sel && sel.value) return sel.value;
  return appvPrevMonth(appvCurrentMonth());
}
/* 対象月のCSV取込行（appvYRows/sales）からitemIdを集め、配送照合結果(ribre_shipping_results230)の
 * 該当行のうちstatus==='未一致'を数える（旧: appvShipUnmatchCount 409-414行目を月フィルタ付きに拡張）。 */
function appvShipUnmatchCountForMonth(month) {
  try {
    const salesAll = get(LS.sales, []);
    const idsInMonth = new Set((Array.isArray(salesAll) ? salesAll : [])
      .filter((r) => appvMonthOfLocal(r) === month && r.itemId)
      .map((r) => String(r.itemId)));
    if (!idsInMonth.size) return 0;
    const rows = JSON.parse(localStorage.getItem('ribre_shipping_results230') || '[]') || [];
    return (Array.isArray(rows) ? rows : []).filter((r) => r.status === '未一致' && idsInMonth.has(String(r.itemId))).length;
  } catch (e) { return 0; }
}
/* mf_evidenceのcreated_atが対象月内かで絞り込んで件数を数える（coverageと違い月内の証憑件数を見る用途）。 */
async function appvFetchEvidenceCountInMonth(query, month) {
  const from = month + '-01T00:00:00';
  const to = appvMonthLastDay(month) + 'T23:59:59';
  return appvFetchEvidenceCount(query + '&created_at=gte.' + encodeURIComponent(from) + '&created_at=lte.' + encodeURIComponent(to));
}
async function appvFetchCoveragePct(month) {
  try {
    const cr = appvCreds();
    if (!cr) return null;
    const r = await fetch('/api/mf/coverage?month=' + encodeURIComponent(month), { headers: { Authorization: 'Bearer ' + (cr.tok || '') } });
    if (!r.ok) return null;
    const d = await r.json();
    return (d && d.ok) ? d.coverage_pct : null;
  } catch (e) { return null; }
}
function appvChecklistRow(icon, ok, label, actionLabel, onAction) {
  const row = document.createElement('div');
  row.className = 'check-row';
  const left = document.createElement('div');
  left.className = 'check-left';
  const ic = document.createElement('span');
  ic.className = 'check-ic';
  ic.textContent = ok == null ? '…' : (ok ? '✅' : '⚠️');
  const txt = document.createElement('span');
  txt.textContent = label;
  left.appendChild(ic);
  left.appendChild(txt);
  row.appendChild(left);
  if (!ok && actionLabel && onAction) {
    const btn = document.createElement('button');
    btn.className = 'btn sm';
    btn.textContent = actionLabel;
    btn.addEventListener('click', onAction);
    row.appendChild(btn);
  } else if (ok != null) {
    const badge = document.createElement('span');
    badge.className = 'badge ' + (ok ? 'ok' : 'warn');
    badge.textContent = ok ? '✓' : '未完了';
    row.appendChild(badge);
  }
  return row;
}
async function appvRenderCloseChecklist() {
  const wrap = document.getElementById('closeChecklist');
  const closeBtn = document.getElementById('closeMonthBtn');
  const reopenBtn = document.getElementById('reopenMonthBtn');
  const statusEl = document.getElementById('closeMonthStatus');
  if (!wrap) return;
  const sel = document.getElementById('closeMonthSel');
  if (sel && !sel.value) sel.value = appvCloseChecklistMonth();
  const month = appvCloseChecklistMonth();
  appvClear(wrap);

  const coveragePct = await appvFetchCoveragePct(month);
  const coverageOk = coveragePct == null ? null : coveragePct >= 100;
  const matchingPending = await appvFetchEvidenceCountInMonth('?select=id&status=eq.box_saved', month);
  const boxTodo = await appvFetchEvidenceCountInMonth('?select=id&box_meta_done=is.false&status=in.(box_saved,attached)', month);
  const shipUnmatch = appvShipUnmatchCountForMonth(month);
  const closed = appvIsMonthClosed(month);

  wrap.appendChild(appvChecklistRow('📎', coverageOk, '証憑カバー率' + (coveragePct != null ? '（' + coveragePct + '%）' : '（取得不可）'), '証憑ページへ', () => { window.location.href = '/mf-evidence?from=app'; }));
  wrap.appendChild(appvChecklistRow('🔗', matchingPending === 0, 'マッチング未処理（' + (matchingPending == null ? '?' : matchingPending) + '件）', '証憑ページへ', () => { window.location.href = '/mf-evidence?from=app'; }));
  wrap.appendChild(appvChecklistRow('📋', boxTodo === 0, 'Box入力待ち（' + (boxTodo == null ? '?' : boxTodo) + '件）', '証憑ページへ', () => { window.location.href = '/mf-evidence?from=app'; }));
  wrap.appendChild(appvChecklistRow('🚚', shipUnmatch === 0, '配送照合の不一致（' + shipUnmatch + '件）', '取込ページへ', () => appvGotoPage('import')));
  wrap.appendChild(appvChecklistRow('🔒', closed, '締め状態: ' + (closed ? '締め済み' : '未締め'), null, null));

  const allOk = coverageOk !== false && matchingPending === 0 && boxTodo === 0 && shipUnmatch === 0;
  if (closeBtn) {
    closeBtn.disabled = closed || !allOk;
    closeBtn.style.display = closed ? 'none' : 'inline-block';
  }
  if (reopenBtn) reopenBtn.style.display = closed ? 'inline-block' : 'none';
  if (statusEl) statusEl.textContent = closed ? '✅ ' + appvMonthLabel(month) + 'は締め済みです' : (allOk ? '全項目クリア。月締めを完了できます' : '未完了の項目があります');
}
/* 月締め実行（旧: services/app-main-v2.js closeMonth 19-35行目と同一処理）。
 * 対象月のsales行のmemoへ[LOCK]を付与。実行前にcreateLocalSnapshotでスナップショットを取る。 */
function appvCloseMonth() {
  const month = appvCloseChecklistMonth();
  const p = month.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  if (!confirm(label + 'のデータをすべてロックします。よろしいですか？')) return;
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv closeMonth ' + month); } catch (e) {}
  const s = sales();
  let changed = 0;
  s.forEach((x, idx) => {
    if ((x.month || String(x.date || '').slice(0, 7)) !== month) return;
    const memo = String(x.memo || '').trim();
    if (memo.includes('[LOCK]')) return;
    s[idx].memo = memo ? memo + ' / [LOCK]' : '[LOCK]';
    changed++;
  });
  if (changed > 0) {
    setLS(LS.sales, s);
    appvToast('✅ ' + label + 'を月締めしました（' + changed + '件）');
    appvRenderCloseChecklist();
    appvRenderHomeClosedBadge();
    if (window.ribreStore && window.ribreStore.pushSafe) window.ribreStore.pushSafe();
  } else {
    appvToast('対象行がないか、すでにすべてロック済みです');
  }
}
/* 締め解除（旧: services/app-main-v2.js openMonth 36-52行目と同一処理。[LOCK]タグ除去）。 */
function appvReopenMonth() {
  const month = appvCloseChecklistMonth();
  const p = month.split('-');
  const label = p[0] + '年' + Number(p[1]) + '月';
  if (!confirm(label + 'の締めを解除します。よろしいですか？')) return;
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv reopenMonth ' + month); } catch (e) {}
  const s = sales();
  let changed = 0;
  s.forEach((x, idx) => {
    if ((x.month || String(x.date || '').slice(0, 7)) !== month) return;
    const memo = String(x.memo || '');
    if (!memo.includes('[LOCK]')) return;
    s[idx].memo = memo.replace(/\s*\/\s*\[LOCK\]/g, '').replace(/\[LOCK\]\s*\/\s*/g, '').replace('[LOCK]', '').trim();
    changed++;
  });
  if (changed > 0) {
    setLS(LS.sales, s);
    appvToast('✅ ' + label + 'の締めを解除しました（' + changed + '件）');
    appvRenderCloseChecklist();
    appvRenderHomeClosedBadge();
    if (window.ribreStore && window.ribreStore.pushSafe) window.ribreStore.pushSafe();
  } else {
    appvToast('ロック済みの行がありません');
  }
}
/* ホームKPIに現在表示中の月が締め済みなら🔒バッジを出す */
function appvRenderHomeClosedBadge() {
  const badge = document.getElementById('homeClosedBadge');
  if (!badge) return;
  const month = appvViewMonth || appvCurrentMonth();
  badge.style.display = appvIsMonthClosed(month) ? 'inline-flex' : 'none';
}

/* ---- 売上CSV取込（旧: importYahooSalesCsv と同一ロジック。DOM依存部分のみ引数化） ----
 * 戻り値: { added, patched, skipped, total } */
function appvImportYahooCsv(file, csvText, account, forceMonth) {
  const isYahoo = account.startsWith('ヤフオク');
  const rows = appvYParseCsv(csvText);
  if (!rows.length || rows.length === 1) return { error: rows.length ? 'ヘッダー行のみでした' : 'CSVが空です' };
  const h = rows[0];
  const isMercariShops = account === 'メルカリShops';
  const idxId = isYahoo ? appvYFindIndex(h, ['商品ID', 'オークションID', '管理番号'], 0) : isMercariShops ? 0 : appvYFindIndex(h, ['注文番号', '商品ID', '管理番号'], 0);
  const idxDate = isMercariShops ? 6 : appvYFindIndex(h, ['完了日', '落札日', '終了日時', '取扱日'], 1);
  const idxName = appvYFindIndex(h, ['商品名', 'タイトル', '取扱内容'], 2);
  const idxAmount = isMercariShops ? 12 : appvYFindIndex(h, ['決済金額', '落札価格', '売上金額', '合計'], 3);
  const idxFee = isYahoo ? appvYFindIndex(h, ['落札システム利用料', '手数料'], 4) : isMercariShops ? 15 : appvYFindIndex(h, ['手数料'], 4);
  const idxShip = appvYFindIndex(h, ['送料'], 5);
  const idxStatus = appvYFindIndex(h, ['状態', 'ステータス'], 6);
  const idxPay = appvYFindIndex(h, ['支払方法', '決済方法'], 7);

  const old = appvYRows();
  const seen = new Set(old.map((x) => x.itemId));
  let imported = 0, skipped = 0, patched = 0;
  const added = [];

  rows.slice(1).forEach((r, i) => {
    const csvOrder = i + 1;
    const rawId = String(r[idxId] || '').trim();
    const itemId = isYahoo ? appvYItemId(r[idxId] || r.join(' ')) : (rawId || appvYItemId(r.join(' ')));
    if (!itemId) { skipped++; return; }
    const status = String(r[idxStatus] || '');
    const pay = String(r[idxPay] || '');
    if (status.includes('受取連絡待ち') || /キャンセル|cancel/i.test(status) || pay.includes('現金振り込み')) { skipped++; return; }
    const amount = appvYNum(r[idxAmount]);
    const rawDateVal = String(r[idxDate] || '');
    const dateStr = (isMercariShops && !/\d{4}[\/\-年]\d{1,2}/.test(rawDateVal)) ? today() : appvYDate(rawDateVal);

    if (seen.has(itemId)) {
      // 既存(重複)：金額・送料・手数料などの空欄だけ補完する（旧: pages/app-shipping.js 578-635行目と同一の「補完更新」規則）
      const existing = old.find((x) => x.itemId === itemId);
      if (existing) {
        const csvFee = appvYNum(r[idxFee]);
        const csvShipping = appvYNum(r[idxShip]);
        const csvSettleAmount = appvYNum(r[idxAmount]);
        const csvName = r[idxName] || '';
        let touched = false;
        if (account && existing.shop !== account) { existing.shop = account; touched = true; }
        if (forceMonth && existing.month !== forceMonth) {
          existing.month = forceMonth;
          existing.date = forceMonth + '-' + (/^\d{4}-\d{2}-(\d{2})/.test(String(existing.date || '')) ? String(existing.date).slice(8, 10) : '01');
          touched = true;
        }
        if (existing.order !== csvOrder) { existing.order = csvOrder; touched = true; }
        if (!Number(existing.fee) && csvFee) { existing.fee = csvFee; touched = true; }
        // 手入力送料の巻き戻り防止（旧: app-shipping.js 596-608行目 wasManualShip と同一ロジック）。
        // 手入力または配送CSV未一致のまま送料が入っている行は「手入力扱い」とし、
        // 再取込CSVに送料が無ければ売上CSV取込直後の状態(未一致・送料0)へ戻す。
        const statusText = [existing.matchStatus, existing.memo].map((v) => String(v || '')).join(' ');
        const hasShipEvidence = !!(existing.slip || existing.invoiceNo || existing.deliveryCompany);
        const isMatchedShip = /配送CSV一致|配送一致|匿名配送|匿名/.test(statusText) || hasShipEvidence;
        const wasManualShip = String(existing.matchStatus || '') === '手入力' || (Number(existing.shipping || existing.ship || 0) > 0 && !isMatchedShip);
        if (wasManualShip && !csvShipping) {
          existing.shipping = 0;
          existing.ship = 0;
          existing.slip = '';
          existing.invoiceNo = '';
          existing.deliveryCompany = '';
          existing.matchStatus = '売上CSV取込';
          touched = true;
        }
        if (!Number(existing.shipping) && csvShipping) { existing.shipping = csvShipping; existing.ship = csvShipping; touched = true; }
        // settleAmount補完（旧: app-shipping.js 614行目と同一）
        if (!Number(existing.settleAmount) && csvSettleAmount) { existing.settleAmount = csvSettleAmount; touched = true; }
        // 文字化け修復（旧: app-shipping.js 543-546,615-619行目 isGarbled と同一。name/memoが文字化けまたは空なら再取込CSVの値で上書き）
        if (csvName && appvYIsGarbled(existing.name)) { existing.name = csvName; touched = true; }
        if (appvYIsGarbled(existing.memo)) {
          existing.memo = (isYahoo ? 'ヤフオク売上CSV' : account + '売上CSV') + ' / ' + file.name;
          touched = true;
        }
        // Mercari Shops 日付/金額backfill（旧: app-shipping.js 620-630行目と同一。日付が未確定または金額0のときのみ補完）
        if (isMercariShops) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(existing.date || ''))) {
            existing.date = dateStr;
            existing.month = dateStr.slice(0, 7);
            touched = true;
          }
          if (!Number(existing.amount || 0) && Number(amount)) {
            existing.amount = amount;
            touched = true;
          }
        }
        if (touched) { existing.profit = Number(existing.amount || existing.price || 0) - Number(existing.fee || 0) - Number(existing.shipping || 0); patched++; }
      }
      skipped++;
      return;
    }

    const fee = appvYNum(r[idxFee]);
    const shipping = appvYNum(r[idxShip]);
    const effMonth = forceMonth || dateStr.slice(0, 7);
    const effDate = forceMonth ? (forceMonth + '-' + (/^\d{4}-\d{2}-(\d{2})/.test(dateStr) ? dateStr.slice(8, 10) : '01')) : dateStr;
    const row = {
      id: itemId, itemId: itemId, date: effDate, month: effMonth, shop: account,
      name: r[idxName] || '', amount: amount, price: amount, fee: fee, shipping: shipping, ship: shipping,
      profit: amount - fee - shipping, slip: '', deliveryCompany: '', matchStatus: '売上CSV取込',
      memo: (isYahoo ? 'ヤフオク売上CSV' : account + '売上CSV') + ' / ' + file.name,
      source: 'YahooCSV Ver60.0', order: csvOrder
    };
    added.push(row);
    seen.add(itemId);
    imported++;
  });

  if (added.length === 0 && patched === 0) return { error: '取込できる行がありませんでした（重複またはCSV形式をご確認ください）' };

  // 0円行が半数超の異常検知（旧: pages/app-shipping.js 678-686行目と同一の確認・文言）
  if (added.length > 0) {
    const zeroAmt = added.filter((r) => !r.amount).length;
    if (zeroAmt > added.length * 0.5) {
      if (!confirm('金額が0円の行が多いです（' + zeroAmt + '件）。CSV列がずれている可能性があります。続行しますか？')) {
        return { error: 'CSV取込を中止しました（金額0円の行が多いため）' };
      }
    }
  }
  // 日付不明行が7割超の異常検知（旧: pages/app-shipping.js 687-696行目と同一の確認・文言。Mercari Shopsは対象外）
  if (!isMercariShops && added.length > 3) {
    const todayStr = today();
    const badDates = added.filter((r) => r.date === todayStr).length;
    if (badDates > added.length * 0.7) {
      if (!confirm('日付を確認できない行が多いです（' + badDates + '件）。CSV列がずれている可能性があります。続行しますか？')) {
        return { error: 'CSV取込を中止しました（日付不明の行が多いため）' };
      }
    }
  }

  // 通常モードの締め月保護（旧: pages/app-shipping.js 697-705行目と同一の確認）。
  // キャンセルされたら取込を中止する（かんたんモードのロック月保護とは別の、通常モード[LOCK]メモタグ方式の保護）。
  if (added.length > 0 && appvConfirmClosedMonthsOrCancel(added)) {
    return { error: '締め済み月のため取込を中止しました' };
  }

  // 月ロック保護（旧: smpLockProtectAfterImport と同じ規則。ロック月の既存行は取込前の状態へ戻す）
  const lockedMonths = appvLockedMonthsGet();
  let revertedCount = 0;
  let finalAdded = added, finalOld = old;
  if (lockedMonths.length) {
    const lset = {}; lockedMonths.forEach((m) => { lset[m] = 1; });
    finalAdded = added.filter((r) => !lset[r.month]);
    revertedCount = added.length - finalAdded.length;
  }
  const merged = appvYSortImportedSalesRows(finalOld.concat(finalAdded));
  appvYSave(merged);
  return { added: finalAdded.length, patched: patched, skipped: skipped, total: merged.length, reverted: revertedCount };
}

/* ---- 配送CSVパース・照合（旧: pages/app-shipping.js parseCsv/detectShipType/importShippingCsv/matchShipping と同一ロジック） ---- */
function appvParseCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; continue; }
    if (ch === '"') { q = !q; continue; }
    if (ch === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function appvParseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  return text.split(/\r?\n/).filter((x) => x.trim()).map(appvParseCsvLine);
}
function appvNormalizeSlip(v) {
  return String(v || '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[-\s]/g, '').trim();
}
function appvExtractItemId(v) {
  const s = String(v || '').trim();
  const order = s.match(/order_[A-Za-z0-9]+/);
  if (order) return order[0];
  const m = s.match(/[a-z]?\d{9,12}/i);
  if (m) return m[0];
  if (s.length >= 8) return s;
  return '';
}
function appvShipNormId(v) {
  return String(v == null ? '' : v).replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[Ａ-Ｚａ-ｚ]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).toLowerCase().replace(/[^a-z0-9_]/g, '');
}
function appvShipIdHit(sale, rawId) {
  const id = appvShipNormId(rawId);
  if (!id || id.length < 4) return false;
  return [sale && sale.id, sale && sale.itemId, sale && sale.memo, sale && sale.name].some((f) => { const fv = appvShipNormId(f); return fv && fv.includes(id); });
}
function appvShipSlipHit(sale, slip) {
  const t = appvNormalizeSlip(slip);
  if (!t) return false;
  return [sale && sale.slip, sale && sale.invoiceNo, sale && sale.memo].some((f) => appvNormalizeSlip(f) === t);
}
function appvDetectShipType(rows) {
  let y1 = 0, y2 = 0, sg = 0;
  (rows || []).forEach((r, idx) => {
    const joined = (r || []).join('');
    if (!joined.trim()) return;
    if (idx === 0 && joined.match(/お客様|原票|運賃|伝票|管理|送料|問い合わせ|問合|商品/)) return;
    if (num(r[11]) > 0 && appvNormalizeSlip(r[4] || '')) y2++;
    else if (appvExtractItemId(r[0] || '') || appvExtractItemId(r[27] || '')) y1++;
    if (appvExtractItemId(r[4] || '') && num(r[10]) > 0) sg++;
  });
  if (y2 > 0 && y2 >= y1 && y2 >= sg) return 'yamato2';
  if (y1 > 0 && y1 >= sg) return 'yamato1';
  if (sg > 0) return 'sagawa';
  return null;
}
/* 配送CSVの保存先(旧: shipRows/saveShipRows と同一キー ribre_shipping_rows230) */
function appvShipRows() { try { return JSON.parse(localStorage.getItem('ribre_shipping_rows230') || '[]') || []; } catch (e) { return []; } }
function appvSaveShipRows(arr) { localStorage.setItem('ribre_shipping_rows230', JSON.stringify((arr || []).slice(-10000))); }
function appvSaveShipResults(arr) { localStorage.setItem('ribre_shipping_results230', JSON.stringify((arr || []).slice(0, 10000))); }

/* 配送CSVの取込（旧: importShippingCsv と同一ロジック） */
function appvImportShippingCsv(csvText, type) {
  const rows = appvParseCsv(csvText);
  if (type === 'auto') {
    type = appvDetectShipType(rows);
    if (!type) return { error: 'CSVの種類を自動判別できませんでした。手動で種類を選んで再取込してください。' };
  }
  const mapped = [];
  rows.forEach((r, idx) => {
    const joined = r.join('');
    if (idx === 0 && joined.match(/お客様|原票|運賃|伝票|管理|送料|問い合わせ|問合/)) return;
    const obj = { type: type, raw: r, row: idx + 1, itemId: '', slip: '', shipping: 0, company: '', status: '未照合' };
    if (type === 'yamato1') {
      obj.company = 'ヤマト';
      obj.itemId = appvExtractItemId(r[0] || '') || appvExtractItemId(r[27] || '');
      obj.slip = appvNormalizeSlip(r[3] || '');
    } else if (type === 'yamato2') {
      obj.company = 'ヤマト';
      obj.slip = appvNormalizeSlip(r[4] || '');
      obj.shipping = Math.round(num(r[11] || 0) * 1.1);
    } else {
      obj.company = '佐川急便';
      obj.itemId = appvExtractItemId(r[4] || '');
      obj.shipping = Math.round(num(r[10] || 0) * 1.1);
    }
    if (obj.itemId || obj.slip || obj.shipping) mapped.push(obj);
  });
  const prev = appvShipRows();
  const keyOf = (r) => r.type + '|' + (appvNormalizeSlip(r.slip) || String(r.itemId || '') || ('c' + (Array.isArray(r.raw) ? r.raw.join('') : String(r.raw || ''))));
  const merged = new Map();
  prev.forEach((r) => merged.set(keyOf(r), r));
  mapped.forEach((r) => merged.set(keyOf(r), r));
  const finalRows = Array.from(merged.values());
  appvSaveShipRows(finalRows);
  if (!mapped.length) return { error: 'CSVは読めましたが、商品ID・伝票番号・送料が見つかりませんでした。CSV種類を変えて再取込してください。', total: finalRows.length };
  return { imported: mapped.length, total: finalRows.length };
}

/* 配送照合の実行（旧: matchShipping と同一ロジック。ribre_full_sales221(sales())を更新） */
function appvMatchShipping() {
  const ships = appvShipRows();
  const s = sales();
  if (!ships.length) return { error: '先に配送CSVを取込してください' };
  let matched = 0, unmatched = 0;
  const unmatchedList = [];
  ships.forEach((sh) => {
    let target = null;
    if (sh.itemId) target = s.find((x) => appvShipIdHit(x, sh.itemId));
    if (!target && sh.slip) target = s.find((x) => appvShipSlipHit(x, sh.slip));
    if (target && target.matchStatus === '手入力') return; // 手入力保護（旧UIと同じ）
    if (target) {
      if (sh.slip) target.slip = sh.slip;
      if (sh.shipping) { target.shipping = sh.shipping; target.ship = sh.shipping; target.profit = num(target.amount || target.price) - num(target.fee) - num(sh.shipping); }
      target.deliveryCompany = sh.company;
      target.matchStatus = '配送CSV一致';
      matched++;
    } else {
      unmatched++;
      unmatchedList.push({ company: sh.company, itemId: sh.itemId, slip: sh.slip, shipping: sh.shipping });
    }
  });
  setLS(LS.sales, s);
  const salesResults = s.map((x) => {
    const shipped = Number(x.shipping || 0) > 0;
    const csvMatched = x.matchStatus === '配送CSV一致' && shipped;
    const status = csvMatched ? '一致' : (shipped ? '匿名配送' : '未一致');
    return { status: status, company: x.deliveryCompany || '', itemId: x.itemId || x.id || '', slip: x.slip || '', shipping: x.shipping || 0, name: x.name || '' };
  });
  appvSaveShipResults(salesResults);
  return { matched: matched, unmatched: unmatched, unmatchedList: unmatchedList.slice(0, 100) };
}

/* ---- UIハンドラ ---- */
function appvImpSetStatus(id, msg) { const el = document.getElementById(id); if (el) el.textContent = msg; }
function appvReadFileAsText(file, cb) {
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const buf = rd.result;
      let text = new TextDecoder('utf-8', { fatal: false }).decode(buf);
      if (text.indexOf('�') >= 0) { try { text = new TextDecoder('shift-jis').decode(buf); } catch (e) {} }
      cb(text);
    } catch (e) { cb(''); }
  };
  rd.onerror = () => cb('');
  rd.readAsArrayBuffer(file);
}
async function appvHandleYahooImport() {
  const fileEl = document.getElementById('impYahooFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  const account = document.getElementById('impYahooAccount').value;
  const monthEl = document.getElementById('impYahooMonth');
  const forceMonth = (monthEl && /^\d{4}-\d{2}$/.test(monthEl.value)) ? monthEl.value : '';
  if (!file) { alert('売上CSVを選択してください'); return; }
  appvImpSetStatus('impYahooStatus', '取込中…');
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv yahoo csv import'); } catch (e) {}
  appvReadFileAsText(file, async (text) => {
    const r = appvImportYahooCsv(file, text, account, forceMonth);
    if (r.error) { appvImpSetStatus('impYahooStatus', '⚠ ' + r.error); return; }
    let msg = '✅ 取込完了：新規 ' + r.added + '件・補完更新 ' + r.patched + '件・スキップ ' + r.skipped + '件（累計 ' + r.total + '件）';
    if (r.reverted) msg += '　🔒 ロック中の月のため ' + r.reverted + '件は取り込みませんでした';
    appvImpSetStatus('impYahooStatus', msg);
    await appvAfterWrite();
    const push = await appvPushCloudSafe();
    if (push && push.ok) appvToast('☁ クラウドに同期しました');
  });
}
function appvRenderShipUnmatchTable(list) {
  const wrap = document.getElementById('impShipUnmatchWrap');
  const body = document.getElementById('impShipUnmatchBody');
  if (!wrap || !body) return;
  appvClear(body);
  if (!list || !list.length) { wrap.style.display = 'none'; return; }
  wrap.style.display = 'block';
  list.forEach((r) => {
    const tr = document.createElement('tr');
    const tdCompany = document.createElement('td'); tdCompany.textContent = r.company || '';
    const tdItemId = document.createElement('td'); tdItemId.textContent = r.itemId || '';
    const tdSlip = document.createElement('td'); tdSlip.textContent = r.slip || '';
    const tdShip = document.createElement('td'); tdShip.style.textAlign = 'right'; tdShip.className = 'num'; tdShip.textContent = yen(r.shipping || 0);
    tr.appendChild(tdCompany); tr.appendChild(tdItemId); tr.appendChild(tdSlip); tr.appendChild(tdShip);
    body.appendChild(tr);
  });
}

/* 配送照合の永続表示（旧: pages/app-shipping.js shipRenderEditable/sortUnmatchedFirst と同一体験。
 * ページを開き直しても前回の照合結果(ribre_shipping_results230)がそのまま見え、
 * 不一致行は送料を手入力してその場で解消できる。未一致を先頭に並べる。 */
function appvShipResults() { try { return JSON.parse(localStorage.getItem('ribre_shipping_results230') || '[]') || []; } catch (e) { return []; } }
function appvRenderShipPersistentTable() {
  const wrap = document.getElementById('impShipUnmatchWrap');
  const body = document.getElementById('impShipUnmatchBody');
  const resultBox = document.getElementById('impShipResult');
  if (!wrap || !body) return;
  const results = appvShipResults();
  appvClear(body);
  if (!results.length) { wrap.style.display = 'none'; if (resultBox) resultBox.style.display = 'none'; return; }
  if (resultBox) resultBox.style.display = 'block';
  wrap.style.display = 'block';
  const order = { '未一致': 0, '手入力': 1, '匿名配送': 2, '一致': 3 };
  const sorted = results.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const matched = results.filter((r) => r.status === '一致' || r.status === '手入力').length;
  const unmatched = results.filter((r) => r.status === '未一致').length;
  appvSetText('impShipMatchCount', String(matched));
  appvSetText('impShipUnmatchCount', String(unmatched));
  sorted.forEach((r) => {
    const tr = document.createElement('tr');
    const level = r.status === '未一致' ? 'err' : (r.status === '一致' || r.status === '手入力') ? 'ok' : 'info';
    const tdStatus = document.createElement('td'); const b = document.createElement('span'); b.className = 'badge ' + level; b.textContent = r.status || ''; tdStatus.appendChild(b);
    const tdCompany = document.createElement('td'); tdCompany.textContent = r.company || '';
    const tdItemId = document.createElement('td'); tdItemId.textContent = r.itemId || '';
    const tdName = document.createElement('td'); tdName.textContent = r.name || '';
    const tdSlip = document.createElement('td'); tdSlip.textContent = r.slip || '';
    const tdShip = document.createElement('td'); tdShip.style.textAlign = 'right'; tdShip.className = 'num';
    if (r.itemId) {
      const input = document.createElement('input');
      input.type = 'number'; input.min = '0'; input.value = String(r.shipping || 0);
      input.style.width = '90px'; input.style.textAlign = 'right';
      input.title = '送料を手入力（Enter/フォーカス外しで確定）';
      input.addEventListener('change', () => appvManualShipping(r.itemId, input.value));
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { appvManualShipping(r.itemId, input.value); input.blur(); } });
      tdShip.appendChild(input);
    } else {
      tdShip.textContent = yen(r.shipping || 0);
    }
    tr.appendChild(tdStatus); tr.appendChild(tdCompany); tr.appendChild(tdItemId); tr.appendChild(tdName); tr.appendChild(tdSlip); tr.appendChild(tdShip);
    body.appendChild(tr);
  });
}
/* 送料の手入力（旧: pages/app-shipping.js manualShipping と同一ロジック・同一フィールド・同一保存経路。
 * matchStatus='手入力'にして以後のCSV再取込での巻き戻りを防止する）。 */
async function appvManualShipping(itemId, val) {
  const v = Math.round(Number(val) || 0);
  const s = sales();
  const idx = s.findIndex((x) => String(x.itemId || x.id || '') === String(itemId));
  if (idx < 0) return;
  if (String(s[idx].memo || '').includes('[LOCK]')) { alert('ロック済みのため送料を変更できません。'); appvRenderShipPersistentTable(); return; }
  s[idx].shipping = v;
  s[idx].ship = v;
  s[idx].profit = num(s[idx].amount || s[idx].price || 0) - num(s[idx].fee || 0) - v;
  s[idx].matchStatus = '手入力';
  setLS(LS.sales, s);
  const results = appvShipResults();
  const ri = results.findIndex((r) => String(r.itemId || '') === String(itemId));
  if (ri >= 0) {
    results[ri].status = '手入力';
    results[ri].shipping = v;
    results[ri].name = s[idx].name || results[ri].name;
    appvSaveShipResults(results);
  }
  appvRenderShipPersistentTable();
  await appvAfterWrite();
  await appvRenderTodos();
  const push = await appvPushCloudSafe();
  if (push && push.ok) appvToast('☁ クラウドに同期しました');
}
async function appvHandleShipImport() {
  const fileEl = document.getElementById('impShipFile');
  const file = fileEl && fileEl.files && fileEl.files[0];
  const type = document.getElementById('impShipType').value;
  if (!file) { alert('配送CSVを選択してください'); return; }
  appvImpSetStatus('impShipStatus', '取込中…');
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv shipping csv import'); } catch (e) {}
  const rd = new FileReader();
  rd.onload = async () => {
    const text = String(rd.result || '');
    const r = appvImportShippingCsv(text, type);
    if (r.error) { appvImpSetStatus('impShipStatus', '⚠ ' + r.error); return; }
    appvImpSetStatus('impShipStatus', '取込OK（' + r.imported + '件・累計' + r.total + '件）。照合しています…');
    const m = appvMatchShipping();
    if (m.error) { appvImpSetStatus('impShipStatus', '⚠ ' + m.error); return; }
    appvRenderShipPersistentTable();
    appvImpSetStatus('impShipStatus', '✅ 照合完了：一致 ' + m.matched + '件・不一致 ' + m.unmatched + '件');
    await appvAfterWrite();
    await appvRenderTodos();
    const push = await appvPushCloudSafe();
    if (push && push.ok) appvToast('☁ クラウドに同期しました');
  };
  rd.onerror = () => appvImpSetStatus('impShipStatus', '⚠ 配送CSVを読み込めませんでした');
  rd.readAsText(file, 'Shift_JIS');
}

/* ---- メール取込状況（読み取り専用。mf_evidence の source='mail' を件数・最新日時のみ表示） ---- */
async function appvRenderMailImportStatus() {
  const el = document.getElementById('impMailNote');
  if (!el) return;
  const u = restUrl('mf_evidence');
  if (!u) { el.textContent = '未ログインのため表示できません'; return; }
  try {
    const res = await fetch(u + '?select=id,created_at&source=eq.mail&order=created_at.desc&limit=1', { headers: Object.assign({}, restHeaders(), { Prefer: 'count=exact' }) });
    if (!res.ok) { el.textContent = '取得に失敗しました'; return; }
    const range = res.headers.get('content-range') || '';
    const cm = /\/(\d+)$/.exec(range);
    const total = cm ? Number(cm[1]) : null;
    const data = await res.json();
    const latest = Array.isArray(data) && data[0] && data[0].created_at ? new Date(data[0].created_at).toLocaleString('ja-JP') : 'なし';
    el.textContent = 'メール取込：累計 ' + (total != null ? total : '?') + '件／最新取込 ' + latest;
  } catch (e) {
    el.textContent = '取得に失敗しました';
  }
}

/* =====================================================================
 * 設定ページ本実装（Phase D）：連携状態・バックアップ・手動同期
 * ===================================================================== */

/* ---- 連携状態 ---- */
async function appvRenderMfConnStatus() {
  const el = document.getElementById('statusMfConn');
  if (!el) return;
  try {
    const r = await fetch('/api/mf/status');
    if (!r.ok) { el.textContent = '確認失敗'; el.className = 'badge warn'; return; }
    const d = await r.json();
    if (d && d.connected) { el.textContent = '接続済み'; el.className = 'badge ok'; }
    else { el.textContent = '未接続'; el.className = 'badge warn'; }
  } catch (e) {
    el.textContent = '確認失敗'; el.className = 'badge warn';
  }
}
async function appvRenderMailImportStatusSettings() {
  const el = document.getElementById('statusMailImport');
  if (!el) return;
  const u = restUrl('mf_evidence');
  if (!u) { el.textContent = '未ログインのため表示できません'; return; }
  try {
    const res = await fetch(u + '?select=id,created_at&source=eq.mail&order=created_at.desc&limit=1', { headers: restHeaders() });
    if (!res.ok) { el.textContent = '取得に失敗しました'; return; }
    const data = await res.json();
    const latest = Array.isArray(data) && data[0] && data[0].created_at ? new Date(data[0].created_at).toLocaleString('ja-JP') : 'なし';
    el.textContent = '最終取込: ' + latest;
  } catch (e) {
    el.textContent = '取得に失敗しました';
  }
}
function appvRenderCloudSyncStatus() {
  const el = document.getElementById('statusCloudSync');
  if (!el) return;
  const em = (typeof email === 'function' && email()) || '';
  if (!em) { el.textContent = '未ログイン'; return; }
  const st = (window.ribreStore && window.ribreStore.status) ? window.ribreStore.status() : null;
  const hydratedAt = st && st.hydratedAt;
  el.textContent = 'ログイン中: ' + em + (hydratedAt ? '／最終取得 ' + hydratedAt : '（未取得）');
}
async function appvRenderSettingsPage() {
  appvRenderMfConnStatus();
  appvRenderMailImportStatusSettings();
  appvRenderCloudSyncStatus();
  appvRenderAccountCard();
  appvRenderSupabaseCard();
}

/* ---- アカウント（ログイン中メール表示・ログアウト） ---- */
function appvRenderAccountCard() {
  const el = document.getElementById('acctEmail');
  if (!el) return;
  const em = (typeof email === 'function') ? email() : '';
  el.textContent = em || '未ログイン';
}
function appvSignOut() {
  const ok = confirm('ログアウトすると端末のキャッシュデータが消去されます（クラウドに同期済みのデータは安全）。ログアウトしますか？');
  if (!ok) return;
  if (typeof window.signOut === 'function') {
    window.signOut();
  } else {
    appvToast('ログアウト機能が見つかりません');
    return;
  }
  appvRenderAccountCard();
  appvRenderCloudSyncStatus();
  appvToast('ログアウトしました');
}

/* ---- Supabase接続設定（旧UI pages/settings.js の saveSupabase/checkSupabase と同一の保存先・検証方法） ---- */
function appvRenderSupabaseCard() {
  const cfg = (typeof sb === 'function') ? sb() : {};
  const urlEl = document.getElementById('sbUrlV2');
  const keyEl = document.getElementById('sbKeyV2');
  if (urlEl && !urlEl.matches(':focus')) urlEl.value = (cfg && cfg.url) || '';
  if (keyEl && !keyEl.matches(':focus')) keyEl.value = (cfg && cfg.key) || '';
}
function appvSaveSupabase() {
  const urlEl = document.getElementById('sbUrlV2');
  const keyEl = document.getElementById('sbKeyV2');
  const url = (urlEl && urlEl.value || '').trim();
  const key = (keyEl && keyEl.value || '').trim();
  if (!url || !key) {
    appvToast('URLとkeyを入れてください');
    return;
  }
  setLS(LS.sb, { url, key });
  appvToast('Supabase設定を保存しました');
  appvSbSetLocked(true); // 保存後は再ロック（普段は触らない設定のため）
  appvRenderSupabaseCard();
  appvRenderCloudSyncStatus();
}
/* Supabase接続カードのロック制御。普段は読み取り専用にし、明示的な解除でのみ編集可 */
function appvSbSetLocked(locked) {
  const urlEl = document.getElementById('sbUrlV2');
  const keyEl = document.getElementById('sbKeyV2');
  const saveBtn = document.getElementById('sbSaveBtnV2');
  const unlockBtn = document.getElementById('sbUnlockBtnV2');
  if (urlEl) urlEl.disabled = locked;
  if (keyEl) keyEl.disabled = locked;
  if (saveBtn) saveBtn.style.display = locked ? 'none' : 'inline-block';
  if (unlockBtn) unlockBtn.textContent = locked ? '🔒 変更する' : 'キャンセル';
}
function appvSbToggleLock() {
  const urlEl = document.getElementById('sbUrlV2');
  const nowLocked = !!(urlEl && urlEl.disabled);
  if (nowLocked) {
    if (!confirm('Supabase接続設定を変更しますか？\n（間違った値を保存するとクラウド同期が止まります。普段は変更不要です）')) return;
    appvSbSetLocked(false);
  } else {
    appvRenderSupabaseCard(); // 編集を破棄して保存済みの値に戻す
    appvSbSetLocked(true);
  }
}
async function appvCheckSupabase() {
  const statusEl = document.getElementById('sbStatusV2');
  if (statusEl) statusEl.textContent = '確認中…';
  const r = await rest('sales', { query: '?select=id&limit=1' });
  if (statusEl) statusEl.textContent = r.error ? 'エラー' : 'OK';
  appvToast(r.error ? ('接続エラー: ' + r.error.message) : 'Supabase接続OK');
}

/* ---- ユーザー登録（旧UI services/supabase-auth.js の signUp と同一フロー。隠しinput #email/#password/#role へ転記して呼ぶ） ---- */
async function appvSubmitRegister() {
  const emEl = document.getElementById('regEmailV2');
  const pwEl = document.getElementById('regPasswordV2');
  const roleEl = document.getElementById('regRoleV2');
  const em = (emEl && emEl.value || '').trim();
  const pw = (pwEl && pwEl.value || '').trim();
  const role = (roleEl && roleEl.value) || 'staff';
  if (!em || !pw) {
    appvToast('メールとパスワードを入力してください');
    return;
  }
  const hiddenEmail = document.getElementById('email');
  const hiddenPassword = document.getElementById('password');
  const hiddenRole = document.getElementById('role');
  if (hiddenEmail) hiddenEmail.value = em;
  if (hiddenPassword) hiddenPassword.value = pw;
  if (hiddenRole) hiddenRole.value = role;
  if (typeof window.signUp !== 'function') {
    appvToast('登録機能が見つかりません');
    return;
  }
  try {
    await window.signUp();
    appvToast('登録しました。ログインしてください');
    if (emEl) emEl.value = '';
    if (pwEl) pwEl.value = '';
  } catch (e) {
    appvToast('登録に失敗しました');
  }
}

/* ---- バックアップ（旧UI app-simple.js smpFullBackup/smpFullRestore と完全同一形式・同一キー） ---- */
function appvFullBackupSnapshot() {
  const pick = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  return {
    _type: 'ribre_full_backup_v1',
    createdAt: new Date().toISOString(),
    sales: pick('ribre_full_sales221'),
    yahooSales: pick('ribre_yahoo_sales240'),
    purchases: pick('ribre_full_purchases221'),
    meisai: pick('ribre_smp_profit_meisai_v1'),
    prov: pick('ribre_smp_profit_prov_v1'),
    partners: pick('ribre_smp_partners_v1'),
    lockedMonths: pick('ribre_smp_locked_months')
  };
}
function appvBackupExport() {
  const data = appvFullBackupSnapshot();
  const statusEl = document.getElementById('backupStatus');
  try {
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'ribre_full_backup_' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    if (statusEl) statusEl.textContent = '✅ 書き出しました（売上' + ((data.sales || []).length) + '／仕入' + ((data.purchases || []).length) + '／売上明細' + ((data.meisai && data.meisai.sales || []).length) + '／仕入明細' + ((data.meisai && data.meisai.purchases || []).length) + '）';
    appvToast('✅ バックアップを書き出しました');
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠️ 書き出しに失敗: ' + e.message;
  }
}
/* 読み込み：旧UI smpFullRestore（app-simple.js 257-293行目）と同一の検証・同一キーへの書き込み。
 * 読み込み前に必ずcreateLocalSnapshot＋confirm（上書きの説明付き）。 */
function appvBackupImport(file) {
  const statusEl = document.getElementById('backupStatus');
  if (!file) return;
  if (!confirm('全データ（EC売上・仕入・粗利明細・仮入力・登録先・ロック）を復元します。今の内容は置き換わります。よろしいですか？')) return;
  try { if (typeof createLocalSnapshot === 'function') createLocalSnapshot('before appv backup import'); } catch (e) {}
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const d = JSON.parse(rd.result);
      const put = (k, v) => { if (v != null) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} } };
      if (d.sales) put('ribre_full_sales221', d.sales);
      put('ribre_yahoo_sales240', d.yahooSales || d.sales);
      if (d.purchases) put('ribre_full_purchases221', d.purchases);
      if (d.meisai) put('ribre_smp_profit_meisai_v1', d.meisai);
      if (d.prov) put('ribre_smp_profit_prov_v1', d.prov);
      if (d.partners) put('ribre_smp_partners_v1', d.partners);
      if (d.lockedMonths) put('ribre_smp_locked_months', d.lockedMonths);
      try { refreshAll(); } catch (e) {}
      const li = (typeof email === 'function' && email());
      if (li && window.ribreStore && window.ribreStore.replaceCloudWithLocal) {
        if (statusEl) statusEl.textContent = '復元中…クラウドを置き換えています';
        window.ribreStore.replaceCloudWithLocal().then(async () => {
          /* 旧: smpFullRestore（app-simple.js 279-281行目）と同様に、sales/purchases以外の
             ストア（明細・仮入力・月ロック）もクラウドへ反映する（B6）。各pushの失敗はトーストで警告。 */
          const warnings = [];
          try { const r = await appvMeiPushCloud(); if (!r || !r.ok) warnings.push('売上・仕入明細'); } catch (e) { warnings.push('売上・仕入明細'); }
          try { const r = await appvProvPushCloud(); if (!r || !r.ok) warnings.push('仮入力'); } catch (e) { warnings.push('仮入力'); }
          try { const r = await appvLockedPushCloud(); if (!r || !r.ok) warnings.push('月ロック'); } catch (e) { warnings.push('月ロック'); }
          if (warnings.length) {
            if (statusEl) statusEl.textContent = '⚠️ 一部クラウド反映に失敗: ' + warnings.join('・');
            appvToast('⚠️ クラウド反映に失敗した項目があります: ' + warnings.join('・'));
          } else {
            if (statusEl) statusEl.textContent = '✅ 全データ復元＆クラウド反映完了。他端末は「クラウドから最新を取得」を押してください';
            appvToast('✅ 復元し、クラウドにも反映しました');
          }
        });
      } else {
        if (statusEl) statusEl.textContent = '✅ 復元しました（未ログイン：この端末のみ）';
        appvToast('✅ 復元しました（この端末のみ）');
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '⚠️ 復元失敗: ' + e.message;
      appvToast('⚠️ 復元に失敗しました');
    }
  };
  rd.readAsText(file);
}

/* ---- 手動同期 ---- */
async function appvManualPush() {
  const statusEl = document.getElementById('manualSyncStatus');
  if (statusEl) statusEl.textContent = '同期中…';
  if (!(window.ribreStore && window.ribreStore.pushSafe)) { if (statusEl) statusEl.textContent = '⚠️ 同期機能が使えません'; return; }
  try {
    const r = await window.ribreStore.pushSafe();
    if (statusEl) statusEl.textContent = r && r.ok ? '✅ クラウドに同期しました（' + new Date().toLocaleString('ja-JP') + '）' : '⚠️ 同期に失敗しました: ' + (r && (r.reason || r.error) || '不明なエラー');
    appvToast(r && r.ok ? '✅ クラウドに同期しました' : '⚠️ 同期に失敗しました');
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠️ 同期に失敗しました: ' + e.message;
  }
}
async function appvManualHydrate() {
  const statusEl = document.getElementById('manualSyncStatus');
  if (!confirm('クラウドから最新を取得します。ローカル未同期の変更は失われる可能性があります。よろしいですか？')) return;
  if (!(window.ribreStore && window.ribreStore.hydrate)) { if (statusEl) statusEl.textContent = '⚠️ 取得機能が使えません'; return; }
  if (statusEl) statusEl.textContent = '取得中…';
  try {
    const r = await window.ribreStore.hydrate();
    try { refreshAll(); } catch (e) {}
    const s = (r && r.sales != null) ? r.sales : '?';
    const p = (r && r.purchases != null) ? r.purchases : '?';
    if (statusEl) statusEl.textContent = r && r.ok ? ('✅ クラウドから取得：売上 ' + s + '件 / 仕入 ' + p + '件') : '⚠️ 取得に失敗しました';
    appvToast(r && r.ok ? '✅ クラウドの最新に揃えました' : '⚠️ 取得に失敗しました');
  } catch (e) {
    if (statusEl) statusEl.textContent = '⚠️ 取得に失敗しました: ' + e.message;
  }
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
  appvRenderHomeClosedBadge();
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
  appvRenderHomeClosedBadge();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('#sideNav .nav-item').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.page)));
  document.querySelectorAll('#bottomNav button[data-page]').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.page)));
  document.querySelectorAll('[data-page-link]').forEach((b) => b.addEventListener('click', () => appvGotoPage(b.dataset.pageLink)));
  document.querySelectorAll('[data-action="phaseb-toast"]').forEach((b) => b.addEventListener('click', () => appvPhaseBToast(b.dataset.label || '')));
  document.querySelectorAll('[data-action="goto-evidence"]').forEach((b) => b.addEventListener('click', () => { window.location.href = '/mf-evidence?from=app'; }));

  /* クイックアクション／＋登録／FAB: 種別プリセット済みの登録モーダルを開く（既定は明細モード） */
  document.querySelectorAll('[data-action="open-tx-modal"]').forEach((b) => {
    b.addEventListener('click', () => appvOpenModal(b.dataset.kind || 'sale', { mode: 'add', mode2: b.dataset.mode || 'meisai' }));
  });
  document.querySelectorAll('#txModalKind .choice-btn').forEach((b) => {
    b.addEventListener('click', () => appvSetModalKind(b.dataset.kind));
  });
  document.querySelectorAll('#txModeChoice .choice-btn').forEach((b) => {
    b.addEventListener('click', () => appvSetTxMode(b.dataset.mode));
  });
  document.querySelectorAll('#txMeisaiKind .choice-btn').forEach((b) => {
    b.addEventListener('click', () => appvSetMeisaiKind(b.dataset.kind));
  });
  const txMeisaiPartnerSel = document.getElementById('txMeisaiPartnerSel');
  if (txMeisaiPartnerSel) txMeisaiPartnerSel.addEventListener('change', appvMeiPartnerSelChange);
  const txMeisaiDate = document.getElementById('txMeisaiDate');
  if (txMeisaiDate) txMeisaiDate.addEventListener('change', appvUpdateMeisaiLockWarn);
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

  /* ドロワーの編集・削除（明細方式の行＝_meiId有りは明細フォーム/appvDeleteMeisaiRowへ） */
  const drawerEditBtn = document.getElementById('drawerEditBtn');
  if (drawerEditBtn) drawerEditBtn.addEventListener('click', () => {
    if (!appvDrawerRow) return;
    if (appvDrawerRow._meiId) { appvOpenModal(appvDrawerRow._meiKind, { mode: 'edit', editTarget: appvDrawerRow }); return; }
    const kind = appvDrawerRow.type === 'sale' ? 'sale' : (appvDrawerRow.expense ? 'expense' : 'purchase');
    appvOpenModal(kind, { mode: 'edit', editTarget: appvDrawerRow });
  });
  const drawerDeleteBtn = document.getElementById('drawerDeleteBtn');
  if (drawerDeleteBtn) drawerDeleteBtn.addEventListener('click', () => {
    if (!appvDrawerRow) return;
    if (appvDrawerRow._meiId) { appvDeleteMeisaiRow(appvDrawerRow._meiKind, appvDrawerRow._meiId); return; }
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
      // 粗利タブ中はコンテンツ幅の上限を解除（12ヶ月+年計を横スクロール無しで収める）
      const mainEl = document.querySelector('.main');
      if (mainEl) mainEl.classList.toggle('profit-wide', isProfit);
      appvUpdateLedgerSalesToolsVisibility();
      if (isProfit) appvRenderProfit(); else appvRenderLedger();
    });
  });
  appvUpdateLedgerSalesToolsVisibility();
  const ledgerCsvBtn = document.getElementById('ledgerCsvBtn');
  if (ledgerCsvBtn) ledgerCsvBtn.addEventListener('click', appvExportReportExcel);
  const ledgerShipCopyBtn = document.getElementById('ledgerShipCopyBtn');
  if (ledgerShipCopyBtn) ledgerShipCopyBtn.addEventListener('click', appvCopyShippingOnly);
  const profitYearSel = document.getElementById('profitYearSel');
  if (profitYearSel) profitYearSel.addEventListener('change', () => {
    appvProfitStartYear = parseInt(profitYearSel.value, 10) || appvProfitDefaultStartYear();
    appvRenderProfit();
  });
  const profitYearPrev = document.getElementById('profitYearPrev');
  if (profitYearPrev) profitYearPrev.addEventListener('click', () => {
    appvProfitStartYear = (appvProfitStartYear == null ? appvProfitDefaultStartYear() : appvProfitStartYear) - 1;
    appvRenderProfit();
  });
  const profitYearNext = document.getElementById('profitYearNext');
  if (profitYearNext) profitYearNext.addEventListener('click', () => {
    appvProfitStartYear = (appvProfitStartYear == null ? appvProfitDefaultStartYear() : appvProfitStartYear) + 1;
    appvRenderProfit();
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

  /* Phase C: 取込画面（CSV取込・配送照合） */
  const impYahooBtn = document.getElementById('impYahooBtn');
  if (impYahooBtn) impYahooBtn.addEventListener('click', appvHandleYahooImport);
  const impShipBtn = document.getElementById('impShipBtn');
  if (impShipBtn) impShipBtn.addEventListener('click', appvHandleShipImport);

  const provSaveBtn = document.getElementById('provSaveBtn');
  if (provSaveBtn) provSaveBtn.addEventListener('click', appvSaveProvPanel);

  /* Phase D: 分析ページ（目標進捗・チャネル構成比） */
  const goalBtnYear = document.getElementById('goalBtnYear');
  if (goalBtnYear) goalBtnYear.addEventListener('click', () => appvGoalSetMode('year'));
  const goalBtnMonth = document.getElementById('goalBtnMonth');
  if (goalBtnMonth) goalBtnMonth.addEventListener('click', () => appvGoalSetMode('month'));
  const goalMonthSel = document.getElementById('goalMonthSel');
  if (goalMonthSel) goalMonthSel.addEventListener('change', appvRenderGoals);
  ['goalSaleInput', 'goalSaleUnitInput'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', async () => {
      const t = appvGoalMode === 'year' ? await appvRenderFiscalYearCard() : await appvMonthTotals((document.getElementById('goalMonthSel') || {}).value || appvCurrentMonth());
      const curSale = t.sale, curProf = t.profit != null ? t.profit : t.profit;
      appvGoalOnInput('sale', curSale, t.profit);
    });
  });
  ['goalProfInput', 'goalProfUnitInput'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', async () => {
      const t = appvGoalMode === 'year' ? await appvRenderFiscalYearCard() : await appvMonthTotals((document.getElementById('goalMonthSel') || {}).value || appvCurrentMonth());
      appvGoalOnInput('prof', t.sale, t.profit);
    });
  });
  const channelMixMonthSel = document.getElementById('channelMixMonthSel');
  if (channelMixMonthSel) channelMixMonthSel.addEventListener('change', appvRenderChannelMix);

  /* A/B: 個数・平均単価カードの選択月（価格帯分布も共用） */
  const unitPriceMonthSel = document.getElementById('unitPriceMonthSel');
  if (unitPriceMonthSel) unitPriceMonthSel.addEventListener('change', async () => {
    await appvRenderUnitPriceCard();
    await appvRenderPriceDist();
  });
  /* C: 日別売上推移の選択月 */
  const dailyTrendMonthSel = document.getElementById('dailyTrendMonthSel');
  if (dailyTrendMonthSel) dailyTrendMonthSel.addEventListener('change', appvRenderDailyTrend);

  /* Phase D: 月締めチェックリスト */
  const closeMonthSel = document.getElementById('closeMonthSel');
  if (closeMonthSel) closeMonthSel.addEventListener('change', appvRenderCloseChecklist);
  const closeMonthBtn = document.getElementById('closeMonthBtn');
  if (closeMonthBtn) closeMonthBtn.addEventListener('click', appvCloseMonth);
  const reopenMonthBtn = document.getElementById('reopenMonthBtn');
  if (reopenMonthBtn) reopenMonthBtn.addEventListener('click', appvReopenMonth);

  /* Phase D: 設定ページ（アカウント・Supabase接続・ユーザー登録） */
  const acctSignOutBtn = document.getElementById('acctSignOutBtn');
  if (acctSignOutBtn) acctSignOutBtn.addEventListener('click', appvSignOut);
  const sbSaveBtnV2 = document.getElementById('sbSaveBtnV2');
  if (sbSaveBtnV2) sbSaveBtnV2.addEventListener('click', appvSaveSupabase);
  const sbUnlockBtnV2 = document.getElementById('sbUnlockBtnV2');
  if (sbUnlockBtnV2) sbUnlockBtnV2.addEventListener('click', appvSbToggleLock);
  const sbCheckBtnV2 = document.getElementById('sbCheckBtnV2');
  if (sbCheckBtnV2) sbCheckBtnV2.addEventListener('click', appvCheckSupabase);
  const regSubmitBtnV2 = document.getElementById('regSubmitBtnV2');
  if (regSubmitBtnV2) regSubmitBtnV2.addEventListener('click', appvSubmitRegister);

  /* Phase D: 設定ページ（バックアップ・手動同期） */
  const backupExportBtn = document.getElementById('backupExportBtn');
  if (backupExportBtn) backupExportBtn.addEventListener('click', appvBackupExport);
  const backupImportFile = document.getElementById('backupImportFile');
  if (backupImportFile) backupImportFile.addEventListener('change', () => {
    const f = backupImportFile.files && backupImportFile.files[0];
    appvBackupImport(f);
    backupImportFile.value = '';
  });
  const manualPushBtn = document.getElementById('manualPushBtn');
  if (manualPushBtn) manualPushBtn.addEventListener('click', appvManualPush);
  const manualHydrateBtn = document.getElementById('manualHydrateBtn');
  if (manualHydrateBtn) manualHydrateBtn.addEventListener('click', appvManualHydrate);

  appvBoot();
});
