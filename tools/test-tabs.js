// タブの切り替えを、最小限のDOMで実際に動かして確かめる。
//
// なぜ必要か:
//   タブは全機能の入口で、ここが壊れると何も使えない。
//   ブラウザのプレビューはJSをキャッシュして古いまま動くことがあり、
//   目視での確認があてにならなかった（2026-08-05）。
//   ・押したタブだけが表示されること
//   ・開いたときに読み込む処理が、そのタブでだけ走ること
//   ・社内メンバー専用タブが、税理士には出ないこと
//   ・使い方タブに読み込み枠があること（表示のたびに作り直さない）
//
// 実行: node tools/test-tabs.js
'use strict';

const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');

function pick(head) {
  const i = ui.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  const rest = ui.slice(i);
  return rest.slice(0, rest.indexOf('\n}\n') + 3);
}

/* ---- HTMLからタブとページを読み取って、最小のDOMを組み立てる ---- */
class Cls {
  constructor(n) { this.n = n; this.set = new Set(); }
  add(c) { this.set.add(c); }
  remove(c) { this.set.delete(c); }
  contains(c) { return this.set.has(c); }
  toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); }
}
class N {
  constructor(tag, attrs) {
    this.tagName = String(tag).toUpperCase();
    this.attrs = attrs || {};
    this.id = this.attrs.id || '';
    this.dataset = {};
    this.style = {};
    this.classList = new Cls();
    (this.attrs.class || '').split(/\s+/).filter(Boolean).forEach((c) => this.classList.add(c));
    if (this.attrs['data-t']) this.dataset.t = this.attrs['data-t'];
  }
}

const nodes = [];
[...html.matchAll(/<button class="(tab-btn[^"]*)"[^>]*data-t="([a-z]+)"[^>]*?(?:id="([^"]+)")?[^>]*>/g)]
  .forEach(() => {});
// 属性の順序に依存しないよう、タグ全体から拾う
[...html.matchAll(/<button[^>]*class="(tab-btn[^"]*)"[^>]*>/g)].forEach((m) => {
  const tag = m[0];
  const t = /data-t="([a-z]+)"/.exec(tag);
  const id = /id="([^"]+)"/.exec(tag);
  nodes.push(new N('button', { class: m[1], 'data-t': t ? t[1] : '', id: id ? id[1] : '' }));
});
[...html.matchAll(/<section class="(tabpage[^"]*)" id="(t-[a-z]+)"/g)].forEach((m) => {
  nodes.push(new N('section', { class: m[1], id: m[2] }));
});

global.document = {
  querySelectorAll: (sel) => {
    const c = sel.replace('.', '');
    return nodes.filter((n) => n.classList.contains(c));
  },
  getElementById: (id) => nodes.find((n) => n.id === id) || null,
};

/* 開いたときに走る処理が、どのタブで呼ばれたかを記録する */
const called = [];
global.txwAdminLoaded = false;
global.txwLoadInvites = () => called.push('invites');
global.txwLoadAdvisors = () => called.push('advisors');
global.txwLoadApprovalPolicyBlock = () => called.push('policy');
global.txwLoadActionLog = () => called.push('history');
global.txwLoadMonthlyCheck = () => called.push('monthly');
global.txwLoadApprovalTab = () => called.push('approval');

const txwGoTab = eval('(' + pick('function txwGoTab(') + ')');

let ng = 0;
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}
const activePages = () => nodes.filter((n) => n.tagName === 'SECTION' && n.classList.contains('active')).map((n) => n.id);
const activeTabs = () => nodes.filter((n) => n.tagName === 'BUTTON' && n.classList.contains('active')).map((n) => n.dataset.t);

const allTabs = nodes.filter((n) => n.tagName === 'BUTTON').map((n) => n.dataset.t);
console.log('タブ: ' + allTabs.join(', '));
console.log('ページ: ' + nodes.filter((n) => n.tagName === 'SECTION').map((n) => n.id).join(', '));

console.log('\n===== 押したタブだけが開くか =====');
allTabs.forEach((t) => {
  called.length = 0;
  txwGoTab(t);
  ck(t + ' を押す', { page: activePages(), tab: activeTabs() }, { page: ['t-' + t], tab: [t] });
});

console.log('\n===== 開いたときの読み込みが、そのタブでだけ走るか =====');
const runs = {};
global.txwAdminLoaded = false;
allTabs.forEach((t) => { called.length = 0; txwGoTab(t); runs[t] = called.slice(); });
ck('④操作履歴', runs.history, ['history']);
ck('⑤月次チェック', runs.monthly, ['monthly']);
ck('⑥承認待ち', runs.approval, ['approval']);
ck('税理士の管理（初回だけ3つ読む）', runs.admin, ['invites', 'advisors', 'policy']);
ck('①未仕訳は何も読み直さない（対象月の変更で読む）', runs.unmatched, []);
ck('②仕訳待ちも読み直さない', runs.awaiting, []);
ck('③共有ファイルも読み直さない', runs.files, []);
ck('使い方は何も読まない（枠が読み込む）', runs.guide, []);

console.log('\n===== 税理士の管理は2回目以降は読み直さない =====');
called.length = 0;
txwGoTab('admin');
ck('2回目は読み込まない（txwAdminLoadedで抑止）', called, []);

console.log('\n===== 使い方タブの枠 =====');
/* ⚠ 枠は毎回作り直さず、HTMLに固定で1つ置く。
 *   タブを開くたびに作り直すと、読むたびに先頭へ戻ってしまう。 */
ck('枠はHTMLに1つだけ', (html.match(/<iframe/g) || []).length, 1);
ck('枠を作り直す処理は無い', /createElement\('iframe'\)/.test(ui), false);

console.log('\n===== 社内メンバー専用タブの出し入れ =====');
const setAdminVisible = eval('(' + pick('function txwSetAdminVisible(') + ')');
const adminBtn = document.getElementById('txwAdminTabBtn');
txwGoTab('admin');
setAdminVisible(false);
ck('税理士には出さない', adminBtn.style.display, 'none');
ck('そのタブを開いていたら①へ戻す', activePages(), ['t-unmatched']);
setAdminVisible(true);
ck('社内メンバーには出す', adminBtn.style.display, '');

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
