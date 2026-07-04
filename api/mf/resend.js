// POST /api/mf/resend
// MF送信に失敗した証憑（status='failed'かつstorage_pathあり）を再送する
'use strict';

const { getAccessToken, postVoucher, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { fetchEvidenceById, fetchStorageFileBase64, updateEvidence } = require('./_lib/mf-match-core');

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

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

  const evidenceId = body && body.evidence_id;
  if (!evidenceId) {
    res.status(400).json({ ok: false, error: 'evidence_id_required' });
    return;
  }

  let evidence;
  try {
    evidence = await fetchEvidenceById(evidenceId);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'evidence_fetch_failed' });
    return;
  }

  if (!evidence || evidence.status !== 'failed' || !evidence.storage_path) {
    res.status(400).json({ ok: false, error: 'not_resendable' });
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

  try {
    const fileDataBase64 = await fetchStorageFileBase64(evidence.storage_path);
    const mfResult = await postVoucher({
      accessToken,
      journalId: null,
      fileName: evidence.file_name,
      fileDataBase64,
    });
    const fileId =
      (mfResult && Array.isArray(mfResult.voucher_file_ids) && mfResult.voucher_file_ids[0] && mfResult.voucher_file_ids[0].file_id) ||
      null;

    await updateEvidence(evidence.id, {
      status: 'box_saved',
      mf_file_id: fileId,
      error_message: null,
    });

    res.status(200).json({ ok: true, evidence_id: evidence.id, file_id: fileId });
  } catch (e) {
    try {
      await updateEvidence(evidence.id, {
        error_message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
      });
    } catch (updateErr) {
      // 記録失敗はログのみ（本来のエラー応答を優先）
    }
    res.status(502).json({ ok: false, error: 'mf_send_failed' });
  }
};
