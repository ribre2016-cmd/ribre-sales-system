/* RIBRE — Shipping pages 移行（ver230/240/250/260/270 の最終定義を pages 側へ集約） */
function shipRows() {
  try {
    return JSON.parse(localStorage.getItem('ribre_shipping_rows230') || '[]');
  } catch (e) {
    return [];
  }
}
function saveShipRows(arr) {
  localStorage.setItem('ribre_shipping_rows230', JSON.stringify(arr.slice(0, 10000)));
}
function shipResults() {
  try {
    return JSON.parse(localStorage.getItem('ribre_shipping_results230') || '[]');
  } catch (e) {
    return [];
  }
}
function saveShipResults(arr) {
  localStorage.setItem('ribre_shipping_results230', JSON.stringify(arr.slice(0, 10000)));
}
function shipRender(rows) {
  const box = document.getElementById('shippingList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function shipSet(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function parseCsvLine(line) {
  const out = [];
  let cur = '',
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch == '"' && line[i + 1] == '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch == '"') {
      q = !q;
      continue;
    }
    if (ch == ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function parseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  return text
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map(parseCsvLine);
}
function normalizeSlip(v) {
  return String(v || '')
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/[-\s]/g, '')
    .trim();
}
function shipSourceTag(x) {
  return String((x && x.source) || '').toLowerCase() === 'ocr' ? ' / OCR' : '';
}
function shipOcrLightMeta(x) {
  if (String((x && x.source) || '').toLowerCase() !== 'ocr') return '';
  const carrier = String((x && (x.carrier || x.company || x.shippingCompany || '')) || '');
  const tracking = normalizeSlip((x && (x.trackingNumber || x.slip || '')) || '');
  const evidence = String((x && x.evidence_url) || '');
  return (carrier ? ' / ' + carrier : '') + (tracking ? ' / ' + tracking : '') + (evidence ? ' / 証憑あり' : '');
}
function extractItemId(v) {
  const s = String(v || '');
  const m = s.match(/[a-z]?\d{9,12}/i);
  return m ? m[0] : '';
}
function importShippingCsv() {
  const input = document.getElementById('shipCsvFile');
  const file = input && input.files ? input.files[0] : null;
  const type = document.getElementById('shipCsvType').value;
  if (!file) {
    alert('CSVを選択してください');
    return;
  }

  shipSet('shipStatus', '読込中');
  shipRender([{ type: '読込', level: 'warn', msg: 'CSVを読み込んでいます：' + file.name }]);

  const reader = new FileReader();

  reader.onload = () => {
    try {
      const rows = parseCsv(reader.result);
      const mapped = [];

      rows.forEach((r, idx) => {
        const joined = r.join('');
        if (idx === 0 && joined.match(/お客様|原票|運賃|伝票|管理|送料|問い合わせ|問合/)) return;

        const obj = { type: type, raw: r, row: idx + 1, itemId: '', slip: '', shipping: 0, company: '', status: '未照合' };

        if (type === 'yamato1') {
          obj.company = 'ヤマト';
          obj.itemId = extractItemId(r[0] || '') || extractItemId(r[27] || '');
          obj.slip = normalizeSlip(r[3] || '');
        } else if (type === 'yamato2') {
          obj.company = 'ヤマト';
          obj.slip = normalizeSlip(r[4] || '');
          obj.shipping = Math.round(num(r[11] || 0) * 1.1);
        } else {
          obj.company = '佐川急便';
          obj.itemId = extractItemId(r[4] || '');
          obj.shipping = Math.round(num(r[10] || 0) * 1.1);
        }

        if (obj.itemId || obj.slip || obj.shipping) mapped.push(obj);
      });

      let finalRows;
      if (type === 'yamato2') {
        const prev = shipRows();
        const nonY2 = prev.filter(r => r.type !== 'yamato2');
        const slipMap = new Map(prev.filter(r => r.type === 'yamato2' && r.slip).map(r => [r.slip, r]));
        const noSlipPrev = prev.filter(r => r.type === 'yamato2' && !r.slip);
        const noSlipNew = [];
        mapped.forEach(r => { r.slip ? slipMap.set(r.slip, r) : noSlipNew.push(r); });
        finalRows = nonY2.concat(Array.from(slipMap.values())).concat(noSlipPrev).concat(noSlipNew);
      } else {
        const prev = shipRows();
        finalRows = prev.filter(r => r.type === 'yamato2' || r.type !== type).concat(mapped);
      }
      saveShipRows(finalRows);
      shipSet('shipCsvCount', finalRows.length + '件');
      shipSet('shipStatus', '取込OK');

      if (!mapped.length) {
        shipRender([
          {
            type: '注意',
            level: 'warn',
            msg: 'CSVは読めましたが、商品ID・伝票番号・送料が見つかりませんでした。CSV種類を変えて再取込してください。'
          }
        ]);
        return;
      }

      shipRender(
        mapped.slice(0, 100).map((x) => ({
          type: x.company,
          level: 'ok',
          msg: '商品ID:' + x.itemId + ' / 伝票:' + x.slip + ' / 送料:' + x.shipping
        }))
      );
    } catch (e) {
      shipSet('shipStatus', 'エラー');
      shipRender([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    }
  };

  reader.onerror = () => {
    shipSet('shipStatus', '読込失敗');
    shipRender([{ type: 'ERROR', level: 'danger', msg: 'CSVファイルを読み込めませんでした' }]);
  };

  reader.readAsText(file, 'Shift_JIS');
}
function matchShipping() {
  const ships = shipRows();
  const s = sales();
  if (!ships.length) {
    alert('先に配送CSVを取込してください');
    return;
  }
  const results = [];
  let matched = 0,
    unmatched = 0;
  ships.forEach((sh) => {
    let target = null;
    if (sh.itemId) {
      target = s.find(
        (x) => String(x.id || x.itemId || x.memo || '').includes(sh.itemId) || String(x.name || '').includes(sh.itemId)
      );
    }
    if (!target && sh.slip) {
      target = s.find((x) => normalizeSlip(x.slip || x.invoiceNo || x.memo || '') == sh.slip);
    }
    if (target) {
      if (sh.slip) target.slip = sh.slip;
      if (sh.shipping) {
        target.shipping = sh.shipping;
        target.ship = sh.shipping;
        target.profit = num(target.amount || target.price) - num(target.fee) - num(sh.shipping);
      }
      target.deliveryCompany = sh.company;
      target.matchStatus = '配送CSV一致';
      matched++;
      results.push({
        status: '一致',
        company: sh.company,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: target.name || '',
        msg: '一致: ' + (target.name || '')
      });
    } else {
      unmatched++;
      results.push({
        status: '未一致',
        company: sh.company,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: '',
        msg: '未一致 商品ID:' + sh.itemId + ' 伝票:' + sh.slip
      });
    }
  });
  setLS(LS.sales, s);
  refreshAll();
  const salesResults = [];
  s.forEach(x => {
    const shipped = Number(x.shipping || 0) > 0;
    const csvMatched = x.matchStatus === '配送CSV一致' && shipped;
    const status = csvMatched ? '一致' : (shipped ? '匿名配送' : '未一致');
    salesResults.push({
      status,
      company: x.deliveryCompany || '',
      itemId: x.itemId || x.id || '',
      slip: x.slip || '',
      shipping: x.shipping || 0,
      name: x.name || '',
      msg: status + ': ' + (x.name || '') + ' / 送料:' + (x.shipping || 0) + (x.deliveryCompany ? ' / ' + x.deliveryCompany : '')
    });
  });
  saveShipResults(salesResults);
  const salesMatched   = salesResults.filter(r => r.status === '一致').length;
  const salesAnon      = salesResults.filter(r => r.status === '匿名配送').length;
  const salesUnmatched = salesResults.filter(r => r.status === '未一致').length;
  shipSet('shipSalesCount', s.length + '件');
  shipSet('shipMatchCount', salesMatched + '件');
  shipSet('shipSalesUnmatched', salesUnmatched + '件');
  shipSet('shipMatchRate', s.length > 0 ? Math.round(salesMatched / s.length * 100) + '%' : '—');
  shipSet('shipUnmatchCount', salesAnon + '件');
  shipSet('shipStatus', '照合完了');
  shipRenderEditable(salesResults);
}
function exportShippingReport() {
  const rows = [['状態', '会社', '商品ID', '伝票番号', '送料', '商品名']];
  shipResults().forEach((r) => rows.push([r.status, r.company, r.itemId, r.slip, r.shipping, r.name]));
  csvDownload(rows, 'shipping_match_Ver23_0.csv');
}

function yRows() {
  try {
    return JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]');
  } catch (e) {
    return [];
  }
}
function ySave(arr) {
  localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(arr.slice(0, 20000)));
  setLS(LS.sales, arr.slice(0, 20000));
}
function ySet(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function yRender(rows) {
  const box = document.getElementById('yahooList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function yCsvLine(line) {
  const out = [];
  let cur = '',
    q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch == '"' && line[i + 1] == '"') {
      cur += '"';
      i++;
      continue;
    }
    if (ch == '"') {
      q = !q;
      continue;
    }
    if (ch == ',' && !q) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}
function yParseCsv(text) {
  text = String(text || '').replace(/^\ufeff/, '');
  return text
    .split(/\r?\n/)
    .filter((x) => x.trim())
    .map(yCsvLine);
}
function yFindIndex(headers, patterns, fallback) {
  for (const p of patterns) {
    const idx = headers.findIndex((h) => String(h || '').includes(p));
    if (idx >= 0) return idx;
  }
  return fallback;
}
function yItemId(v) {
  const m = String(v || '').match(/[a-z]?\d{9,12}/i);
  return m ? m[0] : '';
}
function yNum(v) {
  const n = Number(String(v ?? '').replace(/[¥,円,\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}
function yDate(v) {
  const s = String(v || '').trim();
  const m = s.match(/(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
  return s || new Date().toISOString().slice(0, 10);
}
function importYahooSalesCsv() {
  const file = document.getElementById('yahooCsvFile').files[0];
  const account = document.getElementById('yahooAccount').value;
  if (!file) {
    alert('ヤフオク売上CSVを選択してください');
    return;
  }
  ySet('yahooStatus', '読込中');
  yRender([{ type: '読込', level: 'warn', msg: '売上CSVを読み込んでいます：' + file.name }]);

  const rd = new FileReader();
  rd.onload = () => {
    try {
      const rows = yParseCsv(rd.result);
      if (!rows.length) {
        alert('CSVが空です');
        return;
      }
      const h = rows[0];

      const idxId = yFindIndex(h, ['商品ID', 'オークションID', '管理番号'], 0);
      const idxDate = yFindIndex(h, ['完了日', '落札日', '終了日時', '取扱日'], 1);
      const idxName = yFindIndex(h, ['商品名', 'タイトル', '取扱内容'], 2);
      const idxAmount = yFindIndex(h, ['決済金額', '落札価格', '売上金額', '合計'], 3);
      const isYahoo = account.startsWith('ヤフオク');
      const idxFee = isYahoo
        ? yFindIndex(h, ['落札システム利用料', '手数料'], 4)
        : account === 'メルカリShops'
        ? yFindIndex(h, ['販売手数料（税込）', '手数料'], 15)
        : yFindIndex(h, ['手数料'], 4);
      const idxShip = yFindIndex(h, ['送料'], 5);
      const idxStatus = yFindIndex(h, ['状態', 'ステータス'], 6);
      const idxPay = yFindIndex(h, ['支払方法', '決済方法'], 7);

      const old = yRows();
      const seen = new Set(old.map((x) => x.itemId));
      let imported = 0, skipped = 0, patched = 0;
      const added = [];

      rows.slice(1).forEach((r, i) => {
        const itemId = yItemId(r[idxId] || r.join(' '));
        if (!itemId) {
          skipped++;
          return;
        }
        const status = String(r[idxStatus] || '');
        const pay = String(r[idxPay] || '');
        if (status.includes('受取連絡待ち')) {
          skipped++;
          return;
        }
        if (pay.includes('現金振り込み')) {
          skipped++;
          return;
        }
        if (seen.has(itemId)) {
          const existing = old.find((x) => x.itemId === itemId);
          if (existing) {
            const csvFee = yNum(r[idxFee]);
            const csvShipping = yNum(r[idxShip]);
            const csvSettleAmount = yNum(r[idxAmount]);
            let touched = false;
            if (!Number(existing.fee) && csvFee) { existing.fee = csvFee; touched = true; }
            if (!Number(existing.shipping) && csvShipping) {
              existing.shipping = csvShipping;
              existing.ship = csvShipping;
              touched = true;
            }
            if (!Number(existing.settleAmount) && csvSettleAmount) { existing.settleAmount = csvSettleAmount; touched = true; }
            if (touched) {
              existing.profit = Number(existing.amount || existing.price || 0) - Number(existing.fee || 0) - Number(existing.shipping || 0);
              patched++;
            }
          }
          skipped++;
          return;
        }

        const amount = yNum(r[idxAmount]);
        const fee = yNum(r[idxFee]);
        const shipping = yNum(r[idxShip]);
        const row = {
          id: itemId,
          itemId: itemId,
          date: yDate(r[idxDate]),
          month: yDate(r[idxDate]).slice(0, 7),
          shop: account,
          name: r[idxName] || '',
          amount: amount,
          price: amount,
          fee: fee,
          shipping: shipping,
          ship: shipping,
          profit: amount - fee - shipping,
          slip: '',
          deliveryCompany: '',
          matchStatus: '売上CSV取込',
          memo: 'ヤフオク売上CSV / ' + file.name,
          source: 'YahooCSV Ver60.0',
          order: old.length + added.length + i + 1
        };
        added.push(row);
        seen.add(itemId);
        imported++;
      });

      const merged = old.concat(added);
      ySave(merged);
      refreshAll();
      const totalSales = merged.length;
      const matchedSales = merged.filter((x) => {
        if (Number(x.shipping || 0) > 0) return true;
        if (x.matchStatus === '配送一致' || x.matchStatus === '手入力') return true;
        const s = [x.slip, x.invoiceNo, x.memo, x.deliveryCompany, x.matchStatus].map((v) => String(v || '')).join(' ');
        return s.includes('匿名配送') || s.includes('匿名');
      }).length;
      ySet('yahooSalesCount', totalSales + '件');
      ySet('yahooMatchCount', matchedSales + '件');
      ySet('yahooUnmatchCount', (totalSales - matchedSales) + '件');
      ySet('yahooStatus', '取込OK');
      yRender([
        { type: '取込', level: 'ok', msg: '取込：' + imported + '件' },
        { type: '補完', level: 'ok', msg: '補完更新：' + patched + '件' },
        { type: '除外', level: 'warn', msg: '除外/重複：' + skipped + '件' },
        ...added.slice(0, 80).map((x) => ({ type: x.shop, level: 'ok', msg: x.itemId + ' / ' + x.name + ' / ' + yNum(x.amount).toLocaleString() + '円' }))
      ]);
    } catch (e) {
      ySet('yahooStatus', 'エラー');
      yRender([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    }
  };
  rd.onerror = () => yRender([{ type: 'ERROR', level: 'danger', msg: 'CSVを読み込めませんでした' }]);
  rd.readAsText(file, 'Shift_JIS');
}
function autoMatchShippingFromYahoo() {
  const ships = shipRows();
  const ys = yRows();
  if (!ys.length) {
    alert('先にヤフオク売上CSVを取込してください');
    return;
  }
  if (!ships.length) {
    alert('先に配送照合で配送CSVを取込してください');
    return;
  }
  let matched = 0,
    unmatched = 0;
  const results = [];

  ships.forEach((sh) => {
    let target = null;
    if (sh.itemId) target = ys.find((x) => String(x.itemId || x.id || '') === String(sh.itemId));
    if (!target && sh.slip) target = ys.find((x) => normalizeSlip(x.slip || '') === sh.slip);
    if (target) {
      if (sh.slip) target.slip = sh.slip;
      if (sh.shipping) {
        target.shipping = sh.shipping;
        target.ship = sh.shipping;
        target.profit = yNum(target.amount) - yNum(target.fee) - yNum(sh.shipping);
      }
      target.deliveryCompany = sh.company;
      target.matchStatus = '配送一致';
      matched++;
      results.push({
        status: '一致',
        company: sh.company,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: target.name
      });
    } else {
      unmatched++;
      results.push({
        status: '未一致',
        company: sh.company,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: ''
      });
    }
  });

  ySave(ys);
  saveShipResults(results);
  refreshAll();
  ySet('yahooMatchCount', matched + '件');
  ySet('yahooUnmatchCount', unmatched + '件');
  ySet('yahooStatus', '照合完了');
  yRender(
    results.slice(0, 160).map((r) => ({
      type: r.status,
      level: r.status === '一致' ? 'ok' : 'warn',
      msg:
        (r.status === '一致' ? '一致 ' : '未一致 ') +
        '商品ID:' +
        r.itemId +
        ' / 伝票:' +
        r.slip +
        ' / 送料:' +
        r.shipping +
        ' / ' +
        r.company +
        shipSourceTag(r) +
        shipOcrLightMeta(r)
    }))
  );
}
function exportYahooSalesCsv() {
  const rows = [['商品ID', '日付', '販売先', '商品名', '決済金額', '手数料', '送料', '利益', '伝票番号', '配送会社', '状態']];
  yRows().forEach((x) => rows.push([x.itemId, x.date, x.shop, x.name, x.amount, x.fee, x.shipping, x.profit, x.slip, x.deliveryCompany, x.matchStatus]));
  csvDownload(rows, 'yahoo_sales_shipping_Ver24_0.csv');
}
function showYahooGuide() {
  yRender([
    { type: '1', level: 'ok', msg: 'ヤフオク1〜8を選択' },
    { type: '2', level: 'ok', msg: 'ヤフオク売上CSVを選択して「売上CSV取込」' },
    { type: '3', level: 'ok', msg: '配送照合でヤマト/佐川CSVを取込' },
    { type: '4', level: 'ok', msg: 'この画面で「配送CSVと自動一致」' },
    { type: '5', level: 'ok', msg: '送料・伝票番号・配送会社・利益が反映されます' }
  ]);
}
window.addEventListener('load', () => {
  setTimeout(() => {
    ySet('yahooSalesCount', yRows().length + '件');
  }, 1000);
});

function ver250ItemIdFromAny(v) {
  const s = String(v || '');
  const m = s.match(/[a-z]?\d{9,12}/i);
  return m ? m[0] : '';
}
function ver250Slip(v) {
  return String(v || '').replace(/[-\s]/g, '').trim();
}
function ver250ShipRowsEnhanced() {
  const rows = shipRows();
  return rows.map((x) => {
    const r = x.raw || [];
    const joined = r.join(' ');
    if (!x.itemId) {
      x.itemId = ver250ItemIdFromAny(r[27] || joined);
    }
    if (!x.slip) {
      x.slip = ver250Slip(r[3] || r[4] || joined.match(/\d{10,14}/)?.[0] || '');
    }
    x.company = x.company || ((x.type || '').includes('sagawa') ? '佐川急便' : 'ヤマト');
    return x;
  });
}
function ver250ImproveUnmatched() {
  const ys = yRows();
  if (!ys.length) {
    alert('先にヤフオク売上CSVを取込してください');
    return;
  }
  const ships = ver250ShipRowsEnhanced();
  if (!ships.length) {
    alert('先に配送CSVを取込してください');
    return;
  }

  let improved = 0,
    matched = 0,
    unmatched = 0;
  const results = [];

  ships.forEach((sh) => {
    let target = null;
    if (sh.itemId) {
      target = ys.find((x) => String(x.itemId || x.id || '') === String(sh.itemId));
    }
    if (!target && sh.itemId) {
      target = ys.find((x) => String(x.name || '').includes(sh.itemId) || String(x.memo || '').includes(sh.itemId));
    }
    if (!target && sh.slip) {
      target = ys.find((x) => ver250Slip(x.slip || x.invoiceNo || x.memo || '') === sh.slip);
    }
    if (!target && sh.shipping) {
      const cand = ys.filter((x) => !x.deliveryCompany && (!x.shipping || Number(x.shipping) === 0));
      if (cand.length === 1) target = cand[0];
    }

    if (target) {
      const beforeMatched = target.matchStatus === '配送一致';
      if (sh.slip) target.slip = sh.slip;
      if (sh.shipping) {
        target.shipping = Number(sh.shipping) || 0;
        target.ship = Number(sh.shipping) || 0;
        target.profit = Number(target.amount || target.price || 0) - Number(target.fee || 0) - Number(sh.shipping || 0);
      }
      target.deliveryCompany = sh.company || '配送';
      target.matchStatus = '配送一致';
      target.unmatchedReason = '';
      matched++;
      if (!beforeMatched) improved++;
      results.push({
        status: '一致',
        company: target.deliveryCompany,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || target.deliveryCompany || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: target.name
      });
    } else {
      unmatched++;
      const reason = sh.company === '佐川急便' ? '佐川急便' : '未一致';
      results.push({
        status: '未一致',
        company: sh.company,
        source: sh.source || '',
        carrier: sh.carrier || sh.company || '',
        trackingNumber: sh.trackingNumber || sh.slip || '',
        evidence_url: sh.evidence_url || '',
        itemId: sh.itemId,
        slip: sh.slip,
        shipping: sh.shipping,
        name: '',
        reason
      });
    }
  });

  ySave(ys);
  saveShipResults(results);
  refreshAll();

  ySet('yahooMatchCount', matched + '件');
  ySet('yahooUnmatchCount', unmatched + '件');
  ySet('ver250ImproveCount', improved + '件');
  ySet('ver250SagawaUnmatch', results.filter((r) => r.status === '未一致' && r.company === '佐川急便').length + '件');
  ySet('yahooStatus', '補完完了');

  yRender(
    results.slice(0, 180).map((r) => ({
      type: r.status,
      level: r.status === '一致' ? 'ok' : 'warn',
      msg:
        (r.status === '一致' ? '一致 ' : '未一致 ') +
        '商品ID:' +
        r.itemId +
        ' / 伝票:' +
        r.slip +
        ' / 送料:' +
        r.shipping +
        ' / ' +
        r.company +
        shipSourceTag(r) +
        shipOcrLightMeta(r)
    }))
  );
}
function ver250ShowOnlyUnmatched() {
  const rows = shipResults().filter((r) => r.status === '未一致');
  yRender(
    (rows.length ? rows : []).slice(0, 300).map((r) => ({
      type: r.company || '未一致',
      level: 'warn',
      msg:
        '未一致 商品ID:' +
        r.itemId +
        ' / 伝票:' +
        r.slip +
        ' / 送料:' +
        r.shipping +
        ' / ' +
        (r.company || '') +
        shipSourceTag(r) +
        shipOcrLightMeta(r)
    }))
  );
  if (!rows.length) {
    yRender([{ type: 'OK', level: 'ok', msg: '未一致はありません' }]);
  }
}
function ver250CompanySummary() {
  const ys = yRows();
  const sum = {};
  ys.forEach((x) => {
    const c = x.deliveryCompany || '未設定';
    sum[c] = sum[c] || { count: 0, shipping: 0, matched: 0 };
    sum[c].count++;
    sum[c].shipping += Number(x.shipping || 0);
    if (x.matchStatus === '配送一致') sum[c].matched++;
  });
  const rows = Object.keys(sum).map((k) => ({
    type: k,
    level: k === '未設定' ? 'warn' : 'ok',
    msg: k + '：件数 ' + sum[k].count + '件 / 一致 ' + sum[k].matched + '件 / 送料 ' + sum[k].shipping.toLocaleString() + '円'
  }));
  yRender(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '集計データがありません' }]);
}

function ver260MarketOf(x) {
  const shop = String(x.shop || x.source || x.memo || '');
  if (shop.includes('メルカリ') || shop.toLowerCase().includes('mercari')) return 'メルカリ';
  if (shop.includes('ヤフオク') || shop.toLowerCase().includes('yahoo')) return 'ヤフオク';
  return shop || '不明';
}
function ver260IsMatchedSale(x) {
  return !!(x.deliveryCompany || x.slip || x.matchStatus === '配送一致' || Number(x.shipping || 0) > 0);
}
function ver260IsAnonymous(x) {
  const s = [x.slip, x.invoiceNo, x.memo, x.deliveryCompany, x.matchStatus]
    .map((v) => String(v || ''))
    .join(' ');
  return s.includes('匿名配送') || s.includes('匿名');
}
function ver260SalesBasedUnmatched() {
  const ys = yRows();
  if (!ys.length) {
    alert('先にヤフオク/売上CSVを取込してください');
    return;
  }

  const yahoo = ys.filter((x) => ver260MarketOf(x) === 'ヤフオク');
  const mercari = ys.filter((x) => ver260MarketOf(x) === 'メルカリ');
  const other = ys.filter((x) => !['ヤフオク', 'メルカリ'].includes(ver260MarketOf(x)));

  const matched = ys.filter(ver260IsMatchedSale);
  const anonymous = ys.filter(ver260IsAnonymous);
  const zeroShip = ys.filter((x) => Number(x.shipping || 0) === 0);
  const noSlip = ys.filter((x) => !String(x.slip || x.invoiceNo || '').trim());

  const remaining = ys.filter((x) => !ver260IsMatchedSale(x) && !ver260IsAnonymous(x));

  localStorage.setItem('ribre_remaining_unmatched260', JSON.stringify(remaining.slice(0, 10000)));

  ySet('ver260Remaining', remaining.length + '件');
  ySet('ver260ZeroShipping', zeroShip.length + '件');
  ySet('yahooStatus', '件数確認OK');

  yRender([
    { type: '全売上', level: 'ok', msg: '売上CSV件数：' + ys.length + '件' },
    { type: 'ヤフオク', level: 'ok', msg: 'ヤフオク売上：' + yahoo.length + '件' },
    { type: 'メルカリ', level: 'ok', msg: 'メルカリ売上：' + mercari.length + '件' },
    { type: 'その他', level: 'warn', msg: 'その他/不明：' + other.length + '件' },
    { type: '配送一致', level: 'ok', msg: '配送一致済み：' + matched.length + '件' },
    { type: '匿名配送', level: 'warn', msg: '匿名配送：' + anonymous.length + '件' },
    { type: '送料0', level: 'warn', msg: '送料0：' + zeroShip.length + '件' },
    { type: '伝票なし', level: 'warn', msg: '伝票番号なし：' + noSlip.length + '件' },
    { type: '残未一致', level: 'warn', msg: '売上件数ベース残未一致：' + remaining.length + '件' },
    ...remaining.slice(0, 120).map((x) => ({
      type: '残未一致',
      level: 'warn',
      msg: '商品ID:' + String(x.itemId || x.id || '') + ' / ' + (x.name || '') + ' / ' + (x.shop || '') + ' / 送料:' + Number(x.shipping || 0)
    }))
  ]);
}
function ver260ExportRemainingUnmatched() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_remaining_unmatched260') || '[]');
  } catch (e) {}
  if (!rows.length) {
    alert('先に「売上件数ベース未一致」を押してください');
    return;
  }
  const csvRows = [['商品ID', '日付', '販売先', '商品名', '金額', '手数料', '送料', '利益', '伝票番号', '配送会社', '状態', 'メモ']];
  rows.forEach((x) =>
    csvRows.push([
      x.itemId || x.id || '',
      x.date || '',
      x.shop || '',
      x.name || '',
      x.amount || x.price || 0,
      x.fee || 0,
      x.shipping || 0,
      x.profit || 0,
      x.slip || x.invoiceNo || '',
      x.deliveryCompany || '',
      x.matchStatus || '',
      x.memo || ''
    ])
  );
  csvDownload(csvRows, 'remaining_unmatched_Ver26_0.csv');
}

function ver270Reason(x) {
  const id = String(x.itemId || x.id || '');
  const slip = String(x.slip || x.invoiceNo || '');
  const memo = String(x.memo || '');
  const shop = String(x.shop || '');
  const company = String(x.deliveryCompany || '');
  const shipping = Number(x.shipping || 0);

  if (shop.includes('メルカリ') || shop.toLowerCase().includes('mercari')) return 'メルカリ売上';
  if (memo.includes('匿名配送') || company.includes('匿名') || slip.includes('匿名')) return '匿名配送';
  if (!slip && shipping === 0) return '伝票番号なし・送料0';
  if (!slip) return '伝票番号なし';
  if (shipping === 0) return '送料0・ヤマトCSV2不足の可能性';
  if (!id) return '商品IDなし';
  return '要確認';
}
function ver270DiagnoseUnmatched() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_remaining_unmatched260') || '[]');
  } catch (e) {}
  if (!rows.length) {
    const ys = yRows();
    rows = ys.filter((x) => !ver260IsMatchedSale(x) && !ver260IsAnonymous(x));
  }
  const diagnosed = rows.map((x) => Object.assign({}, x, { diagnosis: ver270Reason(x) }));
  localStorage.setItem('ribre_unmatched_diagnosis270', JSON.stringify(diagnosed.slice(0, 10000)));

  const summary = {};
  diagnosed.forEach((x) => (summary[x.diagnosis] = (summary[x.diagnosis] || 0) + 1));

  ySet('ver270DiagnosisCount', diagnosed.length + '件');
  ySet('yahooStatus', '診断完了');

  const summaryRows = Object.keys(summary).map((k) => ({
    type: '原因',
    level: k.includes('要確認') ? 'warn' : 'ok',
    msg: k + '：' + summary[k] + '件'
  }));

  const detailRows = diagnosed.slice(0, 150).map((x) => ({
    type: x.diagnosis,
    level: 'warn',
    msg: '商品ID:' + (x.itemId || x.id || '') + ' / ' + (x.name || '') + ' / 伝票:' + (x.slip || x.invoiceNo || '') + ' / 送料:' + (x.shipping || 0)
  }));

  yRender(summaryRows.concat(detailRows));
}
function ver270ExportDiagnosis() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_unmatched_diagnosis270') || '[]');
  } catch (e) {}
  if (!rows.length) {
    alert('先に「未一致原因診断」を押してください');
    return;
  }
  const csvRows = [['原因', '商品ID', '日付', '販売先', '商品名', '金額', '送料', '伝票番号', '配送会社', '状態', 'メモ']];
  rows.forEach((x) =>
    csvRows.push([
      x.diagnosis || '',
      x.itemId || x.id || '',
      x.date || '',
      x.shop || '',
      x.name || '',
      x.amount || x.price || 0,
      x.shipping || 0,
      x.slip || x.invoiceNo || '',
      x.deliveryCompany || '',
      x.matchStatus || '',
      x.memo || ''
    ])
  );
  csvDownload(csvRows, 'unmatched_diagnosis_Ver27_0.csv');
}

