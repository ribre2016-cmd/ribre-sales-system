// 発行済みの招待一覧から、各人のリンクを取り出せることを確かめる。
//
// なぜ必要か:
//   発行の欄は「最後に発行した1件」しか出さない。2人分を続けて発行すると
//   先に出したリンクが画面から消え、**渡せなくなっていた**（2026-08-07の指摘）。
//   トークンは元から一覧APIの応答に入っているので、そこから出せばよい。
//   ここが壊れると、招待を出し直す（＝先に渡したリンクが無効になる）しかなくなる。
//
// ⚠ トークンは秘密。使える招待の行だけに出し、
//   取り消し済み・使用済み・期限切れには出さないこと。
//
// 実行: node tools/test-invite-list.js
'use strict';

const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');

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
    // 実ブラウザは style 属性を element.style へ反映する。真似ないと開閉の判定が逆になる
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
global.location = { origin: 'https://ribre-sales-system.vercel.app' };
global.el = eval('(' + pick('function el(') + ')');
global.clearEl = (n) => { n.children = []; n._t = ''; };
global.txwFormatDateTime = eval('(' + pick('function txwFormatDateTime(') + ')');
global.txwInviteStatus = eval('(' + pick('function txwInviteStatus(') + ')');
global.txwCopyInviteUrl = () => {};
global.txwRevokeInvite = () => {};
const render = eval('(' + pick('function txwRenderInvites(') + ')');

let ng = 0;
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

const now = Date.now();
const FUTURE = new Date(now + 6e8).toISOString();
const PAST = new Date(now - 6e8).toISOString();
render([
  { note: '松井翔平', token: '37f9be2e01da946f7cbf07284d941014', created_at: '2026-08-07T10:42:54Z', expires_at: FUTURE },
  { note: '木村孝次', token: 'aaaabbbbccccddddeeeeffff00001111', created_at: '2026-08-07T10:42:29Z', expires_at: FUTURE },
  { note: null, token: 'cccc0000cccc0000cccc0000cccc0000', created_at: '2026-08-03T03:23:38Z', expires_at: PAST, revoked_at: '2026-08-03T04:00:00Z' },
  { note: '使用済みの人', token: 'dddd1111dddd1111dddd1111dddd1111', created_at: '2026-08-01T00:00:00Z', expires_at: FUTURE, used_at: '2026-08-02T00:00:00Z' },
  { note: '期限切れの人', token: 'eeee2222eeee2222eeee2222eeee2222', created_at: '2026-07-01T00:00:00Z', expires_at: PAST },
]);
const body = document.getElementById('txwInviteListBody');
const rows = body.querySelectorAll('TR').slice(1);   // 先頭は見出し行

console.log('===== 一覧の中身 =====');
ck('渡す相手が出る（無ければ—）',
  rows.map((r) => r.children[0].textContent), ['松井翔平', '木村孝次', '—', '使用済みの人', '期限切れの人']);

console.log('\n===== リンクを出す行・出さない行 =====');
/* ⚠ トークンは秘密。使える招待だけに出すこと。 */
ck('リンクを出すのは「まだ使える」2行だけ',
  rows.map((r) => r.querySelectorAll('INPUT').length), [1, 1, 0, 0, 0]);
ck('取り消し済み・使用済み・期限切れには操作を出さない',
  rows.slice(2).map((r) => r.querySelectorAll('BUTTON').length), [0, 0, 0]);

console.log('\n===== 押すまで隠れているか =====');
const box = rows[1].querySelectorAll('DIV').filter((d) => d.className === 'invite-box')[0];
ck('押す前は隠れている', box.style.display, 'none');
const showBtn = rows[1].querySelectorAll('BUTTON')[0];
ck('ボタンの名前', showBtn.textContent, 'リンクを見る');
showBtn.click();
ck('押すと出る', box.style.display, 'block');
ck('ボタンの文字が変わる', showBtn.textContent, '隠す');
showBtn.click();
ck('もう一度押すと隠れる', box.style.display, 'none');

console.log('\n===== リンクが人ごとに違うか（ここが今回の本題） =====');
ck('2人目のリンク', rows[1].querySelector('INPUT').value,
  'https://ribre-sales-system.vercel.app/tax-workspace#invite=aaaabbbbccccddddeeeeffff00001111');
ck('1人目とは別のリンク',
  rows[0].querySelector('INPUT').value !== rows[1].querySelector('INPUT').value, true);
ck('1人目のリンク', rows[0].querySelector('INPUT').value,
  'https://ribre-sales-system.vercel.app/tax-workspace#invite=37f9be2e01da946f7cbf07284d941014');
ck('1回だけ使える旨を書いてある', /1回だけ使えます/.test(box.textContent), true);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
