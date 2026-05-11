/* RIBRE — Templates pages 移行（ver340-templates の最終定義を pages 側へ集約） */
function ver340Templates() {
  try {
    return JSON.parse(localStorage.getItem('ribre_templates340') || '[]');
  } catch (e) {
    return [];
  }
}
function ver340SaveAll(arr) {
  localStorage.setItem('ribre_templates340', JSON.stringify(arr.slice(0, 1000)));
}
function ver340Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver340Render(rows) {
  const box = document.getElementById('templatesList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver340Refresh() {
  const arr = ver340Templates();
  const folders = [...new Set(arr.map((x) => x.folder || '未分類'))];
  ver340Set('tplCount', arr.length + '件');
  ver340Set('tplFolderCount', folders.length + '件');
  ver340Set('tplLatest', arr[0] ? arr[0].name : 'なし');
  const sel = document.getElementById('tplFilterFolder');
  if (sel) {
    const current = sel.value;
    sel.innerHTML =
      '<option value="">すべてのフォルダ</option>' + folders.map((f) => '<option value="' + f + '">' + f + '</option>').join('');
    sel.value = current;
  }
}
function ver340SaveTemplate() {
  const folder = (document.getElementById('tplFolder').value || '未分類').trim();
  const name = (document.getElementById('tplName').value || '').trim();
  const type = document.getElementById('tplType').value;
  const text = (document.getElementById('tplText').value || '').trim();
  if (!name) {
    alert('テンプレート名を入力してください');
    return;
  }
  if (!text) {
    alert('内容を入力してください');
    return;
  }
  const arr = ver340Templates();
  arr.unshift({
    id: 'tpl_' + Date.now(),
    folder,
    name,
    type,
    text,
    at: new Date().toLocaleString('ja-JP'),
    user: typeof email === 'function' ? email() || '' : ''
  });
  ver340SaveAll(arr);
  ver340Refresh();
  ver340Set('tplStatus', '保存OK');
  ver340ShowTemplates();
}
function ver340ShowTemplates() {
  const folder = document.getElementById('tplFilterFolder')?.value || '';
  let arr = ver340Templates();
  if (folder) arr = arr.filter((x) => (x.folder || '未分類') === folder);
  if (!arr.length) {
    ver340Render([{ type: 'INFO', level: 'warn', msg: 'テンプレートはありません' }]);
    return;
  }
  ver340Render(
    arr.slice(0, 200).map((x) => ({
      type: x.type,
      level: 'ok',
      msg: '[' + (x.folder || '未分類') + '] ' + x.name + ' / ' + String(x.text || '').slice(0, 80) + ' / ' + x.at
    }))
  );
}
function ver340Latest() {
  return ver340Templates()[0] || null;
}
function ver340ApplyLatestToMemo() {
  const t = ver340Latest();
  if (!t) {
    alert('テンプレートがありません');
    return;
  }
  const targets = ['saleMemo', 'purMemo', 'memo'];
  let applied = false;
  targets.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.value = (el.value ? el.value + ' ' : '') + t.text;
      applied = true;
    }
  });
  ver340Set('tplStatus', applied ? '反映OK' : '対象なし');
  ver340Render([
    {
      type: '反映',
      level: applied ? 'ok' : 'warn',
      msg: applied ? '最新テンプレをメモ欄へ反映しました' : '反映先メモ欄が見つかりません'
    }
  ]);
}
function ver340ApplyLatestToOcr() {
  const t = ver340Latest();
  if (!t) {
    alert('テンプレートがありません');
    return;
  }
  const el = document.getElementById('cMemo');
  if (!el) {
    ver340Render([{ type: '注意', level: 'warn', msg: 'OCRメモ欄が見つかりません' }]);
    return;
  }
  el.value = (el.value ? el.value + ' ' : '') + t.text;
  ver340Set('tplStatus', 'OCR反映OK');
  ver340Render([{ type: 'OCR', level: 'ok', msg: '最新テンプレをOCRメモへ反映しました' }]);
}
function ver340DeleteLatest() {
  const arr = ver340Templates();
  if (!arr.length) {
    alert('削除するテンプレートがありません');
    return;
  }
  if (!confirm('最新テンプレートを削除しますか？')) return;
  const removed = arr.shift();
  ver340SaveAll(arr);
  ver340Refresh();
  ver340Render([{ type: '削除', level: 'warn', msg: '削除しました：' + removed.name }]);
}
function ver340ExportTemplates() {
  const rows = [['日時', 'フォルダ', '名前', '種類', '内容', 'ユーザー']];
  ver340Templates().forEach((x) => rows.push([x.at, x.folder, x.name, x.type, x.text, x.user]));
  csvDownload(rows, 'templates_Ver34_0.csv');
}
window.addEventListener('load', () => {
  setTimeout(() => {
    ver340Refresh();
  }, 1500);
});

window.ver340Templates = ver340Templates;
window.ver340SaveAll = ver340SaveAll;
window.ver340Set = ver340Set;
window.ver340Render = ver340Render;
window.ver340Refresh = ver340Refresh;
window.ver340SaveTemplate = ver340SaveTemplate;
window.ver340ShowTemplates = ver340ShowTemplates;
window.ver340Latest = ver340Latest;
window.ver340ApplyLatestToMemo = ver340ApplyLatestToMemo;
window.ver340ApplyLatestToOcr = ver340ApplyLatestToOcr;
window.ver340DeleteLatest = ver340DeleteLatest;
window.ver340ExportTemplates = ver340ExportTemplates;
