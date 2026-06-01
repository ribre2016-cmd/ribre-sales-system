/* RIBRE OCR [??] learning: OCR?????? */
function ver500LearningLogs() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_learning_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500OcrLearningRows() {
  const rows = ver500LearningLogs();
  return Array.isArray(rows) ? rows : [];
}
function ver500SaveLearningLogs(arr) {
  const rows = Array.isArray(arr) ? arr.slice(0, 100) : [];
  const save = (n) => localStorage.setItem('ribre_ocr_learning_v1', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(100);
    return true;
  } catch (e) {}
  try {
    save(50);
    return true;
  } catch (e) {}
  try {
    save(20);
    return true;
  } catch (e) {}
  try {
    save(0);
    return true;
  } catch (e) {}
  return false;
}
function ver500AddLearningLog(log) {
  const src = log && typeof log === 'object' ? log : {};
  const rows = ver500LearningLogs();
  rows.unshift({
    id: String(src.id || 'ocr_learning_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
    createdAt: String(src.createdAt || new Date().toISOString()),
    source: String(src.source || ''),
    keyword: String(src.keyword || ''),
    value: String(src.value || ''),
    target: String(src.target || ''),
    routeId: String(src.routeId || ''),
    note: String(src.note || '')
  });
  return ver500SaveLearningLogs(rows);
}
function ver500RenderLearningLogs() {
  const rows = ver500LearningLogs().slice(0, 50);
  if (!rows.length) {
    ver500Render([{ type: '学習履歴', level: 'warn', msg: '学習履歴はありません' }]);
    return;
  }
  ver500Render(
    rows.map((x) => ({
      type: '学習履歴',
      msg:
        (x.createdAt || '') +
        ' / ' +
        (x.target || '-') +
        ' / ' +
        (x.keyword || '-') +
        ' => ' +
        (x.value || '-') +
        ' / ' +
        (x.note || 'added')
    }))
  );
}
function ver500IsLearnableValue(v) {
  const s = String(v || '').trim();
  if (!s) return false;
  if (s.toLowerCase() === 'unknown') return false;
  return true;
}
function ver500IsLearnableKeyword(v) {
  const s = String(v || '').trim();
  if (!ver500IsLearnableValue(s)) return false;
  return s.length >= 2;
}
function ver500LearnFromCandidate(candidate, meta = {}) {
  const src = candidate && typeof candidate === 'object' ? candidate : {};
  const m = meta && typeof meta === 'object' ? meta : {};
  const source = String(m.source || src.source || '');
  const routeId = String(m.routeId || src.routeId || '');
  const forcedNote = String(m.note || '').trim();
  const forceLog = !!m.forceLog;
  const storeName = String(src.storeName || '').trim();
  const itemTitle = String(src.itemTitle || '').trim();
  const category = String(src.category || '').trim();
  const documentType = ver500NormalizeDocumentType(src.documentType || '');
  const supplierName = String(src.supplierName || '').trim();
  const salesChannel = String(src.salesChannel || '').trim();
  const genre = String(src.genre || '').trim();
  const shippingCarrier = String(src.shippingCarrier || '').trim();
  const rules = ver500NormalizeOcrMappingRules(ver500OcrMappingRules());
  const logs = [];
  let changed = false;
  let failed = false;
  const pushLog = (target, keyword, value, note) => {
    logs.push({ source, routeId, target, keyword, value, note: forcedNote || note });
  };

  if (ver500IsLearnableKeyword(storeName) && ver500IsLearnableValue(supplierName)) {
    const duplicate = rules.supplierByStore.some((x) => String(x.keyword || '') === storeName && String(x.value || '') === supplierName);
    if (duplicate) pushLog('supplierByStore', storeName, supplierName, 'duplicate_skip');
    else {
      rules.supplierByStore.push({ keyword: storeName, value: supplierName });
      changed = true;
      pushLog('supplierByStore', storeName, supplierName, 'added');
    }
  }
  if (ver500IsLearnableKeyword(category) && ver500IsLearnableValue(salesChannel)) {
    const current = String(rules.salesChannelByCategory[category] || '');
    if (!current) {
      rules.salesChannelByCategory[category] = salesChannel;
      changed = true;
      pushLog('salesChannelByCategory', category, salesChannel, 'added');
    } else if (current === salesChannel) pushLog('salesChannelByCategory', category, salesChannel, 'duplicate_skip');
    else pushLog('salesChannelByCategory', category, salesChannel, 'conflict_skip');
  }
  if (ver500IsLearnableKeyword(category) && ver500IsLearnableValue(shippingCarrier)) {
    const current = String(rules.shippingCarrierByCategory[category] || '');
    if (!current) {
      rules.shippingCarrierByCategory[category] = shippingCarrier;
      changed = true;
      pushLog('shippingCarrierByCategory', category, shippingCarrier, 'added');
    } else if (current === shippingCarrier) pushLog('shippingCarrierByCategory', category, shippingCarrier, 'duplicate_skip');
    else pushLog('shippingCarrierByCategory', category, shippingCarrier, 'conflict_skip');
  }
  if (ver500IsLearnableKeyword(itemTitle) && ver500IsLearnableValue(genre)) {
    const duplicate = rules.genreKeywords.some((x) => String(x.keyword || '') === itemTitle && String(x.value || '') === genre);
    if (duplicate) pushLog('genreKeywords', itemTitle, genre, 'duplicate_skip');
    else {
      rules.genreKeywords.push({ keyword: itemTitle, value: genre });
      changed = true;
      pushLog('genreKeywords', itemTitle, genre, 'added');
    }
  }
  if (documentType !== 'unknown') {
    const docKeyword = storeName || itemTitle || category;
    if (ver500IsLearnableKeyword(docKeyword)) {
      const duplicate = rules.documentTypeByKeyword.some(
        (x) => String(x.keyword || '') === docKeyword && ver500NormalizeDocumentType(x.value || '') === documentType
      );
      if (duplicate) pushLog('documentType', docKeyword, documentType, 'duplicate_skip');
      else {
        rules.documentTypeByKeyword.push({ keyword: docKeyword, value: documentType });
        changed = true;
        pushLog('documentType', docKeyword, documentType, 'added');
      }
    }
  }

  if (changed) {
    try {
      localStorage.setItem('ribre_ocr_mapping_rules_v1', JSON.stringify(ver500NormalizeOcrMappingRules(rules)));
    } catch (e) {
      failed = true;
      const note = e && e.name === 'QuotaExceededError' ? 'save_quota_skip' : 'save_failed';
      logs.forEach((x) => {
        if (x.note === 'added') x.note = note;
      });
    }
  }
  if (!logs.length) {
    if (forceLog) {
      const fallbackKeyword = storeName || itemTitle || category || 'manual';
      const fallbackValue = supplierName || salesChannel || genre || shippingCarrier || String(src.sourceType || src.kind || 'manual');
      pushLog('manualRegister', fallbackKeyword, fallbackValue, forcedNote || 'manual-register');
    }
  }
  logs.forEach((x) => {
    const saved = ver500AddLearningLog(x);
    if (!saved) failed = true;
  });
  if (!logs.length) {
    const saved = ver500SaveLearningLogs(ver500LearningLogs());
    if (!saved) failed = true;
  }
  if (localStorage.getItem('ribre_ocr_learning_v1') === null) {
    try {
      localStorage.setItem('ribre_ocr_learning_v1', '[]');
    } catch (e) {
      failed = true;
    }
  }
  if (logs.length) {
    ver500AddAuditLog({
      action: 'learning_saved',
      routeId,
      target: source || 'ocr',
      before: {},
      after: { logsAdded: logs.length },
      message: 'OCR学習を保存しました'
    });
  }
  return { ok: !failed, logsAdded: logs.length };
}
function ver500LearnFromCorrection(input) {
  return ver500LearnFromCandidate(input, input);
}
function ver500BuildLearningCandidate(input) {
  const src = input && typeof input === 'object' ? input : {};
  let fallback = {};
  try {
    fallback = ver500CurrentCandidate();
  } catch (e) {
    fallback = {};
  }
  return {
    storeName: String(src.storeName || src.partner || fallback.partner || ''),
    itemTitle: String(src.itemTitle || src.item || fallback.item || ''),
    kind: String(src.kind || fallback.kind || 'unknown'),
    sourceType: String(src.sourceType || (src.kind === 'sale' ? 'sale' : src.kind === 'purchase' || src.kind === 'expense' ? 'purchase' : '') || 'unknown'),
    category: String(src.category || 'unknown'),
    documentType: ver500NormalizeDocumentType(src.documentType || fallback.documentType || ''),
    supplierName: String(src.supplierName || fallback.supplierName || ''),
    salesChannel: String(src.salesChannel || fallback.salesChannel || ''),
    genre: String(src.genre || fallback.genre || ''),
    shippingCarrier: String(src.shippingCarrier || fallback.shippingCarrier || '')
  };
}
function ver500HandleLearningResult(result, options = {}) {
  if (!result) {
    ver500Render([{ type: '学習', level: 'warn', msg: 'OCR学習保存に失敗しました' }]);
    return;
  }
  if (result.ok) {
    if (options && options.showSuccess) ver500Set('ver500Status', 'OCR学習を保存しました');
    return;
  }
  ver500Render([{ type: '学習', level: 'warn', msg: 'OCR学習保存に失敗しました' }]);
}
function ver500LearnAfterSuccess(candidate, meta = {}, options = {}) {
  try {
    const learningCandidate = ver500BuildLearningCandidate(candidate);
    const result = ver500LearnFromCandidate(learningCandidate, meta);
    ver500HandleLearningResult(result, options);
    return result;
  } catch (e) {
    ver500HandleLearningResult({ ok: false }, options);
    return { ok: false, logsAdded: 0 };
  }
}
