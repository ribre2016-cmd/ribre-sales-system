/* かんたんモード Ver61.0 — 既存関数を使ったガイド付きワークフロー */

function simpleToggle() {
  const on = document.body.classList.toggle('simple-mode');
  try { localStorage.setItem('ribre_simple_mode', on ? '1' : ''); } catch(e) {}
  if (on) { simpleTab('home'); }
}

function simpleTab(tab) {
  document.querySelectorAll('.smp-tab-btn').forEach(b => b.classList.toggle('smp-tab-active', b.dataset.tab === tab));
  document.querySelectorAll('.smp-nav-item').forEach(b => b.classList.toggle('smp-nav-active', b.dataset.nav === tab));
  document.querySelectorAll('.smp-screen').forEach(s => s.classList.toggle('smp-screen-active', s.dataset.screen === tab));
  if (tab === 'home') smpRenderHome();
  if (tab === 'summary') { simpleRenderSummary(); simpleRenderChart(); }
  const c = document.querySelector('.smp-content'); if (c) c.scrollTop = 0;
}

/* ホーム画面：今月のKPI＋3ヶ月グラフ */
function smpRenderHome() {
  const month = today().slice(0, 7);
  const s = sales().filter(r => (r.month || String(r.date || '').slice(0, 7)) === month);
  const p = purchases().filter(r => (r.month || String(r.date || '').slice(0, 7)) === month);
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
  const ym = month.split('-');
  set('smpHomeMonth', '📅 ' + ym[0] + '年' + Number(ym[1]) + '月');
  set('smpHomeProfit', (profit >= 0 ? '＋' : '') + yen(profit), profit >= 0 ? '#15803d' : '#dc2626');
  set('smpHomeSub', '売上 ' + yen(totalSale) + ' − 仕入 ' + yen(totalPur) + ' − 経費 ' + yen(totalFee + totalShip));
  set('smpHomeSale', yen(totalSale));
  set('smpHomePur', yen(totalPur));
  set('smpHomeCount', s.length + '件');
  simpleRenderChart('smpHomeChart', 'smpHomeChartLabels');
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
      smpMarkDone('csv');
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
      smpMarkDone('ship');
      simpleRenderSummary();
    }, 800);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ エラー：' + e.message, 'err');
  }
}

/* 取込→照合をワンタップで連続実行 */
function smpImportAndMatchShipping() {
  const file = document.getElementById('smpShipFile').files[0];
  const type = document.getElementById('smpShipType').value;
  if (!file) { alert('配送CSVファイルを選んでください'); return; }

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
      smpSetStatus('smpShipStatus', '照合中...', 'info');
      try {
        matchShipping();
        setTimeout(() => {
          const matched   = document.getElementById('shipMatchCount')?.textContent || '?';
          const unmatched = document.getElementById('shipSalesUnmatched')?.textContent || '?';
          smpSetStatus('smpShipStatus', `✅ 完了！　一致：${matched}　未一致：${unmatched}`, 'ok');
          smpMarkDone('ship');
          simpleRenderSummary();
        }, 800);
      } catch(e) {
        smpSetStatus('smpShipStatus', '❌ 照合エラー：' + e.message, 'err');
      }
    }, 900);
  } catch(e) {
    smpSetStatus('smpShipStatus', '❌ 取込エラー：' + e.message, 'err');
  }
}

/* ---- 仕入れ（OCR） ---- */
let _smpOcrFile = null;

function smpHandleOcrFile(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  _smpOcrFile = file;

  const ocrLabel = document.getElementById('smpOcrFileName');
  if (ocrLabel) ocrLabel.textContent = file.name;

  // プレビュー表示（同期）
  const area   = document.getElementById('smpOcrPreviewArea');
  const img    = document.getElementById('smpOcrPreviewImg');
  const pdfBox = document.getElementById('smpOcrPreviewPdf');
  const pdfName= document.getElementById('smpOcrPreviewPdfName');

  if (area) {
    area.style.cssText = 'display:block !important; margin-bottom:10px; text-align:center';
    const blobUrl = URL.createObjectURL(file);
    if (file.type.startsWith('image/')) {
      if (img) { img.src = blobUrl; img.style.display = 'block'; }
      if (pdfBox) pdfBox.style.display = 'none';
    } else {
      if (img) img.style.display = 'none';
      if (pdfBox) { pdfBox.src = blobUrl; pdfBox.style.display = 'block'; }
    }
  }

  // OCRボタンを有効化してガイドメッセージ更新
  const ocrBtn = document.getElementById('smpOcrRunBtn');
  if (ocrBtn) ocrBtn.disabled = false;
  smpSetStatus('smpOcrStatus', '② 「AIで読み取る」を押してください', 'info');
}

function smpRunOcr() {
  if (!_smpOcrFile) { alert('先にファイルを選んでください'); return; }
  smpRunOcrProcess(_smpOcrFile);
  const ocrBtn = document.getElementById('smpOcrRunBtn');
  if (ocrBtn) ocrBtn.disabled = true;
}

