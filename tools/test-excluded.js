// ⑨月次チェックの「対象外にされた明細」の扱いを検証する。
//
// P7-B の実測（2026-08-05）で分かったこと:
//   明細から作った仕訳をAPIで削除すると、明細は未仕訳(none)ではなく対象外(excluded)になる。
//   対象外は**未仕訳の件数に入らない**ので、これを出さないと⑨は
//   「未仕訳0件＝登録が終わった」と表示してしまう。実際は帳簿から抜けている。
//
// ここが壊れると「登録完了」に見えたまま帳簿から抜けるので、必ず自動で確かめる。
//
// 実行: node tools/test-excluded.js
'use strict';

const fs = require('fs');
const path = require('path');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'mf', 'tax-workspace.js'), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, '..', 'pages', 'tax-workspace.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');

let ng = 0;
function has(label, src, re) {
  const ok = re.test(src);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}

console.log('===== サーバー側 =====');
has('対象外の明細を取りにいく', api, /journalizing_statuses', status\)|status: 'excluded'/);
has('excluded を応答に入れる', api, /\n    excluded,/);
has('取得できなかったときは available:false と理由を返す（0件と混同しない）',
  api, /available: false, count: 0, rows: \[\],[\s\S]{0,120}reason:/);
has('並べる件数に上限があり、超えたら truncated で伝える', api, /MC_EXCLUDED_MAX[\s\S]{0,200}truncated:/);
has('未仕訳の取得(none固定)とは別の関数にしている', api, /async function fetchTransactionsByStatus\(/);

// 上限の値はソースから読む（テストにハードコードすると本体を直しても気づけない）
const maxSrc = /const MC_EXCLUDED_MAX = (\d+);/.exec(api);
if (!maxSrc) { ng++; console.log('  × MC_EXCLUDED_MAX が見つからない'); }
else console.log('  ○ 並べる上限は ' + maxSrc[1] + '件');

console.log('\n===== 画面側 =====');
has('対象外を描く関数がある', ui, /function txwRenderMonthlyExcluded\(/);
has('月次チェックの描画から呼んでいる', ui, /txwRenderMonthlyExcluded\(data\);/);
has('置き場所がHTMLにある', html, /id="txwMonthlyExcludedBox"/);
has('0件のときは何も出さない', ui, /if \(count === 0\) \{ box\.style\.display = 'none'; return; \}/);
has('取得できなかったときは「0件という意味ではありません」と言う', ui, /0件という意味ではありません/);
has('未仕訳にも仕訳帳にも出ないことを書いている', ui, /未仕訳にも仕訳帳にも出てこない/);
has('正誤の判定はしないと明記している', ui, /正しいかどうかの判定はしません/);
has('MFのどこで解除するかを案内している', ui, /登録済一覧[\s\S]{0,60}対象外を解除/);
has('この画面からは戻せないと書いている', ui, /この画面からは戻せません/);

/* いちばん大事な一点。
 * 対象外があるのに「登録は終わっています」と言い切ってはいけない。 */
console.log('\n===== 「登録は終わっています」の言い切りを止めているか =====');
const doneBlock = /registration_done === true\) \{([\s\S]{0,700}?)\n  \}/.exec(ui);
if (!doneBlock) { ng++; console.log('  × 判定箇所が見つからない'); }
else {
  const b = doneBlock[1];
  has('対象外の件数を見ている', b, /excluded[\s\S]{0,40}count/);
  has('対象外があるときは件数を言う', b, /対象外」にされた明細が' \+ exCount/);
  has('対象外があるときは「帳簿に入っていません」と言う', b, /帳簿に入っていません/);
  const t = /\? '[\s\S]*?'\n\s*: '(.*?)'/.exec(b);
  has('「登録は終わっています」は対象外が0件のときだけ', b,
    /exCount > 0[\s\S]{0,200}: '登録は終わっています。'/);
}

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
