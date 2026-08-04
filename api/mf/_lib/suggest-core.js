// 勘定科目・税区分・インボイス区分の「提案」のロジック（純粋な計算だけ）。
// 設計書: docs/TAX_WORKSPACE_PLAN.md §Phase4 / docs/TAX_WORKSPACE_PHASE7_PLAN.md §17
//
// ここに切り出してあるのは、実データで挙動を確かめられるようにするため。
// 検証: tools/test-suggest.js（node tools/test-suggest.js）
'use strict';

const { vendorTokens, journalVendorText } = require('./mf-match-core');

const SUGGEST_LOOKBACK_DAYS = 365;   // 何日前までの仕訳を参考にするか
const SUGGEST_MIN_RATIO = 0.6;       // 最多の組み合わせがこの割合未満なら提案しない
// 語による近似（摘要が完全には一致しない）で提案してよい最小件数。
// 実データで「振込 カ)リ-ブル」に、たった2件の近似から『未収入金』が提案されていた。
// 摘要が同じなら1件でも根拠になるが、語が似ているだけの2件は当てにならない。
const SUGGEST_SIMILAR_MIN_COUNT = 3;
const SUGGEST_MAX_ITEMS = 200;       // 1回に処理する明細の上限

// 提案に使ってはいけない勘定科目。
// 「複合」「諸口」はMFが複数行の仕訳を組むときに使う内部的な科目で、
// これを提案すると意味の無い仕訳になる（実データで過去の仕訳に多数含まれることを確認）。
const SUGGEST_EXCLUDED_ACCOUNTS = new Set(['複合', '諸口']);

// 提案のときだけ無視する語。銀行明細に必ず入る一般語で、これらを数に入れると
// 「振込」を含む全ての仕訳が混ざって候補が割れ、6割の条件を満たせなくなる（実データで確認）。
// ⚠ 証憑のマッチング（mf-match-core.js の vendorTokens）には影響させない。
//    あちらは取引先名を当てる用途で、同じ語を落とすと逆に当たらなくなるため。
const SUGGEST_EXTRA_STOPWORDS = new Set([
  '振込', '振替', '入金', '出金', '送金', '預入', '引出', '引落', '口座', '自動',
  '手数料', '支払', '利用', '代金', '料金', '返金', '決済', '利息', '現金', 'カード',
  'atm', '他行', 'ｶ', 'カ', 'ｷ', 'ド',
]);

function suggestTokens(text) {
  return vendorTokens(text).filter((t) => !SUGGEST_EXTRA_STOPWORDS.has(t));
}

