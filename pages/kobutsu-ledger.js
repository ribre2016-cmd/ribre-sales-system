/* 電子古物台帳 — sales/purchasesから月別に台帳形式で表示・CSV出力
 * 依存: core.js(today/num/yen/csvDownload/get/LS), supabase-rest.js(restUrl/restHeaders)
 */
/* signIn/signOut(supabase-auth.js)が呼ぶ共通関数の互換スタブ */
function refreshAll() {
  try { klLoad(); } catch (e) {}
}

let klRows = []; // 表示中の台帳行（CSV出力対象と同一）

window.addEventListener('DOMContentLoaded', () => {
  const monthEl = document.getElementById('klMonth');
  if (monthEl) monthEl.value = today().slice(0, 7);
  klLoad();
});

function klMonthLastDay(monthStr) {
  const parts = String(monthStr).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const last = new Date(y, m, 0).getDate();
  return monthStr + '-' + String(last).padStart(2, '0');
}

/* Supabaseから対象月のsales/purchasesを取得。設定なし/エラー時はnullを返す */
async function klFetchFromSupabase(month) {
  const from = month + '-01';
  const to = klMonthLastDay(month);
  const su = restUrl('sales');
  const pu = restUrl('purchases');
  if (!su || !pu) return null;
  try {
    const headers = restHeaders();
    const sRes = await fetch(
      su + '?select=*&sale_date=gte.' + encodeURIComponent(from) + '&sale_date=lte.' + encodeURIComponent(to) + '&order=sale_date.asc&limit=5000',
      { headers }
    );
    const pRes = await fetch(
      pu + '?select=*&purchase_date=gte.' + encodeURIComponent(from) + '&purchase_date=lte.' + encodeURIComponent(to) + '&order=purchase_date.asc&limit=5000',
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

/* localStorageのフルデータから対象月分を抽出（Supabase不可時のフォールバック） */
function klFetchFromLocal(month) {
  const salesAll = get('ribre_full_sales221', []);
  const purchasesAll = get('ribre_full_purchases221', []);
  const inMonth = (d) => String(d || '').slice(0, 7) === month;
  return {
    sales: (Array.isArray(salesAll) ? salesAll : []).filter((x) => inMonth(x.date)),
    purchases: (Array.isArray(purchasesAll) ? purchasesAll : []).filter((x) => inMonth(x.date))
  };
}

/* sales/purchasesレコード（Supabase形式・ローカル形式どちらも）を台帳行に正規化 */
function klNormalizeSale(x) {
  return {
    date: x.sale_date || x.date || '',
    kind: '売却',
    item: x.item_name || x.name || '',
    qty: x.qty || x.quantity || 1,
    price: num(x.amount),
    partner: x.shop || ''
  };
}
function klNormalizePurchase(x) {
  return {
    date: x.purchase_date || x.date || '',
    kind: '買受',
    item: x.item_name || x.name || '',
    qty: x.qty || x.quantity || 1,
    price: num(x.total),
    partner: x.vendor || ''
  };
}

function klSetSummary(msg, level) {
  renderList('klSummary', [{ type: '台帳', level: level || 'ok', msg }]);
}

async function klLoad() {
  const monthEl = document.getElementById('klMonth');
  const month = (monthEl && monthEl.value) || today().slice(0, 7);
  klSetSummary('読込中...', 'warn');
  let data = await klFetchFromSupabase(month);
  let source = 'クラウド';
  if (!data || (!data.sales.length && !data.purchases.length)) {
    const local = klFetchFromLocal(month);
    if (local.sales.length || local.purchases.length) {
      data = local;
      source = '端末保存データ';
    } else if (!data) {
      data = { sales: [], purchases: [] };
      source = '端末保存データ';
    }
  }
  const rows = []
    .concat(data.sales.map(klNormalizeSale))
    .concat(data.purchases.map(klNormalizePurchase))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  klRows = rows;
  klRender(rows);
  klSetSummary(month + ' の台帳（' + source + '） 全' + rows.length + '件');
}

function klRender(rows) {
  const tbody = document.getElementById('klBody');
  tbody.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 10;
    td.textContent = '対象月の取引はありません';
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }
  rows.forEach((r) => {
    const tr = document.createElement('tr');
    const cells = [
      r.date || '-',
      r.kind,
      r.item || '-',
      String(r.qty || 1),
      yen(r.price),
      r.partner || ''
    ];
    cells.forEach((v) => {
      const td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    // 相手方の住所・職業・年齢・確認方法：既存データに無いため空欄列
    for (let i = 0; i < 4; i++) {
      const td = document.createElement('td');
      td.className = 'kl-blank';
      td.textContent = '';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });
}

function klExportCsv() {
  const monthEl = document.getElementById('klMonth');
  const month = (monthEl && monthEl.value) || today().slice(0, 7);
  const header = ['取引年月日', '区分', '品目', '数量', '代価', '相手方の氏名・名称', '相手方の住所', '職業', '年齢', '確認方法'];
  const body = klRows.map((r) => [r.date || '', r.kind, r.item || '', r.qty || 1, r.price || 0, r.partner || '', '', '', '', '']);
  csvDownload([header].concat(body), 'kobutsu_daicho_' + month + '.csv');
}
