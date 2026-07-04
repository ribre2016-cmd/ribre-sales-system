// POST /api/openai/responses
// ブラウザからのOCRリクエストをOpenAI /v1/responses へ転送する薄いプロキシ。
// APIキーはサーバー側の環境変数のみで扱い、ブラウザには一切渡さない。
'use strict';

const { verifySupabaseToken } = require('./_lib/require-auth');

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10MB
// 悪用時の高額請求を防ぐため、利用可能モデルを限定する
const ALLOWED_MODELS = ['gpt-4.1-mini'];

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      // Vercelが既にパース済みの場合
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

  if (!body || ALLOWED_MODELS.indexOf(body.model) < 0) {
    res.status(400).json({ error: 'model_not_allowed' });
    return;
  }

  try {
    const upstream = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(502).json({ error: 'upstream_request_failed' });
  }
};
