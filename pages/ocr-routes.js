/* RIBRE OCR [??] routes: ???????UI/??/????/???? */
function ver500DetectGenre(itemTitle) {
  const detail = ver500DetectGenreDetail(itemTitle);
  return detail.genre;
}
function ver500DetectDocumentTypeDetail(src, rulesOpt) {
  const x = src && typeof src === 'object' ? src : {};
  const rules = rulesOpt || ver500OcrMappingRules();
  const pool = [x.storeName, x.partner, x.vendor, x.itemTitle, x.item, x.note, x.memo]
    .map((v) => String(v || ''))
    .join(' ')
    .toLowerCase();
  const category = String(x.category || '').trim().toLowerCase();
  const aiType = ver500NormalizeDocumentType(x.documentType || x.aiDocumentType || '');

  const learningMap = ver500BuildLearningMappingRules();
  const learningRules = Array.isArray(learningMap.documentTypeByKeyword) ? learningMap.documentTypeByKeyword : [];
  for (let i = 0; i < learningRules.length; i++) {
    const k = String((learningRules[i] && learningRules[i].keyword) || '').toLowerCase();
    const v = ver500NormalizeDocumentType((learningRules[i] && learningRules[i].value) || '');
    if (!k || v === 'unknown') continue;
    if (pool.includes(k) || category === k) return { documentType: v, documentMatchedBy: 'learning' };
  }

  const manualDocRules = Array.isArray(rules.documentTypeByKeyword) ? rules.documentTypeByKeyword : [];
  for (let i = 0; i < manualDocRules.length; i++) {
    const k = String((manualDocRules[i] && manualDocRules[i].keyword) || '').toLowerCase();
    const v = ver500NormalizeDocumentType((manualDocRules[i] && manualDocRules[i].value) || '');
    if (!k || v === 'unknown') continue;
    if (pool.includes(k) || category === k) return { documentType: v, documentMatchedBy: 'keyword' };
  }

  const keywordRules = ver500DocumentTypeKeywordRules();
  for (let i = 0; i < keywordRules.length; i++) {
    const k = String(keywordRules[i].keyword || '').toLowerCase();
    const v = ver500NormalizeDocumentType(keywordRules[i].value || '');
    if (!k || v === 'unknown') continue;
    if (pool.includes(k) || category === k) return { documentType: v, documentMatchedBy: 'keyword' };
  }

  if (aiType !== 'unknown') return { documentType: aiType, documentMatchedBy: 'ai' };
  return { documentType: 'unknown', documentMatchedBy: 'unknown' };
}
function ver500LearningRuleLookups() {
  const learning = ver500BuildLearningMappingRules();
  const supplierPairs = new Set((learning.supplierByStore || []).map((x) => String(x.keyword || '').trim() + '\t' + String(x.value || '').trim()));
  const genrePairs = new Set((learning.genreKeywords || []).map((x) => String(x.keyword || '').trim() + '\t' + String(x.value || '').trim()));
  const salesByCategory = learning.salesChannelByCategory || {};
  const carrierByCategory = learning.shippingCarrierByCategory || {};
  return { supplierPairs, genrePairs, salesByCategory, carrierByCategory };
}
function ver500DetectGenreDetail(itemTitle, rulesOpt, lookupsOpt) {
  const t = String(itemTitle || '').toLowerCase();
  const rules = rulesOpt || ver500OcrMappingRules();
  const lookups = lookupsOpt || ver500LearningRuleLookups();
  const list = Array.isArray(rules.genreKeywords) ? rules.genreKeywords : [];
  for (let i = 0; i < list.length; i++) {
    const keywordRaw = String((list[i] && list[i].keyword) || '');
    const keyword = keywordRaw.toLowerCase();
    const value = String((list[i] && list[i].value) || '');
    if (keyword && value && t.includes(keyword)) {
      const learned = lookups.genrePairs.has(keywordRaw.trim() + '\t' + value.trim());
      return { genre: value, learned };
    }
  }
  return { genre: '', learned: false };
}
function ver500ApplyAutoMapping(src) {
  const x = src && typeof src === 'object' ? src : {};
  const rules = ver500OcrMappingRules();
  const lookups = ver500LearningRuleLookups();
  const profiled = ver500ApplyDocumentProfile(x);
  const storeName = String(profiled.storeName || profiled.partner || '');
  const doc = ver500DetectDocumentTypeDetail(profiled, rules);
  const defaults = ver500DocumentTypeDefaults(doc.documentType);
  const category = String(defaults.category || profiled.category || 'unknown');
  const sourceType = String(defaults.sourceType || profiled.sourceType || 'unknown');
  const itemTitle = String(profiled.itemTitle || profiled.item || '');
  let supplierName = String(defaults.supplierName || '');
  let supplierLearned = false;
  for (let i = 0; i < rules.supplierByStore.length; i++) {
    const r = rules.supplierByStore[i];
    if (storeName.includes(r.keyword)) {
      supplierName = r.value;
      supplierLearned = lookups.supplierPairs.has(String(r.keyword || '').trim() + '\t' + String(r.value || '').trim());
      break;
    }
  }
  const salesChannel = rules.salesChannelByCategory[category] || '';
  const salesLearned = !!(category && salesChannel && String(lookups.salesByCategory[category] || '') === salesChannel);
  let shippingCarrier = String(defaults.shippingCarrier || rules.shippingCarrierByCategory[category] || '');
  let shippingLearned = !!(category && shippingCarrier && String(lookups.carrierByCategory[category] || '') === shippingCarrier);
  if (!shippingCarrier && /ヤマト/.test(storeName)) shippingCarrier = 'ヤマト';
  if (!shippingCarrier && /佐川/.test(storeName)) shippingCarrier = '佐川';
  const genreDetail = ver500DetectGenreDetail(itemTitle, rules, lookups);
  const genre = genreDetail.genre;
  const genreLearned = !!genreDetail.learned;
  let accountType = 'unknown';
  if (sourceType === 'sale') accountType = 'sales';
  else if (sourceType === 'purchase') accountType = 'purchase';
  else if (sourceType === 'shipping') accountType = 'shipping';
  const learnedFields = [];
  if (supplierLearned && supplierName) learnedFields.push('supplierName');
  if (salesLearned && salesChannel) learnedFields.push('salesChannel');
  if (genreLearned && genre) learnedFields.push('genre');
  if (shippingLearned && shippingCarrier) learnedFields.push('shippingCarrier');
  if (doc.documentMatchedBy === 'learning' && doc.documentType !== 'unknown') learnedFields.push('documentType');
  const profileFields = Array.isArray(profiled.profileFields) ? profiled.profileFields : [];
  for (let i = 0; i < profileFields.length; i++) {
    const f = String(profileFields[i] || '');
    if (f && !learnedFields.includes(f)) learnedFields.push(f);
  }
  const learnedMapped = learnedFields.length > 0;
  const autoMapped = !!(supplierName || salesChannel || genre || shippingCarrier || accountType !== 'unknown');
  return {
    supplierName,
    salesChannel,
    genre,
    shippingCarrier,
    accountType,
    autoMapped,
    learnedMapped,
    learnedFields,
    documentType: doc.documentType,
    documentMatchedBy: doc.documentMatchedBy,
    mappedSourceType: sourceType,
    mappedCategory: category,
    profileApplied: !!profiled.profileApplied,
    profileFields: profileFields
  };
}
function ver500NormalizeRouteEntry(x) {
  const src = x && typeof x === 'object' ? x : {};
  const normStatus = (v) => {
    const s = String(v || 'draft');
    if (s === 'confirmed' || s === 'ignored') return s;
    return 'draft';
  };
  const normReviewStatus = (v) => {
    const s = String(v || 'none');
    if (s === 'later' || s === 'pending' || s === 'ignored' || s === 'done') return s;
    return 'none';
  };
  return {
    id: String(src.id || 'route_' + Date.now()),
    createdAt: String(src.createdAt || new Date().toISOString()),
    sourceType: String(src.sourceType || 'unknown'),
    category: String(src.category || 'unknown'),
    documentType: ver500NormalizeDocumentType(src.documentType || ''),
    documentMatchedBy: String(src.documentMatchedBy || 'unknown'),
    date: String(src.date || ''),
    amount: ver500Num(src.amount),
    shipping: ver500Num(src.shipping),
    trackingNumber: ver500NormalizeTracking(src.trackingNumber || ''),
    storeName: String(src.storeName || ''),
    itemTitle: String(src.itemTitle || ''),
    supplierName: String(src.supplierName || ''),
    salesChannel: String(src.salesChannel || ''),
    genre: String(src.genre || ''),
    shippingCarrier: String(src.shippingCarrier || ''),
    accountType: String(src.accountType || 'unknown'),
    autoMapped: !!src.autoMapped,
    learnedMapped: !!src.learnedMapped,
    learnedFields: Array.isArray(src.learnedFields) ? src.learnedFields.map((v) => String(v || '')).filter(Boolean).slice(0, 8) : [],
    profileApplied: !!src.profileApplied,
    profileFields: Array.isArray(src.profileFields) ? src.profileFields.map((v) => String(v || '')).filter(Boolean).slice(0, 8) : [],
    confidenceScore: Math.max(0, Math.min(100, Number(src.confidenceScore || 0))),
    autoConfirmed: !!src.autoConfirmed,
    status: normStatus(src.status),
    reviewStatus: normReviewStatus(src.reviewStatus),
    manualCorrected: !!src.manualCorrected,
    correctedFields: Array.isArray(src.correctedFields) ? src.correctedFields.map((v) => String(v || '')).filter(Boolean).slice(0, 20) : [],
    assignee: String(src.assignee || ''),
    reviewedBy: String(src.reviewedBy || ''),
    reviewedAt: String(src.reviewedAt || ''),
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
    documentType: c.documentType || 'unknown',
    documentMatchedBy: c.documentMatchedBy || 'unknown',
    date: c.date || '',
    amount: c.amount || 0,
    shipping: c.shipping || 0,
    trackingNumber: c.slip || c.trackingNumber || '',
    storeName: c.partner || c.storeName || '',
    itemTitle: c.item || c.itemTitle || '',
    supplierName: c.supplierName || '',
    salesChannel: c.salesChannel || '',
    genre: c.genre || '',
    shippingCarrier: c.shippingCarrier || '',
    accountType: c.accountType || 'unknown',
    autoMapped: !!c.autoMapped,
    learnedMapped: !!c.learnedMapped,
    learnedFields: Array.isArray(c.learnedFields) ? c.learnedFields : [],
    profileApplied: !!c.profileApplied,
    profileFields: Array.isArray(c.profileFields) ? c.profileFields : [],
    confidenceScore: Math.max(0, Math.min(100, Number(c.confidenceScore || 0))),
    autoConfirmed: !!c.autoConfirmed,
    status: 'draft',
    assignee: String(c.assignee || ''),
    reviewedBy: String(c.reviewedBy || ''),
    reviewedAt: String(c.reviewedAt || ''),
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
function ver500BuildFallbackDraftFromForm() {
  const kind = String((document.getElementById('ver500Kind') || {}).value || 'auto');
  let sourceType = 'unknown';
  if (kind === 'sale') sourceType = 'sale';
  else if (kind === 'purchase' || kind === 'expense') sourceType = 'purchase';
  return {
    kind,
    sourceType,
    category: 'unknown',
    documentType: 'unknown',
    documentMatchedBy: 'unknown',
    date: String((document.getElementById('ver500Date') || {}).value || ''),
    partner: String((document.getElementById('ver500Partner') || {}).value || ''),
    item: String((document.getElementById('ver500Item') || {}).value || ''),
    amount: ver500Num((document.getElementById('ver500Amount') || {}).value || 0),
    slip: ver500NormalizeTracking((document.getElementById('ver500Slip') || {}).value || ''),
    supplierName: '',
    salesChannel: '',
    genre: ver500DetectGenre((document.getElementById('ver500Item') || {}).value || ''),
    shippingCarrier: '',
    accountType: sourceType === 'sale' ? 'sales' : sourceType === 'purchase' ? 'purchase' : 'unknown',
    autoMapped: false,
    learnedMapped: false,
    learnedFields: [],
    profileApplied: false,
    profileFields: [],
    confidenceScore: 0,
    autoConfirmed: false,
    evidence_url: String((document.getElementById('ver500EvidenceUrl') || {}).value || ''),
    memo: 'fallback draft route'
  };
}
function ver500SaveDraftRoute(result) {
  try {
    const source = result && typeof result === 'object' ? Object.assign({}, result) : ver500BuildFallbackDraftFromForm();
    source.status = 'draft';
    const route = ver500CreateDraftRouteFromCandidate(source);
    const saved = ver500UpsertDraftRoute(route);
    ver500AddAuditLog({
      action: 'draft_saved',
      routeId: saved && saved.id ? saved.id : '',
      target: saved && saved.sourceType ? saved.sourceType : '',
      before: {},
      after: { status: saved && saved.status ? saved.status : 'draft' },
      message: 'OCR候補を仮登録保存しました'
    });
    return saved;
  } catch (e) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: '仮登録保存に失敗しました' }]);
    return null;
  }
}
function ver500MaybeAutoConfirmRoute(route) {
  try {
    const fallback = ver500CreateDraftRouteFromCandidate(ver500BuildFallbackDraftFromForm());
    let row = ver500NormalizeRouteEntry(route || fallback);
    const score = ver500OcrConfidenceScore(row);
    row.confidenceScore = score;
    if (row.id) row = ver500UpsertDraftRoute(row);
    const enabled = ver500AutoConfirmEnabled();
    if (!enabled) {
      ver500AddAutoConfirmLog({
        routeId: row.id,
        score,
        sourceType: row.sourceType,
        category: row.category,
        documentType: row.documentType,
        result: 'disabled',
        message: '高信頼なら自動確定: OFF'
      });
      return { autoConfirmed: false, score, reason: 'disabled', route: row };
    }
    if (!ver500CanAutoConfirm(row, score)) {
      const blockMessage = ver500AutoConfirmBlockReason(row, score);
      ver500AddAutoConfirmLog({
        routeId: row.id,
        score,
        sourceType: row.sourceType,
        category: row.category,
        documentType: row.documentType,
        result: 'needs_review',
        message: blockMessage
      });
      return { autoConfirmed: false, score, reason: 'needs_review', message: blockMessage, route: row };
    }
    ver500ConfirmSelectedDraft(row.id, { auto: true, source: 'auto_confirm' });
    const confirmedRow = ver500DraftRoutes().find((x) => String(x.id || '') === String(row.id || '')) || row;
    ver500AddAuditLog({
      action: 'auto_confirmed',
      routeId: row.id,
      target: row.sourceType || 'unknown',
      before: { status: row.status || 'draft' },
      after: { status: 'confirmed', score },
      message: '高信頼のため自動確定しました'
    });
    ver500AddAutoConfirmLog({
      routeId: row.id,
      score,
      sourceType: row.sourceType,
      category: row.category,
      documentType: row.documentType,
      result: 'auto_confirmed',
      message: '高信頼のため自動確定しました'
    });
    return { autoConfirmed: true, score, reason: 'auto_confirmed', route: confirmedRow };
  } catch (e) {
    ver500AddAutoConfirmLog({
      routeId: '',
      score: 0,
      sourceType: 'unknown',
      category: 'unknown',
      documentType: 'unknown',
      result: 'error',
      message: '自動確定処理に失敗しました'
    });
    return { autoConfirmed: false, score: 0, reason: 'error', route: null };
  }
}
function ver500DraftRoutesContainer() {
  let box = document.getElementById('ver500DraftRoutesContainer');
  if (box) return box;
  const sec = document.getElementById('ocr');
  if (!sec) return null;
  box = document.createElement('div');
  box.id = 'ver500DraftRoutesContainer';
  box.className = 'list';
  box.style.marginTop = '8px';
  sec.appendChild(box);
  return box;
}
function ver500DraftFilterValue() {
  const el = document.getElementById('ver500DraftFilter');
  return String((el && el.value) || 'draft');
}
function ver500DraftStatusBadgeLabel(status) {
  const s = String(status || 'draft');
  if (s === 'confirmed') return '確定済み';
  if (s === 'ignored') return '除外済み';
  return '未確定';
}
function ver500ReviewStatusLabel(reviewStatus) {
  const s = String(reviewStatus || 'none');
  if (s === 'later') return 'あとで確認';
  if (s === 'pending') return '保留';
  if (s === 'ignored') return '無視';
  if (s === 'done') return '処理済み';
  return '未設定';
}
function ver500NormalizeReviewStatus(reviewStatus) {
  const s = String(reviewStatus || 'none');
  if (s === 'later' || s === 'pending' || s === 'ignored' || s === 'done') return s;
  return 'none';
}
function ver500CurrentStaffName() {
  const fromCurrent = String(localStorage.getItem('ribre_ocr_current_staff_v1') || '').trim();
  if (fromCurrent) return fromCurrent;
  const fromStaff = String(localStorage.getItem('ribre_current_staff_name') || localStorage.getItem('ribre_staff_name') || '').trim();
  if (fromStaff) return fromStaff;
  return String(ver500Email() || '').trim();
}
function ver500SetCurrentStaffName(name) {
  const n = String(name || '').trim();
  try {
    localStorage.setItem('ribre_ocr_current_staff_v1', n);
  } catch (e) {}
  return n;
}
function ver500FormatReviewedAt(v) {
  const d = v ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return y + '-' + m + '-' + day + ' ' + hh + ':' + mm;
}
function ver500SaveCurrentStaff() {
  const input = document.getElementById('ver500CurrentStaffInput');
  const before = ver500CurrentStaffName();
  const name = ver500SetCurrentStaffName((input && input.value) || '');
  ver500AddAuditLog({
    action: 'assignee_changed',
    target: 'current_staff',
    before: { assignee: before || '' },
    after: { assignee: name || '' },
    message: '現在担当者を更新しました'
  });
  ver500RenderDraftRouteList(name ? '現在の担当者を保存しました' : '担当者設定をクリアしました');
  return true;
}
function ver500PreviewEvidenceByRoute(routeId) {
  const targetId = String(routeId || '');
  const row = ver500DraftRoutes().find((x) => String((x && x.id) || '') === targetId);
  ver500AddAuditLog({
    action: 'evidence_preview',
    routeId: targetId,
    target: row && row.evidence_url ? row.evidence_url : '',
    before: {},
    after: {},
    message: row && row.evidence_url ? '証憑プレビューを表示しました' : '証憑なし候補を開きました'
  });
  window.__ver500EvidencePreviewRouteId = targetId;
  ver500RenderDraftRouteList();
  return true;
}
function ver500CloseEvidencePreview() {
  window.__ver500EvidencePreviewRouteId = '';
  ver500RenderDraftRouteList();
  return true;
}
function ver500FilteredDraftRoutes(rows, filterOverride) {
  const all = Array.isArray(rows) ? rows : [];
  const filter = String(filterOverride || ver500DraftFilterValue() || 'draft');
  const hideConfirmed = !!window.__ver500HideConfirmedDrafts;
  return all.filter((x) => {
    const status = String((x && x.status) || 'draft');
    if (filter === 'draft' && status !== 'draft') return false;
    if (filter === 'confirmed' && status !== 'confirmed') return false;
    if (filter === 'ignored' && status !== 'ignored') return false;
    if (hideConfirmed && status === 'confirmed') return false;
    return true;
  });
}
function ver500DeleteSelectedDraftRoute() {
  try {
    const select = document.getElementById('ver500DraftSelect');
    const targetId = String((select && select.value) || '');
    if (!targetId) {
      ver500RenderDraftRouteList('削除対象を選択してください');
      return;
    }
    const rows = ver500DraftRoutes();
    const deletedRow = rows.find((x) => String((x && x.id) || '') === targetId) || null;
    const next = rows.filter((x) => String((x && x.id) || '') !== targetId);
    if (next.length === rows.length) {
      ver500RenderDraftRouteList('選択候補が見つかりません');
      return;
    }
    ver500SaveDraftRoutes(next);
    ver500AddAuditLog({
      action: 'deleted',
      routeId: targetId,
      target: deletedRow ? deletedRow.sourceType || '' : '',
      before: deletedRow || {},
      after: {},
      message: 'OCR候補を削除しました'
    });
    ver500RenderDraftRouteList('選択候補を削除しました');
  } catch (e) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: 'OCR仮登録一覧の表示に失敗しました' }]);
  }
}
function ver500HideConfirmedDraftRoutes() {
  window.__ver500HideConfirmedDrafts = true;
  ver500RenderDraftRouteList('確定済みを非表示にしました');
}
function ver500CleanupOldDraftRoutes() {
  try {
    const rows = ver500DraftRoutes();
    let nonDraftCount = 0;
    const next = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const status = String((row && row.status) || 'draft');
      if (status === 'draft') {
        next.push(row);
        continue;
      }
      if (status === 'confirmed' || status === 'ignored') {
        if (nonDraftCount < 50) {
          next.push(row);
          nonDraftCount += 1;
        }
        continue;
      }
      next.push(row);
    }
    ver500SaveDraftRoutes(next);
    ver500RenderDraftRouteList('古い仮登録を整理しました');
  } catch (e) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: 'OCR仮登録一覧の表示に失敗しました' }]);
  }
}
function ver500RenderDraftRouteList(noticeMsg) {
  try {
    let rows = ver500DraftRoutes();
    if (!Array.isArray(rows)) rows = [];
    const draftListIsToday = (v) => {
      const d = v ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    };
    const draftListMissingItems = (x) => {
      const miss = [];
      if (!ver500SafeString(x && x.date).trim()) miss.push('日付');
      if (ver500Num((x && x.amount) || 0) <= 0) miss.push('金額');
      if (!ver500SafeString(x && x.storeName).trim()) miss.push('相手先');
      if (!ver500NormalizeTracking(ver500SafeString((x && (x.trackingNumber || x.slip)) || ''))) miss.push('伝票番号');
      return miss;
    };
    const draftListMissingText = (miss) => (miss.length ? '要確認: ' + miss.join('・') + 'が未入力' : '');
    const draftListDetectEvidenceType = (url) => {
      const u = ver500SafeString(url).trim();
      if (!u) return 'none';
      if (/^data:image\//i.test(u)) return 'image';
      if (/^data:application\/pdf/i.test(u)) return 'pdf';
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return 'image';
      if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf';
      if (/^https?:\/\//i.test(u) || /^blob:/i.test(u)) return 'url';
      return 'url';
    };
    const currentFilter = ver500DraftFilterValue();
    const currentViewMode = String(window.__ver500DraftViewMode || 'priority');
    const currentStaff = ver500CurrentStaffName();
    const filterState = ver500ListFilterState();
    window.__ver500DraftMineOnly = !!filterState.mineOnly;
    const queryWord = ver500SafeString(filterState.query).trim().toLowerCase();
    const minRaw = ver500SafeString(filterState.minAmount).trim();
    const maxRaw = ver500SafeString(filterState.maxAmount).trim();
    const minAmount = minRaw === '' ? null : ver500SafeNumber(minRaw);
    const maxAmount = maxRaw === '' ? null : ver500SafeNumber(maxRaw);
    const baseRows = ver500FilteredDraftRoutes(rows, currentFilter);
    const safeBaseRows = Array.isArray(baseRows) ? baseRows : [];
    const filteredRows = safeBaseRows.filter((x) => {
      const row = x && typeof x === 'object' ? x : {};
      const score = Math.max(0, Math.min(100, Number(row.confidenceScore || ver500OcrConfidenceScore(row))));
      const miss = draftListMissingItems(row);
      const sourceUnknown = String(row.sourceType || 'unknown') === 'unknown';
      const docUnknown = ver500NormalizeDocumentType(row.documentType || 'unknown') === 'unknown';
      const needsReview = miss.length > 0 || score < 70 || sourceUnknown || docUnknown;
      if (filterState.needReviewOnly && !needsReview) return false;
      if (filterState.manualCorrectedOnly && !row.manualCorrected) return false;
      if (filterState.learnedOnly && !row.learnedMapped) return false;
      if (filterState.profiledOnly && !row.profileApplied) return false;
      if (filterState.autoConfirmedOnly && !row.autoConfirmed) return false;
      if (filterState.hasEvidenceOnly && !String(row.evidence_url || '').trim()) return false;
      if (filterState.todayProcessedOnly) {
        const isDoneToday =
          draftListIsToday(row.reviewedAt) ||
          (String(row.status || 'draft') === 'confirmed' && (draftListIsToday(row.updatedAt) || draftListIsToday(row.createdAt)));
        if (!isDoneToday) return false;
      }
      if (filterState.mineOnly) {
        if (!currentStaff) return true;
        if (String(row.assignee || '').trim() !== currentStaff) return false;
      }
      const amount = ver500SafeNumber(row.amount != null ? row.amount : ver500Num(row.amount || 0));
      if (minAmount != null && amount < minAmount) return false;
      if (maxAmount != null && amount > maxAmount) return false;
      if (queryWord) {
        const haystack = [
          ver500SafeString(row.storeName),
          ver500SafeString(row.itemTitle),
          ver500SafeString(row.amount),
          ver500SafeString(row.trackingNumber),
          ver500SafeString(row.documentType),
          ver500SafeString(ver500DocumentTypeLabel(row.documentType || 'unknown')),
          ver500SafeString(row.sourceType),
          ver500SafeString(ver500RouteLabel(row.sourceType || 'unknown')),
          ver500SafeString(row.assignee),
          ver500SafeString(row.reviewedBy),
          ver500SafeString(row.note)
        ]
          .map((v) => ver500SafeString(v).toLowerCase())
          .join(' ');
        if (!haystack.includes(queryWord)) return false;
      }
      return true;
    });
    const safeFilteredRows = Array.isArray(filteredRows) ? filteredRows : [];
    const box = ver500DraftRoutesContainer();
    const esc = (v) =>
      String(v || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    const escJs = (v) => String(v || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    const scoreLabel = (score) => {
      if (score >= 90) return '高信頼';
      if (score >= 70) return '確認推奨';
      if (score >= 50) return '要確認';
      return '低信頼';
    };
    const scoreStyle = (score) => {
      if (score >= 80) return { bg: '#edf9ef', bar: '#48a868' };
      if (score >= 50) return { bg: '#fff9e8', bar: '#d1a233' };
      return { bg: '#fff0f0', bar: '#d45a5a' };
    };
    const badgeHtml = (text, bg, color = '#1f2937') =>
      '<span class="badge" style="background:' +
      bg +
      ';color:' +
      color +
      ';border:1px solid ' +
      bg +
      ';margin-left:4px;">' +
      esc(text) +
      '</span>';
    const statusBadgeHtml = (statusText, statusRaw) => {
      const s = String(statusRaw || 'draft');
      if (s === 'confirmed') return badgeHtml('[' + statusText + ']', '#e8f7ec', '#1f7a34');
      if (s === 'ignored') return badgeHtml('[' + statusText + ']', '#fdecec', '#b33a3a');
      return badgeHtml('[' + statusText + ']', '#eceff3', '#4b5563');
    };
    const reviewStatusBadgeHtml = (reviewStatus) => {
      const s = ver500NormalizeReviewStatus(reviewStatus);
      if (s === 'later') return badgeHtml('[あとで確認]', '#fff9e8', '#8a6a00');
      if (s === 'pending') return badgeHtml('[保留]', '#eaf2ff', '#1e40af');
      if (s === 'ignored') return badgeHtml('[無視]', '#eceff3', '#4b5563');
      if (s === 'done') return badgeHtml('[処理済み]', '#e8f7ec', '#1f7a34');
      return '';
    };
    const scoreBadgeHtml = (score, label) => {
      const st = scoreStyle(score);
      return badgeHtml('判定精度: ' + score + '（' + label + '）', st.bg, '#1f2937');
    };
    const select = document.getElementById('ver500DraftSelect');
    const prevSelectedId = String((select && select.value) || '');
    if (select) {
      select.innerHTML = '';
      let matched = false;
      safeFilteredRows.forEach((x) => {
        const op = document.createElement('option');
        op.value = x.id;
        const statusLabel = ver500DraftStatusBadgeLabel(x.status || 'draft');
        op.textContent =
          '[' +
          statusLabel +
          '] ' +
          (x.date || '日付不明') +
          ' / ' +
          ver500RouteLabel(x.sourceType) +
          ' / ' +
          (x.storeName || '-') +
          ' / ' +
          (x.amount || 0) +
          '円';
        if (prevSelectedId && String(x.id || '') === prevSelectedId) {
          op.selected = true;
          matched = true;
        }
        select.appendChild(op);
      });
      if (!matched && select.options.length) select.options[0].selected = true;
    }
    if (!box) {
      ver500Render([{ type: '仮登録', level: 'warn', msg: 'OCR仮登録一覧の表示に失敗しました' }]);
      return;
    }
    let toolbarHtml = '';
    let summaryHtml = '';
    try {
      const selected = (v) => (currentFilter === v ? ' selected' : '');
      const selectedMode = (v) => (currentViewMode === v ? ' selected' : '');
      const summary = {
        urgent: 0,
        draft: 0,
        autoConfirmed: 0,
        confirmed: 0,
        ignored: 0,
        later: 0,
        pending: 0,
        mine: 0,
        doneToday: 0
      };
      rows.forEach((r) => {
        const row = r && typeof r === 'object' ? r : {};
        const score = Math.max(0, Math.min(100, Number(row.confidenceScore || ver500OcrConfidenceScore(row))));
        const miss = draftListMissingItems(row);
        const statusRaw = String(row.status || 'draft');
        const reviewStatus = ver500NormalizeReviewStatus(row.reviewStatus || 'none');
        const sourceUnknown = String(row.sourceType || 'unknown') === 'unknown';
        const docUnknown = ver500NormalizeDocumentType(row.documentType || 'unknown') === 'unknown';
        const urgent = miss.length > 0 || score < 70 || sourceUnknown || docUnknown;
        if (urgent) summary.urgent += 1;
        if (statusRaw === 'draft' && !urgent) summary.draft += 1;
        if (row.autoConfirmed) summary.autoConfirmed += 1;
        if (statusRaw === 'confirmed' && !row.autoConfirmed) summary.confirmed += 1;
        if (statusRaw === 'ignored') summary.ignored += 1;
        if (reviewStatus === 'later') summary.later += 1;
        if (reviewStatus === 'pending') summary.pending += 1;
        if (currentStaff && String(row.assignee || '').trim() === currentStaff) summary.mine += 1;
        if (draftListIsToday(row.reviewedAt) || (statusRaw === 'confirmed' && (draftListIsToday(row.updatedAt) || draftListIsToday(row.createdAt)))) summary.doneToday += 1;
      });
      const summaryCard = (label, count, bg, border, color) =>
        '<div style="min-width:120px;flex:1 1 120px;padding:8px 10px;border-radius:10px;background:' +
        bg +
        ';border:1px solid ' +
        border +
        ';"><div style="font-size:12px;color:' +
        color +
        ';">' +
        esc(label) +
        '</div><div style="font-size:18px;font-weight:700;color:' +
        color +
        ';">' +
        count +
        '件</div></div>';
      summaryHtml =
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 8px 0;">' +
        summaryCard('今すぐ確認が必要', summary.urgent, '#fdecec', '#f3c3c3', '#a63a3a') +
        summaryCard('未確定', summary.draft, '#fff9e8', '#f1deaa', '#8a6a00') +
        summaryCard('自動確定済み', summary.autoConfirmed, '#eaf2ff', '#c3d6f6', '#1e40af') +
        summaryCard('確定済み', summary.confirmed, '#e8f7ec', '#b8e6c4', '#1f7a34') +
        summaryCard('除外済み', summary.ignored, '#f1f3f5', '#d8dde3', '#4b5563') +
        summaryCard('あとで確認', summary.later, '#fff5e8', '#f0d1a6', '#9a5b00') +
        summaryCard('保留', summary.pending, '#efeaff', '#d5c5f6', '#6d28d9') +
        summaryCard('自分の担当', summary.mine, '#e7f7f5', '#b9e4dd', '#0f766e') +
        summaryCard('今日処理済み', summary.doneToday, '#e8f7ec', '#b8e6c4', '#1f7a34') +
        '</div>';
      toolbarHtml =
        '<div class="row ok"><span>' +
        '<label for="ver500CurrentStaffInput">担当者:</label> ' +
        '<input id="ver500CurrentStaffInput" value="' +
        esc(currentStaff) +
        '" placeholder="担当者名" style="width:120px;" /> ' +
        '<button id="ver500CurrentStaffSaveBtn" onclick="ver500SaveCurrentStaff()">担当者保存</button> ' +
        '<span id="ver500CurrentStaffLabel" class="badge">現在の担当者: ' +
        esc(currentStaff || '未設定') +
        '</span> ' +
        '<label for="ver500DraftFilter">フィルタ:</label> ' +
        '<select id="ver500DraftFilter" onchange="ver500RenderDraftRouteList()">' +
        '<option value="all"' +
        selected('all') +
        '>すべて表示</option>' +
        '<option value="draft"' +
        selected('draft') +
        '>未確定のみ</option>' +
        '<option value="confirmed"' +
        selected('confirmed') +
        '>確定済みのみ</option>' +
        '<option value="ignored"' +
        selected('ignored') +
        '>除外済みのみ</option>' +
        '</select> ' +
        '<label for="ver500DraftViewMode">表示:</label> ' +
        '<select id="ver500DraftViewMode" onchange="window.__ver500DraftViewMode=this.value;ver500RenderDraftRouteList()">' +
        '<option value="priority"' +
        selectedMode('priority') +
        '>対応優先順</option>' +
        '<option value="doctype"' +
        selectedMode('doctype') +
        '>帳票タイプ別</option>' +
        '<option value="status"' +
        selectedMode('status') +
        '>状態別</option>' +
        '</select> ' +
        '<label><input type="checkbox" id="ver500DraftMineOnly" ' +
        (filterState.mineOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'mineOnly\', this.checked)" />自分の担当のみ</label> ' +
        '<button id="ver500FilterResetBtn" onclick="ver500ResetListFilters()">絞り込み解除</button> ' +
        '<button id="ver500DeleteDraftBtn" onclick="ver500DeleteSelectedDraftRoute()">選んだ候補を削除</button> ' +
        '<button id="ver500ReviewLaterBtn" onclick="ver500SetSelectedDraftReviewStatus(\'later\')">選択候補をあとで確認</button> ' +
        '<button id="ver500ReviewPendingBtn" onclick="ver500SetSelectedDraftReviewStatus(\'pending\')">選択候補を保留</button> ' +
        '<button id="ver500ReviewDoneBtn" onclick="ver500SetSelectedDraftReviewStatus(\'done\')">選択候補を処理済み</button> ' +
        '<button id="ver500HideConfirmedBtn" onclick="ver500HideConfirmedDraftRoutes()">確定済みを隠す</button> ' +
        '<button id="ver500CleanupDraftBtn" onclick="ver500CleanupOldDraftRoutes()">古い候補を整理</button>' +
        '</span><span class="badge">操作</span></div>' +
        '<div class="row ok"><span>' +
        '<label for="ver500SearchQuery">検索:</label> ' +
        '<input id="ver500SearchQuery" value="' +
        esc(filterState.query || '') +
        '" placeholder="相手先・内容・金額・伝票番号・帳票タイプ・登録種別・担当者・確認者・メモ" style="min-width:280px;" oninput="ver500SetListFilterField(\'query\', this.value)" /> ' +
        '<label><input type="checkbox" ' +
        (filterState.needReviewOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'needReviewOnly\', this.checked)" />要確認のみ</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.manualCorrectedOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'manualCorrectedOnly\', this.checked)" />手動修正あり</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.learnedOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'learnedOnly\', this.checked)" />AI学習済み</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.profiledOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'profiledOnly\', this.checked)" />帳票ルール適用</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.autoConfirmedOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'autoConfirmedOnly\', this.checked)" />自動確定のみ</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.hasEvidenceOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'hasEvidenceOnly\', this.checked)" />証憑あり</label> ' +
        '<label><input type="checkbox" ' +
        (filterState.todayProcessedOnly ? 'checked ' : '') +
        'onchange="ver500SetListFilterField(\'todayProcessedOnly\', this.checked)" />今日処理したもの</label> ' +
        '<label>最小金額 <input value="' +
        esc(filterState.minAmount || '') +
        '" style="width:90px;" oninput="ver500SetListFilterField(\'minAmount\', this.value)" /></label> ' +
        '<label>最大金額 <input value="' +
        esc(filterState.maxAmount || '') +
        '" style="width:90px;" oninput="ver500SetListFilterField(\'maxAmount\', this.value)" /></label>' +
        '</span><span class="badge">検索</span></div>';
    } catch (e) {
      ver500Render([{ type: '仮登録', level: 'warn', msg: 'OCR仮登録フィルタUIの生成に失敗しました' }]);
      toolbarHtml = '<div class="row warn"><span>OCR仮登録フィルタUIの生成に失敗しました</span><span class="badge">error</span></div>';
    }
    if (!safeFilteredRows.length) {
      ver500SetBulkSelectedIds([]);
      box.innerHTML =
        summaryHtml +
        toolbarHtml +
        '<div class="row ok"><span>OCR読取候補一覧（表示中: 0件 / 全体: ' +
        rows.length +
        '件）</span><span class="badge">[未確定]</span></div>' +
        '<div class="row warn"><span>仮登録はありません</span><span class="badge">0件</span></div>';
      return;
    }
    const selectedBulkIds = ver500BulkSelectedIds();
    const cardRows = safeFilteredRows.slice(0, 100).map((x) => {
      const rowId = String(x.id || '');
      const selectedId = String((select && select.value) || '');
      const isSelected = rowId && rowId === selectedId;
      const isBulkChecked = selectedBulkIds.includes(rowId);
      const status = ver500DraftStatusBadgeLabel(x.status || 'draft');
      const score = Math.max(0, Math.min(100, Number(x.confidenceScore || ver500OcrConfidenceScore(x))));
      const conf = scoreLabel(score);
      const style = scoreStyle(score);
      const miss = draftListMissingItems(x);
      const missText = draftListMissingText(miss);
      const missBadge = missText ? badgeHtml(missText, '#fdecec', '#b33a3a') : '';
      const reviewStatus = ver500NormalizeReviewStatus(x.reviewStatus || 'none');
      const reviewBadge = reviewStatusBadgeHtml(reviewStatus);
      const correctedBadge = x.manualCorrected ? badgeHtml('[手動修正あり]', '#fff2e6', '#9a3412') : '';
      const learned = x.learnedMapped ? badgeHtml('[AI学習済み]', '#e8f2ff', '#1d4ed8') : '';
      const profiled = x.profileApplied ? badgeHtml('[帳票ルール適用]', '#f2ecff', '#6d28d9') : '';
      const autoBadge = x.autoConfirmed ? badgeHtml('[自動確定]', '#eaf2ff', '#1e40af') : '';
      const isEditing = String(window.__ver500EditRouteId || '') === rowId;
      const sourceOptions = ['sale', 'purchase', 'shipping', 'receipt', 'unknown']
        .map((v) => '<option value="' + v + '"' + (String(x.sourceType || 'unknown') === v ? ' selected' : '') + '>' + esc(ver500RouteLabel(v)) + '</option>')
        .join('');
      const docOptions = ver500AllowedDocumentTypes()
        .map(
          (v) =>
            '<option value="' +
            esc(v) +
            '"' +
            (ver500NormalizeDocumentType(x.documentType || 'unknown') === v ? ' selected' : '') +
            '>' +
            esc(ver500DocumentTypeLabel(v)) +
            '</option>'
        )
        .join('');
      const cardHtml =
        '<div class="row ok" style="background:' +
        style.bg +
        ';border-left:4px solid ' +
        style.bar +
        ';padding:10px 12px;border-radius:10px;margin-bottom:8px;cursor:pointer;' +
        (isSelected ? 'outline:2px solid #8aaee8;' : '') +
        '" onclick="ver500SelectDraftRouteCard(\'' +
        escJs(rowId) +
        '\')">' +
        '<div style="display:flex;flex-direction:column;gap:7px;width:100%;">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<input type="checkbox" onclick="event.stopPropagation()" onchange="event.stopPropagation();ver500ToggleBulkSelect(\'' +
        escJs(rowId) +
        '\', this.checked)" ' +
        (isBulkChecked ? 'checked ' : '') +
        '/>' +
        statusBadgeHtml(status, x.status || 'draft') +
        '<span>' +
        esc(x.date || '') +
        '</span><span>' +
        esc(ver500RouteLabel(x.sourceType)) +
        '</span><span>' +
        esc(ver500DocumentTypeLabel(x.documentType || 'unknown')) +
        '</span></div>' +
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
        reviewBadge +
        '<button onclick="event.stopPropagation();ver500PreviewEvidenceByRoute(\'' +
        escJs(rowId) +
        '\')">証憑を見る</button>' +
        '<button onclick="event.stopPropagation();ver500OpenManualCorrect(\'' +
        escJs(rowId) +
        '\')">修正する</button>' +
        '<select onclick="event.stopPropagation()" onchange="event.stopPropagation();ver500SetDraftReviewStatus(\'' +
        escJs(rowId) +
        '\', this.value)">' +
        '<option value="none"' +
        (reviewStatus === 'none' ? ' selected' : '') +
        '>未設定</option>' +
        '<option value="later"' +
        (reviewStatus === 'later' ? ' selected' : '') +
        '>あとで確認</option>' +
        '<option value="pending"' +
        (reviewStatus === 'pending' ? ' selected' : '') +
        '>保留</option>' +
        '<option value="ignored"' +
        (reviewStatus === 'ignored' ? ' selected' : '') +
        '>無視</option>' +
        '<option value="done"' +
        (reviewStatus === 'done' ? ' selected' : '') +
        '>処理済み</option>' +
        '</select></div></div>' +
        (isEditing
          ? '<div style="display:flex;flex-wrap:wrap;gap:8px;">' +
            '<label>日付 <input id="ver500EditDate" value="' +
            esc(x.date || '') +
            '" /></label>' +
            '<label>金額 <input id="ver500EditAmount" value="' +
            esc(x.amount || 0) +
            '" /></label>' +
            '<label>相手先 <input id="ver500EditStoreName" value="' +
            esc(x.storeName || '') +
            '" /></label>' +
            '<label>内容 <input id="ver500EditItemTitle" value="' +
            esc(x.itemTitle || '') +
            '" /></label>' +
            '<label>伝票番号 <input id="ver500EditTracking" value="' +
            esc(x.trackingNumber || '') +
            '" /></label>' +
            '<label>登録種別 <select id="ver500EditSourceType">' +
            sourceOptions +
            '</select></label>' +
            '<label>帳票タイプ <select id="ver500EditDocumentType">' +
            docOptions +
            '</select></label>' +
            '<button onclick="event.stopPropagation();ver500SaveManualCorrect(\'' +
            escJs(rowId) +
            '\')">保存</button>' +
            '<button onclick="event.stopPropagation();ver500CancelManualCorrect()">キャンセル</button>' +
            '</div>'
          : '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '<span>相手先: ' +
            esc(x.storeName || '-') +
            '</span><span>内容: ' +
            esc(x.itemTitle || '-') +
            '</span><span style="font-weight:700;">金額: ' +
            esc(x.amount || 0) +
            '円</span></div>') +
        '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
        '<span>担当: ' +
        esc(x.assignee || '-') +
        '</span><span>確認者: ' +
        esc(x.reviewedBy || '-') +
        '</span><span>確認日時: ' +
        esc(ver500FormatReviewedAt(x.reviewedAt) || '-') +
        '</span></div>' +
        '<div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap;">' +
        scoreBadgeHtml(score, conf) +
        missBadge +
        correctedBadge +
        learned +
        profiled +
        autoBadge +
        '</div></div>' +
        '</div>';
      return {
        row: x,
        score,
        miss,
        cardHtml
      };
    });
    const renderSubGroup = (meta, cards) =>
      '<details style="margin:6px 0;"' +
      (meta.open ? ' open' : '') +
      '><summary style="cursor:pointer;padding:6px 10px;border-radius:8px;background:' +
      meta.bg +
      ';font-weight:600;">' +
      esc(meta.label) +
      '（' +
      cards.length +
      '件）</summary><div style="padding:6px 2px 2px 2px;">' +
      cards.map((x) => x.cardHtml).join('') +
      '</div></details>';
    const renderTopGroup = (label, cards, bodyHtml) =>
      '<details open style="margin:8px 0;"><summary style="cursor:pointer;padding:7px 10px;border-radius:8px;background:#f5f7fb;font-weight:700;">' +
      esc(label) +
      '（' +
      cards.length +
      '件）</summary><div style="padding-top:6px;">' +
      bodyHtml +
      '</div></details>';
    const priorityMeta = (entry) => {
      const x = entry.row || {};
      const reviewStatus = ver500NormalizeReviewStatus(x.reviewStatus || 'none');
      if (reviewStatus === 'later') return { key: 'later', label: '🟠 あとで確認', bg: '#fff9e8', open: true };
      if (reviewStatus === 'pending') return { key: 'pending', label: '🟣 保留', bg: '#efeaff', open: true };
      const sourceUnknown = String(x.sourceType || 'unknown') === 'unknown';
      const docUnknown = ver500NormalizeDocumentType(x.documentType || 'unknown') === 'unknown';
      const needsNow = entry.miss.length > 0 || entry.score < 70 || sourceUnknown || docUnknown;
      if (needsNow) return { key: 'urgent', label: '🔴 今すぐ確認が必要', bg: '#fdecec', open: true };
      if (String(x.status || 'draft') === 'ignored') return { key: 'ignored', label: '⚪ 除外済み', bg: '#f7f1f1', open: false };
      if (x.autoConfirmed) return { key: 'auto_confirmed', label: '🔵 自動確定済み', bg: '#eaf2ff', open: false };
      if (String(x.status || 'draft') === 'confirmed') return { key: 'confirmed', label: '🟢 確定済み', bg: '#e8f7ec', open: false };
      return { key: 'draft', label: '🟡 未確定', bg: '#f1f3f5', open: true };
    };
    const docSubtypeMeta = (entry) => {
      const x = entry.row || {};
      if (entry.miss.length) return { key: 'review', label: '要確認あり', bg: '#fdecec', open: true };
      if (x.autoConfirmed) return { key: 'auto_confirmed', label: '自動確定', bg: '#eaf2ff', open: false };
      if (String(x.status || 'draft') === 'confirmed') return { key: 'confirmed', label: '確定済み', bg: '#e8f7ec', open: false };
      if (String(x.status || 'draft') === 'ignored') return { key: 'ignored', label: '除外済み', bg: '#f7f1f1', open: false };
      return { key: 'draft', label: '未確定', bg: '#f1f3f5', open: true };
    };
    const statusOnlyMeta = (entry) => {
      const s = String((entry.row && entry.row.status) || 'draft');
      if (s === 'confirmed') return { key: 'confirmed', label: '確定済み', bg: '#e8f7ec', open: false };
      if (s === 'ignored') return { key: 'ignored', label: '除外済み', bg: '#f7f1f1', open: false };
      return { key: 'draft', label: '未確定', bg: '#f1f3f5', open: true };
    };
    const buildGroupedHtml = (entries, groupBy, orderKeys) => {
      const grouped = {};
      entries.forEach((e) => {
        const meta = groupBy(e);
        if (!grouped[meta.key]) grouped[meta.key] = { meta, cards: [] };
        grouped[meta.key].cards.push(e);
      });
      return orderKeys
        .filter((k) => grouped[k] && grouped[k].cards.length)
        .map((k) => renderSubGroup(grouped[k].meta, grouped[k].cards))
        .join('');
    };
    let contentHtml = '';
    if (currentViewMode === 'status') {
      contentHtml = buildGroupedHtml(cardRows, statusOnlyMeta, ['draft', 'confirmed', 'ignored']);
    } else if (currentViewMode === 'doctype') {
      const docs = {};
      cardRows.forEach((e) => {
        const docLabel = ver500DocumentTypeLabel((e.row && e.row.documentType) || 'unknown');
        if (!docs[docLabel]) docs[docLabel] = [];
        docs[docLabel].push(e);
      });
      contentHtml = Object.keys(docs)
        .map((docLabel) => {
          const rowsByDoc = docs[docLabel];
          const body = buildGroupedHtml(rowsByDoc, docSubtypeMeta, ['review', 'draft', 'auto_confirmed', 'confirmed', 'ignored']);
          return renderTopGroup(docLabel, rowsByDoc, body);
        })
        .join('');
    } else {
      contentHtml = buildGroupedHtml(cardRows, priorityMeta, ['later', 'pending', 'urgent', 'draft', 'auto_confirmed', 'confirmed', 'ignored']);
    }
    const header =
      '<div class="row ok"><span>OCR読取候補一覧（表示中: ' +
      safeFilteredRows.length +
      '件 / 全体: ' +
      rows.length +
      '件）' +
      (noticeMsg ? ' / ' + esc(noticeMsg) : '') +
      '</span><span class="badge">一覧</span></div>';
    const bulkCount = ver500BulkSelectedIds().length;
    const bulkBarHtml =
      '<div class="row ok"><span>' +
      '選択中: ' +
      bulkCount +
      '件 ' +
      '<button onclick="ver500BulkConfirmSelected()">一括確定</button> ' +
      '<button onclick="ver500BulkSetReviewStatus(\'later\')">一括あとで確認</button> ' +
      '<button onclick="ver500BulkSetReviewStatus(\'pending\')">一括保留</button> ' +
      '<button onclick="ver500BulkSetReviewStatus(\'done\')">一括処理済み</button> ' +
      '<button onclick="ver500BulkDeleteSelected()">一括削除</button> ' +
      '<button onclick="ver500ClearBulkSelection()">選択解除</button>' +
      '</span><span class="badge">一括</span></div>';
    let previewHtml = '';
    const previewRouteId = String(window.__ver500EvidencePreviewRouteId || '');
    if (previewRouteId) {
      const previewRow = rows.find((x) => String((x && x.id) || '') === previewRouteId);
      const evidenceUrl = previewRow ? String(previewRow.evidence_url || '') : '';
      const evidenceType = draftListDetectEvidenceType(evidenceUrl);
      if (!previewRow) {
        previewHtml =
          '<div class="row warn"><span>証憑プレビュー: 対象候補が見つかりません</span><span class="badge"><button onclick="ver500CloseEvidencePreview()">閉じる</button></span></div>';
      } else if (!evidenceUrl) {
        previewHtml =
          '<div class="row warn"><span>証憑プレビュー / 証憑がありません</span><span class="badge"><button onclick="ver500CloseEvidencePreview()">閉じる</button></span></div>';
      } else if (evidenceType === 'image') {
        previewHtml =
          '<div class="row ok"><span>証憑プレビュー</span><span class="badge"><button onclick="ver500CloseEvidencePreview()">閉じる</button></span></div>' +
          '<div class="row ok"><span style="display:block;width:100%;">' +
          '<a href="' +
          esc(evidenceUrl) +
          '" target="_blank" rel="noopener">画像を別タブで表示</a><br />' +
          '<a href="' +
          esc(evidenceUrl) +
          '" target="_blank" rel="noopener">' +
          '<img src="' +
          esc(evidenceUrl) +
          '" alt="証憑画像" style="max-width:100%;max-height:520px;object-fit:contain;border:1px solid #d8dde3;border-radius:8px;margin-top:6px;" />' +
          '</a></span><span class="badge">画像</span></div>';
      } else if (evidenceType === 'pdf') {
        previewHtml =
          '<div class="row ok"><span>証憑プレビュー</span><span class="badge"><button onclick="ver500CloseEvidencePreview()">閉じる</button></span></div>' +
          '<div class="row ok"><span style="display:block;width:100%;">' +
          '<a href="' +
          esc(evidenceUrl) +
          '" target="_blank" rel="noopener">PDFを別タブで開く</a>' +
          '<iframe src="' +
          esc(evidenceUrl) +
          '" style="width:100%;height:520px;border:1px solid #d8dde3;border-radius:8px;margin-top:6px;" title="証憑PDFプレビュー"></iframe>' +
          '<div class="hint">表示できない場合は「PDFを別タブで開く」を押してください。</div>' +
          '</span><span class="badge">PDF</span></div>';
      } else {
        previewHtml =
          '<div class="row ok"><span>証憑プレビュー</span><span class="badge"><button onclick="ver500CloseEvidencePreview()">閉じる</button></span></div>' +
          '<div class="row ok"><span style="display:block;width:100%;">' +
          '<a href="' +
          esc(evidenceUrl) +
          '" target="_blank" rel="noopener">証憑URLを別タブで開く</a>' +
          '<div class="hint">この証憑はリンク形式です。上のリンクから確認してください。</div>' +
          '</span><span class="badge">URL</span></div>';
      }
    }
    box.innerHTML = summaryHtml + toolbarHtml + bulkBarHtml + header + contentHtml + previewHtml;
  } catch (e) {
    ver500Render([{ type: '仮登録', level: 'warn', msg: 'OCR仮登録一覧の表示に失敗しました' }]);
    const box = ver500DraftRoutesContainer();
    if (box) box.innerHTML = '<div class="row warn"><span>OCR仮登録一覧の表示に失敗しました</span><span class="badge">error</span></div>';
  }
}
function ver500ShowDraftRoutes() {
  ver500RenderDraftRouteList();
  return true;
}
function ver500SelectDraftRouteCard(routeId) {
  try {
    const select = document.getElementById('ver500DraftSelect');
    const id = String(routeId || '');
    if (!select || !id) return false;
    let found = false;
    for (let i = 0; i < select.options.length; i++) {
      if (String(select.options[i].value || '') === id) {
        select.selectedIndex = i;
        found = true;
        break;
      }
    }
    if (!found) return false;
    ver500RenderDraftRouteList();
    return true;
  } catch (e) {
    return false;
  }
}
function ver500BulkSelectedIds() {
  const rows = Array.isArray(window.__ver500BulkSelectedIds) ? window.__ver500BulkSelectedIds : [];
  return rows.map((x) => String(x || '')).filter(Boolean);
}
function ver500SetBulkSelectedIds(arr) {
  const uniq = Array.from(new Set((Array.isArray(arr) ? arr : []).map((x) => String(x || '')).filter(Boolean)));
  window.__ver500BulkSelectedIds = uniq;
  return uniq;
}
function ver500ToggleBulkSelect(routeId, checked) {
  const id = String(routeId || '');
  const set = ver500BulkSelectedIds();
  const exists = set.includes(id);
  if (checked && !exists) set.push(id);
  if (!checked && exists) {
    const next = set.filter((x) => x !== id);
    ver500SetBulkSelectedIds(next);
    ver500RenderDraftRouteList();
    return true;
  }
  ver500SetBulkSelectedIds(set);
  ver500RenderDraftRouteList();
  return true;
}
function ver500ClearBulkSelection() {
  ver500SetBulkSelectedIds([]);
  ver500RenderDraftRouteList('選択を解除しました');
  return true;
}
function ver500ListFilterState() {
  const base = {
    query: '',
    needReviewOnly: false,
    manualCorrectedOnly: false,
    learnedOnly: false,
    profiledOnly: false,
    autoConfirmedOnly: false,
    hasEvidenceOnly: false,
    todayProcessedOnly: false,
    mineOnly: false,
    minAmount: '',
    maxAmount: ''
  };
  const src = window.__ver500ListFilterState && typeof window.__ver500ListFilterState === 'object' ? window.__ver500ListFilterState : {};
  return Object.assign({}, base, src);
}
function ver500SetListFilterField(key, value) {
  const next = ver500ListFilterState();
  next[String(key || '')] = value;
  next.mineOnly = !!next.mineOnly;
  window.__ver500ListFilterState = next;
  window.__ver500DraftMineOnly = !!next.mineOnly;
  ver500RenderDraftRouteList();
  return true;
}
function ver500ResetListFilters() {
  window.__ver500ListFilterState = {
    query: '',
    needReviewOnly: false,
    manualCorrectedOnly: false,
    learnedOnly: false,
    profiledOnly: false,
    autoConfirmedOnly: false,
    hasEvidenceOnly: false,
    todayProcessedOnly: false,
    mineOnly: false,
    minAmount: '',
    maxAmount: ''
  };
  window.__ver500DraftMineOnly = false;
  ver500RenderDraftRouteList('絞り込みを解除しました');
  return true;
}
function ver500OpenManualCorrect(routeId) {
  window.__ver500EditRouteId = String(routeId || '');
  ver500RenderDraftRouteList();
  return true;
}
function ver500CancelManualCorrect() {
  window.__ver500EditRouteId = '';
  ver500RenderDraftRouteList();
  return true;
}
function ver500SaveManualCorrect(routeId) {
  try {
    const id = String(routeId || '');
    if (!id) return false;
    const rows = ver500DraftRoutes();
    const idx = rows.findIndex((x) => String((x && x.id) || '') === id);
    if (idx < 0) return false;
    const beforeRow = ver500NormalizeRouteEntry(rows[idx]);
    const srcTypeRaw = String(((document.getElementById('ver500EditSourceType') || {}).value || '')).trim();
    const sourceType = ['sale', 'purchase', 'shipping', 'receipt'].includes(srcTypeRaw) ? srcTypeRaw : 'unknown';
    const documentType = ver500NormalizeDocumentType((document.getElementById('ver500EditDocumentType') || {}).value || 'unknown');
    const updated = ver500NormalizeRouteEntry(
      Object.assign({}, beforeRow, {
        date: String((document.getElementById('ver500EditDate') || {}).value || ''),
        amount: ver500Num((document.getElementById('ver500EditAmount') || {}).value || 0),
        storeName: String((document.getElementById('ver500EditStoreName') || {}).value || ''),
        itemTitle: String((document.getElementById('ver500EditItemTitle') || {}).value || ''),
        trackingNumber: ver500NormalizeTracking((document.getElementById('ver500EditTracking') || {}).value || ''),
        sourceType,
        documentType
      })
    );
    const fields = ['date', 'amount', 'storeName', 'itemTitle', 'trackingNumber', 'sourceType', 'documentType'];
    const changedFields = fields.filter((k) => String(beforeRow[k] || '') !== String(updated[k] || ''));
    updated.manualCorrected = changedFields.length > 0 || !!beforeRow.manualCorrected;
    updated.correctedFields = changedFields.length ? changedFields : beforeRow.correctedFields || [];
    updated.confidenceScore = ver500OcrConfidenceScore(updated);
    const next = rows.slice();
    next[idx] = updated;
    try {
      localStorage.setItem('ribre_ocr_draft_routes_v1', JSON.stringify(next.map(ver500NormalizeRouteEntry).slice(0, 100)));
    } catch (e) {
      ver500RenderDraftRouteList('保存に失敗しました（データは変更していません）');
      return false;
    }
    ver500AddAuditLog({
      action: 'manual_corrected',
      routeId: id,
      target: 'route',
      before: {
        date: beforeRow.date,
        amount: beforeRow.amount,
        storeName: beforeRow.storeName,
        itemTitle: beforeRow.itemTitle,
        trackingNumber: beforeRow.trackingNumber,
        sourceType: beforeRow.sourceType,
        documentType: beforeRow.documentType
      },
      after: {
        date: updated.date,
        amount: updated.amount,
        storeName: updated.storeName,
        itemTitle: updated.itemTitle,
        trackingNumber: updated.trackingNumber,
        sourceType: updated.sourceType,
        documentType: updated.documentType
      },
      message: 'OCR候補を手動修正しました'
    });
    const learningCandidate = ver500BuildLearningCandidate(updated);
    ver500LearnFromCandidate(learningCandidate, { source: 'manual_correct', routeId: id, note: 'manual-correct', forceLog: true });
    window.__ver500EditRouteId = '';
    ver500RenderDraftRouteList(changedFields.length ? '候補を修正しました' : '変更はありません');
    return true;
  } catch (e) {
    ver500RenderDraftRouteList('保存に失敗しました');
    return false;
  }
}
function ver500SetDraftReviewStatus(routeId, reviewStatus, options = {}) {
  try {
    const id = String(routeId || '');
    if (!id) return false;
    const rows = ver500DraftRoutes();
    const idx = rows.findIndex((x) => String((x && x.id) || '') === id);
    if (idx < 0) return false;
    const nextStatus = ver500NormalizeReviewStatus(reviewStatus);
    const staffName = ver500CurrentStaffName();
    const current = rows[idx] || {};
    const beforeReview = ver500NormalizeReviewStatus(current.reviewStatus || 'none');
    const beforeAssignee = String(current.assignee || '').trim();
    const updated = Object.assign({}, current, {
      reviewStatus: nextStatus,
      reviewedBy: staffName || String(current.reviewedBy || ''),
      reviewedAt: new Date().toISOString(),
      assignee: String(current.assignee || '').trim() || staffName || ''
    });
    rows[idx] = ver500NormalizeRouteEntry(updated);
    ver500SaveDraftRoutes(rows);
    ver500AddAuditLog({
      action: 'review_changed',
      routeId: id,
      target: 'reviewStatus',
      before: { reviewStatus: beforeReview },
      after: { reviewStatus: nextStatus },
      message: '処理状態を更新しました'
    });
    if (beforeAssignee !== String(updated.assignee || '').trim()) {
      ver500AddAuditLog({
        action: 'assignee_changed',
        routeId: id,
        target: 'assignee',
        before: { assignee: beforeAssignee || '' },
        after: { assignee: String(updated.assignee || '') },
        message: '担当者を更新しました'
      });
    }
    if (!options.silent) ver500RenderDraftRouteList('処理状態を更新しました');
    return true;
  } catch (e) {
    return false;
  }
}
function ver500SetSelectedDraftReviewStatus(reviewStatus) {
  const select = document.getElementById('ver500DraftSelect');
  const targetId = String((select && select.value) || '');
  if (!targetId) {
    ver500RenderDraftRouteList('候補を選択してください');
    return false;
  }
  return ver500SetDraftReviewStatus(targetId, reviewStatus);
}
function ver500BulkSetReviewStatus(reviewStatus) {
  const ids = ver500BulkSelectedIds();
  if (!ids.length) {
    ver500RenderDraftRouteList('一括対象を選択してください');
    return false;
  }
  let ok = 0;
  let ng = 0;
  ids.forEach((id) => {
    if (ver500SetDraftReviewStatus(id, reviewStatus, { silent: true })) ok += 1;
    else ng += 1;
  });
  ver500AddAuditLog({
    action: 'bulk_review_changed',
    target: reviewStatus,
    before: { selected: ids.length },
    after: { success: ok, failed: ng },
    message: 'OCR候補を一括で処理状態変更しました'
  });
  ver500RenderDraftRouteList('一括処理状態変更: 成功' + ok + '件 / 失敗' + ng + '件');
  return true;
}
function ver500BulkConfirmSelected() {
  const ids = ver500BulkSelectedIds();
  if (!ids.length) {
    ver500RenderDraftRouteList('一括対象を選択してください');
    return false;
  }
  let ok = 0;
  let ng = 0;
  let skipped = 0;
  ids.forEach((id) => {
    const before = ver500DraftRoutes().find((x) => String((x && x.id) || '') === id);
    if (!before || String(before.status || 'draft') !== 'draft') {
      skipped += 1;
      return;
    }
    if (String(before.sourceType || 'unknown') === 'unknown') {
      skipped += 1;
      return;
    }
    ver500ConfirmSelectedDraft(id, { bulk: true });
    const after = ver500DraftRoutes().find((x) => String((x && x.id) || '') === id);
    if (after && String(after.status || '') === 'confirmed') ok += 1;
    else ng += 1;
  });
  ver500AddAuditLog({
    action: 'bulk_confirmed',
    target: 'draft',
    before: { selected: ids.length },
    after: { success: ok, failed: ng, skipped },
    message: 'OCR候補を一括確定しました'
  });
  ver500RenderDraftRouteList('一括確定: 成功' + ok + '件 / 失敗' + ng + '件 / スキップ' + skipped + '件');
  return true;
}
function ver500BulkDeleteSelected() {
  const ids = ver500BulkSelectedIds();
  if (!ids.length) {
    ver500RenderDraftRouteList('一括対象を選択してください');
    return false;
  }
  const ok = typeof window.confirm === 'function' ? window.confirm('選択した候補を削除します。よろしいですか？') : true;
  if (!ok) return false;
  try {
    const set = new Set(ids);
    const rows = ver500DraftRoutes();
    const next = rows.filter((x) => !set.has(String((x && x.id) || '')));
    const deleted = rows.length - next.length;
    ver500SaveDraftRoutes(next);
    ver500SetBulkSelectedIds([]);
    ver500AddAuditLog({
      action: 'bulk_deleted',
      target: 'draft_routes',
      before: { selected: ids.length },
      after: { deleted },
      message: 'OCR候補を一括削除しました'
    });
    ver500RenderDraftRouteList('一括削除: ' + deleted + '件');
    return true;
  } catch (e) {
    ver500RenderDraftRouteList('一括削除に失敗しました');
    return false;
  }
}
function ver500EnsureDraftButtons() {
  if (
    document.getElementById('ver500DraftRoutesBtn') &&
    document.getElementById('ver500AutoConfirmWrap') &&
    document.getElementById('ver500AutoConfirmStatus') &&
    document.getElementById('ver500ConfirmLogsBtn') &&
    document.getElementById('ver500AuditLogsBtn') &&
    document.getElementById('ver500LearningLogsBtn') &&
    document.getElementById('ver500MappingRulesBtn') &&
    document.getElementById('ver500MappingRulesSaveBtn') &&
    document.getElementById('ver500MappingRulesJson') &&
    document.getElementById('ver500MappingQuickForm') &&
    document.getElementById('ver500DraftRoutesContainer')
  ) {
    return;
  }
  if (document.getElementById('ver500DraftRoutesBtn')) {
    const existingDraftBtn = document.getElementById('ver500DraftRoutesBtn');
    if (existingDraftBtn && existingDraftBtn.parentElement) {
      const controls = existingDraftBtn.parentElement;
      if (!document.getElementById('ver500MappingRulesBtn')) {
        const mappingBtn = document.createElement('button');
        mappingBtn.id = 'ver500MappingRulesBtn';
        mappingBtn.textContent = '読取ルール設定';
        mappingBtn.onclick = () => ver500RenderOcrMappingRulesEditor();
        controls.insertBefore(mappingBtn, existingDraftBtn.nextSibling);
      }
      if (!document.getElementById('ver500MappingRulesSaveBtn')) {
        const mappingSaveBtn = document.createElement('button');
        mappingSaveBtn.id = 'ver500MappingRulesSaveBtn';
        mappingSaveBtn.textContent = '読取ルールを保存';
        mappingSaveBtn.onclick = () => ver500SaveOcrMappingRulesFromEditor();
        controls.appendChild(mappingSaveBtn);
      }
      if (!document.getElementById('ver500ConfirmLogsBtn')) {
        const historyBtn = document.createElement('button');
        historyBtn.id = 'ver500ConfirmLogsBtn';
        historyBtn.textContent = '登録履歴';
        historyBtn.onclick = () => ver500RenderConfirmLogs();
        controls.appendChild(historyBtn);
      }
      if (!document.getElementById('ver500LearningLogsBtn')) {
        const learningBtn = document.createElement('button');
        learningBtn.id = 'ver500LearningLogsBtn';
        learningBtn.textContent = '学習履歴';
        learningBtn.onclick = () => ver500RenderLearningLogs();
        controls.appendChild(learningBtn);
      }
      if (!document.getElementById('ver500AuditLogsBtn')) {
        const auditBtn = document.createElement('button');
        auditBtn.id = 'ver500AuditLogsBtn';
        auditBtn.textContent = 'OCR作業履歴';
        auditBtn.onclick = () => ver500RenderAuditLogs();
        controls.appendChild(auditBtn);
      }
      const staleLabel = document.getElementById('ver500AutoConfirmLabel');
      if (staleLabel && staleLabel.parentElement && !document.getElementById('ver500AutoConfirmWrap')) staleLabel.parentElement.removeChild(staleLabel);
      if (!document.getElementById('ver500AutoConfirmWrap')) {
        const autoConfirmWrap = ver500CreateAutoConfirmControl();
        controls.insertBefore(autoConfirmWrap, existingDraftBtn.nextSibling);
      } else {
        ver500ApplyAutoConfirmUiState(ver500AutoConfirmEnabled());
      }
      if (!document.getElementById('ver500DraftFilterLegacy')) {
        const filter = document.createElement('select');
        filter.id = 'ver500DraftFilterLegacy';
        filter.innerHTML =
          '<option value="all">すべて表示</option>' +
          '<option value="draft" selected>未確定のみ</option>' +
          '<option value="confirmed">確定済みのみ</option>' +
          '<option value="ignored">除外済みのみ</option>';
        filter.onchange = () => ver500RenderDraftRouteList();
        controls.appendChild(filter);
      }
      if (!document.getElementById('ver500DraftDeleteBtnLegacy')) {
        const btn = document.createElement('button');
        btn.id = 'ver500DraftDeleteBtnLegacy';
        btn.textContent = '選んだ候補を削除';
        btn.onclick = () => ver500DeleteSelectedDraftRoute();
        controls.appendChild(btn);
      }
      if (!document.getElementById('ver500DraftHideConfirmedBtnLegacy')) {
        const btn = document.createElement('button');
        btn.id = 'ver500DraftHideConfirmedBtnLegacy';
        btn.textContent = '確定済みを隠す';
        btn.onclick = () => ver500HideConfirmedDraftRoutes();
        controls.appendChild(btn);
      }
      if (!document.getElementById('ver500DraftCleanupBtnLegacy')) {
        const btn = document.createElement('button');
        btn.id = 'ver500DraftCleanupBtnLegacy';
        btn.textContent = '古い候補を整理';
        btn.onclick = () => ver500CleanupOldDraftRoutes();
        controls.appendChild(btn);
      }
      if (!document.getElementById('ver500MappingRulesJson')) {
        const mappingArea = document.createElement('textarea');
        mappingArea.id = 'ver500MappingRulesJson';
        mappingArea.rows = 10;
        mappingArea.placeholder = '読取ルール設定(JSON)';
        mappingArea.style.width = '100%';
        mappingArea.style.marginTop = '8px';
        mappingArea.style.display = 'block';
        mappingArea.value = JSON.stringify(ver500OcrMappingRules(), null, 2);
        controls.appendChild(mappingArea);
      }
      if (!document.getElementById('ver500MappingQuickForm')) {
        const quickForm = ver500CreateMappingQuickForm();
        const mappingArea = document.getElementById('ver500MappingRulesJson');
        if (mappingArea && mappingArea.parentElement === controls) {
          controls.insertBefore(quickForm, mappingArea);
        } else {
          controls.appendChild(quickForm);
        }
      }
      ver500DraftRoutesContainer();
      return;
    }
  }
  const sec = document.getElementById('ocr');
  if (!sec) return;
  let controls = null;
  const buttons = Array.from(sec.querySelectorAll('button'));
  const anchor = buttons.find((b) => String(b.textContent || '').trim() === '仕入へ登録');
  if (anchor && anchor.parentElement) controls = anchor.parentElement;
  if (!controls) {
    controls = sec.querySelector('.controls');
  }
  const showBtn = document.createElement('button');
  showBtn.id = 'ver500DraftRoutesBtn';
  showBtn.textContent = 'OCR読取候補一覧';
  showBtn.onclick = () => ver500ShowDraftRoutes();
  const mappingBtn = document.createElement('button');
  mappingBtn.id = 'ver500MappingRulesBtn';
  mappingBtn.textContent = '読取ルール設定';
  mappingBtn.onclick = () => ver500RenderOcrMappingRulesEditor();
  const mappingSaveBtn = document.createElement('button');
  mappingSaveBtn.id = 'ver500MappingRulesSaveBtn';
  mappingSaveBtn.textContent = '読取ルールを保存';
  mappingSaveBtn.onclick = () => ver500SaveOcrMappingRulesFromEditor();
  const historyBtn = document.createElement('button');
  historyBtn.id = 'ver500ConfirmLogsBtn';
  historyBtn.textContent = '登録履歴';
  historyBtn.onclick = () => ver500RenderConfirmLogs();
  const learningBtn = document.createElement('button');
  learningBtn.id = 'ver500LearningLogsBtn';
  learningBtn.textContent = '学習履歴';
  learningBtn.onclick = () => ver500RenderLearningLogs();
  const auditBtn = document.createElement('button');
  auditBtn.id = 'ver500AuditLogsBtn';
  auditBtn.textContent = 'OCR作業履歴';
  auditBtn.onclick = () => ver500RenderAuditLogs();
  const autoConfirmWrap = ver500CreateAutoConfirmControl();
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'ver500ConfirmDraftBtn';
  confirmBtn.textContent = '選んだ候補を登録確定';
  confirmBtn.className = 'green';
  confirmBtn.onclick = () => ver500ConfirmDraftRoute();
  const select = document.createElement('select');
  select.id = 'ver500DraftSelect';
  const filter = document.createElement('select');
  filter.id = 'ver500DraftFilterLegacy';
  filter.innerHTML =
    '<option value="all">すべて表示</option>' +
    '<option value="draft" selected>未確定のみ</option>' +
    '<option value="confirmed">確定済みのみ</option>' +
    '<option value="ignored">除外済みのみ</option>';
  filter.onchange = () => ver500RenderDraftRouteList();
  const deleteBtn = document.createElement('button');
  deleteBtn.id = 'ver500DraftDeleteBtnLegacy';
  deleteBtn.textContent = '選んだ候補を削除';
  deleteBtn.onclick = () => ver500DeleteSelectedDraftRoute();
  const hideConfirmedBtn = document.createElement('button');
  hideConfirmedBtn.id = 'ver500DraftHideConfirmedBtnLegacy';
  hideConfirmedBtn.textContent = '確定済みを隠す';
  hideConfirmedBtn.onclick = () => ver500HideConfirmedDraftRoutes();
  const cleanupBtn = document.createElement('button');
  cleanupBtn.id = 'ver500DraftCleanupBtnLegacy';
  cleanupBtn.textContent = '古い候補を整理';
  cleanupBtn.onclick = () => ver500CleanupOldDraftRoutes();
  const quickForm = ver500CreateMappingQuickForm();
  const mappingArea = document.createElement('textarea');
  mappingArea.id = 'ver500MappingRulesJson';
  mappingArea.rows = 10;
  mappingArea.placeholder = '読取ルール設定(JSON)';
  mappingArea.style.width = '100%';
  mappingArea.style.marginTop = '8px';
  mappingArea.style.display = 'block';
  mappingArea.value = JSON.stringify(ver500OcrMappingRules(), null, 2);
  if (controls) {
    controls.appendChild(showBtn);
    controls.appendChild(autoConfirmWrap);
    controls.appendChild(mappingBtn);
    controls.appendChild(mappingSaveBtn);
    controls.appendChild(historyBtn);
    controls.appendChild(learningBtn);
    controls.appendChild(auditBtn);
    controls.appendChild(confirmBtn);
    controls.appendChild(select);
    controls.appendChild(filter);
    controls.appendChild(deleteBtn);
    controls.appendChild(hideConfirmedBtn);
    controls.appendChild(cleanupBtn);
    controls.appendChild(quickForm);
    controls.appendChild(mappingArea);
    if (!window.__ver500DraftFilterInitDone) {
      window.__ver500DraftFilterInitDone = true;
      window.__ver500HideConfirmedDrafts = false;
      filter.value = 'draft';
    }
    return;
  }
  const fallback = document.createElement('div');
  fallback.className = 'controls';
  fallback.appendChild(showBtn);
  fallback.appendChild(autoConfirmWrap);
  fallback.appendChild(mappingBtn);
  fallback.appendChild(mappingSaveBtn);
  fallback.appendChild(historyBtn);
  fallback.appendChild(learningBtn);
  fallback.appendChild(auditBtn);
  fallback.appendChild(confirmBtn);
  fallback.appendChild(select);
  fallback.appendChild(filter);
  fallback.appendChild(deleteBtn);
  fallback.appendChild(hideConfirmedBtn);
  fallback.appendChild(cleanupBtn);
  fallback.appendChild(quickForm);
  fallback.appendChild(mappingArea);
  sec.appendChild(fallback);
  if (!window.__ver500DraftFilterInitDone) {
    window.__ver500DraftFilterInitDone = true;
    window.__ver500HideConfirmedDrafts = false;
    filter.value = 'draft';
  }
  ver500DraftRoutesContainer();
}
