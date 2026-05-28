/* かんたんモード Ver61.0 — 既存関数を使ったガイド付きワークフロー */

function simpleToggle() {
  const on = document.body.classList.toggle('simple-mode');
  try { localStorage.setItem('ribre_simple_mode', on ? '1' : ''); } catch(e) {}
  if (on) { simpleTab('csv'); simpleRenderSummary(); }
}

function simpleTab(tab) {
  document.querySelectorAll('.smp-tab-btn').forEach(b => b.classList.toggle('smp-tab-active', b.dataset.tab === tab));
  document.querySelectorAll('.smp-screen').forEach(s => s.classList.toggle('smp-screen-active', s.dataset.screen === tab));
  if (tab === 'summary') simpleRenderSummary();
}

/* ---- 売上CSV取込 ---- */
function smpImportCsv() {
  const file = document.getElementById('smpCsvFile').files[0];
  const platform = document.getElementById('smpPlatform').value;
  if (!file) { alert('CSVファイルを選んでください'); return; }

  // 既存の要素に値をセットして既存関数を呼び出す
  const origSelect = document.getElementById('yahooAccount');
  const origFile   = document.getElementById('yahooCsvFile');
  if (!origSelect || !origFile) { alert('ページを再読み込みしてください'); return; }

  origSelect.value = platform;

  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpCsvStatus', '取込中...', 'info');
  try {
    importYahooSalesCsv();
    setTimeout(() => {
      const count = document.getElementById('yahooSalesCount')?.textContent || '?';
      smpSetStatus('smpCsvStatus', `✅ 取込完了：${count}`, 'ok');
      simpleRenderSummary();
    }, 800);
  } catch(e) {
    smpSetStatus('smpCsvStatus', '❌ エラー：' + e.message, 'err');
  }
}

/* ---- 配送照合 ---- */
function smpImportShipping() {
  const file = document.getElementById('smpShipFile').files[0];
  const type = document.getElementById('smpShipType').value;
  if (!file) { alert('CSVファイルを選んでください'); return; }

  const origType = document.getElementById('shipCsvType');
  const origFile = document.getElementById('shipCsvFile');
  if (!origType || !origFile) { alert('ページを再読み込みしてください'); return; }

  origType.value = type;
  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpShipStatus', '取込中...', 'info');
  try {
    importShippingCsv();
    setTimeout(() => {
      smpSetStatus('smpShipStatus', '✅ 配送CSV取込完了。次に「照合する」を押してください', 'ok');
    }, 800);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ エラー：' + e.message, 'err');
  }
}

function smpMatchShipping() {
  smpSetStatus('smpShipStatus', '照合中...', 'info');
  try {
    matchShipping();
    setTimeout(() => {
      const matched   = document.getElementById('shipMatchCount')?.textContent || '?';
      const unmatched = document.getElementById('shipSalesUnmatched')?.textContent || '?';
      smpSetStatus('smpShipStatus', `✅ 照合完了　一致：${matched}　未一致：${unmatched}`, 'ok');
      simpleRenderSummary();
    }, 800);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ エラー：' + e.message, 'err');
  }
}

/* ---- 仕入れ（OCR） ---- */
function smpOcrFile(input) {
  const file = input.files[0];
  if (!file) return;

  const origFile = document.getElementById('ocrFile');
  const origKind = document.getElementById('ocrKind');
  if (!origFile || !origKind) { alert('ページを再読み込みしてください'); return; }

  origKind.value = 'purchase';
  const dt = new DataTransfer();
  dt.items.add(file);
  origFile.files = dt.files;

  smpSetStatus('smpOcrStatus', '画像を読み込み中...', 'info');
  try {
    registerEvidence();
    setTimeout(() => {
      runOcr();
      smpSetStatus('smpOcrStatus', 'OCR実行中...AIが読み取っています', 'info');
      // OCR完了後に候補フィールドを反映
      setTimeout(() => smpSyncOcrFields(), 4000);
    }, 500);
  } catch(e) {
    smpSetStatus('smpOcrStatus', '❌ エラー：' + e.message, 'err');
  }
}

function smpSyncOcrFields() {
  const date   = document.getElementById('cDate')?.value   || '';
  const vendor = document.getElementById('cVendor')?.value || '';
  const item   = document.getElementById('cItem')?.value   || '';
  const amount = document.getElementById('cAmount')?.value || '';

  if (document.getElementById('smpOcrDate'))   document.getElementById('smpOcrDate').value   = date;
  if (document.getElementById('smpOcrVendor')) document.getElementById('smpOcrVendor').value = vendor;
  if (document.getElementById('smpOcrItem'))   document.getElementById('smpOcrItem').value   = item;
  if (document.getElementById('smpOcrAmount')) document.getElementById('smpOcrAmount').value = amount;

  if (date || item || amount) {
    smpSetStatus('smpOcrStatus', '✅ OCR完了。内容を確認してから「仕入れとして登録」を押してください', 'ok');
  } else {
    smpSetStatus('smpOcrStatus', '⚠ OCR結果が空です。手動で入力してください', 'warn');
  }
}

