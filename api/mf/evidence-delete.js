// POST /api/mf/evidence-delete
// メール取込などで台帳に入った「送信前(pending)」の証憑を削除する（承認制の却下操作）。
// 安全のため、MFへ送信済みの行(box_saved/attached)は削除できない。
'use strict';

const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { fetchEvidenceById } = require('./_lib/mf-match-core');

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

  if (!evidence) {
    res.status(404).json({ ok: false, error: 'evidence_not_found' });
    return;
  }
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

    const del = await fetch(`${SUPABASE_URL}/rest/v1/mf_evidence?id=eq.${encodeURIComponent(evidenceId)}`, {
      method: 'DELETE',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    });
    if (!del.ok) throw new Error(`HTTP ${del.status}`);

    res.status(200).json({ ok: true, evidence_id: evidenceId });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
};
