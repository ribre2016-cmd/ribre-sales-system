// GET /api/mf/auto-match
// 自動マッチングをCron等から定期実行するエンドポイント（Phase4）
// 認証: (1) Vercel Cronからの実行（Authorization: Bearer CRON_SECRET一致） (2) ログイン済みユーザー のいずれか
'use strict';

const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { getAccessToken, NotConnectedError, runAutoMatch } = require('./_lib/mf-match-core');

const CRON_SECRET = process.env.CRON_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const MF_EVIDENCE_APP_URL = 'https://ribre-sales-system.vercel.app/mf-evidence';

function isValidCronRequest(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !CRON_SECRET) return false;
  return auth === `Bearer ${CRON_SECRET}`;
}

function buildSlackMessage({ attachedCount, ambiguousCount }) {
  const text =
    `【MF証憑 自動マッチング】${attachedCount}件を仕訳に自動添付しました。` +
    (ambiguousCount > 0 ? `候補が複数の証憑が${ambiguousCount}件あります。` : '') +
    ` → ${MF_EVIDENCE_APP_URL}`;
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
    const result = await runAutoMatch(accessToken);

    let slackSent = false;
    const shouldNotify = SLACK_WEBHOOK_URL && (result.attached.length > 0 || result.ambiguous.length > 0);
    if (shouldNotify) {
      try {
        slackSent = await postToSlack(
          buildSlackMessage({ attachedCount: result.attached.length, ambiguousCount: result.ambiguous.length })
        );
      } catch (e) {
        slackSent = false;
      }
    }

    res.status(200).json({ ...result, slack_sent: slackSent });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: 'mf_auto_match_failed',
      message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
    });
  }
};
