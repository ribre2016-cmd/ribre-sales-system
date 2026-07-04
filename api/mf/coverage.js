// GET /api/mf/coverage?month=YYYY-MM
// 指定月（省略時は当月）のMF仕訳に対する証憑カバー率を集計して返す
'use strict';

const { getAccessToken, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { computeCoverage } = require('./_lib/mf-coverage');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // ログイン済みユーザーのみ利用可
  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
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

  const month = req.query && req.query.month;

  try {
    const result = await computeCoverage({ accessToken, month });
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: 'mf_coverage_failed',
      message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
    });
  }
};
