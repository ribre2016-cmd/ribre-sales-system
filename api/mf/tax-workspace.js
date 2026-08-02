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

const crypto = require('crypto');
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

// 社内メンバー（オーナー）。この人たちは tax_advisors に載っていなくてもこの画面を使え、
// さらに招待リンクの発行・取り消しができる。
// 出典: supabase_mf_owner_rls.sql の会員許可リスト、services/auth-gate.js の MEMBER_EMAILS と同じ2件。
// ⚠ 画面側の許可リストは迂回できるため、権限の判断は必ずこのサーバー側の定数で行う。
const MEMBER_EMAILS = ['ribre2016@gmail.com', 'k.sado@ribre.co.jp'];
const INVITE_TTL_DAYS = 7;

function isMemberEmail(userEmail) {
  const e = String(userEmail || '').trim().toLowerCase();
  if (!e) return false;
  return MEMBER_EMAILS.some((m) => m.toLowerCase() === e);
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

/* ---------------- 招待リンク ---------------- */

// 招待リンクを発行する（社内メンバーのみ）。有効期限つき・1回だけ使える。
async function createInvite(createdBy, note) {
  const token = crypto.randomBytes(16).toString('hex'); // 32桁
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 3600 * 1000).toISOString();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisor_invites`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify([{ token, created_by: createdBy, expires_at: expiresAt, note: note || null }]),
  });
  if (!res.ok) throw new Error(`invite_create_failed: HTTP ${res.status}`);
  return { token, expires_at: expiresAt };
}

async function listInvites() {
  const url = `${SUPABASE_URL}/rest/v1/tax_advisor_invites?select=*&order=created_at.desc&limit=50`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function revokeInvite(token) {
  const url = `${SUPABASE_URL}/rest/v1/tax_advisor_invites?token=eq.${encodeURIComponent(token)}&revoked_at=is.null&used_at=is.null`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

// 招待リンクを使って自分を税理士として登録する。
// メールアドレスはログイン中のアカウントのものを使う（本人以外を登録できない）。
async function redeemInvite(token, userEmail) {
  const t = String(token || '');
  if (!/^[a-f0-9]{32}$/.test(t)) return { ok: false, error: 'invalid_invite' };
  const e = String(userEmail || '').trim().toLowerCase();
  if (!e) return { ok: false, error: 'no_email' };

  // 未使用・未取り消し・期限内のものだけを「使用済み」にできる。
  // 条件付きUPDATEなので、同時に2人が同じリンクを開いても片方しか成功しない。
  const nowIso = new Date().toISOString();
  const url =
    `${SUPABASE_URL}/rest/v1/tax_advisor_invites` +
    `?token=eq.${encodeURIComponent(t)}&used_at=is.null&revoked_at=is.null` +
    `&expires_at=gt.${encodeURIComponent(nowIso)}`;
  const claim = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ used_at: nowIso, used_email: e }),
  });
  if (!claim.ok) return { ok: false, error: 'invite_check_failed' };
  const rows = await claim.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) {
    // 使用済み・取り消し済み・期限切れ・存在しない のいずれか
    return { ok: false, error: 'invite_unusable' };
  }

  // 税理士として登録（既にいれば有効化し直す）
  const up = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisors?on_conflict=email`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ email: e, enabled: true, note: '招待リンクから登録 ' + nowIso.slice(0, 10) }]),
  });
  if (!up.ok) {
    // 招待だけ消費して登録できていない状態を残さないよう、使用済みを取り消す
    await fetch(`${SUPABASE_URL}/rest/v1/tax_advisor_invites?token=eq.${encodeURIComponent(t)}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ used_at: null, used_email: null }),
    }).catch(() => {});
    return { ok: false, error: 'advisor_register_failed' };
  }
  return { ok: true, email: e };
}

async function listAdvisors() {
  const url = `${SUPABASE_URL}/rest/v1/tax_advisors?select=id,email,name,enabled,note,created_at&order=created_at.desc&limit=100`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return [];
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function setAdvisorEnabled(email, enabled) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const url = `${SUPABASE_URL}/rest/v1/tax_advisors?email=eq.${encodeURIComponent(e)}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify({ enabled: !!enabled }),
  });
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
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

  const body = await readJsonBody(req);
  const action = body && body.action;
  const isMember = isMemberEmail(user.email);

  // 招待リンクの引き換えだけは、まだ税理士として登録されていない人が使う。
  // ログイン済みであることは上で確認済みで、登録するメールはそのログイン中のもの
  // （リクエストの中身では決めない＝他人を勝手に登録できない）。
  if (action === 'redeem_invite') {
    let r;
    try {
      r = await redeemInvite(body.invite_token, user.email);
    } catch (e) {
      res.status(500).json({ ok: false, error: 'invite_check_failed' });
      return;
    }
    res.status(r.ok ? 200 : 200).json(r);
    return;
  }

  let advisor;
  try {
    advisor = await findAdvisor(user.email);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'advisor_check_failed' });
    return;
  }
  // 社内メンバーは tax_advisors に載っていなくてもこの画面を使える
  if (!advisor && isMember) {
    advisor = { email: user.email, name: '社内メンバー' };
  }
  if (!advisor) {
    // 許可リストに無い＝この画面の利用者ではない。何のデータも返さない。
    res.status(403).json({ ok: false, error: 'not_tax_advisor' });
    return;
  }

  // 招待と税理士の管理は社内メンバーだけ
  const MEMBER_ONLY = ['invite_create', 'invite_list', 'invite_revoke', 'advisor_list', 'advisor_set_enabled'];
  if (MEMBER_ONLY.indexOf(action) >= 0) {
    if (!isMember) {
      res.status(403).json({ ok: false, error: 'member_only' });
      return;
    }
    try {
      if (action === 'invite_create') {
        const inv = await createInvite(user.email, body.note);
        res.status(200).json({ ok: true, ...inv });
      } else if (action === 'invite_list') {
        res.status(200).json({ ok: true, invites: await listInvites() });
      } else if (action === 'invite_revoke') {
        res.status(200).json({ ok: true, revoked: await revokeInvite(body.invite_token) });
      } else if (action === 'advisor_list') {
        res.status(200).json({ ok: true, advisors: await listAdvisors() });
      } else {
        res.status(200).json({ ok: true, updated: await setAdvisorEnabled(body.email, body.enabled) });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: 'member_action_failed', message: e && e.message });
    }
    return;
  }

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
    // 社内メンバーには招待・税理士管理のパネルを出す
    is_member: isMember,
    month: body.month,
    // Phase 1は読み取りのみ。画面はこれを見て登録ボタンを出さない。
    writable: false,
    items,
    shared_files: sharedFiles,
    open_evidence_count: evidences.length,
  });
};
