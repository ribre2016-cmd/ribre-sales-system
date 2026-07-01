/* RIBRE 売上管理 — 共通コア（Phase2: index.html から分離。ロジックは同一） */
const LS = {
  sales: 'ribre_full_sales221',
  purchases: 'ribre_full_purchases221',
  ev: 'ribre_full_evidences221',
  cand: 'ribre_full_candidates221',
  sb: 'ribre_supabase_config_v121',
  sess: 'ribre_auth_session140',
  openai: 'ribre_openai_key200'
};
function yen(n) { return (Number(n) || 0).toLocaleString() + '円'; }
function num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
function today() { return localDateString(); }
function escHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}
function safeLevel(v) {
  const s = String(v || 'ok');
  return /^[a-z0-9_-]+$/i.test(s) ? s : 'ok';
}
function get(k, d) {
  try {
    return JSON.parse(localStorage.getItem(k) || JSON.stringify(d));
  } catch (e) {
    return d;
  }
}
const EVIDENCE_HEAVY_FIELDS = new Set([
  'dataUrl',
  'data_url',
  'imageDataUrl',
  'image_data_url',
  'base64',
  'image',
  'fileData',
  'blob',
  'raw',
  'content'
]);
function isEvidenceKey(k) {
  return k === LS.ev || k === 'ribre_evidences180' || k === 'ribre_full_evidences221';
}
function sanitizeEvidenceRecord(x) {
  const src = x && typeof x === 'object' ? x : {};
  const out = {
    id: src.id || '',
    fileName: src.fileName || '',
    mime: src.mime || '',
    kind: src.kind || '',
    at: src.at || ''
  };
  const url = typeof src.evidence_url === 'string' ? src.evidence_url : '';
  if (url && !/^data:/i.test(url)) out.evidence_url = url;
  return out;
}
function sanitizeEvidenceList(v) {
  const rows = Array.isArray(v) ? v : [];
  return rows.map(sanitizeEvidenceRecord).slice(0, 100);
}
function setLS(k, v) {
  const isEv = isEvidenceKey(k);
  const payload = isEv ? sanitizeEvidenceList(v) : v;
  const text = JSON.stringify(payload);
  try {
    localStorage.setItem(k, text);
    return;
  } catch (e) {
    const isQuota = !!(e && (e.name === 'QuotaExceededError' || e.code === 22 || String(e.message || '').includes('quota')));
    if (!isEv || !isQuota) throw e;
  }
  const rows = sanitizeEvidenceList(v);
  const attempts = [100, 80, 60, 40, 20, 0];
  for (let i = 0; i < attempts.length; i++) {
    const n = attempts[i];
    try {
      localStorage.setItem(k, JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
      return;
    } catch (e) {}
  }
  try {
    localStorage.removeItem('ribre_evidences180');
    localStorage.removeItem('ribre_full_evidences221');
  } catch (e) {}
  try {
    localStorage.setItem(k, '[]');
  } catch (e) {}
}
function sales() { return get(LS.sales, []); }
function purchases() { return get(LS.purchases, []); }
function evidences() { return get(LS.ev, []); }
function candidates() { return get(LS.cand, []); }
function createLocalSnapshot(reason) {
  const snap = {
    reason: String(reason || 'manual'),
    createdAt: new Date().toISOString(),
    createdAtLocal: new Date().toLocaleString('ja-JP'),
    sales: sales(),
    purchases: purchases(),
    yahooSales: get('ribre_yahoo_sales240', []),
    evidences: evidences(),
    candidates: candidates()
  };
  const rows = get('ribre_auto_snapshots_v1', []);
  rows.unshift(snap);
  try {
    localStorage.setItem('ribre_auto_snapshots_v1', JSON.stringify(rows.slice(0, 3)));
  } catch (e) {
    try {
      const light = rows.slice(0, 5).map((x) => ({
        reason: x.reason,
        createdAt: x.createdAt,
        createdAtLocal: x.createdAtLocal,
        salesCount: (x.sales || []).length,
        purchasesCount: (x.purchases || []).length
      }));
      localStorage.setItem('ribre_auto_snapshots_v1', JSON.stringify(light));
    } catch (err) {}
  }
  return snap;
}
/* 既定のSupabase接続（公開用 publishable キー。RLSで保護）。設定画面で上書きも可能 */
var SB_DEFAULT = { url: 'https://wjsfunuzosyuknlzglyl.supabase.co', key: 'sb_publishable_aaEHWK1idj8w-9V4jQd6qg_kYMknHPk' };
function sb() {
  var v = get(LS.sb, {});
  if (v && v.url && v.key) return v;
  return SB_DEFAULT;
}
/* 設定が空なら既定のSupabase接続をlocalStorageへ自動セット
   （ver460/ver500等は localStorage を直接読むため、ここで入れておく） */
(function seedSupabaseConfig() {
  try {
    var cur = JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
    if (!cur || !cur.url || !cur.key) {
      localStorage.setItem('ribre_supabase_config_v121', JSON.stringify(SB_DEFAULT));
    }
  } catch (e) {}
})();
function sess() {
  const s = get(LS.sess, {});
  if (s && s.access_token) return s;
  if (s && s.session && s.session.access_token) {
    return Object.assign({}, s, {
      access_token: s.session.access_token,
      refresh_token: s.session.refresh_token || s.refresh_token || '',
      user: s.user || s.session.user || null
    });
  }
  return s || {};
}
function email() {
  const s = sess();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function role() {
  const s = sess();
  return s.role || localStorage.getItem('ribre_current_role140') || 'staff';
}
function renderList(id, rows) {
  document.getElementById(id).innerHTML = (rows || [])
    .map(
      (r) =>
        '<div class="row ' +
        safeLevel(r.level) +
        '"><span>' +
        escHtml(r.msg) +
        '</span><span class="badge">' +
        escHtml(r.type) +
        '</span></div>'
    )
    .join('');
}
function showSec(id, btn) {
  document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  document.querySelectorAll('nav button').forEach((b) => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  refreshAll();
}
function csvDownload(rows, name) {
  const csv = rows
    .map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(','))
    .join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
}
