// 2026-08-05〜06 の4人レビューで見つかった不具合の修正を固定する。
//
// なぜ必要か:
//   どれも「壊れていても画面は普通に見える」種類の不具合だった。
//   （記録が残っていないのに「記録しました」／判定していないのに「該当なし」／
//     税区分が抜けても登録成功／古い月のデータが新しい月として見える）
//   目視では気づけないので、必ず自動で確かめる。
//
// 実行: node tools/test-review-fixes.js
'use strict';

const fs = require('fs');
const path = require('path');
const R = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const api = R('api', 'mf', 'tax-workspace.js');
const ui = R('pages', 'tax-workspace.js');
const html = R('tax-workspace.html');

let ng = 0;
function has(label, src, re) {
  const ok = re.test(src);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label);
}
function ck(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

console.log('===== ① 確認の記録が一件も残っていなかった =====');
has('列名は actor_email（advisor_email は存在しない列）', api, /^(?![\s\S]*advisor_email:)[\s\S]*$/);
has('recordAction が res.ok を見る', api, /if \(!res\.ok\) \{[\s\S]{0,300}return false;/);
has('recordAction が成否を返す', api, /return true;\s*\n\s*\} catch \(e\) \{[\s\S]{0,200}return false;/);
has('記録できなければ「記録しました」と返さない', api, /if \(!recorded\) \{[\s\S]{0,120}'record_failed'/);
has('画面に record_failed の文言がある', ui, /record_failed/);

console.log('\n===== ①b 重い操作に記録が無かった =====');
['invite_create', 'invite_revoke', 'advisor_set_enabled'].forEach((a) => {
  has(a + ' を記録する', api, new RegExp("action: '" + a + "'"));
});
has('一覧の表示（読むだけ）は記録しない', api, /^(?![\s\S]*action: 'invite_list')[\s\S]*$/);

console.log('\n===== ② 事業区分の集計が消える・期間が切れる =====');
has('対象月の末日まで取り直す', api, /const salesEnd = range\.end;/);
has('提案用の取得が足りないときだけ取り直す', api, /!suggestEnd \|\| suggestEnd < salesEnd/);
has('会計年度をまたがない経路を通る', api, /salesJournals = await fetchJournalsForSuggest\(\{/);
has('取れなければ集計を出さない（0件と言わない）', api, /salesJournals = null;/);
has('集計は取り直した仕訳を使う', api, /summarizeSalesByTax\(salesJournals, monthsBack\)/);

console.log('\n===== ③ 期首は判定していないのに「該当なし」に見えた =====');
has('比較できた月数を返す', api, /lookback_available: Math\.max\(0, idx\)/);
has('足りているかを返す', api, /lookback_enough: idx >= MC_DEFAULTS\.lookback/);
has('画面に断り書きを出す関数がある', ui, /function txwRenderMonthlyLookbackNote\(/);
has('月次チェックの描画から呼ぶ', ui, /txwRenderMonthlyLookbackNote\(data\);/);
has('置き場所がHTMLにある', html, /id="txwMonthlyLookbackNote"/);
has('「異常なしではない」と書いてある', ui, /「異常なし」ではありません/);
has('動いている判定も書いてある', ui, /残高のマイナス・純資産のマイナス・符号の確認・事業区分の集計/);

console.log('\n===== ④ 税区分が黙って未指定で登録されていた =====');
has('カード表示で税区分も見る', ui, /var okTax = !taxText \|\| !!txwResolveId\(txwTaxLookup, taxText\);/);
ck('一覧表示とカード表示の両方に判定がある', (ui.match(/var okTax = /g) || []).length, 2);
ck('両方の経路が tax_text を送る', (ui.match(/payload\.tax_text = /g) || []).length, 2);
has('サーバーでも弾く（画面は迂回できる）', api, /if \(taxText && !body\.tax_id\) \{[\s\S]{0,400}'tax_not_resolved'/);
has('弾いたことも操作履歴に残す', api, /error_message: 'tax_not_resolved'/);
has('承認の往復でも tax_text を落とさない', api, /tax_text: p\.tax_text/);
has('画面に日本語の理由がある', ui, /tax_not_resolved: '税区分が候補と一致していません/);

console.log('\n===== ⑤ 履歴の閲覧範囲が画面とCSVで違った =====');
has('CSVも社内メンバー基準にそろえる', api, /handleActionLogCsv\(res, advisor, isMember, body\)/);
has('引数名を実態に合わせた', api, /async function handleActionLogCsv\(res, advisor, canSeeAll, body\)/);
has('isAdmin では絞らない', api, /if \(!canSeeAll\) base \+= /);

console.log('\n===== ⑥ 古い月の応答が新しい月を上書きした =====');
has('世代番号がある', ui, /var txwLoadGen = 0;/);
has('読み込みごとに増やす', ui, /txwLoadGen \+= 1;\s*\n\s*var myGen = txwLoadGen;/);
ck('応答と失敗の両方で古いものを捨てる', (ui.match(/myGen !== txwLoadGen/g) || []).length, 2);

console.log('\n===== ⑦ 「今日」がUTCで、日本時間の朝までズレた =====');
has('JSTの共通関数がある', api, /function todayJst\(\)/);
has('月が途中かの判定が使う', api, /return todayJst\(\) <= monthEnd;/);
has('期の判定も使う', api, /const today = todayJst\(\);/);
has('生のUTC判定が残っていない', api, /^(?![\s\S]*new Date\(\)\.toISOString\(\)\.slice\(0, 10\))[\s\S]*$/);

/* ---- JSTの境界を実際に動かす ---- */
console.log('\n===== ⑦b 月末の境界を実駆動 =====');
{
  const seg = /function todayJst\(\) \{[\s\S]*?\n\}/.exec(api)[0];
  const todayJst = eval('(' + seg + ')');
  const realNow = Date.now;
  // 2026-08-01 03:00 JST = 2026-07-31 18:00 UTC
  Date.now = () => Date.UTC(2026, 6, 31, 18, 0, 0);
  ck('8/1 03:00 JST は 2026-08-01 と数える', todayJst(), '2026-08-01');
  const inProg = eval('(' + /function isMonthInProgress\(monthEnd\) \{[\s\S]*?\n\}/.exec(api)[0].replace('todayJst()', JSON.stringify(todayJst())) + ')');
  ck('その時刻に7月は「途中」ではない', inProg('2026-07-31'), false);
  // 7/31 23:00 JST = 7/31 14:00 UTC
  Date.now = () => Date.UTC(2026, 6, 31, 14, 0, 0);
  ck('7/31 23:00 JST は 2026-07-31 と数える', todayJst(), '2026-07-31');
  const inProg2 = eval('(' + /function isMonthInProgress\(monthEnd\) \{[\s\S]*?\n\}/.exec(api)[0].replace('todayJst()', JSON.stringify(todayJst())) + ')');
  ck('その時刻の7月は「途中」', inProg2('2026-07-31'), true);
  Date.now = realNow;
}

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
