// GET /api/mf/monthly-report
// 当月の証憑カバー率＋未添付件数を集計し、Slackへ月次レポートを送信する
// 認証: (1) Vercel Cronからの実行（Authorization: Bearer CRON_SECRET一致） (2) ログイン済みユーザー のいずれか
'use strict';

const { getAccessToken, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { computeCoverage, currentYearMonth } = require('./_lib/mf-coverage');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const CRON_SECRET = process.env.CRON_SECRET;
const CHATWORK_API_TOKEN = process.env.CHATWORK_API_TOKEN;
const CHATWORK_ROOM_ID = process.env.CHATWORK_ROOM_ID;
const MF_EVIDENCE_APP_URL = 'https://ribre-sales-system.vercel.app/mf-evidence';

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

// mf_evidence のうち status='box_saved'（MFへは送信済みだが仕訳未添付）の件数を数える
async function countBoxSavedEvidence() {
  const url = `${SUPABASE_URL}/rest/v1/mf_evidence?select=id&status=eq.box_saved`;
  const res = await fetch(url, { headers: { ...supabaseHeaders(), Prefer: 'count=exact' } });
  if (!res.ok) throw new Error(`Supabase mf_evidence集計失敗: HTTP ${res.status}`);
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : 0;
}

function isValidCronRequest(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !CRON_SECRET) return false;
  return auth === `Bearer ${CRON_SECRET}`;
}

function buildSlackMessage({ month, coverage }) {
  const text =
    `【MF証憑 月次レポート ${month}】` +
    `仕訳${coverage.total}件中 証憑あり${coverage.with_voucher}件（${coverage.coverage_pct}%）／` +
    `未添付の証憑 ${coverage.box_saved_count}件。` +
    `詳細: ${MF_EVIDENCE_APP_URL}`;
  return { text };
}

async function postToSlack(payload) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.ok;
}

// 税理士向けのChatwork月次報告メッセージ（Chatwork記法[info]を使用）
function buildChatworkMessage({ month, coverage }) {
  return (
    `[info][title]RIBRE 証憑登録 月次報告（${month}）[/title]` +
    `今月分の証憑はマネーフォワード クラウドBoxへ登録済みです。` +
    `仕訳${coverage.total}件中${coverage.with_voucher}件に証憑を添付済み（${coverage.coverage_pct}%）。` +
    `ご確認のほどよろしくお願いいたします。[/info]`
  );
}

async function postToChatwork(message) {
  const res = await fetch(`https://api.chatwork.com/v2/rooms/${encodeURIComponent(CHATWORK_ROOM_ID)}/messages`, {
    method: 'POST',
    headers: {
      'X-ChatWorkToken': CHATWORK_API_TOKEN,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ body: message }),
  });
  return res.ok;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  // Cronからの実行、またはログイン済みユーザーのいずれかを許可
  const isCron = isValidCronRequest(req);
  if (!isCron) {
    const user = await verifySupabaseToken(req);
    if (!user) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
  }

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (e instanceof NotConnectedError) {
      res.status(401).json({ ok: false, error: 'not_connected' });
      return;
    }
    res.status(500).json({ ok: false, error: 'token_error' });
    return;
  }

  try {
    const month = currentYearMonth();
    const coverage = await computeCoverage({ accessToken, month });
    const boxSavedCount = await countBoxSavedEvidence();
    const fullCoverage = { ...coverage, box_saved_count: boxSavedCount };

    const target = (req.query && req.query.target) || 'all';
    const wantSlack = target === 'slack' || target === 'all';
    const wantChatwork = target === 'chatwork' || target === 'all';

    const slackConfigured = Boolean(SLACK_WEBHOOK_URL);
    const chatworkConfigured = Boolean(CHATWORK_API_TOKEN && CHATWORK_ROOM_ID);

    if (!slackConfigured && !chatworkConfigured) {
      res.status(200).json({ ok: false, error: 'notify_not_configured', ...fullCoverage });
      return;
    }

    let slackSent = false;
    if (wantSlack && slackConfigured) {
      try {
        slackSent = await postToSlack(buildSlackMessage({ month, coverage: fullCoverage }));
      } catch (e) {
        slackSent = false;
      }
    }

    let chatworkSent = false;
    if (wantChatwork && chatworkConfigured) {
      try {
        chatworkSent = await postToChatwork(buildChatworkMessage({ month, coverage: fullCoverage }));
      } catch (e) {
        chatworkSent = false;
      }
    }

    res.status(200).json({ ok: true, ...fullCoverage, slack_sent: slackSent, chatwork_sent: chatworkSent });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: 'mf_monthly_report_failed',
      message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
    });
  }
};
