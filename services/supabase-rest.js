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
/* 旧実装（mapSale/mapPurchaseでclient_id無しの配列を毎回POST）は呼ぶたびに
 * クラウド上の全行を複製していた（実際に3210→6420件へ倍化した事故の原因）。
 * services/data-store.js の pushSafe()（client_idでのupsert・大量削除ガードつき）へ
 * 委譲する。ribreStoreが読み込まれていない場合は絶対に生POSTへフォールバックせず、
 * 何もしない（alertのみ）。関数名・シグネチャはlegacy.htmlのonclickが依存しているため維持する。 */
async function uploadSales() {
  if (!email()) {
    alert('ログインしてください');
    return;
  }
  if (!(window.ribreStore && typeof window.ribreStore.pushSafe === 'function')) {
    alert('安全な同期モジュール（ribreStore）が読み込まれていないため、同期を中止しました。ページを再読み込みしてください');
    return;
  }
  const r = await window.ribreStore.pushSafe();
  afterUpload(r && r.ok ? { data: r } : { error: { message: (r && (r.reason || r.error)) || '不明なエラー' } }, '売上');
}
async function uploadPurchases() {
  if (!email()) {
    alert('ログインしてください');
    return;
  }
  if (!(window.ribreStore && typeof window.ribreStore.pushSafe === 'function')) {
    alert('安全な同期モジュール（ribreStore）が読み込まれていないため、同期を中止しました。ページを再読み込みしてください');
    return;
  }
  const r = await window.ribreStore.pushSafe();
  afterUpload(r && r.ok ? { data: r } : { error: { message: (r && (r.reason || r.error)) || '不明なエラー' } }, '仕入');
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
