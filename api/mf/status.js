// GET /api/mf/status
// MF接続状態を返す（mf_tokensにrefresh_tokenがあるか）。ログイン必須。
'use strict';

const { fetchTokenRow } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ connected: false, error: 'method_not_allowed' });
    return;
  }
  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ connected: false, error: 'unauthorized' });
    return;
  }
  try {
    const row = await fetchTokenRow();
    const connected = !!(row && row.refresh_token);
    res.status(200).json({ connected });
  } catch (e) {
    // ステータス確認自体の失敗は未接続扱いにはせず、明示的にエラーを返す
    res.status(500).json({ connected: false, error: 'status_check_failed' });
  }
};
