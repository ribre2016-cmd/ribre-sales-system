/* =====================================================================
 * RIBRE Ver61.1 — Login Gate
 * 未ログイン時はアプリ全体をログイン画面で覆い、中身を見せない。
 * ログアウト時は端末キャッシュ(売上/仕入など)も消去して何も残さない。
 * ※ 静的サイトのため画面ガードは完全防御ではない。本当の防御は Supabase RLS。
 * 依存: core.js(email), supabase-auth.js(signIn/signOut), app-simple.js(smpGoogleLogin/smpLogout), data-store.js(ribreStore.clearCache)
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__ribreGateBooted) return;
  window.__ribreGateBooted = true;

  function tokenValid() {
    try {
      var s = (typeof sess === 'function') ? sess() : {};
      var t = s.access_token || (s.session && s.session.access_token) || '';
      if (!t) return false; // トークン無し＝未ログイン
      var parts = String(t).split('.');
      if (parts.length < 2) return true; // 非JWTは判定不能→有効扱い(誤締め出し回避)
      var b = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      while (b.length % 4) b += '=';
      var payload = JSON.parse(decodeURIComponent(escape(atob(b))));
      if (payload && payload.exp) return (payload.exp * 1000) > Date.now(); // 期限切れ＝未ログイン
      return true;
    } catch (e) { return true; }
  }
  function isLoggedIn() {
    try { if (!(typeof email === 'function' && email())) return false; } catch (e) { return false; }
    return tokenValid();
  }

  function buildOverlay() {
    if (document.getElementById('ribreLoginGate')) return;
    var o = document.createElement('div');
    o.id = 'ribreLoginGate';
    o.setAttribute('style', [
      'position:fixed', 'inset:0', 'z-index:2147483600',
      'background:linear-gradient(160deg,#1d4ed8,#1e3a8a)', 'color:#fff',
      'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:system-ui,-apple-system,"Segoe UI",sans-serif', 'padding:20px'
    ].join(';'));
    o.innerHTML =
      '<div style="width:100%;max-width:380px;background:#fff;color:#1f2937;border-radius:16px;padding:28px 24px;box-shadow:0 20px 60px rgba(0,0,0,.3)">' +
        '<div style="font-size:22px;font-weight:800;color:#1d4ed8;margin-bottom:4px">RIBRE 売上管理</div>' +
        '<div style="font-size:13px;color:#6b7280;margin-bottom:20px">ご利用にはログインが必要です</div>' +
        '<button id="gateGoogle" style="width:100%;padding:12px;border:1px solid #dadce0;border-radius:10px;background:#fff;color:#1f2937;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:16px">🔵 Googleでログイン</button>' +
        '<div style="display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:12px;margin:8px 0 14px"><span style="flex:1;height:1px;background:#e5e7eb"></span>または メールでログイン<span style="flex:1;height:1px;background:#e5e7eb"></span></div>' +
        '<input id="gateEmail" type="email" placeholder="メールアドレス" autocomplete="username" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #d1d5db;border-radius:10px;margin-bottom:10px;font-size:15px">' +
        '<input id="gatePass" type="password" placeholder="パスワード" autocomplete="current-password" style="width:100%;box-sizing:border-box;padding:11px;border:1px solid #d1d5db;border-radius:10px;margin-bottom:14px;font-size:15px">' +
        '<button id="gateEmailLogin" style="width:100%;padding:12px;border:0;border-radius:10px;background:#16a34a;color:#fff;font-size:15px;font-weight:700;cursor:pointer">ログイン</button>' +
        '<div id="gateMsg" style="margin-top:14px;font-size:13px;color:#b91c1c;min-height:18px"></div>' +
      '</div>';
    document.body.appendChild(o);

    document.getElementById('gateGoogle').addEventListener('click', function () {
      gateMsg('Googleに移動します…', '#2563eb');
      if (typeof window.smpGoogleLogin === 'function') window.smpGoogleLogin();
      else gateMsg('Googleログインが利用できません。メールでログインしてください。');
    });
    document.getElementById('gateEmailLogin').addEventListener('click', doEmailLogin);
    document.getElementById('gatePass').addEventListener('keydown', function (e) { if (e.key === 'Enter') doEmailLogin(); });
  }

  function gateMsg(t, color) {
    var el = document.getElementById('gateMsg');
    if (el) { el.textContent = t || ''; el.style.color = color || '#b91c1c'; }
  }

  async function doEmailLogin() {
    var e = (document.getElementById('gateEmail').value || '').trim();
    var p = (document.getElementById('gatePass').value || '').trim();
    if (!e || !p) { gateMsg('メールとパスワードを入力してください'); return; }
    gateMsg('ログイン中…', '#2563eb');
    try {
      // 既存のログインフォーム(#email/#password/#role)に値を渡して signIn() を実行
      var se = document.getElementById('email'); if (se) se.value = e;
      var sp = document.getElementById('password'); if (sp) sp.value = p;
      var sr = document.getElementById('role'); if (sr && !sr.value) sr.value = 'staff';
      if (typeof window.signIn === 'function') { await window.signIn(); }
      else { gateMsg('ログイン機能が見つかりません'); return; }
    } catch (err) { gateMsg('ログインに失敗しました'); return; }
    setTimeout(function () {
      if (isLoggedIn()) { gateMsg(''); update(); }
      else gateMsg('ログインできませんでした（メール／パスワードをご確認ください）');
    }, 600);
  }

  function update() {
    var o = document.getElementById('ribreLoginGate');
    if (!o) return;
    o.style.display = isLoggedIn() ? 'none' : 'flex';
  }

  // ログアウトをフックして、キャッシュ消去 + ゲート表示
  function wrapLogout(name) {
    if (typeof window[name] === 'function' && !window['__gateWrap_' + name]) {
      var orig = window[name];
      window[name] = function () {
        var r = orig.apply(this, arguments);
        try { if (window.ribreStore && typeof window.ribreStore.clearCache === 'function') window.ribreStore.clearCache(); } catch (e) {}
        setTimeout(update, 50);
        return r;
      };
      window['__gateWrap_' + name] = true;
    }
  }

  function boot() {
    buildOverlay();
    update();
    wrapLogout('signOut');
    wrapLogout('smpLogout');
    // ログイン状態の変化を監視（Googleリダイレクト/各種ログイン経路に対応）
    setInterval(update, 1000);
  }

  var __booted = false;
  function bootNow() { if (__booted) return; __booted = true; try { boot(); } catch (e) {} }
  // 起動直後のちらつき防止：DOM準備でき次第すぐにログイン画面を出す（未ログインなら必ず表示）
  if (document.readyState !== 'loading') bootNow();
  else document.addEventListener('DOMContentLoaded', bootNow);
  window.addEventListener('load', bootNow);
})();
