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
const {
  normalizeText, addDays, VENDOR_DATE_MARGIN_DAYS,
  fetchEvidenceById, attachEvidenceToJournal,
  fetchJournals, journalVendorText, vendorTokens,
} = require('./_lib/mf-match-core');
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
  const url = `${SUPABASE_URL}/rest/v1/tax_advisors?select=email,name,enabled,role&enabled=is.true&limit=200`;
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

/* 連携サービス（銀行・カード）の名前を引けるようにする。
 * 明細は connected_account_id / connected_sub_account_id を持っているが名前は持たないので、
 * ここで対応表を作る。MFの画面は口座ごとに未仕訳を出すので、この画面でも
 * 「どの銀行・カードの明細か」が分かるようにするために要る（利用者の指摘 2026-08-04）。
 * 要スコープ: mfc/accounting/connected_account.read（2026-08-04の再連携で取得済み）。
 * 取れなくても画面は動かす（口座名が空欄になるだけ）。 */
async function fetchAccountLabels(accessToken) {
  const byId = {};
  try {
    const data = await fetchMaster(accessToken, 'connected_accounts');
    (data.connected_accounts || []).forEach((ca) => {
      if (!ca || !ca.id) return;
      byId['svc:' + ca.id] = ca.name || '';
      (ca.connected_sub_accounts || []).forEach((sub) => {
        if (!sub || !sub.id) return;
        // 口座IDのほうが細かい（例: 「青木信用金庫」の中の「指扇支店 普通 5056307」）
        byId['acc:' + sub.id] = { service: ca.name || '', account: sub.name || '' };
      });
    });
  } catch (e) {
    // スコープ不足・障害。名前が出ないだけで登録作業は続けられる
    console.error('connected_accounts の取得に失敗（口座名は空欄になります）', e && e.message);
  }
  return byId;
}

// 明細1件の「どの銀行・カードか」を組み立てる
function accountLabelFor(labels, tx) {
  const sub = tx && tx.connected_sub_account_id ? labels['acc:' + tx.connected_sub_account_id] : null;
  if (sub && typeof sub === 'object') {
    return { service: sub.service, account: sub.account };
  }
  const svc = tx && tx.connected_account_id ? labels['svc:' + tx.connected_account_id] : '';
  return { service: typeof svc === 'string' ? svc : '', account: '' };
}

// 仕訳にまだ添付されていない証憑（＝添付候補になりうるもの）
/* ⚠ 取得に失敗したときに空配列を返すと、画面には
 *   「候補となる証憑は見つかりませんでした」としか出ず、不具合が「無い」に化ける。
 *   提案（handleSuggest）でまったく同じ見落としをして原因を3回取り違えた。
 *   失敗は必ず失敗として上へ伝えること（所長レビューの指摘・2026-08-04）。 */
async function fetchOpenEvidence() {
  const url =
    `${SUPABASE_URL}/rest/v1/mf_evidence` +
    `?select=id,ocr_date,ocr_amount,ocr_currency,ocr_vendor,file_name,status,storage_path` +
    `&status=in.(pending,awaiting_match,box_saved)&storage_path=not.is.null` +
    `&order=ocr_date.desc&limit=300`;
  let res;
  try {
    res = await fetch(url, { headers: supabaseHeaders() });
  } catch (e) {
    return { ok: false, rows: [], reason: '通信に失敗しました' };
  }
  if (!res.ok) return { ok: false, rows: [], reason: 'HTTP ' + res.status };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, rows: [], reason: '応答の形式が想定と違います' };
  return { ok: true, rows, reason: '' };
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
  const url = `${SUPABASE_URL}/rest/v1/app_settings?skey=eq.tax_docs_index&user_email=in.(${MEMBER_EMAILS.map(encodeURIComponent).join(',')})&select=user_email,value&limit=50`;
  // 証憑と同じ理由で、失敗を「ファイルが無い」に化けさせない
  let res;
  try {
    res = await fetch(url, { headers: supabaseHeaders() });
  } catch (e) {
    return { ok: false, files: [], reason: '通信に失敗しました' };
  }
  if (!res.ok) return { ok: false, files: [], reason: 'HTTP ' + res.status };
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
        // ⚠ download= を付けないと、保存時のキー（日時つきの内部名）でダウンロードされる。
        //   税理士が受け取ったときに何のファイルか分からなくなるため必ず元の名前を渡す。
        //   api/mf/evidence-action.js は同じ理由で先に対応済み（そちらに合わせた）。
        url: `${SUPABASE_URL}/storage/v1${signData.signedURL}&download=${encodeURIComponent(meta.name || key.split('/').pop())}`,
      });
    }
  }
  out.sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : (b.ts || 0) - (a.ts || 0)));
  return { ok: true, files: out, reason: '' };
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
  const url = `${SUPABASE_URL}/rest/v1/tax_advisors?select=id,email,name,enabled,role,note,created_at&order=created_at.desc&limit=100`;
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

/* ---------------- Phase 4: 過去の仕訳から初期値を提案する ----------------
 * ⚠ これは「前回と同じ」であって「正しい」ではない。
 *   同じ取引先でも中身が違えば勘定科目は変わる（仕入と消耗品費など）。
 *   そのため:
 *     - 自動で登録は絶対にしない。必ず人が「登録」を押す
 *     - 画面に「前回の仕訳から入れています。確認してください」を必ず出す
 *     - 迷ったら**提案しない**（勝手に決めつけない）。下記の2条件を満たすときだけ返す
 */
const {
  SUGGEST_LOOKBACK_DAYS, SUGGEST_MAX_ITEMS,
  buildSuggestIndex, suggestForContent, comboSideForTransaction,
  fetchJournalsForSuggest,
} = require('./_lib/suggest-core');

