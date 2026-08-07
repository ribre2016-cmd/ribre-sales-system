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
  fetchTransactionsByJournalizingStatus,
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
/* ⚠ 上限で切れた件数を「これが全部です」と見せないこと。
 *   ②の見出しは件数だけを出すので、切れていると**数字がそのまま嘘になる**
 *   （2026-08-05の10人視点レビューで発見）。Content-Rangeで本当の件数を取る。 */
const OPEN_EVIDENCE_LIMIT = 300;
// ②に並べる件数。多すぎると署名URLの発行だけで時間がかかる
const OPEN_EVIDENCE_SHOW = 60;

/* 証憑の中身を見るための署名付きURL。取れなければ null（リンクを出さない）。
 * ⚠ ファイル名を download= で渡さないと、保存時の内部名で落ちてきて何の書類か分からなくなる。 */
async function signEvidenceUrl(storagePath, fileName) {
  if (!storagePath) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${MF_EVIDENCE_BUCKET}/${storagePath}`, {
      method: 'POST', headers: supabaseHeaders(), body: JSON.stringify({ expiresIn: SIGN_EXPIRES_SEC }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    if (!d || !d.signedURL) return null;
    const name = fileName || String(storagePath).split('/').pop();
    return `${SUPABASE_URL}/storage/v1${d.signedURL}&download=${encodeURIComponent(name)}`;
  } catch (e) {
    return null;
  }
}

async function fetchOpenEvidence() {
  const url =
    `${SUPABASE_URL}/rest/v1/mf_evidence` +
    `?select=id,ocr_date,ocr_amount,ocr_currency,ocr_vendor,file_name,status,storage_path` +
    `&status=in.(pending,awaiting_match,box_saved)&storage_path=not.is.null` +
    `&order=ocr_date.desc&limit=${OPEN_EVIDENCE_LIMIT}`;
  let res;
  try {
    res = await fetch(url, { headers: { ...supabaseHeaders(), Prefer: 'count=exact' } });
  } catch (e) {
    return { ok: false, rows: [], reason: '通信に失敗しました' };
  }
  if (!res.ok) return { ok: false, rows: [], reason: 'HTTP ' + res.status };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, rows: [], reason: '応答の形式が想定と違います' };
  /* Content-Range は "0-299/1234" の形。分母が上限より多ければ、
   * 一覧は切れているが**件数だけは本当の数**を出す。 */
  const cr = String(res.headers.get('content-range') || '');
  const totalStr = cr.split('/')[1];
  const total = /^\d+$/.test(totalStr || '') ? Number(totalStr) : rows.length;
  return { ok: true, rows, total, truncated: total > rows.length, reason: '' };
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
        /* 画面の中で開くためのURL。
         * ⚠ download= を**付けない**こと。付けると保存になり、その場で見られない
         *   （利用者の指摘・2026-08-07）。ファイル名を渡す必要があるのは
         *   保存するときだけなので、上の url と用途を分ける。 */
        preview_url: `${SUPABASE_URL}/storage/v1${signData.signedURL}`,
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

  /* 税理士として登録（既にいれば有効化し直す）。※実体は下の upsertAdvisorByEmail。
   * 役割は **管理者** にする（利用者の判断・2026-08-05）。
   * 招待リンクは顧問税理士にしか渡さない運用のため、既定の「担当者」だと
   * 登録のたびに⑤からSQLで昇格させることになり、必ず忘れる。
   * ⚠ 事務所の担当者を招待するようになったら、この既定は見直すこと。
   *   その場合は⑤の「役割を変えるSQLを見る」で個別に担当者へ戻せる。 */
  /* ⚠ ここは以前 `?on_conflict=email` の upsert だったが、**必ず失敗する**書き方だった
   *   （2026-08-05のレビューで発見）。tax_advisors の一意インデックスは
   *   `on tax_advisors (lower(email))` という関数インデックスで、
   *   PostgreSQL の `ON CONFLICT (email)` はこれに合致しない（42P10）。
   *   合致する索引が無いと**衝突の有無に関係なく**プラン作成時点でエラーになる。
   *   招待からの登録はまだ一度も使われていなかったため、発覚していなかった。
   *   一意制約に依存しない「探す→更新 or 追加」に書き換える。 */
  /* 発行時に入れた「どなたに渡すか」を、登録される方の表示名として使う。
   * 空のときは name を送らない（既に入っている名前を消さないため）。 */
  const inviteName = String((rows[0] && rows[0].note) || '').trim().slice(0, 60);
  const advisorPatch = {
    enabled: true, role: 'admin',
    note: '招待リンクから登録 ' + nowIso.slice(0, 10),
  };
  if (inviteName) advisorPatch.name = inviteName;
  const up = await upsertAdvisorByEmail(e, advisorPatch);
  if (!up.ok) {
    // 招待だけ消費して登録できていない状態を残さないよう、使用済みを取り消す
    await fetch(`${SUPABASE_URL}/rest/v1/tax_advisor_invites?token=eq.${encodeURIComponent(t)}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify({ used_at: null, used_email: null }),
    }).catch(() => {});
    return { ok: false, error: 'advisor_register_failed' };
  }
  return { ok: true, email: e, name: inviteName || null };
}

/* メールで税理士を1件、追加または更新する。
 * ⚠ `?on_conflict=email` は使わないこと。一意索引が `lower(email)` の
 *   関数インデックスなので `ON CONFLICT (email)` は合致せず、必ず失敗する。
 * 大文字小文字を無視して探すため ilike を使う（索引の定義と揃える）。 */
