/* RIBRE — OCR pages 移行（Phase3: ver500 ヘルパー関数の最終定義を pages 側へ集約） */
function ver500Render(rows) {
  const box = document.getElementById('aiAuto50List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver500Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver500Candidates() {
  try {
    return JSON.parse(localStorage.getItem('ribre_ai_auto_candidates500') || '[]');
  } catch (e) {
    return [];
  }
}
function ver500DraftRoutes() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_draft_routes_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500RouteLabel(sourceType) {
  const t = String(sourceType || 'unknown');
  if (t === 'sale') return '売上';
  if (t === 'purchase') return '仕入';
  if (t === 'shipping') return '配送';
  if (t === 'receipt') return '証憑';
  return '未分類';
}
function ver500NormalizeRouteEntry(x) {
  const src = x && typeof x === 'object' ? x : {};
  const normStatus = (v) => {
    const s = String(v || 'draft');
    if (s === 'confirmed' || s === 'ignored') return s;
    return 'draft';
  };
  return {
    id: String(src.id || 'route_' + Date.now()),
    createdAt: String(src.createdAt || new Date().toISOString()),
    sourceType: String(src.sourceType || 'unknown'),
    category: String(src.category || 'unknown'),
    date: String(src.date || ''),
    amount: ver500Num(src.amount),
    shipping: ver500Num(src.shipping),
    trackingNumber: ver500NormalizeTracking(src.trackingNumber || ''),
    storeName: String(src.storeName || ''),
    itemTitle: String(src.itemTitle || ''),
    status: normStatus(src.status),
    evidence_url: String(src.evidence_url || ''),
    note: String(src.note || '')
  };
}
function ver500SaveDraftRoutes(arr) {
  const rows = (arr || []).map(ver500NormalizeRouteEntry).slice(0, 100);
  const save = (n) => localStorage.setItem('ribre_ocr_draft_routes_v1', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(100);
    return;
  } catch (e) {
    if (!(e && e.name === 'QuotaExceededError')) return;
  }
  try {
    save(50);
    return;
  } catch (e) {}
  try {
    save(20);
    return;
  } catch (e) {}
  try {
    save(0);
  } catch (e) {}
}
function ver500CreateDraftRouteFromCandidate(candidate) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const sourceType = String(c.sourceType || 'unknown');
  return ver500NormalizeRouteEntry({
    id: 'route_' + Date.now(),
    createdAt: new Date().toISOString(),
    sourceType,
    category: c.category || 'unknown',
    date: c.date || '',
    amount: c.amount || 0,
    shipping: c.shipping || 0,
    trackingNumber: c.slip || c.trackingNumber || '',
    storeName: c.partner || c.storeName || '',
    itemTitle: c.item || c.itemTitle || '',
    status: 'draft',
    evidence_url: c.evidence_url || '',
    note: c.memo || ''
  });
}
function ver500UpsertDraftRoute(route) {
  const row = ver500NormalizeRouteEntry(route);
  const rows = ver500DraftRoutes().filter((x) => String(x.id || '') !== row.id);
  rows.unshift(row);
  ver500SaveDraftRoutes(rows);
  return row;
}
function ver500RenderDraftRouteList() {
  const rows = ver500DraftRoutes();
  const draftRows = rows.filter((x) => x.status === 'draft');
  const select = document.getElementById('ver500DraftSelect');
  if (select) {
    select.innerHTML = '';
    draftRows.forEach((x) => {
      const op = document.createElement('option');
      op.value = x.id;
      op.textContent =
        (x.date || '日付不明') +
        ' / ' +
        ver500RouteLabel(x.sourceType) +
        ' / ' +
        (x.storeName || '-') +
        ' / ' +
        (x.amount || 0) +
        '円';
      select.appendChild(op);
    });
  }
  if (!draftRows.length) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: 'draft候補はありません' }]);
    return;
  }
  const listRows = draftRows.slice(0, 50).map((x) => ({
    type: '仮登録',
    msg:
      '登録先: ' +
      ver500RouteLabel(x.sourceType) +
      ' / 状態: ' +
      x.status +
      ' / ' +
      (x.date || '') +
      ' / ' +
      (x.storeName || '-') +
      ' / ' +
      (x.amount || 0) +
      '円'
  }));
  ver500Render(listRows);
}
function ver500ShowDraftRoutes() {
  return ver500RenderDraftRouteList();
}
function ver500EnsureDraftButtons() {
  if (document.getElementById('ver500ShowDraftRoutesBtn')) return;
  const sec = document.getElementById('aiauto50');
  if (!sec) return;
  const controls = sec.querySelector('.controls');
  if (!controls) return;
  const showBtn = document.createElement('button');
  showBtn.id = 'ver500ShowDraftRoutesBtn';
  showBtn.textContent = 'OCR仮登録一覧';
  showBtn.onclick = () => ver500RenderDraftRouteList();
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'ver500ConfirmDraftBtn';
  confirmBtn.textContent = '選択候補を確定';
  confirmBtn.className = 'green';
  confirmBtn.onclick = () => ver500ConfirmSelectedDraft();
  const select = document.createElement('select');
  select.id = 'ver500DraftSelect';
  controls.appendChild(showBtn);
  controls.appendChild(confirmBtn);
  controls.appendChild(select);
}
function ver500SaveCandidates(arr) {
  const sanitizeCandidate = (c) => {
    const x = Object.assign({}, c || {});
    if (!x.evidence_url && x.evidenceUrl) x.evidence_url = x.evidenceUrl;
    delete x.dataUrl;
    delete x.data_url;
    delete x.imageDataUrl;
    delete x.image_data_url;
    delete x.base64;
    delete x.image;
    delete x.fileData;
    return x;
  };
  const rows = (arr || [])
    .map((x) => {
      const item = Object.assign({}, x || {});
      if (item.candidate) item.candidate = sanitizeCandidate(item.candidate);
      delete item.dataUrl;
      delete item.base64;
      return item;
    })
    .slice(0, 50);

  try {
    localStorage.setItem('ribre_ai_auto_candidates500', JSON.stringify(rows));
    return;
  } catch (e) {
    if (!(e && e.name === 'QuotaExceededError')) throw e;
  }

  let reduced = rows.slice(0, 30);
  let saved = false;
  while (!saved && reduced.length > 0) {
    try {
      localStorage.setItem('ribre_ai_auto_candidates500', JSON.stringify(reduced));
      saved = true;
      break;
    } catch (e) {
      if (!(e && e.name === 'QuotaExceededError')) throw e;
      reduced = reduced.slice(0, Math.max(1, reduced.length - 10));
    }
  }

  if (!saved) {
    localStorage.removeItem('ribre_ai_auto_candidates500');
    localStorage.setItem('ribre_ai_auto_candidates500', '[]');
  }

  if (typeof ver500Render === 'function') {
    ver500Render([{ type: '容量', level: 'warn', msg: '保存容量がいっぱいです。古い候補を削除しました' }]);
  }
}
function ver500Num(v) {
  const base =
    typeof window.ribreNormalizeOcrMoney === 'function'
      ? window.ribreNormalizeOcrMoney(v)
      : Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  const n = Number(base);
  return Number.isFinite(n) ? n : 0;
}
function ver500NormalizeTracking(v) {
  if (typeof window.ribreNormalizeTrackingNumber === 'function') return window.ribreNormalizeTrackingNumber(v);
  return String(v || '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[ー－―−‐\-_\s]/g, '')
    .trim();
}
function ver500NormalizeDate(v) {
  if (typeof window.ribreNormalizeOcrDate === 'function') return window.ribreNormalizeOcrDate(v);
  const s = String(v || '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
  const m = s.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!m) return '';
  return m[1] + '-' + String(Number(m[2])).padStart(2, '0') + '-' + String(Number(m[3])).padStart(2, '0');
}
function ver500CleanJsonText(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  return t.replace(/,\s*([}\]])/g, '$1');
}
function ver500ParseJsonLoose(text) {
  if (typeof window.ribreExtractOcrJson === 'function') return window.ribreExtractOcrJson(text);
  const t = ver500CleanJsonText(text);
  try {
    return JSON.parse(t);
  } catch (e) {
    return null;
  }
}
function ver500NormalizeSchema(raw) {
  if (typeof window.ribreNormalizeOcrSchema === 'function') return window.ribreNormalizeOcrSchema(raw);
  const x = raw && typeof raw === 'object' ? raw : {};
  const textPool = [x.storeName, x.partner, x.vendor, x.itemTitle, x.item, x.itemName, x.note, x.memo]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
  const kindRaw = String(x.kind || '').toLowerCase();
  const srcRaw = String(x.sourceType || '').toLowerCase();
  let sourceType = 'unknown';
  if (srcRaw === 'sale' || srcRaw === 'purchase' || srcRaw === 'shipping' || srcRaw === 'receipt') sourceType = srcRaw;
  else if (/ヤマト|佐川|追跡|伝票|送り状|送料/.test(textPool)) sourceType = 'shipping';
  else if (/領収|レシート/.test(textPool)) sourceType = 'receipt';
  else if (/仕入|買取|請求|駿河屋|bookoff|ブックオフ/.test(textPool)) sourceType = 'purchase';
  else if (/ヤフオク|メルカリ|売上|落札|入金/.test(textPool)) sourceType = 'sale';
  const categoryRaw = String(x.category || '').toLowerCase();
  let category = categoryRaw || 'unknown';
  if (category === 'unknown') {
    if (/ヤフオク/.test(textPool)) category = 'yahoo_sale';
    else if (/メルカリ/.test(textPool)) category = 'mercari_sale';
    else if (/駿河屋/.test(textPool)) category = 'surugaya_purchase';
    else if (/bookoff|ブックオフ/.test(textPool)) category = 'bookoff_purchase';
    else if (/ヤマト/.test(textPool)) category = 'yamato_shipping';
    else if (/佐川/.test(textPool)) category = 'sagawa_shipping';
    else if (/領収|レシート/.test(textPool)) category = 'receipt';
    else if (/請求|invoice/.test(textPool)) category = 'invoice';
  }
  return {
    kind: kindRaw === 'sale' ? 'sale' : kindRaw === 'purchase' ? 'purchase' : sourceType === 'sale' ? 'sale' : sourceType === 'purchase' ? 'purchase' : 'unknown',
    category,
    sourceType,
    storeName: String(x.storeName || x.partner || x.vendor || ''),
    date: ver500NormalizeDate(x.date),
    amount: ver500Num(x.amount),
    shipping: ver500Num(x.shipping),
    trackingNumber: ver500NormalizeTracking(x.trackingNumber || x.slip || x.invoiceNo || ''),
    itemTitle: String(x.itemTitle || x.item || x.itemName || ''),
    itemCount: Number.isFinite(Number(x.itemCount)) ? Math.max(0, Number(x.itemCount)) : 0,
    paymentMethod: String(x.paymentMethod || ''),
    note: String(x.note || x.memo || '')
  };
}
function ver500SchemaToCandidate(schema, options = {}) {
  const s = ver500NormalizeSchema(schema);
  const forced = String(options.forcedKind || '');
  const candidateKind = forced && forced !== 'auto' ? forced : s.kind === 'sale' ? 'sale' : s.kind === 'purchase' ? 'purchase' : 'expense';
  const memoParts = [];
  if (s.note) memoParts.push(s.note);
  if (s.paymentMethod) memoParts.push('支払:' + s.paymentMethod);
  if (s.shipping) memoParts.push('送料:' + s.shipping);
  if (s.itemCount) memoParts.push('数量:' + s.itemCount);
  if (s.category) memoParts.push('カテゴリ:' + s.category);
  if (s.sourceType) memoParts.push('種別:' + s.sourceType);
  return {
    kind: candidateKind,
    category: s.category || 'unknown',
    sourceType: s.sourceType || 'unknown',
    status: 'draft',
    date: s.date || '',
    partner: s.storeName || '',
    item: s.itemTitle || 'AI読取候補',
    amount: ver500Num(s.amount),
    slip: ver500NormalizeTracking(s.trackingNumber || ''),
    evidence_url: String(options.evidenceUrl || ''),
    file_name: String(options.fileName || ''),
    memo: memoParts.join(' / ')
  };
}
function ver500LatestStorage() {
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
  } catch (e) {}
  return arr[0] || null;
}
function ver500LoadLatestStorage() {
  const latest = ver500LatestStorage();
  if (!latest) {
    alert('Storage保存済みファイルがありません');
    return;
  }
  document.getElementById('ver500EvidenceUrl').value = latest.url || '';
  ver500Set('ver500Status', 'Storage読込OK');
  ver500Render([
    { type: 'Storage', msg: '最新証憑を読み込みました：' + latest.name },
    { type: 'URL', msg: latest.url }
  ]);
}
function ver500ReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
function ver500BuildCacheMeta(file, evidenceUrl) {
  const latest = ver500LatestStorage() || {};
  return {
    fileName: (file && file.name) || latest.name || '',
    size: Number((file && file.size) || latest.size || 0),
    mime: (file && (file.type || '')) || latest.mime || latest.type || '',
    type: (file && (file.type || '')) || latest.type || '',
    lastModified: Number((file && file.lastModified) || latest.lastModified || 0),
    evidence_url: evidenceUrl || latest.url || ''
  };
}
function ver500ExtractByRules(text) {
  const t = String(text || '');
  const dateRaw = (t.match(/20\d{2}[\/\-年]\d{1,2}[\/\-月]\d{1,2}/) || [])[0] || '';
  const amountRaw = (t.match(/(?:合計|請求額|税込|お買上計)[^0-9¥￥]*([¥￥]?\s?[0-9,０-９]+)/) || [])[1] || (t.match(/[¥￥]?\s?[0-9,０-９]{3,}/) || [])[0] || '';
  const shippingRaw = (t.match(/(?:送料|運賃)[^0-9¥￥]*([¥￥]?\s?[0-9,０-９]+)/) || [])[1] || '';
  const trackingRaw =
    (t.match(/(?:伝票|追跡|お問い合わせ|問合せ|送り状|荷物番号)[^0-9０-９A-Z\- ]*([0-9０-９\- ]{8,})/i) || [])[1] ||
    (t.match(/[0-9０-９]{3,4}[-\s]?[0-9０-９]{3,4}[-\s]?[0-9０-９]{3,5}/) || [])[0] ||
    '';
  const storeName =
    (t.match(/(?:株式会社[^\s　]+|[^\s　]+株式会社|[^\s　]+商店|ヤマト運輸|佐川急便|日本郵便|ローソン|ファミリーマート|セブン-?イレブン)/) || [])[0] ||
    '';
  const paymentMethod =
    (t.match(/(?:現金|クレジット|クレカ|Visa|Master|JCB|AMEX|PayPay|楽天ペイ|d払い|交通系|電子マネー|代引き|代金引換)/i) || [])[0] || '';
  let kind = 'unknown';
  if (/売上|落札|ヤフオク|メルカリ|入金/.test(t)) kind = 'sale';
  else if (/仕入|請求|古物|買取|駿河屋|購入|領収/.test(t)) kind = 'purchase';
  let sourceType = 'unknown';
  if (/ヤマト|佐川|追跡|伝票|送り状|送料/.test(t)) sourceType = 'shipping';
  else if (/領収|レシート/.test(t)) sourceType = 'receipt';
  else if (kind === 'sale') sourceType = 'sale';
  else if (kind === 'purchase') sourceType = 'purchase';
  let category = 'unknown';
  if (/ヤフオク/.test(t)) category = 'yahoo_sale';
  else if (/メルカリ/.test(t)) category = 'mercari_sale';
  else if (/駿河屋/.test(t)) category = 'surugaya_purchase';
  else if (/BOOKOFF|ブックオフ/i.test(t)) category = 'bookoff_purchase';
  else if (/ヤマト/.test(t)) category = 'yamato_shipping';
  else if (/佐川/.test(t)) category = 'sagawa_shipping';
  else if (/領収|レシート/.test(t)) category = 'receipt';
  else if (/請求|invoice/i.test(t)) category = 'invoice';
  const trackingNorm = ver500NormalizeTracking(trackingRaw);
  return {
    kind,
    category,
    sourceType,
    storeName: storeName || '',
    date: ver500NormalizeDate(dateRaw || new Date().toISOString().slice(0, 10)),
    amount: ver500Num(amountRaw),
    shipping: ver500Num(shippingRaw),
    trackingNumber: sourceType === 'shipping' ? trackingNorm || ver500NormalizeTracking((t.match(/[0-9０-９]{10,14}/) || [])[0] || '') : trackingNorm,
    itemTitle: 'AI読取候補',
    itemCount: 0,
    paymentMethod,
    note: 'ルール抽出'
  };
}
async function ver500OpenAiAnalyze(inputText, imageDataUrl) {
  const key = localStorage.getItem('ribre_openai_key200') || localStorage.getItem('ribre_openai_key180') || '';
  if (!key) return null;

  const prompt =
    'あなたは日本の売上管理OCRです。必ずJSONのみ返すこと。説明文は禁止。推測は禁止。存在しない値は null。' +
    '日本のEC/配送/買取伝票を想定し、category/sourceTypeを推定してください。不明時は unknown。' +
    '出力schemaは次のみ: {"kind":"sale|purchase|unknown","category":"yahoo_sale|mercari_sale|surugaya_purchase|bookoff_purchase|yamato_shipping|sagawa_shipping|receipt|invoice|unknown","sourceType":"sale|purchase|shipping|receipt|unknown","storeName":"","date":"","amount":0,"shipping":0,"trackingNumber":"","itemTitle":"","itemCount":0,"paymentMethod":"","note":""}';

  let input;
  const hasImageInput = !!(imageDataUrl && (/^data:image\//i.test(String(imageDataUrl)) || /^https?:\/\//i.test(String(imageDataUrl))));
  if (hasImageInput) {
    input = [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt },
          { type: 'input_image', image_url: imageDataUrl }
        ]
      }
    ];
  } else {
    input = prompt + '\nテキスト:' + inputText;
  }

  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input, temperature: 0 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || JSON.stringify(data));
    let out = data.output_text || '';
    if (!out && data.output)
      out = data.output
        .map((o) => (o.content || []).map((c) => c.text || '').join('\n'))
        .join('\n');
    const parsed = ver500ParseJsonLoose(out);
    if (!parsed) throw new Error('JSON解析失敗');
    return ver500NormalizeSchema(parsed);
  } catch (e) {
    return { error: e.message };
  }
}
async function ver500AnalyzeEvidence() {
  ver500Set('ver500Status', '解析中');
  ver500Render([{ type: 'AI', level: 'warn', msg: 'AI解析中です' }]);

  const file = document.getElementById('ver500File').files[0];
  const evidenceUrl = document.getElementById('ver500EvidenceUrl').value || '';
  let dataUrl = '',
    text = evidenceUrl;

  if (file) {
    if (file.type.startsWith('image/')) {
      dataUrl = await ver500ReadFileAsDataUrl(file);
    }
    text += ' ' + file.name;
  }

  const cacheMeta = ver500BuildCacheMeta(file, evidenceUrl);
  const cacheKey =
    typeof window.ribreOcrBuildCacheKey === 'function'
      ? window.ribreOcrBuildCacheKey(cacheMeta)
      : '';
  if (cacheKey && typeof window.ribreOcrGetCachedResult === 'function') {
    const cached = window.ribreOcrGetCachedResult(cacheKey, 'ver500');
    if (cached && cached.resultJson && typeof cached.resultJson === 'object') {
      const forced = document.getElementById('ver500Kind').value;
      const ai = ver500SchemaToCandidate(cached.resultJson, {
        forcedKind: forced,
        evidenceUrl,
        fileName: cacheMeta.fileName
      });
      const route = ver500UpsertDraftRoute(ver500CreateDraftRouteFromCandidate(ai));
      document.getElementById('ver500Kind').value = ai.kind || 'auto';
      document.getElementById('ver500Date').value = ai.date || '';
      document.getElementById('ver500Partner').value = ai.partner || '';
      document.getElementById('ver500Item').value = ai.item || '';
      document.getElementById('ver500Amount').value = ai.amount || 0;
      document.getElementById('ver500Slip').value = ai.slip || '';
      const arr = ver500Candidates();
      arr.unshift({ at: new Date().toLocaleString('ja-JP'), candidate: ai });
      ver500SaveCandidates(arr);
      ver500Set('ver500ResultKind', ai.kind || '不明');
      ver500Set('ver500CandidateCount', arr.length + '件');
      ver500Set('ver500RegisterTarget', ai.kind === 'sale' ? '売上' : ai.kind === 'purchase' ? '仕入' : ai.kind);
      ver500Set('ver500Status', 'キャッシュ使用');
      const cacheRows = [
        { type: 'AI', msg: 'キャッシュ結果を使用しました' },
        { type: '分類', msg: 'AI判定：' + (ai.kind || '不明') },
        { type: '仮登録', msg: '登録先: ' + ver500RouteLabel(route.sourceType) },
        { type: '仮登録', msg: '状態: ' + route.status },
        { type: '日付', msg: ai.date || '' },
        { type: '相手先', msg: ai.partner || '' },
        { type: '内容', msg: ai.item || '' },
        { type: '金額', msg: String(ai.amount || 0) + '円' },
        { type: '証憑', msg: ai.evidence_url || 'なし' }
      ];
      if (ai.category) cacheRows.push({ type: '分類', msg: 'category: ' + ai.category });
      if (ai.sourceType) cacheRows.push({ type: '分類', msg: 'sourceType: ' + ai.sourceType });
      ver500Render(cacheRows);
      return;
    }
  }

  let imageInput = dataUrl;
  if (!imageInput && evidenceUrl && (/^data:image\//i.test(evidenceUrl) || /\.(png|jpe?g|webp|gif|bmp|svg)(\?|#|$)/i.test(evidenceUrl))) {
    imageInput = evidenceUrl;
  }
  if (imageInput && typeof window.ribreOptimizeOcrImage === 'function') {
    ver500Render([{ type: 'AI', level: 'warn', msg: '画像最適化中...' }]);
    await new Promise((r) => requestAnimationFrame(r));
    try {
      const optimized = await window.ribreOptimizeOcrImage(imageInput);
      const optimizeStats = {
        originalBytes: optimized.originalBytes,
        optimizedBytes: optimized.optimizedBytes
      };
      if (!optimizeStats.originalBytes && !optimizeStats.optimizedBytes) {
        // keep silent and continue with original image input
      }
      if (optimized && optimized.imageUrl) imageInput = optimized.imageUrl;
    } catch (e) {}
    ver500Render([{ type: 'AI', level: 'warn', msg: 'AI解析中です' }]);
  }

  let aiSchema = await ver500OpenAiAnalyze(text, imageInput);
  let fallback = ver500ExtractByRules(text);
  if (!aiSchema || aiSchema.error) {
    aiSchema = Object.assign({}, fallback, { note: aiSchema && aiSchema.error ? 'AI失敗: ' + aiSchema.error + ' / ルール抽出' : fallback.note });
  }
  aiSchema = ver500NormalizeSchema(aiSchema);
  if (aiSchema.kind === 'unknown' && fallback.kind !== 'unknown') aiSchema.kind = fallback.kind;
  if (!aiSchema.date && fallback.date) aiSchema.date = fallback.date;
  if (!aiSchema.storeName && fallback.storeName) aiSchema.storeName = fallback.storeName;
  if (!aiSchema.itemTitle && fallback.itemTitle) aiSchema.itemTitle = fallback.itemTitle;
  if (!aiSchema.amount && fallback.amount) aiSchema.amount = fallback.amount;
  if (!aiSchema.trackingNumber && fallback.trackingNumber) aiSchema.trackingNumber = fallback.trackingNumber;

  const forced = document.getElementById('ver500Kind').value;
  const ai = ver500SchemaToCandidate(aiSchema, {
    forcedKind: forced,
    evidenceUrl,
    fileName: file ? file.name : ver500LatestStorage()?.name || ''
  });
  const route = ver500UpsertDraftRoute(ver500CreateDraftRouteFromCandidate(ai));
  if (cacheKey && typeof window.ribreOcrSaveCachedResult === 'function') {
    window.ribreOcrSaveCachedResult({
      cacheKey,
      fileName: cacheMeta.fileName,
      size: cacheMeta.size,
      kind: 'ver500',
      resultJson: aiSchema
    });
  }

  document.getElementById('ver500Kind').value = ai.kind || 'auto';
  document.getElementById('ver500Date').value = ai.date || '';
  document.getElementById('ver500Partner').value = ai.partner || '';
  document.getElementById('ver500Item').value = ai.item || '';
  document.getElementById('ver500Amount').value = ai.amount || 0;
  document.getElementById('ver500Slip').value = ai.slip || '';

  const arr = ver500Candidates();
  arr.unshift({ at: new Date().toLocaleString('ja-JP'), candidate: ai });
  ver500SaveCandidates(arr);

  ver500Set('ver500ResultKind', ai.kind || '不明');
  ver500Set('ver500CandidateCount', arr.length + '件');
  ver500Set('ver500RegisterTarget', ai.kind === 'sale' ? '売上' : ai.kind === 'purchase' ? '仕入' : ai.kind);
  ver500Set('ver500Status', '解析OK');

  const rows = [
    { type: '分類', msg: 'AI判定：' + ai.kind },
    { type: '仮登録', msg: '登録先: ' + ver500RouteLabel(route.sourceType) },
    { type: '仮登録', msg: '状態: ' + route.status },
    { type: '日付', msg: ai.date || '' },
    { type: '相手先', msg: ai.partner || '' },
    { type: '内容', msg: ai.item || '' },
    { type: '金額', msg: String(ai.amount || 0) + '円' },
    { type: '証憑', msg: ai.evidence_url || 'なし' }
  ];
  if (ai.category) rows.push({ type: '分類', msg: 'category: ' + ai.category });
  if (ai.sourceType) rows.push({ type: '分類', msg: 'sourceType: ' + ai.sourceType });
  ver500Render(rows);
}
function ver500ConfirmSelectedDraft() {
  const select = document.getElementById('ver500DraftSelect');
  const targetId = select && select.value ? select.value : '';
  const rows = ver500DraftRoutes();
  const row = rows.find((x) => String(x.id || '') === targetId) || rows.find((x) => x.status === 'draft');
  if (!row) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: '確定できる候補がありません' }]);
    return;
  }
  if (row.sourceType === 'unknown') {
    ver500Render([{ type: '仮登録', level: 'warn', msg: 'unknown は確定できません。内容を確認してください' }]);
    return;
  }
  if (row.sourceType === 'receipt') {
    const updated = Object.assign({}, row, { status: 'confirmed' });
    ver500UpsertDraftRoute(updated);
    ver500Render([{ type: '仮登録', msg: '証憑候補として確定しました' }]);
    return;
  }
  if (row.sourceType === 'shipping') {
    let shippingRows = [];
    try {
      shippingRows = JSON.parse(localStorage.getItem('ribre_shipping_rows230') || '[]');
    } catch (e) {}
    shippingRows.unshift({
      id: row.id,
      date: row.date || today(),
      itemId: '',
      slip: row.trackingNumber || '',
      trackingNumber: row.trackingNumber || '',
      shippingCompany: /ヤマト/.test(String(row.category || '')) ? 'ヤマト' : /佐川/.test(String(row.category || '')) ? '佐川' : '',
      shipping: ver500Num(row.shipping || row.amount || 0),
      amount: ver500Num(row.shipping || row.amount || 0),
      status: 'OCR仮登録',
      evidence_url: row.evidence_url || '',
      note: row.note || '',
      at: new Date().toLocaleString('ja-JP')
    });
    localStorage.setItem('ribre_shipping_rows230', JSON.stringify(shippingRows.slice(0, 1000)));
    const updated = Object.assign({}, row, { status: 'confirmed' });
    ver500UpsertDraftRoute(updated);
    ver500Render([{ type: '仮登録', msg: '配送候補として確定しました' }]);
    return;
  }
  document.getElementById('ver500Kind').value = row.sourceType === 'sale' ? 'sale' : 'purchase';
  document.getElementById('ver500Date').value = row.date || '';
  document.getElementById('ver500Partner').value = row.storeName || '';
  document.getElementById('ver500Item').value = row.itemTitle || '';
  document.getElementById('ver500Amount').value = row.amount || 0;
  document.getElementById('ver500Slip').value = row.trackingNumber || '';
  document.getElementById('ver500EvidenceUrl').value = row.evidence_url || '';
  ver500ApplyCandidate();
  const updated = Object.assign({}, row, { status: 'confirmed' });
  ver500UpsertDraftRoute(updated);
  ver500Set('ver500Status', '確定OK');
}
function ver500ConfirmDraftRoute() {
  return ver500ConfirmSelectedDraft();
}
function ver500CurrentCandidate() {
  return {
    kind:
      document.getElementById('ver500Kind').value === 'auto'
        ? 'expense'
        : document.getElementById('ver500Kind').value,
    status: 'draft',
    date: document.getElementById('ver500Date').value,
    partner: document.getElementById('ver500Partner').value,
    item: document.getElementById('ver500Item').value,
    amount: ver500Num(document.getElementById('ver500Amount').value),
    slip: document.getElementById('ver500Slip').value,
    evidence_url: document.getElementById('ver500EvidenceUrl').value,
    memo: 'AI自動登録 Ver60.0'
  };
}
function ver500ApplyCandidate() {
  const c = ver500CurrentCandidate();
  if (!c.date || !c.amount) {
    alert('日付と金額を確認してください');
    return;
  }

  if (c.kind === 'sale') {
    let s = [];
    try {
      s = JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]');
    } catch (e) {}
    s.unshift({
      id: 'ai_' + Date.now(),
      itemId: '',
      date: c.date,
      month: String(c.date).slice(0, 7),
      shop: 'AI/OCR',
      name: c.item,
      amount: c.amount,
      price: c.amount,
      fee: 0,
      shipping: 0,
      ship: 0,
      profit: c.amount,
      slip: c.slip,
      deliveryCompany: '',
      matchStatus: 'AI登録',
      memo: c.memo + ' / ' + c.partner,
      evidenceUrl: c.evidence_url,
      source: 'AI自動登録 Ver60.0'
    });
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(s));
    localStorage.setItem('ribre_full_sales221', JSON.stringify(s));
    ver500Render([{ type: '登録', msg: '売上候補を登録しました' }]);
  } else {
    let p = [];
    try {
      p = JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]');
    } catch (e) {}
    p.unshift({
      id: 'ai_' + Date.now(),
      date: c.date,
      purchase_date: c.date,
      month: String(c.date).slice(0, 7),
      vendor: c.partner,
      name: c.item,
      item_name: c.item,
      cost: c.amount,
      total: c.amount,
      invoiceNo: c.slip,
      memo: c.memo,
      evidenceUrl: c.evidence_url,
      source: 'AI自動登録 Ver60.0'
    });
    localStorage.setItem('ribre_full_purchases221', JSON.stringify(p));
    ver500Render([{ type: '登録', msg: '仕入/経費候補を登録しました' }]);
  }
  try {
    refreshAll();
  } catch (e) {}
  ver500Set('ver500Status', '登録OK');
}
function ver500Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver500Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver500Email() {
  const s = ver500Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver500Headers(extra = {}) {
  const c = ver500Config(),
    s = ver500Session();
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (s.access_token || c.key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    extra
  );
}
async function ver500SaveToProduction() {
  const c = ver500CurrentCandidate();
  const cfg = ver500Config();
  const email = ver500Email();
  if (!cfg.url || !cfg.key) {
    alert('Supabase設定がありません');
    return;
  }
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  const base = cfg.url.replace(/\/$/, '');
  let table,
    body,
    conflict;
  if (c.kind === 'sale') {
    table = 'sales';
    body = [
      {
        user_email: email,
        sale_date: c.date,
        month: String(c.date).slice(0, 7),
        market: 'その他',
        account: 'AI/OCR',
        item_id: 'ai_' + Date.now(),
        item_name: c.item,
        amount: c.amount,
        fee: 0,
        shipping_fee: 0,
        profit: c.amount,
        slip_number: c.slip,
        status: 'AI登録',
        memo: c.memo + ' / ' + c.partner,
        evidence_url: c.evidence_url,
        source: 'AI自動登録 Ver60.0'
      }
    ];
    conflict = 'user_email,item_id';
  } else {
    table = 'purchases';
    body = [
      {
        user_email: email,
        purchase_date: c.date,
        month: String(c.date).slice(0, 7),
        vendor: c.partner,
        item_name: c.item,
        cost: c.amount,
        total: c.amount,
        invoice_number: c.slip,
        status: 'AI登録',
        memo: c.memo,
        evidence_url: c.evidence_url,
        source: 'AI自動登録 Ver60.0'
      }
    ];
    conflict = 'user_email,invoice_number,item_name';
  }
  try {
    const res = await fetch(base + '/rest/v1/' + table + '?on_conflict=' + conflict, {
      method: 'POST',
      headers: ver500Headers({ Prefer: 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(body)
    });
    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {}
    if (!res.ok) throw new Error(data.message || text);
    ver500Set('ver500Status', '本番保存OK');
    ver500Render([{ type: '本番保存', msg: table + ' に保存しました' }]);
  } catch (e) {
    ver500Set('ver500Status', 'エラー');
    ver500Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function ver500ExportCandidates() {
  const rows = [['日時', '区分', '日付', '相手先', '内容', '金額', '番号', '証憑URL', 'メモ']];
  ver500Candidates().forEach((x) => {
    const c = x.candidate || {};
    rows.push([x.at, c.kind, c.date, c.partner, c.item, c.amount, c.slip, c.evidence_url, c.memo]);
  });
  csvDownload(rows, 'ai_auto_candidates_Ver50_0.csv');
}
function ver500Guide() {
  ver500Render([
    { type: '1', msg: 'Storage保存で画像/PDFを保存します' },
    { type: '2', msg: 'AI自動登録で「最新Storage証憑を読込」' },
    { type: '3', msg: '必要なら画像ファイルも選択してAI解析' },
    { type: '4', msg: '日付・金額・相手先を確認して候補を登録' },
    { type: '5', msg: '本番DBへ保存でSupabaseへ保存できます' }
  ]);
}

window.ver500Render = ver500Render;
window.ver500Set = ver500Set;
window.ver500Num = ver500Num;
window.ver500Candidates = ver500Candidates;
window.ver500DraftRoutes = ver500DraftRoutes;
window.ver500SaveDraftRoutes = ver500SaveDraftRoutes;
window.ver500RenderDraftRouteList = ver500RenderDraftRouteList;
window.ver500ShowDraftRoutes = ver500ShowDraftRoutes;
window.ver500ConfirmSelectedDraft = ver500ConfirmSelectedDraft;
window.ver500ConfirmDraftRoute = ver500ConfirmDraftRoute;
window.ver500SaveCandidates = ver500SaveCandidates;
window.ver500LatestStorage = ver500LatestStorage;
window.ver500LoadLatestStorage = ver500LoadLatestStorage;
window.ver500ReadFileAsDataUrl = ver500ReadFileAsDataUrl;
window.ver500ExtractByRules = ver500ExtractByRules;
window.ver500OpenAiAnalyze = ver500OpenAiAnalyze;
window.ver500AnalyzeEvidence = ver500AnalyzeEvidence;
window.ver500CurrentCandidate = ver500CurrentCandidate;
window.ver500ApplyCandidate = ver500ApplyCandidate;
window.ver500Config = ver500Config;
window.ver500Session = ver500Session;
window.ver500Email = ver500Email;
window.ver500Headers = ver500Headers;
window.ver500SaveToProduction = ver500SaveToProduction;
window.ver500ExportCandidates = ver500ExportCandidates;
window.ver500Guide = ver500Guide;

if (!window.__ver500DraftUiInit) {
  window.__ver500DraftUiInit = true;
  window.addEventListener('load', () => {
    let tries = 0;
    const maxTries = 8;
    const timer = setInterval(() => {
      tries += 1;
      try {
        ver500EnsureDraftButtons();
        if (document.getElementById('ver500ShowDraftRoutesBtn')) {
          clearInterval(timer);
          return;
        }
      } catch (e) {}
      if (tries >= maxTries) clearInterval(timer);
    }, 400);
  });
}
