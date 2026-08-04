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
  // パスは必ず /api/v3 から始める。付け忘れるとMFのAPIではなく通常のWebに当たり、
  // Cloudflareが403のHTML（Attention Required!）を返す。スコープ不足の403と紛らわしい。
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* そのまま */ }
  // HTMLが返ってきたらAPIではなくWeb側に当たっている（＝呼び出し側のパスの誤り）。
  // スコープ不足の403はJSONで返るので、この2つを混同しないよう分けて持つ。
  const isHtml = /^\s*<(!doctype|html)/i.test(text);
  return {
    status: res.status, ok: res.ok, json, isHtml,
    raw: isHtml ? '(HTMLが返っています＝APIのURLが違う可能性。スコープ不足ではありません)' : text.slice(0, 300),
  };
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
        : (r.isHtml ? '× 呼び出し側の不具合（APIのURLが違う）。権限の問題ではありません'
          : (r.status === 403 ? '× 権限が足りない（再連携が反映されていない可能性）' : '× 失敗')),
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
  // 本番で動いている fetchUnjournalizedTransactions と同じく
  // journalizing_statuses を必ず指定する。指定せず全件を取ろうとするとMFが500を返した（実測）。
  const end = new Date();
  const start = new Date(end.getTime() - 90 * 24 * 3600 * 1000);
  const iso = (d) => d.toISOString().slice(0, 10);
  const period = `${iso(start)} 〜 ${iso(end)}`;

  async function fetchByStatus(status, perPage) {
    const p = new URLSearchParams({
      start_date: iso(start), end_date: iso(end),
      per_page: String(perPage), page: '1',
    });
    p.append('journalizing_statuses', status);
    return mfGet(`/transactions?${p.toString()}`, accessToken);
  }

  const perStatus = {};
  let allSampled = [];
  for (const st of ['none', 'registered', 'new_voucher_attached']) {
    try {
      const r = await fetchByStatus(st, 200);
      const list = (r.json && r.json.transactions) || [];
      perStatus[st] = {
        status: r.status, ok: r.ok, 件数: list.length,
        証憑が紐付いている件数: list.filter((t) => t && Array.isArray(t.voucher_file_ids) && t.voucher_file_ids.length > 0).length,
        エラー本文: r.ok ? undefined : r.raw,
      };
      if (r.ok) allSampled = allSampled.concat(list);
    } catch (e) {
      perStatus[st] = { ok: false, message: String(e && e.message || e) };
    }
  }

  const anyOk = Object.keys(perStatus).some((k) => perStatus[k].ok);
  const hasField = allSampled.some((t) => t && Object.prototype.hasOwnProperty.call(t, 'voucher_file_ids'));
  const withVoucher = allSampled.filter((t) => t && Array.isArray(t.voucher_file_ids) && t.voucher_file_ids.length > 0);

  out.results.P7_A_voucher_file_ids = {
    判定: !anyOk ? '× 取得失敗'
      : (!hasField ? '× 応答に voucher_file_ids が無い（⑩は台帳からの逆引きに切り替える）'
        : (withVoucher.length ? '○ 実データで埋まっている（⑩をこの判定で作れる）'
          : '△ 項目はあるが、直近90日で紐付きが1件も無い（⑩は台帳からの逆引きに切り替える）')),
    期間: period,
    仕訳化ステータス別: perStatus,
    見た明細の合計: allSampled.length,
    証憑が紐付いている件数: withVoucher.length,
    サンプル: allSampled.slice(0, 5).map((t) => ({
      日付: t.date, 金額: t.value, 収支: t.side,
      内容: String(t.content || '').slice(0, 24),
      仕訳化: t.journalizing_status,
      証憑数: Array.isArray(t.voucher_file_ids) ? t.voucher_file_ids.length : '(項目なし)',
    })),
  };

  // ---- 提案の診断: なぜ勘定科目が入らないのかを実データで見る ----
  // 画面に「該当する提案はありません」しか出ない原因を切り分けるため。
  try {
    const {
      buildSuggestIndex, suggestForContent, comboSideForTransaction,
      remarkKey, journalCombos, fetchJournalsForSuggest,
    } = require('./_lib/suggest-core');
    const { fetchJournals } = require('./_lib/mf-match-core');
    const { fetchUnjournalizedTransactions } = require('./_lib/mf-client');

    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';
    // 対象は「先月」。7月分を見たいので、当月ではなく直近90日から拾う
    const from = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);

    const txs = await fetchUnjournalizedTransactions({
      accessToken, startDate: from, endDate: today,
    });
    const dates = txs.map((t) => String(t.date || '')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const endDate = dates.length ? dates[dates.length - 1] : today;

    // 本体と同じ経路で取る（会計期間をまたぐと400になるため期ごとに分割）
    const termsRes = await mfGet('/term_settings', accessToken);
    const terms = (termsRes.json && termsRes.json.term_settings) || [];
    const journals = await fetchJournalsForSuggest({ accessToken, endDate, terms, fetchJournals });
    const index = buildSuggestIndex(journals);

    // 索引に入った摘要の中身を少しだけ見る（何が材料になっているか）
    const remarkKeys = Array.from(index.byRemark.keys());
    // 仕訳のうち、借方・貸方どちらかが1本に定まったもの（＝材料にできたもの）
    let usable = 0, multi = 0;
    journals.forEach((j) => {
      const c = journalCombos(j);
      if (c.debit || c.credit) usable++; else multi++;
    });

    const sample = txs.slice(0, 12).map((t) => {
      const rk = remarkKey(t.content);
      const side = comboSideForTransaction(t.side);
      const slot = index.byRemark.get(rk);
      const m = slot && slot[side];
      const s = suggestForContent(index, t.content, t.side);
      return {
        摘要: t.content,
        収支: t.side,
        見る側: side === 'credit' ? '貸方' : '借方',
        同じ摘要の仕訳が索引にあるか: slot ? 'ある' : 'ない',
        その側の候補数: m ? m.size : 0,
        提案: s ? (s.account_name + '／' + (s.tax_name || '-') + '／' + (s.invoice_kind || '-')
          + '（' + s.match_kind + '・' + s.count + '/' + s.total + '）') : '提案なし',
      };
    });

    out.results.suggest_diag = {
      判定: sample.some((x) => x['提案'] !== '提案なし') ? '○ 提案が出ている' : '× どれも提案が出ていない',
      材料の終わり: endDate,
      会計期間: terms.map((t) => t.start_date + '〜' + t.end_date),
      材料の仕訳件数: journals.length,
      うち材料にできた仕訳: usable,
      うち複合仕訳などで使えなかった仕訳: multi,
      索引に入った摘要の種類: remarkKeys.length,
      索引の摘要の例: remarkKeys.slice(0, 15),
      未仕訳の明細: txs.length,
      明細ごとの結果: sample,
    };
  } catch (e) {
    out.results.suggest_diag = { 判定: '× 例外', message: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 400) };
  }

  res.status(200).json(out);
};
