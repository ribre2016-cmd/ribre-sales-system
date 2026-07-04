// POST /api/mf/match
// 登録済みMF仕訳への自動マッチング添付（Phase2）
// - ボディ空/{} : 自動モード。box_saved状態の証憑を仕訳と自動マッチングして添付する
// - {evidence_id, journal_id} : 手動確定モード。候補が複数だった証憑を指定仕訳へ添付する
// 実処理は _lib/mf-match-core.js に切り出し済み（本ファイルは認証＋HTTP入出力のみ担当）。
'use strict';

const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { getAccessToken, NotConnectedError, runAutoMatch, runManualMatch } = require('./_lib/mf-match-core');

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        try {
          resolve(req.body ? JSON.parse(req.body) : {});
        } catch (e) {
          reject(e);
        }
      } else {
        resolve(req.body || {});
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

  // ログイン済みユーザーのみ利用可（第三者による添付操作を防止）
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

  const evidenceId = body && body.evidence_id;
  const journalId = body && body.journal_id;

  try {
    if (evidenceId && journalId) {
      const result = await runManualMatch({ accessToken, evidenceId, journalId });
      res.status(result.status).json(result.body);
      return;
    }
    const result = await runAutoMatch(accessToken);
    res.status(200).json(result);
  } catch (e) {
    res.status(502).json({ ok: false, error: 'mf_match_failed', message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error' });
  }
};
