// GET /api/mf/auth/callback?code=...
// 認可コードをトークンに交換しmf_tokensへ保存後、mf-evidence.htmlへリダイレクト
'use strict';

const { exchangeCodeForToken, saveTokenRow } = require('../_lib/mf-client');

module.exports = async (req, res) => {
  try {
    const code = req.query && req.query.code;
    if (!code) {
      res.writeHead(302, { Location: '/mf-evidence.html?mf_error=token_exchange_failed' });
      res.end();
      return;
    }

    const token = await exchangeCodeForToken(code);
    const expiresAt = new Date(Date.now() + (token.expires_in || 3600) * 1000).toISOString();

    await saveTokenRow({
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_at: expiresAt,
    });

    // code等の詳細はレスポンス/URLに含めない
    res.writeHead(302, { Location: '/mf-evidence.html?connected=1' });
    res.end();
  } catch (e) {
    // エラー詳細文字列はURLに含めない
    res.writeHead(302, { Location: '/mf-evidence.html?mf_error=token_exchange_failed' });
    res.end();
  }
};
