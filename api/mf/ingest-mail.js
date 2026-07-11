// POST /api/mf/ingest-mail
// Gmail(Google Apps Script)から届く請求書メールの添付ファイルを受信し、
// OCR→MFクラウドBox送信→Storage控え保存→台帳記録まで全自動で行う。
// Apps Scriptからの呼び出しのためSupabaseログインは前提にできない。
// 代わりに共有シークレット(x-ingest-secret)で認証する。
'use strict';

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MAIL_INGEST_SECRET = process.env.MAIL_INGEST_SECRET;

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_FILES_URL = 'https://api.openai.com/v1/files';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_FILE_NAME_LENGTH = 255;
const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'application/pdf'];
const MF_STORAGE_BUCKET = 'mf-evidence';

// pages/mf-evidence.js の mfRunOcr() と同一仕様のプロンプト・schema
function buildOcrPrompt() {
  const todayStr = new Date().toISOString().slice(0, 10);
  return (
    'あなたは日本の証憑OCRです。必ずJSONのみ返してください。説明文は禁止。推測は禁止。存在しない値は null。' +
    '出力schemaは次のみ: {"date":"","amount":0,"currency":"JPY","storeName":""}。' +
    'dateは西暦YYYY-MM-DD形式。年が2桁表記(例: 26.7.3、26/07/03)の場合は「20」を付けて2026年のように解釈する（平成・昭和とみなさない）。' +
    '「令和」「平成」の元号表記が明記されている場合のみ和暦として西暦に変換する。参考: 今日は' + todayStr + '。' +
    'amountは証憑に印字された数値をそのまま返す（円換算・為替換算は絶対にしない）。' +
    'currencyはamountの通貨をISO4217の3文字コードで返す（日本円/¥/円 表記はJPY、$やUSD表記はUSD、EUR表記はEURなど）。' +
    '通貨表記が無く判別できない場合はJPYとする。'
  );
}
// currencyは未知値・空値ならJPY扱いにする（3文字の英字コード以外は信用しない）
function sanitizeCurrency(cur) {
  const c = String(cur || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : 'JPY';
}

// あり得ない年（大昔・未来）は誤読とみなしてnullにする（2桁年の元号誤解釈など）
function sanitizeOcrDate(date) {
  if (!date) return null;
  const y = Number(String(date).slice(0, 4));
  const nowY = new Date().getFullYear();
  return y >= nowY - 1 && y <= nowY + 1 ? date : null;
}

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        try {
          resolve(JSON.parse(req.body));
        } catch (e) {
          reject(e);
        }
      } else {
        resolve(req.body);
      }
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sanitizeStorageFileName(name) {
  return String(name || 'evidence').replace(/[^\w.\-]/g, '_');
}

// 証憑控えをSupabase Storageへ保存する。失敗してもMF送信は継続するためnullを返す。
async function saveToStorage({ fileName, decodedBytes, contentType }) {
  try {
    const path = `${crypto.randomUUID()}_${sanitizeStorageFileName(fileName)}`;
    const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${path}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': contentType || 'application/octet-stream',
      },
      body: decodedBytes,
    });
    if (!res.ok) return null;
    return path;
  } catch (e) {
    return null;
  }
}

async function insertEvidence(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mf_evidence`, {
    method: 'POST',
    headers: supabaseHeaders(),
    body: JSON.stringify([row]),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`Supabase mf_evidence保存失敗: HTTP ${res.status}`);
  }
  return Array.isArray(data) && data.length ? data[0] : null;
}

// content_hashが同一の既存行を探す（メール再取込・Apps Script二重実行時の重複送信防止）
async function findByContentHash(contentHash) {
  const url = `${SUPABASE_URL}/rest/v1/mf_evidence?content_hash=eq.${encodeURIComponent(contentHash)}&select=id&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase mf_evidence検索失敗: HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// 取引先名の緩い正規化（重複判定専用）: NFKC正規化・小文字化・空白/句読点除去
function normalizeVendorForDup(v) {
  return String(v || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　,、.．]+/g, '');
}

