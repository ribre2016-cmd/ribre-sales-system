// POST /api/mf/evidence-action
// 台帳の証憑1件に対する操作をまとめたエンドポイント（Vercel Hobbyの12関数制限対応で統合）。
// body: { action: 'resend' | 'delete', evidence_id }
//  - resend: failed=再送、pending/awaiting_match=承認送信。送信前に確実な仕訳
//    (trySingleMatch)が見つかれば最初から添付済みで送る。見つからなければMFへは
//    まだ送らずawaiting_match（マッチ待ち）のまま保留し、日次のprocessAwaitingMatch
//    （auto-matchのcron・手動の「マッチング実行」）が見つかるまで再チェックし続ける
//    （MF API制約による二重アップロード＝未紐付け→後で添付で2ファイルになる、を避ける
//    ため。自動フォールバックは無し＝ユーザーが判断して手動対応する運用）
//  - delete: pending/failed/awaiting_match の行を削除（承認制の却下操作）。MF送信済みの行は削除不可
'use strict';

const crypto = require('crypto');
const { getAccessToken, NotConnectedError } = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');
const { fetchEvidenceById, updateEvidence, trySingleMatch, attachEvidenceToJournal } = require('./_lib/mf-match-core');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const MF_STORAGE_BUCKET = 'mf-evidence';
// 証憑の再送・削除・プレビューができる社内メンバー。
// api/mf/tax-workspace.js の MEMBER_EMAILS、supabase_mf_owner_rls.sql の許可リストと同じ2件。
const MEMBER_EMAILS = ['ribre2016@gmail.com', 'k.sado@ribre.co.jp'];
function isMemberEmail(userEmail) {
  const e = String(userEmail || '').trim().toLowerCase();
  if (!e) return false;
  return MEMBER_EMAILS.some((m) => m.toLowerCase() === e);
}
const MAX_BODY_BYTES = 1 * 1024 * 1024; // 1MB（resend/delete/previewはevidence_idのみでファイル本体を含まない）

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
        if (Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) {
          const err = new Error('payload_too_large');
          err.tooLarge = true;
          reject(err);
          return;
        }
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
    let bytes = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        aborted = true;
        const err = new Error('payload_too_large');
        err.tooLarge = true;
        reject(err);
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (aborted) return;
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
  if (['failed', 'pending', 'awaiting_match'].indexOf(evidence.status) < 0 || !evidence.storage_path) {
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
    // マッチング判定の失敗はawaiting_matchへのフォールバックを妨げない
  }

  if (!matchedJournalId) {
    // その場では見つからなかった。即座に未紐付けで送ると上記の二重アップロード問題が
    // 起きるため、まだMFへは送らずawaiting_match（マッチ待ち）として保留する。
    // 日次のマッチング処理(processAwaitingMatch)が見つかるまで再チェックし続ける
    // （自動フォールバックは無し。長期間見つからない場合はユーザーが判断して手動対応する）。
    try {
      await updateEvidence(evidence.id, {
        status: 'awaiting_match',
        approved_at: evidence.approved_at || new Date().toISOString(),
        error_message: null,
      });
      res.status(200).json({ ok: true, evidence_id: evidence.id, file_id: null, matched_journal_id: null, awaiting_match: true });
    } catch (e) {
      res.status(502).json({ ok: false, error: 'evidence_update_failed' });
    }
    return;
  }

  // 実送信はmf-match-coreのattachEvidenceToJournalに一本化する。内部でDB先行claim
  // （status=eq.<fromStatus>の条件付きPATCH）を行うため、日次cronのprocessAwaitingMatch
  // や「マッチング実行」ボタンとこの再送ボタンが同時に走っても、あるいはこの再送ボタンが
  // 二重クリックされても、MFへの送信そのものが二重に起きることは構造的にない。
  try {
    const result = await attachEvidenceToJournal({
      accessToken,
      evidence,
      journalId: matchedJournalId,
      fromStatus: evidence.status,
    });
    if (!result.claimed) {
      // claim失敗＝他プロセスが先にこの証憑を処理済み。二重送信ではなく正常系のスキップ。
      res.status(200).json({ ok: true, evidence_id: evidence.id, file_id: null, matched_journal_id: matchedJournalId, already_attached: true });
      return;
    }
    res.status(200).json({ ok: true, evidence_id: evidence.id, file_id: result.file_id || null, matched_journal_id: matchedJournalId });
  } catch (e) {
    // Storage取得/MF送信の失敗はattachEvidenceToJournal内部でfromStatusへ復帰済み
    // （error_messageも記録済み）なので、ここでは応答のみ返す。
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
  // attached(仕訳添付済み)のみ削除不可。box_savedはMF側で削除済みの後始末等のため削除可。
  // awaiting_matchはまだMFへ何も送っていないためいつでも削除可
  if (['pending', 'failed', 'awaiting_match', 'box_saved'].indexOf(evidence.status) < 0) {
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

// タイミング攻撃対策: 生の文字列比較(===)は先頭バイトの不一致で早期リターンするため、
// 応答時間差からトークンを1バイトずつ推測されうる。両者をSHA-256でハッシュ化した上で
// crypto.timingSafeEqualを使い、比較にかかる時間が入力に依存しないようにする
// （ハッシュ化により長さも常に32byteへ揃うため、生成トークンの長さ違いでも安全に比較できる）。
function safeTokenEquals(a, b) {
  const ha = crypto.createHash('sha256').update(String(a == null ? '' : a)).digest();
  const hb = crypto.createHash('sha256').update(String(b == null ? '' : b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ダウンロード済みの記録は、ファイル一覧(tax_docs_index)とは**別の行**に持つ。
// 一覧の行はオーナー側のブラウザがまるごと上書き保存するため、ログイン不要な
// このエンドポイントが同じ行を書くと、書き込みが衝突して一覧を壊す恐れがある。
// 行を分ければ両者が同じ行に触れないので、その事故が起きない。
const TAX_DOWNLOADS_SKEY = 'tax_docs_downloads';

// 共有トークンから、そのトークンを持つapp_settingsの行（＝オーナー）を探す
async function findShareOwnerRow(token) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/app_settings?skey=eq.tax_docs_index&user_email=in.(${MEMBER_EMAILS.map(encodeURIComponent).join(',')})&select=user_email,value&limit=50`,
    { headers: supabaseHeaders() }
  );
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const rows = await r.json();
  return (Array.isArray(rows) ? rows : []).find((row) => {
    const share = row && row.value && row.value.data && row.value.data.share;
    return share && share.token && safeTokenEquals(share.token, token);
  }) || null;
}

// そのオーナーのダウンロード記録 { <ファイルkey>: 最初にダウンロードされた時刻 } を読む
async function fetchDownloadMarks(userEmail) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?select=value&user_email=eq.${encodeURIComponent(userEmail)}` +
      `&skey=eq.${TAX_DOWNLOADS_SKEY}&limit=1`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) return {};
    const rows = await r.json();
    const v = Array.isArray(rows) && rows[0] && rows[0].value;
    const data = v && v.data;
    return data && typeof data === 'object' ? data : {};
  } catch (e) {
    return {};
  }
}

// 税理士がファイル名をクリックしたときに呼ばれる。ダウンロード時刻を記録するだけ。
// ログイン不要（共有リンクを知っている人＝税理士が使う）。ファイルの中身も一覧も変更しない。
async function handleTaxShareMarkDownloaded(res, shareToken, key) {
  const token = String(shareToken || '');
  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    res.status(400).json({ ok: false, error: 'invalid_token' });
    return;
  }
  const fileKey = String(key || '');
  if (!fileKey || fileKey.length > 512) {
    res.status(400).json({ ok: false, error: 'invalid_key' });
    return;
  }
  try {
    const hit = await findShareOwnerRow(token);
    if (!hit) {
      res.status(404).json({ ok: false, error: 'share_not_found' });
      return;
    }
    // 共有中のファイルとして実在するkeyだけを受け付ける（任意の文字列を書かせない）
    const files = (hit.value.data.files && typeof hit.value.data.files === 'object') ? hit.value.data.files : {};
    if (!files[fileKey] || files[fileKey].del) {
      res.status(404).json({ ok: false, error: 'file_not_found' });
      return;
    }
    const marks = await fetchDownloadMarks(hit.user_email);
    // 最初にダウンロードされた時刻を残す（2回目以降は上書きしない）
    if (marks[fileKey]) {
      res.status(200).json({ ok: true, dl: marks[fileKey], already: true });
      return;
    }
    const now = Date.now();
    marks[fileKey] = now;
    const up = await fetch(`${SUPABASE_URL}/rest/v1/app_settings?on_conflict=user_email,skey`, {
      method: 'POST',
      headers: Object.assign({}, supabaseHeaders(), { Prefer: 'resolution=merge-duplicates' }),
      body: JSON.stringify([{ user_email: hit.user_email, skey: TAX_DOWNLOADS_SKEY, value: { data: marks, ts: now } }]),
    });
    if (!up.ok) {
      res.status(500).json({ ok: false, error: 'mark_failed' });
      return;
    }
    res.status(200).json({ ok: true, dl: now });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'mark_failed' });
  }
}

