// 「使い方」タブの配線と、書いてあるべきことを検証する。
//
// なぜ必要か:
//   使い方の説明は、機能を直したときに**いちばん先に古くなる**。
//   画面と説明がずれると、税理士が説明のとおりに操作して困ることになる。
//   とくに「取り消せない」「判定はしない」は、抜けると実害が出るので固定する。
//
// 実行: node tools/test-guide.js
'use strict';

const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');

let ng = 0;
function ck(label, ok) {
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}

console.log('===== タブの配線 =====');
ck('タブのボタンがある', /data-t="guide"/.test(h));
ck('タブの中身がある', /id="t-guide"/.test(h));
const tabs = [...h.matchAll(/data-t="([a-z]+)"/g)].map((m) => m[1]);
const pages = [...h.matchAll(/id="t-([a-z]+)"/g)].map((m) => m[1]);
ck('タブとページが1対1（' + tabs.join(', ') + '）',
  tabs.length === pages.length && tabs.every((t) => pages.indexOf(t) >= 0));

console.log('\n===== マークアップが壊れていないか =====');
const pair = (o, c) => ((h.match(o) || []).length === (h.match(c) || []).length);
ck('section の開閉', pair(/<section/g, /<\/section>/g));
ck('table の開閉', pair(/<table/g, /<\/table>/g));
ck('ul の開閉', pair(/<ul>/g, /<\/ul>/g));
ck('ol の開閉', pair(/<ol>/g, /<\/ol>/g));
ck('details の開閉', pair(/<details/g, /<\/details>/g));

/* ⚠ footer-badge はCSSにも出てくるので lastIndexOf を使う。
 *   indexOf だと本文が空になり、**中身を見ずに全部×になる**（実際にやらかした）。 */
const guide = h.slice(h.indexOf('id="t-guide"'), h.lastIndexOf('footer-badge'));
ck('本文が取れている（1000文字以上）', guide.length > 1000);

console.log('\n===== 抜けると実害が出ること =====');
[
  ['MFの代わりではないと書いてある', /マネーフォワードの代わりではありません/],
  ['毎月の進め方がある', /毎月の進め方/],
  ['証憑をMFへ送ると取り消せない', /証憑をMFへ送ると、取り消せません/],
  ['仕訳の取り消しを作っていない理由', /あえて作っていません/],
  ['間違えたらMFの仕訳帳から削除する', /MFの仕訳帳から削除/],
  ['提案は正解ではないと書いてある', /正しいかどうかの判定はしません/],
  ['一種か二種かの正誤は判定できない', /一種か二種かの正誤を判定できません/],
  ['5,000万円の判断はしない', /5,000万円を超えるかどうかの判断はしません/],
  ['「取得できませんでした」＝無いではない', /確認できていない」という意味/],
  ['対象外の戻し方（MFの画面）', /対象外を解除/],
  ['②の証憑を消したいときはRIBREへ', /RIBREへご連絡ください/],
  ['提案が入らないときの理由の見方', /提案の根拠」に理由が出ます/],
  ['管理者と担当者の違い', /管理者と担当者/],
  ['一括登録は無いと書いてある', /一括登録はありません/],
  ['現金払いは①に出ないと書いてある', /現金払いはそもそも/],
].forEach(([l, re]) => ck(l, re.test(guide)));

console.log('\n===== 説明と画面がずれていないか =====');
// 使い方に出したタブ名が、実際のタブにあること
[['①未仕訳の明細', '① 未仕訳の明細'], ['②仕訳待ちの証憑', '② 仕訳待ちの証憑'],
 ['③共有ファイル', '③ 共有ファイル'], ['④操作履歴', '④ 操作履歴'],
 ['⑨月次チェック', '⑨ 月次チェック'], ['⑩承認待ち', '⑩ 承認待ち']].forEach(([inGuide, inTab]) => {
  ck('「' + inGuide + '」は実際のタブにある', guide.indexOf(inGuide) >= 0 && h.indexOf(inTab) >= 0);
});
// もうSQLの案内は残っていないこと
ck('SQLを実行させる案内が残っていない', h.indexOf('SQL') < 0);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
