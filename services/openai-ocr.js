/* RIBRE — OpenAI 証憑 OCR・候補・自動登録（index.html から分離。ロジックは同一） */
const OCR_RESULT_CACHE_KEY = 'ribre_ocr_result_cache_v1';
const OCR_RESULT_HEAVY_FIELDS = new Set([
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
function ocrResultCacheRows() {
  try {
    const rows = JSON.parse(localStorage.getItem(OCR_RESULT_CACHE_KEY) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ocrSanitizeResultJson(v) {
  if (Array.isArray(v)) return v.map(ocrSanitizeResultJson).slice(0, 50);
  if (v && typeof v === 'object') {
    const out = {};
    Object.keys(v).forEach((k) => {
      if (OCR_RESULT_HEAVY_FIELDS.has(k)) return;
      out[k] = ocrSanitizeResultJson(v[k]);
    });
    return out;
  }
  return v;
}
function ocrBuildResultCacheKey(meta) {
  const m = meta && typeof meta === 'object' ? meta : {};
  const fileName = String(m.fileName || '').trim();
  const size = Number(m.size || 0);
  const mime = String(m.mime || m.type || '').trim();
  const lastModified = Number(m.lastModified || 0);
  const evidenceUrl = String(m.evidence_url || m.evidenceUrl || '').trim();
  return [fileName, size, mime, lastModified, evidenceUrl].join('|');
}
function ocrGetCachedResult(cacheKey, kind) {
  if (!cacheKey) return null;
  const rows = ocrResultCacheRows();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || {};
    if (row.cacheKey === cacheKey && row.kind === kind && row.resultJson && typeof row.resultJson === 'object') {
      return row;
    }
  }
  return null;
}
function ocrSaveCachedResult(entry) {
  const src = entry && typeof entry === 'object' ? entry : {};
  if (!src.cacheKey || !src.kind || !src.resultJson || typeof src.resultJson !== 'object') return;
  const baseRows = ocrResultCacheRows().filter((x) => !(x && x.cacheKey === src.cacheKey && x.kind === src.kind));
  baseRows.unshift({
    cacheKey: String(src.cacheKey),
    createdAt: src.createdAt || new Date().toISOString(),
    fileName: String(src.fileName || ''),
    size: Number(src.size || 0),
    kind: String(src.kind || ''),
    resultJson: ocrSanitizeResultJson(src.resultJson)
  });
  const capped = baseRows.slice(0, 20);
  const saveRows = (n) => localStorage.setItem(OCR_RESULT_CACHE_KEY, JSON.stringify(n === 0 ? [] : capped.slice(0, n)));
  try {
    saveRows(20);
    return;
  } catch (e) {}
  try {
    saveRows(10);
    return;
  } catch (e) {}
  try {
    saveRows(5);
    return;
  } catch (e) {}
  try {
    saveRows(0);
  } catch (e) {}
}
async function ribreOptimizeOcrImage(fileOrDataUrl) {
  const maxEdge = 1600;
  const jpegQuality = 0.7;
  const toResult = (imageUrl, originalBytes, optimizedBytes) => ({
    imageUrl: imageUrl || '',
    originalBytes: Number(originalBytes || 0),
    optimizedBytes: Number(optimizedBytes || 0)
  });
  try {
    if (!fileOrDataUrl) return toResult('', 0, 0);
    let src = '';
    let originalBytes = 0;
    let sourceMime = '';
    let revokeUrl = '';
    if (typeof fileOrDataUrl === 'string') {
      src = fileOrDataUrl;
      if (/^data:/i.test(src)) {
        const comma = src.indexOf(',');
        if (comma > 0) {
          const meta = src.slice(0, comma);
          const payload = src.slice(comma + 1);
          sourceMime = (meta.match(/^data:([^;]+)/i) || [])[1] || '';
          if (/;base64/i.test(meta)) {
            originalBytes = Math.floor((payload.length * 3) / 4);
          } else {
            originalBytes = decodeURIComponent(payload).length;
          }
        }
      } else {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          originalBytes = Number(blob.size || 0);
          sourceMime = blob.type || '';
          const objectUrl = URL.createObjectURL(blob);
          src = objectUrl;
          revokeUrl = objectUrl;
        } catch (e) {
          return toResult(fileOrDataUrl, 0, 0);
        }
      }
    } else if (fileOrDataUrl instanceof Blob) {
      originalBytes = Number(fileOrDataUrl.size || 0);
      sourceMime = fileOrDataUrl.type || '';
      const objectUrl = URL.createObjectURL(fileOrDataUrl);
      src = objectUrl;
      revokeUrl = objectUrl;
    } else {
      return toResult('', 0, 0);
    }
    if (!src) return toResult('', 0, 0);
    const img = new Image();
    const loaded = await new Promise((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = src;
    });
    if (!loaded || !img.width || !img.height) {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
      return toResult(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '', originalBytes, originalBytes);
    }
    const longest = Math.max(img.width, img.height);
    const isSmall = longest <= maxEdge;
    if (isSmall) {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl);
      return toResult(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : src, originalBytes, originalBytes);
    }
    const scale = maxEdge / longest;
    const targetW = Math.max(1, Math.round(img.width * scale));
    const targetH = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return toResult(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : src, originalBytes, originalBytes);
    ctx.drawImage(img, 0, 0, targetW, targetH);
    const optimizedDataUrl = canvas.toDataURL('image/jpeg', jpegQuality);
    const optimizedBytes = Math.floor(((optimizedDataUrl.split(',')[1] || '').length * 3) / 4);
    if (revokeUrl) URL.revokeObjectURL(revokeUrl);
    return toResult(optimizedDataUrl, originalBytes, optimizedBytes);
  } catch (e) {
    return toResult(typeof fileOrDataUrl === 'string' ? fileOrDataUrl : '', 0, 0);
  }
}
function ocrEvidenceCache() {
  if (!window.__ribreEvidenceDataUrlCache) window.__ribreEvidenceDataUrlCache = {};
  return window.__ribreEvidenceDataUrlCache;
}
function registerEvidence() {
  const f = document.getElementById('ocrFile').files[0];
  if (!f) {
    alert('PDF/画像を選択');
    return;
  }
  const rd = new FileReader();
  rd.onload = () => {
    const a = evidences();
    const it = {
      id: 'ev_' + Date.now(),
      fileName: f.name,
      mime: f.type || 'unknown',
      size: Number(f.size || 0),
      lastModified: Number(f.lastModified || 0),
      kind: document.getElementById('ocrKind').value,
      dataUrl: rd.result,
      at: new Date().toLocaleString('ja-JP')
    };
    ocrEvidenceCache()[it.id] = it.dataUrl;
    a.unshift(it);
    setLS(LS.ev, a);
    const saved = evidences();
    setLS('ribre_evidences180', saved);
    preview(it);
    renderList('ocrList', [{ type: '登録', msg: '証憑を登録しました：' + f.name }]);
  };
  rd.readAsDataURL(f);
}
function preview(it) {
  const box = document.getElementById('preview');
  if (String(it.mime).includes('pdf') || it.fileName.toLowerCase().endsWith('.pdf'))
    box.innerHTML =
      '<b>PDF：</b>' + it.fileName + '<br><iframe src="' + it.dataUrl + '"></iframe>';
  else
    box.innerHTML =
      '<b>画像：</b>' +
      it.fileName +
      '<br><img src="' +
      it.dataUrl +
      '" style="max-width:100%;max-height:520px;border-radius:14px;border:1px solid #cbd5e1;">';
}
function ribreHalfWidthDigits(v) {
  return String(v || '').replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0));
}
function ribreNormalizeTrackingNumber(v) {
  return ribreHalfWidthDigits(String(v || ''))
    .replace(/[ー－―−‐\-_\s]/g, '')
    .trim();
}
function ribreNormalizeOcrMoney(v) {
  const s = ribreHalfWidthDigits(String(v || ''))
    .replace(/[¥￥,\s円]/g, '')
    .trim();
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}
function ribreNormalizeOcrDate(v) {
  const raw = ribreHalfWidthDigits(String(v || '')).trim();
  if (!raw) return '';
  const m = raw.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) {
    const y = m[1];
    const mm = String(Number(m[2])).padStart(2, '0');
    const dd = String(Number(m[3])).padStart(2, '0');
    return y + '-' + mm + '-' + dd;
  }
  const m2 = raw.match(/(20\d{2})(\d{2})(\d{2})/);
  if (m2) return m2[1] + '-' + m2[2] + '-' + m2[3];
  return '';
}
function ocrLearningRows() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_learning_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ribreAllowedDocumentTypes() {
  return ['minna_market', 'auction_shiki', 'surugaya', 'bookoff', 'yamato', 'sagawa', 'mercari', 'yahoo', 'receipt', 'invoice', 'unknown'];
}
function ribreNormalizeDocumentType(v) {
  const s = String(v || '').trim().toLowerCase();
  return ribreAllowedDocumentTypes().includes(s) ? s : 'unknown';
}
function ribreDocumentTypeKeywordRules() {
  return [
    { keyword: 'みんなの市場', value: 'minna_market' },
    { keyword: 'オークション志木', value: 'auction_shiki' },
    { keyword: 'ヤマト', value: 'yamato' },
    { keyword: '発払い', value: 'yamato' },
    { keyword: '送り状', value: 'yamato' },
    { keyword: '佐川', value: 'sagawa' },
    { keyword: '飛脚', value: 'sagawa' },
    { keyword: 'bookoff', value: 'bookoff' },
    { keyword: 'ブックオフ', value: 'bookoff' },
    { keyword: '駿河屋', value: 'surugaya' },
    { keyword: 'メルカリ', value: 'mercari' },
    { keyword: 'ヤフオク', value: 'yahoo' },
    { keyword: '領収', value: 'receipt' },
    { keyword: 'レシート', value: 'receipt' },
    { keyword: '請求', value: 'invoice' },
    { keyword: 'invoice', value: 'invoice' }
  ];
}
function ribreDetectDocumentTypeDetail(src) {
  const x = src && typeof src === 'object' ? src : {};
  const pool = [x.storeName, x.vendor, x.partner, x.itemTitle, x.itemName, x.item, x.note, x.memo]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
  const category = String(x.category || '').toLowerCase();
  const aiType = ribreNormalizeDocumentType(x.documentType || x.document_type || '');
  const learningRows = ocrLearningRows();
  for (let i = 0; i < learningRows.length; i++) {
    const r = learningRows[i] || {};
    if (String(r.target || '') !== 'documentType') continue;
    const keyword = String(r.keyword || '').toLowerCase();
    const value = ribreNormalizeDocumentType(r.value || '');
    if (!keyword || value === 'unknown') continue;
    if (pool.includes(keyword) || category === keyword) return { documentType: value, documentMatchedBy: 'learning' };
  }
  const keywordRules = ribreDocumentTypeKeywordRules();
  for (let i = 0; i < keywordRules.length; i++) {
    const keyword = String(keywordRules[i].keyword || '').toLowerCase();
    const value = ribreNormalizeDocumentType(keywordRules[i].value || '');
    if (!keyword || value === 'unknown') continue;
    if (pool.includes(keyword) || category === keyword) return { documentType: value, documentMatchedBy: 'keyword' };
  }
  if (aiType !== 'unknown') return { documentType: aiType, documentMatchedBy: 'ai' };
  return { documentType: 'unknown', documentMatchedBy: 'unknown' };
}
function ribreOcrDocumentProfiles() {
  return {
    minna_market: {
      preferredSourceType: 'purchase',
      preferredCategory: 'surugaya_purchase',
      defaultSupplierName: 'みんなの市場',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '総額', '請求額', '落札金額'],
      dateKeywords: ['日付', '取引日', '落札日'],
      trackingKeywords: ['お問い合わせ番号', '送り状番号', '伝票番号'],
      itemTitleKeywords: ['商品名', '品名', '落札商品'],
      ignoreKeywords: ['テスト', 'サンプル']
    },
    auction_shiki: {
      preferredSourceType: 'purchase',
      preferredCategory: 'bookoff_purchase',
      defaultSupplierName: 'オークション志木',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '総額', '請求額'],
      dateKeywords: ['日付', '取引日'],
      trackingKeywords: ['お問い合わせ番号', '伝票番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: ['テスト', 'サンプル']
    },
    yamato: {
      preferredSourceType: 'shipping',
      preferredCategory: 'yamato_shipping',
      defaultSupplierName: '',
      defaultShippingCarrier: 'ヤマト',
      amountKeywords: ['送料', '運賃', '合計'],
      dateKeywords: ['出荷日', '発送日', '日付'],
      trackingKeywords: ['お問い合わせ番号', '送り状番号', '伝票番号'],
      itemTitleKeywords: ['品名', 'お荷物', '商品名'],
      ignoreKeywords: ['控え', '見本']
    },
    sagawa: {
      preferredSourceType: 'shipping',
      preferredCategory: 'sagawa_shipping',
      defaultSupplierName: '',
      defaultShippingCarrier: '佐川',
      amountKeywords: ['送料', '運賃', '合計'],
      dateKeywords: ['出荷日', '発送日', '日付'],
      trackingKeywords: ['お問い合わせ送り状No', '送り状No', '伝票番号'],
      itemTitleKeywords: ['品名', 'お荷物', '商品名'],
      ignoreKeywords: ['控え', '見本']
    },
    surugaya: {
      preferredSourceType: 'purchase',
      preferredCategory: 'surugaya_purchase',
      defaultSupplierName: '駿河屋',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '請求額', 'お支払'],
      dateKeywords: ['日付', '注文日', '取引日'],
      trackingKeywords: ['伝票番号', '追跡番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: ['テスト', 'サンプル']
    },
    bookoff: {
      preferredSourceType: 'purchase',
      preferredCategory: 'bookoff_purchase',
      defaultSupplierName: 'BOOKOFF',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', 'お買上計', '請求額'],
      dateKeywords: ['日付', '購入日'],
      trackingKeywords: ['伝票番号', '追跡番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: ['テスト', 'サンプル']
    },
    receipt: {
      preferredSourceType: 'receipt',
      preferredCategory: 'receipt',
      defaultSupplierName: '',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '税込', 'お買上計'],
      dateKeywords: ['日付', '購入日'],
      trackingKeywords: ['伝票番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: ['再発行']
    },
    unknown: {
      preferredSourceType: 'unknown',
      preferredCategory: 'unknown',
      defaultSupplierName: '',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '請求額', '税込'],
      dateKeywords: ['日付'],
      trackingKeywords: ['伝票番号', '追跡', 'お問い合わせ番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: []
    }
  };
}
function ribreGetOcrDocumentProfile(documentType) {
  const t = ribreNormalizeDocumentType(documentType);
  const map = ribreOcrDocumentProfiles();
  return map[t] || map.unknown;
}
function ribreProfilePromptHints() {
  const p = ribreOcrDocumentProfiles();
  return (
    '帳票タイプ別の優先読取項目:' +
    ' minna_market(金額:' +
    p.minna_market.amountKeywords.join('/') +
    '), auction_shiki(金額:' +
    p.auction_shiki.amountKeywords.join('/') +
    '), yamato(追跡:' +
    p.yamato.trackingKeywords.join('/') +
    '), sagawa(追跡:' +
    p.sagawa.trackingKeywords.join('/') +
    '), surugaya(商品:' +
    p.surugaya.itemTitleKeywords.join('/') +
    '), bookoff(商品:' +
    p.bookoff.itemTitleKeywords.join('/') +
    '), receipt(金額:' +
    p.receipt.amountKeywords.join('/') +
    ')。'
  );
}
function ribreApplyDocumentProfile(result) {
  const src = result && typeof result === 'object' ? Object.assign({}, result) : {};
  const profile = ribreGetOcrDocumentProfile(src.documentType || 'unknown');
  const fields = [];
  if ((!src.sourceType || src.sourceType === 'unknown') && profile.preferredSourceType && profile.preferredSourceType !== 'unknown') {
    src.sourceType = profile.preferredSourceType;
    fields.push('sourceType');
  }
  if ((!src.category || src.category === 'unknown') && profile.preferredCategory && profile.preferredCategory !== 'unknown') {
    src.category = profile.preferredCategory;
    fields.push('category');
  }
  if (!src.supplierName && profile.defaultSupplierName) {
    src.supplierName = profile.defaultSupplierName;
    fields.push('supplierName');
  }
  if (!src.shippingCarrier && profile.defaultShippingCarrier) {
    src.shippingCarrier = profile.defaultShippingCarrier;
    fields.push('shippingCarrier');
  }
  src.profileApplied = fields.length > 0;
  src.profileFields = fields;
  return src;
}
function ribreCleanJsonText(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start >= 0 && end > start) t = t.slice(start, end + 1);
  t = t.replace(/,\s*([}\]])/g, '$1');
  return t;
}
// LLMがJSON文字列値の中に生の改行/タブ(\n本来はエスケープが必要)をそのまま出力することがあり、
// それだけでJSON.parseが失敗する（精算書等の長い書類でありがち）。文字列内かどうかを
// エスケープ考慮で追跡し、文字列内の生の制御文字だけをエスケープし直す。
function ribreRepairJsonControlChars(text) {
  let out = '';
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaping) { out += ch; escaping = false; continue; }
    if (ch === '\\') { out += ch; escaping = true; continue; }
    if (ch === '"') { inString = !inString; out += ch; continue; }
    if (inString && ch === '\n') { out += '\\n'; continue; }
    if (inString && ch === '\r') { out += '\\r'; continue; }
    if (inString && ch === '\t') { out += '\\t'; continue; }
    out += ch;
  }
  return out;
}
function ribreNormalizeOcrSchema(obj) {
  const src = obj && typeof obj === 'object' ? obj : {};
  const textPool = [
    src.storeName,
    src.vendor,
    src.partner,
    src.itemTitle,
    src.itemName,
    src.item,
    src.note,
    src.memo
  ]
    .map((x) => String(x || ''))
    .join(' ')
    .toLowerCase();
  const rawSource = String(src.sourceType || '').toLowerCase();
  let sourceType = 'unknown';
  if (rawSource === 'sale' || rawSource === 'purchase' || rawSource === 'shipping' || rawSource === 'receipt') sourceType = rawSource;
  else if (/ヤマト|佐川|追跡|伝票|送り状|送料/.test(textPool)) sourceType = 'shipping';
  else if (/領収|レシート/.test(textPool)) sourceType = 'receipt';
  else if (/仕入|買取|請求|駿河屋|bookoff|ブックオフ/.test(textPool)) sourceType = 'purchase';
  else if (/ヤフオク|メルカリ|売上|落札|入金/.test(textPool)) sourceType = 'sale';
  const rawCategory = String(src.category || '').toLowerCase();
  let category = 'unknown';
  if (rawCategory) category = rawCategory;
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
  const rawKind = String(src.kind || src.type || '').toLowerCase();
  let kind = 'unknown';
  if (rawKind === 'sale') kind = 'sale';
  else if (rawKind === 'purchase') kind = 'purchase';
  else if (sourceType === 'sale') kind = 'sale';
  else if (sourceType === 'purchase') kind = 'purchase';
  const doc = ribreDetectDocumentTypeDetail({
    storeName: src.storeName || src.vendor || src.partner || '',
    itemTitle: src.itemTitle || src.itemName || src.item || '',
    note: src.note || src.memo || '',
    category,
    sourceType,
    documentType: src.documentType || src.document_type || ''
  });
  const result = {
    kind,
    documentType: doc.documentType || 'unknown',
    documentMatchedBy: doc.documentMatchedBy || 'unknown',
    category,
    sourceType,
    storeName: String(src.storeName || src.vendor || src.partner || ''),
    date: ribreNormalizeOcrDate(src.date),
    amount: ribreNormalizeOcrMoney(src.amount),
    shipping: ribreNormalizeOcrMoney(src.shipping),
    trackingNumber: ribreNormalizeTrackingNumber(src.trackingNumber || src.invoiceNo || src.slip || ''),
    itemTitle: String(src.itemTitle || src.itemName || src.item || ''),
    itemCount: Number.isFinite(Number(src.itemCount)) ? Math.max(0, Number(src.itemCount)) : 0,
    paymentMethod: String(src.paymentMethod || ''),
    note: String(src.note || src.memo || '')
  };
  return ribreApplyDocumentProfile(result);
}
function ribreBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    r.onerror = () => reject(new Error('ファイル読込に失敗しました'));
    r.readAsDataURL(blob);
  });
}
async function uploadOpenAIFile(ev) {
  const srcUrl = ev.dataUrl || ev.evidence_url || (ev.id && ocrEvidenceCache()[ev.id]) || '';
  if (!srcUrl) throw new Error('証憑データが見つかりません。再登録してください');
  const blob = await (await fetch(srcUrl)).blob();
  const base64 = await ribreBlobToBase64(blob);
  const res = await fetch('/api/openai/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
    body: JSON.stringify({
      purpose: 'user_data',
      file_name: ev.fileName,
      content_type: blob.type || ev.mime || 'application/octet-stream',
      file_data: base64
    })
  });
  const d = await res.json();
  if (!res.ok) {
    if (d && d.error === 'server_not_configured') throw new Error('OCR機能が利用できません（管理者に連絡してください）');
    throw new Error((d.error && d.error.message) || d.error || JSON.stringify(d));
  }
  return d.id;
}
function extractJson(text) {
  const raw = String(text || '');
  let t = ribreCleanJsonText(text);
  try {
    return JSON.parse(t);
  } catch (e) {}
  try {
    return JSON.parse(t.replace(/,\s*([}\]])/g, '$1'));
  } catch (e) {}
  // 文字列値内の生の改行/タブがJSON.parseを失敗させているケースを試す
  try {
    return JSON.parse(ribreRepairJsonControlChars(t));
  } catch (e) {}
  // すべて失敗。原因調査用に生の応答をコンソールへ残す（呼び出し側は
  // 「解析に失敗しました」しか表示しないため、ここがほぼ唯一の手がかりになる）。
  // ※単一オブジェクトの指示を無視してJSON配列（合計・小計・明細行が混在）が
  // 返るケースがあるが、要素を自動合算すると合計と内訳の二重計上で誤った金額に
  // なる実例が確認された（精算書の例: 正しくは¥37,572だが、書類内の合計・小計・
  // 明細をすべて合算すると¥103,092という架空の値になった）。金額データを誤って
  // 自動計算するより、素直に失敗させて手入力を促す方が安全なため、配列検出時も
  // 推測での復元は行わない（プロンプト側で単一の最終合計のみを返すよう強く指示する
  // ことで発生自体を減らす方針。mfRunOcr/buildOcrPromptを参照）。
  try { console.error('[RIBRE OCR] JSON解析に失敗しました。生の応答:', text); } catch (e) {}
  return null;
}
async function runOcr() {
  const ev = evidences()[0];
  if (!ev) {
    alert('証憑登録してください');
    return;
  }
  renderList('ocrList', [{ type: 'OCR', level: 'warn', msg: 'AI読取中です' }]);
  const prompt =
    'あなたは日本の売上管理OCRです。必ずJSONのみ返してください。説明文は禁止。推測は禁止。存在しない値は null。' +
    '日本のEC/配送/買取伝票を想定し、documentType/category/sourceTypeを推定してください。不明時は unknown。documentType を必ず推定してください。' +
    ribreProfilePromptHints() +
    '出力schemaは次のみ: {"kind":"sale|purchase|unknown","documentType":"minna_market|auction_shiki|surugaya|bookoff|yamato|sagawa|mercari|yahoo|receipt|invoice|unknown","category":"yahoo_sale|mercari_sale|surugaya_purchase|bookoff_purchase|yamato_shipping|sagawa_shipping|receipt|invoice|unknown","sourceType":"sale|purchase|shipping|receipt|unknown","storeName":"","date":"","amount":0,"shipping":0,"trackingNumber":"","itemTitle":"","itemCount":0,"paymentMethod":"","note":""}';
  try {
    const cacheKey = ocrBuildResultCacheKey({
      fileName: ev.fileName,
      size: ev.size,
      mime: ev.mime,
      lastModified: ev.lastModified,
      evidence_url: ev.evidence_url
    });
    const cached = ocrGetCachedResult(cacheKey, 'runOcr');
    if (cached && cached.resultJson) {
      const cp = ribreNormalizeOcrSchema(ocrSanitizeResultJson(cached.resultJson));
      fillCandidate(cp, ev);
      const cacheRows = [
        { type: 'OCR', msg: 'キャッシュ結果を使用しました' },
        { type: '金額', msg: yen(cp.amount) }
      ];
      if (cp.category) cacheRows.push({ type: '分類', msg: 'category: ' + cp.category });
      if (cp.sourceType) cacheRows.push({ type: '分類', msg: 'sourceType: ' + cp.sourceType });
      if (cp.documentType) cacheRows.push({ type: '分類', msg: 'documentType: ' + cp.documentType + ' (' + (cp.documentMatchedBy || 'unknown') + ')' });
      if (cp.profileApplied) cacheRows.push({ type: '分類', msg: 'profileApplied: true / ' + (cp.profileFields || []).join(',') });
      renderList('ocrList', cacheRows);
      return;
    }
    const imageUrl = ev.dataUrl || ev.evidence_url || (ev.id && ocrEvidenceCache()[ev.id]) || '';
    if (!imageUrl) throw new Error('証憑データが見つかりません。再登録してください');
    let body;
    if (String(ev.mime).startsWith('image/')) {
      renderList('ocrList', [{ type: 'OCR', level: 'warn', msg: '画像最適化中...' }]);
      await new Promise((r) => requestAnimationFrame(r));
      const optimized = await ribreOptimizeOcrImage(imageUrl);
      const optimizeStats = {
        originalBytes: optimized.originalBytes,
        optimizedBytes: optimized.optimizedBytes
      };
      const optimizedImageUrl = optimized.imageUrl || imageUrl;
      if (!optimizeStats.originalBytes && !optimizeStats.optimizedBytes) {
        // keep silent; fallback to original behavior
      }
      renderList('ocrList', [{ type: 'OCR', level: 'warn', msg: 'AI読取中です' }]);
      body = {
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: optimizedImageUrl }
            ]
          }
        ],
        temperature: 0
      };
    } else {
      const fileId = await uploadOpenAIFile(ev);
      body = {
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_file', file_id: fileId }
            ]
          }
        ],
        temperature: 0
      };
    }
    const res = await fetch('/api/openai/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) {
      if (d && d.error === 'server_not_configured') throw new Error('OCR機能が利用できません（管理者に連絡してください）');
      throw new Error((d.error && d.error.message) || d.error || JSON.stringify(d));
    }
    let text = d.output_text || '';
    if (!text && d.output)
      text = d.output
        .map((o) => (o.content || []).map((c) => c.text || '').join('\n'))
        .join('\n');
    const parsed = extractJson(text);
    if (!parsed) throw new Error('JSON解析失敗');
    const p = ribreNormalizeOcrSchema(parsed);
    ocrSaveCachedResult({
      cacheKey,
      fileName: ev.fileName,
      size: ev.size,
      kind: 'runOcr',
      resultJson: p
    });
    fillCandidate(p, ev);
    const rows = [
      { type: 'OCR', msg: '自動入力しました' },
      { type: '金額', msg: yen(p.amount) }
    ];
    if (p.category) rows.push({ type: '分類', msg: 'category: ' + p.category });
    if (p.sourceType) rows.push({ type: '分類', msg: 'sourceType: ' + p.sourceType });
    if (p.documentType) rows.push({ type: '分類', msg: 'documentType: ' + p.documentType + ' (' + (p.documentMatchedBy || 'unknown') + ')' });
    if (p.profileApplied) rows.push({ type: '分類', msg: 'profileApplied: true / ' + (p.profileFields || []).join(',') });
    renderList('ocrList', rows);
  } catch (e) {
    renderList('ocrList', [{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function fillCandidate(p, ev) {
  document.getElementById('cKind').value = p.kind === 'sale' ? 'sale' : 'purchase';
  document.getElementById('cDate').value = p.date || today();
  document.getElementById('cVendor').value = p.storeName || '';
  document.getElementById('cItem').value = p.itemTitle || '';
  document.getElementById('cAmount').value = p.amount || '';
  document.getElementById('cTax').value = p.shipping || '';
  document.getElementById('cNo').value = p.trackingNumber || '';
  document.getElementById('cMemo').value = p.note || '';
  try {
    if (typeof window.ver500SaveDraftRoute === 'function') {
      const routeSource = {
        kind: p.kind || 'unknown',
        category: p.category || 'unknown',
        sourceType: p.sourceType || 'unknown',
        documentType: p.documentType || 'unknown',
        documentMatchedBy: p.documentMatchedBy || 'unknown',
        profileApplied: !!p.profileApplied,
        profileFields: Array.isArray(p.profileFields) ? p.profileFields : [],
        date: p.date || '',
        partner: p.storeName || '',
        item: p.itemTitle || '',
        amount: p.amount || 0,
        shipping: p.shipping || 0,
        slip: p.trackingNumber || '',
        evidence_url: (ev && ev.evidence_url) || '',
        memo: p.note || ''
      };
      const saved = window.ver500SaveDraftRoute(routeSource);
      if (!saved) {
        renderList('ocrList', [{ type: '仮登録', level: 'warn', msg: '仮登録保存に失敗しました' }]);
      }
    }
  } catch (e) {
    renderList('ocrList', [{ type: '仮登録', level: 'warn', msg: '仮登録保存に失敗しました' }]);
  }
  const a = candidates();
  a.unshift(readCandidate(ev));
  setLS(LS.cand, a);
}
function readCandidate(ev) {
  return {
    id: 'c_' + Date.now(),
    type: document.getElementById('cKind').value,
    date: document.getElementById('cDate').value || today(),
    vendor: document.getElementById('cVendor').value,
    itemName: document.getElementById('cItem').value,
    amount: num(document.getElementById('cAmount').value),
    tax: num(document.getElementById('cTax').value),
    invoiceNo: document.getElementById('cNo').value,
    memo: document.getElementById('cMemo').value,
    fileName: (ev || evidences()[0] || {}).fileName || '',
    at: new Date().toLocaleString('ja-JP')
  };
}
function saveOcrCandidate() {
  const a = candidates();
  a.unshift(readCandidate());
  setLS(LS.cand, a);
  renderList('ocrList', [{ type: '保存', msg: 'OCR候補を保存しました' }]);
}
function ocrToSale() {
  const c = readCandidate();
  const a = sales();
  a.unshift({
    id: 's_' + Date.now(),
    date: c.date,
    month: c.date.slice(0, 7),
    shop: c.vendor,
    name: c.itemName,
    amount: c.amount,
    memo: c.memo + ' / ' + c.fileName,
    source: 'OCR'
  });
  setLS(LS.sales, a);
  refreshAll();
  renderList('ocrList', [{ type: '売上', msg: '売上へ登録しました' }]);
}
function ocrToPurchase() {
  const c = readCandidate();
  const a = purchases();
  a.unshift({
    id: 'p_' + Date.now(),
    date: c.date,
    month: c.date.slice(0, 7),
    vendor: c.vendor,
    name: c.itemName,
    total: c.amount,
    memo: c.memo + ' / ' + c.fileName,
    source: 'OCR'
  });
  setLS(LS.purchases, a);
  refreshAll();
  renderList('ocrList', [{ type: '仕入', msg: '仕入へ登録しました' }]);
}
function ocrAutoRegister() {
  const k = document.getElementById('cKind').value;
  if (k === 'sale') ocrToSale();
  else ocrToPurchase();
}

window.ribreOcrBuildCacheKey = ocrBuildResultCacheKey;
window.ribreOcrGetCachedResult = ocrGetCachedResult;
window.ribreOcrSaveCachedResult = ocrSaveCachedResult;
window.ribreOptimizeOcrImage = ribreOptimizeOcrImage;
window.ribreExtractOcrJson = extractJson;
window.ribreNormalizeOcrSchema = ribreNormalizeOcrSchema;
window.ribreNormalizeTrackingNumber = ribreNormalizeTrackingNumber;
window.ribreNormalizeOcrMoney = ribreNormalizeOcrMoney;
window.ribreNormalizeOcrDate = ribreNormalizeOcrDate;