function smpRunOcrProcess(file) {
  const origFile = document.getElementById('ocrFile');
  const origKind = document.getElementById('ocrKind');
  if (!origFile || !origKind) {
    smpSetStatus('smpOcrStatus', '⚠ OCR機能が利用できません。ページを再読み込みしてください', 'warn');
    return;
  }

  origKind.value = 'purchase';
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    origFile.files = dt.files;
  } catch(e) {}

  smpSetStatus('smpOcrStatus', '📖 AIが読み取っています...（数秒かかります）', 'info');
  try {
    registerEvidence();
    setTimeout(() => {
      try {
        runOcr();
        setTimeout(() => smpSyncOcrFields(), 4000);
      } catch(e) {
        smpSetStatus('smpOcrStatus', '⚠ OCR処理でエラーが発生しました。手動で入力してください', 'warn');
      }
    }, 500);
  } catch(e) {
    smpSetStatus('smpOcrStatus', '⚠ ファイル登録でエラーが発生しました。手動で入力してください', 'warn');
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
  smpMarkDone('ocr');
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
  set('smpTotalProfit', (profit >= 0 ? '+' : '') + yen(profit), profit >= 0 ? '#166534' : '#dc2626');
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
/* タブに完了チェック✓を付ける */
function smpMarkDone(tab) {
  const btn = document.querySelector('.smp-tab-btn[data-tab="' + tab + '"]');
  if (btn) btn.classList.add('smp-tab-done');
}

function smpSetStatus(id, msg, type) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'smp-status smp-status-' + (type || 'info');
}

/* ---- 3ヶ月グラフ ---- */
function simpleRenderChart(canvasId, labelsId) {
  canvasId = canvasId || 'smpChart';
  labelsId = labelsId || 'smpChartLabels';
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  // 直近3ヶ月のデータを取得
  const months = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - i);
    months.push(d.toISOString().slice(0, 7));
  }

  const allSales = sales();
  const allPur   = purchases();

  const data = months.map(m => {
    const s = allSales.filter(r => (r.month || String(r.date||'').slice(0,7)) === m);
    const p = allPur.filter(r   => (r.month || String(r.date||'').slice(0,7)) === m);
    const sale   = s.reduce((a, r) => a + num(r.amount || r.price), 0);
    const fee    = s.reduce((a, r) => a + num(r.fee), 0);
    const ship   = s.reduce((a, r) => a + num(r.ship || r.shipping), 0);
    const pur    = p.reduce((a, r) => a + num(r.total || r.amount), 0);
    const profit = sale - fee - ship - pur;
    return { month: m, sale, pur, profit };
  });

  // ラベル更新
  const labelEl = document.getElementById(labelsId);
  if (labelEl) labelEl.innerHTML = months.map(m => `<span>${m.slice(5)}月</span>`).join('');

  // Canvas描画
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth || 300;
  const H   = 160;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);

  const maxVal = Math.max(1, ...data.map(d => Math.max(d.sale, d.pur, Math.abs(d.profit))));
  const padL = 8, padR = 8, padT = 10, padB = 24;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const groupW = chartW / 3;
  const barW   = Math.min(groupW * 0.22, 20);
  const gap    = barW * 0.6;

  // ゼロライン
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + chartH);
  ctx.lineTo(W - padR, padT + chartH);
  ctx.stroke();

  // グリッド（上半分）
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 0.5;
  [0.5].forEach(ratio => {
    const y = padT + chartH * (1 - ratio);
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
  });

  data.forEach((d, i) => {
    const cx = padL + groupW * i + groupW / 2;

    const drawBar = (val, color, offsetX) => {
      const bh = Math.max(2, Math.abs(val) / maxVal * chartH * 0.88);
      const x  = cx + offsetX - barW / 2;
      const y  = val >= 0 ? padT + chartH - bh : padT + chartH;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW, bh, [3, 3, 0, 0]) : ctx.rect(x, y, barW, bh);
      ctx.fill();
    };

    drawBar(d.sale,   '#2563eb', -(barW + gap));
    drawBar(d.pur,    '#f59e0b', 0);
    drawBar(d.profit, d.profit >= 0 ? '#16a34a' : '#dc2626', barW + gap);

    // 利益の数字
    const profitLabel = d.profit >= 0
      ? '+' + Math.round(d.profit / 1000) + 'k'
      : Math.round(d.profit / 1000) + 'k';
    ctx.fillStyle = d.profit >= 0 ? '#166534' : '#dc2626';
    ctx.font = `bold ${Math.min(10, barW + 2)}px system-ui`;
    ctx.textAlign = 'center';
    const profBH = Math.max(2, Math.abs(d.profit) / maxVal * chartH * 0.88);
    const profY  = d.profit >= 0 ? padT + chartH - profBH - 3 : padT + chartH + 12;
    ctx.fillText(profitLabel, cx + barW + gap, profY);
  });
}

function smpClearOcr() {
  ['smpOcrDate','smpOcrVendor','smpOcrItem','smpOcrAmount'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const fi = document.getElementById('smpOcrFileInput');
  if (fi) fi.value = '';
  const pa = document.getElementById('smpOcrPreviewArea');
  if (pa) pa.style.display = 'none';
  const pi = document.getElementById('smpOcrPreviewImg');
  if (pi) pi.src = '';
  smpSetStatus('smpOcrStatus', '画像を選ぶとAIが自動で読み取ります', 'info');
  document.getElementById('smpOcrFileName').textContent = '';
}

/* ファイル選択時のイベントを一括バインド */
function smpBindFileLabels() {
  // CSV・配送はファイル名表示のみ
  [
    ['smpCsvFile',  'smpCsvFileName'],
    ['smpShipFile', 'smpShipFileName'],
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
      simpleTab('home');
    }
  } catch(e) {}
});
