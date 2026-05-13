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
function ver500ConfirmLogs() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_confirm_logs_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500SaveConfirmLogs(arr) {
  const rows = Array.isArray(arr) ? arr.slice(0, 100) : [];
  const save = (n) => localStorage.setItem('ribre_ocr_confirm_logs_v1', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(100);
    return;
  } catch (e) {}
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
function ver500AddConfirmLog(log) {
  const src = log && typeof log === 'object' ? log : {};
  const rows = ver500ConfirmLogs();
  rows.unshift({
    id: String(src.id || 'ocr_confirm_' + Date.now()),
    createdAt: String(src.createdAt || new Date().toISOString()),
    routeId: String(src.routeId || ''),
    sourceType: String(src.sourceType || 'unknown'),
    category: String(src.category || 'unknown'),
    target: String(src.target || 'none'),
    message: String(src.message || ''),
    trackingNumber: ver500NormalizeTracking(src.trackingNumber || ''),
    amount: ver500Num(src.amount || 0),
    storeName: String(src.storeName || ''),
    itemTitle: String(src.itemTitle || '')
  });
  ver500SaveConfirmLogs(rows);
}
function ver500RenderConfirmLogs() {
  const rows = ver500ConfirmLogs().slice(0, 20);
  if (!rows.length) {
    ver500Render([{ type: '確定履歴', level: 'warn', msg: '確定履歴はありません' }]);
    return;
  }
  ver500Render(
    rows.map((x) => ({
      type: '確定履歴',
      msg:
        (x.createdAt || '') +
        ' / ' +
        ver500RouteLabel(x.sourceType) +
        ' / ' +
        (x.target || 'none') +
        ' / ' +
        (x.message || '') +
        (x.trackingNumber ? ' / 伝票:' + x.trackingNumber : '') +
        (x.storeName ? ' / ' + x.storeName : '') +
        (x.itemTitle ? ' / ' + x.itemTitle : '')
    }))
  );
}
function ver500AuditLogs() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_audit_logs_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500AuditActor() {
  const staff = String(localStorage.getItem('ribre_ocr_current_staff_v1') || '').trim();
  if (staff) return staff;
  const email = String(ver500Email() || '').trim();
  if (email) return email;
  return 'unknown';
}
function ver500SaveAuditLogs(arr) {
  const rows = Array.isArray(arr) ? arr.slice(0, 300) : [];
  const save = (n) => localStorage.setItem('ribre_ocr_audit_logs_v1', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(300);
    return true;
  } catch (e) {}
  try {
    save(150);
    return true;
  } catch (e) {}
  try {
    save(50);
    return true;
  } catch (e) {}
  try {
    save(0);
    return true;
  } catch (e) {}
  return false;
}
function ver500AddAuditLog(log) {
  try {
    const src = log && typeof log === 'object' ? log : {};
    const rows = ver500AuditLogs();
    rows.unshift({
      id: String(src.id || 'ocr_audit_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
      createdAt: String(src.createdAt || new Date().toISOString()),
      actor: String(src.actor || ver500AuditActor()),
      action: String(src.action || 'unknown'),
      routeId: String(src.routeId || ''),
      target: String(src.target || ''),
      before: src.before && typeof src.before === 'object' ? src.before : {},
      after: src.after && typeof src.after === 'object' ? src.after : {},
      message: String(src.message || '')
    });
    return ver500SaveAuditLogs(rows);
  } catch (e) {
    return false;
  }
}
function ver500AuditActionLabel(action) {
  const a = String(action || '');
  if (a === 'ocr_done') return 'OCR解析完了';
  if (a === 'draft_saved') return '仮登録保存';
  if (a === 'confirmed') return '登録確定';
  if (a === 'deleted') return '候補削除';
  if (a === 'review_changed') return '処理状態変更';
  if (a === 'assignee_changed') return '担当者変更';
  if (a === 'evidence_preview') return '証憑プレビュー表示';
  if (a === 'auto_confirmed') return '自動確定';
  if (a === 'learning_saved') return '学習保存';
  if (a === 'rule_added') return 'ルール追加';
  if (a === 'manual_corrected') return '手動修正';
  if (a === 'bulk_confirmed') return '一括確定';
  if (a === 'bulk_review_changed') return '一括処理状態変更';
  if (a === 'bulk_deleted') return '一括削除';
  return a || '不明';
}
function ver500RenderAuditLogs() {
  const rows = ver500AuditLogs().slice(0, 50);
  if (!rows.length) {
    ver500Render([{ type: '作業履歴', level: 'warn', msg: 'OCR作業履歴はありません' }]);
    return;
  }
  ver500Render(
    rows.map((x) => ({
      type: '作業履歴',
      msg:
        (x.createdAt || '') +
        ' / ' +
        (x.actor || 'unknown') +
        ' / ' +
        ver500AuditActionLabel(x.action) +
        (x.routeId ? ' / route:' + x.routeId : '') +
        (x.message ? ' / ' + x.message : '')
    }))
  );
}
function ver500AutoConfirmEnabled() {
  const raw = localStorage.getItem('ribre_ocr_auto_confirm_enabled_v1');
  if (raw == null) {
    try {
      localStorage.setItem('ribre_ocr_auto_confirm_enabled_v1', '0');
    } catch (e) {}
    return false;
  }
  return raw === '1';
}
function ver500SetAutoConfirmEnabled(enabled) {
  try {
    localStorage.setItem('ribre_ocr_auto_confirm_enabled_v1', enabled ? '1' : '0');
  } catch (e) {}
}
function ver500AutoConfirmStateText(enabled) {
  return enabled ? '自動確定: ON（高信頼時は自動登録）' : '自動確定: OFF（確認してから登録）';
}
function ver500ApplyAutoConfirmUiState(enabled) {
  const wrap = document.getElementById('ver500AutoConfirmWrap');
  const title = document.getElementById('ver500AutoConfirmTitle');
  const status = document.getElementById('ver500AutoConfirmStatus');
  const badge = document.getElementById('ver500AutoConfirmBadge');
  const toggle = document.getElementById('ver500AutoConfirmToggle');
  const switchTrack = document.getElementById('ver500AutoConfirmSwitch');
  const switchKnob = document.getElementById('ver500AutoConfirmKnob');
  if (toggle) toggle.checked = !!enabled;
  if (status) status.textContent = ver500AutoConfirmStateText(!!enabled);
  if (badge) {
    badge.textContent = enabled ? 'ON' : 'OFF';
    badge.style.background = enabled ? '#2f9e44' : '#6b7280';
    badge.style.color = '#fff';
  }
  if (switchTrack) {
    switchTrack.style.width = '56px';
    switchTrack.style.height = '32px';
    switchTrack.style.borderRadius = '16px';
    switchTrack.style.border = '1px solid ' + (enabled ? '#2f9e44' : '#9aa1ab');
    switchTrack.style.background = enabled ? '#79d58f' : '#d5d9df';
    switchTrack.style.position = 'relative';
    switchTrack.style.transition = 'all 120ms ease';
  }
  if (switchKnob) {
    switchKnob.style.width = '26px';
    switchKnob.style.height = '26px';
    switchKnob.style.borderRadius = '50%';
    switchKnob.style.position = 'absolute';
    switchKnob.style.top = '2px';
    switchKnob.style.left = enabled ? '28px' : '2px';
    switchKnob.style.background = '#fff';
    switchKnob.style.border = '1px solid ' + (enabled ? '#2f9e44' : '#9aa1ab');
    switchKnob.style.boxSizing = 'border-box';
    switchKnob.style.transition = 'left 120ms ease';
  }
  if (!wrap) return;
  wrap.style.display = 'inline-flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '4px';
  wrap.style.padding = '10px 12px';
  wrap.style.borderRadius = '12px';
  wrap.style.border = '1px solid ' + (enabled ? '#6fca85' : '#bfc6d0');
  wrap.style.background = enabled ? '#eaf8ee' : '#f2f4f7';
  wrap.style.minWidth = '300px';
  if (title) title.style.fontWeight = '700';
}
function ver500AutoConfirmChangeHandler(toggle) {
  const enabled = !!(toggle && toggle.checked);
  ver500SetAutoConfirmEnabled(enabled);
  ver500ApplyAutoConfirmUiState(enabled);
  ver500Render([{ type: '自動確定', msg: enabled ? '高信頼なら自動確定: ON' : '高信頼なら自動確定: OFF' }]);
}
function ver500CreateAutoConfirmControl() {
  const enabled = ver500AutoConfirmEnabled();
  const wrap = document.createElement('div');
  wrap.id = 'ver500AutoConfirmWrap';
  const top = document.createElement('label');
  top.id = 'ver500AutoConfirmLabel';
  top.style.display = 'flex';
  top.style.gap = '10px';
  top.style.alignItems = 'center';
  top.style.justifyContent = 'space-between';
  top.style.cursor = 'pointer';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.id = 'ver500AutoConfirmToggle';
  cb.checked = enabled;
  cb.style.display = 'none';
  cb.onchange = () => ver500AutoConfirmChangeHandler(cb);
  const title = document.createElement('div');
  title.id = 'ver500AutoConfirmTitle';
  title.textContent = '高信頼なら自動確定';
  const right = document.createElement('div');
  right.style.display = 'inline-flex';
  right.style.gap = '8px';
  right.style.alignItems = 'center';
  const badge = document.createElement('span');
  badge.id = 'ver500AutoConfirmBadge';
  badge.style.fontSize = '11px';
  badge.style.fontWeight = '700';
  badge.style.padding = '2px 8px';
  badge.style.borderRadius = '10px';
  const switchTrack = document.createElement('span');
  switchTrack.id = 'ver500AutoConfirmSwitch';
  const switchKnob = document.createElement('span');
  switchKnob.id = 'ver500AutoConfirmKnob';
  switchTrack.appendChild(switchKnob);
  right.appendChild(badge);
  right.appendChild(switchTrack);
  const status = document.createElement('small');
  status.id = 'ver500AutoConfirmStatus';
  status.style.fontWeight = '600';
  status.style.display = 'block';
  status.style.fontSize = '12px';
  const desc = document.createElement('small');
  desc.id = 'ver500AutoConfirmHelp';
  desc.style.fontSize = '11px';
  desc.style.opacity = '0.85';
  desc.textContent = 'AIが高信頼と判断した場合のみ自動で確定します';
  top.appendChild(cb);
  top.appendChild(title);
  top.appendChild(right);
  wrap.appendChild(top);
  wrap.appendChild(status);
  wrap.appendChild(desc);
  ver500ApplyAutoConfirmUiState(enabled);
  return wrap;
}
function ver500AutoConfirmLogs() {
  try {
    const rows = JSON.parse(localStorage.getItem('ribre_ocr_auto_confirm_logs_v1') || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    return [];
  }
}
function ver500SaveAutoConfirmLogs(arr) {
  const rows = Array.isArray(arr) ? arr.slice(0, 100) : [];
  const save = (n) => localStorage.setItem('ribre_ocr_auto_confirm_logs_v1', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
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
function ver500AddAutoConfirmLog(log) {
  const src = log && typeof log === 'object' ? log : {};
  const rows = ver500AutoConfirmLogs();
  rows.unshift({
    id: String(src.id || 'ocr_auto_confirm_' + Date.now() + '_' + Math.floor(Math.random() * 1000)),
    createdAt: String(src.createdAt || new Date().toISOString()),
    routeId: String(src.routeId || ''),
    score: Math.max(0, Math.min(100, Number(src.score || 0))),
    sourceType: String(src.sourceType || 'unknown'),
    category: String(src.category || 'unknown'),
    documentType: String(src.documentType || 'unknown'),
    result: String(src.result || 'unknown'),
    message: String(src.message || '')
  });
  return ver500SaveAutoConfirmLogs(rows);
}
function ver500OcrConfidenceScore(result) {
  const x = result && typeof result === 'object' ? result : {};
  const hasAmount = ver500Num(x.amount || 0) > 0;
  const hasDate = !!String(x.date || '').trim();
  const hasStore = !!String(x.storeName || x.partner || '').trim();
  const sourceType = String(x.sourceType || 'unknown');
  const category = String(x.category || 'unknown');
  const documentType = String(x.documentType || 'unknown');
  const matchedBy = String(x.documentMatchedBy || 'unknown');
  let score = 0;
  if (documentType !== 'unknown') score += 15;
  if (matchedBy === 'learning' || matchedBy === 'keyword') score += 15;
  if (x.profileApplied) score += 10;
  if (x.learnedMapped) score += 10;
  if (hasAmount) score += 10;
  if (hasDate) score += 10;
  if (hasStore) score += 10;
  if (sourceType !== 'unknown') score += 10;
  if (category !== 'unknown') score += 10;
  if (!hasAmount) score -= 20;
  if (!hasDate) score -= 15;
  if (!hasStore) score -= 15;
  if (sourceType === 'unknown') score -= 20;
  if (category === 'unknown') score -= 20;
  return Math.max(0, Math.min(100, Math.round(score)));
}
function ver500CanAutoConfirm(row, score) {
  const x = row && typeof row === 'object' ? row : {};
  const sourceType = String(x.sourceType || 'unknown');
  const category = String(x.category || 'unknown');
  if (!['sale', 'purchase', 'shipping', 'receipt'].includes(sourceType)) return false;
  if (sourceType === 'unknown') return false;
  if (category === 'unknown') return false;
  if (score < 80) return false;
  if ((sourceType === 'sale' || sourceType === 'purchase') && ver500Num(x.amount || 0) <= 0) return false;
  if (sourceType === 'shipping' && !ver500NormalizeTracking(x.trackingNumber || x.slip || '')) return false;
  return true;
}
function ver500AutoConfirmBlockReason(row, score) {
  const x = row && typeof row === 'object' ? row : {};
  const sourceType = String(x.sourceType || 'unknown');
  const category = String(x.category || 'unknown');
  if (!['sale', 'purchase', 'shipping', 'receipt'].includes(sourceType)) return '未分類のため自動確定できません';
  if (category === 'unknown') return '分類不明のため自動確定できません';
  if (score < 80) return '信頼度不足のため確認が必要です';
  if ((sourceType === 'sale' || sourceType === 'purchase') && ver500Num(x.amount || 0) <= 0) return '金額0のため自動確定できません';
  if (sourceType === 'shipping' && !ver500NormalizeTracking(x.trackingNumber || x.slip || '')) return '追跡番号なしのため自動確定できません';
  return '確認が必要です';
}
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
function ver500RouteLabel(sourceType) {
  const t = String(sourceType || 'unknown');
  if (t === 'sale') return '売上';
  if (t === 'purchase') return '仕入';
  if (t === 'shipping') return '配送';
  if (t === 'receipt') return '証憑';
  return '未分類';
}
function ver500DocumentTypeLabel(documentType) {
  const t = ver500NormalizeDocumentType(documentType);
  if (t === 'minna_market') return 'みんなの市場';
  if (t === 'auction_shiki') return 'オークション志木';
  if (t === 'yamato') return 'ヤマト';
  if (t === 'sagawa') return '佐川';
  if (t === 'surugaya') return '駿河屋';
  if (t === 'bookoff') return 'BOOKOFF';
  if (t === 'mercari') return 'メルカリ';
  if (t === 'yahoo') return 'ヤフオク';
  if (t === 'receipt') return '領収書';
  if (t === 'invoice') return '請求書';
  return '未分類';
}
function ver500UiFieldLabel(name) {
  const k = String(name || '');
  if (k === 'sourceType') return '登録種別';
  if (k === 'category') return '分類';
  if (k === 'shippingCarrier') return '配送会社';
  if (k === 'salesChannel') return '販売先';
  if (k === 'supplierName') return '仕入先';
  if (k === 'genre') return 'ジャンル';
  if (k === 'documentType') return '帳票タイプ';
  return k;
}
function ver500UiFieldLabels(arr) {
  return (Array.isArray(arr) ? arr : []).map(ver500UiFieldLabel).join(',');
}
function ver500AllowedDocumentTypes() {
  return [
    'minna_market',
    'auction_shiki',
    'surugaya',
    'bookoff',
    'yamato',
    'sagawa',
    'mercari',
    'yahoo',
    'receipt',
    'invoice',
    'unknown'
  ];
}
function ver500NormalizeDocumentType(v) {
  const s = String(v || '').trim().toLowerCase();
  return ver500AllowedDocumentTypes().includes(s) ? s : 'unknown';
}
function ver500DocumentTypeKeywordRules() {
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
function ver500DocumentTypeDefaults(documentType) {
  const t = ver500NormalizeDocumentType(documentType);
  const map = {
    minna_market: { supplierName: 'みんなの市場', sourceType: 'purchase', category: 'surugaya_purchase' },
    auction_shiki: { supplierName: 'オークション志木', sourceType: 'purchase', category: 'bookoff_purchase' },
    surugaya: { sourceType: 'purchase', category: 'surugaya_purchase' },
    bookoff: { sourceType: 'purchase', category: 'bookoff_purchase' },
    yamato: { sourceType: 'shipping', category: 'yamato_shipping', shippingCarrier: 'ヤマト' },
    sagawa: { sourceType: 'shipping', category: 'sagawa_shipping', shippingCarrier: '佐川' },
    mercari: { sourceType: 'sale', category: 'mercari_sale' },
    yahoo: { sourceType: 'sale', category: 'yahoo_sale' },
    receipt: { sourceType: 'receipt', category: 'receipt' },
    invoice: { sourceType: 'purchase', category: 'invoice' },
    unknown: {}
  };
  return map[t] || {};
}
function ver500OcrDocumentProfiles() {
  return {
    minna_market: {
      preferredSourceType: 'purchase',
      preferredCategory: 'surugaya_purchase',
      defaultSupplierName: 'みんなの市場',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '総額', '請求額', '落札金額'],
      dateKeywords: ['日付', '取引日', '落札日'],
      trackingKeywords: ['伝票番号', 'お問い合わせ番号'],
      itemTitleKeywords: ['商品名', '品名', '落札商品'],
      ignoreKeywords: ['テスト', 'サンプル']
    },
    auction_shiki: {
      preferredSourceType: 'purchase',
      preferredCategory: 'bookoff_purchase',
      defaultSupplierName: 'オークション志木',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '総額', '請求額', '落札金額'],
      dateKeywords: ['日付', '取引日'],
      trackingKeywords: ['伝票番号', 'お問い合わせ番号'],
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
      dateKeywords: ['日付', '購入日', '取引日'],
      trackingKeywords: ['伝票番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: ['再発行']
    },
    unknown: {
      preferredSourceType: 'unknown',
      preferredCategory: 'unknown',
      defaultSupplierName: '',
      defaultShippingCarrier: '',
      amountKeywords: ['合計', '請求額', '税込', 'お買上計'],
      dateKeywords: ['日付'],
      trackingKeywords: ['伝票番号', '追跡', 'お問い合わせ番号'],
      itemTitleKeywords: ['商品名', '品名'],
      ignoreKeywords: []
    }
  };
}
function ver500GetOcrDocumentProfile(documentType) {
  const t = ver500NormalizeDocumentType(documentType);
  const map = ver500OcrDocumentProfiles();
  return map[t] || map.unknown;
}
function ver500ProfilePromptHints() {
  const p = ver500OcrDocumentProfiles();
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
function ver500ApplyDocumentProfile(result) {
  const src = result && typeof result === 'object' ? Object.assign({}, result) : {};
  const docType = ver500NormalizeDocumentType(src.documentType || '');
  const profile = ver500GetOcrDocumentProfile(docType);
  const fields = [];
  if (!src.sourceType && profile.preferredSourceType && profile.preferredSourceType !== 'unknown') {
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
function ver500DefaultOcrMappingRules() {
  return {
    supplierByStore: [
      { keyword: 'みんなの市場', value: 'みんなの市場' },
      { keyword: 'オークション志木', value: 'オークション志木' }
    ],
    salesChannelByCategory: {
      yahoo_sale: 'ヤフオク',
      mercari_sale: 'メルカリ'
    },
    shippingCarrierByCategory: {
      yamato_shipping: 'ヤマト',
      sagawa_shipping: '佐川'
    },
    genreKeywords: [
      { keyword: 'blu-ray', value: 'Blu-ray' },
      { keyword: 'ブルーレイ', value: 'Blu-ray' },
      { keyword: 'dvd', value: 'DVD' },
      { keyword: 'cd', value: 'CD' },
      { keyword: 'カセット', value: 'カセット' },
      { keyword: 'cassette', value: 'カセット' },
      { keyword: 'コミック', value: '本' },
      { keyword: 'comic', value: '本' },
      { keyword: '単行本', value: '本' },
      { keyword: '文庫', value: '本' },
      { keyword: '書籍', value: '本' },
      { keyword: '本', value: '本' }
    ],
    documentTypeByKeyword: []
  };
}
function ver500StoredOcrMappingRules() {
  try {
    const raw = localStorage.getItem('ribre_ocr_mapping_rules_v1');
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}
function ver500BuildLearningMappingRules() {
  const rows = ver500OcrLearningRows();
  const out = {
    supplierByStore: [],
    salesChannelByCategory: {},
    shippingCarrierByCategory: {},
    genreKeywords: [],
    documentTypeByKeyword: []
  };
  rows.forEach((r) => {
    const target = String((r && r.target) || '');
    const keyword = String((r && r.keyword) || '').trim();
    const value = String((r && r.value) || '').trim();
    const note = String((r && r.note) || '').trim();
    if (!keyword || !value) return;
    if (keyword.length < 2) return;
    if (keyword.toLowerCase() === 'unknown' || value.toLowerCase() === 'unknown') return;
    if (note === 'conflict_skip') return;
    if (target === 'supplierByStore') out.supplierByStore.push({ keyword, value });
    else if (target === 'genreKeywords') out.genreKeywords.push({ keyword, value });
    else if (target === 'salesChannelByCategory') out.salesChannelByCategory[keyword] = value;
    else if (target === 'shippingCarrierByCategory') out.shippingCarrierByCategory[keyword] = value;
    else if (target === 'documentType') out.documentTypeByKeyword.push({ keyword, value: ver500NormalizeDocumentType(value) });
  });
  return out;
}
function ver500MergePairRules(primary, secondary, tertiary) {
  const out = [];
  const seen = new Set();
  [primary, secondary, tertiary].forEach((arr) => {
    (Array.isArray(arr) ? arr : []).forEach((x) => {
      const keyword = String((x && x.keyword) || '').trim();
      const value = String((x && x.value) || '').trim();
      if (!keyword || !value) return;
      const key = keyword + '\t' + value;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ keyword, value });
    });
  });
  return out;
}
function ver500MergeMapRules(base, learning, manual) {
  const out = {};
  [base, learning, manual].forEach((obj) => {
    if (!obj || typeof obj !== 'object') return;
    Object.keys(obj).forEach((k) => {
      const key = String(k || '').trim();
      const val = String(obj[k] || '').trim();
      if (!key || !val) return;
      out[key] = val;
    });
  });
  return out;
}
function ver500NormalizeOcrMappingRules(raw) {
  const base = ver500DefaultOcrMappingRules();
  const src = raw && typeof raw === 'object' ? raw : {};
  const supplierByStore = Array.isArray(src.supplierByStore)
    ? src.supplierByStore
        .map((x) => ({ keyword: String((x && x.keyword) || ''), value: String((x && x.value) || '') }))
        .filter((x) => x.keyword && x.value)
    : base.supplierByStore;
  const salesChannelByCategory =
    src.salesChannelByCategory && typeof src.salesChannelByCategory === 'object'
      ? Object.keys(src.salesChannelByCategory).reduce((acc, k) => {
          const key = String(k || '').trim();
          const val = String(src.salesChannelByCategory[k] || '').trim();
          if (key && val) acc[key] = val;
          return acc;
        }, {})
      : base.salesChannelByCategory;
  const shippingCarrierByCategory =
    src.shippingCarrierByCategory && typeof src.shippingCarrierByCategory === 'object'
      ? Object.keys(src.shippingCarrierByCategory).reduce((acc, k) => {
          const key = String(k || '').trim();
          const val = String(src.shippingCarrierByCategory[k] || '').trim();
          if (key && val) acc[key] = val;
          return acc;
        }, {})
      : base.shippingCarrierByCategory;
  const genreKeywords = Array.isArray(src.genreKeywords)
    ? src.genreKeywords
        .map((x) => ({ keyword: String((x && x.keyword) || ''), value: String((x && x.value) || '') }))
        .filter((x) => x.keyword && x.value)
    : base.genreKeywords;
  const documentTypeByKeyword = Array.isArray(src.documentTypeByKeyword)
    ? src.documentTypeByKeyword
        .map((x) => ({ keyword: String((x && x.keyword) || ''), value: ver500NormalizeDocumentType((x && x.value) || '') }))
        .filter((x) => x.keyword && x.value && x.value !== 'unknown')
    : base.documentTypeByKeyword;
  return {
    supplierByStore: supplierByStore.length ? supplierByStore : base.supplierByStore,
    salesChannelByCategory: Object.keys(salesChannelByCategory).length ? salesChannelByCategory : base.salesChannelByCategory,
    shippingCarrierByCategory: Object.keys(shippingCarrierByCategory).length ? shippingCarrierByCategory : base.shippingCarrierByCategory,
    genreKeywords: genreKeywords.length ? genreKeywords : base.genreKeywords,
    documentTypeByKeyword: documentTypeByKeyword.length ? documentTypeByKeyword : base.documentTypeByKeyword
  };
}
function ver500OcrMappingRules() {
  const base = ver500NormalizeOcrMappingRules(ver500DefaultOcrMappingRules());
  const manualRaw = ver500StoredOcrMappingRules();
  const manual = manualRaw
    ? ver500NormalizeOcrMappingRules(manualRaw)
    : { supplierByStore: [], salesChannelByCategory: {}, shippingCarrierByCategory: {}, genreKeywords: [], documentTypeByKeyword: [] };
  const learning = ver500NormalizeOcrMappingRules(ver500BuildLearningMappingRules());
  return {
    supplierByStore: ver500MergePairRules(manual.supplierByStore, learning.supplierByStore, base.supplierByStore),
    salesChannelByCategory: ver500MergeMapRules(base.salesChannelByCategory, learning.salesChannelByCategory, manual.salesChannelByCategory),
    shippingCarrierByCategory: ver500MergeMapRules(
      base.shippingCarrierByCategory,
      learning.shippingCarrierByCategory,
      manual.shippingCarrierByCategory
    ),
    genreKeywords: ver500MergePairRules(manual.genreKeywords, learning.genreKeywords, base.genreKeywords),
    documentTypeByKeyword: ver500MergePairRules(manual.documentTypeByKeyword, learning.documentTypeByKeyword, base.documentTypeByKeyword)
  };
}
function ver500RenderOcrMappingRulesEditor() {
  const rules = ver500OcrMappingRules();
  const area = document.getElementById('ver500MappingRulesJson');
  if (!area) return;
  try {
    area.value = JSON.stringify(rules, null, 2);
  } catch (e) {
    area.value = JSON.stringify(ver500DefaultOcrMappingRules(), null, 2);
  }
}
function ver500CreateMappingQuickForm() {
  const wrap = document.createElement('div');
  wrap.id = 'ver500MappingQuickForm';
  wrap.style.display = 'flex';
  wrap.style.gap = '6px';
  wrap.style.flexWrap = 'wrap';
  wrap.style.marginTop = '8px';
  const type = document.createElement('select');
  type.id = 'ver500MappingRuleType';
  [
    { value: '', label: '種類を選択' },
    { value: 'supplier', label: '仕入先' },
    { value: 'salesChannel', label: '販売先' },
    { value: 'shippingCarrier', label: '配送会社' },
    { value: 'genre', label: 'ジャンル' }
  ].forEach((x) => {
    const op = document.createElement('option');
    op.value = x.value;
    op.textContent = x.label;
    type.appendChild(op);
  });
  const keyword = document.createElement('input');
  keyword.id = 'ver500MappingRuleKeyword';
  keyword.placeholder = 'キーワード';
  keyword.style.minWidth = '120px';
  const value = document.createElement('input');
  value.id = 'ver500MappingRuleValue';
  value.placeholder = '値';
  value.style.minWidth = '120px';
  const addBtn = document.createElement('button');
  addBtn.id = 'ver500MappingRuleAddBtn';
  addBtn.textContent = 'ルール追加';
  addBtn.onclick = () => ver500AddMappingRuleFromForm();
  wrap.appendChild(type);
  wrap.appendChild(keyword);
  wrap.appendChild(value);
  wrap.appendChild(addBtn);
  return wrap;
}
function ver500AddMappingRuleFromForm() {
  const typeEl = document.getElementById('ver500MappingRuleType');
  const keywordEl = document.getElementById('ver500MappingRuleKeyword');
  const valueEl = document.getElementById('ver500MappingRuleValue');
  const type = String((typeEl && typeEl.value) || '').trim();
  const keyword = String((keywordEl && keywordEl.value) || '').trim();
  const value = String((valueEl && valueEl.value) || '').trim();
  if (!type) {
    ver500Render([{ type: 'ルール', level: 'warn', msg: '種類を選択してください' }]);
    return;
  }
  if (!keyword || !value) {
    ver500Render([{ type: 'ルール', level: 'warn', msg: '入力してください' }]);
    return;
  }
  const rules = ver500NormalizeOcrMappingRules(ver500OcrMappingRules());
  let duplicate = false;
  if (type === 'supplier') {
    duplicate = rules.supplierByStore.some((x) => String(x.keyword || '') === keyword && String(x.value || '') === value);
    if (!duplicate) rules.supplierByStore.push({ keyword, value });
  } else if (type === 'salesChannel') {
    duplicate = String(rules.salesChannelByCategory[keyword] || '') === value;
    if (!duplicate) rules.salesChannelByCategory[keyword] = value;
  } else if (type === 'shippingCarrier') {
    duplicate = String(rules.shippingCarrierByCategory[keyword] || '') === value;
    if (!duplicate) rules.shippingCarrierByCategory[keyword] = value;
  } else {
    duplicate = rules.genreKeywords.some((x) => String(x.keyword || '') === keyword && String(x.value || '') === value);
    if (!duplicate) rules.genreKeywords.push({ keyword, value });
  }
  if (duplicate) {
    ver500Render([{ type: 'ルール', level: 'warn', msg: '同じルールがあります' }]);
    return;
  }
  const normalized = ver500NormalizeOcrMappingRules(rules);
  try {
    localStorage.setItem('ribre_ocr_mapping_rules_v1', JSON.stringify(normalized));
    const area = document.getElementById('ver500MappingRulesJson');
    if (area) area.value = JSON.stringify(normalized, null, 2);
    if (keywordEl) keywordEl.value = '';
    if (valueEl) valueEl.value = '';
    ver500AddAuditLog({
      action: 'rule_added',
      target: type,
      before: {},
      after: { type, keyword, value },
      message: 'OCRマッピングルールを追加しました'
    });
    ver500Render([{ type: 'ルール', msg: 'ルールを追加しました' }]);
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      ver500Render([{ type: 'ルール', level: 'warn', msg: '保存容量不足のため保存できませんでした' }]);
      return;
    }
    ver500Render([{ type: 'ルール', level: 'warn', msg: '保存に失敗しました' }]);
  }
}
function ver500SaveOcrMappingRulesFromEditor() {
  const area = document.getElementById('ver500MappingRulesJson');
  if (!area) return;
  const text = String(area.value || '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(text || '{}');
  } catch (e) {
    ver500Render([{ type: 'ルール', level: 'warn', msg: 'JSON形式が正しくありません' }]);
    return;
  }
  const normalized = ver500NormalizeOcrMappingRules(parsed);
  try {
    localStorage.setItem('ribre_ocr_mapping_rules_v1', JSON.stringify(normalized));
    area.value = JSON.stringify(normalized, null, 2);
    ver500Render([{ type: 'ルール', msg: '保存しました' }]);
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') {
      ver500Render([{ type: 'ルール', level: 'warn', msg: '保存容量不足のため保存できませんでした' }]);
      return;
    }
    ver500Render([{ type: 'ルール', level: 'warn', msg: '保存に失敗しました' }]);
  }
}
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
    const rows = ver500DraftRoutes();
    const currentFilter = ver500DraftFilterValue();
    const currentViewMode = String(window.__ver500DraftViewMode || 'priority');
    const currentStaff = ver500CurrentStaffName();
    const filterState = ver500ListFilterState();
    window.__ver500DraftMineOnly = !!filterState.mineOnly;
    const queryWord = String(filterState.query || '').trim().toLowerCase();
    const minAmount = String(filterState.minAmount || '').trim() === '' ? null : ver500Num(filterState.minAmount);
    const maxAmount = String(filterState.maxAmount || '').trim() === '' ? null : ver500Num(filterState.maxAmount);
    const baseRows = ver500FilteredDraftRoutes(rows, currentFilter);
    const filteredRows = baseRows.filter((x) => {
      const row = x && typeof x === 'object' ? x : {};
      const score = Math.max(0, Math.min(100, Number(row.confidenceScore || ver500OcrConfidenceScore(row))));
      const miss = missingItems(row);
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
        const isDoneToday = isToday(row.reviewedAt) || (String(row.status || 'draft') === 'confirmed' && (isToday(row.updatedAt) || isToday(row.createdAt)));
        if (!isDoneToday) return false;
      }
      if (filterState.mineOnly) {
        if (!currentStaff) return true;
        if (String(row.assignee || '').trim() !== currentStaff) return false;
      }
      const amount = ver500Num(row.amount || 0);
      if (minAmount != null && amount < minAmount) return false;
      if (maxAmount != null && amount > maxAmount) return false;
      if (queryWord) {
        const haystack = [
          row.storeName,
          row.itemTitle,
          row.amount,
          row.trackingNumber,
          row.documentType,
          ver500DocumentTypeLabel(row.documentType || 'unknown'),
          row.sourceType,
          ver500RouteLabel(row.sourceType || 'unknown'),
          row.assignee,
          row.reviewedBy,
          row.note
        ]
          .map((v) => String(v || '').toLowerCase())
          .join(' ');
        if (!haystack.includes(queryWord)) return false;
      }
      return true;
    });
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
    const missingItems = (x) => {
      const miss = [];
      if (!String((x && x.date) || '').trim()) miss.push('日付');
      if (ver500Num((x && x.amount) || 0) <= 0) miss.push('金額');
      if (!String((x && x.storeName) || '').trim()) miss.push('相手先');
      if (!ver500NormalizeTracking((x && (x.trackingNumber || x.slip)) || '')) miss.push('伝票番号');
      return miss;
    };
    const isToday = (v) => {
      const d = v ? new Date(v) : null;
      if (!d || Number.isNaN(d.getTime())) return false;
      const now = new Date();
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    };
    const detectEvidenceType = (url) => {
      const u = String(url || '').trim();
      if (!u) return 'none';
      if (/^data:image\//i.test(u)) return 'image';
      if (/^data:application\/pdf/i.test(u)) return 'pdf';
      if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(u)) return 'image';
      if (/\.pdf(\?|#|$)/i.test(u)) return 'pdf';
      if (/^https?:\/\//i.test(u) || /^blob:/i.test(u)) return 'url';
      return 'url';
    };
    const missingText = (miss) => (miss.length ? '要確認: ' + miss.join('・') + 'が未入力' : '');
    const select = document.getElementById('ver500DraftSelect');
    const prevSelectedId = String((select && select.value) || '');
    if (select) {
      select.innerHTML = '';
      let matched = false;
      filteredRows.forEach((x) => {
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
        const miss = missingItems(row);
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
        if (isToday(row.reviewedAt) || (statusRaw === 'confirmed' && (isToday(row.updatedAt) || isToday(row.createdAt)))) summary.doneToday += 1;
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
    if (!filteredRows.length) {
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
    const cardRows = filteredRows.slice(0, 100).map((x) => {
      const rowId = String(x.id || '');
      const selectedId = String((select && select.value) || '');
      const isSelected = rowId && rowId === selectedId;
      const isBulkChecked = selectedBulkIds.includes(rowId);
      const status = ver500DraftStatusBadgeLabel(x.status || 'draft');
      const score = Math.max(0, Math.min(100, Number(x.confidenceScore || ver500OcrConfidenceScore(x))));
      const conf = scoreLabel(score);
      const style = scoreStyle(score);
      const miss = missingItems(x);
      const missText = missingText(miss);
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
      filteredRows.length +
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
      const evidenceType = detectEvidenceType(evidenceUrl);
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
async function ver500OpenAiAnalyze(inputText, imageDataUrl) {
  const key = localStorage.getItem('ribre_openai_key200') || localStorage.getItem('ribre_openai_key180') || '';
  if (!key) return null;

  const prompt =
    'あなたは日本の売上管理OCRです。必ずJSONのみ返すこと。説明文は禁止。推測は禁止。存在しない値は null。' +
    '日本のEC/配送/買取伝票を想定し、documentType/category/sourceTypeを推定してください。不明時は unknown。documentType を必ず推定してください。' +
    ver500ProfilePromptHints() +
    '出力schemaは次のみ: {"kind":"sale|purchase|unknown","documentType":"minna_market|auction_shiki|surugaya|bookoff|yamato|sagawa|mercari|yahoo|receipt|invoice|unknown","category":"yahoo_sale|mercari_sale|surugaya_purchase|bookoff_purchase|yamato_shipping|sagawa_shipping|receipt|invoice|unknown","sourceType":"sale|purchase|shipping|receipt|unknown","storeName":"","date":"","amount":0,"shipping":0,"trackingNumber":"","itemTitle":"","itemCount":0,"paymentMethod":"","note":""}';

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
      const route = ver500SaveDraftRoute(ai);
      const autoResult = ver500MaybeAutoConfirmRoute(route);
      const routeView = (autoResult && autoResult.route) || route;
      ver500AddAuditLog({
        action: 'ocr_done',
        routeId: routeView && routeView.id ? routeView.id : '',
        target: 'cache',
        before: {},
        after: {
          sourceType: routeView && routeView.sourceType ? routeView.sourceType : 'unknown',
          documentType: routeView && routeView.documentType ? routeView.documentType : 'unknown'
        },
        message: 'OCR解析完了（キャッシュ結果）'
      });
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
        { type: '分類', msg: 'AIで読み取り：' + (ai.kind || '不明') },
        { type: '仮登録', msg: '登録先: ' + ver500RouteLabel((routeView && routeView.sourceType) || 'unknown') },
        { type: '仮登録', msg: '状態: ' + ((routeView && routeView.status) || 'draft') },
        { type: '仮登録', msg: '信頼度: ' + ((autoResult && autoResult.score) || ver500OcrConfidenceScore(routeView || ai)) },
        { type: '日付', msg: ai.date || '' },
        { type: '相手先', msg: ai.partner || '' },
        { type: '内容', msg: ai.item || '' },
        { type: '金額', msg: String(ai.amount || 0) + '円' },
        { type: '証憑', msg: ai.evidence_url || 'なし' }
      ];
      if (ai.category) cacheRows.push({ type: '分類', msg: '分類: ' + ai.category });
      if (ai.sourceType) cacheRows.push({ type: '分類', msg: '登録種別: ' + ai.sourceType });
      if (ai.documentType) cacheRows.push({ type: '分類', msg: '帳票タイプ: ' + ai.documentType + ' (' + (ai.documentMatchedBy || 'unknown') + ')' });
      if (ai.profileApplied) cacheRows.push({ type: '分類', msg: '専用ルール適用: あり / ' + ver500UiFieldLabels(ai.profileFields || []) });
      if (autoResult && autoResult.autoConfirmed) cacheRows.push({ type: '仮登録', msg: '高信頼のため自動確定しました' });
      if (autoResult && !autoResult.autoConfirmed && autoResult.reason === 'needs_review') cacheRows.push({ type: '仮登録', msg: autoResult.message || '確認が必要です' });
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
  const route = ver500SaveDraftRoute(ai);
  const autoResult = ver500MaybeAutoConfirmRoute(route);
  const routeView = (autoResult && autoResult.route) || route;
  ver500AddAuditLog({
    action: 'ocr_done',
    routeId: routeView && routeView.id ? routeView.id : '',
    target: 'analyze',
    before: {},
    after: {
      sourceType: routeView && routeView.sourceType ? routeView.sourceType : 'unknown',
      documentType: routeView && routeView.documentType ? routeView.documentType : 'unknown'
    },
    message: 'OCR解析完了'
  });
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
    { type: '分類', msg: 'AIで読み取り：' + ai.kind },
    { type: '仮登録', msg: '登録先: ' + ver500RouteLabel((routeView && routeView.sourceType) || 'unknown') },
    { type: '仮登録', msg: '状態: ' + ((routeView && routeView.status) || 'draft') },
    { type: '仮登録', msg: '信頼度: ' + ((autoResult && autoResult.score) || ver500OcrConfidenceScore(routeView || ai)) },
    { type: '日付', msg: ai.date || '' },
    { type: '相手先', msg: ai.partner || '' },
    { type: '内容', msg: ai.item || '' },
    { type: '金額', msg: String(ai.amount || 0) + '円' },
    { type: '証憑', msg: ai.evidence_url || 'なし' }
  ];
  if (ai.category) rows.push({ type: '分類', msg: '分類: ' + ai.category });
  if (ai.sourceType) rows.push({ type: '分類', msg: '登録種別: ' + ai.sourceType });
  if (ai.documentType) rows.push({ type: '分類', msg: '帳票タイプ: ' + ai.documentType + ' (' + (ai.documentMatchedBy || 'unknown') + ')' });
  if (ai.profileApplied) rows.push({ type: '分類', msg: '専用ルール適用: あり / ' + ver500UiFieldLabels(ai.profileFields || []) });
  if (autoResult && autoResult.autoConfirmed) rows.push({ type: '仮登録', msg: '高信頼のため自動確定しました' });
  if (autoResult && !autoResult.autoConfirmed && autoResult.reason === 'needs_review') rows.push({ type: '仮登録', msg: autoResult.message || '確認が必要です' });
  ver500Render(rows);
}
function ver500ConfirmSelectedDraft(routeId, options = {}) {
  const logBase = (row, target, message) => {
    const r = row && typeof row === 'object' ? row : {};
    ver500AddConfirmLog({
      routeId: r.id || '',
      sourceType: r.sourceType || 'unknown',
      category: r.category || 'unknown',
      target,
      message,
      trackingNumber: r.trackingNumber || '',
      amount: r.amount || r.shipping || 0,
      storeName: r.storeName || '',
      itemTitle: r.itemTitle || ''
    });
  };
  const auditConfirmed = (row, target, message) => {
    const r = row && typeof row === 'object' ? row : {};
    ver500AddAuditLog({
      action: 'confirmed',
      routeId: r.id || '',
      target: target || 'unknown',
      before: { status: r.status || 'draft' },
      after: { status: 'confirmed' },
      message: message || '候補を確定しました'
    });
  };
  const select = document.getElementById('ver500DraftSelect');
  const targetId = String(routeId || (select && select.value ? select.value : ''));
  const rows = ver500DraftRoutes();
  const row = rows.find((x) => String(x.id || '') === targetId) || rows.find((x) => x.status === 'draft');
  if (!row) {
    const fallbackCandidate = ver500BuildLearningCandidate(null);
    const fallbackLearn = ver500LearnFromCandidate(fallbackCandidate, { source: 'draft_confirm', routeId: '' });
    ver500HandleLearningResult(fallbackLearn, { showSuccess: true });
    logBase(null, 'none', '確定できる候補がありません');
    ver500Render([{ type: '仮登録', level: 'warn', msg: '確定できる候補がありません' }]);
    return;
  }
  if (row.status === 'confirmed') {
    logBase(row, 'none', 'すでに確定済みです');
    ver500RenderDraftRouteList('すでに確定済みです');
    return;
  }
  if (row.sourceType === 'unknown') {
    logBase(row, 'none', '未分類のため確定できません');
    ver500RenderDraftRouteList('未分類のため確定できません');
    return;
  }
  if (row.sourceType === 'receipt') {
    const updated = Object.assign({}, row, { status: 'confirmed', autoConfirmed: !!options.auto, confidenceScore: ver500OcrConfidenceScore(row) });
    ver500UpsertDraftRoute(updated);
    auditConfirmed(row, 'receipt', '証憑候補として確定しました');
    const learningCandidate = ver500BuildLearningCandidate(row);
    const learningResult = ver500LearnFromCandidate(learningCandidate, { source: 'draft_confirm', routeId: row.id || '' });
    ver500HandleLearningResult(learningResult, { showSuccess: true });
    logBase(row, 'receipt', '証憑候補として確定しました');
    ver500RenderDraftRouteList('証憑候補として確定しました');
    return;
  }
  if (row.sourceType === 'shipping') {
    const linked = ver500LinkOcrToShippingCandidate(row, true);
    const updated = Object.assign({}, row, { status: 'confirmed', autoConfirmed: !!options.auto, confidenceScore: ver500OcrConfidenceScore(row) });
    ver500UpsertDraftRoute(updated);
    auditConfirmed(row, 'shipping', linked.added ? '配送候補へ連携して確定しました' : '配送候補として確定しました');
    const learningCandidate = ver500BuildLearningCandidate(row);
    const learningResult = ver500LearnFromCandidate(learningCandidate, { source: 'draft_confirm', routeId: row.id || '' });
    ver500HandleLearningResult(learningResult, { showSuccess: true });
    if (linked.added) {
      logBase(row, 'shipping', '配送候補へ連携しました');
      ver500RenderDraftRouteList('配送候補へ連携しました');
      return;
    }
    if (linked.reason === 'duplicate_tracking' || linked.reason === 'duplicate_item_id') {
      logBase(row, 'shipping', '配送候補は重複のため追加しませんでした');
      ver500RenderDraftRouteList('配送候補は重複のため追加しませんでした');
      return;
    }
    logBase(row, 'shipping', '配送候補への連携に失敗しました');
    ver500RenderDraftRouteList('配送候補への連携に失敗しました');
    return;
  }
  ver500ApplyCandidateData({
    kind: row.sourceType === 'sale' ? 'sale' : 'purchase',
    date: row.date || '',
    partner: row.storeName || '',
    item: row.itemTitle || '',
    amount: row.amount || 0,
    slip: row.trackingNumber || '',
    evidence_url: row.evidence_url || '',
    memo: row.note || '',
    supplierName: row.supplierName || '',
    salesChannel: row.salesChannel || '',
    genre: row.genre || '',
    shippingCarrier: row.shippingCarrier || '',
    documentType: row.documentType || 'unknown',
    documentMatchedBy: row.documentMatchedBy || 'unknown',
    accountType: row.accountType || (row.sourceType === 'sale' ? 'sales' : 'purchase'),
    autoMapped: !!row.autoMapped,
    sourceType: row.sourceType || 'unknown',
    category: row.category || 'unknown',
    learningSource: 'draft_confirm',
    learningRouteId: row.id || ''
  });
  const linked = ver500LinkOcrToShippingCandidate(row, false);
  const updated = Object.assign({}, row, { status: 'confirmed', autoConfirmed: !!options.auto, confidenceScore: ver500OcrConfidenceScore(row) });
  ver500UpsertDraftRoute(updated);
  auditConfirmed(row, row.sourceType || 'unknown', '候補を確定しました');
  if (row.sourceType === 'sale') {
    if (linked.added) {
      logBase(row, 'sales+shipping', '売上へ登録しました / 配送候補へ連携しました');
      ver500RenderDraftRouteList('売上へ登録しました / 配送候補へ連携しました');
      return;
    }
    logBase(row, 'sales', '売上へ登録しました');
    ver500RenderDraftRouteList('売上へ登録しました');
    return;
  }
  if (row.sourceType === 'purchase') {
    if (linked.added) {
      logBase(row, 'purchase+shipping', '仕入へ登録しました / 配送候補へ連携しました');
      ver500RenderDraftRouteList('仕入へ登録しました / 配送候補へ連携しました');
      return;
    }
    logBase(row, 'purchase', '仕入へ登録しました');
    ver500RenderDraftRouteList('仕入へ登録しました');
    return;
  }
  logBase(row, 'unknown', '確定しました');
  ver500Set('ver500Status', '確定OK');
  ver500RenderDraftRouteList('確定しました');
}
function ver500ConfirmDraftRoute() {
  return ver500ConfirmSelectedDraft();
}
function ver500CurrentCandidate() {
  const kind =
    document.getElementById('ver500Kind').value === 'auto'
      ? 'expense'
      : document.getElementById('ver500Kind').value;
  const base = {
    kind:
      kind,
    status: 'draft',
    date: document.getElementById('ver500Date').value,
    partner: document.getElementById('ver500Partner').value,
    item: document.getElementById('ver500Item').value,
    amount: ver500Num(document.getElementById('ver500Amount').value),
    slip: document.getElementById('ver500Slip').value,
    evidence_url: document.getElementById('ver500EvidenceUrl').value,
    memo: 'AI自動登録 Ver60.0'
  };
  const mapped = ver500ApplyAutoMapping({
    sourceType: kind === 'sale' ? 'sale' : kind === 'purchase' || kind === 'expense' ? 'purchase' : 'unknown',
    category: 'unknown',
    storeName: base.partner,
    itemTitle: base.item
  });
  return Object.assign({}, base, mapped, {
    category: mapped.mappedCategory || 'unknown',
    sourceType: mapped.mappedSourceType || 'unknown',
    documentType: mapped.documentType || 'unknown',
    documentMatchedBy: mapped.documentMatchedBy || 'unknown',
    accountType: mapped.accountType,
    autoMapped: mapped.autoMapped,
    learnedMapped: mapped.learnedMapped,
    learnedFields: mapped.learnedFields
    ,
    profileApplied: mapped.profileApplied,
    profileFields: mapped.profileFields
  });
}
function ver500ApplyCandidateData(candidate) {
  const c = Object.assign({}, candidate || {});
  let learningResult = null;
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
      source: 'AI自動登録 Ver60.0',
      supplierName: c.supplierName || '',
      salesChannel: c.salesChannel || '',
      genre: c.genre || '',
      accountType: c.accountType || 'sales',
      autoMapped: !!c.autoMapped
    });
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(s));
    localStorage.setItem('ribre_full_sales221', JSON.stringify(s));
    const learningCandidate = ver500BuildLearningCandidate(c);
    learningResult = ver500LearnFromCandidate(learningCandidate, {
      source: c.learningSource || 'sale_register',
      routeId: c.learningRouteId || ''
    });
    ver500HandleLearningResult(learningResult, { showSuccess: true });
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
      source: 'AI自動登録 Ver60.0',
      supplierName: c.supplierName || '',
      genre: c.genre || '',
      accountType: c.accountType || 'purchase',
      autoMapped: !!c.autoMapped
    });
    localStorage.setItem('ribre_full_purchases221', JSON.stringify(p));
    const learningCandidate = ver500BuildLearningCandidate(c);
    learningResult = ver500LearnFromCandidate(learningCandidate, {
      source: c.learningSource || 'purchase_register',
      routeId: c.learningRouteId || ''
    });
    ver500HandleLearningResult(learningResult, { showSuccess: true });
    ver500Render([{ type: '登録', msg: '仕入/経費候補を登録しました' }]);
  }
  try {
    refreshAll();
  } catch (e) {}
  ver500Set('ver500Status', learningResult && learningResult.ok ? 'OCR学習を保存しました' : '登録OK');
}
function ver500ApplyCandidate() {
  const candidate = Object.assign({}, ver500CurrentCandidate(), { learningSource: 'ai_auto_register' });
  return ver500ApplyCandidateData(candidate);
}
const __ver500LegacyOcrToSale = typeof window.ocrToSale === 'function' ? window.ocrToSale : null;
const __ver500LegacyOcrToPurchase = typeof window.ocrToPurchase === 'function' ? window.ocrToPurchase : null;
function ver500ReadLegacyOcrCandidateFromForm() {
  const type = String((document.getElementById('cKind') || {}).value || 'purchase');
  const candidate = {
    storeName: String((document.getElementById('cVendor') || {}).value || ''),
    itemTitle: String((document.getElementById('cItem') || {}).value || ''),
    kind: type === 'sale' ? 'sale' : 'purchase',
    sourceType: type === 'sale' ? 'sale' : 'purchase',
    category: 'unknown',
    documentType: 'unknown',
    supplierName: '',
    salesChannel: '',
    genre: '',
    shippingCarrier: ''
  };
  if (!candidate.genre) candidate.genre = ver500DetectGenre(candidate.itemTitle);
  return candidate;
}
function ver500RunManualRegisterLearning(source) {
  const learningCandidate = ver500BuildLearningCandidate(ver500ReadLegacyOcrCandidateFromForm());
  const result = ver500LearnFromCandidate(learningCandidate, { source, note: 'manual-register', forceLog: true });
  if (!result || !result.ok) {
    if (typeof renderList === 'function') renderList('ocrList', [{ type: '学習', level: 'warn', msg: 'OCR学習保存に失敗しました' }]);
    return result;
  }
  if (typeof renderList === 'function') renderList('ocrList', [{ type: '学習', msg: 'OCR学習を保存しました' }]);
  return result;
}
function ocrToSale() {
  try {
    if (__ver500LegacyOcrToSale) __ver500LegacyOcrToSale();
  } catch (e) {}
  return ver500RunManualRegisterLearning('manual-sale-register');
}
function ocrToPurchase() {
  try {
    if (__ver500LegacyOcrToPurchase) __ver500LegacyOcrToPurchase();
  } catch (e) {}
  return ver500RunManualRegisterLearning('manual-purchase-register');
}
function ocrAutoRegister() {
  const k = String((document.getElementById('cKind') || {}).value || 'purchase');
  if (k === 'sale') return ocrToSale();
  return ocrToPurchase();
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
window.ver500SaveDraftRoute = ver500SaveDraftRoute;
window.ver500MaybeAutoConfirmRoute = ver500MaybeAutoConfirmRoute;
window.ver500OcrConfidenceScore = ver500OcrConfidenceScore;
window.ver500RenderDraftRouteList = ver500RenderDraftRouteList;
window.ver500ShowDraftRoutes = ver500ShowDraftRoutes;
window.ver500SelectDraftRouteCard = ver500SelectDraftRouteCard;
window.ver500ToggleBulkSelect = ver500ToggleBulkSelect;
window.ver500ClearBulkSelection = ver500ClearBulkSelection;
window.ver500BulkConfirmSelected = ver500BulkConfirmSelected;
window.ver500BulkSetReviewStatus = ver500BulkSetReviewStatus;
window.ver500BulkDeleteSelected = ver500BulkDeleteSelected;
window.ver500SetListFilterField = ver500SetListFilterField;
window.ver500ResetListFilters = ver500ResetListFilters;
window.ver500SetDraftReviewStatus = ver500SetDraftReviewStatus;
window.ver500SetSelectedDraftReviewStatus = ver500SetSelectedDraftReviewStatus;
window.ver500CurrentStaffName = ver500CurrentStaffName;
window.ver500SaveCurrentStaff = ver500SaveCurrentStaff;
window.ver500PreviewEvidenceByRoute = ver500PreviewEvidenceByRoute;
window.ver500CloseEvidencePreview = ver500CloseEvidencePreview;
window.ver500OpenManualCorrect = ver500OpenManualCorrect;
window.ver500SaveManualCorrect = ver500SaveManualCorrect;
window.ver500CancelManualCorrect = ver500CancelManualCorrect;
window.ver500DefaultOcrMappingRules = ver500DefaultOcrMappingRules;
window.ver500NormalizeOcrMappingRules = ver500NormalizeOcrMappingRules;
window.ver500OcrMappingRules = ver500OcrMappingRules;
window.ver500RenderOcrMappingRulesEditor = ver500RenderOcrMappingRulesEditor;
window.ver500SaveOcrMappingRulesFromEditor = ver500SaveOcrMappingRulesFromEditor;
window.ver500AddMappingRuleFromForm = ver500AddMappingRuleFromForm;
window.ver500ConfirmLogs = ver500ConfirmLogs;
window.ver500RenderConfirmLogs = ver500RenderConfirmLogs;
window.ver500AuditLogs = ver500AuditLogs;
window.ver500RenderAuditLogs = ver500RenderAuditLogs;
window.ver500LearningLogs = ver500LearningLogs;
window.ver500OcrLearningRows = ver500OcrLearningRows;
window.ver500RenderLearningLogs = ver500RenderLearningLogs;
window.ver500LearnFromCandidate = ver500LearnFromCandidate;
window.ver500LearnFromCorrection = ver500LearnFromCorrection;
window.ver500ConfirmSelectedDraft = ver500ConfirmSelectedDraft;
window.ver500ConfirmDraftRoute = ver500ConfirmDraftRoute;
window.ocrToSale = ocrToSale;
window.ocrToPurchase = ocrToPurchase;
window.ocrAutoRegister = ocrAutoRegister;
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
        if (document.getElementById('ver500DraftRoutesBtn')) {
          clearInterval(timer);
          return;
        }
      } catch (e) {}
      if (tries >= maxTries) clearInterval(timer);
    }, 400);
  });
}
