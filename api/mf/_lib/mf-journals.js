// MF仕訳(journals)関連の共通ヘルパー。
// api/mf/match.js の実装（本番デバッグ済み）をそのまま切り出したもの。
// - 金額はAPI上税抜のため、tax_valueを合算して税込金額を算出する
// - ページネーション(page/per_page)はmetadata.total_pagesが尽きるまで取得する
'use strict';

const { MF_ACCOUNTING_API_BASE } = require('./mf-client');

// 仕訳一覧を取得（page/per_pageページネーション。metadata.total_pagesが尽きるまで取得）
// 出典: openapi.yaml GetJournalsResponse / Metadata（total_count, total_pages）
async function fetchJournals({ accessToken, startDate, endDate }) {
  const perPage = 200;
  let page = 1;
  let totalPages = 1;
  const journals = [];
  do {
    const url =
      `${MF_ACCOUNTING_API_BASE}/api/v3/journals` +
      `?start_date=${encodeURIComponent(startDate)}&end_date=${encodeURIComponent(endDate)}` +
      `&page=${page}&per_page=${perPage}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    if (Array.isArray(data.journals)) journals.push(...data.journals);
    totalPages = (data.metadata && Number(data.metadata.total_pages)) || 1;
    page += 1;
  } while (page <= totalPages);
  return journals;
}

// 仕訳の税込金額（借方合計）を算出する。
// APIのvalueは税抜、tax_valueが消費税のため、証憑の領収書金額（税込）と比較するには両者を合算する。
// 実測: 元帳39,748円の仕訳はAPIでvalue=36,134/tax_value=3,614として返る。
function journalAmount(journal) {
  const branches = Array.isArray(journal.branches) ? journal.branches : [];
  return branches.reduce((sum, b) => {
    const d = b && b.debitor;
    if (!d) return sum;
    const v = Number.isFinite(Number(d.value)) ? Number(d.value) : 0;
    const t = Number.isFinite(Number(d.tax_value)) ? Number(d.tax_value) : 0;
    return sum + v + t;
  }, 0);
}

function journalSummaryText(journal) {
  const branches = Array.isArray(journal.branches) ? journal.branches : [];
  const remarks = branches
    .map((b) => (b && b.remark) || '')
    .filter(Boolean)
    .join(' / ');
  return remarks || journal.memo || '';
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

module.exports = { fetchJournals, journalAmount, journalSummaryText, addDays };