function smpRegisterPurchase() {
  const date   = document.getElementById('smpOcrDate')?.value.trim()   || today();
  const vendor = document.getElementById('smpOcrVendor')?.value.trim() || 'その他';
  const item   = document.getElementById('smpOcrItem')?.value.trim();
  const amount = num(document.getElementById('smpOcrAmount')?.value || 0);

  if (!item)   { alert('商品名を入力してください'); return; }
  if (!amount) { alert('金額を入力してください'); return; }

  // 既存フィールドに反映して addPurchase を呼ぶ
  if (document.getElementById('purDate'))   document.getElementById('purDate').value   = date;
  if (document.getElementById('purVendor')) document.getElementById('purVendor').value = vendor;
  if (document.getElementById('purName'))   document.getElementById('purName').value   = item;
  if (document.getElementById('purAmount')) document.getElementById('purAmount').value = amount;

  addPurchase();

  // フォームリセット
  ['smpOcrDate','smpOcrVendor','smpOcrItem','smpOcrAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('smpOcrFileInput').value = '';
  smpSetStatus('smpOcrStatus', '✅ 仕入れを登録しました', 'ok');
  simpleRenderSummary();
}

/* ---- 月次サマリー ---- */
function simpleRenderSummary() {
  const sel = document.getElementById('smpSummaryMonth');
  if (!sel) return;
  const month = sel.value || today().slice(0, 7);

  const s = sales().filter(r => (r.month || String(r.date||'').slice(0,7)) === month);
  const p = purchases().filter(r => (r.month || String(r.date||'').slice(0,7)) === month);

  const totalSale = s.reduce((a, r) => a + num(r.amount || r.price), 0);
  const totalFee  = s.reduce((a, r) => a + num(r.fee), 0);
  const totalShip = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
  const totalPur  = p.reduce((a, r) => a + num(r.total || r.amount), 0);
  const profit    = totalSale - totalFee - totalShip - totalPur;

  const set = (id, v, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = v;
    if (color) el.style.color = color;
  };
  set('smpTotalSale',  yen(totalSale));
  set('smpTotalFee',   yen(totalFee));
  set('smpTotalShip',  yen(totalShip));
  set('smpTotalPur',   yen(totalPur));
  set('smpTotalProfit', yen(profit), profit >= 0 ? '#166534' : '#dc2626');
  set('smpSaleCount',  s.length + '件');
  set('smpPurCount',   p.length + '件');
}

function smpInitMonthOptions() {
  const sel = document.getElementById('smpSummaryMonth');
  if (!sel) return;
  const cur = today().slice(0, 7);
  const opts = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const m = d.toISOString().slice(0, 7);
    opts.push(`<option value="${m}"${m === cur ? ' selected' : ''}>${m}</option>`);
  }
  sel.innerHTML = opts.join('');
}

/* ---- ユーティリティ ---- */
function smpSetStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'smp-status smp-status-' + (type || 'info');
}

function smpClearOcr() {
  ['smpOcrDate','smpOcrVendor','smpOcrItem','smpOcrAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fi = document.getElementById('smpOcrFileInput');
  if (fi) fi.value = '';
  smpSetStatus('smpOcrStatus', '画像を選ぶとAIが自動で読み取ります', 'info');
  document.getElementById('smpOcrFileName').textContent = '';
}

/* ファイル選択時にファイル名を表示 */
function smpBindFileLabels() {
  [
    ['smpCsvFile',     'smpCsvFileName'],
    ['smpShipFile',    'smpShipFileName'],
    ['smpOcrFileInput','smpOcrFileName']
  ].forEach(([inputId, labelId]) => {
    const input = document.getElementById(inputId);
    const label = document.getElementById(labelId);
    if (input && label) {
      input.addEventListener('change', () => {
        label.textContent = input.files[0] ? input.files[0].name : '';
      });
    }
  });
}

window.addEventListener('load', function() {
  smpInitMonthOptions();
  smpBindFileLabels();
  const od = document.getElementById('smpOcrDate');
  if (od && !od.value) od.value = today();
  try {
    if (localStorage.getItem('ribre_simple_mode') === '1') {
      document.body.classList.add('simple-mode');
      simpleTab('csv');
      simpleRenderSummary();
    }
  } catch(e) {}
});