async function handleSuggest(res, accessToken, body) {
  const items = Array.isArray(body && body.items) ? body.items.slice(0, SUGGEST_MAX_ITEMS) : [];
  if (!items.length) {
    res.status(200).json({ ok: true, suggestions: {} });
    return;
  }
  const dates = items.map((it) => String(it && it.date || '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (!dates.length) {
    res.status(200).json({ ok: true, suggestions: {} });
    return;
  }
  const endDate = dates[dates.length - 1];

  // ⚠ MFの仕訳APIは会計年度をまたぐ期間を受け付けない（400になる）。
  //   会計期間ごとに分けて取る（2026-08-04にこれが原因で提案が0件だった）。
  let terms = [];
  try {
    terms = (await fetchMaster(accessToken, 'term_settings')).term_settings || [];
  } catch (e) { terms = []; }

  let journals = [];
  try {
    journals = await fetchJournalsForSuggest({ accessToken, endDate, terms, fetchJournals });
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      res.status(200).json({ ok: false, error: 'scope_missing' });
      return;
    }
    // 提案は「あれば便利」なだけなので、失敗しても画面は動かす
    res.status(200).json({ ok: true, suggestions: {}, note: 'journals_fetch_failed' });
    return;
  }

  const index = buildSuggestIndex(journals);
  const suggestions = {};
  items.forEach((it) => {
    const id = it && it.transaction_id;
    if (!id) return;
    const s = suggestForContent(index, it && it.content, it && it.side);
    if (s) suggestions[id] = s;
  });
  res.status(200).json({
    ok: true, suggestions,
    based_on: { end_date: endDate, journals: journals.length, terms: terms.length },
  });
}

/* ---------------- 決算済みの期の扱い（設定） ---------------- */
// 'warn'  … 警告を出すだけで登録はできる（既定）
// 'block' … 進行中の期以外への登録を拒否する
// ⚠ 画面のガードは迂回できるため、登録処理でも必ずこの値を見て判定する。
const CLOSED_TERM_POLICIES = ['warn', 'block'];
// インボイス区分。仕訳登録では必須（既定値へ倒さない。理由は handleJournalize のコメント）
const VALID_INVOICE_KINDS = ['INVOICE_KIND_NOT_TARGET', 'INVOICE_KIND_QUALIFIED', 'INVOICE_KIND_UNQUALIFIED_80'];

