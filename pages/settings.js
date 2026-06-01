/* RIBRE — Settings pages 移行（Phase3: settings/permissions/staff の最終定義を pages 側へ集約） */
function saveSupabase() {
  const url = document.getElementById('sbUrl').value.trim();
  const key = document.getElementById('sbKey').value.trim();
  if (!url || !key) {
    alert('URLとkeyを入れてください');
    return;
  }
  setLS(LS.sb, { url, key });
  refreshAll();
  renderList('settingsList', [{ type: 'OK', msg: 'Supabase設定を保存しました' }]);
}
async function checkSupabase() {
  const r = await rest('sales', '?select=id&limit=1');
  document.getElementById('sbStatus').textContent = r.error ? 'エラー' : 'OK';
  renderList('settingsList', [
    {
      type: r.error ? 'ERROR' : 'OK',
      level: r.error ? 'danger' : 'ok',
      msg: r.error ? r.error.message : 'Supabase接続OK'
    }
  ]);
}
function saveOpenAI() {
  const k = document.getElementById('openaiKey').value.trim();
  if (!k) {
    alert('APIキーを入れてください');
    return;
  }
  let compacted = false;
  try {
    localStorage.setItem(LS.openai, k);
    localStorage.setItem('ribre_openai_key180', k);
  } catch (e) {
    if (!(e && e.name === 'QuotaExceededError')) throw e;
    localStorage.removeItem('ribre_ai_auto_candidates500');
    compacted = true;
    try {
      localStorage.setItem(LS.openai, k);
      localStorage.setItem('ribre_openai_key180', k);
    } catch (e2) {
      renderList('settingsList', [{ type: '容量', level: 'warn', msg: '保存容量がいっぱいです。古い候補を削除しました' }]);
      throw e2;
    }
  }
  document.getElementById('openaiKey').value = '';
  refreshAll();
  if (compacted) {
    renderList('settingsList', [
      { type: '容量', level: 'warn', msg: '保存容量がいっぱいです。古い候補を削除しました' },
      { type: 'OK', msg: 'OpenAI APIキーを保存しました' }
    ]);
    return;
  }
  renderList('settingsList', [{ type: 'OK', msg: 'OpenAI APIキーを保存しました' }]);
}

/* signUp / signIn / signOut は services/supabase-auth.js に一本化（重複定義を削除） */

