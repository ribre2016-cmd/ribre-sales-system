/* RIBRE — Supabase Storage（証憑クラウド ver400/410 + Storage保存 ver490。index.html から分離。ロジックは同一） */
function ver400Links() {
  try {
    return JSON.parse(localStorage.getItem('ribre_evidence_cloud_links400') || '[]');
  } catch (e) {
    return [];
  }
}
function ver400SaveLinks(arr) {
  localStorage.setItem('ribre_evidence_cloud_links400', JSON.stringify(arr.slice(0, 5000)));
}
function ver400Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver400Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver400Email() {
  const s = ver400Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver400Render(rows) {
  const box = document.getElementById('evidenceCloudList');
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
function ver400Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver400Refresh() {
  const bucket = localStorage.getItem('ribre_storage_bucket400') || '';
  ver400Set('ver400BucketView', bucket || '未設定');
  ver400Set('ver400LinkCount', ver400Links().length + '件');
  ver400Set('ver400LastUpload', localStorage.getItem('ribre_last_evidence_upload400') || 'なし');
  const input = document.getElementById('ver400Bucket');
  if (input && bucket) input.value = bucket;
}
function ver400SaveBucket() {
  const b = (document.getElementById('ver400Bucket').value || '').trim();
  if (!b) {
    alert('bucket名を入力してください');
    return;
  }
  localStorage.setItem('ribre_storage_bucket400', b);
  ver400Refresh();
  ver400Render([{ type: 'OK', msg: 'bucket名を保存しました：' + b }]);
}
function ver400Evidences() {
  const keys = [
    'ribre_full_evidences221',
    'ribre_evidences200',
    'ribre_evidences180',
    'ribre_pdf_evidences195'
  ];
  for (const k of keys) {
    try {
      const arr = JSON.parse(localStorage.getItem(k) || '[]');
      if (arr && arr.length) return arr;
    } catch (e) {}
  }
  return [];
}
function ver400DataUrlToBlob(dataUrl) {
  const parts = String(dataUrl || '').split(',');
  const meta = parts[0] || '';
  const b64 = parts[1] || '';
  const mime = (meta.match(/data:(.*?);base64/) || [])[1] || 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
async function ver400UploadLatestEvidence() {
  const bucket = localStorage.getItem('ribre_storage_bucket400') || '';
  const cfg = ver400Config();
  const session = ver400Session();
  const email = ver400Email();
  const ev = ver400Evidences()[0];

  if (!bucket) {
    alert('先にbucket名を保存してください');
    return;
  }
  if (!cfg.url || !cfg.key) {
    alert('Supabase設定がありません');
    return;
  }
  if (!email) {
    alert('先にログインしてください');
    return;
  }
  if (!ev || !ev.dataUrl) {
    alert('保存する証憑がありません。先にOCR・証憑でPDF/画像を登録してください');
    return;
  }

  ver400Set('ver400Status', '保存中');
  ver400Render([
    { type: '保存中', level: 'warn', msg: '証憑をクラウド保存中です：' + (ev.fileName || 'file') }
  ]);

  try {
    const safeName = String(ev.fileName || 'evidence_' + Date.now()).replace(
      /[^\w.\-ぁ-んァ-ン一-龥]/g,
      '_'
    );
    const path =
      encodeURIComponent(email) +
      '/' +
      new Date().toISOString().slice(0, 10) +
      '/' +
      Date.now() +
      '_' +
      safeName;
    const blob = ver400DataUrlToBlob(ev.dataUrl);
    const url = cfg.url.replace(/\/$/, '') + '/storage/v1/object/' + bucket + '/' + path;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + (session.access_token || cfg.key),
        'Content-Type': blob.type,
        'x-upsert': 'true'
      },
      body: blob
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!res.ok) throw new Error((data && data.message) || text || 'HTTP ' + res.status);

    const publicUrl = cfg.url.replace(/\/$/, '') + '/storage/v1/object/public/' + bucket + '/' + path;
    const links = ver400Links();
    links.unshift({
      at: new Date().toLocaleString('ja-JP'),
      user: email,
      bucket,
      path,
      fileName: ev.fileName || safeName,
      mime: ev.mime || blob.type,
      publicUrl,
      evidenceId: ev.id || ''
    });
    ver400SaveLinks(links);
    localStorage.setItem('ribre_last_evidence_upload400', new Date().toLocaleString('ja-JP'));
    ver400Set('ver400Status', '保存OK');
    ver400Refresh();
    ver400Render([
      { type: 'OK', msg: '証憑をクラウド保存しました' },
      { type: 'URL', msg: publicUrl }
    ]);
  } catch (e) {
    ver400Set('ver400Status', 'エラー');
    ver400Render([
      { type: 'ERROR', level: 'danger', msg: e.message },
      {
        type: '確認',
        level: 'warn',
        msg: 'Supabase Storageで bucket を作成し、必要に応じて公開設定またはRLS設定を確認してください'
      }
    ]);
  }
}
function ver400ShowEvidenceLinks() {
  const links = ver400Links();
  if (!links.length) {
    ver400Render([{ type: 'INFO', level: 'warn', msg: '保存済み証憑リンクはありません' }]);
    return;
  }
  ver400Render(
    links.slice(0, 200).map((x) => ({
      type: x.bucket,
      msg: x.at + ' / ' + x.fileName + ' / ' + x.publicUrl
    }))
  );
}
function ver400ExportEvidenceLinks() {
  const rows = [['日時', 'ユーザー', 'bucket', 'ファイル名', '種類', 'path', 'URL']];
  ver400Links().forEach((x) =>
    rows.push([x.at, x.user, x.bucket, x.fileName, x.mime, x.path, x.publicUrl])
  );
  csvDownload(rows, 'evidence_cloud_links_Ver40_0.csv');
}
function ver400Guide() {
  ver400Render([
    { type: '1', msg: 'SupabaseのStorageで evidences などのbucketを作成します' },
    { type: '2', msg: 'この画面でbucket名を保存します' },
    { type: '3', msg: 'OCR・証憑でPDF/画像を登録します' },
    { type: '4', msg: '最新証憑をクラウド保存を押します' },
    {
      type: '注意',
      level: 'warn',
      msg: '公開URLで見せる場合はbucketの公開設定またはStorage RLS設定が必要です'
    }
  ]);
}
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      ver400Refresh();
    } catch (e) {}
  }, 1400);
});

