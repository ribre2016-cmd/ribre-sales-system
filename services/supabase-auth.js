/* RIBRE — Supabase Auth API（Phase2 続き: index.html から分離。ロジックは同一） */
function authBase(path) {
  const c = sb();
  if (!c.url || !c.key) {
    alert('Supabase設定してください');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/auth/v1/' + path;
}
async function authFetch(path, body) {
  const c = sb();
  const u = authBase(path);
  if (!u) return { error: { message: '設定なし' } };
  try {
    const res = await fetch(u, {
      method: 'POST',
      headers: { apikey: c.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok)
      return { error: { message: (data && data.msg) || (data && data.message) || text } };
    return { data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
/* Supabaseの生レスポンス(トップレベル or {session:{...}}形式)を signIn()/refresh共通の
 * セッション形式へ正規化する。email/roleはレスポンスに含まれないことがある
 * （refresh_tokenの応答等）ため、呼び出し側が保存済みの値をfallbackとして渡す。 */
function ribreNormalizeSession(raw, fallbackEmail, fallbackRole) {
  raw = raw || {};
  return {
    access_token: raw.access_token || (raw.session && raw.session.access_token) || '',
    refresh_token: raw.refresh_token || (raw.session && raw.session.refresh_token) || '',
    token_type: raw.token_type || (raw.session && raw.session.token_type) || 'bearer',
    expires_at: raw.expires_at || (raw.session && raw.session.expires_at) || 0,
    expires_in: raw.expires_in || (raw.session && raw.session.expires_in) || 0,
    user: raw.user || (raw.session && raw.session.user) || null,
    email: fallbackEmail || '',
    role: fallbackRole || ''
  };
}
async function signUp() {
  const e = document.getElementById('email').value.trim(),
    p = document.getElementById('password').value.trim(),
    r = document.getElementById('role').value;
  if (!e || !p) {
    alert('メールとパスワードを入力');
    return;
  }
  const res = await authFetch('signup', { email: e, password: p, data: { role: r } });
  renderList('settingsList', [
    {
      type: res.error ? 'ERROR' : 'OK',
      level: res.error ? 'danger' : 'ok',
      msg: res.error ? res.error.message : '登録しました。ログインしてください'
    }
  ]);
}
async function signIn() {
  const e = document.getElementById('email').value.trim(),
    p = document.getElementById('password').value.trim(),
    r = document.getElementById('role').value;
  if (!e || !p) {
    alert('メールとパスワードを入力');
    return;
  }
  const res = await authFetch('token?grant_type=password', { email: e, password: p });
  if (res.error) {
    renderList('settingsList', [{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  const s = ribreNormalizeSession(res.data, e, r);
  setLS(LS.sess, s);
  localStorage.setItem('ribre_current_user140', e);
  localStorage.setItem('ribre_current_role140', r);
  refreshAll();
  renderList('settingsList', [{ type: 'OK', msg: 'ログインしました：' + e }]);
}
function signOut() {
  localStorage.removeItem(LS.sess);
  localStorage.removeItem('ribre_current_user140');
  localStorage.removeItem('ribre_current_role140');
  refreshAll();
  renderList('settingsList', [{ type: 'OK', msg: 'ログアウトしました' }]);
}

/* =====================================================================
 * セッション自動更新（Auto Refresh）
 * これまでrefresh_tokenでの更新を一切行っていなかったため、約1時間で
 * セッションが切れ、REST呼び出しが401→auth-gateが画面を覆う→再ログインを
 * 強いられていた（期限直前の編集が401→再ログインのhydrateで消えることもあった）。
 * ここでは (1) いつでも呼べる ribreRefreshSession() と、(2) 期限が近づいたら
 * それを自動で呼ぶタイマーを用意する。失敗しても既存セッションは絶対に
 * 消さない・自動ログアウトもしない（401時の既存ハンドリングに委ねる）。
 * ===================================================================== */
var __ribreRefreshInFlight = null;

/* 同時に複数箇所（5分タイマー／auth-gate／将来の呼び出し元）から呼ばれても
 * ネットワークリクエストは1回だけにするため、進行中のPromiseを使い回す。 */
function ribreRefreshSession() {
  if (__ribreRefreshInFlight) return __ribreRefreshInFlight;
  __ribreRefreshInFlight = (async function () {
    try {
      var cur = get(LS.sess, {});
      if (!cur || !cur.refresh_token) return null; // 未ログイン・更新トークン無し→何もしない
      var startToken = cur.access_token || '';
      var res = await authFetch('token?grant_type=refresh_token', { refresh_token: cur.refresh_token });
      if (res.error) {
        // 無効/失効した refresh_token 等。ここで勝手にログアウトさせない
        // （既存セッションはそのまま残し、401が出たら既存の再ログイン導線に任せる）。
        console.warn('[ribreRefreshSession] セッション更新に失敗しました:', res.error.message);
        return null;
      }
      var next = ribreNormalizeSession(res.data, cur.email, cur.role);
      // マルチタブ対策: 書き込み直前に最新のLS.sessを読み直し、他タブが
      // 自分より先にリフレッシュ済みなら自分の結果は捨てて最新の方を返す。
      var latest = get(LS.sess, {});
      if (latest && latest.access_token && latest.access_token !== startToken) {
        return latest;
      }
      setLS(LS.sess, next);
      return next;
    } catch (e) {
      console.warn('[ribreRefreshSession] 例外:', e && e.message);
      return null;
    } finally {
      __ribreRefreshInFlight = null;
    }
  })();
  return __ribreRefreshInFlight;
}
window.ribreRefreshSession = ribreRefreshSession;

var RIBRE_REFRESH_MARGIN_SEC = 600; // 期限の10分前から更新を試みる
var RIBRE_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5分ごとにチェック
var RIBRE_REFRESH_FALLBACK_MS = 60 * 60 * 1000; // expires_atが無い旧形式セッション用の保険（1時間毎）

/* expires_at(unix秒)を見て、期限が近ければ ribreRefreshSession() を呼ぶ。
 * セッションが無いページ（未ログイン/ログイン画面のみ等）では何もしない。 */
function ribreMaybeRefresh() {
  try {
    var s = get(LS.sess, {});
    if (!s || !s.refresh_token) return;
    var expAt = Number(s.expires_at) || 0;
    var nowSec = Math.floor(Date.now() / 1000);
    if (expAt > 0) {
      if (expAt - nowSec <= RIBRE_REFRESH_MARGIN_SEC) ribreRefreshSession();
      return;
    }
    // expires_atが0/無い旧形式セッション: 正確な期限が分からないため、
    // 安全側に倒して1時間に1回だけ更新を試みる（expires_inからの推定はしない）。
    var lastTry = Number(localStorage.getItem('ribre_refresh_last_try_v1')) || 0;
    if (Date.now() - lastTry >= RIBRE_REFRESH_FALLBACK_MS) {
      localStorage.setItem('ribre_refresh_last_try_v1', String(Date.now()));
      ribreRefreshSession();
    }
  } catch (e) {}
}

(function ribreScheduleAutoRefresh() {
  if (window.__ribreRefreshScheduled) return; // 二重登録防止（複数ページ/複数回読込対策）
  window.__ribreRefreshScheduled = true;
  ribreMaybeRefresh(); // 読込時に1回
  setInterval(ribreMaybeRefresh, RIBRE_REFRESH_INTERVAL_MS);
})();