// 内容ハッシュが不一致でも「同じ請求」の重複を検知する（Anthropic等が承認用に
// 内容同一・バイト列だけ違うPDFを複数通送ってくるケース向け）。
// 直近24時間以内に、同じ取引日・同じ金額・同じ通貨・取引先名が一致する行が
// 既にあれば重複とみなす。取引先名が読めた場合のみ判定する（誤爆防止）。
async function findRecentSemanticDup({ date, amount, currency, vendor }) {
  const vendorNorm = normalizeVendorForDup(vendor);
  if (!date || !Number.isFinite(amount) || !vendorNorm) return null;
  const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/mf_evidence?ocr_date=eq.${encodeURIComponent(date)}` +
    `&ocr_amount=eq.${amount}&created_at=gte.${encodeURIComponent(sinceIso)}` +
    `&select=id,ocr_vendor,ocr_currency&order=created_at.desc&limit=20`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return null;
  const rows = await res.json();
  const curNorm = currency || 'JPY';
  const hit = (Array.isArray(rows) ? rows : []).find(
    (r) => String(r.ocr_currency || 'JPY') === curNorm && normalizeVendorForDup(r.ocr_vendor) === vendorNorm
  );
  return hit || null;
}

// OpenAI Files APIへアップロードしてfile_idを取得する（PDF用）
async function uploadOpenAiFile({ decodedBytes, fileName, contentType }) {
  const fd = new FormData();
  fd.append('purpose', 'user_data');
  const blob = new Blob([decodedBytes], { type: contentType || 'application/octet-stream' });
  fd.append('file', blob, fileName || 'evidence');

  const res = await fetch(OPENAI_FILES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: fd,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data && (data.error && data.error.message)) || `OpenAI Files HTTP ${res.status}`);
  }
  return data.id;
}

// コードフェンス除去してJSON.parse。失敗したら{}扱い（OCR失敗はエラーにせずnull続行のため）
function extractOcrJson(text) {
  if (!text || typeof text !== 'string') return {};
  const stripped = text
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(stripped);
  } catch (e) {
    return {};
  }
}

// pages/mf-evidence.js mfRunOcr() と同一仕様: model gpt-4.1-mini, temperature 0
// 画像はinput_image(dataURL)、PDFはFiles APIアップロード後にinput_file(file_id)
// OCR失敗はエラーにせず {date:null, amount:null, storeName:null} を返して続行する
async function runOcr({ decodedBytes, contentType, fileName }) {
  const fallback = { date: null, amount: null, currency: 'JPY', storeName: null };
  if (!OPENAI_API_KEY) return fallback;

  try {
    let content;
    if (contentType.startsWith('image/')) {
      const dataUrl = `data:${contentType};base64,${decodedBytes.toString('base64')}`;
      content = [
        { type: 'input_text', text: buildOcrPrompt() },
        { type: 'input_image', image_url: dataUrl },
      ];
    } else {
      const fileId = await uploadOpenAiFile({ decodedBytes, fileName, contentType });
      content = [
        { type: 'input_text', text: buildOcrPrompt() },
        { type: 'input_file', file_id: fileId },
      ];
    }

    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4.1',
        input: [{ role: 'user', content }],
        temperature: 0,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fallback;

    let text = data.output_text || '';
    if (!text && Array.isArray(data.output)) {
      text = data.output
        .map((o) => (Array.isArray(o.content) ? o.content.map((c) => c.text || '').join('\n') : ''))
        .join('\n');
    }
    const parsed = extractOcrJson(text);
    return {
      date: sanitizeOcrDate(parsed.date),
      amount: parsed.amount || null,
      currency: sanitizeCurrency(parsed.currency),
      storeName: parsed.storeName || null,
    };
  } catch (e) {
    return fallback;
  }
}

// OCR成功時は "YYYYMMDD_取引先_金額[通貨].拡張子"、失敗時は元file_nameを使う（拡張子は元ファイルから保持）。
// 通貨がJPY以外のときはファイル名にも通貨を付け、金額を円と見誤らないようにする。
function buildFileName({ date, amount, currency, storeName, originalFileName }) {
  if (!date && !amount && !storeName) return originalFileName;
  const d = String(date || '').replace(/-/g, '') || 'unknown';
  const v = String(storeName || '取引先未設定').replace(/[\\/:*?"<>|]/g, '');
  const cur = currency && currency !== 'JPY' ? currency : '';
  const a = (amount ? String(amount) : '0') + cur;
  const extMatch = String(originalFileName || '').match(/\.(pdf|png|jpe?g)$/i);
  const ext = extMatch ? extMatch[0].toLowerCase() : '';
  return `${d}_${v}_${a}${ext}`;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  if (!MAIL_INGEST_SECRET) {
    res.status(503).json({ ok: false, error: 'ingest_not_configured' });
    return;
  }

  const providedSecret = req.headers && (req.headers['x-ingest-secret'] || req.headers['X-Ingest-Secret']);
  if (providedSecret !== MAIL_INGEST_SECRET) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ ok: false, error: 'invalid_json' });
    return;
  }

  const { file_name, content_type, file_data, from, subject } = body || {};

  if (!file_data || typeof file_data !== 'string') {
    res.status(400).json({ ok: false, error: 'file_data_required' });
    return;
  }
  if (!file_name || typeof file_name !== 'string' || file_name.length > MAX_FILE_NAME_LENGTH) {
    res.status(400).json({ ok: false, error: 'invalid_file_name' });
    return;
  }
  if (!content_type || ALLOWED_CONTENT_TYPES.indexOf(content_type) < 0) {
    res.status(400).json({ ok: false, error: 'unsupported_type' });
    return;
  }

  let decodedBytes;
  try {
    decodedBytes = Buffer.from(file_data, 'base64');
  } catch (e) {
    res.status(400).json({ ok: false, error: 'invalid_file_data' });
    return;
  }
  if (!decodedBytes.length || decodedBytes.length > MAX_FILE_BYTES) {
    res.status(400).json({ ok: false, error: 'file_too_large' });
    return;
  }

  const contentHash = crypto.createHash('sha256').update(decodedBytes).digest('hex');

  // 重複防止: 同じ添付ファイル(bytes一致)は既に取り込み済みなら再送しない
  let existing;
  try {
    existing = await findByContentHash(contentHash);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'duplicate_check_failed' });
    return;
  }
  if (existing) {
    res.status(200).json({ ok: true, duplicate: true, evidence_id: existing.id });
    return;
  }

  // OCR実行。失敗しても続行(null)。
  const ocr = await runOcr({ decodedBytes, contentType: content_type, fileName: file_name });

  // 重複防止（内容一致・別バイト列版）: 承認用に同内容のPDFを複数通送ってくる
  // 取引先向け。content_hashでは検出できないため、OCR結果（日付・金額・通貨・
  // 取引先名）で24時間以内の重複を判定する。Storageアップロード前にチェックし、
  // 重複なら不要なファイルを保存しない。
  try {
    const semDup = await findRecentSemanticDup({
      date: ocr.date,
      amount: Number(ocr.amount),
      currency: ocr.currency,
      vendor: ocr.storeName,
    });
    if (semDup) {
      res.status(200).json({ ok: true, duplicate: true, evidence_id: semDup.id, reason: 'semantic' });
      return;
    }
  } catch (e) {
    // 重複判定自体の失敗は取込を止めない（誤って取りこぼすより多少の重複の方が安全）
  }

  const finalFileName = buildFileName({
    date: ocr.date,
    amount: ocr.amount,
    currency: ocr.currency,
    storeName: ocr.storeName,
    originalFileName: file_name,
  });

  // Storageへの控え保存（承認後のMF送信の原資）
  const storagePath = await saveToStorage({ fileName: finalFileName, decodedBytes, contentType: content_type });
  if (!storagePath) {
    res.status(500).json({ ok: false, error: 'storage_save_failed' });
    return;
  }

  // 承認制: メール取込はMFへ直接送らず「送信前(pending)」として台帳に載せる。
  // ユーザーが台帳で内容を確認し「MFへ送信」を押したものだけがMFに送られる。
  try {
    const evidence = await insertEvidence({
      file_name: finalFileName,
      ocr_date: ocr.date || null,
      ocr_amount: ocr.amount || null,
      ocr_currency: ocr.currency || 'JPY',
      ocr_vendor: ocr.storeName || null,
      storage_path: storagePath,
      mf_file_id: null,
      journal_id: null,
      status: 'pending',
      content_hash: contentHash,
      source: 'mail',
      mail_from: from || null,
      mail_subject: subject || null,
    });

    res.status(200).json({ ok: true, pending: true, evidence_id: evidence && evidence.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'evidence_insert_failed' });
  }
};