function ver410Render(rows) {
  const box = document.getElementById('evidenceCloudList');
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
function ver410Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver410Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
async function ver410CheckStorage() {
  const cfg = ver410Config();
  const bucket = localStorage.getItem('ribre_storage_bucket400') || '';
  if (!cfg.url || !cfg.key) {
    alert('Supabase設定がありません');
    return;
  }
  if (!bucket) {
    alert('先にbucket名を保存してください');
    return;
  }
  try {
    const res = await fetch(cfg.url.replace(/\/$/, '') + '/storage/v1/bucket/' + bucket, {
      headers: {
        apikey: cfg.key,
        Authorization: 'Bearer ' + ((ver410Session() || {}).access_token || cfg.key)
      }
    });
    const text = await res.text();
    if (!res.ok) throw new Error(text || 'HTTP ' + res.status);
    ver410Render([
      { type: 'OK', msg: 'Storage bucket確認OK：' + bucket },
      {
        type: '次',
        msg: 'OCR・証憑でPDF/画像を登録して「最新証憑をクラウド保存」を押してください'
      }
    ]);
  } catch (e) {
    ver410Render([
      { type: 'ERROR', level: 'danger', msg: 'Storage確認エラー：' + e.message },
      {
        type: '確認',
        level: 'warn',
        msg: 'Supabase Storageで bucket「' + bucket + '」を作成してください'
      }
    ]);
  }
}
function ver410ShowSetupSql() {
  const bucket = localStorage.getItem('ribre_storage_bucket400') || 'evidences';
  const sql = [
    '-- Supabase Storage bucket は画面から作成してください',
    '-- bucket名: ' + bucket,
    '',
    '-- 公開bucketで使う場合:',
    '-- Storage → Buckets → ' + bucket + ' → Public bucket をON',
    '',
    '-- 非公開で使う場合はStorage RLSの設計が必要です。',
    '-- まずは運用テストでは Public bucket ON が簡単です。',
    '',
    '-- 注意: service_role keyは公開ページに絶対に入れないでください。'
  ].join('\\n');
  ver410Render([{ type: 'SQL/設定', msg: sql.replace(/\n/g, ' / ') }]);
}
function ver410LatestLink() {
  try {
    return (JSON.parse(localStorage.getItem('ribre_evidence_cloud_links400') || '[]') || [])[0];
  } catch (e) {
    return null;
  }
}
function ver410LinkEvidenceToLatest() {
  const link = ver410LatestLink();
  if (!link) {
    alert('先に証憑をクラウド保存してください');
    return;
  }
  let s = [],
    p = [];
  try {
    s = JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]');
  } catch (e) {}
  if (!s.length) {
    try {
      s = JSON.parse(localStorage.getItem('ribre_full_sales221') || '[]');
    } catch (e) {}
  }
  try {
    p = JSON.parse(localStorage.getItem('ribre_full_purchases221') || '[]');
  } catch (e) {}
  let target = null,
    kind = '';
  if (s.length) {
    target = s[0];
    kind = '売上';
    target.evidenceUrl = link.publicUrl;
    target.evidenceFile = link.fileName;
    localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(s));
    localStorage.setItem('ribre_full_sales221', JSON.stringify(s));
  } else if (p.length) {
    target = p[0];
    kind = '仕入';
    target.evidenceUrl = link.publicUrl;
    target.evidenceFile = link.fileName;
    localStorage.setItem('ribre_full_purchases221', JSON.stringify(p));
  }
  if (!target) {
    alert('紐付ける売上/仕入データがありません');
    return;
  }
  try {
    refreshAll();
  } catch (e) {}
  ver410Render([
    { type: '紐付け', msg: '最新' + kind + 'へ証憑リンクを紐付けました' },
    { type: 'ファイル', msg: link.fileName },
    { type: 'URL', msg: link.publicUrl }
  ]);
}