// 摘要そのものをキーにする（完全一致用）。
// 銀行・カードの明細から作った仕訳は摘要が明細の取引内容そのままなので、
// 同じ取引先の入出金は毎回まったく同じ文字列になる。語に分解するより精度が高い。
function remarkKey(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function sideCombo(s) {
  if (!s || !s.account_id) return null;
  if (SUGGEST_EXCLUDED_ACCOUNTS.has(String(s.account_name || ''))) return null;
  return {
    account_id: s.account_id,
    account_name: s.account_name || '',
    tax_id: s.tax_id || null,
    tax_name: s.tax_name || '',
    sub_account_id: s.sub_account_id || null,
    sub_account_name: s.sub_account_name || '',
    invoice_kind: s.invoice_kind || null,
  };
}

/* 仕訳1件から借方・貸方それぞれの組み合わせを取り出す。
 * ⚠ **どちらの側を提案に使うかは明細の収支で決まる**（2026-08-03のレビューで判明した重大な誤り）。
 *   `POST /transactions/journalize` に渡すのは「連携口座の反対側」の科目で、
 *   MFは口座側を自動で埋める。実データで確認した対応は次のとおり:
 *     出金(EXPENSE): 借方=支払手数料など(渡す側) / 貸方=普通預金(MFが自動)
 *     入金(INCOME) : 借方=普通預金(MFが自動)      / 貸方=売上高など(渡す側)
 *   当初は常に借方を見ていたため、**入金の明細に「普通預金」を提案してしまう**誤りがあった。
 * 借方または貸方が複数ある複合仕訳は「前回と同じ」を当てにできないので対象外。 */
function journalCombos(j) {
  const branches = Array.isArray(j.branches) ? j.branches : [];
  const debits = branches.map((b) => b && b.debitor).filter((d) => d && d.account_id);
  const credits = branches.map((b) => b && b.creditor).filter((c) => c && c.account_id);
  return {
    debit: debits.length === 1 ? sideCombo(debits[0]) : null,
    credit: credits.length === 1 ? sideCombo(credits[0]) : null,
  };
}

// 明細の収支から、提案に使う側を決める（api/mf/tax-workspace.js の他の判定と揃える）
function comboSideForTransaction(side) {
  const s = String(side || '').toLowerCase();
  if (s.indexOf('incom') >= 0 || s.indexOf('credit') >= 0) return 'credit';
  return 'debit'; // EXPENSE と不明は借方（出金の方が件数が多く、外した場合も提案が出ないだけ）
}

function comboKey(c) {
  return [c.account_id, c.tax_id || '', c.sub_account_id || '', c.invoice_kind || ''].join('|');
}

// 過去の仕訳を「摘要の語」ごとにまとめる。借方・貸方を**別々に**数える。
// どちらを使うかは提案時に明細の収支で決める（journalCombos のコメント参照）。
function buildSuggestIndex(journals) {
  const byToken = new Map();  // token -> { debit: Map(key->{combo,count,lastDate}), credit: 同 }
  const byRemark = new Map(); // 摘要そのもの -> 同上（完全一致用。こちらを優先して使う）

  function put(map, mapKey, side, combo, date) {
    if (!map.has(mapKey)) map.set(mapKey, { debit: new Map(), credit: new Map() });
    const slot = map.get(mapKey);
    const key = comboKey(combo);
    const m = slot[side];
    const cur = m.get(key);
    if (cur) {
      cur.count += 1;
      if (date > cur.lastDate) cur.lastDate = date;
    } else {
      m.set(key, { combo, count: 1, lastDate: date });
    }
  }

  (journals || []).forEach((j) => {
    const combos = journalCombos(j);
    if (!combos.debit && !combos.credit) return;
    const date = j.transaction_date || '';
    const text = journalVendorText(j);

    // 摘要は仕訳の行ごとに入るので、行ごとのremarkを個別のキーにする。
    // （明細から作った仕訳は remark が明細の取引内容そのまま）
    const remarks = new Set();
    (Array.isArray(j.branches) ? j.branches : []).forEach((b) => {
      if (b && b.remark) remarks.add(remarkKey(b.remark));
    });
    remarks.forEach((rk) => {
      if (!rk) return;
      ['debit', 'credit'].forEach((side) => {
        if (combos[side]) put(byRemark, rk, side, combos[side], date);
      });
    });

    const tokens = suggestTokens(text);
    tokens.forEach((t) => {
      ['debit', 'credit'].forEach((side) => {
        if (combos[side]) put(byToken, t, side, combos[side], date);
      });
    });
  });
  return { byToken, byRemark };
}

// 集めた候補から1つ選ぶ。割れているときは null（提案しない）。
function pickTop(merged, matchKind) {
  if (!merged.size) return null;
  const all = Array.from(merged.values());
  const total = all.reduce((s, v) => s + v.count, 0);
  all.sort((a, b) => (b.count - a.count) || (a.lastDate < b.lastDate ? 1 : -1));
  const top = all[0];
  // 割れているときは提案しない（同じ取引先で科目が分かれている＝人が判断すべき）
  if (total > 0 && top.count / total < SUGGEST_MIN_RATIO) return null;
  return Object.assign({}, top.combo, {
    count: top.count, last_date: top.lastDate, total,
    match_kind: matchKind, // 'exact'（摘要が同じ）/ 'similar'（語が似ている）
  });
}

// 明細1件に対する提案。条件を満たさなければ null（提案しない）。
// ① 摘要が完全に同じ過去の仕訳 → ② 語が似ている過去の仕訳、の順に見る。
// ①を先に見るのは、銀行・カードの明細から作った仕訳は摘要が明細の取引内容
// そのままで、同じ取引先なら毎回同じ文字列になるため（実データで確認）。
function suggestForContent(index, content, txSide) {
  const useSide = comboSideForTransaction(txSide);

  // ① 摘要の完全一致
  const rk = remarkKey(content);
  if (rk && index.byRemark) {
    const slot = index.byRemark.get(rk);
    const m = slot && slot[useSide];
    if (m && m.size) {
      const exact = pickTop(new Map(m), 'exact');
      if (exact) return exact;
    }
  }

  // ② 語による近似
  const tokens = suggestTokens(content);
  if (!tokens.length) return null;
  // その明細の語に紐づく組み合わせを全部集めて合算する
  const merged = new Map();
  tokens.forEach((t) => {
    const slot = index.byToken.get(t);
    if (!slot) return;
    const m = slot[useSide];
    if (!m) return;
    m.forEach((v, key) => {
      const cur = merged.get(key);
      if (cur) {
        cur.count += v.count;
        if (v.lastDate > cur.lastDate) cur.lastDate = v.lastDate;
      } else {
        merged.set(key, { combo: v.combo, count: v.count, lastDate: v.lastDate });
      }
    });
  });
  const sim = pickTop(merged, 'similar');
  // 語による近似は件数が少ないと当てにならないので、そこは提案しない
  if (sim && sim.count < SUGGEST_SIMILAR_MIN_COUNT) return null;
  return sim;
}

/* MFの仕訳APIは「指定した日付が含まれる会計期間の仕訳だけ」を返す仕様で、
 * **会計年度をまたぐ期間を指定すると HTTP 400 になる**（2026-08-04に実測）。
 * 提案は直近365日を材料にするため、期首(3/1)以降はほぼ必ずまたいでいた。
 * その結果 fetchJournals が毎回400で落ち、提案が1件も出ていなかった。
 *
 * そこで会計期間ごとに分けて取る。terms は GET /term_settings の中身。
 * terms が取れなかった場合は「endDateの属する期だけ」に絞って安全側に倒す。 */
function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function fetchJournalsForSuggest({ accessToken, endDate, terms, fetchJournals, lookbackDays }) {
  const back = Number(lookbackDays) > 0 ? Number(lookbackDays) : SUGGEST_LOOKBACK_DAYS;
  const desiredStart = addDaysStr(endDate, -back);
  const list = Array.isArray(terms) ? terms.filter((t) => t && t.start_date && t.end_date) : [];

  // 会計期間が分からないときは、またがないよう endDate の月初までに縮める
  if (!list.length) {
    return fetchJournals({ accessToken, startDate: endDate.slice(0, 8) + '01', endDate });
  }

  // 欲しい期間と重なる会計期間ごとに、その重なりの分だけ取る
  const ranges = [];
  list.forEach((t) => {
    const s = t.start_date > desiredStart ? t.start_date : desiredStart;
    const e = t.end_date < endDate ? t.end_date : endDate;
    if (s <= e) ranges.push({ startDate: s, endDate: e });
  });
  if (!ranges.length) {
    return fetchJournals({ accessToken, startDate: endDate.slice(0, 8) + '01', endDate });
  }

  const all = [];
  for (const r of ranges) {
    // 1つの期で失敗しても、取れた分だけで提案を作る（全部落とさない）
    try {
      const got = await fetchJournals({ accessToken, startDate: r.startDate, endDate: r.endDate });
      all.push(...got);
    } catch (e) {
      console.error('仕訳の取得に失敗（この期はとばす）', r.startDate, r.endDate, e && e.message);
    }
  }
  return all;
}

module.exports = {
  SUGGEST_SIMILAR_MIN_COUNT,
  addDaysStr,
  fetchJournalsForSuggest,
  SUGGEST_LOOKBACK_DAYS,
  SUGGEST_MIN_RATIO,
  SUGGEST_MAX_ITEMS,
  SUGGEST_EXCLUDED_ACCOUNTS,
  SUGGEST_EXTRA_STOPWORDS,
  suggestTokens,
  remarkKey,
  sideCombo,
  journalCombos,
  comboSideForTransaction,
  comboKey,
  buildSuggestIndex,
  pickTop,
  suggestForContent,
};
