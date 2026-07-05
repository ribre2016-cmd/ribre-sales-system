/* =====================================================================
 * Supabase sales テーブル × localStorage ドリフト突合スクリプト（読み取り専用）
 *
 * 使い方:
 *  1. https://ribre-sales-system.vercel.app の「存在しないパス」(例: /__probe__) を
 *     ログイン済みブラウザで開く。
 *     ※ アプリ本体ページ(/ や /app)で実行しないこと。開いた時点で
 *       data-store.js の hydrate() がクラウド内容で localStorage を置換するため、
 *       「置換前のローカル実態」との比較にならない。404ページなら
 *       同一オリジンで localStorage は読めるがアプリスクリプトは動かない。
 *  2. DevTools コンソールに全文貼り付けて実行。
 *
 * 出力: 行数・月別合計（ローカル/クラウド）・重複グループ・client_id形態の分布。
 * 何も書き込まない（fetchはGETのみ、localStorageへのsetItemなし）。
 *
 * 2026-07-05 の調査結果（このスクリプトの元になった手動実行）:
 *  - ローカル 3,210行 / クラウド 6,420行（ちょうど2倍）
 *  - 内訳: client_id=null 3,210行（2026-07-01作成・source「かんたん」・
 *    smpUploadAllToCloud 由来＝client_id無しでupsert）
 *    ＋ client_id=db_<id> 3,210行(data-store.jsのpushSafe由来)
 *  - db_行はlocalStorageと全フィールド一致。null行は全てdb_行の内容重複。
 *  - クリーンアップは supabase_cleanup_sales_null_cid.sql を参照。
 * ===================================================================== */
(async () => {
  const g = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const cfg = g('ribre_supabase_config_v121') || {};
  const sess = g('ribre_auth_session140') || {};
  const tok = sess.access_token || (sess.session && sess.session.access_token);
  if (!cfg.url || !tok) { console.error('未ログイン、または Supabase 設定なし'); return; }
  const email = (sess.user && sess.user.email) || (sess.session && sess.session.user && sess.session.user.email);
  const H = { apikey: cfg.key, Authorization: 'Bearer ' + tok };

  async function fetchAll(q) {
    let all = [], page = 0;
    while (page < 200) {
      const r = await fetch(cfg.url.replace(/\/$/, '') + '/rest/v1/' + q + '&limit=1000&offset=' + page * 1000, { headers: H });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
      const rows = await r.json(); all = all.concat(rows);
      if (rows.length < 1000) break; page++;
    }
    return all;
  }

  const e = encodeURIComponent(email);
  const cloud = await fetchAll('sales?select=id,client_id,sale_date,month,amount,fee,shipping_fee,item_name,source,created_at,updated_at&user_email=eq.' + e + '&order=id.asc');
  const local = g('ribre_full_sales221') || [];
  const monthOf = r => r.month || String(r.sale_date || r.date || '').slice(0, 7);
  const agg = rows => { const t = {}; rows.forEach(r => { const m = monthOf(r); (t[m] = t[m] || { n: 0, amt: 0 }); t[m].n++; t[m].amt += Number(r.amount) || 0; }); return t; };

  // 内容キー（日付|商品名|金額）で重複グループ化
  const byContent = {};
  cloud.forEach(r => { const k = (r.sale_date || '') + '|' + (r.item_name || '') + '|' + r.amount; (byContent[k] = byContent[k] || []).push(r); });
  const dupGroups = Object.values(byContent).filter(gr => gr.length > 1);

  // client_id 形態の分布（null / db_ / h_s / その他）
  const pref = {};
  cloud.forEach(r => { const c = r.client_id; const k = c == null ? 'NULL' : (String(c).match(/^(db_|h_s|h_)/) || ['literal'])[0]; pref[k] = (pref[k] || 0) + 1; });

  // ローカル ↔ クラウド(client_id付き行) の cid 突合＋フィールド一致検証
  const byCid = {}; cloud.forEach(r => { if (r.client_id != null) byCid[r.client_id] = r; });
  let mismatch = 0, missing = 0;
  const eqn = (a, b) => (Number(a) || 0) === (Number(b) || 0);
  local.forEach(l => {
    const c = byCid[String(l.client || l.id)];
    if (!c) { missing++; return; }
    if (!(eqn(l.amount, c.amount) && eqn(l.fee, c.fee) && eqn(l.shipping != null ? l.shipping : l.ship, c.shipping_fee)
      && String(l.date || '') === String(c.sale_date || '') && String(l.name || '') === String(c.item_name || ''))) mismatch++;
  });

  console.log('=== sales ドリフト突合 ===');
  console.table({ ローカル行数: local.length, クラウド行数: cloud.length, 重複グループ: dupGroups.length, 重複による余分行: dupGroups.reduce((s, g2) => s + g2.length - 1, 0), ローカルに無いcid行: Object.keys(byCid).length - (local.length - missing), クラウドに無いローカル行: missing, フィールド不一致: mismatch });
  console.log('client_id 形態分布:', pref);
  console.log('月別合計(ローカル):', agg(local.map(r => ({ month: r.month, sale_date: r.date, amount: r.amount }))));
  console.log('月別合計(クラウド):', agg(cloud));
  console.log('重複サンプル(3グループ):', dupGroups.slice(0, 3));
})();
