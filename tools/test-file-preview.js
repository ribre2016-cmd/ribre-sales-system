// ③共有ファイルの「PDF・画像」を押すと、その場で中身が見られることを確かめる。
//
// なぜ必要か:
//   ファイル名のリンクは署名URLに download= が付いており「保存」になる。
//   閲覧用は download= を**付けない**URLでなければならず、ここを取り違えると
//   押しても保存ダイアログが出るだけで、プレビューにならない（2026-08-07の指摘）。
//   Excelなど画面で開けないものを押せるようにしないことも要点。
//
// 実行: node tools/test-file-preview.js
'use strict';

const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'mf', 'tax-workspace.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');

function pick(head) {
  const i = ui.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  const rest = ui.slice(i);
  return rest.slice(0, rest.indexOf('\n}\n') + 3);
}

/* ---- 最小のDOM ---- */
class N {
  constructor(t) {
    this.tagName = String(t).toUpperCase();
    this.children = []; this.attrs = {}; this.style = {}; this.dataset = {};
    this._t = ''; this.L = {}; this.value = '';
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    if (k === 'style') {
      String(v).split(';').forEach((d) => {
        const [p, x] = d.split(':');
        if (p && x) this.style[p.trim().replace(/-(\w)/g, (_, c) => c.toUpperCase())] = x.trim();
      });
    }
  }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); }
  click() { (this.L.click || []).forEach((f) => f.call(this, {})); }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  walk(o) { o.push(this); this.children.forEach((c) => c.walk(o)); return o; }
  querySelectorAll(s) { return this.walk([]).slice(1).filter((n) => n.tagName === s.toUpperCase()); }
  querySelector(s) { return this.querySelectorAll(s)[0] || null; }
}
const reg = {};
global.document = {
  createElement: (t) => new N(t),
  getElementById: (id) => reg[id] || (reg[id] = new N('div')),
  createTextNode: (t) => { const n = new N('#text'); n.textContent = t; return n; },
};
global.el = eval('(' + pick('function el(') + ')');
global.clearEl = (n) => { n.children = []; n._t = ''; };
global.txwFormatSize = eval('(' + pick('function txwFormatSize(') + ')');
global.txwBuildAttachPanel = () => {};
const render = eval('(' + pick('function txwRenderFiles(') + ')');

let ng = 0;
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}
function has(label, src, re) {
  const ok = re.test(src);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}

console.log('===== サーバーが閲覧用URLを返すか =====');
has('preview_url を返す', api, /preview_url: `\$\{SUPABASE_URL\}\/storage\/v1\$\{signData\.signedURL\}`/);
/* ⚠ 閲覧用に download= を付けると保存になる。付いていないことを確かめる。 */
has('閲覧用URLに download= を付けていない',
  api, /preview_url: `[^`]*`(?![^;]*download=)/);
has('保存用URLには download= が付いている', api, /url: `[^`]*&download=\$\{encodeURIComponent/);

const S = 'https://x.supabase.co/storage/v1/object/sign/tax-docs/k?token=t';
const FILES = [
  { key: '2026-07/a.pdf', name: '請求書 Clover.pdf', size: 420000, month: '2026-07', attachable: true, url: S + '&download=a', preview_url: S },
  { key: '2026-07/b.png', name: 'ブックオフ 2026-07-17.png', size: 7000, month: '2026-07', attachable: true, url: S + '&download=b', preview_url: S },
  { key: '2026-07/c.xlsx', name: '物販売上管理表.xlsx', size: 2100000, month: '2026-07', attachable: false },
];
render(FILES, '');
const body = document.getElementById('txwFilesBody');
const rows = body.querySelectorAll('TR').slice(1);

console.log('\n===== 種別の欄 =====');
ck('PDF・画像は押せる／Excelは押せない',
  rows.map((r) => {
    const td = r.children[2];
    const btn = td.querySelectorAll('BUTTON');
    return btn.length ? ('button:' + btn[0].textContent) : ('span:' + td.textContent.trim());
  }),
  ['button:PDF・画像', 'button:PDF・画像', 'span:Excelなど']);

console.log('\n===== PDFを押したとき =====');
const pdfBtn = rows[0].children[2].querySelector('BUTTON');
const pdfBox = rows[0].children[2].querySelectorAll('DIV').filter((d) => d.className === 'txw-preview')[0];
ck('押す前は閉じている', pdfBox.style.display, 'none');
pdfBtn.click();
ck('押すと開く', pdfBox.style.display, 'block');
ck('ボタンの文字が変わる', pdfBtn.textContent, '閉じる');
ck('PDFは枠(iframe)で出す', pdfBox.querySelectorAll('IFRAME').length, 1);
/* ここが本題。保存用URLを使うと、押しても保存になってしまう。 */
ck('閲覧用URL（download無し）を使う', pdfBox.querySelector('IFRAME').attrs.src, S);
pdfBtn.click();
ck('もう一度押すと閉じる', pdfBox.style.display, 'none');

console.log('\n===== 画像を押したとき =====');
const imgBtn = rows[1].children[2].querySelector('BUTTON');
imgBtn.click();
const imgBox = rows[1].children[2].querySelectorAll('DIV').filter((d) => d.className === 'txw-preview')[0];
ck('画像は<img>で出す', imgBox.querySelectorAll('IMG').length, 1);
ck('枠(iframe)にはしない', imgBox.querySelectorAll('IFRAME').length, 0);
ck('閲覧用URLを使う', imgBox.querySelector('IMG').attrs.src, S);
imgBtn.click(); imgBtn.click();
ck('開き直しても中身を作り直さない', imgBox.querySelectorAll('IMG').length, 1);

console.log('\n===== ファイル名のリンクは保存のまま =====');
ck('download付きURLを使う', rows[0].children[0].querySelector('A').attrs.href, S + '&download=a');

console.log('\n===== 古い応答（preview_urlが無い）でも落ちない =====');
render([{ key: 'x', name: '古い.pdf', size: 1, month: '2026-07', attachable: true, url: S }], '');
const r2 = document.getElementById('txwFilesBody').querySelectorAll('TR').slice(1)[0];
ck('押せない札にする', r2.children[2].querySelectorAll('BUTTON').length, 0);

console.log('\n===== 見た目 =====');
has('プレビューのCSSがある', html, /\.txw-preview-frame \{/);
has('画像は幅からはみ出さない', html, /\.txw-preview-img \{[^}]*max-width: 100%/);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