function ver300Logs() {
  try {
    return JSON.parse(localStorage.getItem('ribre_action_logs300') || '[]');
  } catch (e) {
    return [];
  }
}
function ver300SaveLogs(arr) {
  localStorage.setItem('ribre_action_logs300', JSON.stringify(arr.slice(0, 500)));
}
function ver300Log(action, detail) {
  const arr = ver300Logs();
  arr.unshift({
    at: new Date().toLocaleString('ja-JP'),
    user: typeof email === 'function' ? email() || '未ログイン' : '未ログイン',
    role: ver300Role(),
    action,
    detail
  });
  ver300SaveLogs(arr);
}
function ver300Role() {
  return localStorage.getItem('ribre_role_mode300') || (typeof role === 'function' ? role() : 'staff') || 'staff';
}
function ver300Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver300Render(rows) {
  const box = document.getElementById('permissionsList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver300Refresh() {
  ver300Set('ver300CurrentRole', ver300Role());
  ver300Set('ver300DeleteLock', localStorage.getItem('ribre_delete_lock300') === '1' ? 'ON' : 'OFF');
  ver300Set('ver300EditLock', localStorage.getItem('ribre_edit_lock300') === '1' ? 'ON' : 'OFF');
  ver300Set('ver300ClosedMonth', localStorage.getItem('ribre_closed_month300') || 'なし');
}
function ver300SetRoleMode() {
  const r = document.getElementById('ver300RoleMode').value;
  localStorage.setItem('ribre_role_mode300', r);
  localStorage.setItem('ribre_current_role140', r);
  ver300Log('権限変更', '権限を ' + r + ' に変更');
  ver300Refresh();
  ver300Render([{ type: '権限', msg: '権限を ' + r + ' に変更しました' }]);
}
function ver300ToggleDeleteLock() {
  const now = localStorage.getItem('ribre_delete_lock300') === '1';
  localStorage.setItem('ribre_delete_lock300', now ? '0' : '1');
  ver300Log('削除ロック', now ? 'OFF' : 'ON');
  ver300Refresh();
  ver300Render([{ type: '削除ロック', msg: '削除ロックを ' + (now ? 'OFF' : 'ON') + ' にしました' }]);
}
function ver300ToggleEditLock() {
  const now = localStorage.getItem('ribre_edit_lock300') === '1';
  localStorage.setItem('ribre_edit_lock300', now ? '0' : '1');
  ver300Log('編集ロック', now ? 'OFF' : 'ON');
  ver300Refresh();
  ver300Render([{ type: '編集ロック', msg: '編集ロックを ' + (now ? 'OFF' : 'ON') + ' にしました' }]);
}
function ver300CloseMonth() {
  const m = document.getElementById('ver300CloseMonth').value.trim();
  if (!m) {
    alert('月を入力してください 例: 2026-05');
    return;
  }
  localStorage.setItem('ribre_closed_month300', m);
  ver300Log('月締めロック', m);
  ver300Refresh();
  ver300Render([{ type: '月締め', msg: m + ' を月締めロックしました' }]);
}
function ver300CanEdit(month) {
  const r = ver300Role();
  if (r === 'viewer') return { ok: false, reason: '閲覧専用のため編集できません' };
  if (localStorage.getItem('ribre_edit_lock300') === '1' && r !== 'admin')
    return { ok: false, reason: '編集ロック中です' };
  const closed = localStorage.getItem('ribre_closed_month300') || '';
  if (closed && month && String(month).slice(0, 7) <= closed && r !== 'admin')
    return { ok: false, reason: '月締め済みです' };
  return { ok: true, reason: '' };
}
function ver300CanDelete() {
  const r = ver300Role();
  if (r !== 'admin') return { ok: false, reason: '削除は管理者のみです' };
  if (localStorage.getItem('ribre_delete_lock300') === '1') return { ok: false, reason: '削除ロック中です' };
  return { ok: true, reason: '' };
}
function ver300ShowLogs() {
  const logs = ver300Logs();
  if (!logs.length) {
    ver300Render([{ type: 'INFO', level: 'warn', msg: '変更履歴はありません' }]);
    return;
  }
  ver300Render(
    logs.slice(0, 120).map((x) => ({
      type: x.action,
      msg: x.at + ' / ' + x.user + ' / ' + x.role + ' / ' + x.detail
    }))
  );
}
function ver300ExportLogs() {
  const rows = [['日時', 'ユーザー', '権限', '操作', '内容']];
  ver300Logs().forEach((x) => rows.push([x.at, x.user, x.role, x.action, x.detail]));
  csvDownload(rows, 'action_logs_Ver30_0.csv');
}
function ver300ApplyOperationGuards() {
  if (typeof addSale === 'function' && !window.__ver300AddSaleWrapped) {
    const oldAddSale = addSale;
    window.addSale = function () {
      const m = (document.getElementById('saleDate')?.value || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const c = ver300CanEdit(m);
      if (!c.ok) {
        alert(c.reason);
        ver300Log('売上追加拒否', c.reason);
        return;
      }
      oldAddSale();
      ver300Log('売上追加', '売上を追加');
    };
    window.__ver300AddSaleWrapped = true;
  }
  if (typeof addPurchase === 'function' && !window.__ver300AddPurchaseWrapped) {
    const oldAddPurchase = addPurchase;
    window.addPurchase = function () {
      const m = (document.getElementById('purDate')?.value || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const c = ver300CanEdit(m);
      if (!c.ok) {
        alert(c.reason);
        ver300Log('仕入追加拒否', c.reason);
        return;
      }
      oldAddPurchase();
      ver300Log('仕入追加', '仕入を追加');
    };
    window.__ver300AddPurchaseWrapped = true;
  }
  if (typeof ocrToSale === 'function' && !window.__ver300OcrSaleWrapped) {
    const oldOcrToSale = ocrToSale;
    window.ocrToSale = function () {
      const m = (document.getElementById('cDate')?.value || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const c = ver300CanEdit(m);
      if (!c.ok) {
        alert(c.reason);
        ver300Log('OCR売上登録拒否', c.reason);
        return;
      }
      oldOcrToSale();
      ver300Log('OCR売上登録', 'OCR結果を売上へ登録');
    };
    window.__ver300OcrSaleWrapped = true;
  }
  if (typeof ocrToPurchase === 'function' && !window.__ver300OcrPurchaseWrapped) {
    const oldOcrToPurchase = ocrToPurchase;
    window.ocrToPurchase = function () {
      const m = (document.getElementById('cDate')?.value || new Date().toISOString().slice(0, 10)).slice(0, 7);
      const c = ver300CanEdit(m);
      if (!c.ok) {
        alert(c.reason);
        ver300Log('OCR仕入登録拒否', c.reason);
        return;
      }
      oldOcrToPurchase();
      ver300Log('OCR仕入登録', 'OCR結果を仕入へ登録');
    };
    window.__ver300OcrPurchaseWrapped = true;
  }
}
window.addEventListener('load', () => {
  setTimeout(() => {
    ver300Refresh();
    ver300ApplyOperationGuards();
  }, 1200);
});

function ver470Staff() {
  try {
    return JSON.parse(localStorage.getItem('ribre_staff470') || '[]');
  } catch (e) {
    return [];
  }
}
function ver470SaveStaff(arr) {
  localStorage.setItem('ribre_staff470', JSON.stringify(arr.slice(0, 500)));
}
function ver470Render(rows) {
  const box = document.getElementById('staff47List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver470Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver470Email() {
  try {
    const s = JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
    return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
  } catch (e) {
    return localStorage.getItem('ribre_current_user140') || '';
  }
}
function ver470Role() {
  const emailValue = ver470Email();
  const hit = ver470Staff().find((x) => x.email === emailValue);
  return (
    hit?.role ||
    localStorage.getItem('ribre_role_mode300') ||
    localStorage.getItem('ribre_current_role140') ||
    'staff'
  );
}
function ver470Refresh() {
  const arr = ver470Staff();
  ver470Set('ver470StaffCount', arr.length + '件');
  ver470Set('ver470CurrentUser', ver470Email() || '未ログイン');
  ver470Set('ver470CurrentRole', ver470Role());
}
function ver470AddStaff() {
  const emailValue = (document.getElementById('ver470StaffEmail').value || '').trim();
  const roleValue = document.getElementById('ver470StaffRole').value;
  if (!emailValue) {
    alert('スタッフメールを入力してください');
    return;
  }
  const arr = ver470Staff().filter((x) => x.email !== emailValue);
  arr.unshift({
    email: emailValue,
    role: roleValue,
    status: '有効',
    addedAt: new Date().toLocaleString('ja-JP'),
    addedBy: ver470Email() || '未ログイン'
  });
  ver470SaveStaff(arr);
  ver470Refresh();
  ver470Render([{ type: '登録', msg: emailValue + ' を ' + roleValue + ' として登録しました' }]);
}
function ver470ShowStaff() {
  const arr = ver470Staff();
  ver470Refresh();
  if (!arr.length) {
    ver470Render([{ type: 'INFO', level: 'warn', msg: 'スタッフ登録はありません' }]);
    return;
  }
  ver470Render(
    arr.map((x) => ({
      type: x.role,
      level: x.status === '有効' ? 'ok' : 'warn',
      msg: x.email + ' / ' + x.status + ' / 登録:' + x.addedAt + ' / 登録者:' + x.addedBy
    }))
  );
}
function ver470CheckCurrentPermission() {
  const emailValue = ver470Email();
  const roleValue = ver470Role();
  const canEdit = roleValue === 'admin' || roleValue === 'staff';
  const canDelete = roleValue === 'admin';
  const canClose = roleValue === 'admin';
  ver470Set('ver470Status', '確認OK');
  ver470Refresh();
  ver470Render([
    { type: 'ユーザー', msg: emailValue || '未ログイン' },
    { type: '権限', msg: roleValue },
    { type: '編集', level: canEdit ? 'ok' : 'warn', msg: canEdit ? '編集できます' : '編集できません' },
    { type: '削除', level: canDelete ? 'ok' : 'warn', msg: canDelete ? '削除できます' : '削除できません' },
    { type: '月締め', level: canClose ? 'ok' : 'warn', msg: canClose ? '月締めできます' : '月締めできません' }
  ]);
}
function ver470ShowWorkSummary() {
  let logs = [],
    tasks = [],
    sync = [];
  try {
    logs = JSON.parse(localStorage.getItem('ribre_action_logs300') || '[]');
  } catch (e) {}
  try {
    tasks = JSON.parse(localStorage.getItem('ribre_fix_tasks370') || '[]');
  } catch (e) {}
  try {
    sync = JSON.parse(localStorage.getItem('ribre_realtime_logs460') || '[]');
  } catch (e) {}
  const map = {};
  logs.forEach((x) => {
    const u = x.user || '未設定';
    map[u] = map[u] || { logs: 0, tasks: 0, sync: 0 };
    map[u].logs++;
  });
  tasks.forEach((x) => {
    const u = x.user || '未設定';
    map[u] = map[u] || { logs: 0, tasks: 0, sync: 0 };
    map[u].tasks++;
  });
  sync.forEach((x) => {
    const u = x.user || '端末同期';
    map[u] = map[u] || { logs: 0, tasks: 0, sync: 0 };
    map[u].sync++;
  });
  const rows = Object.keys(map).map((u) => ({
    type: '作業',
    msg: u + ' / 操作履歴 ' + map[u].logs + '件 / 修正タスク ' + map[u].tasks + '件 / 同期 ' + map[u].sync + '件'
  }));
  ver470Render(rows.length ? rows : [{ type: 'INFO', level: 'warn', msg: '作業状況データがありません' }]);
}
function ver470ExportStaffCsv() {
  const rows = [['メール', '権限', '状態', '登録日時', '登録者']];
  ver470Staff().forEach((x) => rows.push([x.email, x.role, x.status, x.addedAt, x.addedBy]));
  csvDownload(rows, 'staff_list_Ver47_0.csv');
}
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver470Refresh();
    } catch (e) {}
  }, 1500);
});