async function upsertAdvisorByEmail(email, patch) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return { ok: false, error: 'invalid_email' };
  const find = async () => {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/tax_advisors?email=ilike.${encodeURIComponent(ilikeLiteral(e))}&select=id&limit=1`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) return null;
    const rows = await r.json().catch(() => []);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  };

  const existing = await find();
  if (existing) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisors?id=eq.${encodeURIComponent(existing.id)}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    return r.ok ? { ok: true, updated: true } : { ok: false, error: 'advisor_update_failed' };
  }

  const ins = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisors`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify([Object.assign({ email: e }, patch)]),
  });
  if (ins.ok) return { ok: true, created: true };
  // 取得と追加の間に他の人が入れた場合（一意索引が弾く）。もう一度探して更新する
  const again = await find();
  if (again) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisors?id=eq.${encodeURIComponent(again.id)}`, {
      method: 'PATCH',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify(patch),
    });
    return r.ok ? { ok: true, updated: true } : { ok: false, error: 'advisor_update_failed' };
  }
  return { ok: false, error: 'advisor_insert_failed' };
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
  fetchJournalsForSuggest, suggestDiagnosis,
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
  // 提案が出なかった明細には「なぜ出ないか」を返す（画面で理由を出すため）
  const reasons = {};
  items.forEach((it) => {
    const id = it && it.transaction_id;
    if (!id) return;
    const s = suggestForContent(index, it && it.content, it && it.side);
    if (s) { suggestions[id] = s; return; }
    const d = suggestDiagnosis(index, it && it.content, it && it.side);
    if (d && d.kind !== 'ok') reasons[id] = d;
  });
  res.status(200).json({
    ok: true, suggestions, reasons,
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
  const today = todayJst();   // 期の切り替わり日もJSTで判定する（上と同じ理由）
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
    memo: p.memo, evidence_ids: p.evidence_ids, tax_text: p.tax_text,
    // 依頼時に選ばれた共有ファイルも必ず引き継ぐ（落とすと黙って添付されない）
    shared_file_keys: p.shared_file_keys,
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

/* ⚠ 以前は limit=5000 の1回取得で、超えた分を**黙って捨てて**いた。
 *   しかも画面に件数を出していなかったため、
 *   「全部揃っていると思って提出したら古い分が抜けていた」が起こりうる状態だった。
 *   税務調査で使う前提の機能としては致命的（所長レビューの指摘・2026-08-04）。
 *   → 最後まで取り切る。上限に達した場合は truncated を必ず返し、画面で警告する。 */
const CSV_PAGE = 1000;
const CSV_HARD_LIMIT = 100000;   // 応答が大きくなりすぎないための安全弁

/* 操作履歴のCSV。
 * ⚠ canSeeAll は **社内メンバーかどうか**。画面側(action_log)と必ず同じ基準にすること。 */
async function handleActionLogCsv(res, advisor, canSeeAll, body) {
  const month = String((body && body.month) || '');
  let base = `${SUPABASE_URL}/rest/v1/tax_advisor_actions?select=*&order=created_at.desc`;
  if (!canSeeAll) base += `&actor_email=eq.${encodeURIComponent(advisor.email)}`;
  const r = monthRange(month);
  if (r) base += `&created_at=gte.${r.start}T00:00:00Z&created_at=lte.${r.end}T23:59:59Z`;

  const rows = [];
  let truncated = false;
  for (let offset = 0; offset < CSV_HARD_LIMIT; offset += CSV_PAGE) {
    const resp = await fetch(`${base}&limit=${CSV_PAGE}&offset=${offset}`, { headers: supabaseHeaders() });
    if (!resp.ok) { res.status(200).json({ ok: false, error: 'action_log_failed' }); return; }
    const page = await resp.json().catch(() => null);
    if (!Array.isArray(page)) { res.status(200).json({ ok: false, error: 'action_log_failed' }); return; }
    rows.push(...page);
    if (page.length < CSV_PAGE) break;                 // 最後まで取り切った
    if (rows.length >= CSV_HARD_LIMIT) { truncated = true; break; }
  }
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
  res.status(200).json({
    ok: true, csv: String.fromCharCode(65279) + lines.join(chr13 + chr10),
    rows: lines.length - 1,
    // 上限に達したか。画面はこれを見て警告を出す（黙って減らさない）
    truncated, hard_limit: CSV_HARD_LIMIT,
  });
}

/* ---------------- Phase 7: ⑤月次チェック（読み取り専用） ----------------
   設計書: docs/TAX_WORKSPACE_PHASE7_PLAN.md §2 / §11.1 / §11.2
   MFへは GET /reports/* しか呼ばない。**何も書き込まない。**
   実測(§16): report.read は再連携済みで使える。 */

// 推移表の入れ子（financial_statement_item の下に account）を平らにする。
// 各科目に、属する大分類（売上高合計・販売費及び一般管理費合計 など）を持たせる。
function flattenReportRows(rows, sectionName, out, parentName) {
  const list = Array.isArray(rows) ? rows : [];
  const acc = out || [];
  list.forEach((r) => {
    if (!r) return;
    if (r.type === 'account') {
      acc.push({
        name: r.name,
        section: sectionName || '',        // 最上位の大分類（PLで使う）
        parent: parentName || sectionName || '',  // すぐ上の小計（BSで使う。例「棚卸資産合計」）
        values: Array.isArray(r.values) ? r.values : [],
      });
    } else {
      // 大分類の名前は最上位のものを引き継ぐ（「販売費及び一般管理費合計」など）。
      // BSは入れ子が深いので、すぐ上の小計名も別に持たせる。
      flattenReportRows(r.rows, sectionName || r.name, acc, r.name);
    }
  });
  return acc;
}

/* ---- 貸借対照表（BS）側の月次チェック ----
 * 設計書 PHASE7_PLAN §2 は損益(PL)だけだった。10人の税理士のうち5人が
 * 「BSを見ていないのが最大の空白」と指摘（2026-08-04）。
 * 実データでも、商品(在庫)2,061,000が期首から動いていない・純資産がマイナスへ
 * 転落しているといった、**BSでしか気づけない**ものがあった。 */

// 動いていなくて当たり前の科目は「止まっている」判定から外す
const BS_STATIC_PARENTS = new Set([
  '資本金合計', '資本剰余金合計', '自己株式合計', '自己株式申込証拠金合計',
  '新株式申込証拠金合計', '新株予約権合計', '投資その他の資産合計',
]);
// 名前からして常にマイナス／常に一定の評価勘定
const BS_CONTRA_RE = /引当金|累計額|自己株式/;

function analyzeBalanceSheet(flat, idx, lookback) {
  const frozen = [];
  const negative = [];
  const changed = [];
  const equity = [];

  flat.forEach((row) => {
    const cur = Number(row.values[idx] || 0);
    const from = idx - lookback;
    const past = from >= 0 ? row.values.slice(from, idx).map((v) => Number(v || 0)) : null;
    const isContra = BS_CONTRA_RE.test(row.name);

    // (a) 何ヶ月も1円も動いていない（在庫の置きっぱなしなど）
    if (past && past.length === lookback && !isContra && !BS_STATIC_PARENTS.has(row.parent)) {
      const all = past.concat([cur]);
      if (cur !== 0 && all.every((v) => v === all[0])) {
        frozen.push({ account: row.name, parent: row.parent, value: cur, months: all.length });
      }
    }

    // (d) 純資産・繰越利益剰余金がマイナス（債務超過の状態）
    if (row.section === '純資産の部合計' && cur < 0 && !isContra) {
      equity.push({ account: row.name, parent: row.parent, value: cur, past: past || [] });
      return;   // 下のマイナス判定と二重に出さない
    }

    // (b) 残高がマイナス（評価勘定を除く）
    if (cur < 0 && !isContra) {
      negative.push({ account: row.name, parent: row.parent, value: cur, past: past || [] });
    }

    // (c) 前月から大きく動いた
    if (past && past.length) {
      const prev = past[past.length - 1];
      if (prev !== 0 && cur !== 0) {
        const ratio = Math.abs(cur) / Math.abs(prev);
        if ((ratio >= 3 || ratio <= 1 / 3) && Math.abs(Math.abs(cur) - Math.abs(prev)) >= 10000) {
          changed.push({ account: row.name, parent: row.parent, prev, value: cur });
        }
      }
    }
  });
  return { frozen, negative, changed, equity };
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
/* 「今日」は必ず日本時間で数える。
 * ⚠ UTCで数えると、日本時間の朝9時までは前日扱いになる。
 *   月初の午前中いっぱい「先月はまだ途中」と判定され、
 *   計上漏れ・少ない側の異常値・BSの警告が**まるごと隠れていた**
 *   （2026-08-05のレビューで発覚）。同じファイルのログイン通知はJSTで数えており、
 *   1つのファイルの中で基準が食い違っていた。 */
function todayJst() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function isMonthInProgress(monthEnd) {
  return todayJst() <= monthEnd;
}

const MC_DEFAULTS = { lookback: 4, ratio: 3, minDiff: 10000 };
// 対象外の明細を画面に並べる上限。超えた分は件数だけ伝える（黙って切らない・制約20）
const MC_EXCLUDED_MAX = 50;


/* ---- 簡易課税の事業区分（一種／二種…）別の課税売上高 ----
 * 10人の税理士のうち、消費税の専門家と元国税の2人が**独立に1位**へ挙げた。
 * この顧問先は term_settings が business_types=[WHOLESALE, RETAIL] で、
 * 実データでも「課売 10% 二種」と「課売 10% 一種」の両方が使われている。
 * 区分を分けずに申告すると、法定上もっとも不利なみなし仕入率が適用される。
 *
 * ⚠ **どちらが正しいかはAPIでは判定できない**（データが無い）。
 *   ここでやるのは「いくらずつ計上されているか」と「先月から構成が変わったか」まで。
 *   正誤の判断は税理士が行う。画面にもそう書く。 */
const SALES_TAX_RE = /^課売/;   // 「課売 10% 二種」「課売 10% 一種」など

function summarizeSalesByTax(journals, months) {
  // months: ['2026-03', ...] の並び。月ごと・税区分ごとに税込で合計する
  const byMonth = {};
  months.forEach((m) => { byMonth[m] = {}; });

  (journals || []).forEach((j) => {
    const month = String(j.transaction_date || '').slice(0, 7);
    if (!byMonth[month]) return;
    (Array.isArray(j.branches) ? j.branches : []).forEach((b) => {
      const c = b && b.creditor;      // 売上は貸方に立つ
      if (!c || !SALES_TAX_RE.test(String(c.tax_name || ''))) return;
      const v = (Number(c.value) || 0) + (Number(c.tax_value) || 0);   // 税込にそろえる
      const key = c.tax_name;
      byMonth[month][key] = (byMonth[month][key] || 0) + v;
    });
  });

  // 出てきた税区分をすべて集める
  const kinds = {};
  months.forEach((m) => { Object.keys(byMonth[m]).forEach((k) => { kinds[k] = true; }); });
  const kindList = Object.keys(kinds).sort();

  const rows = kindList.map((k) => ({
    tax_name: k,
    values: months.map((m) => byMonth[m][k] || 0),
  }));
  const totals = months.map((m) => kindList.reduce((sum, k) => sum + (byMonth[m][k] || 0), 0));

  // 当月と前月で構成比が大きく変わっていないか（区分の付け間違いに気づく手がかり）
  let shift = null;
  if (months.length >= 2 && kindList.length >= 2) {
    const last = totals[totals.length - 1];
    const prev = totals[totals.length - 2];
    if (last > 0 && prev > 0) {
      const changed = rows.map((r) => {
        const a = r.values[r.values.length - 2] / prev;
        const b = r.values[r.values.length - 1] / last;
        return { tax_name: r.tax_name, prev_ratio: a, ratio: b, diff: b - a };
      }).filter((x) => Math.abs(x.diff) >= 0.2);   // 構成比が20ポイント以上動いた
      if (changed.length) shift = changed;
    }
  }
  return { months, rows, totals, shift };
}

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

  // BS（貸借対照表）の推移も取る。取れなくてもPL側の結果は出す
  let reportBs = null;
  try {
    reportBs = await fetchMaster(
      accessToken,
      `reports/transition_bs?type=monthly&fiscal_year=${encodeURIComponent(term.fiscal_year)}`
      + `&start_month=${startMonthNum}&end_month=${targetMonthNum}`
    );
  } catch (e) {
    console.error('transition_bs の取得に失敗（BSの確認は出せません）', e && e.message);
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

  /* 「対象外」にされた明細。**未仕訳にも仕訳帳にも出ないので、放っておくと帳簿から黙って抜ける。**
   * P7-Bの実測（2026-08-05）で分かったこと: 明細から作った仕訳をAPIで削除すると、
   * 明細は未仕訳(none)ではなく対象外(excluded)になる。MFの画面から対象外にすることもできる。
   * どちらの場合も未仕訳の件数には入らないため、⑤は「登録が終わった」と誤って表示する。
   * 読み取りだけで数えられるので必ず出す（CLAUDE.md 制約22）。
   * ⚠ 対象外が正しいこともある（私用の引き落とし等）。正誤の判定はしない。件数と中身を見せるだけ。 */
  let excluded = { available: false, count: 0, rows: [], reason: '' };
  try {
    const rows = await fetchTransactionsByJournalizingStatus({
      accessToken, startDate: range.start, endDate: range.end, status: 'excluded',
    });
    excluded = {
      available: true,
      count: rows.length,
      rows: rows.slice(0, MC_EXCLUDED_MAX).map((t) => ({
        id: t.id, date: t.date, value: t.value, side: t.side, content: t.content,
      })),
      truncated: rows.length > MC_EXCLUDED_MAX,
      reason: '',
    };
  } catch (e) {
    // 取れなかったことを「0件」と混同させない（CLAUDE.md 制約20）
    excluded = {
      available: false, count: 0, rows: [],
      reason: '対象外の明細を取得できませんでした: ' + ((e && e.message) || e),
    };
  }

  // §11.1-3: 各科目について「その科目になりそうな未仕訳明細」を割り出す。
  // ⚠ 銀行明細の摘要に勘定科目名は入っていない（「フリコミ ○○フドウサン」など）ので、
  //   科目名で文字列検索しても当たらない。Phase 4 の提案（過去の仕訳から推定）を使う。
  //   これが無いと「この科目の未仕訳明細をさがす」が常に0件になり、機能しない。
  const candidatesByAccount = {};
  let fetchedJournals = null;
  // 提案用に取った仕訳の「終わりの日」。事業区分の集計で足りるかの判定に使う
  let suggestEndDate = null;
  if (unjournalized.length) {
    try {
      const dates = unjournalized.map((t) => String(t.date || '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
      if (dates.length) {
        const endDate = dates[dates.length - 1];
        suggestEndDate = endDate;
        // ①と同じ理由で会計期間ごとに分けて取る（terms はこの関数の先頭で取得済み）
        const journals = await fetchJournalsForSuggest({ accessToken, endDate, terms, fetchJournals });
        fetchedJournals = journals;   // 事業区分の集計でも使い回す（再取得しない）
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

  /* 簡易課税の事業区分別・課税売上高。
   * ⚠ 以前は「候補の割り出しで取った仕訳」を使い回していたが、これには2つの穴があった
   *   （2026-08-05の税務レビューで発覚）:
   *   (1) その取得は「未仕訳が1件以上あるとき」しか走らないため、
   *       **未仕訳0件＝きれいに片付いた月ほど表が消える**。いちばん見たい月に出ない。
   *   (2) 取得の終わりが「最後の未仕訳の日付」に丸められるため、
   *       それ以降に登録済みの売上が抜ける（8/3の未仕訳が1件残ると8/4以降が消える）。
   *   集計は対象月の**末日**まで取り直す。提案用の使い回しはやめる。
   *   ⚠ 会計年度をまたぐ期間は400になるので、必ず fetchJournalsForSuggest を通すこと（制約18）。 */
  let salesJournals = fetchedJournals;
  const salesEnd = range.end;
  const suggestEnd = suggestEndDate;   // 提案用に取った終わり（無ければ null）
  if (!salesJournals || !salesJournals.length || !suggestEnd || suggestEnd < salesEnd) {
    try {
      salesJournals = await fetchJournalsForSuggest({
        accessToken, endDate: salesEnd, terms, fetchJournals,
      });
    } catch (e) {
      // 取れなければ集計を出さない。「0件」とは言わない（制約20）
      console.error('事業区分の集計用の仕訳を取得できませんでした', e && e.message);
      salesJournals = null;
    }
  }

  let salesByTax = null;
  if (salesJournals && salesJournals.length) {
    const monthsBack = [];
    for (let k = MC_DEFAULTS.lookback; k >= 0; k--) {
      const d = new Date(range.start + 'T00:00:00Z');
      d.setUTCMonth(d.getUTCMonth() - k);
      monthsBack.push(d.toISOString().slice(0, 7));
    }
    salesByTax = summarizeSalesByTax(salesJournals, monthsBack);
    // 簡易課税は基準期間の課税売上高5,000万円を超えると翌々期に本則へ移る。
    // 判断はしないが、年換算の数字だけ出しておく（消費税の専門家の指摘）
    const shown = salesByTax.totals.filter((v) => v > 0);
    salesByTax.annualized = shown.length
      ? Math.round((shown.reduce((a, b) => a + b, 0) / shown.length) * 12) : 0;
    salesByTax.months_used = shown.length;
    salesByTax.simple_tax = term.tax_method === 'SIMPLE';
    salesByTax.business_types = term.business_types || [];
  }

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
    /* 対象外にされた明細。未仕訳の件数には入らないので、これが無いと
     * 「未仕訳0件＝登録完了」の判定が実態とずれる（CLAUDE.md 制約22）。 */
    excluded,
    // 画面はこれを見て「参考表示」か「本気の警告」かを切り替える
    partial,
    criteria: { lookback: MC_DEFAULTS.lookback, ratio, min_diff: minDiff },
    /* ⚠ 対象月より前に何か月分のデータがあるか。
     *   事業年度が3月始まりなので、推移表はその期の月しか返らない。
     *   3〜6月は比較対象が4か月に満たず、①②とBSの凍結・急変の判定が
     *   **そもそも実行されない**。0件と区別できないと「異常なし」に見える
     *   （2026-08-05の税務レビューで発覚）。画面はこれを見て断り書きを出す。 */
    lookback_available: Math.max(0, idx),
    lookback_enough: idx >= MC_DEFAULTS.lookback,
    missing: (inProgress ? [] : missing).map(withCandidates),
    outliers: shownOutliers.map(withCandidates),
    // BS側。登録が途中の月は残高が歪むので、止まっている科目以外は伏せる
    bs: (function () {
      if (!reportBs) return { available: false, reason: '貸借対照表の推移を取得できませんでした' };
      const bsCols = (reportBs.columns || []).map(String);
      const bsIdx = bsCols.indexOf(String(targetMonthNum));
      if (bsIdx < 0) return { available: false, reason: '貸借対照表に' + targetMonthNum + '月の列がありません' };
      const bsFlat = flattenReportRows(reportBs.rows, '', [], '');
      const a = analyzeBalanceSheet(bsFlat, bsIdx, MC_DEFAULTS.lookback);
      return {
        available: true,
        // 「何ヶ月も動いていない」は登録が途中でも意味がある（過去の月が動いていないため）
        frozen: a.frozen,
        // 残高のマイナス・急な増減は、登録が途中だと当然おかしくなるので伏せる
        negative: partial ? [] : a.negative,
        changed: partial ? [] : a.changed,
        equity: partial ? [] : a.equity,
        suppressed: partial ? (a.negative.length + a.changed.length + a.equity.length) : 0,
      };
    })(),
    // 伏せた件数は必ず伝える。黙って減らすと「出ていない＝問題なし」を招く（§12）
    suppressed_low_outliers: suppressedLow,
    sign_issues: signIssues.map(withCandidates),
    // 簡易課税の事業区分別・課税売上高（正誤の判定はしない。金額と構成の変化まで）
    sales_by_tax: salesByTax,
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
  /* ⚠ 列名は actor_email。ここだけ advisor_email と書いていたため、
   *   tax_advisor_actions に **一度も記録されていなかった**（存在しない列＋NOT NULL違反）。
   *   しかも recordAction が成否を見ていなかったので画面には「記録しました」と出ていた
   *   （2026-08-05の所長レビューで発覚）。 */
  const recorded = await recordAction({
    actor_email: advisor.email,
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
  /* 記録できていないのに「記録しました」と返さない。
   * この機能の価値は記録が残ることだけなので、失敗は失敗として伝える。 */
  if (!recorded) {
    res.status(200).json({ ok: false, error: 'record_failed' });
    return;
  }
  res.status(200).json({ ok: true, recorded_at: new Date().toISOString(), by: advisor.email });
}

/* ---------------- Phase 3: 仕訳登録＋証憑添付 ---------------- */

// 操作履歴に1行残す。MF側では仕訳が全て「連携アプリ」名義になり誰が作ったか
// 分からないため、**これがこの機能の唯一の監査証跡**（設計書§5-5）。
// 記録に失敗しても本処理は止めない（記録できないことを理由に帳簿操作を巻き戻さない）。
/* 操作履歴へ1行追加する。
 * ⚠ **必ず res.ok を見ること。** 以前は fetch の例外だけを拾っており、
 *   400/409 で拒否されても成功扱いになっていた。列名を1文字間違えただけで
 *   「唯一の監査証跡」が静かに消え、画面は「記録しました」と出し続けた。
 * 戻り値: true=書けた / false=書けなかった。呼び出し側は必要なら画面に伝える。 */
async function recordAction(row) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/tax_advisor_actions`, {
      method: 'POST',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
      body: JSON.stringify([row]),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.error('tax_advisor_actions への記録に失敗 HTTP ' + res.status + ' ' + t.slice(0, 200)
        + ' / action=' + (row && row.action));
      return false;
    }
    return true;
  } catch (e) {
    console.error('tax_advisor_actions への記録に失敗（通信）', e && e.message, 'action=' + (row && row.action));
    return false;
  }
}

