// POST /api/mf/measure-undo
// Phase 7 の P7-B（登録の取り消し）を実測する一時的な診断エンドポイント。
// 設計書: docs/TAX_WORKSPACE_PHASE7_PLAN.md §5.2 / docs/TAX_WORKSPACE_PHASE7_MEASURE.md 作業4
//
// ⚠ **このファイルだけは本番の帳簿に書き込む。** 利用者の明示的な許可を得て 2026-08-05 に実行。
//    確かめたいこと:
//      (1) DELETE /journals/{id} が実際に効くか
//      (2) 明細から作った仕訳を消したとき、明細が registered から none（未仕訳）に戻るか
//    (2) が戻らないなら ★E（登録の取り消し）は作らない。設計書 §5.2 のとおり。
//
// 危険なのは「消せたのに明細が registered のまま」＝**帳簿から1件が黙って消える**状態。
// これを踏まないために2段階にする:
//   段階1: どの明細にも紐付かない1円の仕訳を作って消す（既存データに一切触れない）
//          → ここで消せなければ **段階2は実行しない**
//   段階2: 実在の未仕訳明細1件で同じことをする（ここが本題）
//
// 消す前に必ず GET /journals/{id} で中身を控える（元国税のレビュー条件）。
// 消せなかった場合は、残った仕訳のIDを応答の先頭に出す。手で消せるようにするため。
//
// 実測が終わったらこのファイルは削除してよい。
'use strict';

const {
  getAccessToken,
  NotConnectedError,
  MF_ACCOUNTING_API_BASE,
  mfFetch,
  fetchUnjournalizedTransactions,
} = require('./_lib/mf-client');
const { verifySupabaseToken } = require('../openai/_lib/require-auth');

const MEMBER_EMAILS = ['ribre2016@gmail.com', 'k.sado@ribre.co.jp'];

// 手が滑って実行されないよう、この合言葉が本文に無ければ何もしない
const CONFIRM_WORD = 'P7B-WRITE-AND-DELETE';

// 実測に使う勘定科目。**内容の分からない入出金を一時的に置くための科目**を選ぶ。
// 万一 DELETE が効かずに仕訳が残っても、誤った科目で記帳されたことにはならず、
// 税理士があとで振り替えれば済む形にしておく。
const ACCOUNT_FOR_PAYMENT = '仮払金';   // 支出（お金が出た）側の相手科目
const ACCOUNT_FOR_RECEIPT = '仮受金';   // 収入（お金が入った）側の相手科目
const TAX_NOT_TARGET = '対象外';

async function mfJson(method, path, accessToken, body) {
  const opt = {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  };
  if (body !== undefined) {
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const res = await mfFetch(`${MF_ACCOUNTING_API_BASE}/api/v3${path}`, opt);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 204など本文が無いことがある */ }
  return { status: res.status, ok: res.ok, json, raw: text.slice(0, 300) };
}

// 名前から勘定科目IDを引く（IDをハードコードしない。事業者ごとに違うため）
async function findAccountId(accessToken, name) {
  for (let page = 1; page <= 10; page += 1) {
    const r = await mfJson('GET', `/accounts?per_page=100&page=${page}`, accessToken);
    if (!r.ok) return { error: `accounts HTTP ${r.status}`, raw: r.raw };
    const list = (r.json && r.json.accounts) || [];
    const hit = list.find((a) => a && a.name === name && a.available !== false);
    if (hit) return { id: hit.id, name: hit.name, tax_id: hit.tax_id || null };
    if (list.length < 100) break;
  }
  return { error: `勘定科目「${name}」が見つからない` };
}

