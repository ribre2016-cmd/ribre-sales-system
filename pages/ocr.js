/* RIBRE OCR [??] main: ocrToSale/Purchase?????/?????????window?????? ???ocr-*.js????????? */
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

function initOcrPasteArea() {
  const zone = document.getElementById('ocrPasteArea');
  const sub = document.getElementById('ocrPasteAreaSub');
  const fileInput = document.getElementById('ocrFile');
  if (!zone || !fileInput || zone.dataset.pasteReady === '1') return;
  zone.dataset.pasteReady = '1';
  zone.addEventListener('click', () => zone.focus());
  zone.addEventListener('focus', () => zone.classList.add('active'));
  zone.addEventListener('blur', () => zone.classList.remove('active'));
  zone.addEventListener('paste', (event) => {
    const items = event.clipboardData && event.clipboardData.items ? event.clipboardData.items : [];
    let imageFile = null;
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file' && String(item.type || '').startsWith('image/')) {
        imageFile = item.getAsFile();
        break;
      }
    }
    if (!imageFile) return;
    event.preventDefault();
    const ext = String(imageFile.type || 'image/png').split('/')[1] || 'png';
    const file = new File([imageFile], 'clipboard-' + Date.now() + '.' + ext, {
      type: imageFile.type || 'image/png',
      lastModified: Date.now()
    });
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileInput.files = dt.files;
    } catch (e) {
      alert('このブラウザでは貼り付け画像の自動設定に対応していません');
      return;
    }
    if (typeof registerEvidence === 'function') registerEvidence();
    if (sub) sub.textContent = '貼り付け画像を証憑登録しました';
  });
}

if (!window.__ocrPasteAreaInit) {
  window.__ocrPasteAreaInit = true;
  window.addEventListener('load', () => {
    initOcrPasteArea();
  });
}

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