/* ---------------- Chatwork通知（税理士の利用をRIBREへ知らせる） ----------------
 * auto-match.js と同じ部屋へ送る。トークン未設定なら黙って何もしない。
 * ⚠ 通知の失敗で本処理を止めないこと。通知はおまけで、帳簿の作業が本体。 */
const CHATWORK_API_TOKEN = process.env.CHATWORK_API_TOKEN;
const CHATWORK_ROOM_ID = process.env.CHATWORK_ROOM_ID;
async function notifyChatwork(text) {
  if (!CHATWORK_API_TOKEN || !CHATWORK_ROOM_ID) return false;
  try {
    const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(CHATWORK_ROOM_ID)}/messages`, {
      method: 'POST',
      headers: { 'X-ChatWorkToken': CHATWORK_API_TOKEN, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ body: text }).toString(),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

/* 税理士のログインを **1日1回だけ** 通知する。
 * 画面を開くたびに鳴らすと、すぐ誰も読まなくなるため。
 * 「今日すでに通知したか」は操作履歴の action='login' で数える（新しい保存先を作らない）。
 * 日付の区切りは日本時間。 */
async function notifyAdvisorLoginOnce(advisor) {
  try {
    const jstDate = todayJst();   // 基準は todayJst に集約（ばらばらに書かない）
    const dayStartUtc = new Date(jstDate + 'T00:00:00+09:00').toISOString();
    const url = `${SUPABASE_URL}/rest/v1/tax_advisor_actions`
      + `?actor_email=eq.${encodeURIComponent(advisor.email)}`
      + `&action=eq.login&created_at=gte.${encodeURIComponent(dayStartUtc)}&select=id&limit=1`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) return;                                  // 確かめられないなら鳴らさない（二重通知よりまし）
    const rows = await res.json().catch(() => null);
    if (!Array.isArray(rows) || rows.length) return;      // 今日はもう通知済み
    await recordAction({
      actor_email: advisor.email, action: 'login', result: 'ok',
      payload: { name: advisor.name || null },
    });
    const who = advisor.name ? (advisor.name + '（' + advisor.email + '）') : advisor.email;
    await notifyChatwork('[info][title]税理士ワークスペース[/title]'
      + who + ' 様が本日はじめてログインしました（' + jstDate + '）[/info]');
  } catch (e) {
    console.error('login通知に失敗（本処理は続行）', e && e.message);
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

/* ---------------- 共有ファイルを証憑としてMFへ添付する（2026-08-05） ----------------
 * ③共有ファイル（tax-docsバケット）は、これまで「見るだけ」だった。
 * 税理士がご自身の判断で証憑にできるようにする（利用者の指示・2026-08-05）。
 *
 * ⚠ MFの証憑は**送ったら取り消せない**（制約10）。したがって守るのは3つ:
 *   (1) すでに証憑が付いている仕訳には**送らない**（GET /journals/{id} で確かめる）
 *   (2) 同じ中身のファイルは**二度取り込まない**（SHA-256のcontent_hashで弾く）
 *   (3) MFへ送る前に必ずDBでclaimする（制約12。attachEvidenceToJournal がやる）
 */
const MF_EVIDENCE_BUCKET = 'mf-evidence';

function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function extContentType(name) {
  const n = String(name || '').toLowerCase();
  if (n.endsWith('.pdf')) return 'application/pdf';
  if (n.endsWith('.png')) return 'image/png';
  return 'image/jpeg';
}

// 共有ファイルの中身を取る（service roleで直接。署名URLは使わない）
async function fetchTaxDocBytes(key) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${TAX_DOCS_BUCKET}/${key}`, {
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
  });
  if (!res.ok) throw new Error(`共有ファイルの読込に失敗: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// 同じ中身が既に証憑台帳にあるか。**二重添付を防ぐ最後の砦**
async function findEvidenceByContentHash(hash) {
  const url = `${SUPABASE_URL}/rest/v1/mf_evidence`
    + `?content_hash=eq.${encodeURIComponent(hash)}`
    + `&select=id,file_name,status,journal_id,created_at&limit=1`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) throw new Error(`証憑台帳の検索に失敗: HTTP ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function putEvidenceObject(path, bytes, contentType) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_EVIDENCE_BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': contentType,
      'x-upsert': 'false',
    },
    body: bytes,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`証憑の保存に失敗: HTTP ${res.status} ${t.slice(0, 120)}`);
  }
}

