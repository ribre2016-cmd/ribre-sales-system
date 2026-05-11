/* RIBRE — Analysis pages 移行（ver350/360/370 の最終定義を pages 側へ集約） */
function ver350Results() {
  try {
    return JSON.parse(localStorage.getItem('ribre_ai_classify350') || '[]');
  } catch (e) {
    return [];
  }
}
function ver350SaveResults(arr) {
  localStorage.setItem('ribre_ai_classify350', JSON.stringify(arr.slice(0, 500)));
}
function ver350Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver350Render(rows) {
  const box = document.getElementById('aiClassifyList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver350TextSource() {
  const c = {
    kind: document.getElementById('cKind')?.value || '',
    date: document.getElementById('cDate')?.value || '',
    vendor: document.getElementById('cVendor')?.value || '',
    item: document.getElementById('cItem')?.value || '',
    amount: document.getElementById('cAmount')?.value || '',
    tax: document.getElementById('cTax')?.value || '',
    no: document.getElementById('cNo')?.value || '',
    memo: document.getElementById('cMemo')?.value || ''
  };
  return Object.values(c).join(' ');
}
function ver350ExtractItemId(text) {
  const m = String(text || '').match(/[a-z]?\d{9,12}/i);
  return m ? m[0] : '';
}
function ver350ExtractSlip(text) {
  const s = String(text || '');
  const m = s.match(/\d{3,4}[-\s]?\d{3,4}[-\s]?\d{3,5}|\d{10,14}/);
  return m ? m[0].replace(/[-\s]/g, '') : '';
}
function ver350RuleClassify(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('ヤマト') || t.includes('佐川') || t.includes('日本郵便') || t.includes('送料') || t.includes('運賃')) return 'shipping';
  if (t.includes('メルカリ') || t.includes('mercari')) return 'sale';
  if (t.includes('ヤフオク') || t.includes('落札') || t.includes('売上') || t.includes('入金')) return 'sale';
  if (t.includes('仕入') || t.includes('購入') || t.includes('請求') || t.includes('駿河屋') || t.includes('古物')) return 'purchase';
  return document.getElementById('cKind')?.value || 'expense';
}
async function ver350OpenAiClassify(text) {
  const key = localStorage.getItem('ribre_openai_key200') || localStorage.getItem('ribre_openai_key180') || '';
  if (!key) return null;
  const prompt =
    '以下のOCR/売上管理テキストを分類してください。JSONのみ返答。{"type":"purchase|sale|shipping|expense","market":"ヤフオク|メルカリ|その他","itemId":"商品ID候補","slip":"伝票番号候補","memo":"短い補足","templateSuggestion":"今後使えるテンプレ案"} テキスト:' +
    text;
  try {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4.1-mini', input: prompt, temperature: 0 })
    });
    const data = await res.json();
    if (!res.ok) throw new Error((data.error && data.error.message) || JSON.stringify(data));
    let out = data.output_text || '';
    if (!out && data.output) out = data.output.map((o) => (o.content || []).map((c) => c.text || '').join('\n')).join('\n');
    out = out.trim().replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
    const m = out.match(/\{[\s\S]*\}/);
    return JSON.parse(m ? m[0] : out);
  } catch (e) {
    return { error: e.message };
  }
}
async function ver350ClassifyLatestOcr() {
  const text = ver350TextSource();
  if (!text.trim()) {
    alert('OCR結果または編集欄が空です');
    return;
  }
  ver350Set('ver350Status', '分類中');
  ver350Render([{ type: 'AI', level: 'warn', msg: 'AI分類中です' }]);

  let ai = await ver350OpenAiClassify(text);
  const fallback = {
    type: ver350RuleClassify(text),
    market: text.includes('メルカリ') ? 'メルカリ' : text.includes('ヤフオク') ? 'ヤフオク' : 'その他',
    itemId: ver350ExtractItemId(text),
    slip: ver350ExtractSlip(text),
    memo: 'AI/ルール分類',
    templateSuggestion: 'よく使う補正メモとして保存候補'
  };
  if (!ai || ai.error) ai = Object.assign(fallback, { memo: ai && ai.error ? 'AI失敗: ' + ai.error + ' / ルール分類' : fallback.memo });
  ai.type = ai.type || fallback.type;
  ai.market = ai.market || fallback.market;
  ai.itemId = ai.itemId || fallback.itemId;
  ai.slip = ai.slip || fallback.slip;

  const arr = ver350Results();
  arr.unshift({ at: new Date().toLocaleString('ja-JP'), text, result: ai });
  ver350SaveResults(arr);

  ver350Set('ver350Kind', ai.type);
  ver350Set('ver350ItemId', ai.itemId || 'なし');
  ver350Set('ver350Slip', ai.slip || 'なし');
  ver350Set('ver350Status', '分類OK');

  if (document.getElementById('cKind')) document.getElementById('cKind').value = ai.type;
  if (document.getElementById('cNo') && ai.slip) document.getElementById('cNo').value = ai.slip;

  ver350Render([
    { type: '分類', level: 'ok', msg: '区分：' + ai.type },
    { type: '販売先', level: 'ok', msg: '市場：' + (ai.market || 'その他') },
    { type: '商品ID', level: ai.itemId ? 'ok' : 'warn', msg: ai.itemId || '候補なし' },
    { type: '伝票番号', level: ai.slip ? 'ok' : 'warn', msg: ai.slip || '候補なし' },
    { type: 'メモ', level: 'ok', msg: ai.memo || '' }
  ]);
}
function ver350ExplainUnmatched() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_unmatched_diagnosis270') || '[]');
  } catch (e) {}
  if (!rows.length) {
    try {
      rows = JSON.parse(localStorage.getItem('ribre_remaining_unmatched260') || '[]');
    } catch (e) {}
  }
  if (!rows.length) {
    alert('未一致データがありません');
    return;
  }
  const summary = {};
  rows.forEach((x) => {
    const reason = x.diagnosis || (Number(x.shipping || 0) === 0 ? '送料0・CSV2不足の可能性' : '要確認');
    summary[reason] = (summary[reason] || 0) + 1;
  });
  ver350Render(
    Object.keys(summary).map((k) => ({
      type: '未一致',
      level: 'warn',
      msg: k + '：' + summary[k] + '件。次の確認：ヤマトCSV2、伝票番号、匿名配送、商品ID表記ゆれ'
    }))
  );
  ver350Set('ver350Status', '説明OK');
}
function ver350SuggestTemplate() {
  const latest = ver350Results()[0];
  const text = latest?.result?.templateSuggestion || '送料・伝票番号・商品IDを確認。必要に応じてヤマトCSV2を追加取込。';
  document.getElementById('tplFolder') && (document.getElementById('tplFolder').value = 'AI提案');
  document.getElementById('tplName') && (document.getElementById('tplName').value = 'AI補正テンプレ ' + new Date().toLocaleDateString('ja-JP'));
  document.getElementById('tplType') && (document.getElementById('tplType').value = 'ocr');
  document.getElementById('tplText') && (document.getElementById('tplText').value = text);
  ver350Render([{ type: 'テンプレ', level: 'ok', msg: 'テンプレート画面にAI提案を入力しました。テンプレート保存を押してください。' }]);
}
function ver350ApplyAiMemo() {
  const latest = ver350Results()[0];
  if (!latest) {
    alert('先にAI分類してください');
    return;
  }
  const memo = (latest.result.memo || '') + ' 商品ID:' + (latest.result.itemId || '') + ' 伝票:' + (latest.result.slip || '');
  const el = document.getElementById('cMemo');
  if (el) el.value = (el.value ? el.value + ' ' : '') + memo;
  ver350Render([{ type: '反映', level: 'ok', msg: 'AIメモをOCRメモへ反映しました' }]);
}
function ver350ExportAiResults() {
  const rows = [['日時', '分類', '市場', '商品ID', '伝票番号', 'メモ', 'テンプレ案', '元テキスト']];
  ver350Results().forEach((x) => rows.push([x.at, x.result.type, x.result.market, x.result.itemId, x.result.slip, x.result.memo, x.result.templateSuggestion, x.text]));
  csvDownload(rows, 'ai_classify_Ver35_0.csv');
}

