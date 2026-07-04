// POST /api/mf/vouchers
// 証憑ファイルをMFへ送信し、結果をSupabase mf_evidence へ記録する
'use strict';

const { getAccessToken, postVoucher, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_FILE_NAME_LENGTH = 255;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

const MF_STORAGE_BUCKET = 'mf-evidence';

// マッチング添付(Phase2)の原資として、同じファイルbytesをSupabase Storageへ控え保存する。
// 失敗してもMF送信自体は成功として扱うため、ここでは例外を投げず null を返す。
async function saveToStorage({ fileName, decodedBytes, contentType }) {
  try {
    const path = `${cryptoRandomUuid()}_${sanitizeStorageFileName(fileName)}`;
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

function sanitizeStorageFileName(name) {
  return String(name || 'evidence').replace(/[^\w.\-]/g, '_');
}

function cryptoRandomUuid() {
  // Node18のグローバルcryptoを使用（依存追加禁止のため）
  return require('crypto').randomUUID();
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

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      // Vercelが既にパース済みの場合
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // ログイン済みユーザーのみ利用可（第三者による勝手なBox投入を防止）
  const user = await verifySupabaseToken(req);
  if (!user) {
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

  const { file_name, file_data, content_type, ocr_date, ocr_amount, ocr_vendor, journal_id } = body || {};

  if (!file_data || typeof file_data !== 'string') {
    res.status(400).json({ ok: false, error: 'file_data_required' });
    return;
  }
  if (!file_name || typeof file_name !== 'string' || file_name.length > MAX_FILE_NAME_LENGTH) {
    res.status(400).json({ ok: false, error: 'invalid_file_name' });
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

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (e instanceof NotConnectedError) {
      res.status(401).json({ ok: false, error: 'not_connected' });
      return;
    }
    res.status(500).json({ ok: false, error: 'token_error' });
    return;
  }

  // Storageへの控え保存はマッチング添付・再送の原資。MF送信より先に行う。
  // 失敗してもMF送信自体は継続する（保存できなければ以降 storagePath は null のまま）。
  const storagePath = await saveToStorage({ fileName: file_name, decodedBytes, contentType: content_type });

  try {
    const mfResult = await postVoucher({
      accessToken,
      journalId: journal_id,
      fileName: file_name,
      fileDataBase64: file_data,
    });

    const status = journal_id ? 'attached' : 'box_saved';
    // レスポンス形式は {voucher_file_ids: [{file_name, file_id}]}（openapi.yaml PostVouchersResponse）
    const mfFileId =
      (mfResult && Array.isArray(mfResult.voucher_file_ids) && mfResult.voucher_file_ids[0] && mfResult.voucher_file_ids[0].file_id) ||
      null;

    const evidence = await insertEvidence({
      file_name,
      ocr_date: ocr_date || null,
      ocr_amount: ocr_amount || null,
      ocr_vendor: ocr_vendor || null,
      storage_path: storagePath,
      mf_file_id: mfFileId,
      journal_id: journal_id || null,
      status,
    });

    res.status(200).json({ ok: true, file_id: mfFileId, evidence_id: evidence && evidence.id });
  } catch (e) {
    try {
      await insertEvidence({
        file_name,
        ocr_date: ocr_date || null,
        ocr_amount: ocr_amount || null,
        ocr_vendor: ocr_vendor || null,
        storage_path: storagePath,
        journal_id: journal_id || null,
        status: 'failed',
        error_message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
      });
    } catch (insertErr) {
      // 記録失敗はログのみ（本来のエラー応答を優先）
    }
    res.status(502).json({ ok: false, error: 'mf_send_failed' });
  }
};
