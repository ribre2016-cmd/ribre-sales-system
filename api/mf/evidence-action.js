// POST /api/mf/evidence-action
// 台帳の証憑1件に対する操作をまとめたエンドポイント（Vercel Hobbyの12関数制限対応で統合）。
// body: { action: 'resend' | 'delete', evidence_id }
//  - resend: failed=再送、pending=メール取込の承認送信（Storageの控えからMFクラウドBoxへ送る）。
//    送信前に確実な仕訳(trySingleMatch)が見つかれば最初から添付済みで送り、MF API制約による
//    二重アップロード（未紐付け→後で添付で2ファイルになる）を避ける
//  - delete: pending/failed の行を削除（承認制の却下操作）。MF送信済みの行は削除不可
'use strict';

const { getAccessToken, postVoucher, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { fetchEvidenceById, fetchStorageFileBase64, updateEvidence, trySingleMatch } = require('./_lib/mf-match-core');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MF_STORAGE_BUCKET = 'mf-evidence';

function supabaseHeaders() {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        try {
          resolve(JSON.parse(req.body));
        } catch (e) {
          reject(e);
        }
      } else {
        resolve(req.body);
      }
      return;
    }
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

async function handleResend(res, evidence) {
  if (['failed', 'pending'].indexOf(evidence.status) < 0 || !evidence.storage_path) {
    res.status(400).json({ ok: false, error: 'not_resendable' });
    return;
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

  // 送信前に確実な仕訳が既に見つかれば、最初から添付済みで送る。
  // MFのvouchers APIは呼ぶたびに必ず新規ファイルを作成し、後から既存ファイルを仕訳に
  // 紐付け直すことも、未紐付けのファイル単体を削除することもできない
  // （openapi.yaml PostVouchersRequest/DeleteVouchersRequestで確認済み）。
  // そのため「未紐付けで送る→後でマッチングして添付」の順だと、MFのクラウドBoxに
  // 同じ内容のファイルが2件（未紐付け＋添付済み）残ってしまう。ここで先にマッチングを
  // 試すことで、その場で確定する分については二重送信を避ける。
  let matchedJournalId = null;
  try {
    matchedJournalId = await trySingleMatch({ accessToken, evidence });
  } catch (e) {
    // マッチング判定の失敗は送信自体を妨げない（従来通り未紐付けで送る）
  }

  try {
    const fileDataBase64 = await fetchStorageFileBase64(evidence.storage_path);
    const mfResult = await postVoucher({
      accessToken,
      journalId: matchedJournalId,
      fileName: evidence.file_name,
      fileDataBase64,
    });
    const fileId =
      (mfResult && Array.isArray(mfResult.voucher_file_ids) && mfResult.voucher_file_ids[0] && mfResult.voucher_file_ids[0].file_id) ||
      null;

    await updateEvidence(evidence.id, {
      status: matchedJournalId ? 'attached' : 'box_saved',
      journal_id: matchedJournalId || null,
      mf_file_id: fileId,
      error_message: null,
    });

    res.status(200).json({ ok: true, evidence_id: evidence.id, file_id: fileId, matched_journal_id: matchedJournalId });
  } catch (e) {
    try {
      await updateEvidence(evidence.id, {
        error_message: e && e.message ? String(e.message).slice(0, 500) : 'unknown_error',
      });
    } catch (updateErr) {
      // 記録失敗はログのみ
    }
    res.status(502).json({ ok: false, error: 'mf_send_failed' });
  }
}

// Storageの控えファイルを返す（台帳からのプレビュー用）。バケットは非公開のためサーバー経由で取得する。
async function handlePreview(res, evidence) {
  if (!evidence.storage_path) {
    res.status(400).json({ ok: false, error: 'no_storage_path' });
    return;
  }
  try {
    const fileRes = await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${evidence.storage_path}`, {
      headers: supabaseHeaders(),
    });
    if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`);
    const contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
    const arrayBuffer = await fileRes.arrayBuffer();
    res.status(200).json({
      ok: true,
      content_type: contentType,
      file_name: evidence.file_name || 'evidence',
      file_data: Buffer.from(arrayBuffer).toString('base64'),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'preview_failed' });
  }
}

