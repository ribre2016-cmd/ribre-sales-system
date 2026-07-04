// GET /api/mf/status
// MF接続状態を返す（mf_tokensにrefresh_tokenがあるか）
'use strict';

const { fetchTokenRow } = require('./_lib/mf-client');

module.exports = async (req, res) => {
  try {
    const row = await fetchTokenRow();
    const connected = !!(row && row.refresh_token);
    res.status(200).json({ connected });
  } catch (e) {
    // ステータス確認自体の失敗は未接続扱いにはせず、明示的にエラーを返す
    res.status(500).json({ connected: false, error: 'status_check_failed' });
  }
};
