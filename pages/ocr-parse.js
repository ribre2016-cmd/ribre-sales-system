/* RIBRE OCR [??] parse: JSON/???????Storage?? */
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
  const doc = ver500DetectDocumentTypeDetail(
    {
      storeName: x.storeName || x.partner || x.vendor || '',
      itemTitle: x.itemTitle || x.item || x.itemName || '',
      note: x.note || x.memo || '',
      category,
      sourceType,
      documentType: x.documentType || x.document_type || ''
    },
    ver500OcrMappingRules()
  );
  const normalized = {
    kind: kindRaw === 'sale' ? 'sale' : kindRaw === 'purchase' ? 'purchase' : sourceType === 'sale' ? 'sale' : sourceType === 'purchase' ? 'purchase' : 'unknown',
    category,
    sourceType,
    documentType: doc.documentType || 'unknown',
    documentMatchedBy: doc.documentMatchedBy || 'unknown',
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
  return ver500ApplyDocumentProfile(normalized);
}
function ver500SchemaToCandidate(schema, options = {}) {
  const s = ver500NormalizeSchema(schema);
  const mapped = ver500ApplyAutoMapping(s);
  const forced = String(options.forcedKind || '');
  const candidateKind = forced && forced !== 'auto' ? forced : s.kind === 'sale' ? 'sale' : s.kind === 'purchase' ? 'purchase' : 'expense';
  const memoParts = [];
  if (s.note) memoParts.push(s.note);
  if (s.paymentMethod) memoParts.push('支払:' + s.paymentMethod);
  if (s.shipping) memoParts.push('送料:' + s.shipping);
  if (s.itemCount) memoParts.push('数量:' + s.itemCount);
  if (s.category) memoParts.push('カテゴリ:' + s.category);
  if (s.sourceType) memoParts.push('種別:' + s.sourceType);
  if (s.documentType) memoParts.push('帳票:' + s.documentType);
  if (mapped.supplierName) memoParts.push('仕入先:' + mapped.supplierName);
  if (mapped.salesChannel) memoParts.push('販路:' + mapped.salesChannel);
  if (mapped.genre) memoParts.push('ジャンル:' + mapped.genre);
  if (mapped.shippingCarrier) memoParts.push('配送:' + mapped.shippingCarrier);
  return {
    kind: candidateKind,
    category: mapped.mappedCategory || s.category || 'unknown',
    sourceType: mapped.mappedSourceType || s.sourceType || 'unknown',
    documentType: mapped.documentType || s.documentType || 'unknown',
    documentMatchedBy: mapped.documentMatchedBy || s.documentMatchedBy || 'unknown',
    status: 'draft',
    supplierName: mapped.supplierName,
    salesChannel: mapped.salesChannel,
    genre: mapped.genre,
    shippingCarrier: mapped.shippingCarrier,
    accountType: mapped.accountType,
    autoMapped: mapped.autoMapped,
    learnedMapped: mapped.learnedMapped,
    learnedFields: mapped.learnedFields,
    profileApplied: mapped.profileApplied,
    profileFields: mapped.profileFields,
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
  const doc = ver500DetectDocumentTypeDetail(
    {
      storeName,
      itemTitle: 'AI読取候補',
      note: t,
      category,
      sourceType
    },
    ver500OcrMappingRules()
  );
  const profile = ver500GetOcrDocumentProfile(doc.documentType);
  const pickByKeywords = (keywords, fallbackRegex) => {
    const keys = Array.isArray(keywords) ? keywords : [];
    for (let i = 0; i < keys.length; i++) {
      const kw = String(keys[i] || '');
      if (!kw) continue;
      const rx = new RegExp(kw + '[^\\n\\r0-9¥￥]*([¥￥]?\\s?[0-9,０-９]{2,})', 'i');
      const m = t.match(rx);
      if (m && m[1]) return m[1];
    }
    const m2 = fallbackRegex ? t.match(fallbackRegex) : null;
    return (m2 && (m2[1] || m2[0])) || '';
  };
  const pickDateByKeywords = (keywords) => {
    const keys = Array.isArray(keywords) ? keywords : [];
    for (let i = 0; i < keys.length; i++) {
      const kw = String(keys[i] || '');
      if (!kw) continue;
      const rx = new RegExp(kw + '[^\\n\\r0-9]*(20\\d{2}[\\/\\-年]\\d{1,2}[\\/\\-月]\\d{1,2})', 'i');
      const m = t.match(rx);
      if (m && m[1]) return m[1];
    }
    return '';
  };
  const pickTrackingByKeywords = (keywords) => {
    const keys = Array.isArray(keywords) ? keywords : [];
    for (let i = 0; i < keys.length; i++) {
      const kw = String(keys[i] || '');
      if (!kw) continue;
      const rx = new RegExp(kw + '[^\\n\\r0-9０-９A-Z]*([0-9０-９\\- ]{8,})', 'i');
      const m = t.match(rx);
      if (m && m[1]) return m[1];
    }
    return '';
  };
  const pickItemByKeywords = (keywords) => {
    const keys = Array.isArray(keywords) ? keywords : [];
    for (let i = 0; i < keys.length; i++) {
      const kw = String(keys[i] || '');
      if (!kw) continue;
      const rx = new RegExp(kw + '[\\s:：]*([^\\n\\r]{2,80})', 'i');
      const m = t.match(rx);
      if (m && m[1]) return m[1].trim();
    }
    return '';
  };
  const amountByProfile = pickByKeywords(profile.amountKeywords, null);
  const dateByProfile = pickDateByKeywords(profile.dateKeywords);
  const trackingByProfile = pickTrackingByKeywords(profile.trackingKeywords);
  const itemByProfile = pickItemByKeywords(profile.itemTitleKeywords);
  let note = 'ルール抽出';
  const ignoreList = Array.isArray(profile.ignoreKeywords) ? profile.ignoreKeywords : [];
  for (let i = 0; i < ignoreList.length; i++) {
    const kw = String(ignoreList[i] || '');
    if (kw && t.includes(kw)) {
      note += ' / ignore:' + kw;
      break;
    }
  }
  const base = {
    kind,
    category,
    sourceType,
    documentType: doc.documentType || 'unknown',
    documentMatchedBy: doc.documentMatchedBy || 'keyword',
    storeName: storeName || '',
    date: ver500NormalizeDate(dateByProfile || dateRaw || new Date().toISOString().slice(0, 10)),
    amount: ver500Num(amountByProfile || amountRaw),
    shipping: ver500Num(shippingRaw),
    trackingNumber:
      sourceType === 'shipping'
        ? ver500NormalizeTracking(trackingByProfile || trackingNorm || ver500NormalizeTracking((t.match(/[0-9０-９]{10,14}/) || [])[0] || ''))
        : ver500NormalizeTracking(trackingByProfile || trackingNorm),
    itemTitle: itemByProfile || 'AI読取候補',
    itemCount: 0,
    paymentMethod,
    note
  };
  return ver500ApplyDocumentProfile(base);
}
