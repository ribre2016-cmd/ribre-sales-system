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
      if (t.page === 'import') { appvGotoPage('import'); } else { window.location.href = '/mf-evidence?from=app'; }
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
      // 既存(重複)：金額・送料・手数料などの空欄だけ補完する（旧UIと同じ「補完更新」規則）
      const existing = old.find((x) => x.itemId === itemId);
      if (existing) {
        const csvFee = appvYNum(r[idxFee]);
        const csvShipping = appvYNum(r[idxShip]);
        let touched = false;
        if (account && existing.shop !== account) { existing.shop = account; touched = true; }
        if (forceMonth && existing.month !== forceMonth) {
          existing.month = forceMonth;
          existing.date = forceMonth + '-' + (/^\d{4}-\d{2}-(\d{2})/.test(String(existing.date || '')) ? String(existing.date).slice(8, 10) : '01');
          touched = true;
        }
        if (!Number(existing.fee) && csvFee) { existing.fee = csvFee; touched = true; }
        if (!Number(existing.shipping) && csvShipping) { existing.shipping = csvShipping; existing.ship = csvShipping; touched = true; }
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
    document.getElementById('impShipResult').style.display = 'block';
    appvSetText('impShipMatchCount', String(m.matched));
    appvSetText('impShipUnmatchCount', String(m.unmatched));
    appvRenderShipUnmatchTable(m.unmatchedList);
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

  /* Phase C: 取込画面（CSV取込・配送照合） */
  const impYahooBtn = document.getElementById('impYahooBtn');
  if (impYahooBtn) impYahooBtn.addEventListener('click', appvHandleYahooImport);
  const impShipBtn = document.getElementById('impShipBtn');
  if (impShipBtn) impShipBtn.addEventListener('click', appvHandleShipImport);

  appvBoot();
});
