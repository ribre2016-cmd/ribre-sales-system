// GET /api/mf/auth/start
// MF認可URLを組み立てて返す。フロントはこのURLへlocation.href遷移する。
// - ログイン必須（Supabaseアクセストークン検証）。第三者が本番のMF接続先を
//   すり替えるのを防ぐ。MF_ADMIN_EMAILS（カンマ区切り・任意）を設定すると
//   そのメールアドレスのユーザーだけに制限できる。
// - state: HMAC署名付き（鍵=MF_CLIENT_SECRET・有効10分）。同じ値を
//   HttpOnly/Secure/SameSite=Lax Cookieにも保存し、callbackで両方を検証する
//   （サーバー側ストレージ不要のdouble-submit方式＋自己検証トークン）。
'use strict';

const crypto = require('crypto');
const { MF_AUTHORIZE_URL, MF_SCOPE } = require('../_lib/mf-client');
const { verifySupabaseToken } = require('../../openai/_lib/require-auth');

const STATE_TTL_MS = 10 * 60 * 1000;

function signState(payload) {
  return crypto.createHmac('sha256', process.env.MF_CLIENT_SECRET || '').update(payload).digest('hex');
}

function buildState() {
  const exp = Date.now() + STATE_TTL_MS;
  const nonce = crypto.randomBytes(16).toString('hex');
  const payload = exp + '.' + nonce;
  return payload + '.' + signState(payload);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  // 任意の管理者制限（未設定ならログインユーザー全員が接続操作可能）
  const admins = String(process.env.MF_ADMIN_EMAILS || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (admins.length && admins.indexOf(String(user.email || '').toLowerCase()) < 0) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }
  try {
    const state = buildState();

    const params = new URLSearchParams({
      client_id: process.env.MF_CLIENT_ID,
      redirect_uri: process.env.MF_REDIRECT_URI,
      response_type: 'code',
      scope: MF_SCOPE,
      state,
    });

    // Path=/api/mf/auth に限定（callbackにだけ送られる）。Max-Age=stateの有効期限と同じ。
    res.setHeader('Set-Cookie',
      'mf_oauth_state=' + encodeURIComponent(state) +
      '; HttpOnly; Secure; SameSite=Lax; Path=/api/mf/auth; Max-Age=' + Math.floor(STATE_TTL_MS / 1000));
    res.status(200).json({ url: `${MF_AUTHORIZE_URL}?${params.toString()}` });
  } catch (e) {
    res.status(500).json({ error: 'auth_start_failed' });
  }
};