function shipRenderEditable(rows) {
  const box = document.getElementById('shippingList');
  if (!box) return;
  box.innerHTML = (rows || []).slice(0, 200).map(r => {
    const level = r.status === '一致' || r.status === '手入力' ? 'ok' : 'warn';
    const safeId = String(r.itemId || '').replace(/['"<>&]/g, '');
    const inputHtml = safeId
      ? '<input type="number" class="ship-edit-input" value="' + (r.shipping || 0) + '" min="0" data-id="' + safeId + '" onchange="manualShipping(this.dataset.id,this.value)" onkeydown="if(event.key===\'Enter\'){manualShipping(this.dataset.id,this.value);event.target.blur();}" title="送料を手入力（Enter/タブで確定）">'
      : '';
    return '<div class="row ' + level + '"><span class="ship-row-msg">' + (r.msg || '') + '</span>' + inputHtml + '<span class="badge">' + r.status + '</span></div>';
  }).join('');
}
function sortUnmatchedFirst() {
  const rows = shipResults();
  if (!rows.length) { alert('先に「売上と照合」を実行してください'); return; }
  const order = { '未一致': 0 };
  const sorted = rows.slice().sort((a, b) => (order[a.status] ?? 1) - (order[b.status] ?? 1));
  shipRenderEditable(sorted);
}
function manualShipping(itemId, val) {
  const v = Math.round(Number(val) || 0);
  const s = sales();
  const idx = s.findIndex(x => String(x.itemId || x.id || '') === String(itemId));
  if (idx < 0) return;
  s[idx].shipping = v;
  s[idx].ship = v;
  s[idx].profit = num(s[idx].amount || s[idx].price || 0) - num(s[idx].fee || 0) - v;
  s[idx].matchStatus = '手入力';
  setLS(LS.sales, s);
  refreshAll();
  const results = shipResults();
  const ri = results.findIndex(r => String(r.itemId || '') === String(itemId));
  if (ri >= 0) {
    results[ri].status = '手入力';
    results[ri].shipping = v;
    results[ri].msg = '手入力: ' + (results[ri].name || '') + ' / 送料:' + v;
    saveShipResults(results);
  }
}
window.shipRenderEditable = shipRenderEditable;
window.sortUnmatchedFirst = sortUnmatchedFirst;
window.manualShipping = manualShipping;
window.shipRows = shipRows;
window.saveShipRows = saveShipRows;
window.shipResults = shipResults;
window.saveShipResults = saveShipResults;
window.shipRender = shipRender;
window.shipSet = shipSet;
window.parseCsvLine = parseCsvLine;
window.parseCsv = parseCsv;
window.normalizeSlip = normalizeSlip;
window.extractItemId = extractItemId;
window.importShippingCsv = importShippingCsv;
window.matchShipping = matchShipping;
window.exportShippingReport = exportShippingReport;

window.yRows = yRows;
window.ySave = ySave;
window.ySet = ySet;
window.yRender = yRender;
window.yCsvLine = yCsvLine;
window.yParseCsv = yParseCsv;
window.yFindIndex = yFindIndex;
window.yItemId = yItemId;
window.yNum = yNum;
window.yDate = yDate;
window.importYahooSalesCsv = importYahooSalesCsv;
window.autoMatchShippingFromYahoo = autoMatchShippingFromYahoo;
window.exportYahooSalesCsv = exportYahooSalesCsv;
window.showYahooGuide = showYahooGuide;

window.ver250ItemIdFromAny = ver250ItemIdFromAny;
window.ver250Slip = ver250Slip;
window.ver250ShipRowsEnhanced = ver250ShipRowsEnhanced;
window.ver250ImproveUnmatched = ver250ImproveUnmatched;
window.ver250ShowOnlyUnmatched = ver250ShowOnlyUnmatched;
window.ver250CompanySummary = ver250CompanySummary;

window.ver260MarketOf = ver260MarketOf;
window.ver260IsMatchedSale = ver260IsMatchedSale;
window.ver260IsAnonymous = ver260IsAnonymous;
window.ver260SalesBasedUnmatched = ver260SalesBasedUnmatched;
window.ver260ExportRemainingUnmatched = ver260ExportRemainingUnmatched;

window.ver270Reason = ver270Reason;
window.ver270DiagnoseUnmatched = ver270DiagnoseUnmatched;
window.ver270ExportDiagnosis = ver270ExportDiagnosis;
