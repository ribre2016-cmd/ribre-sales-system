/* MF証憑インボックス — 貼り付け/D&D→OCR→MF送信→台帳表示
 * 依存: core.js(escHtml/sb/sess/email/LS/rest*), openai-ocr.js(ribreOptimizeOcrImage/ribreExtractOcrJson/ribreNormalizeOcrSchema)
 */
/* signIn/signOut(supabase-auth.js)が呼ぶ共通関数の互換スタブ（このページでは台帳を再読込） */
function refreshAll() {
  try { mfLoadLedger(); } catch (e) {}
}

const MF_MAX_FILE_BYTES = 5 * 1024 * 1024;
const MF_ALLOWED_MIME = ['image/png', 'image/jpeg', 'application/pdf'];

let mfCurrentFile = null; // { dataUrl, mime, size, name }
let mfCurrentOcrCurrency = 'JPY'; // OCRが読み取った通貨(ISO4217)。ドル建て等の請求書を円と誤認しないための表示・送信用

/* ---------------- ファイル受付 ---------------- */

function mfRejectIfTooBig(file) {
  if (file.size > MF_MAX_FILE_BYTES) {
    alert('ファイルサイズが5MBを超えています。別のファイルを選択してください。');
    return true;
  }
  return false;
}

function mfAcceptMime(mime) {
  return MF_ALLOWED_MIME.indexOf(mime) >= 0;
}

function mfReadFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('ファイル読込に失敗しました'));
    r.readAsDataURL(file);
  });
}

async function mfIngestFile(file) {
  if (!file) return;
  if (!mfAcceptMime(file.type)) {
    alert('対応形式は PNG / JPG / PDF のみです');
    return;
  }
  if (mfRejectIfTooBig(file)) return;
  try {
    const dataUrl = await mfReadFileAsDataUrl(file);
    mfCurrentFile = { dataUrl, mime: file.type, size: file.size, name: file.name || 'evidence' };
    mfCurrentOcrCurrency = 'JPY';
    mfShowPreview();
    await mfRunOcr();
  } catch (e) {
    alert('ファイルの読込に失敗しました: ' + e.message);
  }
}

function mfHandleFileInput(ev) {
  const f = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  mfIngestFile(f);
}

/* ---------------- 貼り付け / D&D ---------------- */

document.addEventListener('paste', (ev) => {
  const items = (ev.clipboardData && ev.clipboardData.items) || [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'file') {
      const f = it.getAsFile();
      if (f) {
        mfIngestFile(f);
        break;
      }
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('mfDropZone');
  if (!zone) return;
  ['dragenter', 'dragover'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('drag-over');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('drag-over');
    })
  );
  zone.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) mfIngestFile(f);
  });
  const monthInput = document.getElementById('mfCoverageMonth');
  if (monthInput) monthInput.value = today().slice(0, 7);
  mfCheckMfStatus();
  mfLoadLedger();
  // 税理士送付ファイル保管庫（新UI 台帳・設定）の「証憑へ」ボタンからの取り込み
  // /mf-evidence?import=<tax-docsのobjectKey>&n=<表示名> で開くと該当ファイルを取得して通常の取り込みフローへ流す
  try {
    const q = new URLSearchParams(location.search);
    const imp = q.get('import');
    if (imp) mfImportFromTaxDocs(imp, q.get('n') || '');
  } catch (e) {}
});

/* 保管庫(Supabase Storage tax-docsバケット)からファイルを取得し、通常の貼り付けと同じ経路(mfIngestFile)へ流す */
async function mfImportFromTaxDocs(key, name) {
  try {
    // 送信済みチェック（再送防止）。インデックスは新UI(app-v2.js)と同じlocalStorageキーを共有している
    try {
      const idx = JSON.parse(localStorage.getItem('ribre_tax_docs_index_v1') || '{}') || {};
      const ent = idx.files && idx.files[key];
      if (ent && ent.ev) { mfToast('このファイルは既に証憑へ送信済みです（' + (ent.name || key) + '）', 'error'); return; }
    } catch (e) {}
    const c = (typeof sb === 'function') ? sb() : {};
    const s = (typeof sess === 'function') ? sess() : {};
    const tok = s.access_token || (s.session && s.session.access_token) || '';
    if (!c.url || !c.key || !tok) { mfToast('ログイン情報が見つかりません。ログイン後にもう一度お試しください', 'error'); return; }
    mfToast('保管庫からファイルを取り込んでいます…');
    const r = await fetch(c.url.replace(/\/$/, '') + '/storage/v1/object/tax-docs/' + key, {
      headers: { apikey: c.key, Authorization: 'Bearer ' + tok }
    });
    if (!r.ok) { mfToast('保管庫からの読込に失敗しました (HTTP ' + r.status + ')', 'error'); return; }
    const blob = await r.blob();
    const fileName = name || key.split('/').pop() || 'evidence';
    const file = new File([blob], fileName, { type: blob.type || 'application/octet-stream' });
    await mfIngestFile(file);
    // MF送信成功時に送信済みマークを付けるため、取り込み元のキーを覚えておく
    if (mfCurrentFile) mfCurrentFile.taxDocsKey = key;
  } catch (e) {
    mfToast('保管庫からの取り込みに失敗しました: ' + e.message, 'error');
  }
}
/* 保管庫インデックスの該当ファイルに送信済み(ev)を記録する。tsも進めて他端末とのマージで勝たせる。
 * クラウドへの反映は新UI側の次回Pull/Push時に伝播する */