async function handleTaxShareList(res, shareToken) {
  const token = String(shareToken || '');
  // 生成トークンは常に128bit(=32文字)の16進乱数。上限64は将来の桁数変更に対する余裕。
  if (!/^[a-f0-9]{32,64}$/.test(token)) {
    res.status(400).json({ ok: false, error: 'invalid_token' });
    return;
  }
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/app_settings?skey=eq.tax_docs_index&user_email=in.(${MEMBER_EMAILS.map(encodeURIComponent).join(',')})&select=user_email,value&limit=50`,
      { headers: supabaseHeaders() }
    );
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const rows = await r.json();
    const hit = (Array.isArray(rows) ? rows : []).find((row) => {
      const share = row && row.value && row.value.data && row.value.data.share;
      return share && share.token && safeTokenEquals(share.token, token);
    });
    if (!hit) {
      res.status(404).json({ ok: false, error: 'share_not_found' });
      return;
    }
    const files = (hit.value.data.files && typeof hit.value.data.files === 'object') ? hit.value.data.files : {};
    const keys = Object.keys(files).filter((k) => !files[k].del);
    const marks = await fetchDownloadMarks(hit.user_email);
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
        key,
        name: meta.name || key,
        size: meta.size || 0,
        ts: meta.ts || 0,
        month,
        dl: marks[key] || 0, // 0 = まだダウンロードされていない
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
    if (e && e.tooLarge) {
      res.status(413).json({ ok: false, error: 'payload_too_large' });
      return;
    }
    res.status(400).json({ ok: false, error: 'invalid_json' });
    return;
  }

  // 共有一覧はトークン自体が認可情報（ログイン不要）。先に処理する。
  if (body && body.action === 'tax_share_list') {
    await handleTaxShareList(res, body.share_token);
    return;
  }
  if (body && body.action === 'tax_share_mark_downloaded') {
    await handleTaxShareMarkDownloaded(res, body.share_token, body.key);
    return;
  }

  const user = await verifySupabaseToken(req);
  if (!user) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  /* ⚠ ログイン済みかどうかだけでは足りない（2026-08-03のセキュリティレビューで判明）。
   * このSupabaseプロジェクトは他アプリと共用で、さらに税理士ワークスペースの追加により
   * **社外の税理士もログインアカウントを持つ**ようになった。
   * 証憑の再送・削除・プレビューは社内メンバーだけの操作なので、必ずメールで絞る。
   * 出典: supabase_mf_owner_rls.sql の会員許可リストと同じ2件。 */
  if (!isMemberEmail(user.email)) {
    res.status(403).json({ ok: false, error: 'member_only' });
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
