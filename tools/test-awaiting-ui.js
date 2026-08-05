// ②仕訳待ちの証憑の画面を、最小限のDOMを自前で用意して実際に描かせて確かめる。
//
// なぜ必要か:
//   ここは「税理士側から手が出せない」を直した箇所で、
//   一覧が出ない・添付ボタンが出ないと**元の行き止まりに戻る**。
//   文字列の有無（正規表現）だけでは「本当に描けているか」は分からないので、
//   実際に関数を動かして中身を見る。
//   ブラウザのプレビューはJSをキャッシュして古いまま動くことがあり、
//   検証に使えなかった（2026-08-05）。
//
// 実行: node tools/test-awaiting-ui.js
'use strict';

const fs = require('fs');
const path = require('path');

/* ---- 最小のDOM ---- */
class N {
  constructor(tag) {
    this.tagName = String(tag || '').toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.dataset = {};
    this._text = '';
    this.listeners = {};
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
    /* 実ブラウザでは style 属性を入れると element.style.* に反映される。
     * ここを真似ないと「開く／閉じる」の判定が常に逆になり、
     * 実際は動くのにテストだけ落ちる（2026-08-05にハマった）。 */
    if (k === 'style') {
      String(v).split(';').forEach((d) => {
        const [p, val] = d.split(':');
        if (p && val) this.style[p.trim().replace(/-(\w)/g, (_, c) => c.toUpperCase())] = val.trim();
      });
    }
  }
  getAttribute(k) { return this.attrs[k]; }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
  click() { (this.listeners.click || []).forEach((f) => f.call(this, {})); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() {
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) { this._text = String(v); this.children = []; }
  walk(out) { out.push(this); this.children.forEach((c) => c.walk(out)); return out; }
  querySelectorAll(sel) {
    return this.walk([]).slice(1).filter((n) => matches(n, sel));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
}
function matches(n, sel) {
  if (sel.startsWith('.')) return (n.className || '').split(/\s+/).indexOf(sel.slice(1)) >= 0;
  if (sel.startsWith('a[href^="https://"]')) return n.tagName === 'A' && /^https:\/\//.test(n.attrs.href || '');
  if (sel === 'input[type=month]') return n.tagName === 'INPUT' && n.attrs.type === 'month';
  if (sel === 'tbody tr') return n.tagName === 'TR' && n._inTbody;
  if (sel === 'tbody button') return n.tagName === 'BUTTON' && n._inTbody;
  return n.tagName === sel.toUpperCase();
}

const registry = {};
global.document = {
  createElement: (t) => new N(t),
  getElementById: (id) => registry[id] || (registry[id] = new N('div')),
  createTextNode: (t) => { const n = new N('#text'); n.textContent = t; return n; },
};

/* ---- 本体から必要な関数だけ持ってくる ---- */
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');
function pick(head) {
  const i = ui.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  const rest = ui.slice(i);
  return rest.slice(0, rest.indexOf('\n}\n') + 3);
}
global.el = eval('(' + pick('function el(') + ')');
/* clearEl は本体では1行で書かれていて pick では正しく切り出せない
 * （終端の見つけ方が「行頭の } 」なので、次の関数まで飲み込んでしまう）。
 * やることは「中身を空にする」だけなので、ここで同じものを用意する。 */
global.clearEl = function (n) { n.children = []; n._text = ''; };
global.yen = (v) => (Number(v) || 0).toLocaleString('ja-JP') + '円';
global.txwEvidenceAmountText = eval('(' + pick('function txwEvidenceAmountText(') + ')');
global.txwEvidenceStatusText = eval('(' + pick('function txwEvidenceStatusText(') + ')');
global.txwMonthEnd = eval('(' + pick('function txwMonthEnd(') + ')');
global.txwCurrentMonth = () => '2026-07';
global.txwApiCall = async () => ({ data: { ok: true, journals: [] } });
global.txwBuildAttachPanel = eval('(' + pick('function txwBuildAttachPanel(') + ')');
const txwRenderAwaiting = eval('(' + pick('function txwRenderAwaiting(') + ')');

let ng = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

const ROWS = [
  { evidence_id: 'e1', file_name: '請求書_Clover.pdf', ocr_date: '2026-07-31', ocr_amount: 462000,
    ocr_currency: 'JPY', ocr_vendor: '株式会社Clover', status: 'awaiting_match', url: 'https://example.com/x.pdf' },
  { evidence_id: 'e2', file_name: '領収書.png', ocr_date: null, ocr_amount: null,
    ocr_vendor: null, status: 'pending', url: null },
];

console.log('===== 溜まっている証憑が一覧に出るか =====');
txwRenderAwaiting(2, false, 2, ROWS);
const body = document.getElementById('txwAwaitingBody');
// tbody配下の印を付ける（最小DOMのためのしるし）
body.walk([]).forEach((n) => {
  if (n.tagName === 'TBODY') n.walk([]).forEach((m) => { m._inTbody = true; });
});
check('見出し', body.querySelectorAll('TH').map((n) => n.textContent),
  ['日付', '取引先', '金額', 'ファイル', '状態', '操作']);
check('行数', body.querySelectorAll('tbody tr').length, 2);
check('日付が読めない証憑も出す', body.querySelectorAll('tbody tr')[1].children[0].textContent, '日付不明');
check('状態を日本語にする',
  body.querySelectorAll('tbody tr').map((tr) => tr.children[4].textContent), ['仕訳待ち', '送信前']);
check('中身へのリンクが出る', body.querySelectorAll('a[href^="https://"]').length, 1);
check('リンクを出せないときは理由を書く',
  body.querySelectorAll('.file-attach-note').map((n) => n.textContent), ['中身を表示できませんでした']);
check('各行に添付ボタンがある',
  body.querySelectorAll('tbody button').map((b) => b.textContent),
  ['仕訳を選んで添付', '仕訳を選んで添付']);

console.log('\n===== 添付の枠が開くか（③と同じ仕組み） =====');
const btn = body.querySelectorAll('tbody button')[0];
btn.click();
check('押すと枠が開く', body.querySelectorAll('input[type=month]').length, 1);
check('既定の月は証憑の日付から', body.querySelectorAll('input[type=month]')[0].attrs.value, '2026-07');
check('ボタンの文字が変わる', btn.textContent, '閉じる');
const panelText = body.textContent;
check('取り消せないことが枠にも書いてある',
  panelText.indexOf('MFへ送った証憑は取り消せません') >= 0, true);

console.log('\n===== 消す操作は置かない（MFへ送ると取り消せないため） =====');
check('削除ボタンは無い',
  body.querySelectorAll('BUTTON').filter((b) => /削除|消す/.test(b.textContent)).length, 0);
check('消せないことを書いてある', body.textContent.indexOf('ここから証憑を消すことはできません') >= 0, true);

console.log('\n===== 0件のときは表を出さない =====');
txwRenderAwaiting(0, false, 0, []);
check('表は出ない', document.getElementById('txwAwaitingBody').querySelectorAll('TABLE').length, 0);
check('件数は出る', document.getElementById('txwAwaitingBody').querySelector('.chip').textContent, '仕訳待ちの証憑 0件');

console.log('\n===== 上限で切れたら伝える =====');
txwRenderAwaiting(1234, true, 60, ROWS);
const b2 = document.getElementById('txwAwaitingBody');
check('本当の件数を出す', b2.querySelector('.chip').textContent, '仕訳待ちの証憑 1234件');
check('切れたことを赤字で言う',
  b2.querySelectorAll('.note').some((n) => /新しい 60件だけを使っています/.test(n.textContent)), true);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
