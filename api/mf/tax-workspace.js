// POST /api/mf/tax-workspace
// 税理士ワークスペースの読み取り専用API（Phase 1）。
// 設計書: docs/TAX_WORKSPACE_PLAN.md
//
// Phase 1では **一切書き込まない**。MFへの仕訳作成(journalize)はPhase 3。
// body: { action: 'bootstrap' | 'list', month?: 'YYYY-MM' }
//
// 認可の二段構え:
//   1. Supabaseのログイン済みトークンであること
//   2. そのメールが tax_advisors に enabled=true で載っていること
// どちらも満たさなければ403。判定はすべてこのサーバー側で行う
// （画面側のガードは迂回できるため、判断材料にしない）。
'use strict';

const {
  getAccessToken,
  NotConnectedError,
  MF_ACCOUNTING_API_BASE,
  mfFetch,
  fetchUnjournalizedTransactions,
} = require('./_lib/mf-client');
const { normalizeText, addDays, VENDOR_DATE_MARGIN_DAYS } = require('./_lib/mf-match-core');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TAX_DOCS_BUCKET = 'tax-docs';
// 共有ファイルのうち証憑として添付できる形式（api/mf/ingest-mail.js の
// ALLOWED_CONTENT_TYPES に合わせる）。xlsxは対象外＝③共有ファイルで見るだけ。
const ATTACHABLE_EXT_RE = /\.(pdf|png|jpe?g)$/i;
const SIGN_EXPIRES_SEC = 600;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    if (req.body && typeof req.body === 'object') { resolve(req.body); return; }
    if (typeof req.body === 'string') {
      try { resolve(JSON.parse(req.body)); } catch (e) { resolve({}); }
      return;
    }
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 100000) raw = raw.slice(0, 100000); });
    req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}

// 許可リストに載っている税理士か調べる。載っていなければ null。
async function findAdvisor(userEmail) {
  const e = String(userEmail || '').trim().toLowerCase();
  if (!e) return null;
  const url = `${SUPABASE_URL}/rest/v1/tax_advisors?select=email,name,enabled&enabled=is.true&limit=200`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  if (!Array.isArray(rows)) return null;
  return rows.find((r) => String(r.email || '').trim().toLowerCase() === e) || null;
}

function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return null;
  const start = `${m[1]}-${m[2]}-01`;
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  return { start, end: `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}` };
}

