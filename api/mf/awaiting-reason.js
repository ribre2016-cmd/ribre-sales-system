// GET /api/mf/awaiting-reason
// 「マッチ待ち」の証憑が何を待っているのかを調べて返す（読み取り専用）。
//
// 背景:
//   証憑は仕訳に添付する仕組みで、添付先の仕訳が無いと送れない。
//   （MFのAPIには明細へ証憑を添付する口が無い。POST /vouchers は journal_id のみ受け取り、
//     Transaction.voucher_file_ids は取得専用。openapi.yaml で確認済み 2026-08-02）
//   そのため仕訳ができるまで awaiting_match で待ち続けるが、画面からは
//   「何を待っているのか」が分からなかった。ここで未仕訳の明細を照合して理由を示す。
//
// この関数は一切データを変更しない。MFへも書き込まない。
'use strict';

const {
  getAccessToken,
  NotConnectedError,
  fetchAwaitingMatchEvidence,
  normalizeText,
  addDays,
  VENDOR_DATE_MARGIN_DAYS,
} = require('./_lib/mf-match-core');
const { fetchUnjournalizedTransactions } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

// GET /api/v3/transactions は start_date と end_date の差が366日以内という制約がある。
// 余裕を持って360日を上限にし、証憑の日付範囲がこれを超える場合は新しい側を優先する。
const MAX_RANGE_DAYS = 360;

// 明細の取引内容（content）と証憑の取引先名を突き合わせる。
// 照合規則は findVendorDateCandidates と同じ（正規化して相互 includes）。
function transactionMatchesEvidence(tx, evidence) {
  const vendorNorm = normalizeText(evidence.ocr_vendor);
  if (!vendorNorm) return false;
  const contentNorm = normalizeText(tx.content);
  if (!contentNorm) return false;
  if (!(contentNorm.includes(vendorNorm) || vendorNorm.includes(contentNorm))) return false;
  const date = evidence.ocr_date;
  if (!date || !tx.date) return false;
  return tx.date >= addDays(date, -VENDOR_DATE_MARGIN_DAYS)
    && tx.date <= addDays(date, VENDOR_DATE_MARGIN_DAYS);
}

// 証憑群から明細取得の対象期間を決める（±VENDOR_DATE_MARGIN_DAYS の余白つき）
function buildDateRange(evidences) {
  const dates = evidences.map((e) => e.ocr_date).filter(Boolean).sort();
  if (!dates.length) return null;
  let start = addDays(dates[0], -VENDOR_DATE_MARGIN_DAYS);
  const end = addDays(dates[dates.length - 1], VENDOR_DATE_MARGIN_DAYS);
  // 366日制約に収まらない場合は新しい側を残す（古い証憑は次回以降に回る）
  const minStart = addDays(end, -MAX_RANGE_DAYS);
  if (start < minStart) start = minStart;
  return { start, end };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }
  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  let evidences;
  try {
    evidences = await fetchAwaitingMatchEvidence();
  } catch (e) {
    res.status(500).json({ ok: false, error: 'evidence_fetch_failed' });
    return;
  }
  if (!evidences.length) {
    res.status(200).json({ ok: true, items: [], awaiting_count: 0 });
    return;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (e instanceof NotConnectedError) {
      res.status(200).json({ ok: false, error: 'not_connected', awaiting_count: evidences.length });
      return;
    }
    res.status(500).json({ ok: false, error: 'token_failed' });
    return;
  }

  const range = buildDateRange(evidences);
  let transactions = [];
  if (range) {
    try {
      transactions = await fetchUnjournalizedTransactions({
        accessToken,
        startDate: range.start,
        endDate: range.end,
      });
    } catch (e) {
      // transaction.read スコープを持たない既存トークンでは403になる。
      // その場合は「再連携が必要」と伝えるだけで、他の機能には影響しない。
      if (e && (e.status === 403 || e.status === 401)) {
        res.status(200).json({ ok: false, error: 'scope_missing', awaiting_count: evidences.length });
        return;
      }
      res.status(200).json({ ok: false, error: 'transactions_fetch_failed', awaiting_count: evidences.length });
      return;
    }
  }

  const items = evidences.map((ev) => {
    const hits = transactions.filter((tx) => transactionMatchesEvidence(tx, ev));
    return {
      evidence_id: ev.id,
      file_name: ev.file_name,
      ocr_date: ev.ocr_date,
      ocr_vendor: ev.ocr_vendor,
      ocr_amount: ev.ocr_amount,
      ocr_currency: ev.ocr_currency || 'JPY',
      // reason: unjournalized = 未仕訳の明細が見つかった（それを仕訳化すれば進む）
      //         no_transaction = 該当する未仕訳明細が無い（明細自体が未取込か、名称が違う）
      reason: hits.length ? 'unjournalized' : 'no_transaction',
      transactions: hits.map((tx) => ({
        date: tx.date,
        content: tx.content,
        value: tx.value,
        side: tx.side,
      })),
    };
  });

  res.status(200).json({
    ok: true,
    items,
    awaiting_count: evidences.length,
    checked_range: range,
    unjournalized_total: transactions.length,
  });
};