function ver480Render(rows) {
  const box = document.getElementById('staffCloud48List');
  if (!box) return;
  box.innerHTML = (rows || [])
    .slice(0, 500)
    .map(
      (r) =>
        '<div class="row ' +
        (r.level || 'ok') +
        '"><span>' +
        r.msg +
        '</span><span class="badge">' +
        r.type +
        '</span></div>'
    )
    .join('');
}
function ver480Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver480Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver480Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver480Email() {
  const s = ver480Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver480Headers(extra = {}) {
  const c = ver480Config(),
    s = ver480Session();
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (s.access_token || c.key),
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    extra
  );
}
function ver480Url(table, query = '') {
  const c = ver480Config();
  if (!c.url || !c.key) {
    alert('Supabase設定がありません');
    return null;
  }
  return c.url.replace(/\/$/, '') + '/rest/v1/' + table + query;
}
async function ver480Rest(table, opt = {}) {
  const url = ver480Url(table, opt.query || '');
  if (!url) return { error: { message: 'Supabase設定なし' } };
  const sessionValue = ver480Session();
  const token = sessionValue.access_token || (sessionValue.session && sessionValue.session.access_token) || '';
  if (!token) return { error: { message: '再ログインしてください', authRequired: true, status: 401 } };
  try {
    const res = await fetch(url, {
      method: opt.method || 'GET',
      headers: ver480Headers(opt.headers || {}),
      body: opt.body ? JSON.stringify(opt.body) : undefined
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (res.status === 401) return { error: { message: '再ログインしてください', authRequired: true, status: 401 } };
    if (!res.ok) return { error: { message: (data && data.message) || text || 'HTTP ' + res.status } };
    return { data };
  } catch (e) {
    return { error: { message: e.message } };
  }
}
function ver480Staff() {
  try {
    return JSON.parse(localStorage.getItem('ribre_staff470') || '[]');
  } catch (e) {
    return [];
  }
}
function ver480SqlText() {
  return `-- RIBRE Ver60.0 staffs table
create table if not exists staffs (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  staff_email text not null,
  role text default 'staff',
  status text default '有効',
  memo text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table staffs enable row level security;

drop policy if exists "staffs owner rows" on staffs;
create policy "staffs owner rows" on staffs
for all using (auth.email() = owner_email or auth.email() = staff_email)
with check (auth.email() = owner_email or auth.email() = staff_email);

create unique index if not exists staffs_owner_staff_unique
on staffs (owner_email, staff_email);

create index if not exists staffs_staff_email_index
on staffs (staff_email);
`;
}
function ver480ShowSql() {
  ver480Render([{ type: 'SQL', msg: ver480SqlText().replace(/\n/g, ' / ').slice(0, 3000) }]);
}
function ver480ExportSql() {
  const blob = new Blob([ver480SqlText()], { type: 'text/sql;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_staffs_table_Ver48_0.sql';
  a.click();
}
async function ver480CheckTable() {
  const res = await ver480Rest('staffs', { query: '?select=id&limit=1' });
  if (res.error && res.error.authRequired) {
    ver480Set('ver480Table', 'エラー');
    ver480Set('ver480Status', '再ログインしてください');
    ver480Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
    return;
  }
  ver480Set('ver480Table', res.error ? 'エラー' : 'OK');
  ver480Set('ver480Status', res.error ? 'エラー' : '確認OK');
  ver480Render([{ type: 'staffs', level: res.error ? 'danger' : 'ok', msg: res.error ? res.error.message : 'staffsテーブルOK' }]);
}
function ver480Refresh() {
  ver480Set('ver480Local', ver480Staff().length + '件');
  let cloud = [];
  try {
    cloud = JSON.parse(localStorage.getItem('ribre_cloud_staffs480') || '[]');
  } catch (e) {}
  ver480Set('ver480Cloud', cloud.length + '件');
}
async function ver480UploadStaff() {
  const owner = ver480Email();
  if (!owner) {
    alert('先にログインしてください');
    return;
  }
  const staff = ver480Staff();
  if (!staff.length) {
    alert('先にスタッフ運用でスタッフ登録してください');
    return;
  }
  const rows = staff.map((x) => ({
    owner_email: owner,
    staff_email: x.email,
    role: x.role || 'staff',
    status: x.status || '有効',
    memo: '登録者: ' + (x.addedBy || '') + ' / 登録日時: ' + (x.addedAt || '')
  }));
  const res = await ver480Rest('staffs', {
    method: 'POST',
    query: '?on_conflict=owner_email,staff_email',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: rows
  });
  if (res.error) {
    if (res.error.authRequired) {
      ver480Set('ver480Status', '再ログインしてください');
      ver480Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver480Render([
      { type: 'ERROR', level: 'danger', msg: res.error.message },
      { type: '確認', level: 'warn', msg: '先にスタッフSQLをSupabase SQL Editorで実行してください' }
    ]);
    return;
  }
  ver480Set('ver480Status', '保存OK');
  ver480Render([{ type: '保存', msg: 'スタッフを本番DBへ保存しました：' + rows.length + '件' }]);
}
async function ver480LoadStaff() {
  const emailValue = ver480Email();
  if (!emailValue) {
    alert('先にログインしてください');
    return;
  }
  const res = await ver480Rest('staffs', {
    query: '?select=*&or=(owner_email.eq.' + encodeURIComponent(emailValue) + ',staff_email.eq.' + encodeURIComponent(emailValue) + ')&limit=1000'
  });
  if (res.error) {
    if (res.error.authRequired) {
      ver480Set('ver480Status', '再ログインしてください');
      ver480Render([{ type: 'AUTH', level: 'warn', msg: '再ログインしてください' }]);
      return;
    }
    ver480Render([{ type: 'ERROR', level: 'danger', msg: res.error.message }]);
    return;
  }
  const rows = res.data || [];
  localStorage.setItem('ribre_cloud_staffs480', JSON.stringify(rows));
  const local = rows.map((x) => ({
    email: x.staff_email,
    role: x.role,
    status: x.status,
    addedAt: x.created_at,
    addedBy: x.owner_email
  }));
  localStorage.setItem('ribre_staff470', JSON.stringify(local));
  ver480Refresh();
  ver480Set('ver480Status', '読込OK');
  ver480Render(
    rows.map((x) => ({
      type: x.role,
      level: x.status === '有効' ? 'ok' : 'warn',
      msg: x.staff_email + ' / ' + x.status + ' / owner:' + x.owner_email
    }))
  );
}
function ver480ApplyCloudRole() {
  const emailValue = ver480Email();
  let rows = [];
  try {
    rows = JSON.parse(localStorage.getItem('ribre_cloud_staffs480') || '[]');
  } catch (e) {}
  const hit = rows.find((x) => x.staff_email === emailValue);
  if (!hit) {
    ver480Render([{ type: '注意', level: 'warn', msg: '現在ユーザーの本番スタッフ権限が見つかりません' }]);
    return;
  }
  localStorage.setItem('ribre_role_mode300', hit.role);
  localStorage.setItem('ribre_current_role140', hit.role);
  try {
    ver470Refresh();
  } catch (e) {}
  ver480Set('ver480Status', '権限適用OK');
  ver480Render([{ type: '権限', msg: emailValue + ' に ' + hit.role + ' を適用しました' }]);
}
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver480Refresh();
    } catch (e) {}
  }, 1400);
});

