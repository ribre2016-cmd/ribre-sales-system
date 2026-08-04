// 勘定科目・税区分・インボイス区分の「提案」ロジックの検証。
// MFから実際に取得した仕訳の形（branches[].remark に摘要が入る）と、
// 本番の①タブに実際に出ていた明細の取引内容を使う。
//
// 実行: node tools/test-suggest.js
'use strict';

const SEP = String.fromCharCode(10);
const {
  buildSuggestIndex, suggestForContent, suggestDiagnosis, SUGGEST_MIN_RATIO,
} = require('../api/mf/_lib/suggest-core');
const { vendorTokens, journalVendorText } = require('../api/mf/_lib/mf-match-core');

/* ---------------- 実データに基づくテスト用の仕訳 ----------------
 * MF の GET /api/v3/journals から実際に返ってきた形。摘要・科目・税区分は実物。 */
function J(date, remark, debit, credit) {
  return { transaction_date: date, branches: [{ remark, debitor: debit, creditor: credit }] };
}
const 普通預金 = { account_id: 'ACC_FUTSU', account_name: '普通預金', tax_id: 'TAX_TAISHOGAI', tax_name: '対象外', invoice_kind: 'INVOICE_KIND_NOT_TARGET' };
const 売掛金 = { account_id: 'ACC_URIKAKE', account_name: '売掛金', tax_id: 'TAX_TAISHOGAI', tax_name: '対象外', invoice_kind: 'INVOICE_KIND_NOT_TARGET', sub_account_id: 'SUB_YAHOO', sub_account_name: 'ヤフー' };
const 支払手数料 = { account_id: 'ACC_TESURYO', account_name: '支払手数料', tax_id: 'TAX_KASHI10', tax_name: '課仕 10%', invoice_kind: 'INVOICE_KIND_QUALIFIED' };
const 複合 = { account_id: 'ACC_FUKUGO', account_name: '複合', tax_id: 'TAX_FUMEI', tax_name: '不明', invoice_kind: 'INVOICE_KIND_NOT_TARGET' };
const 通信費 = { account_id: 'ACC_TSUSHIN', account_name: '通信費', tax_id: 'TAX_KASHI10', tax_name: '課仕 10%', invoice_kind: 'INVOICE_KIND_QUALIFIED' };
const 売上高 = { account_id: 'ACC_URIAGE', account_name: '売上高', tax_id: 'TAX_KABAI10', tax_name: '課売 10% 二種', invoice_kind: 'INVOICE_KIND_NOT_TARGET' };

const journals = [
  // 入金。借方=普通預金(MFが自動) / 貸方=売掛金
  J('2026-06-02', '振込 ヤフ-ケツサイ', 普通預金, 売掛金),
  J('2026-05-02', '振込 ヤフ-ケツサイ', 普通預金, 売掛金),
  J('2026-04-02', '振込 ヤフ-ケツサイ', 普通預金, 売掛金),
  // 出金。借方=支払手数料 / 貸方=普通預金
  J('2026-06-02', '振込手数料', 支払手数料, 普通預金),
  J('2026-05-02', '振込手数料', 支払手数料, 普通預金),
  J('2026-04-02', '振込手数料', 支払手数料, 普通預金),
  J('2026-03-02', '振込手数料', 支払手数料, 普通預金),
  // 借方が「複合」（MFが複数行の仕訳を組むときの内部科目）
  J('2026-06-02', '振込 カ)リ-ブル', 複合, 普通預金),
  J('2026-05-02', '振込 カ)リ-ブル', 複合, 普通預金),
  J('2026-06-25', '振替 セコム', 通信費, 普通預金),
  J('2026-05-25', '振替 セコム', 通信費, 普通預金),
  J('2026-04-25', '振替 セコム', 通信費, 普通預金),
  J('2026-06-30', '振込 ウォレット ウケトリ', 普通預金, 売上高),
  J('2026-05-31', '振込 ウォレット ウケトリ', 普通預金, 売上高),
  J('2026-04-30', '振込 ウォレット ウケトリ', 普通預金, 売上高),
  // 割れている例: 同じ摘要で科目が半々 → 提案してはいけない
  J('2026-06-10', '振込 テスト ワレル', 通信費, 普通預金),
  J('2026-05-10', '振込 テスト ワレル', 支払手数料, 普通預金),
];

/* ---------------- 本番の規模を再現する ----------------
 * 提案は直近365日分の仕訳を材料にする（SUGGEST_LOOKBACK_DAYS）。
 * 実測では1ヶ月あたり200件超あり、1年で2,500件規模になる。
 * その中では「振込」「振替」のようなありふれた語がほぼ全ての仕訳に現れるため、
 * 語だけで数えると候補が割れて6割の条件を満たせなくなる。
 * 本番で全行「該当する提案はありません」になっていた症状をここで再現する。 */