function ver490Render(rows) {
  const box = document.getElementById('storage49List');
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
function ver490Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver490Config() {
  try {
    return JSON.parse(localStorage.getItem('ribre_supabase_config_v121') || '{}');
  } catch (e) {
    return {};
  }
}
function ver490Session() {
  try {
    return JSON.parse(localStorage.getItem('ribre_auth_session140') || '{}');
  } catch (e) {
    return {};
  }
}
function ver490Email() {
  const s = ver490Session();
  return s.email || (s.user && s.user.email) || localStorage.getItem('ribre_current_user140') || '';
}
function ver490Headers(extra = {}) {
  const c = ver490Config(),
    s = ver490Session();
  return Object.assign(
    {
      apikey: c.key,
      Authorization: 'Bearer ' + (s.access_token || c.key)
    },
    extra
  );
}
function ver490Base() {
  const c = ver490Config();
  return c.url.replace(/\/$/, '');
}
function ver490Sql() {
  return `insert into storage.buckets (id,name,public)
values ('evidence','evidence',true)
on conflict do nothing;

insert into storage.buckets (id,name,public)
values ('ocr','ocr',true)
on conflict do nothing;

insert into storage.buckets (id,name,public)
values ('csv','csv',true)
on conflict do nothing;`;
}
function ver490ShowSql() {
  ver490Render([{ type: 'SQL', msg: ver490Sql().replace(/\n/g, ' / ') }]);
}
async function ver490Upload() {
  const file = document.getElementById('ver490File').files[0];
  if (!file) {
    alert('ファイルを選択してください');
    return;
  }
  const bucket = document.getElementById('ver490Bucket').value;
  ver490Set('ver490BucketView', bucket);

  const email = (ver490Email() || 'guest').replace(/[^a-zA-Z0-9]/g, '_');
  const name = Date.now() + '_' + file.name.replace(/\s/g, '_');
  const path = email + '/' + name;

  const url = ver490Base() + '/storage/v1/object/' + bucket + '/' + path;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: ver490Headers({
        'x-upsert': 'true',
        'Content-Type': file.type || 'application/octet-stream'
      }),
      body: file
    });

    const text = await res.text();
    let data = {};
    try {
      data = JSON.parse(text);
    } catch (e) {}

    if (!res.ok) {
      ver490Set('ver490Status', 'エラー');
      ver490Render([{ type: 'ERROR', level: 'danger', msg: data.message || text }]);
      return;
    }

    const publicUrl = ver490Base() + '/storage/v1/object/public/' + bucket + '/' + path;

    let arr = [];
    try {
      arr = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
    } catch (e) {}
    arr.unshift({
      bucket,
      name: file.name,
      path,
      size: file.size,
      url: publicUrl,
      uploadedAt: new Date().toLocaleString('ja-JP')
    });
    localStorage.setItem('ribre_storage_files490', JSON.stringify(arr.slice(0, 1000)));

    ver490Set('ver490Count', arr.length + '件');
    ver490Set('ver490Last', file.name);
    ver490Set('ver490Status', '保存OK');

    ver490Render([
      { type: '保存', msg: file.name + ' をStorageへ保存しました' },
      { type: 'URL', msg: publicUrl }
    ]);
  } catch (e) {
    ver490Set('ver490Status', 'エラー');
    ver490Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function ver490LoadFiles() {
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
  } catch (e) {}
  ver490Set('ver490Count', arr.length + '件');
  ver490Render(
    arr.slice(0, 200).map((x) => ({
      type: x.bucket,
      msg: x.name + ' / ' + x.uploadedAt
    }))
  );
}
function ver490ExportUrls() {
  let arr = [];
  try {
    arr = JSON.parse(localStorage.getItem('ribre_storage_files490') || '[]');
  } catch (e) {}
  const rows = [['bucket', 'file', 'url', 'uploadedAt']];
  arr.forEach((x) => rows.push([x.bucket, x.name, x.url, x.uploadedAt]));
  csvDownload(rows, 'storage_urls_Ver49_0.csv');
}