window.saveSupabase = saveSupabase;
window.checkSupabase = checkSupabase;
window.saveOpenAI = saveOpenAI;
window.signUp = signUp;
window.signIn = signIn;
window.signOut = signOut;
window.ver300Logs = ver300Logs;
window.ver300SaveLogs = ver300SaveLogs;
window.ver300Log = ver300Log;
window.ver300Role = ver300Role;
window.ver300Set = ver300Set;
window.ver300Render = ver300Render;
window.ver300Refresh = ver300Refresh;
window.ver300SetRoleMode = ver300SetRoleMode;
window.ver300ToggleDeleteLock = ver300ToggleDeleteLock;
window.ver300ToggleEditLock = ver300ToggleEditLock;
window.ver300CloseMonth = ver300CloseMonth;
window.ver300CanEdit = ver300CanEdit;
window.ver300CanDelete = ver300CanDelete;
window.ver300ShowLogs = ver300ShowLogs;
window.ver300ExportLogs = ver300ExportLogs;
window.ver300ApplyOperationGuards = ver300ApplyOperationGuards;
window.ver470Staff = ver470Staff;
window.ver470SaveStaff = ver470SaveStaff;
window.ver470Render = ver470Render;
window.ver470Set = ver470Set;
window.ver470Email = ver470Email;
window.ver470Role = ver470Role;
window.ver470Refresh = ver470Refresh;
window.ver470AddStaff = ver470AddStaff;
window.ver470ShowStaff = ver470ShowStaff;
window.ver470CheckCurrentPermission = ver470CheckCurrentPermission;
window.ver470ShowWorkSummary = ver470ShowWorkSummary;
window.ver470ExportStaffCsv = ver470ExportStaffCsv;
window.ver480Render = ver480Render;
window.ver480Set = ver480Set;
window.ver480Config = ver480Config;
window.ver480Session = ver480Session;
window.ver480Email = ver480Email;
window.ver480Headers = ver480Headers;
window.ver480Url = ver480Url;
window.ver480Rest = ver480Rest;
window.ver480Staff = ver480Staff;
window.ver480SqlText = ver480SqlText;
window.ver480ShowSql = ver480ShowSql;
window.ver480ExportSql = ver480ExportSql;
window.ver480CheckTable = ver480CheckTable;
window.ver480Refresh = ver480Refresh;
window.ver480UploadStaff = ver480UploadStaff;
window.ver480LoadStaff = ver480LoadStaff;
window.ver480ApplyCloudRole = ver480ApplyCloudRole;