async function fetchClosedTermPolicy() {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tax_workspace_settings?id=eq.1&select=closed_term_policy&limit=1`, {
      headers: supabaseHeaders(),
    });
    if (!r.ok) return 'warn';
    const rows = await r.json().catch(() => []);
    const v = Array.isArray(rows) && rows[0] && rows[0].closed_term_policy;
    return CLOSED_TERM_POLICIES.indexOf(v) >= 0 ? v : 'warn';
  } catch (e) {
    return 'warn'; // 取得できないときは止めない（作業を妨げない側に倒す）
  }
}

async function saveClosedTermPolicy(policy, byEmail) {
  const p = CLOSED_TERM_POLICIES.indexOf(policy) >= 0 ? policy : null;
  if (!p) return false;
  const r = await fetch(`${SUPABASE_URL}/rest/v1/tax_workspace_settings?on_conflict=id`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ id: 1, closed_term_policy: p, updated_by: byEmail, updated_at: new Date().toISOString() }]),
  });
  return r.ok;
}

// 今日の日付が入る期を「進行中の期」とし、指定日がそこに入るかを返す。
// 会計期間が取れないときは null（＝判定できないので止めない）。
function isInProgressingTerm(terms, dateStr) {
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length || !dateStr) return null;
  const today = new Date().toISOString().slice(0, 10);
  const inTerm = (t, d) => t && t.start_date && t.end_date && d >= t.start_date && d <= t.end_date;
  const progressing = list.find((t) => inTerm(t, today));
  if (!progressing) return null;
  return { ok: inTerm(progressing, dateStr), term: list.find((t) => inTerm(t, dateStr)) || null };
}

/* 承認して実行する。admin のみ。
 * ⚠ 依頼時点の明細（金額・日付・摘要）と今の明細を突き合わせ、
 *   変わっていたら**実行しない**（設計書§10.2-1・所長レビューの条件）。 */
async function handleApproveRequest(res, advisor, accessToken, body) {
  const id = Number(body && body.request_id);
  if (!id) { res.status(400).json({ ok: false, error: 'invalid_request' }); return; }

  const listRes = await fetch(
    `${SUPABASE_URL}/rest/v1/tax_journal_requests?id=eq.${id}&status=eq.pending&select=*&limit=1`,
    { headers: supabaseHeaders() }
  );
  const rows = listRes.ok ? await listRes.json().catch(() => []) : [];
  const reqRow = Array.isArray(rows) ? rows[0] : null;
  if (!reqRow) { res.status(200).json({ ok: false, error: 'request_not_found' }); return; }

  // 依頼してから明細が変わっていないか
  let tx = null;
  try {
    tx = await findTransaction(accessToken, reqRow.transaction_id, (reqRow.payload && reqRow.payload.date) || '');
  } catch (e) {
    res.status(200).json({ ok: false, error: 'transaction_check_failed', message: e && e.message });
    return;
  }
  if (!tx) { res.status(200).json({ ok: false, error: 'transaction_not_found' }); return; }
  if (tx.journalizing_status !== 'none') {
    res.status(200).json({ ok: false, error: 'already_journalized', status: tx.journalizing_status });
    return;
  }
  const now = txSnapshot(tx);
  if (reqRow.snapshot && !sameSnapshot(reqRow.snapshot, now)) {
    await recordAction({
      actor_email: advisor.email, action: 'approve_journalize', transaction_id: reqRow.transaction_id,
      result: 'failed', error_message: 'transaction_changed',
      payload: { request_id: id, requested_by: reqRow.requested_by, before: reqRow.snapshot, after: now },
    });
    res.status(200).json({ ok: false, error: 'transaction_changed', before: reqRow.snapshot, after: now });
    return;
  }

  // 先に「承認した」ことを記録する（実行の途中で落ちても承認の事実は残す）
  const claimed = await updateJournalRequest(id, {
    status: 'approved', decided_by: advisor.email, decided_at: new Date().toISOString(),
  });
  if (!claimed.ok) { res.status(200).json({ ok: false, error: 'already_decided' }); return; }

  await recordAction({
    actor_email: advisor.email, action: 'approve_journalize', transaction_id: reqRow.transaction_id,
    result: 'ok',
    payload: { request_id: id, requested_by: reqRow.requested_by, snapshot: now },
  });

  // 依頼された内容そのままで、通常の登録処理を実行する（承認は飛ばす）
  const p = reqRow.payload || {};
  await handleJournalize(res, advisor, accessToken, {
    transaction_id: reqRow.transaction_id, date: p.date, account_id: p.account_id,
    tax_id: p.tax_id, sub_account_id: p.sub_account_id, invoice_kind: p.invoice_kind,
    memo: p.memo, evidence_ids: p.evidence_ids,
    // 誰の判断だったかを残す。承認者ではなく依頼者の入力が元になっている
    input_source: p.input_source,
  }, { isAdmin: true, skipApproval: true });
}

// 差し戻す。理由は必須（設計書§2.3-5）
async function handleRejectRequest(res, advisor, body) {
  const id = Number(body && body.request_id);
  const reason = String((body && body.reason) || '').trim();
  if (!id) { res.status(400).json({ ok: false, error: 'invalid_request' }); return; }
  if (!reason) { res.status(200).json({ ok: false, error: 'reason_required' }); return; }
  const r = await updateJournalRequest(id, {
    status: 'rejected', decided_by: advisor.email,
    decided_reason: reason.slice(0, 500), decided_at: new Date().toISOString(),
  });
  if (!r.ok) { res.status(200).json({ ok: false, error: 'already_decided' }); return; }
  await recordAction({
    actor_email: advisor.email, action: 'reject_journalize',
    transaction_id: r.row && r.row.transaction_id, result: 'ok',
    payload: { request_id: id, requested_by: r.row && r.row.requested_by, reason: reason.slice(0, 500) },
  });
  res.status(200).json({ ok: true });
}

/* 操作履歴をCSVで返す（設計書§2.4）。
 * ⚠ この記録はRIBRE側（service roleの鍵を持つ側）には技術的に書き換えられる。
 *   事務所が自分でダウンロードして手元に置くことだけが担保になる。ガイドにもそう書く。 */
// CSVの組み立てで使う文字。正規表現やエスケープに頼らず、文字コードで持つ
const chr34 = String.fromCharCode(34);   // "
const chr13 = String.fromCharCode(13);   // CR
const chr10 = String.fromCharCode(10);   // LF

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  // カンマ・引用符・改行を含む値は引用符で囲み、中の引用符は2つに増やす（CSVの決まり）
  const needsQuote = s.indexOf(',') >= 0 || s.indexOf(chr34) >= 0
    || s.indexOf(chr13) >= 0 || s.indexOf(chr10) >= 0;
  return needsQuote ? chr34 + s.split(chr34).join(chr34 + chr34) + chr34 : s;
}

async function handleActionLogCsv(res, advisor, isAdmin, body) {
  const month = String((body && body.month) || '');
  let url = `${SUPABASE_URL}/rest/v1/tax_advisor_actions?select=*&order=created_at.desc&limit=5000`;
  if (!isAdmin) url += `&actor_email=eq.${encodeURIComponent(advisor.email)}`;
  const r = monthRange(month);
  if (r) url += `&created_at=gte.${r.start}T00:00:00Z&created_at=lte.${r.end}T23:59:59Z`;
  const resp = await fetch(url, { headers: supabaseHeaders() });
  if (!resp.ok) { res.status(200).json({ ok: false, error: 'action_log_failed' }); return; }
  const rows = await resp.json().catch(() => []);
  const header = ['日時', '操作した人', '操作', '結果', '明細ID', '仕訳ID', '勘定科目ID', '税区分ID',
    '証憑の件数', '入力', 'エラー', '内容'];
  const lines = [header.join(',')];
  (Array.isArray(rows) ? rows : []).forEach((a) => {
    lines.push([
      a.created_at, a.actor_email, a.action, a.result, a.transaction_id, a.journal_id,
      a.account_id, a.tax_id,
      (a.evidence_ids && a.evidence_ids.length) || 0,
      (a.payload && a.payload.input_source) || '',
      a.error_message || '',
      a.payload ? JSON.stringify(a.payload) : '',
    ].map(csvEscape).join(','));
  });
  // Excelで開いたときに文字化けしないよう BOM を付ける
  res.status(200).json({ ok: true, csv: String.fromCharCode(65279) + lines.join(chr13 + chr10), rows: lines.length - 1 });
}

/* ---------------- Phase 7: ⑨月次チェック（読み取り専用） ----------------
   設計書: docs/TAX_WORKSPACE_PHASE7_PLAN.md §2 / §11.1 / §11.2
   MFへは GET /reports/* しか呼ばない。**何も書き込まない。**
   実測(§16): report.read は再連携済みで使える。 */

// 推移表の入れ子（financial_statement_item の下に account）を平らにする。
// 各科目に、属する大分類（売上高合計・販売費及び一般管理費合計 など）を持たせる。
function flattenReportRows(rows, sectionName, out) {
  const list = Array.isArray(rows) ? rows : [];
  const acc = out || [];
  list.forEach((r) => {
    if (!r) return;
    if (r.type === 'account') {
      acc.push({ name: r.name, section: sectionName || '', values: Array.isArray(r.values) ? r.values : [] });
    } else {
      // 大分類の名前は最上位のものを引き継ぐ（「販売費及び一般管理費合計」など）
      flattenReportRows(r.rows, sectionName || r.name, acc);
    }
  });
  return acc;
}

function median(nums) {
  const a = nums.slice().sort((x, y) => x - y);
  if (!a.length) return 0;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

// 対象月がどの会計年度に属するか。term_settings から取る（3/1〜2/28をコードに書かない）。
function findTermFor(terms, monthStart) {
  const list = Array.isArray(terms) ? terms : [];
  return list.find((t) => t && t.start_date && t.end_date && monthStart >= t.start_date && monthStart <= t.end_date) || null;
}

// 月がまだ終わっていないか（§11.1-2: 進行中の月は計上漏れ判定を出さない）
function isMonthInProgress(monthEnd) {
  const today = new Date().toISOString().slice(0, 10);
  return today <= monthEnd;
}

const MC_DEFAULTS = { lookback: 4, ratio: 3, minDiff: 10000 };

async function handleMonthlyCheck(res, advisor, accessToken, body) {
  const range = monthRange(body.month);
  if (!range) { res.status(400).json({ ok: false, error: 'invalid_month' }); return; }

  // しきい値は画面から変えられる（§2.2）。おかしな値は既定へ戻す。
  const ratio = Number(body.ratio) >= 1.5 && Number(body.ratio) <= 20 ? Number(body.ratio) : MC_DEFAULTS.ratio;
  const minDiff = Number(body.min_diff) >= 0 && Number(body.min_diff) <= 10000000
    ? Math.round(Number(body.min_diff)) : MC_DEFAULTS.minDiff;

  let terms = [];
  try {
    terms = (await fetchMaster(accessToken, 'term_settings')).term_settings || [];
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      res.status(200).json({ ok: false, error: 'scope_missing' }); return;
    }
    res.status(200).json({ ok: false, error: 'term_settings_failed', message: e && e.message }); return;
  }

  const term = findTermFor(terms, range.start);
  if (!term) {
    res.status(200).json({ ok: false, error: 'no_term_for_month', message: 'その月を含む会計年度がMFに見つかりません' });
    return;
  }

  const targetMonthNum = Number(range.start.slice(5, 7));
  // 会計年度の開始月も明示して渡す（省略時の既定に頼らない）。term_settings から取るので
  // 3月始まりという前提をコードに書かずに済む。
  const startMonthNum = Number(String(term.start_date || '').slice(5, 7)) || 1;

  // 会計年度の頭から対象月までを取る。列は会計年度内の月の並びで返る。
  let report;
  try {
    report = await fetchMaster(
      accessToken,
      `reports/transition_pl?type=monthly&fiscal_year=${encodeURIComponent(term.fiscal_year)}`
      + `&start_month=${startMonthNum}&end_month=${targetMonthNum}`
    );
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      // 再連携がまだ、という一番ありがちな失敗を名指しで返す
      res.status(200).json({ ok: false, error: 'report_scope_missing' }); return;
    }
    res.status(200).json({
      ok: false, error: 'report_failed',
      message: (e && e.message) || '推移表の取得に失敗しました',
      status: e && e.status,
    });
    return;
  }

  const columns = (report.columns || []).map(String);
  const idx = columns.indexOf(String(targetMonthNum));
  if (idx < 0) {
    res.status(200).json({
      ok: false, error: 'month_not_in_report',
      message: `推移表に${targetMonthNum}月の列がありません（返ってきた列: ${columns.join(',') || 'なし'}）`,
      columns,
    });
    return;
  }

  const flat = flattenReportRows(report.rows, '', []);
  const missing = [];
  const outliers = [];
  const signIssues = [];

  flat.forEach((row) => {
    const cur = Number(row.values[idx] || 0);
    // 直近 lookback ヶ月（対象月を含まない）。足りなければ判定しない（§2.2）
    const from = idx - MC_DEFAULTS.lookback;
    const past = from >= 0 ? row.values.slice(from, idx).map((v) => Number(v || 0)) : null;

    // (3) 符号がおかしい（過去の件数に関係なく判定できる）
    if (cur < 0) {
      signIssues.push({ account: row.name, section: row.section, value: cur });
    }
    if (!past || past.length < MC_DEFAULTS.lookback) return;

    // (1) いつもあるのに今月まだ無い
    if (cur === 0 && past.every((v) => v !== 0)) {
      missing.push({
        account: row.name, section: row.section,
        past, past_median: median(past.map(Math.abs)),
      });
      return; // 0円なので外れ値判定はしない
    }

    // (2) 金額が普段と大きく違う（平均でなく中央値。§2.2）
    const med = median(past.map(Math.abs));
    if (med > 0 && cur !== 0) {
      const a = Math.abs(cur);
      const high = a >= med * ratio;
      const low = a <= med / ratio;
      if ((high || low) && Math.abs(a - med) >= minDiff) {
        outliers.push({
          account: row.name, section: row.section,
          value: cur, past, past_median: med,
          direction: high ? 'high' : 'low',
        });
      }
    }
  });

  // §11.1-1: その月の未仕訳の残件数。これが無いと「月の途中」と「計上漏れ」を区別できない。
  let unjournalizedCount = null;
  let unjournalized = [];
  try {
    unjournalized = await fetchUnjournalizedTransactions({
      accessToken, startDate: range.start, endDate: range.end,
    });
    unjournalizedCount = unjournalized.length;
  } catch (e) {
    unjournalizedCount = null; // 取れなくても月次チェック自体は出す
  }

  // §11.1-3: 各科目について「その科目になりそうな未仕訳明細」を割り出す。
  // ⚠ 銀行明細の摘要に勘定科目名は入っていない（「フリコミ ○○フドウサン」など）ので、
  //   科目名で文字列検索しても当たらない。Phase 4 の提案（過去の仕訳から推定）を使う。
  //   これが無いと「この科目の未仕訳明細をさがす」が常に0件になり、機能しない。
  const candidatesByAccount = {};
  if (unjournalized.length) {
    try {
      const dates = unjournalized.map((t) => String(t.date || '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      if (dates.length) {
        const endDate = dates[dates.length - 1];
        // ①と同じ理由で会計期間ごとに分けて取る（terms はこの関数の先頭で取得済み）
        const journals = await fetchJournalsForSuggest({ accessToken, endDate, terms, fetchJournals });
        const index = buildSuggestIndex(journals);
        unjournalized.forEach((tx) => {
          const s = suggestForContent(index, tx.content, tx.side);
          const name = s && s.account_name;
          if (!name) return;
          if (!candidatesByAccount[name]) candidatesByAccount[name] = [];
          candidatesByAccount[name].push(tx.id);
        });
      }
    } catch (e) {
      // 候補が出せなくても月次チェック自体は成立する（あれば便利、という位置づけ）
      console.error('monthly_check: 候補の割り出しに失敗', e && e.message);
    }
  }
  const withCandidates = (row) => Object.assign({}, row, {
    candidate_transaction_ids: candidatesByAccount[row.account] || [],
  });

  const inProgress = isMonthInProgress(range.end);
  // 登録が途中かどうか。未仕訳の残件数が取れなかったときは「途中かもしれない」側に倒す。
  const registrationDone = unjournalizedCount === 0;
  const partial = inProgress || !registrationDone;

  // ⚠ 実データで確かめて分かったこと（2026-08-04）:
  //   登録が途中の月では「金額が普段より**少ない**」側の外れ値が大量に出る。
  //   7月の実データでは売上高・通信費・支払手数料・消耗品費・諸会費・支払報酬料の
  //   6件すべてが「少ない」で、いずれも「まだ登録していないだけ」だった。
  //   一方「**多い**」側は、登録が途中でも意味がある（登録していないものが
  //   多く見えることはないため）。
  //   よって登録が途中の月では low を出さない。§11.1 の考え方を外れ値にも広げる。
  const shownOutliers = partial ? outliers.filter((o) => o.direction === 'high') : outliers;
  const suppressedLow = partial ? outliers.filter((o) => o.direction === 'low').length : 0;

  res.status(200).json({
    ok: true,
    month: body.month,
    fiscal_year: term.fiscal_year,
    // 進行中の月では計上漏れの判定を出さない（§11.1-2）
    month_in_progress: inProgress,
    // 未仕訳が残っている月では、計上漏れは「当然の結果」なので参考表示にする（§11.1-1）
    unjournalized_count: unjournalizedCount,
    registration_done: registrationDone,
    // 画面はこれを見て「参考表示」か「本気の警告」かを切り替える
    partial,
    criteria: { lookback: MC_DEFAULTS.lookback, ratio, min_diff: minDiff },
    missing: (inProgress ? [] : missing).map(withCandidates),
    outliers: shownOutliers.map(withCandidates),
    // 伏せた件数は必ず伝える。黙って減らすと「出ていない＝問題なし」を招く（§12）
    suppressed_low_outliers: suppressedLow,
    sign_issues: signIssues.map(withCandidates),
    checked_by: advisor.email,
  });
}

// 「機械が出さなかった科目も含め、人間が確認した」という記録（§11.2-2 / §14.1）。
// ⚠ 画面のdisabledだけに頼らない。**チェックが無ければサーバー側で拒否する。**
//    この記録は監査証跡なので、経路を1つに絞る。
async function handleMonthlyCheckConfirm(res, advisor, body) {
  if (body.confirmed !== true) {
    res.status(200).json({ ok: false, error: 'not_confirmed' });
    return;
  }
  const range = monthRange(body.month);
  if (!range) { res.status(400).json({ ok: false, error: 'invalid_month' }); return; }
  await recordAction({
    advisor_email: advisor.email,
    action: 'monthly_check_confirmed',
    transaction_id: null,
    journal_id: null,
    result: 'ok',
    payload: {
      month: body.month,
      // 何に対して「確認した」と言ったのかを残す（後から意味が分かるように）
      statement: 'フラグの有無にかかわらず全科目をひと通り確認した',
      flags: {
        missing: Number(body.flag_counts && body.flag_counts.missing) || 0,
        outliers: Number(body.flag_counts && body.flag_counts.outliers) || 0,
        sign_issues: Number(body.flag_counts && body.flag_counts.sign_issues) || 0,
      },
      unjournalized_count: body.unjournalized_count === null || body.unjournalized_count === undefined
        ? null : Number(body.unjournalized_count),
    },
  });
  res.status(200).json({ ok: true, recorded_at: new Date().toISOString(), by: advisor.email });
}

/* ---------------- Phase 3: 仕訳登録＋証憑添付 ---------------- */

// 操作履歴に1行残す。MF側では仕訳が全て「連携アプリ」名義になり誰が作ったか
// 分からないため、**これがこの機能の唯一の監査証跡**（設計書§5-5）。
// 記録に失敗しても本処理は止めない（記録できないことを理由に帳簿操作を巻き戻さない）。
async function recordAction(row) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/tax_advisor_actions`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify([row]),
    });
  } catch (e) {
    console.error('tax_advisor_actions への記録に失敗（本処理は成功済み）', e);
  }
}