function ver360Sales() {
  const a = [];
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_registered_sales210') || '[]'));
  } catch (e) {}
  return a.map((x) => Object.assign({ __kind: '売上' }, x));
}
function ver360Purchases() {
  const a = [];
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]'));
  } catch (e) {}
  try {
    a.push(...JSON.parse(localStorage.getItem('ribre_registered_purchases210') || '[]'));
  } catch (e) {}
  return a.map((x) => Object.assign({ __kind: '仕入' }, x));
}
function ver360Num(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function ver360Id(x) {
  return String(x.itemId || x.id || '').trim();
}
function ver360Render(rows) {
  const box = document.getElementById('dataCheckList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver360Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver360Analyze() {
  const sales = ver360Sales();
  const purchases = ver360Purchases();
  const all = sales.concat(purchases);
  const warnings = [];
  const dupMap = {};

  sales.forEach((x) => {
    const id = ver360Id(x);
    if (id) {
      dupMap[id] = dupMap[id] || [];
      dupMap[id].push(x);
    }
    if (!id) warnings.push({ type: '商品IDなし', level: 'warn', msg: '売上 商品IDなし / ' + (x.name || '') });
    if (!x.date && !x.sale_date) warnings.push({ type: '日付なし', level: 'warn', msg: '売上 日付なし / ' + (x.itemId || x.id || '') + ' / ' + (x.name || '') });
    if (ver360Num(x.amount || x.price) === 0) warnings.push({ type: '金額0', level: 'warn', msg: '売上 金額0 / ' + (x.itemId || x.id || '') + ' / ' + (x.name || '') });
    if (ver360Num(x.shipping || x.ship) === 0 && !String(x.memo || '').includes('匿名'))
      warnings.push({ type: '送料0', level: 'warn', msg: '売上 送料0 / ' + (x.itemId || x.id || '') + ' / ' + (x.name || '') });
    if (!x.slip && !x.invoiceNo && !String(x.memo || '').includes('匿名'))
      warnings.push({ type: '伝票なし', level: 'warn', msg: '売上 伝票番号なし / ' + (x.itemId || x.id || '') + ' / ' + (x.name || '') });
    if (ver360Num(x.profit) < 0)
      warnings.push({
        type: '赤字',
        level: 'danger',
        msg: '売上 利益マイナス / ' + (x.itemId || x.id || '') + ' / ' + (x.name || '') + ' / ' + ver360Num(x.profit).toLocaleString() + '円'
      });
  });

  purchases.forEach((x) => {
    if (!x.date && !x.purchase_date) warnings.push({ type: '日付なし', level: 'warn', msg: '仕入 日付なし / ' + (x.name || x.item_name || '') });
    if (ver360Num(x.total || x.cost || x.amount) === 0) warnings.push({ type: '金額0', level: 'warn', msg: '仕入 金額0 / ' + (x.name || x.item_name || '') });
  });

  const dups = [];
  Object.keys(dupMap).forEach((id) => {
    if (dupMap[id].length > 1) {
      dups.push({ type: '重複', level: 'warn', msg: '商品ID重複 ' + id + ' / ' + dupMap[id].length + '件' });
    }
  });

  return { all, sales, purchases, warnings, dups };
}
function ver360RunCheck() {
  const r = ver360Analyze();
  localStorage.setItem('ribre_data_warnings360', JSON.stringify(r.warnings.slice(0, 5000)));
  localStorage.setItem('ribre_data_duplicates360', JSON.stringify(r.dups.slice(0, 5000)));
  ver360Set('ver360Total', r.all.length + '件');
  ver360Set('ver360Dup', r.dups.length + '件');
  ver360Set('ver360Warn', r.warnings.length + '件');
  ver360Set('ver360Status', '確認OK');
  ver360Render(
    [
      { type: '売上', msg: '売上 ' + r.sales.length + '件' },
      { type: '仕入', msg: '仕入 ' + r.purchases.length + '件' },
      { type: '重複', level: r.dups.length ? 'warn' : 'ok', msg: '重複候補 ' + r.dups.length + '件' },
      { type: '注意', level: r.warnings.length ? 'warn' : 'ok', msg: '注意データ ' + r.warnings.length + '件' }
    ].concat(r.warnings.slice(0, 80))
  );
}
function ver360ShowDuplicates() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_data_duplicates360') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver360RunCheck();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_data_duplicates360') || '[]');
    } catch (e) {}
  }
  ver360Render(rows.length ? rows : [{ type: 'OK', msg: '重複候補はありません' }]);
}
function ver360ShowWarnings() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_data_warnings360') || '[]');
  } catch (e) {}
  if (!rows.length) {
    ver360RunCheck();
    try {
      rows = JSON.parse(localStorage.getItem('ribre_data_warnings360') || '[]');
    } catch (e) {}
  }
  ver360Render(rows.length ? rows : [{ type: 'OK', msg: '注意データはありません' }]);
}
function ver360ExportWarnings() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_data_warnings360') || '[]');
  } catch (e) {}
  if (!rows.length) {
    alert('先に整合性チェックを押してください');
    return;
  }
  const csvRows = [['区分', 'レベル', '内容']];
  rows.forEach((x) => csvRows.push([x.type, x.level, x.msg]));
  csvDownload(csvRows, 'data_warnings_Ver36_0.csv');
}
function ver360Guide() {
  ver360Render([
    { type: '1', msg: '売上CSV・配送照合・OCR登録後に実行します' },
    { type: '2', msg: '整合性チェックで重複/送料0/伝票なし/金額0/赤字を検出' },
    { type: '3', msg: '注意データCSVを出して修正対象を確認できます' }
  ]);
}