function mfMarkTaxDocSent(key) {
  try {
    const idx = JSON.parse(localStorage.getItem('ribre_tax_docs_index_v1') || '{}') || {};
    if (!idx.files || !idx.files[key]) return;
    idx.files[key].ev = Date.now();
    idx.files[key].ts = Date.now();
    localStorage.setItem('ribre_tax_docs_index_v1', JSON.stringify(idx));
  } catch (e) {}
}

/* ---------------- プレビュー / フォーム ---------------- */

function mfShowPreview() {
  const panel = document.getElementById('mfPreviewPanel');
  panel.style.display = 'block';
  const thumb = document.getElementById('mfPreviewThumb');
  thumb.innerHTML = '';
  if (mfCurrentFile.mime.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = mfCurrentFile.dataUrl;
    thumb.appendChild(img);
  } else {
    const d = document.createElement('div');
    d.textContent = 'PDFファイル: ' + mfCurrentFile.name;
    thumb.appendChild(d);
  }
  document.getElementById('mfDate').value = today();
  document.getElementById('mfAmount').value = '';
  document.getElementById('mfVendor').value = '';
  document.getElementById('mfFileName').value = mfCurrentFile.name;
  mfRenderOcrStatus([{ type: 'OCR', level: 'warn', msg: '解析待ち' }]);
}

function mfResetForm() {
  mfCurrentFile = null;
  mfCurrentOcrCurrency = 'JPY';
  document.getElementById('mfPreviewPanel').style.display = 'none';
}

function mfRenderOcrStatus(rows) {
  renderList('mfOcrStatus', rows);
}