// その明細がまだ未仕訳かを確認する。
// ⚠ ここで確認しても、確認と登録の間にMFの画面側で仕訳化されると二重になる（TOCTOU）。
//    MFに冪等キーが無いため完全には防げない。登録後にも確認して警告を出す（§5-4）。
async function findTransaction(accessToken, transactionId, dateHint) {
  // 明細IDでの直接取得APIは無いため、日付範囲で取得して突き合わせる
  const around = (d, n) => addDays(d, n);
  const params = new URLSearchParams({
    start_date: around(dateHint, -3),
    end_date: around(dateHint, 3),
    per_page: '1000',
    page: '1',
  });
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/transactions?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const list = Array.isArray(data.transactions) ? data.transactions : [];
  return list.find((t) => t.id === transactionId) || null;
}

// 明細から仕訳を作る
async function postJournalize(accessToken, body) {
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/transactions/journalize`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data && (data.error || data.message)) || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// 同じ明細から仕訳が複数できていないか確認する（TOCTOUの事後検知）
async function countJournalsForTransaction(accessToken, transactionId, dateStr) {
  try {
    const params = new URLSearchParams({
      start_date: addDays(dateStr, -3),
      end_date: addDays(dateStr, 3),
      per_page: '200',
      page: '1',
    });
    const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/journals?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    const list = Array.isArray(data.journals) ? data.journals : [];
    return list.filter((j) => j.transaction_id === transactionId).length;
  } catch (e) {
    return null;
  }
}

// 証憑1件を仕訳へ添付する。mf_evidence の行を claim してから送る
// （MFのvouchersは取り消し不能なため、DB先行claimで二重送信を構造的に防ぐ。制約#12と同じ考え方）。
async function attachEvidence(accessToken, evidenceId, journalId) {
  const ev = await fetchEvidenceById(evidenceId);
  if (!ev) return { ok: false, error: 'evidence_not_found' };
  if (!ev.storage_path) return { ok: false, error: 'no_storage_path' };
  if (ev.status === 'attached') return { ok: false, error: 'already_attached' };
  try {
    const result = await attachEvidenceToJournal({
      accessToken, evidence: ev, journalId, fromStatus: ev.status,
    });
    if (!result.claimed) return { ok: false, error: 'already_attached' };
    return { ok: true, file_id: result.file_id || null };
  } catch (e) {
    return { ok: false, error: 'attach_failed', message: e && e.message };
  }
}

/* ---------------- Phase 6: 事務所の管理（役割・承認ワークフロー） ----------------
 * 設計書: docs/TAX_WORKSPACE_PHASE6_PLAN.md §2 / §10.2
 * SQL: supabase_tax_approval.sql
 *
 * ⚠ 役割の判定は必ずここで行う。画面のガードは迂回できる。
 *   社内メンバー(MEMBER_EMAILS)は常に admin 扱い。 */

function isAdvisorAdmin(advisor, isMember) {
  if (isMember) return true;
  return String(advisor && advisor.role) === 'admin';
}

const APPROVAL_POLICIES = ['none', 'required'];

async function fetchApprovalPolicy() {
  try {
    const url = `${SUPABASE_URL}/rest/v1/tax_workspace_settings?skey=eq.approval_policy&select=value&limit=1`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) return 'none';
    const rows = await res.json().catch(() => []);
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    return APPROVAL_POLICIES.indexOf(v) >= 0 ? v : 'none';
  } catch (e) {
    // 設定が読めないときは「承認しない」に倒す。読めないことを理由に登録を止めない
    return 'none';
  }
}

async function saveApprovalPolicy(policy, byEmail) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tax_workspace_settings`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify([{ skey: 'approval_policy', value: policy, updated_by: byEmail, updated_at: new Date().toISOString() }]),
  });
  return res.ok;
}

