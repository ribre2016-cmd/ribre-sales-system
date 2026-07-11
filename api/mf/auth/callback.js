// GET /api/mf/auth/callback?code=...&state=...
// stateを検証（Cookie一致＋HMAC署名＋有効期限）してから認可コードをトークンに
// 交換しmf_tokensへ保存、mf-evidence.htmlへリダイレクトする。
// state不一致・期限切れ・欠落時はトークン交換を行わない（CSRF/アカウント差し替え防止）。
'use strict';

const crypto = require('crypto');
const { exchangeCodeForToken, saveTokenRow } = require('../_lib/mf-client');

function signState(payload) {
  return crypto.createHmac('sha256', process.env.MF_CLIENT_SECRET || '').update(payload).digest('hex');
}

function timingSafeEq(a, b) {
  const ba = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// state 形式: "<expMs>.<nonce>.<hmac>"。署名・期限・Cookie一致をすべて確認する。
function verifyState(queryState, cookieState) {
  if (!queryState || !cookieState) return false;
  if (!timingSafeEq(queryState, cookieState)) return false;
  const parts = String(queryState).split('.');
  if (parts.length !== 3) return false;
  const payload = parts[0] + '.' + parts[1];
  if (!timingSafeEq(parts[2], signState(payload))) return false;
  const exp = Number(parts[0]);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  return true;
}

function readStateCookie(req) {
  const raw = (req.headers && req.headers.cookie) || '';
  const m = /(?:^|;\s*)mf_oauth_state=([^;]+)/.exec(raw);
  return m ? decodeURIComponent(m[1]) : '';
}

function redirect(res, path) {
  // 検証済みCookieは常に削除する（成功・失敗どちらでも再利用させない）
  res.setHeader('Set-Cookie', 'mf_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/mf/auth; Max-Age=0');
  res.writeHead(302, { Location: path });
  res.end();
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  try {
    const code = req.query && req.query.code;
    const state = req.query && req.query.state;
    if (!verifyState(state, readStateCookie(req))) {
      // stateが検証できない要求ではトークン交換・保存を一切行わない
      redirect(res, '/mf-evidence.html?mf_error=state_invalid');
      return;
    }
    if (!code) {
      redirect(res, '/mf-evidence.html?mf_error=token_exchange_failed');
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
    redirect(res, '/mf-evidence.html?connected=1');
  } catch (e) {
    // エラー詳細文字列はURLに含めない
    redirect(res, '/mf-evidence.html?mf_error=token_exchange_failed');
  }
};
