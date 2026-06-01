/* RIBRE OCR [??] helpers: ?????/????????????? */
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
function ver500SafeString(v) {
  if (v == null) return '';
  return String(v);
}
function ver500SafeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
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