async function setAdvisorRole(email, role) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || ['admin', 'staff'].indexOf(role) < 0) return false;
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tax_advisors?email=ilike.${encodeURIComponent(e)}`,
    { method: 'PATCH', headers: { ...supabaseHeaders(), Prefer: 'return=minimal' }, body: JSON.stringify({ role }) }
  );
  return res.ok;
}

// 承認待ちの一覧。admin は全件、staff は自分の依頼だけ
async function listJournalRequests(advisor, isAdmin) {
  let url = `${SUPABASE_URL}/rest/v1/tax_journal_requests?select=*&order=created_at.desc&limit=200`;
  if (!isAdmin) url += `&requested_by=eq.${encodeURIComponent(advisor.email)}`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) return { ok: false, rows: [], reason: 'HTTP ' + res.status };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, rows: [], reason: '応答の形式が想定と違います' };
  return { ok: true, rows, reason: '' };
}

async function createJournalRequest(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tax_journal_requests`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 同じ明細の承認待ちが既にある（unique index）
    if (res.status === 409 || /duplicate|unique/i.test(text)) {
      return { ok: false, error: 'already_requested' };
    }
    return { ok: false, error: 'request_create_failed' };
  }
  const rows = await res.json().catch(() => []);
  return { ok: true, row: Array.isArray(rows) ? rows[0] : null };
}

