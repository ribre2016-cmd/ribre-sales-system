// POST /api/mf/evidence-action
// 台帳の証憑1件に対する操作をまとめたエンドポイント（Vercel Hobbyの12関数制限対応で統合）。
// body: { action: 'resend' | 'delete', evidence_id }
//  - resend: failed=再送、pending=メール取込の承認送信（Storageの控えからMFクラウドBoxへ送る）
//  - delete: pending/failed の行を削除（承認制の却下操作）。MF送信済みの行は削除不可
'use strict';

const { getAccessToken, postVoucher, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { fetchEvidenceById, fetchStorageFileBase64, updateEvidence } = require('./_lib/mf-match-core');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MF_STORAGE_BUCKET = 'mf-evidence';

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
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

async function handleResend(res, evidence) {
  if (['failed', 'pending'].indexOf(evidence.status) < 0 || !evidence.storage_path) {
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
      // 記録失敗はログのみ
    }
    res.status(502).json({ ok: false, error: 'mf_send_failed' });
  }
}

// Storageの控えファイルを返す（台帳からのプレビュー用）。バケットは非公開のためサーバー経由で取得する。
async function handlePreview(res, evidence) {
  if (!evidence.storage_path) {
    res.status(400).json({ ok: false, error: 'no_storage_path' });
    return;
  }
  try {
    const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${evidence.storage_path}`, {
      headers: supabaseHeaders(),
    });
    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await fileRes.arrayBuffer();
    res.status(200).json({
      ok: true,
      content_type: contentType,
      file_name: evidence.file_name || 'evidence',
      file_data: Buffer.from(arrayBuffer).toString('base64'),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'preview_failed' });
  }
}

async function handleDelete(res, evidence) {
  if (['pending', 'failed'].indexOf(evidence.status) < 0) {
    res.status(400).json({ ok: false, error: 'not_deletable' });
    return;
  }

  try {
    // Storageの控えファイルも削除（失敗しても行削除は続行）
    if (evidence.storage_path) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${evidence.storage_path}`, {
        method: 'DELETE',
        headers: supabaseHeaders(),
      }).catch(() => null);
    }

    const del = await fetch(`${SUPABASE_URL}/rest/v1/mf_evidence?id=eq.${encodeURIComponent(evidence.id)}`, {
      method: 'DELETE',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    });
    if (!del.ok) throw new Error(`HTTP ${del.status}`);

    res.status(200).json({ ok: true, evidence_id: evidence.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
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

  const action = body && body.action;
  const evidenceId = body && body.evidence_id;
  if (!evidenceId || ['resend', 'delete', 'preview'].indexOf(action) < 0) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }

  let evidence;
  try {
    evidence = await fetchEvidenceById(evidenceId);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'evidence_fetch_failed' });
    return;
  }
  if (!evidence) {
    res.status(404).json({ ok: false, error: 'evidence_not_found' });
    return;
  }

  if (action === 'resend') {
    await handleResend(res, evidence);
  } else if (action === 'preview') {
    await handlePreview(res, evidence);
  } else {
    await handleDelete(res, evidence);
  }
};
