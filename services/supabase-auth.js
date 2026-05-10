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
  const s = res.data || {};
  s.email = e;
  s.role = r;
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