// 通貨がJPY以外のときはファイル名にも通貨を付け、金額を円と見誤らないようにする
function mfBuildFileName(date, vendor, amount, currency) {
  const d = String(date || today()).replace(/-/g, '');
  const v = String(vendor || '取引先未設定').replace(/[\\/:*?"<>|]/g, '');
  const cur = currency && currency !== 'JPY' ? currency : '';
  const a = (amount ? String(amount) : '0') + cur;
  return d + '_' + v + '_' + a;
}
function mfSanitizeCurrency(cur) {
  const c = String(cur || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'JPY';
}

/* ---------------- OCR ---------------- */

async function mfRunOcr() {
  if (!mfCurrentFile) return;
  mfRenderOcrStatus([{ type: 'OCR', level: 'warn', msg: 'AI読取中です' }]);
  try {
    const prompt =
      'あなたは日本の証憑OCRです。必ずJSONのみ返してください。説明文は禁止。推測は禁止。存在しない値は null。' +
      '出力schemaは次のみ: {"date":"","amount":0,"currency":"JPY","storeName":""}。' +
      'dateは西暦YYYY-MM-DD形式。年が2桁表記(例: 26.7.3、26/07/03)の場合は「20」を付けて2026年のように解釈する（平成・昭和とみなさない）。' +
      '「令和」「平成」の元号表記が明記されている場合のみ和暦として西暦に変換する。参考: 今日は' + today() + '。' +
      'amountは証憑に印字された数値をそのまま返す（円換算・為替換算は絶対にしない）。' +
      'currencyはamountの通貨をISO4217の3文字コードで返す（日本円/¥/円 表記はJPY、$やUSD表記はUSD、EUR表記はEURなど）。' +
      '通貨表記が無く判別できない場合はJPYとする。';
    let content;
    if (mfCurrentFile.mime.startsWith('image/') && typeof window.ribreOptimizeOcrImage === 'function') {
      const optimized = await window.ribreOptimizeOcrImage(mfCurrentFile.dataUrl);
      const imageUrl = optimized.imageUrl || mfCurrentFile.dataUrl;
      content = [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: imageUrl }
      ];
    } else {
      // PDFはOpenAIのinput_imageがMIME非対応のため、売上管理OCR(services/openai-ocr.js runOcr)と同じ
      // パターンでOpenAI Files APIへアップロードしてfile_idを取得し、input_fileとして渡す
      if (typeof window.uploadOpenAIFile !== 'function') throw new Error('PDF読取に必要な関数が読み込まれていません');
      const fileId = await window.uploadOpenAIFile({
        dataUrl: mfCurrentFile.dataUrl,
        fileName: mfCurrentFile.name,
        mime: mfCurrentFile.mime
      });
      content = [
        { type: 'input_text', text: prompt },
        { type: 'input_file', file_id: fileId }
      ];
    }
    const res = await fetch('/api/openai/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({
        model: 'gpt-4.1',
        input: [{ role: 'user', content }],
        temperature: 0
      })
    });
    const d = await res.json();
    if (!res.ok) {
      if (d && d.error === 'server_not_configured') throw new Error('OCR機能が利用できません（管理者に連絡してください）');
      throw new Error((d.error && d.error.message) || d.error || 'OCRに失敗しました');
    }
    let text = d.output_text || '';
    if (!text && d.output) {
      text = d.output.map((o) => (o.content || []).map((c) => c.text || '').join('\n')).join('\n');
    }
    const parsed = typeof window.ribreExtractOcrJson === 'function' ? window.ribreExtractOcrJson(text) : null;
    if (!parsed) throw new Error('OCR結果の解析に失敗しました');
    const norm = typeof window.ribreNormalizeOcrSchema === 'function' ? window.ribreNormalizeOcrSchema(parsed) : parsed;
    // currencyはribreNormalizeOcrSchemaの汎用schemaに無いフィールドのため、正規化前のparsedから直接読む
    mfCurrentOcrCurrency = mfSanitizeCurrency(parsed.currency);
    // あり得ない年（大昔・未来）は誤読とみなして空欄にする（2桁年の元号誤解釈など）
    if (norm.date) {
      const y = Number(String(norm.date).slice(0, 4));
      const nowY = new Date().getFullYear();
      if (!(y >= nowY - 1 && y <= nowY + 1)) norm.date = '';
    }
    // 日付が読めなかったときに今日の日付で埋めない（気づかず誤登録するのを防ぐ）
    document.getElementById('mfDate').value = norm.date || '';
    document.getElementById('mfAmount').value = norm.amount || '';
    document.getElementById('mfVendor').value = norm.storeName || '';
    document.getElementById('mfFileName').value = mfBuildFileName(norm.date, norm.storeName, norm.amount, mfCurrentOcrCurrency);
    if (mfCurrentOcrCurrency !== 'JPY') {
      mfRenderOcrStatus([
        { type: 'OCR', level: 'warn', msg: '通貨が' + mfCurrentOcrCurrency + '建てと判定されました（円換算はしていません）。金額欄は' + mfCurrentOcrCurrency + 'の数値です。円に換算してから登録してください' }
      ]);
    } else if (!norm.date) {
      mfRenderOcrStatus([
        { type: 'OCR', level: 'warn', msg: '取引日を読み取れませんでした。レシートを見て手入力してください' },
        { type: 'OCR', msg: '金額・取引先は自動入力しました（内容を確認してください）' }
      ]);
    } else {
      mfRenderOcrStatus([{ type: 'OCR', msg: '自動入力しました（内容を確認してください）' }]);
    }
  } catch (e) {
    mfRenderOcrStatus([{ type: 'OCR', level: 'danger', msg: 'OCR失敗: ' + e.message + '（手入力してください）' }]);
  }
}

/* ---------------- 送信 ---------------- */

