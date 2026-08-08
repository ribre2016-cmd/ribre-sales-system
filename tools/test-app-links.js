// 売上管理表 → 税理士ワークスペース への導線を検証する。
//
// なぜ必要か:
//   ・別タブで開かないと、税理士ワークスペースは別ログインなので
//     売上管理表に戻れず迷子になる。
//   ・逆向き（税理士ワークスペース → 売上管理表）は**意図的に塞いである**。
//     税理士に売上管理表を見せないため。うっかりリンクを足すと設計が壊れる。
//
// 実行: node tools/test-app-links.js
'use strict';

const fs = require('fs');
const path = require('path');
const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const txw = fs.readFileSync(path.join(__dirname, '..', 'tax-workspace.html'), 'utf8');

let ng = 0;
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

console.log('===== 売上管理表 → 税理士ワークスペース =====');
const links = [...index.matchAll(/<a[^>]*href="\/tax-workspace"[^>]*>/g)].map((m) => m[0]);
ck('リンクがある（証憑ページとホームの2本）', links.length, 2);
/* ⚠ 別タブで開くこと。あちらは税理士アカウントでのログインが要るため、
 *   同じタブで開くと売上管理表に戻れない。 */
ck('すべて別タブで開く', links.every((l) => /target="_blank"/.test(l)), true);
ck('すべて noopener（開いた先から元の画面を操作させない）',
  links.every((l) => /rel="noopener noreferrer"/.test(l)), true);

console.log('\n===== 置き場所 =====');
const ev = index.slice(index.indexOf('id="page-evidence"'), index.indexOf('id="page-analysis"'));
ck('証憑ページの中にある', /href="\/tax-workspace"/.test(ev), true);
ck('証憑インボックスの次に並ぶ', ev.indexOf('/mf-evidence') < ev.indexOf('/tax-workspace'), true);
ck('見出しがある', /<h2>税理士ワークスペース<\/h2>/.test(ev), true);
ck('何をする画面か書いてある', /未仕訳の明細の登録・証憑の添付・月次チェック/.test(ev), true);
ck('別タブで開くと断ってある', /別のタブで開きます/.test(ev), true);

const home = index.slice(index.indexOf('id="page-home"'), index.indexOf('id="page-ledger"'));
const qa = home.slice(home.indexOf('quick-actions'), home.indexOf('</div>', home.indexOf('quick-actions')));
ck('ホームのクイックアクションにもある', /href="\/tax-workspace"/.test(qa), true);

console.log('\n===== マークアップが壊れていないか =====');
const pair = (o, c) => ((index.match(o) || []).length === (index.match(c) || []).length);
ck('div の開閉', pair(/<div[ >]/g, /<\/div>/g), true);
ck('section の開閉', pair(/<section/g, /<\/section>/g), true);
ck('a の開閉', pair(/<a[ >]/g, /<\/a>/g), true);

/* ⚠ ここは「無いこと」を守る検査。
 *   税理士ワークスペースから売上管理表へ戻れるようにしてはいけない。 */
console.log('\n===== 逆向きは塞いだままか（税理士に売上管理表を見せない） =====');
ck('税理士ワークスペースに売上管理表へのリンクが無い',
  /href="\/"|href="\/index|href="index\.html"/.test(txw), false);
ck('その旨がログイン画面に書いてある',
  /売上管理システム本体へはこのページからは移動できません/.test(txw), true);

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