async function handleDelete(res, evidence) {
  // attached(仕訳添付済み)のみ削除不可。box_savedはMF側で削除済みの後始末等のため削除可
  if (['pending', 'failed', 'box_saved'].indexOf(evidence.status) < 0) {
    res.status(400).json({ ok: false, error: 'not_deletable' });
    return;
  }

  try {
    // Storageの控えファイルも削除（失敗しても行削除は続行）
    if (evidence.storage_path) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${MF_STORAGE_BUCKET}/${evidence.storage_path}`, {
        method: 'DELETE',
        headers: supabaseHeaders(),
      }).catch(() => null);
    }

    const del = await fetch(`${SUPABASE_URL}/rest/v1/mf_evidence?id=eq.${encodeURIComponent(evidence.id)}`, {
      method: 'DELETE',
      headers: { ...supabaseHeaders(), Prefer: 'return=minimal' },
    });
    if (!del.ok) throw new Error(`HTTP ${del.status}`);

    res.status(200).json({ ok: true, evidence_id: evidence.id });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'delete_failed' });
  }
}

/* ---- 税理士向け共有: トークン検証つき短期署名URL発行（ログイン不要） ----
 * tax-share.html（税理士・未ログイン）が共有トークンを提示して呼ぶ。
 * app_settings(skey='tax_docs_index') の share.token と照合し、一致した
 * ユーザーのファイル一覧に対して24時間の署名URLをその場で発行して返す。
 * - トークンは128bit乱数（推測不可）。不一致・解除済み(token:null)なら404。
 * - 署名対象はそのユーザーのインデックスにあるキーのみ（任意ファイルへの署名は不可）。
 * - 共有解除（トークン墓標化）後は即座に新規アクセスが止まる。 */
const TAX_SHARE_SIGN_EXPIRES_SEC = 24 * 3600;

async function handleTaxShareList(res, shareToken) {
  const token = String(shareToken || '');
  if (!/^[a-f0-9]{16,64}$/.test(token)) {
    res.status(400).json({ ok: false, error: 'invalid_token' });
    return;
  }
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?skey=eq.tax_docs_index&select=user_email,value&limit=50`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    const hit = (Array.isArray(rows) ? rows : []).find((row) => {
      const share = row && row.value && row.value.data && row.value.data.share;
      return share && share.token === token;
    });
    if (!hit) {
      res.status(404).json({ ok: false, error: 'share_not_found' });
      return;
    }
    const files = (hit.value.data.files && typeof hit.value.data.files === 'object') ? hit.value.data.files : {};
    const keys = Object.keys(files).filter((k) => !files[k].del);
    const out = [];
    for (const key of keys) {
      const meta = files[key] || {};
      // 月はキーから取得（新形式 <uid>/YYYY-MM/... と旧形式 YYYY-MM/... の両対応）
      const segs = key.split('/');
      const month = /^\d{4}-\d{2}$/.test(segs[0]) ? segs[0] : (segs[1] || '');
      const signRes = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/tax-docs/${key}`, {
        method: 'POST',
        headers: supabaseHeaders(),
        body: JSON.stringify({ expiresIn: TAX_SHARE_SIGN_EXPIRES_SEC }),
      });
      if (!signRes.ok) continue;
      const signData = await signRes.json().catch(() => null);
      if (!signData || !signData.signedURL) continue;
      const dlName = month + '_' + (meta.name || key);
      out.push({
        name: meta.name || key,
        size: meta.size || 0,
        ts: meta.ts || 0,
        month,
        url: `${SUPABASE_URL}/storage/v1${signData.signedURL}&download=${encodeURIComponent(dlName)}`,
      });
    }
    out.sort((a, b) => (a.month !== b.month ? (a.month < b.month ? 1 : -1) : (b.ts || 0) - (a.ts || 0)));
    res.status(200).json({ ok: true, v: 2, expiresInSec: TAX_SHARE_SIGN_EXPIRES_SEC, files: out });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'share_list_failed' });
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch (e) {
    res.status(400).json({ ok: false, error: 'invalid_json' });
    return;
  }

  // 共有一覧はトークン自体が認可情報（ログイン不要）。先に処理する。
  if (body && body.action === 'tax_share_list') {
    await handleTaxShareList(res, body.share_token);
    return;
  }

  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const action = body && body.action;
  const evidenceId = body && body.evidence_id;
  if (!evidenceId || ['resend', 'delete', 'preview'].indexOf(action) < 0) {
    res.status(400).json({ ok: false, error: 'invalid_request' });
    return;
  }

  let evidence;
  try {
    evidence = await fetchEvidenceById(evidenceId);
  } catch (e) {
    res.status(500).json({ ok: false, error: 'evidence_fetch_failed' });
    return;
  }
  if (!evidence) {
    res.status(404).json({ ok: false, error: 'evidence_not_found' });
    return;
  }

  if (action === 'resend') {
    await handleResend(res, evidence);
  } else if (action === 'preview') {
    await handlePreview(res, evidence);
  } else {
    await handleDelete(res, evidence);
  }
};
