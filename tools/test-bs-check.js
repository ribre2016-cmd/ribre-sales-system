// ⑨月次チェックのBS（貸借対照表）側の判定を、MFから実際に取った推移表で検証する。
// 10人の税理士のうち5人が「BSを見ていないのが最大の空白」と指摘した対応（2026-08-04）。
//
// 実行: node tools/test-bs-check.js
'use strict';

const SEP = String.fromCharCode(10);

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
function load(head) { return eval('(' + pick(head) + ')'); }  // eslint-disable-line no-eval

/* 定数は本体のソースから読み取って global に置く。
 * eval した関数は素の名前で参照するので、テスト側でハードコードすると
 * 本体を直したときにテストだけ古い値のまま通ってしまう。必ずソースから取ること。 */
const setSrc = /const BS_STATIC_PARENTS = new Set\(\[([\s\S]*?)\]\);/.exec(src);
if (!setSrc) throw new Error('BS_STATIC_PARENTS が見つからない');
global.BS_STATIC_PARENTS = new Set(setSrc[1].match(/'([^']+)'/g).map((x) => x.replace(/'/g, '')));

const reSrc = new RegExp('const BS_CONTRA_RE = (\\/[^\\n]+\\/);').exec(src);
if (!reSrc) throw new Error('BS_CONTRA_RE が見つからない');
global.BS_CONTRA_RE = eval(reSrc[1]);   // eslint-disable-line no-eval

const flattenReportRows = load('function flattenReportRows(');
const analyzeBalanceSheet = load('function analyzeBalanceSheet(');
console.log('本体から読んだ除外設定: ' + Array.from(global.BS_STATIC_PARENTS).join(' / '));
console.log('評価勘定の判定: ' + global.BS_CONTRA_RE);
console.log('');

/* MF の GET /api/v3/reports/transition_bs から実際に返ってきた形（2026年3〜7月）。
 * 金額はすべて実データ。 */
function acct(name, values) { return { name, type: 'account', values, rows: null }; }
function item(name, rows) { return { name, type: 'financial_statement_item', rows, values: [] }; }

const report = {
  columns: ['3', '4', '5', '6', '7'],
  rows: [
    { name: '資産の部合計', type: 'assets', rows: [
      item('流動資産合計', [
        item('現金及び預金合計', [
          acct('現金', [760350, 633457, 991171, 872711, 625911]),
          acct('普通預金', [12918286, 13381224, 11244387, 10350206, 9836721]),
        ]),
        item('売上債権合計', [
          acct('売掛金', [877058, 924151, 1248977, 1158542, 200]),
          acct('貸倒引当金', [-8000, -8000, -8000, -8000, -8000]),
        ]),
        item('棚卸資産合計', [
          acct('商品', [2061000, 2061000, 2061000, 2061000, 2061000]),
        ]),
        item('その他流動資産合計', [
          acct('立替金', [14800, 0, 0, 0, 0]),
          acct('前払費用', [198000, 198000, 644600, 644600, 842600]),
        ]),
      ]),
      item('固定資産合計', [
        item('投資その他の資産合計', [
          acct('出資金', [10000, 10000, 10000, 10000, 10000]),
          acct('敷金', [594000, 594000, 594000, 594000, 594000]),
          acct('預託金', [24960, 24960, 24960, 24960, 24960]),
        ]),
      ]),
    ] },
    { name: '負債の部合計', type: 'liabilities', rows: [
      item('流動負債合計', [
        item('その他流動負債合計', [
          acct('短期借入金', [500000, 0, 0, 0, 0]),
          acct('未払金', [1445147, 1910945, 2852832, 1952466, 1348606]),
          acct('預り金', [5692, 28185, -92524, 95132, -39530]),
        ]),
      ]),
      item('固定負債合計', [
        acct('長期借入金', [21280000, 20947000, 20614000, 20281000, 20281000]),
      ]),
    ] },
    { name: '純資産の部合計', type: 'net_assets', rows: [
      item('株主資本合計', [
        item('資本金合計', [acct('資本金', [100000, 100000, 100000, 100000, 100000])]),
        item('利益剰余金合計', [
          acct('繰越利益剰余金', [-1724492, -2357496, -3434372, -3816397, -4798502]),
        ]),
      ]),
    ] },
  ],
};

const flat = flattenReportRows(report.rows, '', [], '');
const idx = 4;      // 7月
const r = analyzeBalanceSheet(flat, idx, 4);

let ng = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + label + ' → ' + JSON.stringify(got)
    + (ok ? '' : '（期待: ' + JSON.stringify(want) + '）'));
}

