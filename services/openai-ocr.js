/* RIBRE — OpenAI 証憑 OCR・候補・自動登録（index.html から分離。ロジックは同一） */
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
      kind: document.getElementById('ocrKind').value,
      dataUrl: rd.result,
      at: new Date().toLocaleString('ja-JP')
    };
    a.unshift(it);
    setLS(LS.ev, a);
    localStorage.setItem('ribre_evidences180', JSON.stringify(a));
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
  const blob = await (await fetch(ev.dataUrl)).blob();
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
    let body;
    if (String(ev.mime).startsWith('image/'))
      body = {
        model: 'gpt-4.1-mini',
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: ev.dataUrl }
            ]
          }
        ],
        temperature: 0
      };
    else {
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