async function updateJournalRequest(id, patch) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tax_journal_requests?id=eq.${encodeURIComponent(id)}&status=eq.pending`,
    { method: 'PATCH', headers: { ...supabaseHeaders(), Prefer: 'return=representation' }, body: JSON.stringify(patch) }
  );
  if (!res.ok) return { ok: false };
  const rows = await res.json().catch(() => []);
  // 0件なら他の人が先に処理済み（二重承認を防ぐ）
  return { ok: Array.isArray(rows) && rows.length > 0, row: rows[0] || null };
}

// 明細の「金額・日付・摘要」だけを取り出す。承認時に依頼時点と突き合わせる
function txSnapshot(tx) {
  if (!tx) return null;
  return { date: tx.date || '', value: Number(tx.value) || 0, content: String(tx.content || '') };
}

function sameSnapshot(a, b) {
  if (!a || !b) return false;
  return a.date === b.date && a.value === b.value && a.content === b.content;
}

async function handleJournalize(res, advisor, accessToken, body, opts) {
  const isAdmin = !!(opts && opts.isAdmin);
  // 承認の実行から呼ばれたときは、もう一度承認待ちに積まない
  const skipApproval = !!(opts && opts.skipApproval);
  const transactionId = String((body && body.transaction_id) || '');
  const accountId = String((body && body.account_id) || '');
  const dateHint = String((body && body.date) || '');
  if (!transactionId || !accountId || !/^\d{4}-\d{2}-\d{2}$/.test(dateHint)) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }
  const evidenceIds = Array.isArray(body.evidence_ids) ? body.evidence_ids.slice(0, 5) : [];

  /* ⚠ インボイス区分は承認待ちに積む前にも必ず確認する。
   *   ここを通さないと、必須項目が欠けたまま依頼だけが溜まる。 */
  if (VALID_INVOICE_KINDS.indexOf(body.invoice_kind) < 0) {
    res.status(200).json({ ok: false, error: 'invoice_kind_required' });
    return;
  }

  // 1. その明細がまだ未仕訳か
  let tx;
  try {
    tx = await findTransaction(accessToken, transactionId, dateHint);
  } catch (e) {
    if (e && (e.status === 403 || e.status === 401)) {
      res.status(200).json({ ok: false, error: 'scope_missing' });
      return;
    }
    res.status(200).json({ ok: false, error: 'transaction_check_failed', message: e && e.message });
    return;
  }
  if (!tx) {
    res.status(200).json({ ok: false, error: 'transaction_not_found' });
    return;
  }
  if (tx.journalizing_status !== 'none') {
    res.status(200).json({ ok: false, error: 'already_journalized', status: tx.journalizing_status });
    return;
  }

  /* 1-1. 承認が要るなら、MFへは送らずに承認待ちへ積む（設計書§2.3）。
   * ⚠ admin 自身の登録は直接実行する（自分が承認者のため）。
   *   そのぶん admin は所長本人か最小人数に限ること（ガイドに明記）。 */
  if (!skipApproval && !isAdmin) {
    const policy = await fetchApprovalPolicy();
    if (policy === 'required') {
      const r = await createJournalRequest({
        requested_by: advisor.email,
        transaction_id: transactionId,
        payload: {
          transaction_id: transactionId, date: dateHint, account_id: accountId,
          tax_id: body.tax_id || null, sub_account_id: body.sub_account_id || null,
          invoice_kind: body.invoice_kind, memo: body.memo || null,
          evidence_ids: evidenceIds, input_source: body.input_source || null,
        },
        // 承認の実行時にこれと突き合わせ、変わっていたら実行しない（設計書§10.2-1）
        snapshot: txSnapshot(tx),
      });
      await recordAction({
        actor_email: advisor.email, action: 'request_journalize', transaction_id: transactionId,
        account_id: accountId, tax_id: body.tax_id || null,
        result: r.ok ? 'ok' : 'failed', error_message: r.ok ? null : r.error,
        payload: { date: dateHint, invoice_kind: body.invoice_kind, input_source: body.input_source || null },
      });
      if (!r.ok) {
        res.status(200).json({ ok: false, error: r.error });
        return;
      }
      res.status(200).json({ ok: true, requested: true, request_id: r.row && r.row.id });
      return;
    }
  }

  // 1-2. 決算済みの期への登録を拒否する設定なら、ここで止める。
  // ⚠ 画面側にも同じ判定を入れているが、迂回できるのでサーバーでも必ず見る。
  const policy = await fetchClosedTermPolicy();
  if (policy === 'block') {
    let terms = [];
    try {
      const t = await fetchMaster(accessToken, 'term_settings');
      terms = t.term_settings || [];
    } catch (e) {
      terms = []; // 会計期間が取れなければ判定できない＝止めない
    }
    const judged = isInProgressingTerm(terms, tx.date || dateHint);
    if (judged && !judged.ok) {
      const t = judged.term;
      await recordAction({
        actor_email: advisor.email, action: 'journalize', transaction_id: transactionId,
        account_id: accountId, result: 'failed',
        error_message: 'closed_term_blocked', payload: { date: tx.date || dateHint, policy },
      });
      res.status(200).json({
        ok: false,
        error: 'closed_term_blocked',
        term: t ? { fiscal_year: t.fiscal_year, start_date: t.start_date, end_date: t.end_date } : null,
      });
      return;
    }
  }

  /* どこまでが機械の判断で、どこからが人間の判断かを記録に残す（所長レビューの指摘・2026-08-04）。
   * MF側には操作者すら残らないので、後から「提案をそのまま入れたのか、
   * 人が確かめて直したのか」を追えるのはこの記録だけになる。
   * 値は画面が送ってくる自己申告なので、そのまま鵜呑みにせず「申告値」として残す。 */
  const VALID_INPUT_SOURCES = ['suggested', 'edited', 'manual'];
  const inputSource = VALID_INPUT_SOURCES.indexOf(body.input_source) >= 0 ? body.input_source : 'unknown';

  // 2. 仕訳を作る。invoice_kind は必ず明示送信する（未確認事項C・既定値に依存しない）
  const payload = { transaction_id: transactionId, account_id: accountId };
  if (body.tax_id) payload.tax_id = String(body.tax_id);
  if (body.sub_account_id) payload.sub_account_id = String(body.sub_account_id);
  /* インボイス区分は**必須**（2026-08-03 利用者判断）。
   * 以前は未指定なら 'INVOICE_KIND_NOT_TARGET'（対象外）へ機械的に落としていたが、
   * 実データでは課税取引209件中191件（91%）が「適格」であり、
   * 選び忘れると**気づかないまま少数派の値で登録される**状態だった。
   * 勝手に決めつけず、選んでいなければ登録を断る。
   * ⚠ 画面側にも同じ判定を入れているが迂回できるため、ここで必ず弾く。 */
  if (VALID_INVOICE_KINDS.indexOf(body.invoice_kind) < 0) {
    res.status(200).json({ ok: false, error: 'invoice_kind_required' });
    return;
  }
  payload.invoice_kind = body.invoice_kind;
  if (body.memo) payload.memo = String(body.memo).slice(0, 200);

  let created;
  try {
    created = await postJournalize(accessToken, payload);
  } catch (e) {
    await recordAction({
      actor_email: advisor.email, action: 'journalize', transaction_id: transactionId,
      account_id: accountId, tax_id: body.tax_id || null, result: 'failed',
      error_message: (e && e.message ? String(e.message) : 'unknown').slice(0, 500),
      payload: Object.assign({}, payload, { input_source: inputSource }),
    });
    // MFが決算済みの期などを拒否した場合、そのエラーをそのまま画面に出す（決め打ちしない）
    res.status(200).json({ ok: false, error: 'journalize_failed', message: e && e.message, detail: e && e.body });
    return;
  }
  const journalId = (created && created.journal && created.journal.id) || null;

  /* 2-2. 仕訳ができたことを**この時点で先に記録する**。
   * ⚠ 以前は証憑の添付まで終えてから1回だけ記録していたため、
   *   添付の途中で関数が実行時間上限に達すると
   *   「MFに仕訳は実在するのに、こちらの記録が1行も無い」状態になりえた。
   *   MF側では誰が作ったか分からないので、それは証跡が消えたのと同じ。
   *   仕訳の作成と証憑の添付を別の行に分けて、作成の記録が必ず先に残るようにする。 */
  await recordAction({
    actor_email: advisor.email, action: 'journalize', transaction_id: transactionId,
    journal_id: journalId, account_id: accountId, tax_id: body.tax_id || null,
    result: 'ok', payload: Object.assign({}, payload, { input_source: inputSource }),
  });

  // 3. 証憑を添付する。⚠ ここが失敗しても仕訳は取り消さない（§3.2）
  const attached = [];
  const attachFailed = [];
  for (const evId of evidenceIds) {
    if (!journalId) break;
    const r = await attachEvidence(accessToken, evId, journalId);
    if (r.ok) attached.push(evId); else attachFailed.push({ evidence_id: evId, error: r.error });
  }

  // 4. 二重仕訳の事後検知（TOCTOU。自動では消さない）
  const dupCount = await countJournalsForTransaction(accessToken, transactionId, dateHint);

  const result = attachFailed.length ? 'journal_ok_voucher_failed' : 'ok';
  await recordAction({
    actor_email: advisor.email, action: 'journalize', transaction_id: transactionId,
    journal_id: journalId, account_id: accountId, tax_id: body.tax_id || null,
    evidence_ids: attached.length ? attached : null,
    result,
    error_message: attachFailed.length ? JSON.stringify(attachFailed).slice(0, 500) : null,
    payload: Object.assign({}, payload, { input_source: inputSource }),
  });

  res.status(200).json({
    ok: true,
    journal_id: journalId,
    journal: created && created.journal ? created.journal : null,
    attached,
    attach_failed: attachFailed,
    // 2件以上あれば、MFの画面側でも仕訳化された可能性がある
    duplicate_warning: (dupCount != null && dupCount > 1) ? dupCount : null,
  });
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
    advisor = { email: user.email, name: '社内メンバー', role: 'admin' };
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

  /* 操作履歴の閲覧（設計書§3.6・§5-5）。
   * MF側では仕訳が全て「連携アプリ」名義で作られ誰が作ったか分からないため、
   * これがこの機能の**唯一の監査証跡**。書き込むだけで誰も見られない状態だと
   * 証跡として機能しないので、画面から読めるようにする（2026-08-03のレビュー指摘）。
   * 社内メンバーは全件、税理士は**自分の操作だけ**見られる。 */
  if (action === 'action_log') {
    try {
      let url = `${SUPABASE_URL}/rest/v1/tax_advisor_actions`
        // 税務調査で「この仕訳は誰が・何を入れたか」を画面だけで答えられるようにする。
        // 以前は日時・操作者・結果しか返しておらず、勘定科目や金額を調べるには
        // SQLを直接見る必要があった（2026-08-04の所長目線レビュー指摘）。
        + `?select=id,actor_email,action,transaction_id,journal_id,account_id,tax_id,evidence_ids,result,error_message,payload,created_at`
        + `&order=created_at.desc&limit=200`;
      if (!isMember) {
        url += `&actor_email=eq.${encodeURIComponent(advisor.email)}`;
      }
      const r = await fetch(url, { headers: supabaseHeaders() });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = await r.json().catch(() => []);
      res.status(200).json({ ok: true, actions: Array.isArray(rows) ? rows : [], scope: isMember ? 'all' : 'own' });
    } catch (e) {
      res.status(200).json({ ok: false, error: 'action_log_failed', message: e && e.message });
    }
    return;
  }

  // 決算済みの期の扱いは税理士自身が決める（設計書§6-E）。社内メンバーも変更できる。
  if (action === 'set_closed_term_policy') {
    const okSave = await saveClosedTermPolicy(body && body.policy, advisor.email);
    if (!okSave) {
      res.status(200).json({ ok: false, error: 'invalid_policy' });
      return;
    }
    await recordAction({
      actor_email: advisor.email, action: 'set_closed_term_policy',
      result: 'ok', payload: { policy: body.policy },
    });
    res.status(200).json({ ok: true, closed_term_policy: body.policy });
    return;
  }

  // ⚠ ここに足し忘れると、下の分岐まで届かず invalid_action になる。
  //    新しい action を作ったら**必ずこの配列にも足すこと**。
  if ([
    'bootstrap', 'list', 'journalize', 'suggest', 'monthly_check', 'monthly_check_confirm',
    'request_list', 'request_approve', 'request_reject', 'action_log_csv',
  ].indexOf(action) < 0) {
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

  // Phase 7: ⑨月次チェック（読み取りのみ）
  const isAdmin = isAdvisorAdmin(advisor, isMember);

  // 承認待ちの一覧（adminは全件・staffは自分の依頼だけ）
  if (action === 'request_list') {
    const r = await listJournalRequests(advisor, isAdmin);
    res.status(200).json({
      ok: r.ok, requests: r.rows, is_admin: isAdmin,
      approval_policy: await fetchApprovalPolicy(),
      error: r.ok ? undefined : 'request_list_failed', message: r.reason,
    });
    return;
  }

  // 承認して実行する（adminのみ）
  if (action === 'request_approve') {
    if (!isAdmin) { res.status(403).json({ ok: false, error: 'admin_only' }); return; }
    try {
      await handleApproveRequest(res, advisor, accessToken, body);
    } catch (e) {
      console.error('request_approve failed', e);
      if (!res.headersSent) {
        res.status(200).json({ ok: false, error: 'approve_failed', message: (e && e.message) || String(e) });
      }
    }
    return;
  }

  // 差し戻す（adminのみ・理由は必須）
  if (action === 'request_reject') {
    if (!isAdmin) { res.status(403).json({ ok: false, error: 'admin_only' }); return; }
    await handleRejectRequest(res, advisor, body);
    return;
  }

  // 操作履歴をCSVで返す（事務所が自分で保管するため）
  if (action === 'action_log_csv') {
    await handleActionLogCsv(res, advisor, isAdmin, body);
    return;
  }

  if (action === 'monthly_check') {
    // 想定外の例外で500(HTML)を返すと、画面には理由の分からないエラーしか出ない。
    // 必ずJSONで理由を返す（読み取りだけの機能なので、失敗しても副作用は無い）。
    try {
      await handleMonthlyCheck(res, advisor, accessToken, body);
    } catch (e) {
      console.error('monthly_check failed', e);
      if (!res.headersSent) {
        res.status(200).json({
          ok: false, error: 'monthly_check_failed',
          message: (e && e.message) || String(e),
        });
      }
    }
    return;
  }

  if (action === 'monthly_check_confirm') {
    await handleMonthlyCheckConfirm(res, advisor, body);
    return;
  }

  // Phase 4: 過去の仕訳から初期値を提案する（読み取りのみ）
  if (action === 'suggest') {
    // ⚠ 例外で500(HTML)を返すと、画面には「該当する提案はありません」としか出ず
    //   原因が見えない。実際にこれで3回、誤った原因を追いかけた（2026-08-04）。
    //   読み取りだけの機能なので、失敗しても理由をJSONで返す。
    try {
      await handleSuggest(res, accessToken, body);
    } catch (e) {
      console.error('suggest failed', e);
      if (!res.headersSent) {
        res.status(200).json({
          ok: false, error: 'suggest_failed', message: (e && e.message) || String(e),
        });
      }
    }
    return;
  }

  // Phase 3: 仕訳登録＋証憑添付。トークンを取ったあとに実行する
  if (action === 'journalize') {
    await handleJournalize(res, advisor, accessToken, body, { isAdmin });
    return;
  }

  // 選択欄のマスタだけを返す（画面の初期化用）
  if (action === 'bootstrap') {
    try {
      const accounts = await fetchMaster(accessToken, 'accounts');
      const taxes = await fetchMaster(accessToken, 'taxes?available=true');
      const partners = await fetchMaster(accessToken, 'trade_partners');
      const subAccounts = await fetchMaster(accessToken, 'sub_accounts');
      // 会計期間。決算が終わった期の月を選んだときに警告を出すために使う（設計書§6-E）
      const terms = await fetchMaster(accessToken, 'term_settings');
      res.status(200).json({
        ok: true,
        advisor: { email: advisor.email, name: advisor.name },
        accounts: accounts.accounts || [],
        taxes: taxes.taxes || [],
        trade_partners: partners.trade_partners || [],
        sub_accounts: subAccounts.sub_accounts || [],
        term_settings: terms.term_settings || [],
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

  const evidenceRes = await fetchOpenEvidence();
  const evidences = evidenceRes.rows;
  const sharedRes = await fetchSharedFiles();
  const sharedFiles = sharedRes.files;

  // どの銀行・カードの明細かを出すための対応表（利用者の指摘 2026-08-04）
  const accountLabels = await fetchAccountLabels(accessToken);

  const items = transactions.map((tx) => ({
    transaction_id: tx.id,
    date: tx.date,
    content: tx.content,
    value: tx.value,
    side: tx.side,
    // どの銀行・カードから来た明細か。MFの画面は口座ごとに未仕訳を出すため、
    // これが無いと「何の仕訳か分からない」状態になる
    account_label: accountLabelFor(accountLabels, tx),
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
    // Phase 3から登録可能。画面はこれを見て登録ボタンを出す。
    writable: true,
    // 決算済みの期の扱い（'warn' か 'block'）。画面はこれに従って警告か禁止かを切り替える
    closed_term_policy: await fetchClosedTermPolicy(),
    items,
    shared_files: sharedFiles,
    open_evidence_count: evidences.length,
    // 失敗を「無い」に化けさせない。画面はこれを見て「見つからない」と「取れなかった」を分ける
    evidence_load_failed: evidenceRes.ok ? null : evidenceRes.reason,
    shared_files_load_failed: sharedRes.ok ? null : sharedRes.reason,
  });
};
