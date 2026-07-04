// MF証憑マッチングの共通コア（api/mf/match.js, api/mf/auto-match.js から利用）
// api/mf/match.js の実装（本番デバッグ済み）を挙動そのままに切り出したもの。
'use strict';

const { getAccessToken, postVoucher, NotConnectedError, MF_ACCOUNTING_API_BASE } = require('./mf-client');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MF_STORAGE_BUCKET = 'mf-evidence';
const MARGIN_DAYS = 7; // 仕訳取得ウィンドウ（取引先マッチの±7日をカバー）
const MAX_VOUCHER_FILES_PER_JOURNAL = 5;
const FUZZY_MARGIN_DAYS = 3;
const VENDOR_DATE_MARGIN_DAYS = 7; // 取引先名＋日付近接マッチ（外貨建て等の金額不一致向け）

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function fetchBoxSavedEvidence() {
  const url =
    `${SUPABASE_URL}/rest/v1/mf_evidence` +
    `?select=*&status=eq.box_saved&storage_path=not.is.null&order=ocr_date.asc`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase mf_evidence取得失敗: HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

async function fetchEvidenceById(id) {
  const url = `${SUPABASE_URL}/rest/v1/mf_evidence?id=eq.${encodeURIComponent(id)}&select=*&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`Supabase mf_evidence取得失敗: HTTP ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateEvidence(id, patch) {
  const url = `${SUPABASE_URL}/rest/v1/mf_evidence?id=eq.${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase mf_evidence更新失敗: HTTP ${res.status} ${text}`);
  }
}

