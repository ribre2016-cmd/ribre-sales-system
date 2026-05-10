/* RIBRE — Supabase PostgREST（Phase2 続き: index.html から分離。ロジックは同一） */
function restHeaders() {
  const c = sb(),
    s = sess();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  return {
    apikey: c.key,
    Authorization: 'Bearer ' + (token || c.key),
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
  };
}
function restUrl(t) {
  const c = sb();
  if (!c.url || !c.key) {
    alert('Supabase設定してください');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/rest/v1/' + t;
}
async function rest(t, opt = {}) {
  const u = restUrl(t);
  if (!u) return { error: { message: '設定なし' } };
  try {
    const res = await fetch(u + (opt.query || ''), {
      method: opt.method || 'GET',
      headers: restHeaders(),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) {
      if (res.status === 401) {
        return { error: { message: '401 Unauthorized: 再ログインしてください' } };
      }
      return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    }
    return { data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
async function cloudCheck() {
  const r = await rest('sales', { query: '?select=id&limit=1' });
  document.getElementById('cloudStatus').textContent = r.error ? 'エラー' : 'OK';
  renderList('cloudList', [
    {
      type: r.error ? 'ERROR' : 'OK',
      level: r.error ? 'danger' : 'ok',
      msg: r.error ? r.error.message : 'クラウド接続OK'
    }
  ]);
}
function mapSale(x) {
  return {
    user_email: email(),
    user_role: role(),
    sale_date: x.date,
    month: x.month,
    item_name: x.name,
    shop: x.shop,
    amount: num(x.amount),
    fee: 0,
    shipping: 0,
    profit: num(x.amount),
    memo: x.memo || ''
  };
}
function mapPurchase(x) {
  return {
    user_email: email(),
    user_role: role(),
    purchase_date: x.date,
    month: x.month,
    item_name: x.name,
    vendor: x.vendor,
    cost: num(x.total),
    shipping: 0,
    total: num(x.total),
    memo: x.memo || ''
  };
}
async function uploadSales() {
  if (!email()) {
    alert('ログインしてください');
    return;
  }
  const r = await rest('sales', { method: 'POST', body: sales().map(mapSale) });
  afterUpload(r, '売上');
}
async function uploadPurchases() {
  if (!email()) {
    alert('ログインしてください');
    return;
  }
  const r = await rest('purchases', { method: 'POST', body: purchases().map(mapPurchase) });
  afterUpload(r, '仕入');
}
function afterUpload(r, name) {
  if (r.error) {
    renderList('cloudList', [{ type: 'ERROR', level: 'danger', msg: r.error.message }]);
    return;
  }
  localStorage.setItem('ribre_last_sync221', new Date().toLocaleString('ja-JP'));
  document.getElementById('lastSync').textContent = localStorage.getItem('ribre_last_sync221');
  renderList('cloudList', [{ type: name, msg: name + 'をクラウド保存しました' }]);
}
async function loadMine() {
  const e = email();
  if (!e) {
    alert('ログインしてください');
    return;
  }
  const s = await rest('sales', {
    query: '?select=*&user_email=eq.' + encodeURIComponent(e) + '&limit=5000&order=id.desc'
  });
  const p = await rest('purchases', {
    query: '?select=*&user_email=eq.' + encodeURIComponent(e) + '&limit=5000&order=id.desc'
  });
  if (s.error || p.error) {
    renderList('cloudList', [
      { type: 'ERROR', level: 'danger', msg: (s.error || p.error).message }
    ]);
    return;
  }
  setLS('ribre_cloud_sales221', s.data || []);
  setLS('ribre_cloud_purchases221', p.data || []);
  renderList('cloudList', [
    { type: '売上', msg: 'クラウド売上 ' + (s.data || []).length + '件' },
    { type: '仕入', msg: 'クラウド仕入 ' + (p.data || []).length + '件' }
  ]);
}