function mfDataUrlToBase64(dataUrl) {
  const comma = dataUrl.indexOf(',');
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function mfToast(msg, kind) {
  const old = document.querySelector('.mf-toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'mf-toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

async function mfFindDuplicate(date, amount) {
  if (!date || !amount) return null;
  const u = restUrl('mf_evidence');
  if (!u) return null;
  try {
    const query =
      '?select=id,file_name&ocr_date=eq.' + encodeURIComponent(date) + '&ocr_amount=eq.' + encodeURIComponent(amount) + '&limit=1';
    const res = await fetch(u + query, { headers: restHeaders() });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  } catch (e) {
    return null;
  }
}

async function mfSendToMf() {
  if (!mfCurrentFile) {
    alert('証憑ファイルを貼り付け/選択してください');
    return;
  }
  const date = document.getElementById('mfDate').value || '';
  const amount = num(document.getElementById('mfAmount').value);
  const vendor = document.getElementById('mfVendor').value || '';
  const fileName = document.getElementById('mfFileName').value || mfBuildFileName(date, vendor, amount, mfCurrentOcrCurrency);

  if (mfCurrentOcrCurrency !== 'JPY') {
    const ok = confirm(
      '金額欄は' + mfCurrentOcrCurrency + '建ての数値（' + amount + '）のままです。円換算していません。\n' +
      'このまま送信すると台帳に「' + amount + '円」として記録されます。よろしいですか？\n' +
      '（円に直す場合はキャンセルして金額欄を書き換えてください）'
    );
    if (!ok) return;
  }

  const dup = await mfFindDuplicate(date, amount);
  if (dup) {
    const ok = confirm('同じ日付・金額の証憑が既にあります（' + dup.file_name + '）。それでも送信しますか？');
    if (!ok) return;
  }

  const sendBtn = document.getElementById('mfSendBtn');
  sendBtn.disabled = true;
  mfRenderOcrStatus([{ type: '送信', level: 'warn', msg: 'MFへ送信中...' }]);
  try {
    const res = await fetch('/api/mf/vouchers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({
        file_name: fileName,
        file_data: mfDataUrlToBase64(mfCurrentFile.dataUrl),
        content_type: mfCurrentFile.mime,
        ocr_date: date,
        ocr_amount: amount,
        ocr_currency: mfCurrentOcrCurrency,
        ocr_vendor: vendor
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    mfRenderOcrStatus([{ type: '送信', msg: 'MFへ送信しました（evidence_id: ' + (d.evidence_id || '-') + '）' }]);
    mfToast('MFへ送信しました', 'ok');
    // 保管庫（税理士送付ファイル）から取り込んだ場合は送信済みマークを付ける（再送防止）
    if (mfCurrentFile && mfCurrentFile.taxDocsKey) mfMarkTaxDocSent(mfCurrentFile.taxDocsKey);
    mfResetForm();
    mfLoadLedger();
  } catch (e) {
    mfRenderOcrStatus([{ type: 'ERROR', level: 'danger', msg: '送信失敗: ' + e.message }]);
    mfToast('送信失敗: ' + e.message, 'error');
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------------- 台帳リスト ---------------- */

function mfStatusLabel(s) {
  return { pending: '送信前', box_saved: 'Box保存済', attached: '仕訳添付済', failed: '失敗' }[s] || s || '-';
}

/* 月の末日をYYYY-MM-DDで返す（input[type=month]の値からgte/lteのDATE範囲を作るため） */
function mfMonthLastDay(monthStr) {
  const parts = String(monthStr).split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const last = new Date(y, m, 0).getDate();
  return monthStr + '-' + String(last).padStart(2, '0');
}

/* 台帳フィルタ（月/検索語/状態/Box入力待ちのみ）からPostgRESTのクエリ文字列を組み立てる。
 * 値は必ずencodeURIComponentしてから連結する */
function mfBuildLedgerQuery() {
  const params = ['select=*'];
  const monthEl = document.getElementById('mfFilterMonth');
  const keywordEl = document.getElementById('mfFilterKeyword');
  const statusEl = document.getElementById('mfFilterStatus');
  const boxTodoEl = document.getElementById('mfFilterBoxTodo');

  const month = monthEl && monthEl.value;
  if (month) {
    params.push('ocr_date=gte.' + encodeURIComponent(month + '-01'));
    params.push('ocr_date=lte.' + encodeURIComponent(mfMonthLastDay(month)));
  }

  const keyword = keywordEl && keywordEl.value.trim();
  if (keyword) {
    const esc = keyword.replace(/[(),]/g, ''); // PostgREST or=()構文の区切り文字を除去
    params.push('or=(ocr_vendor.ilike.' + encodeURIComponent('*' + esc + '*') + ',file_name.ilike.' + encodeURIComponent('*' + esc + '*') + ')');
  }

  const status = statusEl && statusEl.value;
  if (status) {
    params.push('status=eq.' + encodeURIComponent(status));
  }

  if (boxTodoEl && boxTodoEl.checked) {
    // 仕訳添付済みは電帳法の検索要件を仕訳への紐付けで満たすため、Box入力待ちはbox_savedのみ
    params.push('box_meta_done=is.false');
    params.push('status=eq.box_saved');
  }

  params.push('order=created_at.desc');
  params.push('limit=200');
  return '?' + params.join('&');
}

async function mfLoadLedger() {
  const listEl = document.getElementById('mfLedgerList');
  const u = restUrl('mf_evidence');
  if (!u) {
    listEl.textContent = 'Supabase設定がありません';
    return;
  }
  listEl.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'mf-ledger-row mf-ledger-head';
  head.innerHTML = '<span>日付</span><span>取引先</span><span>金額</span><span>ファイル名</span><span>状態</span><span>登録日時</span><span>Box入力</span>';
  listEl.appendChild(head);
  try {
    const res = await fetch(u + mfBuildLedgerQuery(), { headers: restHeaders() });
    const rows = await res.json();
    if (!res.ok) throw new Error((rows && rows.message) || 'HTTP ' + res.status);
    if (!Array.isArray(rows) || !rows.length) {
      const empty = document.createElement('div');
      empty.className = 'mf-ledger-row';
      empty.style.gridTemplateColumns = '1fr';
      empty.textContent = '登録された証憑はありません';
      listEl.appendChild(empty);
      return;
    }
    rows.forEach((r) => {
      const row = document.createElement('div');
      row.className = 'mf-ledger-row';
      const dateSpan = document.createElement('span');
      dateSpan.textContent = r.ocr_date || '-';
      const vendorSpan = document.createElement('span');
      vendorSpan.textContent = r.ocr_vendor || '-';
      const amountSpan = document.createElement('span');
      // 通貨がJPY以外の証憑は「5.5円」のように誤解される表示をせず、通貨コード付きで示す
      amountSpan.textContent = (r.ocr_currency && r.ocr_currency !== 'JPY')
        ? Number(r.ocr_amount || 0).toLocaleString('ja-JP') + ' ' + r.ocr_currency
        : yen(r.ocr_amount);
      const nameSpan = document.createElement('span');
      if (r.storage_path) {
        // 控えファイルがある行はファイル名クリックでプレビュー（別タブ表示）
        const nameLink = document.createElement('a');
        nameLink.href = 'javascript:void(0)';
        nameLink.textContent = (r.source === 'mail' ? '📧 ' : '') + (r.file_name || '-');
        nameLink.title = 'クリックでプレビュー';
        nameLink.onclick = () => mfPreviewEvidence(r.id, nameLink);
        nameSpan.appendChild(nameLink);
      } else {
        nameSpan.textContent = (r.source === 'mail' ? '📧 ' : '') + (r.file_name || '-');
      }
      const statusSpan = document.createElement('span');
      const badge = document.createElement('span');
      badge.className = 'mf-status-badge mf-status-' + safeLevel(r.status || 'pending');
      badge.textContent = mfStatusLabel(r.status);
      statusSpan.appendChild(badge);
      if (r.status === 'failed' && r.error_message) {
        statusSpan.title = r.error_message;
      }
      if (r.status === 'failed' && r.storage_path) {
        const resendBtn = document.createElement('button');
        resendBtn.className = 'secondary mf-resend-btn';
        resendBtn.textContent = '再送';
        resendBtn.onclick = () => mfResendEvidence(r.id, resendBtn);
        statusSpan.appendChild(resendBtn);
      }
      // メール取込の承認制: 送信前(pending)の行は「MFへ送信」(承認)と「削除」(却下)を出す
      if (r.status === 'pending' && r.storage_path) {
        const approveBtn = document.createElement('button');
        approveBtn.className = 'green mf-resend-btn';
        approveBtn.textContent = 'MFへ送信';
        approveBtn.onclick = () => mfResendEvidence(r.id, approveBtn);
        statusSpan.appendChild(approveBtn);
      }
      // 仕訳添付済み以外は台帳から削除可能（MF側で削除済みの後始末・誤取込の整理用）
      if (r.status !== 'attached') {
        const delBtn = document.createElement('button');
        delBtn.className = 'secondary mf-resend-btn';
        delBtn.textContent = '削除';
        delBtn.onclick = () => mfDeleteEvidence(r.id, r.file_name, delBtn);
        statusSpan.appendChild(delBtn);
      }
      const atSpan = document.createElement('span');
      atSpan.textContent = r.created_at ? new Date(r.created_at).toLocaleString('ja-JP') : '-';
      const boxSpan = document.createElement('span');
      const boxCheck = document.createElement('input');
      boxCheck.type = 'checkbox';
      boxCheck.checked = !!r.box_meta_done;
      boxCheck.onchange = () => mfToggleBoxMetaDone(r.id, boxCheck);
      boxSpan.appendChild(boxCheck);
      row.appendChild(dateSpan);
      row.appendChild(vendorSpan);
      row.appendChild(amountSpan);
      row.appendChild(nameSpan);
      row.appendChild(statusSpan);
      row.appendChild(atSpan);
      row.appendChild(boxSpan);
      listEl.appendChild(row);
    });
  } catch (e) {
    const err = document.createElement('div');
    err.className = 'mf-ledger-row';
    err.style.gridTemplateColumns = '1fr';
    err.textContent = '台帳の取得に失敗しました: ' + e.message;
    listEl.appendChild(err);
  }
}

/* チェックボックス変更時にbox_meta_doneをPATCH。失敗時はチェックを元に戻す */
async function mfToggleBoxMetaDone(id, checkboxEl) {
  const nextValue = checkboxEl.checked;
  const prevValue = !nextValue;
  const u = restUrl('mf_evidence');
  if (!u) {
    checkboxEl.checked = prevValue;
    mfToast('Supabase設定がありません', 'error');
    return;
  }
  checkboxEl.disabled = true;
  try {
    const headers = Object.assign({}, restHeaders(), { 'Content-Type': 'application/json', Prefer: 'return=minimal' });
    const res = await fetch(u + '?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ box_meta_done: nextValue })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    mfToast(nextValue ? 'Box入力済みにしました' : 'Box入力待ちに戻しました', 'ok');
  } catch (e) {
    checkboxEl.checked = prevValue;
    mfToast('Box入力状態の更新に失敗しました: ' + e.message, 'error');
  } finally {
    checkboxEl.disabled = false;
  }
}

/* 失敗した証憑（storage_pathあり）をMFへ再送する */
async function mfResendEvidence(evidenceId, btnEl) {
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch('/api/mf/evidence-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({ action: 'resend', evidence_id: evidenceId })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    mfToast('MFへ送信しました', 'ok');
    mfLoadLedger();
  } catch (e) {
    if (btnEl) btnEl.disabled = false;
    mfToast('送信失敗: ' + e.message, 'error');
  }
}

/* 控えファイルをサーバー経由で取得し、ページ上のモーダルでプレビュー表示する */
async function mfPreviewEvidence(evidenceId, linkEl) {
  if (linkEl) linkEl.style.pointerEvents = 'none';
  try {
    const res = await fetch('/api/mf/evidence-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({ action: 'preview', evidence_id: evidenceId })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok || !d.file_data) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    const bin = atob(d.file_data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = d.content_type || 'application/octet-stream';
    const blob = new Blob([bytes], { type });
    const url = URL.createObjectURL(blob);
    mfShowPreviewModal({ url, type, fileName: d.file_name || '' });
  } catch (e) {
    mfToast('プレビュー失敗: ' + e.message, 'error');
  } finally {
    if (linkEl) linkEl.style.pointerEvents = '';
  }
}

/* プレビューモーダルの表示。×ボタン・背景クリック・Escで閉じる */
function mfShowPreviewModal({ url, type, fileName }) {
  const old = document.querySelector('.mf-preview-overlay');
  if (old) old.remove();

  const overlay = document.createElement('div');
  overlay.className = 'mf-preview-overlay';

  const box = document.createElement('div');
  box.className = 'mf-preview-modal';

  const head = document.createElement('div');
  head.className = 'mf-preview-modal-head';
  const title = document.createElement('span');
  title.textContent = fileName || 'プレビュー';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'secondary';
  closeBtn.textContent = '✕ 閉じる';
  head.appendChild(title);
  head.appendChild(closeBtn);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'mf-preview-modal-body';
  if (type.startsWith('image/')) {
    const img = document.createElement('img');
    img.src = url;
    body.appendChild(img);
  } else {
    const frame = document.createElement('iframe');
    frame.src = url;
    body.appendChild(frame);
  }
  box.appendChild(body);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function close() {
    overlay.remove();
    URL.revokeObjectURL(url);
    document.removeEventListener('keydown', onKey);
  }
  function onKey(e) {
    if (e.key === 'Escape') close();
  }
  closeBtn.onclick = close;
  overlay.onclick = (e) => {
    if (e.target === overlay) close();
  };
  document.addEventListener('keydown', onKey);
}

/* 送信前(pending)/失敗の証憑を削除する（メール取込の却下操作） */
async function mfDeleteEvidence(evidenceId, fileName, btnEl) {
  if (!confirm('「' + (fileName || evidenceId) + '」を台帳から削除しますか？（MFのクラウドBox側のファイルは削除されません。Box側は必要ならMF画面で削除してください）')) return;
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch('/api/mf/evidence-action', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({ action: 'delete', evidence_id: evidenceId })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    mfToast('削除しました', 'ok');
    mfLoadLedger();
  } catch (e) {
    if (btnEl) btnEl.disabled = false;
    mfToast('削除失敗: ' + e.message, 'error');
  }
}

/* ---------------- 仕訳マッチング ---------------- */

function mfRenderMatchSummary(rows) {
  renderList('mfMatchSummary', rows);
}

function mfCandidateLabel(c) {
  return (c.date || '-') + ' / ' + yen(c.amount) + (c.summary ? ' / ' + c.summary : '');
}

function mfRenderAmbiguous(ambiguousList) {
  const box = document.getElementById('mfMatchAmbiguous');
  box.innerHTML = '';
  if (!Array.isArray(ambiguousList) || !ambiguousList.length) return;
  ambiguousList.forEach((item) => {
    const wrap = document.createElement('div');
    wrap.className = 'panel';
    wrap.style.marginTop = '10px';

    if (item.fuzzy) {
      const note = document.createElement('div');
      note.className = 'safe-hint warn';
      note.textContent = item.vendor_date
        ? '※金額不一致でも取引先名と日付(±7日)で抽出した候補です（外貨建て請求書など）。金額を確認のうえ添付してください'
        : '※日付が±3日ずれた候補です';
      wrap.appendChild(note);
    }

    const title = document.createElement('div');
    title.style.fontWeight = '900';
    title.textContent = '証憑: ' + (item.file_name || item.evidence_id);
    wrap.appendChild(title);

    (item.candidates || []).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'controls';
      row.style.marginTop = '6px';

      const label = document.createElement('span');
      label.textContent = mfCandidateLabel(c);
      row.appendChild(label);

      const btn = document.createElement('button');
      btn.className = 'secondary';
      btn.textContent = 'この仕訳に添付';
      btn.onclick = () => mfConfirmMatch(item.evidence_id, c.journal_id, btn);
      row.appendChild(btn);

      wrap.appendChild(row);
    });

    box.appendChild(wrap);
  });
}

function mfUnmatchedReasonLabel(reason) {
  return {
    no_ocr_date: '取引日が読み取れていない（日付を確認してください）',
    no_journal_in_window: '検索期間（日付±7日）内にMFの仕訳が1件もありません（仕訳の登録日を確認してください）',
    no_ocr_vendor: '取引先名が読み取れていない（日付±7日の仕訳はあるが名前で絞れない）',
    no_candidates: '日付・金額・取引先名のいずれも一致するMF仕訳が見つかりません',
    attach_failed: 'MFへの添付処理自体が失敗しました（再試行してください）',
  }[reason] || '該当なし';
}

async function mfRunMatch() {
  const btn = document.getElementById('mfMatchBtn');
  btn.disabled = true;
  mfRenderMatchSummary([{ type: 'マッチング', level: 'warn', msg: '実行中...' }]);
  document.getElementById('mfMatchAmbiguous').innerHTML = '';
  try {
    const res = await fetch('/api/mf/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({})
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    const attachedCount = (d.attached || []).length;
    const ambiguousCount = (d.ambiguous || []).length;
    const unmatchedCount = (d.unmatched || []).length;
    const skippedCount = (d.skipped_no_storage || []).length;
    const rows = [
      { type: '結果', msg: attachedCount + '件を仕訳に添付しました' }
    ];
    if (ambiguousCount) rows.push({ type: '結果', level: 'warn', msg: ambiguousCount + '件は候補が複数（下で選択してください）' });
    if (skippedCount) rows.push({ type: '結果', level: 'warn', msg: skippedCount + '件は控えファイルが無く対象外' });
    if (d.debug) {
      rows.push({ type: '診断', msg: '仕訳取得: ' + d.debug.journals_count + '件（' + d.debug.start_date + '〜' + d.debug.end_date + '）' });
      console.log('MFマッチング診断:', d.debug);
    }
    // 「該当なし」は件数だけでなく、証憑ごとに理由を表示する（画面だけで原因が分かるように）
    if (unmatchedCount) {
      rows.push({ type: '結果', level: 'warn', msg: unmatchedCount + '件は該当仕訳なし（理由は下記）' });
      (d.unmatched || []).forEach((u) => {
        const cur = u.ocr_currency && u.ocr_currency !== 'JPY' ? (' ' + u.ocr_currency) : '円';
        const amt = u.ocr_amount != null ? Number(u.ocr_amount).toLocaleString('ja-JP') + cur : '金額不明';
        rows.push({
          type: '該当なし',
          level: 'warn',
          msg: (u.file_name || u.evidence_id) + '／' + (u.ocr_date || '日付不明') + '／' + amt + '／' + (u.ocr_vendor || '取引先不明') + '　→　' + mfUnmatchedReasonLabel(u.reason)
        });
      });
    }
    mfRenderMatchSummary(rows);
    mfRenderAmbiguous(d.ambiguous);
    if (attachedCount) mfLoadLedger();
  } catch (e) {
    mfRenderMatchSummary([{ type: 'ERROR', level: 'danger', msg: 'マッチング失敗: ' + e.message }]);
  } finally {
    btn.disabled = false;
  }
}

async function mfConfirmMatch(evidenceId, journalId, btnEl) {
  if (btnEl) btnEl.disabled = true;
  try {
    const res = await fetch('/api/mf/match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (sess().access_token || '') },
      body: JSON.stringify({ evidence_id: evidenceId, journal_id: journalId })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    // 同じ証憑を複数の仕訳（例: 振込仕訳と計上仕訳）へ付けられるよう、押した候補だけ添付済みにする
    if (btnEl) btnEl.textContent = '添付済み';
    mfToast('仕訳に添付しました', 'ok');
    mfLoadLedger();
  } catch (e) {
    if (btnEl) btnEl.disabled = false;
    mfToast('添付失敗: ' + e.message, 'error');
  }
}

/* ---------------- MF接続ステータス ---------------- */

async function mfCheckMfStatus() {
  const label = document.getElementById('mfConnLabel');
  const btn = document.getElementById('mfConnBtn');
  try {
    const res = await fetch('/api/mf/status', {
      headers: { Authorization: 'Bearer ' + (sess().access_token || '') }
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    if (d && d.connected) {
      label.textContent = 'MF連携: 接続済み';
      btn.style.display = 'none';
    } else {
      label.textContent = 'MF連携: 未接続';
      btn.style.display = 'inline-block';
    }
  } catch (e) {
    label.textContent = 'MF連携: 状態取得失敗';
    btn.style.display = 'inline-block';
  }
}

async function mfConnect() {
  try {
    const res = await fetch('/api/mf/auth/start', {
      headers: { Authorization: 'Bearer ' + (sess().access_token || '') }
    });
    const d = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('ログインし直してください');
    if (!res.ok || !d.url) throw new Error('接続開始に失敗しました');
    location.href = d.url;
  } catch (e) {
    alert('MF接続の開始に失敗しました: ' + e.message);
  }
}

/* ---------------- 証憑カバー率 ---------------- */

function mfCoverageMeterColor(pct) {
  if (pct >= 90) return '#16a34a';
  if (pct >= 70) return '#ca8a04';
  return '#dc2626';
}

function mfRenderCoverageMeter(pct) {
  const wrap = document.getElementById('mfCoverageMeterWrap');
  const bar = document.getElementById('mfCoverageMeterBar');
  wrap.style.display = 'block';
  const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
  bar.style.width = clamped + '%';
  bar.style.background = mfCoverageMeterColor(clamped);
}

function mfRenderCoverageMissing(missing) {
  const listEl = document.getElementById('mfCoverageMissingList');
  const titleEl = document.getElementById('mfCoverageMissingTitle');
  listEl.innerHTML = '';
  if (!Array.isArray(missing) || !missing.length) {
    titleEl.style.display = 'none';
    return;
  }
  titleEl.style.display = 'block';
  const head = document.createElement('div');
  head.className = 'mf-missing-row mf-missing-head';
  head.innerHTML = '<span>取引No</span><span>日付</span><span>金額</span><span>摘要</span>';
  listEl.appendChild(head);
  missing.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'mf-missing-row';
    const noSpan = document.createElement('span');
    noSpan.textContent = m.number || '-';
    const dateSpan = document.createElement('span');
    dateSpan.textContent = m.date || '-';
    const amountSpan = document.createElement('span');
    amountSpan.textContent = yen(m.amount);
    const summarySpan = document.createElement('span');
    summarySpan.textContent = m.summary || '-';
    row.appendChild(noSpan);
    row.appendChild(dateSpan);
    row.appendChild(amountSpan);
    row.appendChild(summarySpan);
    listEl.appendChild(row);
  });
}

async function mfRunCoverage() {
  const btn = document.getElementById('mfCoverageBtn');
  const monthInput = document.getElementById('mfCoverageMonth');
  if (monthInput && !monthInput.value) monthInput.value = today().slice(0, 7);
  const month = (monthInput && monthInput.value) || '';
  btn.disabled = true;
  document.getElementById('mfCoverageMeterWrap').style.display = 'none';
  document.getElementById('mfCoverageMissingTitle').style.display = 'none';
  document.getElementById('mfCoverageMissingList').innerHTML = '';
  renderList('mfCoverageSummary', [{ type: 'カバー率', level: 'warn', msg: '集計中...' }]);
  try {
    const url = '/api/mf/coverage' + (month ? '?month=' + encodeURIComponent(month) : '');
    const res = await fetch(url, {
      headers: { Authorization: 'Bearer ' + (sess().access_token || '') }
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    renderList('mfCoverageSummary', [
      { type: d.month, msg: d.total + '件中 ' + d.with_voucher + '件に証憑あり（' + d.coverage_pct + '%）' }
    ]);
    mfRenderCoverageMeter(d.coverage_pct);
    mfRenderCoverageMissing(d.missing);
  } catch (e) {
    renderList('mfCoverageSummary', [{ type: 'ERROR', level: 'danger', msg: 'カバー率集計に失敗しました: ' + e.message }]);
  } finally {
    btn.disabled = false;
  }
}

async function mfSendSlackTest() {
  const btn = document.getElementById('mfSlackTestBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/mf/monthly-report?target=slack', {
      headers: { Authorization: 'Bearer ' + (sess().access_token || '') }
    });
    const d = await res.json().catch(() => ({}));
    if (d && (d.error === 'slack_not_configured' || d.error === 'notify_not_configured')) {
      mfToast('Slack Webhook未設定です（Vercel環境変数 SLACK_WEBHOOK_URL）', 'error');
      return;
    }
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    if (d.slack_sent) {
      mfToast('Slackへ送信しました', 'ok');
    } else {
      mfToast('Slackへの送信に失敗しました', 'error');
    }
  } catch (e) {
    mfToast('送信テストに失敗しました: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function mfSendChatworkTest() {
  const btn = document.getElementById('mfChatworkTestBtn');
  btn.disabled = true;
  try {
    const res = await fetch('/api/mf/monthly-report?target=chatwork', {
      headers: { Authorization: 'Bearer ' + (sess().access_token || '') }
    });
    const d = await res.json().catch(() => ({}));
    if (d && (d.error === 'notify_not_configured' || d.error === 'chatwork_not_configured')) {
      mfToast('Chatwork未設定です（Vercel環境変数 CHATWORK_API_TOKEN / CHATWORK_ROOM_ID）', 'error');
      return;
    }
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    if (d.chatwork_sent) {
      mfToast('Chatworkへ送信しました', 'ok');
    } else {
      mfToast('Chatwork未設定です（Vercel環境変数 CHATWORK_API_TOKEN / CHATWORK_ROOM_ID）', 'error');
    }
  } catch (e) {
    mfToast('送信テストに失敗しました: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
  }
}
