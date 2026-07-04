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
});

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
  document.getElementById('mfPreviewPanel').style.display = 'none';
}

function mfRenderOcrStatus(rows) {
  renderList('mfOcrStatus', rows);
}

function mfBuildFileName(date, vendor, amount) {
  const d = String(date || today()).replace(/-/g, '');
  const v = String(vendor || '取引先未設定').replace(/[\\/:*?"<>|]/g, '');
  const a = amount ? String(amount) : '0';
  return d + '_' + v + '_' + a;
}

/* ---------------- OCR ---------------- */

async function mfRunOcr() {
  if (!mfCurrentFile) return;
  mfRenderOcrStatus([{ type: 'OCR', level: 'warn', msg: 'AI読取中です' }]);
  try {
    const prompt =
      'あなたは日本の証憑OCRです。必ずJSONのみ返してください。説明文は禁止。推測は禁止。存在しない値は null。' +
      '出力schemaは次のみ: {"date":"","amount":0,"storeName":""}';
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
        model: 'gpt-4.1-mini',
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
    document.getElementById('mfDate').value = norm.date || today();
    document.getElementById('mfAmount').value = norm.amount || '';
    document.getElementById('mfVendor').value = norm.storeName || '';
    document.getElementById('mfFileName').value = mfBuildFileName(norm.date, norm.storeName, norm.amount);
    mfRenderOcrStatus([{ type: 'OCR', msg: '自動入力しました（内容を確認してください）' }]);
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
  const fileName = document.getElementById('mfFileName').value || mfBuildFileName(date, vendor, amount);

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
        ocr_vendor: vendor
      })
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.ok) {
      throw new Error((d && d.error) || 'HTTP ' + res.status);
    }
    mfRenderOcrStatus([{ type: '送信', msg: 'MFへ送信しました（evidence_id: ' + (d.evidence_id || '-') + '）' }]);
    mfToast('MFへ送信しました', 'ok');
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
    params.push('box_meta_done=is.false');
    params.push('status=neq.failed');
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
      amountSpan.textContent = yen(r.ocr_amount);
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

/* 控えファイルをサーバー経由で取得し、別タブでプレビュー表示する */
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
    const blob = new Blob([bytes], { type: d.content_type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    mfToast('プレビュー失敗: ' + e.message, 'error');
  } finally {
    if (linkEl) linkEl.style.pointerEvents = '';
  }
}

/* 送信前(pending)/失敗の証憑を削除する（メール取込の却下操作） */
async function mfDeleteEvidence(evidenceId, fileName, btnEl) {
  if (!confirm('「' + (fileName || evidenceId) + '」を削除しますか？（MFには送信されません）')) return;
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
      note.textContent = '※日付が±3日ずれた候補です';
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
    if (unmatchedCount) rows.push({ type: '結果', level: 'warn', msg: unmatchedCount + '件は該当仕訳なし' });
    if (skippedCount) rows.push({ type: '結果', level: 'warn', msg: skippedCount + '件は控えファイルが無く対象外' });
    if (d.debug) {
      rows.push({ type: '診断', msg: '仕訳取得: ' + d.debug.journals_count + '件（' + d.debug.start_date + '〜' + d.debug.end_date + '）' });
      console.log('MFマッチング診断:', d.debug);
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
    const res = await fetch('/api/mf/status');
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
    const res = await fetch('/api/mf/auth/start');
    const d = await res.json().catch(() => ({}));
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