// MFのマスタを取る（選択欄用）。読み取り専用。
async function fetchMaster(accessToken, path) {
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// 仕訳にまだ添付されていない証憑（＝添付候補になりうるもの）
async function fetchOpenEvidence() {
  const url =
    `${SUPABASE_URL}/rest/v1/mf_evidence` +
    `?select=id,ocr_date,ocr_amount,ocr_currency,ocr_vendor,file_name,status,storage_path` +
    `&status=in.(pending,awaiting_match,box_saved)&storage_path=not.is.null` +
    `&order=ocr_date.desc&limit=300`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

// 明細と証憑の突き合わせ。api/mf/awaiting-reason.js と同じ規則。
// ⚠ mf-match-core.js の findVendorDateCandidates は仕訳を相手にする関数なので使えない。
function evidenceMatchesTransaction(ev, tx) {
  const vendorNorm = normalizeText(ev.ocr_vendor);
  if (!vendorNorm) return false;
  const contentNorm = normalizeText(tx.content);
  if (!contentNorm) return false;
  if (!(contentNorm.includes(vendorNorm) || vendorNorm.includes(contentNorm))) return false;
  if (!ev.ocr_date || !tx.date) return false;
  return tx.date >= addDays(ev.ocr_date, -VENDOR_DATE_MARGIN_DAYS)
    && tx.date <= addDays(ev.ocr_date, VENDOR_DATE_MARGIN_DAYS);
}

// 税理士へ共有しているファイル一覧（署名URL付き）。オーナーの行から読む。
async function fetchSharedFiles() {
  const url = `${SUPABASE_URL}/rest/v1/app_settings?skey=eq.tax_docs_index&select=user_email,value&limit=50`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => []);
  const out = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const files = row && row.value && row.value.data && row.value.data.files;
    if (!files || typeof files !== 'object') continue;
    for (const key of Object.keys(files)) {
      const meta = files[key] || {};
      if (meta.del) continue;
      const segs = key.split('/');
      const month = /^\d{4}-\d{2}$/.test(segs[0]) ? segs[0] : (segs[1] || '');
      const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${TAX_DOCS_BUCKET}/${key}`, {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({ expiresIn: SIGN_EXPIRES_SEC }),
      });
      if (!signRes.ok) continue;
      const signData = await signRes.json().catch(() => null);
      if (!signData || !signData.signedURL) continue;
      out.push({
        key,
        name: meta.name || key,
        size: meta.size || 0,
        ts: meta.ts || 0,
        month,
        attachable: ATTACHABLE_EXT_RE.test(meta.name || key),
        url: `${SUPABASE_URL}/storage/v1${signData.signedURL}`,
      });
    }
  }
  out.sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : (b.ts || 0) - (a.ts || 0)));
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  let advisor;
  try {
    advisor = await findAdvisor(user.email);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'advisor_check_failed' });
    return;
  }
  if (!advisor) {
    // 許可リストに無い＝この画面の利用者ではない。何のデータも返さない。
    res.status(403).json({ ok: false, error: 'not_tax_advisor' });
    return;
  }

  const body = await readJsonBody(req);
  const action = body && body.action;
  if (['bootstrap', 'list'].indexOf(action) < 0) {
    res.status(400).json({ ok: false, error: 'invalid_action' });
    return;
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (e instanceof NotConnectedError) {
      res.status(200).json({ ok: false, error: 'not_connected', advisor: { email: advisor.email, name: advisor.name } });
      return;
    }
    res.status(500).json({ ok: false, error: 'token_failed' });
    return;
  }

  // 選択欄のマスタだけを返す（画面の初期化用）
  if (action === 'bootstrap') {
    try {
      const accounts = await fetchMaster(accessToken, 'accounts');
      const taxes = await fetchMaster(accessToken, 'taxes?available=true');
      const partners = await fetchMaster(accessToken, 'trade_partners');
      res.status(200).json({
        ok: true,
        advisor: { email: advisor.email, name: advisor.name },
        accounts: accounts.accounts || [],
        taxes: taxes.taxes || [],
        trade_partners: partners.trade_partners || [],
      });
    } catch (e) {
      // スコープ不足（再連携前）は403。他機能に影響させず、案内だけ返す。
      if (e && (e.status === 403 || e.status === 401)) {
        res.status(200).json({ ok: false, error: 'scope_missing', advisor: { email: advisor.email, name: advisor.name } });
        return;
      }
      res.status(200).json({ ok: false, error: 'master_fetch_failed', message: e && e.message });
    }
    return;
  }

  // 画面の中身（未仕訳の明細・証憑候補・共有ファイル）
  const range = monthRange(body.month);
  if (!range) {
    res.status(400).json({ ok: false, error: 'invalid_month' });
    return;
  }

  let transactions = [];
  try {
    transactions = await fetchUnjournalizedTransactions({
      accessToken,
      startDate: range.start,
      endDate: range.end,
    });
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      res.status(200).json({ ok: false, error: 'scope_missing', advisor: { email: advisor.email, name: advisor.name } });
      return;
    }
    res.status(200).json({ ok: false, error: 'transactions_fetch_failed', message: e && e.message });
    return;
  }

  const evidences = await fetchOpenEvidence();
  const sharedFiles = await fetchSharedFiles();

  const items = transactions.map((tx) => ({
    transaction_id: tx.id,
    date: tx.date,
    content: tx.content,
    value: tx.value,
    side: tx.side,
    // 証憑の候補。自動では選ばない（設計書§3.2）。
    evidence_candidates: evidences
      .filter((ev) => evidenceMatchesTransaction(ev, tx))
      .map((ev) => ({
        evidence_id: ev.id,
        file_name: ev.file_name,
        ocr_date: ev.ocr_date,
        ocr_amount: ev.ocr_amount,
        ocr_currency: ev.ocr_currency || 'JPY',
        ocr_vendor: ev.ocr_vendor,
      })),
  }));

  res.status(200).json({
    ok: true,
    advisor: { email: advisor.email, name: advisor.name },
    month: body.month,
    // Phase 1は読み取りのみ。画面はこれを見て登録ボタンを出さない。
    writable: false,
    items,
    shared_files: sharedFiles,
    open_evidence_count: evidences.length,
  });
};