// Storageからファイルを取得しbase64化する
async function fetchStorageFileBase64(storagePath) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${storagePath}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`Storageファイル取得失敗: HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}

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

function journalSummary(journal, fuzzy) {
  const branches = Array.isArray(journal.branches) ? journal.branches : [];
  const remarks = branches
    .map((b) => (b && b.remark) || '')
    .filter(Boolean)
    .join(' / ');
  const summary = {
    journal_id: journal.id,
    date: journal.transaction_date,
    amount: journalAmount(journal),
    summary: remarks || journal.memo || '',
  };
  if (fuzzy) summary.fuzzy = true;
  return summary;
}

// 摘要第二キー比較用テキスト（branches[].remark join＋memo＋取引先名）
// 取引先名はAPI上、明細側 branches[].debitor/creditor.trade_partner_name に入る
function journalVendorText(journal) {
  const branches = Array.isArray(journal.branches) ? journal.branches : [];
  const parts = [];
  branches.forEach((b) => {
    if (!b) return;
    if (b.remark) parts.push(b.remark);
    if (b.debitor && b.debitor.trade_partner_name) parts.push(b.debitor.trade_partner_name);
    if (b.creditor && b.creditor.trade_partner_name) parts.push(b.creditor.trade_partner_name);
  });
  if (journal.memo) parts.push(journal.memo);
  return parts.filter(Boolean).join(' / ');
}

// 正規化: NFKC正規化→小文字化→空白(全半角)除去
function normalizeText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s　]+/g, '');
}

// 完全一致候補が複数のとき、証憑のocr_vendorと各候補の摘要テキストを比較し、
// 正規化後にどちらかが他方を部分文字列として含む候補がちょうど1件ならそれを返す。
// 1件に絞れない、またはocr_vendorが空なら null。
function resolveByVendor(candidates, evidence) {
  const vendorNorm = normalizeText(evidence && evidence.ocr_vendor);
  if (!vendorNorm) return null;
  const matched = candidates.filter((j) => {
    const summaryNorm = normalizeText(journalVendorText(j));
    if (!summaryNorm) return false;
    return summaryNorm.includes(vendorNorm) || vendorNorm.includes(summaryNorm);
  });
  return matched.length === 1 ? matched[0] : null;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function journalPassesCommonFilters(j, evidence) {
  const fileIds = Array.isArray(j.voucher_file_ids) ? j.voucher_file_ids : [];
  if (fileIds.length >= MAX_VOUCHER_FILES_PER_JOURNAL) return false;
  if (evidence.mf_file_id && fileIds.includes(evidence.mf_file_id)) return false;
  return true;
}

// 証憑1件に対する候補仕訳を絞り込む（完全一致）
// 条件: transaction_date一致 かつ 金額一致。5件以上添付済み、または既にこの証憑を含む仕訳は除外。
function findCandidates(journals, evidence) {
  const dateStr = evidence.ocr_date;
  const amount = Number(evidence.ocr_amount);
  if (!dateStr || !Number.isFinite(amount)) return [];
  return journals.filter((j) => {
    if (j.transaction_date !== dateStr) return false;
    if (journalAmount(j) !== amount) return false;
    return journalPassesCommonFilters(j, evidence);
  });
}

// 完全一致が0件のときのみ使う緩和マッチ。ocr_dateの前後3日以内で金額一致の仕訳を探す。
// 自動添付はしない（呼び出し側でambiguous扱いにすること）。
function findFuzzyCandidates(journals, evidence) {
  const dateStr = evidence.ocr_date;
  const amount = Number(evidence.ocr_amount);
  if (!dateStr || !Number.isFinite(amount)) return [];
  const startDate = addDays(dateStr, -FUZZY_MARGIN_DAYS);
  const endDate = addDays(dateStr, FUZZY_MARGIN_DAYS);
  return journals.filter((j) => {
    if (!j.transaction_date) return false;
    if (j.transaction_date < startDate || j.transaction_date > endDate) return false;
    if (j.transaction_date === dateStr) return false; // 完全一致日は上のfindCandidatesが担当
    if (journalAmount(j) !== amount) return false;
    return journalPassesCommonFilters(j, evidence);
  });
}

// 第三段: 金額を使わず「取引先名の一致＋日付±7日」で候補を探す。
// 外貨建て請求書（Anthropic/OpenAI等）は円換算額が読めず金額照合が不可能なため、
// カード明細の摘要に含まれる加盟店名と証憑の取引先名を突き合わせる。
// 金額の裏取りができない以上、自動添付は絶対にしない（候補提示のみ）。
function findVendorDateCandidates(journals, evidence) {
  const dateStr = evidence.ocr_date;
  const vendorNorm = normalizeText(evidence && evidence.ocr_vendor);
  if (!dateStr || !vendorNorm) return [];
  const startDate = addDays(dateStr, -VENDOR_DATE_MARGIN_DAYS);
  const endDate = addDays(dateStr, VENDOR_DATE_MARGIN_DAYS);
  return journals.filter((j) => {
    if (!j.transaction_date) return false;
    if (j.transaction_date < startDate || j.transaction_date > endDate) return false;
    const summaryNorm = normalizeText(journalVendorText(j));
    if (!summaryNorm) return false;
    if (!(summaryNorm.includes(vendorNorm) || vendorNorm.includes(summaryNorm))) return false;
    return journalPassesCommonFilters(j, evidence);
  });
}

// 証憑をStorageから読み出し、指定仕訳へ添付。成功したらevidence行を更新する。
async function attachEvidenceToJournal({ accessToken, evidence, journalId }) {
  const fileDataBase64 = await fetchStorageFileBase64(evidence.storage_path);
  const mfResult = await postVoucher({
    accessToken,
    journalId,
    fileName: evidence.file_name,
    fileDataBase64,
  });
  const newFileId =
    (mfResult && Array.isArray(mfResult.voucher_file_ids) && mfResult.voucher_file_ids[0] && mfResult.voucher_file_ids[0].file_id) ||
    null;
  await updateEvidence(evidence.id, {
    status: 'attached',
    journal_id: journalId,
    mf_file_id: newFileId || evidence.mf_file_id || null,
  });
}

// 自動モード: box_saved かつ storage_path ありの証憑をまとめてマッチング・添付する
async function runAutoMatch(accessToken) {
  const evidenceRows = await fetchBoxSavedEvidence();
  const attached = [];
  const ambiguous = [];
  const unmatched = [];
  const skippedNoStorage = [];

  if (!evidenceRows.length) {
    return { ok: true, attached, ambiguous, unmatched, skipped_no_storage: skippedNoStorage };
  }

  const dates = evidenceRows.map((e) => e.ocr_date).filter(Boolean).sort();
  const startDate = addDays(dates[0], -MARGIN_DAYS);
  const endDate = addDays(dates[dates.length - 1], MARGIN_DAYS);
  const journals = await fetchJournals({ accessToken, startDate, endDate });
  // 診断情報（マッチしない原因の切り分け用）: 取得件数と先頭サンプル
  const debug = {
    start_date: startDate,
    end_date: endDate,
    journals_count: journals.length,
    samples: journals.map((j) => ({
      no: j.number,
      date: j.transaction_date,
      amount: journalAmount(j),
      type: j.journal_type || null,
      vouchers: Array.isArray(j.voucher_file_ids) ? j.voucher_file_ids.length : null,
    })),
  };

  for (const evidence of evidenceRows) {
    if (!evidence.storage_path) {
      skippedNoStorage.push(evidence.id);
      continue;
    }
    const candidates = findCandidates(journals, evidence);
    if (candidates.length === 1) {
      try {
        await attachEvidenceToJournal({ accessToken, evidence, journalId: candidates[0].id });
        attached.push({ evidence_id: evidence.id, journal_id: candidates[0].id, via: 'exact' });
        // 添付した仕訳は同一実行内で他の証憑候補から除外されるよう voucher_file_ids を仮更新
        candidates[0].voucher_file_ids = (candidates[0].voucher_file_ids || []).concat(['__attached_this_run__']);
      } catch (e) {
        unmatched.push(evidence.id);
      }
    } else if (candidates.length > 1) {
      // 摘要第二キー: ocr_vendorで1件に絞れるか試す
      const vendorMatch = resolveByVendor(candidates, evidence);
      if (vendorMatch) {
        try {
          await attachEvidenceToJournal({ accessToken, evidence, journalId: vendorMatch.id });
          attached.push({ evidence_id: evidence.id, journal_id: vendorMatch.id, via: 'vendor' });
          vendorMatch.voucher_file_ids = (vendorMatch.voucher_file_ids || []).concat(['__attached_this_run__']);
        } catch (e) {
          unmatched.push(evidence.id);
        }
      } else {
        ambiguous.push({
          evidence_id: evidence.id,
          file_name: evidence.file_name,
          candidates: candidates.map((j) => journalSummary(j, false)),
        });
      }
    } else {
      // 完全一致が0件の場合のみ、±3日の緩和マッチを試みる。自動添付はせず全件ambiguousで返す。
      const fuzzyCandidates = findFuzzyCandidates(journals, evidence);
      if (fuzzyCandidates.length) {
        ambiguous.push({
          evidence_id: evidence.id,
          file_name: evidence.file_name,
          fuzzy: true,
          candidates: fuzzyCandidates.map((j) => journalSummary(j, true)),
        });
      } else {
        // 第三段: 取引先名＋日付±7日（金額不問・外貨建て向け）。候補提示のみ。
        const vendorCandidates = findVendorDateCandidates(journals, evidence);
        if (vendorCandidates.length) {
          ambiguous.push({
            evidence_id: evidence.id,
            file_name: evidence.file_name,
            fuzzy: true,
            vendor_date: true,
            candidates: vendorCandidates.map((j) => journalSummary(j, true)),
          });
        } else {
          unmatched.push(evidence.id);
        }
      }
    }
  }

  return { ok: true, attached, ambiguous, unmatched, skipped_no_storage: skippedNoStorage, debug };
}

// 手動確定モード: {evidence_id, journal_id} を指定して添付する
async function runManualMatch({ accessToken, evidenceId, journalId }) {
  const evidence = await fetchEvidenceById(evidenceId);
  if (!evidence) {
    return { status: 404, body: { ok: false, error: 'evidence_not_found' } };
  }
  if (!evidence.storage_path) {
    return { status: 400, body: { ok: false, error: 'no_storage_path' } };
  }
  await attachEvidenceToJournal({ accessToken, evidence, journalId });
  return { status: 200, body: { ok: true, attached: [{ evidence_id: evidenceId, journal_id: journalId }] } };
}

module.exports = {
  getAccessToken,
  NotConnectedError,
  fetchBoxSavedEvidence,
  fetchEvidenceById,
  updateEvidence,
  fetchStorageFileBase64,
  fetchJournals,
  journalAmount,
  journalSummary,
  addDays,
  findCandidates,
  findFuzzyCandidates,
  journalPassesCommonFilters,
  attachEvidenceToJournal,
  runAutoMatch,
  runManualMatch,
};
