// マネーフォワード クラウド会計 API 共通クライアント
// - Supabase (mf_tokens テーブル, id=1固定の1行運用) でトークンを永続化
// - アクセストークンの有効期限チェックと自動リフレッシュ
//
// 環境変数:
//   MF_CLIENT_ID, MF_CLIENT_SECRET, MF_REDIRECT_URI
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

'use strict';

// authorize/token のURLは公式OpenAPI仕様書の securitySchemes で確認済み（確定値）。
// 出典: https://developers.api-accounting.moneyforward.com/v3/openapi.yaml
//   authorizationUrl: https://api.biz.moneyforward.com/authorize
//   tokenUrl:         https://api.biz.moneyforward.com/token
const MF_AUTHORIZE_URL = 'https://api.biz.moneyforward.com/authorize';
const MF_TOKEN_URL = 'https://api.biz.moneyforward.com/token';

// 証憑API（vouchers）のベースURL。openapi.yaml の servers セクションで確認済み。
// 出典: https://developers.api-accounting.moneyforward.com/v3/openapi.yaml
//   servers: - url: https://api-accounting.moneyforward.com
const MF_ACCOUNTING_API_BASE = 'https://api-accounting.moneyforward.com';

// transaction.read は「マッチ待ちの証憑が何を待っているのか」を明細から調べるために追加した
// （2026-08-02）。読み取り専用で、明細の作成・仕訳化はしない。
// 既に連携済みの環境ではこのスコープを持たないトークンが保存されているため、明細APIは
// 403を返す。呼び出し側は403を「再連携が必要」として扱うこと（他の機能は影響を受けない）。
// 税理士ワークスペース(docs/TAX_WORKSPACE_PLAN.md)で追加（2026-08-02）:
//   accounts.read / taxes.read / trade_partners.read … 勘定科目・税区分・取引先の選択欄に使う（Phase 1で必要）
//   journal.write … 明細からの仕訳作成に使う（Phase 3で使用。再連携を2回させないため先に取得しておく）
// journal.write は取得するだけで、Phase 3の実装まではどこからも呼ばない。
// 税理士ワークスペース Phase 7(docs/TAX_WORKSPACE_PHASE7_PLAN.md)で追加（2026-08-04）:
//   report.read             … ⑨月次チェック（推移表・試算表）。Phase 7 で最も価値が高い機能がこれ1つに懸かる
//   offices.read            … 会計年度設定。3/1〜2/28という前提をコードに書かずAPIから取れる
//   connected_account.read  … ⑩資料の受け取り（口座ごとのデータ到達状況）
// いずれも**読み取り専用**。書き込み系（transaction.write / trade_partners.write）は
// 使う機能が決まっていないため、あえて足していない（設計書§1.1から方針変更）。
// ⑦現金払いを作ると決めた時点で transaction.write を足して再連携する。
const MF_SCOPE = [
  'mfc/accounting/voucher.write',
  'mfc/accounting/journal.read',
  'mfc/accounting/transaction.read',
  'mfc/accounting/accounts.read',
  'mfc/accounting/taxes.read',
  'mfc/accounting/trade_partners.read',
  'mfc/accounting/journal.write',
  'mfc/accounting/report.read',
  'mfc/accounting/offices.read',
  'mfc/accounting/connected_account.read',
].join(' ');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// NotConnected: MF未接続（トークン未保存）を示すエラー
class NotConnectedError extends Error {
  constructor(message) {
    super(message || 'MF未接続です');
    this.name = 'NotConnectedError';
  }
}

