// GET /api/mf/auth/start
// MF認可URLを組み立てて返す。フロントはこのURLへlocation.href遷移する。
'use strict';

const { MF_AUTHORIZE_URL, MF_SCOPE } = require('../_lib/mf-client');

module.exports = async (req, res) => {
  try {
    // state: CSRF対策のランダム値。
    // NOTE: 本来はセッション/Cookie等に保存しcallback側で検証すべきだが、
    // 今回はサーバーレス関数間で状態を共有する仕組みが未整備のため検証は省略している。
    const state = Math.random().toString(36).slice(2) + Date.now().toString(36);

    const params = new URLSearchParams({
      client_id: process.env.MF_CLIENT_ID,
      redirect_uri: process.env.MF_REDIRECT_URI,
      response_type: 'code',
      scope: MF_SCOPE,
      state,
    });

    res.status(200).json({ url: `${MF_AUTHORIZE_URL}?${params.toString()}` });
  } catch (e) {
    res.status(500).json({ error: 'auth_start_failed' });
  }
};
