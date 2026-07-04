// OpenAIプロキシ共通の認証チェック。
// ブラウザから送られたSupabaseアクセストークン(Authorization: Bearer)を
// Supabase Authに問い合わせて検証する。未ログインの外部者による
// プロキシ悪用（OpenAIクォータ盗用）を防ぐ。
'use strict';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 有効なログインユーザーならuserオブジェクト、無効ならnullを返す
async function verifySupabaseToken(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) return null;
    const user = await res.json().catch(() => null);
    return user && user.id ? user : null;
  } catch (e) {
    return null;
  }
}

module.exports = { verifySupabaseToken };
