// ⑨月次チェックの判定ロジックを、MFから実際に取った推移表(2026年3〜7月)で検証する。
// tax-workspace.js の関数と同じ実装をここに写して単体で確かめる（本番コードは触らない）。
const path = require('path');
const src = require('fs').readFileSync(
  path.join('C:', 'Users', 'ksado', 'projects', 'ribre-sales-system', 'api', 'mf', 'tax-workspace.js'),
  'utf8'
);

// 検証対象の関数だけを取り出して評価する
function extract(name) {
  const re = new RegExp('function ' + name + '\\([\\s\\S]*?\\n}\\n', 'm');
  const m = re.exec(src);
  if (!m) throw new Error('見つからない: ' + name);
  return m[0];
}
const code = extract('flattenReportRows') + extract('median');
eval(code);

// --- MF の GET /reports/transition_pl から実際に返ってきた形（3〜7月・抜粋） ---
const report = {
  columns: ['3', '4', '5', '6', '7', 'total'],
  rows: [
    { name: '売上高合計', type: 'financial_statement_item', values: [3377199, 2747443, 2802275, 3168370, 393434, 12488721],
      rows: [{ name: '売上高', type: 'account', values: [3377199, 2747443, 2802275, 3168370, 393434, 12488721] }] },
    { name: '売上原価', type: 'financial_statement_item', values: [], rows: [
      { name: '仕入高', type: 'account', values: [1150536, 589830, 552222, 507100, 1104772, 3904460] },
      { name: '支払手数料【原価】', type: 'account', values: [187163, 210428, 187055, 193721, 0, 778367] } ] },
    { name: '販売費及び一般管理費合計', type: 'financial_statement_item', values: [], rows: [
      { name: '役員報酬', type: 'account', values: [594000, 613000, 613000, 613000, 0, 2433000] },
      { name: '荷造運賃', type: 'account', values: [248667, 226653, 262293, 245993, 0, 983606] },
      { name: '広告宣伝費', type: 'account', values: [14300, 14300, 14300, 14300, 0, 57200] },
      { name: '通信費', type: 'account', values: [70098, 133505, 170611, 174768, 45876, 594858] },
      { name: 'リース料', type: 'account', values: [37950, 37950, 37950, 33000, 0, 146850] },
      { name: '地代家賃', type: 'account', values: [198000, 198000, 198000, 198000, 0, 792000] },
      { name: '保険料', type: 'account', values: [12020, 21200, 21200, 21200, 0, 75620] },
      { name: '支払手数料', type: 'account', values: [34535, 21685, 221007, 32288, 3055, 312570] },
      { name: '減価償却費', type: 'account', values: [369759, 369759, 369759, 369759, 0, 1479036] },
      { name: '外注費', type: 'account', values: [0, 0, 0, 0, 165000, 165000] },
      { name: '消耗品費', type: 'account', values: [77176, 261576, 127270, 74864, 30976, 571862] },
      { name: '諸会費', type: 'account', values: [-16760, 175240, 330240, 9240, 2640, 500600] },
      { name: '支払報酬料', type: 'account', values: [55000, 55000, 253000, 55000, 16500, 434500] } ] },
  ],
};

const LOOKBACK = 4, RATIO = 3, MIN_DIFF = 10000;

function run(report, targetMonth) {
  const columns = report.columns.map(String);
  const idx = columns.indexOf(String(targetMonth));
  const flat = flattenReportRows(report.rows, '', []);
  const missing = [], outliers = [], signIssues = [];
  flat.forEach((row) => {
    const cur = Number(row.values[idx] || 0);
    const from = idx - LOOKBACK;
    const past = from >= 0 ? row.values.slice(from, idx).map((v) => Number(v || 0)) : null;
    if (cur < 0) signIssues.push({ account: row.name, value: cur });
    if (!past || past.length < LOOKBACK) return;
    if (cur === 0 && past.every((v) => v !== 0)) { missing.push({ account: row.name, past }); return; }
    const med = median(past.map(Math.abs));
    if (med > 0 && cur !== 0) {
      const a = Math.abs(cur), high = a >= med * RATIO, low = a <= med / RATIO;
      if ((high || low) && Math.abs(a - med) >= MIN_DIFF) {
        outliers.push({ account: row.name, value: cur, med, dir: high ? '多い' : '少ない' });
      }
    }
  });
  return { idx, missing, outliers, signIssues };
}