const 消耗品費 = { account_id: 'ACC_SHOMO', account_name: '消耗品費', tax_id: 'TAX_KASHI10', tax_name: '課仕 10%', invoice_kind: 'INVOICE_KIND_QUALIFIED' };
const 荷造運賃 = { account_id: 'ACC_NIZUKURI', account_name: '荷造運賃', tax_id: 'TAX_KASHI10', tax_name: '課仕 10%', invoice_kind: 'INVOICE_KIND_QUALIFIED' };
const 仕入高 = { account_id: 'ACC_SHIIRE', account_name: '仕入高', tax_id: 'TAX_KASHI10', tax_name: '課仕 10%', invoice_kind: 'INVOICE_KIND_QUALIFIED' };
const noiseAccounts = [消耗品費, 荷造運賃, 仕入高, 通信費, 支払手数料, 売掛金, 売上高, 複合];
const noise = [];
for (let i = 0; i < 120; i++) {
  const a = noiseAccounts[i % noiseAccounts.length];
  const m = String((i % 12) + 1).padStart(2, '0');
  // 「振込 ○○」「振替 ○○」という、ありふれた語を含む別々の取引先
  noise.push(J('2026-' + m + '-15', '振込 トリヒキサキ' + i, a, 普通預金));
  noise.push(J('2026-' + m + '-16', '振替 テンポ' + i, a, 普通預金));
}
const journalsAll = journals.concat(noise);
console.log('材料にする仕訳の件数: ' + journalsAll.length + '件（本番は1年で2,500件規模）\n');

const index = buildSuggestIndex(journalsAll);

// 本番の①タブに実際に出ていた明細
const cases = [
  { content: '振込 ウォレット ウケトリ', side: 'INCOME', want: '売上高', why: '摘要が完全一致・3件とも同じ' },
  { content: '振込 ヤフ-ケツサイ', side: 'INCOME', want: '売掛金', why: '摘要が完全一致' },
  { content: '振込手数料', side: 'EXPENSE', want: '支払手数料', why: '語が全部ありふれた語でも、完全一致なら当たる' },
  { content: '振替 セコム', side: 'EXPENSE', want: '通信費', why: '摘要が完全一致' },
  { content: '振込 カ)リ-ブル', side: 'EXPENSE', want: null, why: '複合は提案しない（MFの内部科目）' },
  { content: '振込 テスト ワレル', side: 'EXPENSE', want: null, why: '科目が割れているので提案しない' },
  { content: '振込 ハジメテノトリヒキサキ', side: 'EXPENSE', want: null, why: '過去に無いので提案しない' },
];

let ng = 0;
console.log('===== 勘定科目の提案（実データの摘要で検証） =====\n');
cases.forEach((c) => {
  const s = suggestForContent(index, c.content, c.side);
  const got = s ? s.account_name : null;
  const ok = got === c.want;
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + c.content + '  [' + c.side + ']');
  console.log('      期待: ' + (c.want || '提案しない') + ' / 実際: ' + (got || '提案しない')
    + (s ? '（' + s.match_kind + '・過去' + s.total + '件中' + s.count + '件）' : ''));
  console.log('      ' + c.why);
  if (s) console.log('      税区分: ' + (s.tax_name || '-') + ' / インボイス: ' + (s.invoice_kind || '-'));
  console.log('');
});

/* 修正前の挙動（摘要の完全一致なし・ありふれた語を除かない・複合を除外しない）を
 * 再現して比べる。本番で全行「該当する提案はありません」になっていた原因の確認。 */
