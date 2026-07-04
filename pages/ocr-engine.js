/* RIBRE OCR [??] engine: OpenAI??????????/?? */
async function ver500OpenAiAnalyze(inputText, imageDataUrl) {
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
    const res = await fetch('/api/openai/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input, temperature: 0 })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data && data.error === 'server_not_configured') throw new Error('OCR機能が利用できません（管理者に連絡してください）');
      throw new Error((data.error && data.error.message) || data.error || JSON.stringify(data));
    }
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