async function insertEvidenceRow(row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/mf_evidence`, {
    method: 'POST',
    headers: { ...supabaseHeaders(), Prefer: 'return=representation' },
    body: JSON.stringify([row]),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // content_hash のunique制約に当たった場合もここに来る（DBレベルの最終防御・制約13）
    const msg = (data && (data.message || data.error)) || `HTTP ${res.status}`;
    const err = new Error(String(msg));
    err.duplicate = res.status === 409 || /duplicate|unique/i.test(String(msg));
    throw err;
  }
  return Array.isArray(data) && data.length ? data[0] : null;
}

/* 共有ファイル1件を証憑台帳へ取り込む（まだMFへは送らない）。
 * 戻り値: {ok:true, evidence} / {ok:false, error, detail} */
async function importSharedFileAsEvidence(key, displayName) {
  const name = String(displayName || key.split('/').pop() || 'evidence');
  if (!ATTACHABLE_EXT_RE.test(name)) {
    return { ok: false, error: 'not_attachable', detail: name };
  }
  let bytes;
  try {
    bytes = await fetchTaxDocBytes(key);
  } catch (e) {
    return { ok: false, error: 'read_failed', detail: String((e && e.message) || e) };
  }
  const hash = sha256Hex(bytes);

  // (2) 同じ中身は二度取り込まない
  let dup;
  try {
    dup = await findEvidenceByContentHash(hash);
  } catch (e) {
    // 確かめられないのに送るのは危ない（送ったら取り消せない）。ここで止める
    return { ok: false, error: 'dup_check_failed', detail: String((e && e.message) || e) };
  }
  if (dup) {
    /* すでにMFへ送り終えているなら、二度は送らない（取り消せないため）。 */
    if (dup.status === 'attached') {
      return {
        ok: false, error: 'duplicate_file',
        detail: { file_name: dup.file_name, status: dup.status, journal_id: dup.journal_id },
      };
    }
    /* まだ送っていない行が残っている場合は**それを使い回す**。
     * ⚠ ここを「重複だから拒否」にすると、添付が一度失敗しただけで
     *   台帳に行が残り、同じファイルを二度と添付できなくなる（行き止まり）。
     *   しかも②仕訳待ちの件数が増えたまま減らない（2026-08-05のレビューで発見）。 */
    const full = await fetchEvidenceById(dup.id);
    if (full && full.storage_path) return { ok: true, evidence: full, reused: true };
    return { ok: false, error: 'duplicate_file', detail: { file_name: dup.file_name, status: dup.status } };
  }

  const safe = name.replace(/[^\w.\-]+/g, '_').slice(-80);
  const storagePath = `tax-docs/${hash.slice(0, 16)}_${safe}`;
  try {
    await putEvidenceObject(storagePath, bytes, extContentType(name));
  } catch (e) {
    return { ok: false, error: 'store_failed', detail: String((e && e.message) || e) };
  }

  try {
    const evidence = await insertEvidenceRow({
      file_name: name,
      storage_path: storagePath,
      content_hash: hash,
      status: 'pending',
      source: 'tax_docs',
      mf_file_id: null,
      journal_id: null,
    });
    if (!evidence) return { ok: false, error: 'insert_failed' };
    return { ok: true, evidence };
  } catch (e) {
    // 置いたファイルだけが残らないよう片付ける（失敗しても本筋は変えない）
    await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_EVIDENCE_BUCKET}/${storagePath}`, {
      method: 'DELETE',
      headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
    }).catch(() => {});
    if (e && e.duplicate) return { ok: false, error: 'duplicate_file', detail: '同時に取り込まれました' };
    return { ok: false, error: 'insert_failed', detail: String((e && e.message) || e) };
  }
}