function ver370Tasks() {
  try {
    return JSON.parse(localStorage.getItem('ribre_fix_tasks370') || '[]');
  } catch (e) {
    return [];
  }
}
function ver370SaveTasks(arr) {
  localStorage.setItem('ribre_fix_tasks370', JSON.stringify(arr.slice(0, 5000)));
}
function ver370Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver370Render(rows) {
  const box = document.getElementById('fixTasksList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver370Refresh() {
  const arr = ver370Tasks();
  ver370Set('ver370AllCount', arr.length + '件');
  ver370Set('ver370OpenCount', arr.filter((x) => x.status === '未対応').length + '件');
  ver370Set('ver370DoneCount', arr.filter((x) => x.status === '修正済み').length + '件');
  ver370Set('ver370IgnoreCount', arr.filter((x) => x.status === '確認済み').length + '件');
}
function ver370BuildTasks() {
  let warnings = [];
  try {
    warnings = JSON.parse(localStorage.getItem('ribre_data_warnings360') || '[]');
  } catch (e) {}
  if (!warnings.length && typeof ver360RunCheck === 'function') {
    ver360RunCheck();
    try {
      warnings = JSON.parse(localStorage.getItem('ribre_data_warnings360') || '[]');
    } catch (e) {}
  }
  if (!warnings.length) {
    ver370Render([{ type: 'INFO', level: 'warn', msg: '注意データがありません。先にデータ確認→整合性チェックを押してください。' }]);
    return;
  }
  const old = ver370Tasks();
  const seen = new Set(old.map((x) => x.key));
  let added = 0;
  warnings.forEach((w) => {
    const key = (w.type || '') + '|' + (w.msg || '');
    if (seen.has(key)) return;
    old.unshift({
      id: 'task_' + Date.now() + '_' + added,
      key,
      type: w.type || '注意',
      message: w.msg || '',
      level: w.level || 'warn',
      status: '未対応',
      createdAt: new Date().toLocaleString('ja-JP'),
      updatedAt: '',
      user: typeof email === 'function' ? email() || '' : ''
    });
    seen.add(key);
    added++;
  });
  ver370SaveTasks(old);
  ver370Refresh();
  ver370Render(
    [{ type: '作成', level: 'ok', msg: '修正タスクを作成しました：追加 ' + added + '件' }].concat(
      old
        .slice(0, 100)
        .map((x) => ({ type: x.status, level: x.status === '未対応' ? 'warn' : 'ok', msg: x.type + ' / ' + x.message }))
    )
  );
}
function ver370ShowOpenTasks() {
  const arr = ver370Tasks().filter((x) => x.status === '未対応');
  ver370Refresh();
  ver370Render(arr.length ? arr.map((x) => ({ type: x.type, level: 'warn', msg: x.message + ' / 作成:' + x.createdAt })) : [{ type: 'OK', level: 'ok', msg: '未対応タスクはありません' }]);
}
function ver370UpdateLatest(status) {
  const arr = ver370Tasks();
  const idx = arr.findIndex((x) => x.status === '未対応');
  if (idx < 0) {
    alert('未対応タスクがありません');
    return;
  }
  arr[idx].status = status;
  arr[idx].updatedAt = new Date().toLocaleString('ja-JP');
  arr[idx].user = typeof email === 'function' ? email() || arr[idx].user : arr[idx].user;
  ver370SaveTasks(arr);
  ver370Refresh();
  ver370ShowOpenTasks();
}
function ver370MarkLatestDone() {
  ver370UpdateLatest('修正済み');
}
function ver370MarkLatestIgnore() {
  ver370UpdateLatest('確認済み');
}
function ver370ExportTasks() {
  const rows = [['状態', '種類', '内容', '作成日時', '更新日時', 'ユーザー']];
  ver370Tasks().forEach((x) => rows.push([x.status, x.type, x.message, x.createdAt, x.updatedAt, x.user]));
  csvDownload(rows, 'fix_tasks_Ver37_0.csv');
}
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver370Refresh();
    } catch (e) {}
  }, 1400);
});