// mf_tokens の1行(id=1)を取得。無ければ null。
async function fetchTokenRow() {
  const url = `${SUPABASE_URL}/rest/v1/mf_tokens?id=eq.1&select=*`;
  const res = await fetch(url, { headers: supabaseHeaders() });
  if (!res.ok) {
    throw new Error(`Supabase mf_tokens取得失敗: HTTP ${res.status}`);
  }
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

// mf_tokens の1行(id=1)をupsert保存
async function saveTokenRow({ access_token, refresh_token, expires_at }) {
  const url = `${SUPABASE_URL}/rest/v1/mf_tokens?on_conflict=id`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...supabaseHeaders(),
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([
      {
        id: 1,
        access_token,
        refresh_token,
        expires_at,
        updated_at: new Date().toISOString(),
      },
    ]),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase mf_tokens保存失敗: HTTP ${res.status} ${text}`);
  }
}

// authorization code をトークンに交換
async function exchangeCodeForToken(code) {
  const res = await fetch(MF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.MF_REDIRECT_URI,
      client_id: process.env.MF_CLIENT_ID,
      client_secret: process.env.MF_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`MFトークン交換失敗: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data;
}

// refresh_token でアクセストークンを更新
async function refreshAccessToken(refreshToken) {
  const res = await fetch(MF_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: process.env.MF_CLIENT_ID,
      client_secret: process.env.MF_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`MFトークンリフレッシュ失敗: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data;
}

// 保存済みトークン行から有効なaccess_tokenを取得。
// 期限が5分以内、または期限切れならrefresh_tokenで更新して保存する。
// トークン未保存ならNotConnectedErrorを投げる。
async function getAccessToken() {
  const row = await fetchTokenRow();
  if (!row || !row.refresh_token) {
    throw new NotConnectedError();
  }

  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  const fiveMinutesMs = 5 * 60 * 1000;
  const needsRefresh = !row.access_token || expiresAt - Date.now() <= fiveMinutesMs;

  if (!needsRefresh) {
    return row.access_token;
  }

  const refreshed = await refreshAccessToken(row.refresh_token);
  const newExpiresAt = new Date(Date.now() + (refreshed.expires_in || 3600) * 1000).toISOString();
  await saveTokenRow({
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || row.refresh_token,
    expires_at: newExpiresAt,
  });
  return refreshed.access_token;
}

// 証憑(voucher)をMFへ送信
async function postVoucher({ accessToken, journalId, fileName, fileDataBase64 }) {
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/vouchers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      journal_id: journalId || null,
      voucher_files: [{ file_name: fileName, file_data: fileDataBase64 }],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

// MFのレート制限は「1秒あたり3リクエスト」（ClientID × 事業者ID単位）。
// 出典: https://developers.api-accounting.moneyforward.com/rate_limiter
//
// ⚠ この間隔調整は**同じプロセス内でしか効かない**。
//    Vercelのサーバーレス関数は呼び出しごとに別プロセスになりうるため、
//    cron(auto-match)と利用者の操作が同時に走れば429は起こりうる。
//    そのため429を受けたときの待ち直しを必ず入れてある。
//    プロセスをまたぐ完全な制御にはSupabase等の共有カウンタが要る（未実装）。
const MF_MIN_INTERVAL_MS = 350; // 3req/sec に余裕を持たせる
let mfLastCallAt = 0;
let mfChain = Promise.resolve();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// MFへのリクエストを直列化し、間隔を空けて投げる。429なら待って投げ直す。
function mfFetch(url, options, maxRetries = 3) {
  const run = async () => {
    for (let attempt = 0; ; attempt++) {
      const wait = MF_MIN_INTERVAL_MS - (Date.now() - mfLastCallAt);
      if (wait > 0) await sleep(wait);
      mfLastCallAt = Date.now();
      const res = await fetch(url, options);
      if (res.status !== 429 || attempt >= maxRetries) return res;
      // Retry-After があれば従う。無ければ 1秒→2秒→4秒
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 1000 * Math.pow(2, attempt));
    }
  };
  // 直前の呼び出しが終わってから次を始める（同一プロセス内での追い越しを防ぐ）
  const next = mfChain.then(run, run);
  mfChain = next.then(() => undefined, () => undefined);
  return next;
}

// 未仕訳の明細を取得する（読み取り専用）。
// 用途: 「マッチ待ち」の証憑が、まだ仕訳になっていない明細を待っているのかを判定する。
// 出典: https://developers.api-accounting.moneyforward.com/v3/openapi.yaml
//   GET /api/v3/transactions（scope: mfc/accounting/transaction.read）
//   start_date と end_date の差は366日以内という制約がある。
// 注意: 明細に証憑を添付するAPIは存在しない（PostVouchersRequestはjournal_idのみで
//   transaction_idを受け付けず、Transaction.voucher_file_idsは取得専用）。
//   そのため本関数は「待ち理由の表示」にしか使えない。
/* ⚠ 以前は page=1 の1回取得で、501件目以降を**黙って捨てて**いた
 *   （2026-08-05のレビューで発見）。①の一覧からも⑨の未仕訳件数からも
 *   消えるため、「登録が終わった」の判定まで狂う。仕訳の取得（fetchJournals）は
 *   最初から total_pages を見ていたのに、明細だけ見ていなかった。
 *   metadata.total_pages が尽きるまで取り切る。 */
const TX_MAX_PAGES = 20;   // 500×20=10,000件。これを超えるのは異常なので歯止めを置く
async function fetchTransactionsByJournalizingStatus({
  accessToken, startDate, endDate, status, perPage = 500,
}) {
  const out = [];
  let totalPages = 1;
  for (let page = 1; page <= Math.min(totalPages, TX_MAX_PAGES); page += 1) {
    const params = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      per_page: String(perPage),
      page: String(page),
    });
    // journalizing_statuses は配列パラメータ。openapi.yaml で explode: true（style既定=form）
    // と指定されているため、ブラケット無しで同名キーを繰り返す形式が正しい。
    params.append('journalizing_statuses', status);
    const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3/transactions?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = (data && (data.error || data.message)) || `HTTP ${res.status}`;
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }
    const list = Array.isArray(data.transactions) ? data.transactions : [];
    out.push(...list);
    totalPages = (data.metadata && Number(data.metadata.total_pages)) || 1;
    if (!list.length) break;
  }
  return out;
}

async function fetchUnjournalizedTransactions({ accessToken, startDate, endDate, perPage = 500 }) {
  return fetchTransactionsByJournalizingStatus({
    accessToken, startDate, endDate, status: 'none', perPage,
  });
}

module.exports = {
  MF_AUTHORIZE_URL,
  MF_TOKEN_URL,
  MF_ACCOUNTING_API_BASE,
  MF_SCOPE,
  NotConnectedError,
  fetchTokenRow,
  saveTokenRow,
  exchangeCodeForToken,
  refreshAccessToken,
  getAccessToken,
  postVoucher,
  fetchUnjournalizedTransactions,
  fetchTransactionsByJournalizingStatus,
  mfFetch,
};
