// GET /api/mf/auto-match
// 自動マッチングをCron等から定期実行するエンドポイント（Phase4）
// 認証: (1) Vercel Cronからの実行（Authorization: Bearer CRON_SECRET一致） (2) ログイン済みユーザー のいずれか
'use strict';

const crypto = require('crypto');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { getAccessToken, NotConnectedError, runAutoMatch, processAwaitingMatch } = require('./_lib/mf-match-core');

const CRON_SECRET = process.env.CRON_SECRET;
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const MF_EVIDENCE_APP_URL = 'https://ribre-sales-system.vercel.app/mf-evidence';

// タイミング攻撃対策: 文字列を直接 !== 比較すると、不一致が見つかった位置によって
// 処理時間にごくわずかな差が出て、シークレットを推測される余地が生まれる
// （timing attack）。SHA256でハッシュ化した上でcrypto.timingSafeEqualを使い、
// 桁数が違う入力でも安全に定時間比較する。
function timingSafeEqualStr(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || '')).digest();
  const hb = crypto.createHash('sha256').update(String(b || '')).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isValidCronRequest(req) {
  const auth = req.headers && (req.headers.authorization || req.headers.Authorization);
  if (!auth || !CRON_SECRET) return false;
  return timingSafeEqualStr(auth, `Bearer ${CRON_SECRET}`);
}

function buildSlackMessage({ attachedCount, ambiguousCount, failedCount, failedEvidenceIds }) {
  const idsPreview =
    failedEvidenceIds && failedEvidenceIds.length
      ? `（${failedEvidenceIds.slice(0, 10).join(', ')}${failedEvidenceIds.length > 10 ? '…' : ''}）`
      : '';
  const text =
    `【MF証憑 自動マッチング】${attachedCount}件を仕訳に自動添付しました。` +
    (ambiguousCount > 0 ? `候補が複数の証憑が${ambiguousCount}件あります。` : '') +
    (failedCount > 0 ? `添付に失敗した証憑が${failedCount}件あります${idsPreview}。MF連携をご確認ください。` : '') +
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
    // awaiting_match（「MFへ送信」時点で未確定だった証憑）の毎時リトライ。
    // 見つかれば添付、見つからない間はMFへ送信せず待ち続ける（自動フォールバックは無し）。
    const awaiting = await processAwaitingMatch(accessToken);

    // MF接続が壊れている等でattach自体が失敗し続けても誰にも気づかれないと
    // 永久に見逃されるため、失敗件数も通知対象に含める。
    const attachFailed = (result.unmatched || []).filter((u) => u && u.reason === 'attach_failed');
    const awaitingFailed = (awaiting && awaiting.failed) || [];
    const failedCount = attachFailed.length + awaitingFailed.length;
    const failedEvidenceIds = attachFailed.map((u) => u.evidence_id).concat(awaitingFailed);

    const totalAttached = result.attached.length + awaiting.attached.length;
    let slackSent = false;
    const shouldNotify = SLACK_WEBHOOK_URL && (totalAttached > 0 || result.ambiguous.length > 0 || failedCount > 0);
    if (shouldNotify) {
      try {
        slackSent = await postToSlack(
          buildSlackMessage({
            attachedCount: totalAttached,
            ambiguousCount: result.ambiguous.length,
            failedCount,
            failedEvidenceIds,
          })
        );
      } catch (e) {
        slackSent = false;
      }
    }

    res.status(200).json({ ...result, awaiting_match: awaiting, slack_sent: slackSent });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: 'mf_auto_match_failed',
      message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
    });
  }
};