/* (1) その仕訳に既に証憑が付いていないか。
 * 付いているものに足すと、MFでは外せない（制約10）ので、必ず送る前に見る。
 * 取れなかったときは **付いているかもしれない側に倒す**（送らない）。 */
async function journalVoucherState(accessToken, journalId) {
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/journals/${encodeURIComponent(journalId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
  const j = (data && data.journal) || null;
  if (!j) return { ok: false, error: 'journal_not_found' };
  const ids = Array.isArray(j.voucher_file_ids) ? j.voucher_file_ids : [];
  return { ok: true, has_voucher: ids.length > 0, count: ids.length, journal: j };
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

/* 共有ファイル1件を、指定した仕訳へ証憑として添付する（③からの操作）。
 * 順番が大事: ①仕訳に証憑が付いていないか確認 → ②台帳へ取り込み(重複チェック) → ③MFへ送信
 * ①を先にやるのは、送ってから気づいても**取り消せない**ため。 */
async function handleAttachSharedFile(res, advisor, accessToken, body, opts) {
  const isAdmin = !!(opts && opts.isAdmin);
  /* 添付する元は2通り:
   *   key         … ③共有ファイル（tax-docs）。台帳へ取り込んでから送る
   *   evidence_id … ②仕訳待ちの証憑。すでに台帳にあるのでそのまま送る
   * どちらも通る関門は同じ（すでに証憑が付いた仕訳には送らない・承認設定・claim先行）。 */
  const key = String(body.key || '').trim();
  const evidenceId = String(body.evidence_id || '').trim();
  const journalId = String(body.journal_id || '').trim();
  if ((!key && !evidenceId) || !journalId) {
    res.status(200).json({ ok: false, error: 'key_and_journal_required' });
    return;
  }

  /* 承認が必要な設定のとき、担当者ひとりでは添付させない（利用者の指示・2026-08-05）。
   * ⚠ 仕訳の登録と同じ「承認待ちに積む」にはしない。
   *   仕訳は承認前ならMFに何も送られていないので差し戻せるが、
   *   証憑は**送ってしまえば取り消せない**（制約10）。
   *   積んでも「やっぱりやめる」ができないのだから、待たせる意味がない。
   *   管理者だけができる、で塞ぐほうが確実で、作りも増えない。 */
  if (!isAdmin) {
    const policy = await fetchApprovalPolicy();
    if (policy === 'required') {
      await recordAction({
        actor_email: advisor.email, action: 'attach_shared_file', journal_id: journalId,
        result: 'failed', error_message: 'admin_only_when_approval',
        payload: { key: key || null, evidence_id: evidenceId || null },
      });
      res.status(200).json({ ok: false, error: 'admin_only_when_approval' });
      return;
    }
  }

  // (1) すでに証憑が付いている仕訳には送らない
  const state = await journalVoucherState(accessToken, journalId);
  if (!state.ok) {
    // 確かめられないなら送らない（安全側）
    res.status(200).json({ ok: false, error: 'journal_check_failed', detail: state.error });
    return;
  }
  if (state.has_voucher) {
    await recordAction({
      actor_email: advisor.email, action: 'attach_shared_file', journal_id: journalId,
      result: 'failed', error_message: 'already_has_voucher',
      payload: { key: key || null, evidence_id: evidenceId || null },
    });
    res.status(200).json({ ok: false, error: 'already_has_voucher', count: state.count });
    return;
  }

  // (2) 台帳の行を用意する。②からの場合は既にあるので取り込みはしない
  let imported;
  if (evidenceId) {
    const ev = await fetchEvidenceById(evidenceId);
    if (!ev) imported = { ok: false, error: 'evidence_not_found' };
    else if (!ev.storage_path) imported = { ok: false, error: 'no_storage_path' };
    else if (ev.status === 'attached') imported = { ok: false, error: 'already_attached' };
    else imported = { ok: true, evidence: ev };
  } else {
    imported = await importSharedFileAsEvidence(key, body.name || '');
  }
  if (!imported.ok) {
    await recordAction({
      actor_email: advisor.email, action: 'attach_shared_file', journal_id: journalId,
      result: 'failed', error_message: imported.error,
      payload: { key: key || null, evidence_id: evidenceId || null, detail: imported.detail },
    });
    res.status(200).json({ ok: false, error: imported.error, detail: imported.detail });
    return;
  }

  /* (3) MFへ送る（claim先行はattachEvidenceの中）。
   * ⚠ 送る直前にもう一度「まだ証憑が付いていないか」を確かめる。
   *   証憑ごとの claim は**その証憑1件**を守るだけで、**仕訳単位のロックではない**。
   *   同じ仕訳に別々の証憑を2人が同時に送ると、両方とも (1) の確認を通ってしまい、
   *   MFに2件届く。MFの証憑は取り消せない（制約10）ので、あとから1件だけ消せない
   *   （2026-08-06のレビューで発覚）。
   *   ⚠ これは隙間を狭めるだけで、完全には防げない（MFに仕訳単位のロックが無いため）。
   *   取り込み〜送信の間に他が割り込む余地は残る。完全な排他が要るなら
   *   Supabase側に仕訳IDの予約テーブルを作る必要がある。 */
  const again = await journalVoucherState(accessToken, journalId);
  if (again.ok && again.has_voucher) {
    await recordAction({
      actor_email: advisor.email, action: 'attach_shared_file', journal_id: journalId,
      result: 'failed', error_message: 'already_has_voucher_race',
      payload: { key: key || null, evidence_id: evidenceId || null },
    });
    res.status(200).json({ ok: false, error: 'already_has_voucher', count: again.count });
    return;
  }

  const r = await attachEvidence(accessToken, imported.evidence.id, journalId);
  await recordAction({
    actor_email: advisor.email, action: 'attach_shared_file', journal_id: journalId,
    evidence_ids: r.ok ? [imported.evidence.id] : null,
    result: r.ok ? 'ok' : 'failed',
    error_message: r.ok ? null : (r.error || 'attach_failed'),
    payload: { key: key || null, evidence_id: evidenceId || null, file_name: imported.evidence.file_name },
  });
  if (!r.ok) {
    res.status(200).json({ ok: false, error: r.error || 'attach_failed', message: r.message });
    return;
  }
  res.status(200).json({ ok: true, journal_id: journalId, file_name: imported.evidence.file_name });
}

/* ③から添付する相手の仕訳を探す。
 * ⚠ GET /journals は会計期間をまたげない（制約18）ので、期間は呼び出し側が1期に収める。
 *   ここでは「すでに証憑が付いているか」も一緒に返し、付いているものは画面で選べなくする。 */
const JOURNAL_SEARCH_MAX = 200;
async function handleJournalSearch(res, accessToken, body) {
  const startDate = String(body.start_date || '').slice(0, 10);
  const endDate = String(body.end_date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    res.status(200).json({ ok: false, error: 'date_required' });
    return;
  }
  let journals;
  try {
    journals = await fetchJournals({ accessToken, startDate, endDate });
  } catch (e) {
    res.status(200).json({ ok: false, error: 'journal_fetch_failed', message: e && e.message });
    return;
  }
  const kw = normalizeText(String(body.keyword || ''));
  const rows = [];
  (Array.isArray(journals) ? journals : []).forEach((j) => {
    const branches = Array.isArray(j.branches) ? j.branches : [];
    // 税込。制約2のとおり value と tax_value を足す
    let amount = 0;
    const accounts = [];
    let remark = '';
    branches.forEach((b) => {
      const d = (b && b.debitor) || null;
      const c = (b && b.creditor) || null;
      if (d) { amount += (Number(d.value) || 0) + (Number(d.tax_value) || 0); if (d.account_name) accounts.push(d.account_name); }
      if (c && c.account_name) accounts.push(c.account_name);
      if (!remark && b && b.remark) remark = String(b.remark);
    });
    const hay = normalizeText(remark + ' ' + accounts.join(' '));
    if (kw && hay.indexOf(kw) < 0) return;
    const vids = Array.isArray(j.voucher_file_ids) ? j.voucher_file_ids : [];
    rows.push({
      id: j.id,
      date: j.transaction_date,
      amount,
      remark,
      accounts: Array.from(new Set(accounts)).slice(0, 4),
      // すでに証憑が付いている仕訳は画面で選べなくする
      has_voucher: vids.length > 0,
      voucher_count: vids.length,
    });
  });
  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  res.status(200).json({
    ok: true,
    total: rows.length,
    truncated: rows.length > JOURNAL_SEARCH_MAX,
    journals: rows.slice(0, JOURNAL_SEARCH_MAX),
  });
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
    // tax_workspace_settings は id=1 の1行だけを持つ設定テーブル（既存の closed_term_policy と同じ行）
    const url = `${SUPABASE_URL}/rest/v1/tax_workspace_settings?id=eq.1&select=approval_policy&limit=1`;
    const res = await fetch(url, { headers: supabaseHeaders() });
    if (!res.ok) return 'none';
    const rows = await res.json().catch(() => []);
    const v = Array.isArray(rows) && rows[0] ? rows[0].approval_policy : null;
    return APPROVAL_POLICIES.indexOf(v) >= 0 ? v : 'none';
  } catch (e) {
    // 設定が読めないときは「承認しない」に倒す。読めないことを理由に登録を止めない
    return 'none';
  }
}

// ⚠ 画面からは呼んでいない（変更はSQLで行う運用）。将来つなぐときのために形だけ残す。
async function saveApprovalPolicy(policy, byEmail) {
  if (APPROVAL_POLICIES.indexOf(policy) < 0) return false;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/tax_workspace_settings?id=eq.1`, {
    method: 'PATCH',
    headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ approval_policy: policy, updated_by: byEmail, updated_at: new Date().toISOString() }),
  });
  return res.ok;
}

/* PostgREST の ilike に渡す値をそのまま使わない。
 * ⚠ `%` と `_` はパターン文字なので、`k%sado@example.com` のようなメールだと
 *   「kで始まりsado@example.comで終わる」の部分一致になり、**別人の行を巻き込む**。
 *   メールのローカル部は仕様上これらを含められる（2026-08-06のレビューで指摘）。 */
function ilikeLiteral(v) {
  return String(v || '').replace(/([\\%_])/g, '\\$1');
}

/* 表示名の変更。空にしたら消す（nullへ）。長すぎる名前は60文字で切る */
async function setAdvisorName(email, name) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  const v = String(name || '').trim().slice(0, 60);
  /* ⚠ 0件更新でもPostgRESTは200を返す。res.ok だけを見ると、
   *   存在しないメールへの変更が「成功」として記録され、記録と実態が食い違う
   *   （setAdvisorEnabled は最初から行数を見ていた。2026-08-06のレビューで発覚）。 */
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tax_advisors?email=ilike.${encodeURIComponent(ilikeLiteral(e))}`,
    { method: 'PATCH', headers: { ...supabaseHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ name: v || null }) }
  );
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

async function setAdvisorRole(email, role) {
  const e = String(email || '').trim().toLowerCase();
  if (!e || ['admin', 'staff'].indexOf(role) < 0) return false;
  // 0件更新を成功と言わない（setAdvisorName と同じ理由）
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/tax_advisors?email=ilike.${encodeURIComponent(ilikeLiteral(e))}`,
    { method: 'PATCH', headers: { ...supabaseHeaders(), Prefer: 'return=representation' }, body: JSON.stringify({ role }) }
  );
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 0;
}

const REQUEST_LIST_LIMIT = 200;
// 承認待ちの一覧。admin は全件、staff は自分の依頼だけ
async function listJournalRequests(advisor, isAdmin) {
  let url = `${SUPABASE_URL}/rest/v1/tax_journal_requests?select=*&order=created_at.desc&limit=${REQUEST_LIST_LIMIT}`;
  if (!isAdmin) url += `&requested_by=eq.${encodeURIComponent(advisor.email)}`;
  const res = await fetch(url, { headers: { ...supabaseHeaders(), Prefer: 'count=exact' } });
  if (!res.ok) return { ok: false, rows: [], reason: 'HTTP ' + res.status };
  const rows = await res.json().catch(() => null);
  if (!Array.isArray(rows)) return { ok: false, rows: [], reason: '応答の形式が想定と違います' };
  // 承認待ちが上限を超えたら黙って隠さない（承認漏れは実害が大きい）
  const cr = String(res.headers.get('content-range') || '');
  const totalStr = cr.split('/')[1];
  const total = /^\d+$/.test(totalStr || '') ? Number(totalStr) : rows.length;
  return { ok: true, rows, total, truncated: total > rows.length, reason: '' };
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
          tax_text: taxText || null,
          /* ⚠ ここに入れ忘れると、担当者が選んだ共有ファイルが
           *   承認の往復で**黙って消える**（2026-08-05のレビューで発見）。
           *   handleJournalize へ渡す側（handleApproveRequest）も必ず合わせること。 */
          shared_file_keys: Array.isArray(body.shared_file_keys) ? body.shared_file_keys.slice(0, 5) : [],
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

  /* 1-3. 税区分を打ったのに候補と一致していない状態で登録させない。
   * ⚠ 画面側にも同じ判定があるが迂回できるので、ここでも必ず見る（インボイス区分と同じ考え方）。
   *   以前はこの確認が無く、「課税仕入10」のように途中まで打った文字が残っていても
   *   **税区分だけ黙って未指定で登録**されていた（2026-08-05の新人レビューで発覚）。
   *   消費税に直結し、登録した仕訳はこの画面から取り消せない（制約22）。 */
  const taxText = String((body && body.tax_text) || '').trim();
  if (taxText && !body.tax_id) {
    await recordAction({
      actor_email: advisor.email, action: 'journalize', transaction_id: transactionId,
      account_id: accountId, result: 'failed', error_message: 'tax_not_resolved',
      payload: { tax_text: taxText },
    });
    res.status(200).json({ ok: false, error: 'tax_not_resolved', tax_text: taxText });
    return;
  }

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

  /* 3b. 共有ファイルからの添付（税理士がご自身の判断で選んだもの・2026-08-05）。
   * 作ったばかりの仕訳なので証憑は付いていないが、③と同じ関門を通す。
   * 同じ中身のファイルは importSharedFileAsEvidence が弾く。 */
  const sharedKeys = Array.isArray(body.shared_file_keys) ? body.shared_file_keys.slice(0, 5) : [];
  for (const sk of sharedKeys) {
    if (!journalId) break;
    const key = String((sk && sk.key) || sk || '');
    if (!key) continue;
    const imported = await importSharedFileAsEvidence(key, (sk && sk.name) || '');
    if (!imported.ok) {
      attachFailed.push({ shared_key: key, error: imported.error, detail: imported.detail });
      continue;
    }
    const r = await attachEvidence(accessToken, imported.evidence.id, journalId);
    if (r.ok) attached.push(imported.evidence.id);
    else attachFailed.push({ shared_key: key, error: r.error });
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
    if (r.ok) {
      // 初回登録はログインより大きな出来事なので、その場で知らせる（失敗しても登録は成功扱い）
      const who = r.name ? (r.name + '（' + r.email + '）') : r.email;
      await notifyChatwork('[info][title]税理士ワークスペース[/title]'
        + who + ' 様が招待リンクから登録しました（管理者）[/info]');
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

  /* 役割の判定はここで一度だけ行い、以降の分岐で使い回す。
   * ⚠ set_closed_term_policy より**前**で定義すること（下で定義すると未定義参照になる）。 */
  const isAdmin = isAdvisorAdmin(advisor, isMember);

  // 招待と税理士の管理は社内メンバーだけ
  const MEMBER_ONLY = ['invite_create', 'invite_list', 'invite_revoke', 'advisor_list', 'advisor_set_enabled'];
  if (MEMBER_ONLY.indexOf(action) >= 0) {
    if (!isMember) {
      res.status(403).json({ ok: false, error: 'member_only' });
      return;
    }
    try {
      /* ⚠ 招待の発行・取り消し・税理士の有効無効は、この画面で最も重い操作
       *   （管理者権限を持つ人を増やす／アクセスを止める）なのに、
       *   長らく記録が残っていなかった（2026-08-05の所長レビューで発覚）。
       *   tax_advisors に履歴列が無いため、消えると誰がいつやったか永久に分からない。
       *   一覧の表示（invite_list / advisor_list）は読むだけなので記録しない。 */
      if (action === 'invite_create') {
        const inv = await createInvite(user.email, body.note);
        await recordAction({
          actor_email: user.email, action: 'invite_create', result: 'ok',
          payload: { note: body.note || null, expires_at: inv.expires_at },
        });
        res.status(200).json({ ok: true, ...inv });
      } else if (action === 'invite_list') {
        res.status(200).json({ ok: true, invites: await listInvites() });
      } else if (action === 'invite_revoke') {
        const revoked = await revokeInvite(body.invite_token);
        await recordAction({
          actor_email: user.email, action: 'invite_revoke',
          result: revoked ? 'ok' : 'failed',
          payload: { revoked: !!revoked },   // トークン自体は残さない（リンクの秘密のため）
        });
        res.status(200).json({ ok: true, revoked });
      } else if (action === 'advisor_list') {
        res.status(200).json({ ok: true, advisors: await listAdvisors() });
      } else if (action === 'advisor_set_enabled') {
        const updated = await setAdvisorEnabled(body.email, body.enabled);
        await recordAction({
          actor_email: user.email, action: 'advisor_set_enabled',
          result: updated ? 'ok' : 'failed',
          payload: { email: body.email, enabled: !!body.enabled },
        });
        res.status(200).json({ ok: true, updated });
      } else {
        /* ⚠ ここは以前 else の受け皿で、**何が来ても「有効・無効の切替」を実行していた**。
         *   MEMBER_ONLY に新しい action を足して分岐を書き忘れると、
         *   body.enabled が undefined のまま !!undefined=false になり
         *   **税理士を黙って無効化する**。必ず名前で分岐し、知らない名前は断ること
         *   （2026-08-05の再レビューで発見）。 */
        res.status(400).json({ ok: false, error: 'unknown_member_action', action });
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

  /* 承認の要否を画面から変える（管理者のみ）。
   * ⚠ 保存処理(saveApprovalPolicy)は前からあったのに、**呼ぶ口が無かった**ため
   *   画面はラジオを出しておきながら「変更できません」とSQLを見せていた。
   *   しかもその案内は古い設計の名残で `'"none"'::jsonb` と書いており、
   *   そのまま実行しても失敗する文面だった（2026-08-05の指摘で発覚）。 */
  if (action === 'set_approval_policy') {
    if (!isAdmin) {
      res.status(403).json({ ok: false, error: 'admin_only' });
      return;
    }
    const okSave = await saveApprovalPolicy(body && body.policy, advisor.email);
    if (!okSave) {
      res.status(200).json({ ok: false, error: 'invalid_policy' });
      return;
    }
    await recordAction({
      actor_email: advisor.email, action: 'set_approval_policy',
      result: 'ok', payload: { policy: body.policy },
    });
    res.status(200).json({ ok: true, approval_policy: body.policy });
    return;
  }

  /* 役割（管理者／担当者）を画面から変える。
   * ⚠ 社内メンバーだけ。税理士どうしで役割を上げ下げできてはいけない。
   * ⚠ **MEMBER_ONLY の配列には足さないこと。** あの配列は上の分岐で処理され、
   *   ここまで届かなくなる。権限の判定はこの中で行っている。 */
  /* 税理士の表示名を変える。
   * ⚠ 社内メンバーだけ。⚠ MEMBER_ONLY の配列には足さないこと（届かなくなる・役割と同じ理由）。 */
  if (action === 'advisor_set_name') {
    if (!isMember) { res.status(403).json({ ok: false, error: 'member_only' }); return; }
    const okName = await setAdvisorName(body && body.email, body && body.name);
    if (!okName) { res.status(200).json({ ok: false, error: 'invalid_name' }); return; }
    await recordAction({
      actor_email: advisor.email, action: 'advisor_set_name',
      result: 'ok', payload: { email: body.email, name: body.name },
    });
    res.status(200).json({ ok: true, email: body.email, name: body.name });
    return;
  }

  if (action === 'advisor_set_role') {
    if (!isMember) { res.status(403).json({ ok: false, error: 'member_only' }); return; }
    const okRole = await setAdvisorRole(body && body.email, body && body.role);
    if (!okRole) { res.status(200).json({ ok: false, error: 'invalid_role' }); return; }
    await recordAction({
      actor_email: advisor.email, action: 'advisor_set_role',
      result: 'ok', payload: { email: body.email, role: body.role },
    });
    res.status(200).json({ ok: true, email: body.email, role: body.role });
    return;
  }

  /* 決算済みの期の扱いは税理士自身が決める（設計書§6-E）。社内メンバーも変更できる。
   * ⚠ ただし**管理者だけ**。担当者が変えられると、
   *   「登録できないようにする」を自分で「警告だけ」に戻して
   *   決算が終わった期へ登録できてしまう（2026-08-05の10人視点レビューで発見）。 */
  if (action === 'set_closed_term_policy') {
    if (!isAdmin) {
      await recordAction({
        actor_email: advisor.email, action: 'set_closed_term_policy',
        result: 'failed', error_message: 'admin_only', payload: { policy: body && body.policy },
      });
      res.status(403).json({ ok: false, error: 'admin_only' });
      return;
    }
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
    'journal_search', 'attach_shared_file',
    'set_approval_policy', 'advisor_set_role', 'advisor_set_name',
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

  // Phase 7: ⑤月次チェック（読み取りのみ）
  // 承認待ちの一覧（adminは全件・staffは自分の依頼だけ）
  if (action === 'request_list') {
    const r = await listJournalRequests(advisor, isAdmin);
    res.status(200).json({
      ok: r.ok, requests: r.rows, is_admin: isAdmin,
      total: r.total, truncated: !!r.truncated, limit: REQUEST_LIST_LIMIT,
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
      /* ⚠ 閲覧できる範囲は、画面(action_log)とCSVでそろえること。
     *   以前は画面が isMember、CSVが isAdmin で判定しており、
     *   税理士側の管理者は**画面で見えないものをCSVでは全件取得できた**
     *   （社内メンバーの操作・金額・エラー内容まで含む。2026-08-05の所長レビューで発覚）。
     *   事務所を区別する列が無いため、事務所を増やすと他事務所の分まで見える。
     *   全件を見てよいのは社内メンバーだけにする。 */
  await handleActionLogCsv(res, advisor, isMember, body);
    return;
  }

  /* ③共有ファイルから証憑を添付する。
   * ⚠ ここへ来られるのは有効な税理士か社内メンバーだけ（この関数の先頭で確認済み）。
   *   list が返す writable は常にtrueの表示用フラグで、ここには存在しない。
   *   journalize と同じ扱いにする。 */
  if (action === 'journal_search') {
    await handleJournalSearch(res, accessToken, body);
    return;
  }
  if (action === 'attach_shared_file') {
    await handleAttachSharedFile(res, advisor, accessToken, body, { isAdmin });
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

  // 画面の中身（未仕訳の明細・証憑候補・共有ファイル）。ここに来るのは action='list' だけ
  /* 税理士が今日はじめて画面を開いたことをRIBREへ知らせる。
   * 社内メンバー自身のログインは鳴らさない。失敗しても画面は普通に出す。 */
  if (!isMember) await notifyAdvisorLoginOnce(advisor);
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
    /* ⚠ 以前は件数しか返しておらず、税理士は②に何が溜まっているのか見られなかった。
     *   証憑インボックスは社内メンバー専用なので、**税理士側に手の打ちようが無かった**
     *   （2026-08-05の指摘）。中身と、署名付きのプレビューURLを返す。 */
    open_evidence: await Promise.all(evidences.slice(0, OPEN_EVIDENCE_SHOW).map(async (ev) => ({
      evidence_id: ev.id,
      file_name: ev.file_name,
      ocr_date: ev.ocr_date,
      ocr_amount: ev.ocr_amount,
      ocr_currency: ev.ocr_currency || 'JPY',
      ocr_vendor: ev.ocr_vendor,
      status: ev.status,
      url: await signEvidenceUrl(ev.storage_path, ev.file_name),
    }))),
    // 一覧は上限で切れることがあるが、件数は本当の数を返す（切れたら伝える）
    open_evidence_count: (evidenceRes.total != null ? evidenceRes.total : evidences.length),
    open_evidence_truncated: !!evidenceRes.truncated,
    open_evidence_shown: evidences.length,
    // 失敗を「無い」に化けさせない。画面はこれを見て「見つからない」と「取れなかった」を分ける
    evidence_load_failed: evidenceRes.ok ? null : evidenceRes.reason,
    shared_files_load_failed: sharedRes.ok ? null : sharedRes.reason,
  });
};