console.log('===== 修正前ならどうだったか =====');
// 旧ロジックを忠実に再現する。索引も旧方式で作り直す
// （ありふれた語を除かない・複合を除外しない・摘要の完全一致は無い）。
const legacyIndex = new Map();
journalsAll.forEach((j) => {
  const b = j.branches[0];
  const sides = { debit: b.debitor, credit: b.creditor };
  vendorTokens(journalVendorText(j)).forEach((t) => {
    if (!legacyIndex.has(t)) legacyIndex.set(t, { debit: new Map(), credit: new Map() });
    const slot = legacyIndex.get(t);
    ['debit', 'credit'].forEach((side) => {
      const c = sides[side];
      if (!c || !c.account_id) return;   // 複合も除外しない（旧のまま）
      const key = [c.account_id, c.tax_id || '', c.sub_account_id || '', c.invoice_kind || ''].join('|');
      const m = slot[side];
      const cur = m.get(key);
      if (cur) { cur.count += 1; if (j.transaction_date > cur.lastDate) cur.lastDate = j.transaction_date; }
      else m.set(key, { combo: c, count: 1, lastDate: j.transaction_date });
    });
  });
});
function oldSuggest(content, side) {
  const useSide = (String(side).toLowerCase().indexOf('incom') >= 0) ? 'credit' : 'debit';
  const merged = new Map();
  vendorTokens(content).forEach((t) => {   // ありふれた語を除かない
    const slot = legacyIndex.get(t);
    if (!slot || !slot[useSide]) return;
    slot[useSide].forEach((v, key) => {
      const cur = merged.get(key);
      if (cur) { cur.count += v.count; if (v.lastDate > cur.lastDate) cur.lastDate = v.lastDate; }
      else merged.set(key, { combo: v.combo, count: v.count, lastDate: v.lastDate });
    });
  });
  if (!merged.size) return null;
  const all = Array.from(merged.values());
  const total = all.reduce((s, v) => s + v.count, 0);
  all.sort((a, b) => (b.count - a.count) || (a.lastDate < b.lastDate ? 1 : -1));
  if (total > 0 && all[0].count / total < SUGGEST_MIN_RATIO) return null;
  return all[0].combo;
}
let oldHit = 0, newHit = 0;
const wanted = cases.filter((c) => c.want !== null);
wanted.forEach((c) => {
  const o = oldSuggest(c.content, c.side);
  const n = suggestForContent(index, c.content, c.side);
  if (o && o.account_name === c.want) oldHit++;
  if (n && n.account_name === c.want) newHit++;
  console.log('  ' + c.content + ' → 修正前: ' + (o ? o.account_name : '提案なし')
    + ' / 修正後: ' + (n ? n.account_name : '提案なし'));
});
console.log('\n  提案が当たった数: 修正前 ' + oldHit + '/' + wanted.length
  + ' → 修正後 ' + newHit + '/' + wanted.length);

/* 学習の確認: この画面から登録した仕訳が、次回の提案に効くか。
 * 提案はMFの仕訳から作るので、登録すれば次に読み込んだときの材料に入る。 */
console.log('\n===== 登録したものが次回から提案に出るか =====');
const before = suggestForContent(index, '振込 アタラシイトリヒキサキ', 'EXPENSE');
console.log('  登録前: ' + (before ? before.account_name : '提案なし'));
const after = suggestForContent(
  buildSuggestIndex(journalsAll.concat([J('2026-07-15', '振込 アタラシイトリヒキサキ', 通信費, 普通預金)])),
  '振込 アタラシイトリヒキサキ', 'EXPENSE'
);
console.log('  1件登録した後: ' + (after ? after.account_name + '（' + after.match_kind + '）' : '提案なし'));
const learned = !before && after && after.account_name === '通信費';
if (!learned) ng++;
console.log('  ' + (learned ? '○ 1件登録しただけで次回から提案に出る' : '× 学習されていない'));

/* 提案が出なかったときに「理由」を返せるか（資産税の税理士の指摘）。 */
console.log(SEP + '===== 提案が出ないときの理由 =====');
[
  ['振込 カ)リ-ブル', 'EXPENSE', 'no_usable_side', '過去が全部「複合」で借方が定まらない'],
  ['振込 テスト ワレル', 'EXPENSE', 'split', '科目が半々に割れている'],
  ['振込 ハジメテノトリヒキサキ', 'EXPENSE', 'no_history', '過去に同じ摘要も似た摘要も無い'],
].forEach(function (c) {
  const d = suggestDiagnosis(index, c[0], c[1]);
  const ok = d && d.kind === c[2];
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + c[0] + ' → ' + (d ? d.kind : 'なし')
    + '（期待: ' + c[2] + '）  ' + c[3]);
  if (d && d.kind === 'split' && d.detail && d.detail.breakdown) {
    console.log('      内訳: ' + d.detail.breakdown.map(function (x) {
      return x.account_name + ' ' + x.count + '件';
    }).join(' / '));
  }
});
(function () {
  const d = suggestDiagnosis(index, '振替 セコム', 'EXPENSE');
  const ok = d && d.kind === 'ok';
  if (!ok) ng++;
  console.log((ok ? '  ○ ' : '  × ') + '提案が出る明細には理由を出さない → ' + (d ? d.kind : 'なし'));
})();

console.log('\n===== 結果 =====');
console.log(ng === 0 ? '全件 期待どおり ○' : (ng + '件 期待とちがう ×'));
process.exit(ng === 0 ? 0 : 1);