async function findTaxId(accessToken, name) {
  for (let page = 1; page <= 10; page += 1) {
    const r = await mfJson('GET', `/taxes?per_page=100&page=${page}`, accessToken);
    if (!r.ok) return null;
    const list = (r.json && r.json.taxes) || [];
    const hit = list.find((t) => t && t.name === name);
    if (hit) return hit.id;
    if (list.length < 100) break;
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'method_not_allowed' });
    return;
  }
  const user = await verifySupabaseToken(req);
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }
  const email = String(user.email || '').toLowerCase();
  if (MEMBER_EMAILS.indexOf(email) < 0) { res.status(403).json({ error: 'forbidden' }); return; }

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  if (body.confirm !== CONFIRM_WORD) {
    res.status(400).json({
      ok: false,
      error: 'confirm_required',
      hint: `本番の帳簿に書き込みます。実行するなら {"confirm":"${CONFIRM_WORD}"} を送ってください`,
    });
    return;
  }

  const out = {
    注意: '本番の帳簿に1円の仕訳を作って消します。残ってしまった場合は 手で消す必要がある仕訳 に出ます',
    measured_at: new Date().toISOString(),
    手で消す必要がある仕訳: [],
    段階1_どの明細にも紐付かない仕訳: {},
    段階2_明細から作った仕訳: {},
  };

  let accessToken;
  try {
    accessToken = await getAccessToken();
  } catch (e) {
    res.status(200).json({
      ok: false,
      error: e instanceof NotConnectedError ? 'not_connected' : 'token_failed',
      message: String((e && e.message) || e),
    });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  // ---- 下ごしらえ: 使う勘定科目と税区分のIDを引く ----
  const accPay = await findAccountId(accessToken, ACCOUNT_FOR_PAYMENT);
  const accRcv = await findAccountId(accessToken, ACCOUNT_FOR_RECEIPT);
  const taxNotTarget = await findTaxId(accessToken, TAX_NOT_TARGET);
  out.使う勘定科目 = {
    支出側: accPay.error ? `× ${accPay.error}` : `${accPay.name}`,
    収入側: accRcv.error ? `× ${accRcv.error}` : `${accRcv.name}`,
    税区分: taxNotTarget ? TAX_NOT_TARGET : '(見つからないので指定しない)',
  };
  if (accPay.error || accRcv.error) {
    out.判定 = '× 実測できない（勘定科目が引けない）。帳簿には何も書いていません';
    res.status(200).json(out);
    return;
  }

  /* ===== 段階1: どの明細にも紐付かない1円の仕訳を作って消す =====
   * 仮払金 1円 / 仮受金 1円。損益に影響せず、既存のデータにも触れない。
   * ここで消せなければ段階2（実在の明細）は絶対に実行しない。 */
  const s1 = out.段階1_どの明細にも紐付かない仕訳;
  let s1JournalId = null;
  try {
    const branch = {
      remark: 'P7B 取り消しの実測（すぐ消します）',
      debitor: { value: 1, account_id: accPay.id },
      creditor: { value: 1, account_id: accRcv.id },
    };
    if (taxNotTarget) {
      branch.debitor.tax_id = taxNotTarget;
      branch.creditor.tax_id = taxNotTarget;
    }
    const created = await mfJson('POST', '/journals', accessToken, {
      journal: {
        transaction_date: today,
        journal_type: 'journal_entry',
        memo: 'P7B 取り消しの実測（すぐ消します）',
        branches: [branch],
      },
    });
    s1.作成 = { status: created.status, 判定: created.ok ? '○ 作れた' : '× 作れなかった', エラー本文: created.ok ? undefined : created.raw };
    s1JournalId = created.json && created.json.journal && created.json.journal.id;
    if (!s1JournalId) {
      s1.判定 = '× 仕訳IDが取れないので、これ以上は進めない';
      out.判定 = '× 段階1で止まった。段階2（実在の明細）は実行していません';
      res.status(200).json(out);
      return;
    }
    out.手で消す必要がある仕訳.push({ 段階: 1, journal_id: s1JournalId, 内容: '仮払金/仮受金 1円' });

    // 消す前に中身を控える（元国税のレビュー条件）
    const before = await mfJson('GET', `/journals/${encodeURIComponent(s1JournalId)}`, accessToken);
    s1.消す前の控え = { status: before.status, 中身: before.json || before.raw };

    const del = await mfJson('DELETE', `/journals/${encodeURIComponent(s1JournalId)}`, accessToken);
    s1.削除 = { status: del.status, 判定: del.ok ? '○ 消せた' : '× 消せなかった', エラー本文: del.ok ? undefined : del.raw };

    // 本当に消えたかを取り直して確かめる（204が返っても実際は残っている、を疑う）
    const after = await mfJson('GET', `/journals/${encodeURIComponent(s1JournalId)}`, accessToken);
    const gone = after.status === 404 || after.status === 400;
    s1.消したあとの取り直し = { status: after.status, 判定: gone ? '○ 消えている' : '× まだ残っている' };
    s1.判定 = del.ok && gone ? '○ DELETE /journals/{id} は効く' : '× 効かない';
    if (gone) out.手で消す必要がある仕訳 = out.手で消す必要がある仕訳.filter((x) => x.journal_id !== s1JournalId);

    if (!(del.ok && gone)) {
      out.判定 = '× DELETEが効かない。★E（登録の取り消し）は作れない。段階2は実行していません';
      res.status(200).json(out);
      return;
    }
  } catch (e) {
    s1.判定 = '× 例外';
    s1.message = String((e && e.message) || e);
    out.判定 = '× 段階1で例外。段階2は実行していません';
    res.status(200).json(out);
    return;
  }

  /* ===== 段階2: 実在の未仕訳明細1件で同じことをする（ここが本題） =====
   * 危険なのは「仕訳は消えたのに明細が registered のまま」。
   * その明細は未仕訳一覧にも仕訳帳にも現れず、帳簿から黙って1件抜ける。
   * 起きた場合は 明細を手当てする必要がある に出す。 */
  const s2 = out.段階2_明細から作った仕訳;
  try {
    const from = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const txs = await fetchUnjournalizedTransactions({ accessToken, startDate: from, endDate: today });
    let tx = null;
    if (body.transaction_id) {
      tx = txs.find((t) => t && t.id === String(body.transaction_id)) || null;
      if (!tx) {
        s2.判定 = '× 指定された明細が未仕訳一覧に無い';
        out.判定 = '△ 段階1は○。段階2は明細が見つからず未実施';
        res.status(200).json(out);
        return;
      }
    } else {
      // 指定が無ければ**金額がいちばん小さい**明細を選ぶ（設計書の手順1）
      const sorted = txs.filter((t) => t && Number(t.value) > 0)
        .sort((a, b) => Number(a.value) - Number(b.value));
      tx = sorted[0] || null;
    }
    if (!tx) {
      s2.判定 = '× 未仕訳の明細が1件も無いので実測できない';
      out.判定 = '△ 段階1は○。段階2は未実施';
      res.status(200).json(out);
      return;
    }

    s2.使った明細 = {
      id: tx.id, 日付: tx.date, 金額: tx.value, 収支: tx.side,
      内容: tx.content, 実行前のステータス: tx.journalizing_status,
    };
    if (tx.journalizing_status !== 'none') {
      s2.判定 = '× 未仕訳ではない明細だったので中止した';
      out.判定 = '△ 段階1は○。段階2は未実施';
      res.status(200).json(out);
      return;
    }

    const isPayment = String(tx.side) !== 'income' && String(tx.side) !== 'INCOME';
    const acc = isPayment ? accPay : accRcv;
    const payload = {
      transaction_id: tx.id,
      account_id: acc.id,
      invoice_kind: 'INVOICE_KIND_NOT_TARGET',
      memo: 'P7B 取り消しの実測（すぐ消します）',
    };
    if (taxNotTarget) payload.tax_id = taxNotTarget;

    const created = await mfJson('POST', '/transactions/journalize', accessToken, payload);
    s2.作成 = {
      status: created.status,
      使った勘定科目: acc.name,
      判定: created.ok ? '○ 作れた' : '× 作れなかった',
      エラー本文: created.ok ? undefined : created.raw,
    };
    const jid = created.json && created.json.journal && created.json.journal.id;
    if (!jid) {
      s2.判定 = '× 仕訳IDが取れないので、これ以上は進めない';
      out.判定 = '△ 段階1は○。段階2は仕訳が作れず未完';
      res.status(200).json(out);
      return;
    }
    out.手で消す必要がある仕訳.push({ 段階: 2, journal_id: jid, 明細id: tx.id, 内容: `${acc.name} ${tx.value}円` });

    // 消す前に中身を控える
    const before = await mfJson('GET', `/journals/${encodeURIComponent(jid)}`, accessToken);
    s2.消す前の控え = { status: before.status, 中身: before.json || before.raw };
    s2.控えに明細IDが入っているか = before.json && before.json.journal
      ? (before.json.journal.transaction_id ? '○ 入っている' : '× 入っていない')
      : '(控えが取れなかった)';

    const del = await mfJson('DELETE', `/journals/${encodeURIComponent(jid)}`, accessToken);
    s2.削除 = { status: del.status, 判定: del.ok ? '○ 消せた' : '× 消せなかった', エラー本文: del.ok ? undefined : del.raw };

    const afterJ = await mfJson('GET', `/journals/${encodeURIComponent(jid)}`, accessToken);
    const gone = afterJ.status === 404 || afterJ.status === 400;
    s2.消したあとの仕訳 = { status: afterJ.status, 判定: gone ? '○ 消えている' : '× まだ残っている' };
    if (gone) out.手で消す必要がある仕訳 = out.手で消す必要がある仕訳.filter((x) => x.journal_id !== jid);

    // ---- ここが本題: 明細は未仕訳に戻ったか ----
    const txsAfter = await fetchUnjournalizedTransactions({ accessToken, startDate: from, endDate: today });
    const backInList = txsAfter.some((t) => t && t.id === tx.id);
    s2.明細は未仕訳一覧に戻ったか = backInList ? '○ 戻った' : '× 戻っていない';

    if (del.ok && gone && backInList) {
      s2.判定 = '○ 消せて、明細も未仕訳に戻った → ★E（登録の取り消し）を作れる';
      out.判定 = '○ P7-B 成功。帳簿は元どおりです';
    } else if (del.ok && gone && !backInList) {
      s2.判定 = '× 仕訳は消えたが明細が未仕訳に戻らない（仕訳済みだが仕訳が無い状態）→ ★Eは作らない';
      s2.明細を手当てする必要がある = {
        明細id: tx.id, 日付: tx.date, 金額: tx.value, 内容: tx.content,
        やること: 'MFの画面でこの明細の仕訳化を取り消し、未仕訳に戻してください',
      };
      out.判定 = '× P7-B 失敗。★Eは作りません。上の 明細を手当てする必要がある をご対応ください';
    } else {
      s2.判定 = '× 明細から作った仕訳は消せなかった → ★Eは作らない';
      out.判定 = '× P7-B 失敗。残った仕訳を 手で消す必要がある仕訳 のとおり手で消してください';
    }
  } catch (e) {
    s2.判定 = '× 例外';
    s2.message = String((e && e.message) || e);
    s2.stack = String((e && e.stack) || '').slice(0, 400);
    out.判定 = '× 段階2で例外。手で消す必要がある仕訳 を必ず確認してください';
  }

  res.status(200).json(out);
};
