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
async function uploadOpenAIFile(key, ev) {
  const srcUrl = ev.dataUrl || ev.evidence_url || (ev.id && ocrEvidenceCache()[ev.id]) || '';
  if (!srcUrl) throw new Error('証憑データが見つかりません。再登録してください');
  const blob = await (await fetch(srcUrl)).blob();
  const fd = new FormData();
  fd.append('purpose', 'user_data');
  fd.append('file', blob, ev.fileName);
  const res = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key },
    body: fd
  });
  const d = await res.json();
  if (!res.ok) throw new Error((d.error && d.error.message) || JSON.stringify(d));
  return d.id;
}
function extractJson(text) {
  let t = String(text || '')
    .trim()
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(t);
  } catch (e) {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return JSON.parse(m[0]);
    } catch (e) {}
  }
  return null;
}
async function runOcr() {
  const key = localStorage.getItem(LS.openai) || localStorage.getItem('ribre_openai_key180') || '';
  const ev = evidences()[0];
  if (!key) {
    alert('OpenAI APIキーを保存');
    return;
  }
  if (!ev) {
    alert('証憑登録してください');
    return;
  }
  renderList('ocrList', [{ type: 'OCR', level: 'warn', msg: 'AI読取中です' }]);
  const prompt =
    '日本の会計OCRです。JSONのみ返してください。{ "date":"YYYY-MM-DD", "vendor":"相手先", "itemName":"内容", "amount":税込金額数値, "tax":税額数値, "type":"purchase|sale|shipping|expense", "invoiceNo":"番号", "memo":"補足" }';
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
      const cp = ocrSanitizeResultJson(cached.resultJson);
      fillCandidate(cp, ev);
      renderList('ocrList', [
        { type: 'OCR', msg: 'キャッシュ結果を使用しました' },
        { type: '金額', msg: yen(cp.amount) }
      ]);
      return;
    }
    const imageUrl = ev.dataUrl || ev.evidence_url || (ev.id && ocrEvidenceCache()[ev.id]) || '';
    if (!imageUrl) throw new Error('証憑データが見つかりません。再登録してください');
    let body;
    if (String(ev.mime).startsWith('image/')) {
      renderList('ocrList', [{ type: 'OCR', level: 'warn', msg: '画像最適化中...' }]);
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
      const fileId = await uploadOpenAIFile(key, ev);
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
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const d = await res.json();
    if (!res.ok) throw new Error((d.error && d.error.message) || JSON.stringify(d));
    let text = d.output_text || '';
    if (!text && d.output)
      text = d.output
        .map((o) => (o.content || []).map((c) => c.text || '').join('\n'))
        .join('\n');
    const p = extractJson(text);
    if (!p) throw new Error('JSON解析失敗');
    ocrSaveCachedResult({
      cacheKey,
      fileName: ev.fileName,
      size: ev.size,
      kind: 'runOcr',
      resultJson: p
    });
    fillCandidate(p, ev);
    renderList('ocrList', [
      { type: 'OCR', msg: '自動入力しました' },
      { type: '金額', msg: yen(p.amount) }
    ]);
  } catch (e) {
    renderList('ocrList', [{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function fillCandidate(p, ev) {
  document.getElementById('cKind').value = p.type || 'purchase';
  document.getElementById('cDate').value = p.date || today();
  document.getElementById('cVendor').value = p.vendor || '';
  document.getElementById('cItem').value = p.itemName || '';
  document.getElementById('cAmount').value = p.amount || '';
  document.getElementById('cTax').value = p.tax || '';
  document.getElementById('cNo').value = p.invoiceNo || '';
  document.getElementById('cMemo').value = p.memo || '';
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
