// 指定月の証憑カバー率を集計する共通ロジック。
// api/mf/coverage.js と api/mf/monthly-report.js の両方から使う。
'use strict';

const { fetchJournals, journalAmount, journalSummaryText } = require('./mf-journals');

// 'YYYY-MM' 形式のバリデーション
function isValidYearMonth(month) {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month);
}

// JST(UTC+9)基準の当月('YYYY-MM')を返す。VercelはUTCで動くため、素のUTC年月だと
// JST 0:00〜8:59の間（例: 月初0:00〜8:59）は前月扱いのままになってしまう。
function currentYearMonth() {
  const jstIso = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  return jstIso.slice(0, 7);
}

// 'YYYY-MM' の月初/月末日付('YYYY-MM-DD')を返す
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${month}-${String(lastDay).padStart(2, '0')}`;
  return { start, end };
}

// 指定月の仕訳を取得し、証憑カバー率を集計する
async function computeCoverage({ accessToken, month }) {
  const targetMonth = isValidYearMonth(month) ? month : currentYearMonth();
  const { start, end } = monthRange(targetMonth);
  const journals = await fetchJournals({ accessToken, startDate: start, endDate: end });

  const total = journals.length;
  let withVoucher = 0;
  const missing = [];

  for (const j of journals) {
    const fileIds = Array.isArray(j.voucher_file_ids) ? j.voucher_file_ids : [];
    if (fileIds.length > 0) {
      withVoucher += 1;
    } else {
      missing.push({
        number: j.number,
        date: j.transaction_date,
        amount: journalAmount(j),
        summary: journalSummaryText(j),
      });
    }
  }

  missing.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const withoutVoucher = total - withVoucher;
  const coveragePct = total > 0 ? Math.round((withVoucher / total) * 1000) / 10 : 0;

  return {
    month: targetMonth,
    total,
    with_voucher: withVoucher,
    without_voucher: withoutVoucher,
    coverage_pct: coveragePct,
    missing: missing.slice(0, 50),
  };
}

module.exports = { computeCoverage, isValidYearMonth, currentYearMonth, monthRange };