console.log('===== 対象月 7月（過去4ヶ月=3,4,5,6月が揃う） =====');
const r7 = run(report, 7);
console.log('列の位置:', r7.idx);
console.log('\n[1] いつもあるのに今月まだ無い科目:', r7.missing.length, '件');
r7.missing.forEach((m) => console.log('   ', m.account, '  過去4ヶ月:', m.past.join(' / ')));
console.log('\n[2] 金額が普段と大きく違う科目:', r7.outliers.length, '件');
r7.outliers.forEach((o) => console.log('   ', o.account, ' 当月', o.value, ' 中央値', o.med, ' →', o.dir));
console.log('\n[3] 符号がおかしい科目:', r7.signIssues.length, '件');
r7.signIssues.forEach((s) => console.log('   ', s.account, s.value));

console.log('\n===== 対象月 5月（支払手数料221,007が当月になる） =====');
const r5 = run(report, 5);
console.log('過去が足りないので計上漏れ:', r5.missing.length, '件（4ヶ月分が無いため判定しないのが正しい）');
console.log('符号がおかしい:', r5.signIssues.length, '件');
r5.signIssues.forEach((s) => console.log('   ', s.account, s.value));

console.log('\n===== 期待との突き合わせ =====');
const expectMissing = ['支払手数料【原価】', '役員報酬', '荷造運賃', '広告宣伝費', 'リース料', '地代家賃', '保険料', '減価償却費'];
const got = r7.missing.map((m) => m.account).sort();
const want = expectMissing.slice().sort();
console.log('計上漏れの検知:', JSON.stringify(got) === JSON.stringify(want) ? '○ 期待どおり' : '× ずれ');
if (JSON.stringify(got) !== JSON.stringify(want)) {
  console.log('  実際:', got.join(', '));
  console.log('  期待:', want.join(', '));
}
console.log('外注費(過去4ヶ月0→当月165,000)が計上漏れに入っていない:',
  got.indexOf('外注費') < 0 ? '○ 正しい' : '× 誤り');
console.log('売上高(393,434 vs 中央値約3,072,822)が外れ値に入る:',
  r7.outliers.some((o) => o.account === '売上高') ? '○' : '×（要確認）');

console.log('\n===== 修正後: 登録が途中の月は「少ない」側を伏せる =====');
const partial = true;
const shown = r7.outliers.filter(o => !partial || o.dir === '多い');
const suppressed = r7.outliers.filter(o => o.dir === '少ない').length;
console.log('登録が途中(7月)のとき表示する外れ値:', shown.length, '件');
shown.forEach(o => console.log('   ', o.account, o.value, o.dir));
console.log('伏せた「少ない」側:', suppressed, '件 → 画面には件数だけ必ず伝える');
console.log('中堅レビューの受け入れ基準「的外れは月1〜2件程度」:',
  shown.length <= 2 ? '○ 満たす' : '× 超える');

console.log('\n===== 符号がおかしい科目の検知（対象月 3月・諸会費 -16,760） =====');
const r3 = run(report, 3);
console.log('検知:', r3.signIssues.length, '件');
r3.signIssues.forEach(s => console.log('   ', s.account, s.value));
console.log('諸会費のマイナスを拾えた:',
  r3.signIssues.some(s => s.account === '諸会費' && s.value === -16760) ? '○' : '×');
console.log('3月は過去4ヶ月が無いので計上漏れ・外れ値は判定しない:',
  (r3.missing.length === 0 && r3.outliers.length === 0) ? '○ 正しい' : '× 誤り');
