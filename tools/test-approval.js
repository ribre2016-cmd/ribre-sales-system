// 承認ワークフローと役割の判定を検証する。
// 権限の判定を誤ると「担当者が承認なしで本番の帳簿に書ける」事故になるため、
// ここは必ず自動で確かめる。
//
// 実行: node tools/test-approval.js
'use strict';

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'api', 'mf', 'tax-workspace.js'), 'utf8');

function pick(head) {
  const i = src.indexOf(head);
  if (i < 0) throw new Error('見つからない: ' + head);
  const rest = src.slice(i);
  const end = rest.indexOf('\n}\n');
  if (end < 0) throw new Error('終端が見つからない: ' + head);
  return rest.slice(0, end + 3);
}

// 'use strict' のもとでは eval が独自スコープを作るので、関数式として評価して受け取る
function load(head) { return eval('(' + pick(head) + ')'); }  // eslint-disable-line no-eval
const isAdvisorAdmin = load('function isAdvisorAdmin(');
const txSnapshot = load('function txSnapshot(');
const sameSnapshot = load('function sameSnapshot(');

let ng = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + '  → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

console.log('===== 役割の判定 =====');
check('社内メンバーは常にadmin', isAdvisorAdmin({ role: 'staff' }, true), true);
check('roleがadminならadmin', isAdvisorAdmin({ role: 'admin' }, false), true);
check('roleがstaffならadminでない', isAdvisorAdmin({ role: 'staff' }, false), false);
check('roleが無ければadminでない', isAdvisorAdmin({}, false), false);
check('roleがnullでもadminでない', isAdvisorAdmin({ role: null }, false), false);
check('advisorがnullでもadminでない', isAdvisorAdmin(null, false), false);
// 文字列 'true' のような紛らわしい値で昇格しないこと
check('roleが"true"でもadminでない', isAdvisorAdmin({ role: 'true' }, false), false);

console.log('\n===== 依頼時と承認時の明細の突き合わせ =====');
const tx = { date: '2026-07-31', value: 9460, content: '振替 セコム', journalizing_status: 'none' };
const snap = txSnapshot(tx);
check('スナップショットの中身', snap, { date: '2026-07-31', value: 9460, content: '振替 セコム' });
check('同じなら一致', sameSnapshot(snap, txSnapshot(tx)), true);
check('金額が変わったら不一致',
  sameSnapshot(snap, txSnapshot({ date: '2026-07-31', value: 9999, content: '振替 セコム' })), false);
check('日付が変わったら不一致',
  sameSnapshot(snap, txSnapshot({ date: '2026-08-01', value: 9460, content: '振替 セコム' })), false);
check('摘要が変わったら不一致',
  sameSnapshot(snap, txSnapshot({ date: '2026-07-31', value: 9460, content: '振替 セコム(変更)' })), false);
check('片方が無ければ不一致（安全側）', sameSnapshot(snap, null), false);
check('両方無くても一致にしない', sameSnapshot(null, null), false);

console.log('\n===== コードの作りの確認（読み違えを防ぐ） =====');
function has(label, re) {
  const ok = re.test(src);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}
has('承認・差し戻しはadminのみ（サーバー側で弾く）',
  /if \(!isAdmin\) \{ res\.status\(403\)\.json\(\{ ok: false, error: 'admin_only' \}\); return; \}/);
has('adminの登録は承認を飛ばす（自分が承認者のため）', /if \(!skipApproval && !isAdmin\)/);
has('承認の実行時に明細の変化を検知して止める', /transaction_changed/);
has('二重承認を防ぐ（pendingのときだけ更新）', /status=eq\.pending/);
has('差し戻しの理由は必須', /reason_required/);
has('インボイス区分は承認待ちに積む前にも必須', /invoice_kind_required/);
has('承認・差し戻しも操作履歴に残す', /action: 'approve_journalize'[\s\S]*action: 'reject_journalize'/);
has('CSVはBOM付き（Excelで文字化けしない）', /String\.fromCharCode\(65279\)/);
has('CSVはadminなら全件・staffは自分の分だけ', /if \(!isAdmin\) url \+= `&actor_email=eq\./);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
