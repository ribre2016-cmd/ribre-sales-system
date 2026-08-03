// GET /api/mf/measure
// Phase 7 の未確認事項(P7-A/C/D)を実測するための一時的な診断エンドポイント。
// 設計書: docs/TAX_WORKSPACE_PHASE7_PLAN.md §13 / docs/TAX_WORKSPACE_PHASE7_MEASURE.md
//
// **読み取りのみ。MFにもDBにも一切書き込まない。**
// 実測が終わったら、このファイルと mf-measure.html は削除してよい。
//
// 認可: ログイン済み かつ RIBREメンバーのメールのみ（税理士には見せない）。
'use strict';

const {
  getAccessToken,
  NotConnectedError,
  MF_ACCOUNTING_API_BASE,
  mfFetch,
} = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

const MEMBER_EMAILS = ['ribre2016@gmail.com', 'k.sado@ribre.co.jp'];

async function mfGet(path, accessToken) {
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* そのまま */ }
  return { status: res.status, ok: res.ok, json, raw: text.slice(0, 400) };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifySupabaseToken(req);
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
  const email = String(user.email || '').toLowerCase();
  if (MEMBER_EMAILS.indexOf(email) < 0) { res.status(403).json({ error: 'forbidden' }); return; }

  const out = { measured_at: new Date().toISOString(), results: {} };

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    if (e instanceof NotConnectedError) {
      res.status(200).json({ ok: false, error: 'not_connected', hint: 'MF連携が未接続です' });
      return;
    }
    res.status(200).json({ ok: false, error: 'token_failed', message: String(e && e.message || e) });
    return;
  }

  // ---- P7-D: report.read が使えるか（⑨月次チェックの前提） ----
  try {
    const r = await mfGet('/reports/transition_pl?type=monthly&fiscal_year=2026&start_month=3&end_month=7', accessToken);
    const rows = (r.json && r.json.rows) || [];
    out.results.P7_D_report_read = {
      status: r.status,
      ok: r.ok,
      判定: r.ok ? '○ 使える（⑨月次チェックを作れる）'
        : (r.status === 403 ? '× 権限が足りない（再連携が反映されていない可能性）' : '× 失敗'),
      推移表の行数: rows.length,
      先頭の行名: rows.slice(0, 3).map((x) => x && x.name),
      エラー本文: r.ok ? undefined : r.raw,
    };
  } catch (e) {
    out.results.P7_D_report_read = { 判定: '× 例外', message: String(e && e.message || e) };
  }

  // ---- offices / term_settings（会計年度をハードコードしないため） ----
  try {
    const r = await mfGet('/term_settings', accessToken);
    const ts = (r.json && r.json.term_settings) || [];
    out.results.offices_read = {
      status: r.status,
      ok: r.ok,
      判定: r.ok ? '○ 使える' : '× 失敗',
      会計年度の件数: ts.length,
      最新: ts[0] ? { fiscal_year: ts[0].fiscal_year, start: ts[0].start_date, end: ts[0].end_date, tax_method: ts[0].tax_method } : null,
      エラー本文: r.ok ? undefined : r.raw,
    };
  } catch (e) {
    out.results.offices_read = { 判定: '× 例外', message: String(e && e.message || e) };
  }

  // ---- P7-C: is_manual の連携サービスがあるか（⑦現金払いの前提） ----
  try {
    const r = await mfGet('/connected_accounts', accessToken);
    const list = (r.json && r.json.connected_accounts) || [];
    const manual = list.filter((x) => x && x.is_manual);
    out.results.P7_C_manual_account = {
      status: r.status,
      ok: r.ok,
      判定: !r.ok ? '× 取得失敗'
        : (manual.length ? '○ 手動管理の口座がある（⑦の受け皿になる）'
          : '△ 手動管理の口座が無い（⑦を作るならMFの画面で1つ作る必要がある）'),
      連携サービス数: list.length,
      手動管理の口座: manual.map((x) => x.name),
      全サービス名: list.map((x) => x.name),
      エラー本文: r.ok ? undefined : r.raw,
    };
  } catch (e) {
    out.results.P7_C_manual_account = { 判定: '× 例外', message: String(e && e.message || e) };
  }

  // ---- P7-A: transactions の voucher_file_ids が実データで埋まるか（⑩の前提） ----
  // 直近90日の明細を最大500件見て、証憑が紐付いている件数を数える。
  try {
    const end = new Date();
    const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
    const iso = (d) => d.toISOString().slice(0, 10);
    const r = await mfGet(
      `/transactions?start_date=${iso(start)}&end_date=${iso(end)}&per_page=500&page=1`,
      accessToken
    );
    const list = (r.json && r.json.transactions) || [];
    const hasField = list.some((t) => t && Object.prototype.hasOwnProperty.call(t, 'voucher_file_ids'));
    const withVoucher = list.filter((t) => t && Array.isArray(t.voucher_file_ids) && t.voucher_file_ids.length > 0);
    const byStatus = {};
    list.forEach((t) => { const k = (t && t.journalizing_status) || '(なし)'; byStatus[k] = (byStatus[k] || 0) + 1; });
    out.results.P7_A_voucher_file_ids = {
      status: r.status,
      ok: r.ok,
      判定: !r.ok ? '× 取得失敗'
        : (!hasField ? '× 応答に voucher_file_ids が無い（⑩は台帳からの逆引きに切り替える）'
          : (withVoucher.length ? '○ 実データで埋まっている（⑩をこの判定で作れる）'
            : '△ 項目はあるが、直近90日で紐付きが1件も無い（判定に使えるか要検討）')),
      期間: `${iso(start)} 〜 ${iso(end)}`,
      取得件数: list.length,
      証憑が紐付いている件数: withVoucher.length,
      仕訳化ステータスの内訳: byStatus,
      サンプル: list.slice(0, 3).map((t) => ({
        日付: t.date, 金額: t.value, 収支: t.side,
        内容: String(t.content || '').slice(0, 24),
        仕訳化: t.journalizing_status,
        証憑数: Array.isArray(t.voucher_file_ids) ? t.voucher_file_ids.length : '(項目なし)',
      })),
      エラー本文: r.ok ? undefined : r.raw,
    };
  } catch (e) {
    out.results.P7_A_voucher_file_ids = { 判定: '× 例外', message: String(e && e.message || e) };
  }

  res.status(200).json(out);
};
