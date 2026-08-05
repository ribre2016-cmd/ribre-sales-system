// ⑤の「承認の設定」と「役割の変更」を、最小限のDOMで実際に動かして確かめる。
//
// なぜ必要か:
//   ここは長らく「ラジオは出るが変更できません。SQLをSupabaseで実行してください」
//   という画面だった（保存処理はサーバーにあり、呼ぶ口が無かっただけ）。
//   しかも案内のSQLは古い設計の名残で `'"none"'::jsonb` と書かれており、
//   そのまま実行しても失敗する内容だった（2026-08-05の指摘で発覚）。
//
//   いちばん怖いのは「画面だけ変わって、実際は変わっていない」状態なので、
//   失敗したときに選択が正しく戻ることまで確かめる。
//
// 実行: node tools/test-settings-ui.js
'use strict';

const fs = require('fs');
const path = require('path');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'mf', 'tax-workspace.js'), 'utf8');

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
    this._t = ''; this.L = {}; this.checked = false; this.disabled = false;
  }
  get className() { return this.attrs.class || ''; }
  set className(v) { this.attrs.class = v; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  appendChild(c) { this.children.push(c); return c; }
  addEventListener(t, f) { (this.L[t] = this.L[t] || []).push(f); }
  fire(t) { (this.L[t] || []).forEach((f) => f.call(this, {})); }
  set textContent(v) { this._t = String(v); this.children = []; }
  get textContent() { return this._t + this.children.map((c) => c.textContent).join(''); }
  get value() { return this.attrs.value; }
  walk(o) { o.push(this); this.children.forEach((c) => c.walk(o)); return o; }
  querySelectorAll(s) { return this.walk([]).slice(1).filter((n) => n.tagName === s.toUpperCase()); }
}
const reg = {};
global.document = {
  createElement: (t) => new N(t),
  getElementById: (id) => reg[id] || (reg[id] = new N('div')),
  createTextNode: (t) => { const n = new N('#text'); n.textContent = t; return n; },
};
global.el = eval('(' + pick('function el(') + ')');
global.clearEl = (n) => { n.children = []; n._t = ''; };

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

/* ---- 差し替え可能な外部 ---- */
let sent = null;
let reply = { ok: true };
let listReply = { ok: true, approval_policy: 'none', is_admin: true, requests: [] };
global.confirm = () => true;
let alerted = null;
global.alert = (m) => { alerted = m; };
global.txwApiCall = async (a, b) => {
  if (a === 'request_list') return { data: listReply };
  sent = { a, b };
  return { data: reply };
};
global.txwApprovalPolicyValue = null;
global.txwApprovalPolicyLabel = eval('(' + pick('function txwApprovalPolicyLabel(') + ')');
global.txwSaveApprovalPolicy = eval('(' + pick('async function txwSaveApprovalPolicy(') + ')');
const loadPolicy = eval('(' + pick('async function txwLoadApprovalPolicyBlock(') + ')');

(async () => {
  console.log('===== SQLを見せる画面をやめたか =====');
  has('画面の説明からSQLの案内が消えている', html, /^(?![\s\S]*SQL)[\s\S]*$/);
  has('SQLの文字列を組み立てる関数が残っていない', ui, /^(?![\s\S]*function txwRoleSql\()[\s\S]*$/);
  has('サーバーに承認の設定を保存する口がある', api, /action === 'set_approval_policy'/);
  has('サーバーに役割を変える口がある', api, /action === 'advisor_set_role'/);
  has('承認の設定を変えられるのは管理者だけ',
    api, /action === 'set_approval_policy'\) \{\s*\n\s*if \(!isAdmin\)/);
  has('役割を変えられるのは社内メンバーだけ',
    api, /action === 'advisor_set_role'\) \{\s*\n\s*if \(!isMember\)/);
  has('どちらも操作履歴に残す', api, /action: 'set_approval_policy',[\s\S]*action: 'advisor_set_role',/);

  console.log('\n===== 承認の設定: その場で保存できるか =====');
  await loadPolicy();
  const box = document.getElementById('txwApprovalPolicyBox');
  const radios = box.querySelectorAll('INPUT');
  ck('選択肢が2つ', radios.length, 2);
  ck('管理者なら押せる', radios.map((r) => !!r.attrs.disabled), [false, false]);
  ck('今の値が選ばれている', radios.map((r) => r.checked), [true, false]);

  radios[1].checked = true; radios[0].checked = false;
  radios[1].fire('change');
  await new Promise((r) => setTimeout(r, 5));
  ck('保存の口を呼ぶ', sent && sent.a, 'set_approval_policy');
  ck('選んだ値を送る', sent && sent.b, { policy: 'required' });
  ck('結果を画面に出す', /に変えました/.test(box.textContent), true);

  /* ここが本題。一度成功したあとに失敗したとき、
   * 「開いたときの値」ではなく「いま実際に保存されている値」へ戻すこと。 */
  console.log('\n===== 失敗したとき、画面と実際が食い違わないか =====');
  reply = { ok: false, error: 'admin_only' };
  radios[0].checked = true; radios[1].checked = false;
  radios[0].fire('change');
  await new Promise((r) => setTimeout(r, 5));
  ck('いま保存されている値（承認する）に戻る', radios.map((r) => r.checked), [false, true]);
  ck('変更していないと伝える', /変更していません/.test(box.textContent), true);

  console.log('\n===== 管理者でないときは選べない =====');
  listReply = { ok: true, approval_policy: 'required', is_admin: false, requests: [] };
  global.txwApprovalPolicyValue = null;
  await loadPolicy();
  const box2 = document.getElementById('txwApprovalPolicyBox');
  ck('全部押せない', box2.querySelectorAll('INPUT').map((r) => !!r.attrs.disabled), [true, true]);
  ck('理由を書いてある', /変えられるのは管理者だけです/.test(box2.textContent), true);

  console.log('\n===== 結果 =====');
  console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
  process.exit(ng === 0 ? 0 : 1);
})();
