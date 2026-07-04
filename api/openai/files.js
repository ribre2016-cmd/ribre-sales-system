// POST /api/openai/files
// ブラウザから受け取ったファイル(base64)をOpenAI /v1/files へ multipart/form-data で転送する薄いプロキシ。
// APIキーはサーバー側の環境変数のみで扱い、ブラウザには一切渡さない。
'use strict';

const { verifySupabaseToken } = require('./_lib/require-auth');

const OPENAI_FILES_URL = 'https://api.openai.com/v1/files';
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
          const err = new Error('payload_too_large');
          err.tooLarge = true;
          reject(err);
          return;
        }
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
    let bytes = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('payload_too_large');
        err.tooLarge = true;
        reject(err);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
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
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'server_not_configured' });
    return;
  }

  // ログイン済みユーザーのみ利用可（プロキシ悪用防止）
  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    if (e && e.tooLarge) {
      res.status(413).json({ error: 'payload_too_large' });
      return;
    }
    res.status(400).json({ error: 'invalid_json' });
    return;
  }

  // 既存の uploadOpenAIFile() が送っていた形式: { purpose, file_name, file_data(base64), content_type }
  const { purpose, file_name, file_data, content_type } = body || {};
  if (!file_data || typeof file_data !== 'string') {
    res.status(400).json({ error: 'file_data_required' });
    return;
  }

  let fileBuffer;
  try {
    fileBuffer = Buffer.from(file_data, 'base64');
  } catch (e) {
    res.status(400).json({ error: 'invalid_file_data' });
    return;
  }
  if (!fileBuffer.length) {
    res.status(400).json({ error: 'invalid_file_data' });
    return;
  }

  try {
    const fd = new FormData();
    fd.append('purpose', purpose || 'user_data');
    const blob = new Blob([fileBuffer], { type: content_type || 'application/octet-stream' });
    fd.append('file', blob, file_name || 'evidence');

    const upstream = await fetch(OPENAI_FILES_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: fd,
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream_request_failed' });
  }
};
