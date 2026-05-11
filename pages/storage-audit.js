/* RIBRE — Storage audit split (ver550) */

/* RIBRE — Storage/Cloud pages 移行（Phase6: ver550 の最終定義を pages 側へ集約） */
function ver550Render(rows) {
  const box = document.getElementById('audit55List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 700)
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver550Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver550Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver550Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver550Email() {
  const s = ver550Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver550Device() {
  return localStorage.getItem('ribre_device_name540') || navigator.userAgent.slice(0, 40) || 'unknown';
}
function ver550Headers(extra = {}) {
  const c = ver550Config(),
    s = ver550Session();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (token || c.key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    extra
  );
}
async function ver550Rest(table, query = '', method = 'GET', body = null) {
  const c = ver550Config();
  if (!c.url || !c.key) return { error: { message: 'Supabase設定なし' } };
  const s = ver550Session();
  const token = s.access_token || (s.session && s.session.access_token) || '';
  if ((table === 'sync_logs' || table === 'audit_logs') && !token) {
    return { error: { message: '再ログインしてください' }, authRequired: true, status: 401 };
  }
  try {
    const res = await fetch(c.url.replace(/\/$/, '') + '/rest/v1/' + table + query, {
      method: method,
      headers: ver550Headers(),
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) {
      if (res.status === 401) {
        return { error: { message: '再ログインしてください' }, authRequired: true, status: 401 };
      }
      return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    }
    return { data: data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
function ver550Local() {
  try {
    return JSON.parse(localStorage.getItem('ribre_audit_logs550') || '[]');
  } catch (e) {
    return [];
  }
}
function ver550SlimLog(x) {
  const src = x && typeof x === 'object' ? x : {};
  const out = {
    user_email: src.user_email || '',
    device_name: src.device_name || '',
    action_type: src.action_type || '',
    action_detail: src.action_detail || '',
    target_table: src.target_table || '',
    target_id: src.target_id || '',
    created_at: src.created_at || new Date().toISOString()
  };
  if ('before_json' in src) out.before_json = null;
  if ('after_json' in src) out.after_json = null;
  return out;
}
function ver550SaveLocal(arr) {
  const isQuota = (e) => !!(e && (e.name === 'QuotaExceededError' || e.code === 22 || String(e.message || '').includes('quota')));
  const rows = (arr || []).map(ver550SlimLog).slice(0, 200);
  const save = (n) => localStorage.setItem('ribre_audit_logs550', JSON.stringify(n === 0 ? [] : rows.slice(0, n)));
  try {
    save(200);
  } catch (e) {
    if (!isQuota(e)) return;
    try {
      save(100);
    } catch (e2) {
      if (!isQuota(e2)) return;
      try {
        save(50);
      } catch (e3) {
        save(0);
      }
    }
    ver550Set('ver550Status', '容量調整');
    ver550Render([{ type: '容量', level: 'warn', msg: '保存容量がいっぱいです。古いログを削除しました' }]);
  }
}
function ver550Sql() {
  return `create table if not exists audit_logs (
  id bigint generated always as identity primary key,
  user_email text,
  device_name text,
  action_type text,
  action_detail text,
  target_table text,
  target_id text,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz default now()
);

alter table audit_logs enable row level security;

drop policy if exists "audit_logs_select" on audit_logs;
create policy "audit_logs_select"
on audit_logs
for select
using (auth.email() = user_email);

drop policy if exists "audit_logs_insert" on audit_logs;
create policy "audit_logs_insert"
on audit_logs
for insert
with check (auth.email() = user_email);

create index if not exists audit_logs_user_created_idx
on audit_logs (user_email, created_at desc);

create index if not exists audit_logs_action_idx
on audit_logs (action_type);`;
}
function ver550ShowSql() {
  ver550Render([{ type: 'SQL', msg: ver550Sql().replace(/\n/g, ' / ') }]);
}
function ver550ExportSql() {
  const blob = new Blob([ver550Sql()], { type: 'text/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_audit_logs_Ver55_0.sql';
  a.click();
}
async function ver550CreateLog(action, detail, targetTable = '', targetId = '', beforeObj = null, afterObj = null) {
  const email = ver550Email();
  const log = {
    user_email: email || '未ログイン',
    device_name: ver550Device(),
    action_type: action,
    action_detail: detail,
    target_table: targetTable,
    target_id: targetId,
    before_json: null,
    after_json: null,
    created_at: new Date().toISOString()
  };
  const local = ver550Local();
  local.unshift(log);
  ver550SaveLocal(local);
  ver550Set('ver550LocalCount', ver550Local().length + '件');
  ver550Set('ver550User', email || '未ログイン');

  if (email) {
    const r = await ver550Rest('audit_logs', '', 'POST', [log]);
    if (r.error) {
      if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
        ver550Set('ver550Status', '再ログイン必要');
        ver550Render([{ type: '認証', level: 'warn', msg: '再ログインしてください' }]);
        return;
      }
      ver550Set('ver550Status', '端末保存のみ');
      ver550Render([{ type: '注意', level: 'warn', msg: '端末ログには保存しました。本番ログ保存エラー: ' + r.error.message }]);
      return;
    }
  }
  ver550Set('ver550Status', '記録OK');
  ver550Render([{ type: action, msg: detail + ' / ' + (email || '未ログイン') }]);
}
async function ver550LoadLogs() {
  const email = ver550Email();
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  const r = await ver550Rest('audit_logs', '?select=*&user_email=eq.' + encodeURIComponent(email) + '&order=created_at.desc&limit=1000');
  if (r.error) {
    if (r.authRequired || String(r.error.message || '').includes('再ログインしてください')) {
      ver550Set('ver550Status', '再ログイン必要');
      ver550Render([{ type: '認証', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver550Set('ver550Status', 'エラー');
    ver550Render([
      { type: 'ERROR', level: 'danger', msg: r.error.message },
      { type: '確認', level: 'warn', msg: '先にログSQLをSupabase SQL Editorで実行してください' }
    ]);
    return;
  }
  localStorage.setItem('ribre_audit_prod550', JSON.stringify(r.data || []));
  ver550Set('ver550ProdCount', (r.data || []).length + '件');
  ver550Set('ver550Status', '読込OK');
  ver550Render(
    (r.data || []).map((x) => ({
      type: x.action_type || 'LOG',
      msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
    }))
  );
}
function ver550ShowLocalLogs() {
  const rows = ver550Local();
  ver550Set('ver550LocalCount', rows.length + '件');
  ver550Render(
    rows.length
      ? rows.map((x) => ({
          type: x.action_type || 'LOG',
          msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
        }))
      : [{ type: 'INFO', level: 'warn', msg: '端末ログはありません' }]
  );
}
function ver550FilterLogs() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_audit_prod550') || '[]');
  } catch (e) {}
  if (!rows.length) rows = ver550Local();
  const kw = (document.getElementById('ver550Filter').value || '').toLowerCase();
  const type = document.getElementById('ver550Type').value;
  if (type) rows = rows.filter((x) => String(x.action_type || '').includes(type));
  if (kw) rows = rows.filter((x) => [x.user_email, x.device_name, x.action_type, x.action_detail, x.target_table, x.target_id].join(' ').toLowerCase().includes(kw));
  ver550Render(
    rows.map((x) => ({
      type: x.action_type || 'LOG',
      msg: (x.created_at || '').replace('T', ' ').slice(0, 19) + ' / ' + (x.user_email || '') + ' / ' + (x.device_name || '') + ' / ' + (x.action_detail || '')
    }))
  );
}
function ver550ExportCsv() {
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_audit_prod550') || '[]');
  } catch (e) {}
  if (!rows.length) rows = ver550Local();
  const csv = [['日時', 'ユーザー', '端末', '操作', '内容', '対象テーブル', '対象ID']];
  rows.forEach((x) => csv.push([x.created_at, x.user_email, x.device_name, x.action_type, x.action_detail, x.target_table, x.target_id]));
  csvDownload(csv, 'audit_logs_Ver55_0.csv');
}
function ver550WrapFunctions() {
  const targets = [
    ['ver500SaveToProduction', 'AI', 'AI自動登録を本番DBへ保存'],
    ['ver490Upload', 'Storage', 'Storageへファイル保存'],
    ['ver540ManualSync', '同期', '手動同期'],
    ['ver540Push', '同期', '端末→本番'],
    ['ver540Pull', '同期', '本番→端末'],
    ['ver530DownloadJson', 'バックアップ', 'JSONバックアップ保存'],
    ['ver530CreateBackup', 'バックアップ', 'バックアップ作成'],
    ['ver450UpsertAll', '売上', '重複防止まとめて更新保存']
  ];
  targets.forEach(([name, type, detail]) => {
    if (typeof window[name] === 'function' && !window['__ver550_' + name]) {
      const old = window[name];
      window[name] = async function () {
        const result = await old.apply(this, arguments);
        Promise.resolve(ver550CreateLog(type, detail)).catch(() => {});
        return result;
      };
      window['__ver550_' + name] = true;
    }
  });
}

window.ver550Render = ver550Render;
window.ver550Set = ver550Set;
window.ver550Config = ver550Config;
window.ver550Session = ver550Session;
window.ver550Email = ver550Email;
window.ver550Device = ver550Device;
window.ver550Headers = ver550Headers;
window.ver550Rest = ver550Rest;
window.ver550Local = ver550Local;
window.ver550SaveLocal = ver550SaveLocal;
window.ver550Sql = ver550Sql;
window.ver550ShowSql = ver550ShowSql;
window.ver550ExportSql = ver550ExportSql;
window.ver550CreateLog = ver550CreateLog;
window.ver550LoadLogs = ver550LoadLogs;
window.ver550ShowLocalLogs = ver550ShowLocalLogs;
window.ver550FilterLogs = ver550FilterLogs;
window.ver550ExportCsv = ver550ExportCsv;
window.ver550WrapFunctions = ver550WrapFunctions;

window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      if (window.__ver550InitDone) return;
      window.__ver550InitDone = true;
      ver550Set('ver550User', ver550Email() || '未ログイン');
      ver550Set('ver550LocalCount', ver550Local().length + '件');
      ver550WrapFunctions();
    } catch (e) {}
  }, 1500);
});