console.log('===== (a) 何ヶ月も1円も動いていない科目 =====');
r.frozen.forEach((f) => console.log('   ' + f.account + '（' + f.parent + '）' + f.value + '円 ×' + f.months + 'ヶ月'));
check('商品(在庫)だけを拾う', r.frozen.map((f) => f.account), ['商品']);
console.log('   ※ 資本金・敷金・出資金・預託金は「動かなくて当たり前」なので除外している');
console.log('   ※ 貸倒引当金は評価勘定なので除外している');

console.log('\n===== (b) 残高がマイナスの科目 =====');
r.negative.forEach((n) => console.log('   ' + n.account + ' ' + n.value + '円'));
check('預り金だけを拾う（貸倒引当金は評価勘定なので除外）', r.negative.map((n) => n.account), ['預り金']);

console.log('\n===== (d) 純資産がマイナス（債務超過の状態） =====');
r.equity.forEach((e) => console.log('   ' + e.account + ' ' + e.value + '円'));
check('繰越利益剰余金を拾う', r.equity.map((e) => e.account), ['繰越利益剰余金']);

console.log('\n===== (c) 前月から大きく動いた科目 =====');
r.changed.forEach((c) => console.log('   ' + c.account + ' ' + c.prev + ' → ' + c.value));
check('売掛金を拾う', r.changed.map((c) => c.account), ['売掛金']);
console.log('   ※ 7月は登録が途中なので、実際の画面ではこれと(b)(d)は伏せて件数だけ伝える');

console.log('\n===== 6月（登録が完了している月）で見た場合 =====');
const r6 = analyzeBalanceSheet(flat, 3, 3);
console.log('   動いていない: ' + r6.frozen.map((f) => f.account).join(', '));
console.log('   マイナス: ' + (r6.negative.map((n) => n.account).join(', ') || 'なし'));
console.log('   純資産マイナス: ' + r6.equity.map((e) => e.account).join(', '));
check('6月も商品を拾う', r6.frozen.map((f) => f.account), ['商品']);

/* ---- 簡易課税の事業区分別・課税売上高 ----
 * 消費税の専門家と元国税の2人が独立に1位へ挙げた項目（2026-08-04）。 */
// 定数は本体から読む（テストにハードコードすると本体を直しても気づけない）
const salesReSrc = new RegExp('const SALES_TAX_RE = (\/[^\n]+\/);').exec(src);
if (!salesReSrc) throw new Error('SALES_TAX_RE が見つからない');
global.SALES_TAX_RE = eval(salesReSrc[1]);
const summarizeSalesByTax = load('function summarizeSalesByTax(');
console.log(SEP + '===== 事業区分（一種／二種）別の課税売上高 =====');
function JS(date, taxName, value, taxValue) {
  return { transaction_date: date, branches: [{ remark: '売上',
    debitor: { account_id: 'A', account_name: '売掛金', tax_name: '対象外' },
    creditor: { account_id: 'S', account_name: '売上高', tax_name: taxName, value, tax_value: taxValue } }] };
}
const salesJournals = [
  JS('2026-05-31', '課売 10% 二種', 2000000, 200000),
  JS('2026-05-31', '課売 10% 一種', 500000, 50000),
  JS('2026-06-30', '課売 10% 二種', 2400000, 240000),
  JS('2026-06-30', '課売 10% 一種', 600000, 60000),
  JS('2026-07-31', '課売 10% 一種', 2700000, 270000),   // 構成が逆転（区分の付け間違いの疑い）
  JS('2026-07-31', '課売 10% 二種', 300000, 30000),
  JS('2026-07-31', '対象外', 999999, 0),                 // 売上でない税区分は数えない
];
const sum = summarizeSalesByTax(salesJournals, ['2026-05', '2026-06', '2026-07']);
sum.rows.forEach(function (r) {
  console.log('   ' + r.tax_name + ': ' + r.values.map(function (v) { return v.toLocaleString(); }).join(' / '));
});
console.log('   合計: ' + sum.totals.map(function (v) { return v.toLocaleString(); }).join(' / '));
check('税込で合計している（5月の二種=2,200,000）', sum.rows.filter(function(r){return r.tax_name==='課売 10% 二種';})[0].values[0], 2200000);
check('売上でない税区分は数えない（7月合計=3,300,000）', sum.totals[2], 3300000);
check('構成比が大きく動いたら知らせる', !!sum.shift, true);
if (sum.shift) {
  sum.shift.forEach(function (x) {
    console.log('   → ' + x.tax_name + ' の構成比 '
      + Math.round(x.prev_ratio * 100) + '% → ' + Math.round(x.ratio * 100) + '%');
  });
}
console.log('   ※ どちらが正しいかはAPIでは判定できない。金額と構成の変化までが機械の仕事');

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
