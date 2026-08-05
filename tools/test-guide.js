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

/* ⚠ タブの番号は**通し番号**にすること。
 *   以前は設計段階の番号をそのまま出していて ①②③④⑤⑨⑩ と穴が空いており、
 *   「⑥⑦⑧はないの？」と聞かれた（2026-08-05）。作らなかった機能の番号が
 *   画面に残っていると、壊れている・足りないように見える。
 *   番号を持つのは毎日使うタブだけ。設定系（税理士の管理）と使い方は番号を持たない。 */
console.log('\n===== タブの番号が通しになっているか =====');
const tabLabels = [...h.matchAll(/class="tab-btn[^"]*"[^>]*>([^<]+)</g)].map((m) => m[1].trim());
ck('タブの並び: ' + tabLabels.join(' / '), true);
const numbered = tabLabels.filter((t) => /^[①-⑩]/.test(t));
const CIRCLE = '①②③④⑤⑥⑦⑧⑨⑩';
ck('番号が①から順に連続している',
  numbered.every((t, i) => t.charAt(0) === CIRCLE.charAt(i)));
ck('番号を持たないのは「税理士の管理」と「使い方」だけ',
  tabLabels.filter((t) => !/^[①-⑩]/.test(t)).sort().join(',') === '使い方,税理士の管理');
ck('作らなかった機能の番号（⑦⑧⑨⑩）が画面に残っていない', !/[⑦⑧⑨⑩]/.test(h));

/* ログイン前に読めるのは「はじめてのログイン」だけ。
 * ここが無いと、はじめての方は何も読めないまま詰まる。 */
console.log('\n===== ログイン前に読める案内 =====');
const gate = h.slice(h.indexOf('id="txwGate"'), h.indexOf('id="txwApp"'));
ck('ログイン画面に「はじめてお使いの方へ」がある', /はじめてお使いの方へ/.test(gate));
ck('招待リンク→新規登録→ログインの順を書いてある',
  /招待リンク[\s\S]{0,200}新規登録[\s\S]{0,200}ログイン/.test(gate));
ck('2回目からはログインだけでよいと書いてある', /2回目からは/.test(gate));
ck('招待リンクが使えないときの案内がある', /再発行/.test(gate));
ck('図つきガイドへのリンクがある', /tax-guide\.html/.test(gate));
/* ログイン前に出すのは手順だけ。操作の説明（図つきガイド）はログイン後のタブで読む。 */
ck('ログイン前に操作の説明までは出していない',
  gate.indexOf('毎月の進め方') < 0 && gate.indexOf('<iframe') < 0);

console.log('\n===== マークアップが壊れていないか =====');
const pair = (o, c) => ((h.match(o) || []).length === (h.match(c) || []).length);
ck('section の開閉', pair(/<section/g, /<\/section>/g));
ck('table の開閉', pair(/<table/g, /<\/table>/g));
ck('ul の開閉', pair(/<ul>/g, /<\/ul>/g));
ck('ol の開閉', pair(/<ol>/g, /<\/ol>/g));
ck('details の開閉', pair(/<details/g, /<\/details>/g));

/* 使い方タブは、図つきガイド(tax-guide.html)をそのまま読み込む形にした。
 * ⚠ 文字版を別に持たないこと。同じ説明を2箇所に置くと必ずずれる
 *   （実際、図つきガイドが Phase 3 のまま1年分古くなっていた・2026-08-05）。 */
console.log('\n===== 使い方タブは図つきガイドを読み込んでいるか =====');
const guideTab = h.slice(h.indexOf('id="t-guide"'), h.lastIndexOf('footer-badge'));
ck('本文が取れている', guideTab.length > 200);
ck('図つきガイドを読み込んでいる', /<iframe[^>]*src="tax-guide\.html"/.test(guideTab));
ck('別の画面で開くリンクもある', /href="tax-guide\.html"[^>]*target="_blank"/.test(guideTab));
ck('表示できないときの逃げ道がある', /うまく表示されないとき/.test(guideTab));
/* スクロールしなくても目に入る位置に、取り消せない操作を出しておく */
ck('やり直せない操作をタブの先頭に出している',
  /note danger[\s\S]{0,200}やり直せない操作が2つあります/.test(guideTab));
ck('証憑は取り消せないと書いてある', /証憑は取り消せません/.test(guideTab));
ck('仕訳はMFの仕訳帳から削除と書いてある', /MFの仕訳帳から削除/.test(guideTab));
/* 文字版の重複が残っていないこと（残すと二重管理になる） */
ck('文字版の重複が残っていない', h.indexOf('毎月の進め方') < 0);

/* ---------------- 図つきのご利用ガイド（tax-guide.html） ----------------
 * ⚠ こちらは税理士さまへお渡しする方の説明。画面より先に古くなる。
 *   実際、Phase 3 のまま止まっていて ⑤月次チェック・⑥承認待ち・
 *   管理者/担当者・対象外・「仕訳を選んで添付」が**どれも載っていなかった**
 *   （2026-08-05に指摘されて発覚）。機能を足したらここも直すこと。 */
const g = fs.readFileSync(path.join(__dirname, '..', 'tax-guide.html'), 'utf8');

console.log('\n===== 図つきガイド: 組み立て =====');
const gpair = (o, c) => ((g.match(o) || []).length === (g.match(c) || []).length);
ck('section の開閉', gpair(/<section/g, /<\/section>/g));
ck('div の開閉', gpair(/<div[ >]/g, /<\/div>/g));
ck('table の開閉', gpair(/<table/g, /<\/table>/g));
const toc = [...g.matchAll(/href="#(s\d+)"/g)].map((m) => m[1]);
const ids = [...g.matchAll(/<section class="sec" id="(s\d+)"/g)].map((m) => m[1]);
ck('目次とセクションが1対1（' + ids.join(', ') + '）',
  toc.length === ids.length && toc.every((t) => ids.indexOf(t) >= 0));
const nums = [...g.matchAll(/<span class="sec-num">(\d+)<\/span>/g)].map((m) => +m[1]);
ck('章番号が連番（' + nums.join(',') + '）', nums.every((n, i) => n === i + 1));

console.log('\n===== 図つきガイド: 今の機能が載っているか =====');
[
  ['⑤月次チェックの章', /⑤ 月次チェック/],
  ['⑥承認待ち', /⑥ 承認待ち/],
  ['管理者と担当者', /管理者と担当者/],
  ['対象外の戻し方', /対象外を解除/],
  ['仕訳を選んで添付', /仕訳を選んで添付/],
  ['すでに証憑がある仕訳には付けられない', /証憑あり/],
  ['貸借対照表の確認', /貸借対照表の確認/],
  ['事業区分別の課税売上高', /事業区分別の課税売上高/],
  ['証憑は取り消せない', /証憑をMFへ送ると、取り消せません/],
  ['仕訳の取り消しを作っていない理由', /あえて作っていません/],
  ['一種か二種かの正誤は判定できない', /正誤は判定できません/],
  ['5,000万円の判断はしない', /5,000万円を超えるかどうかの判断はしません/],
  ['「取得できませんでした」の意味', /「無い」ではなく「確認できていない」/],
  ['提案が入らないときの理由', /提案の根拠」の欄に理由が出ます/],
  ['画面の「使い方」タブへの言及', /「使い方」タブ/],
].forEach(([l, re]) => ck(l, re.test(g)));

console.log('\n===== 図つきガイド: 古い記述が残っていないか =====');
ck('設定の希望を聞く文が消えている（今は画面で変えられる）',
  !/どちらがよいか、ご希望をお知らせください/.test(g));
ck('タブの図に⑤⑥が入っている', /mock-tab">⑤ 月次チェック</.test(g));
ck('画面からガイドへリンクがある', /href="tax-guide\.html"/.test(h));

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
