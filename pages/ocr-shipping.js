/* RIBRE OCR [??] shipping: ??????????? */
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
function ver500ShippingRows230() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_shipping_rows230') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500SaveShippingRows230(arr, expectedId) {
  const rows = Array.isArray(arr) ? arr.slice(0, 1000) : [];
  const limits = [1000, 500, 200, 0];
  for (let i = 0; i < limits.length; i++) {
    const limit = limits[i];
    try {
      const payload = limit === 0 ? [] : rows.slice(0, limit);
      localStorage.setItem('ribre_shipping_rows230', JSON.stringify(payload));
      if (!expectedId) return limit > 0;
      if (limit === 0) return false;
      const saved = ver500ShippingRows230();
      return saved.some((x) => String((x && x.id) || '') === String(expectedId));
    } catch (e) {}
  }
  return false;
}
function ver500BuildShippingCarrier(row) {
  const category = String((row && row.category) || '');
  const storeName = String((row && row.storeName) || '');
  return (
    String((row && (row.shippingCarrier || row.carrier || row.company || row.shippingCompany)) || '') ||
    (/ヤマト/.test(category) || /ヤマト/.test(storeName) ? 'ヤマト' : /佐川/.test(category) || /佐川/.test(storeName) ? '佐川' : '')
  );
}
function ver500LinkOcrToShippingCandidate(row, forceAdd) {
  const src = row && typeof row === 'object' ? row : {};
  const trackingNumber = ver500NormalizeTracking(src.trackingNumber || src.slip || src.invoiceNo || '');
  const itemId = String(src.itemId || '').trim();
  if (!forceAdd && !trackingNumber) return { added: false, reason: 'no_tracking' };
  const carrier = ver500BuildShippingCarrier(src);
  const shipping = ver500Num(src.shipping || src.amount || 0);
  const candidate = {
    id: 'ocr_ship_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
    createdAt: new Date().toISOString(),
    source: 'ocr',
    itemId,
    trackingNumber,
    shipping,
    carrier,
    date: String(src.date || today()),
    storeName: String(src.storeName || src.partner || ''),
    itemTitle: String(src.itemTitle || src.item || ''),
    evidence_url: String(src.evidence_url || ''),
    matched: false,
    note: String(src.note || src.memo || ''),
    slip: trackingNumber,
    company: carrier,
    amount: shipping,
    status: 'OCR仮登録',
    accountType: String(src.accountType || 'shipping'),
    autoMapped: !!src.autoMapped,
    at: new Date().toLocaleString('ja-JP')
  };
  const rows = ver500ShippingRows230();
  const duplicateTracking =
    candidate.trackingNumber &&
    rows.some((x) => ver500NormalizeTracking((x && (x.trackingNumber || x.slip || x.invoiceNo)) || '') === candidate.trackingNumber);
  if (duplicateTracking) return { added: false, reason: 'duplicate_tracking' };
  const duplicateItemId =
    candidate.itemId &&
    rows.some((x) => String((x && (x.itemId || x.id)) || '').trim() && String((x && (x.itemId || x.id)) || '').trim() === candidate.itemId);
  if (duplicateItemId) return { added: false, reason: 'duplicate_item_id' };
  rows.unshift(candidate);
  const saved = ver500SaveShippingRows230(rows, candidate.id);
  return { added: !!saved, reason: saved ? 'added' : 'quota', row: candidate };
}
