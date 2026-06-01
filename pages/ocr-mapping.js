/* RIBRE OCR [??] mapping: ???????????????????? */
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