window.ver350Results = ver350Results;
window.ver350SaveResults = ver350SaveResults;
window.ver350Set = ver350Set;
window.ver350Render = ver350Render;
window.ver350TextSource = ver350TextSource;
window.ver350ExtractItemId = ver350ExtractItemId;
window.ver350ExtractSlip = ver350ExtractSlip;
window.ver350RuleClassify = ver350RuleClassify;
window.ver350OpenAiClassify = ver350OpenAiClassify;
window.ver350ClassifyLatestOcr = ver350ClassifyLatestOcr;
window.ver350ExplainUnmatched = ver350ExplainUnmatched;
window.ver350SuggestTemplate = ver350SuggestTemplate;
window.ver350ApplyAiMemo = ver350ApplyAiMemo;
window.ver350ExportAiResults = ver350ExportAiResults;

window.ver360Sales = ver360Sales;
window.ver360Purchases = ver360Purchases;
window.ver360Num = ver360Num;
window.ver360Id = ver360Id;
window.ver360Render = ver360Render;
window.ver360Set = ver360Set;
window.ver360Analyze = ver360Analyze;
window.ver360RunCheck = ver360RunCheck;
window.ver360ShowDuplicates = ver360ShowDuplicates;
window.ver360ShowWarnings = ver360ShowWarnings;
window.ver360ExportWarnings = ver360ExportWarnings;
window.ver360Guide = ver360Guide;

window.ver370Tasks = ver370Tasks;
window.ver370SaveTasks = ver370SaveTasks;
window.ver370Set = ver370Set;
window.ver370Render = ver370Render;
window.ver370Refresh = ver370Refresh;
window.ver370BuildTasks = ver370BuildTasks;
window.ver370ShowOpenTasks = ver370ShowOpenTasks;
window.ver370UpdateLatest = ver370UpdateLatest;
window.ver370MarkLatestDone = ver370MarkLatestDone;
window.ver370MarkLatestIgnore = ver370MarkLatestIgnore;
window.ver370ExportTasks = ver370ExportTasks;
