/* RIBRE 売上管理 — AIに質問（自然文Q&Aアシスタント）
 * ------------------------------------------------------------------------
 * 目的: オーナーが日本語の自然文で自分の売上・仕入データについて質問できるようにする。
 *
 * 設計方針（重要・変更しないこと）:
 *  - モデルには生データを一切渡さない。モデルは query_data / list_rows の2つの
 *    read-onlyツールだけを呼び、実際の集計・フィルタはこのファイルのJSが
 *    localStorage（services/core.js の sales()/purchases()）に対して行う。
 *    モデルが返すのは「どのツールをどんな条件で呼ぶか」だけで、金額の暗算はさせない。
 *  - 認証は既存の /api/openai/responses プロキシ（api/openai/responses.js）を使う。
 *    認証ヘッダーは pages/mf-evidence.js の mfSendToMf 等と同じパターン
 *    （Authorization: 'Bearer ' + (sess().access_token || '')）。
 *  - このファイルは services/core.js（sales()/purchases()/sess()）より後、
 *    pages/app-v2.js より後に読み込まれる前提（index.htmlのscript順）。
 *  - 画面描画は textContent / createElement のみを使い、innerHTML は一切使わない
 *    （このコードベースで過去にXSSの指摘があったため。pages/mf-evidence.js の
 *    安全なレンダリングパターンに合わせる）。
 * ------------------------------------------------------------------------ */

/* ==================== 数値・行の共通ヘルパー ====================
 * core.jsのnum()に依存せず自己完結させる（このファイル単体でもテストしやすくするため）。 */
function aiqNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  var n = Number(String(v == null ? '' : v).replace(/[¥,円\s]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/* 「明細」(まとめ売り一括入力)行は旧UI・新UIのKPI集計と同じ規則で除外する
 * （根拠: pages/app-v2.js のappvIsMeiRow/appvIsMeiRowLocal 184行目・318行目、
 *  いずれも String(r.source||'') === '明細' で判定している）。 */
function aiqIsMeiRow(r) {
  return String((r && r.source) || '') === '明細';
}

/* 経費はpurchases配列の中で、メモが「[経費]」で始まる行として区別される
 * （根拠: pages/app-v2.js:250 の appvNormalizePurchase 内
 *  `expense: /^\[経費\]/.test(String(memo).trim())`、および
 *  4069行目・3993行目の書き込み側 `'[経費] ' + memoRaw` と同一の規則）。 */
function aiqIsExpenseRow(r) {
  return /^\[経費\]/.test(String((r && r.memo) || '').trim());
}

/* 行の月(YYYY-MM)を取得。sales/purchasesの生データは基本的に.monthを持つ
 * （pages/app-v2.js:4920, :3977, :3997 等の書き込み箇所を参照）。
 * .monthが無い旧データ用に.dateからのフォールバックも用意する。 */
function aiqRowMonth(r) {
  var v = (r && (r.month || r.date)) || '';
  return String(v).slice(0, 7);
}

/* sales行の金額（税込総額）。CSV由来行はamount/priceの両方を持つことがあるためamount優先
 * （根拠: pages/app-v2.js:331 `num(r.amount != null ? r.amount : r.price)` と同一の優先順位）。 */
function aiqSaleAmount(r) {
  return aiqNum(r && r.amount != null ? r.amount : r && r.price);
}
/* sales行の送料。CSV由来行はship/shippingの両方に同じ値が入る
 * （根拠: pages/app-v2.js:333 `num(r.ship != null ? r.ship : r.shipping)`、
 *  および:4921 `shipping: shipping, ship: shipping` で両方セットしていることから）。
 * 手入力(manual)行はship/shippingどちらも持たないため0扱い（税抜前の送料未確定の意味）。 */
function aiqSaleShipping(r) {
  return aiqNum(r && r.ship != null ? r.ship : r && r.shipping);
}
/* purchases/expenses行の金額。手入力・CSVともtotalフィールドを使う
 * （根拠: pages/app-v2.js:3994-4003 の手入力保存、:360 `num(r.total != null ? r.total : r.amount)`）。 */
function aiqPurchaseAmount(r) {
  return aiqNum(r && r.total != null ? r.total : r && r.amount);
}

/* ==================== ツール引数の許可リスト ====================
 * モデル入力からのフィールドは必ずここでホワイトリスト化した値だけを読む。
 * eval・動的プロパティアクセス・モデルが指定した任意キーでの絞り込みは一切行わない。 */
var AIQ_SOURCE_VALUES = ['sales', 'purchases', 'expenses'];
var AIQ_GROUP_BY_VALUES = ['none', 'month', 'shop', 'vendor'];
var AIQ_SORT_VALUES = ['date_desc', 'date_asc', 'amount_desc'];
var AIQ_DEFAULT_LIMIT = 20;
var AIQ_MAX_LIMIT = 100;

function aiqPickFilters(args) {
  var a = args && typeof args === 'object' ? args : {};
  var out = {
    source: typeof a.source === 'string' ? a.source : '',
    month: typeof a.month === 'string' ? a.month : '',
    month_from: typeof a.month_from === 'string' ? a.month_from : '',
    month_to: typeof a.month_to === 'string' ? a.month_to : '',
    shop: typeof a.shop === 'string' ? a.shop.trim() : '',
    vendor: typeof a.vendor === 'string' ? a.vendor.trim() : '',
    name_contains: typeof a.name_contains === 'string' ? a.name_contains : '',
    memo_contains: typeof a.memo_contains === 'string' ? a.memo_contains : '',
    amount_min: null,
    amount_max: null
  };
  // 金額の上下限は「0＝指定なし」として扱う。
  // モデルはschemaの全項目を埋めようとして、指定が無い場合に amount_max: 0 を送ってくる
  // ことがある（実際に発生）。これを素直に「上限0円」と解釈すると全件が除外され、
  // データがあるのに「該当なし」と答えてしまう。金額0の証憑・取引を上限/下限で
  // 絞り込みたい場面は実務上ないため、0は未指定とみなすのが安全。
  var minRaw = aiqNum(a.amount_min);
  var maxRaw = aiqNum(a.amount_max);
  if (minRaw > 0) out.amount_min = minRaw;
  if (maxRaw > 0) out.amount_max = maxRaw;
  return out;
}

/* ==================== データ取得（元行） ====================
 * sales()/purchases() は services/core.js が定義するグローバル関数
 * （LS.sales='ribre_full_sales221' / LS.purchases='ribre_full_purchases221' を読む）。
 * このファイルはcore.jsより後に読み込まれるため直接呼び出せる。 */
function aiqRawSalesRows() {
  var rows = typeof sales === 'function' ? sales() : [];
  return (Array.isArray(rows) ? rows : []).filter(function (r) { return !aiqIsMeiRow(r); });
}
function aiqRawPurchaseRows(wantExpense) {
  var rows = typeof purchases === 'function' ? purchases() : [];
  return (Array.isArray(rows) ? rows : [])
    .filter(function (r) { return !aiqIsMeiRow(r); })
    .filter(function (r) { return aiqIsExpenseRow(r) === !!wantExpense; });
}
function aiqBaseRows(source) {
  if (source === 'sales') return aiqRawSalesRows();
  if (source === 'purchases') return aiqRawPurchaseRows(false);
  if (source === 'expenses') return aiqRawPurchaseRows(true);
  return null;
}

/* ==================== フィルタ適用 ==================== */
function aiqApplyFilters(rows, f, isSalesLike) {
  return (rows || []).filter(function (r) {
    var m = aiqRowMonth(r);
    if (f.month && m !== f.month) return false;
    if (f.month_from && m < f.month_from) return false;
    if (f.month_to && m > f.month_to) return false;
    if (isSalesLike && f.shop) {
      if (String(r.shop || '').trim() !== f.shop) return false;
    }
    if (!isSalesLike && f.vendor) {
      if (String(r.vendor || '').trim() !== f.vendor) return false;
    }
    if (f.name_contains) {
      if (String(r.name || '').toLowerCase().indexOf(f.name_contains.toLowerCase()) < 0) return false;
    }
    if (f.memo_contains) {
      if (String(r.memo || '').toLowerCase().indexOf(f.memo_contains.toLowerCase()) < 0) return false;
    }
    var amt = isSalesLike ? aiqSaleAmount(r) : aiqPurchaseAmount(r);
    if (f.amount_min != null && amt < f.amount_min) return false;
    if (f.amount_max != null && amt > f.amount_max) return false;
    return true;
  });
}

/* ==================== 集計 ==================== */
function aiqAggregate(rows, isSalesLike) {
  var count = rows.length;
  if (isSalesLike) {
    var sum_amount = 0, sum_fee = 0, sum_shipping = 0, sum_profit = 0;
    rows.forEach(function (r) {
      var amt = aiqSaleAmount(r);
      var fee = aiqNum(r.fee);
      var ship = aiqSaleShipping(r);
      sum_amount += amt;
      sum_fee += fee;
      sum_shipping += ship;
      sum_profit += (amt - fee - ship);
    });
    return { count: count, sum_amount: sum_amount, sum_fee: sum_fee, sum_shipping: sum_shipping, sum_profit: sum_profit };
  }
  var sum_total = 0;
  rows.forEach(function (r) { sum_total += aiqPurchaseAmount(r); });
  return { count: count, sum_total: sum_total };
}

var AIQ_TOOL_NOTE = '「明細」(まとめ売り一括入力)行はKPI集計と同じ規則で除外済みです。' +
  'expensesはpurchasesのうちメモが「[経費]」で始まる行のみで、purchasesとexpensesは重複しません。';

/* ==================== ツール1: query_data（フィルタ＋集計） ==================== */
function aiqQueryData(args) {
  var f = aiqPickFilters(args);
  if (AIQ_SOURCE_VALUES.indexOf(f.source) < 0) {
    return { error: 'source には sales / purchases / expenses のいずれかを指定してください。', count: 0, groups: [], overall: null };
  }
  var isSalesLike = f.source === 'sales';
  var rows = aiqApplyFilters(aiqBaseRows(f.source), f, isSalesLike);

  var gbRaw = args && typeof args.group_by === 'string' ? args.group_by : 'none';
  var groupBy = AIQ_GROUP_BY_VALUES.indexOf(gbRaw) >= 0 ? gbRaw : 'none';
  // shopはsales専用・vendorはpurchases/expenses専用。データ源と噛み合わない指定は無視してnone扱いにする。
  if (groupBy === 'shop' && !isSalesLike) groupBy = 'none';
  if (groupBy === 'vendor' && isSalesLike) groupBy = 'none';

  var overall = aiqAggregate(rows, isSalesLike);
  var groups = [];
  if (groupBy !== 'none') {
    var buckets = {};
    var order = [];
    rows.forEach(function (r) {
      var key;
      if (groupBy === 'month') key = aiqRowMonth(r) || '不明';
      else if (groupBy === 'shop') key = String(r.shop || '').trim() || 'その他';
      else key = String(r.vendor || '').trim() || 'その他';
      if (!buckets[key]) { buckets[key] = []; order.push(key); }
      buckets[key].push(r);
    });
    groups = order.map(function (key) {
      var agg = aiqAggregate(buckets[key], isSalesLike);
      agg.key = key;
      return agg;
    });
    groups.sort(function (a, b) {
      if (groupBy === 'month') return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0);
      var av = isSalesLike ? a.sum_amount : a.sum_total;
      var bv = isSalesLike ? b.sum_amount : b.sum_total;
      return bv - av;
    });
  }

  return {
    count: rows.length,
    groups: groups,
    overall: overall,
    filters_used: {
      source: f.source,
      month: f.month || null,
      month_from: f.month_from || null,
      month_to: f.month_to || null,
      shop: isSalesLike && f.shop ? f.shop : null,
      vendor: !isSalesLike && f.vendor ? f.vendor : null,
      name_contains: f.name_contains || null,
      memo_contains: f.memo_contains || null,
      amount_min: f.amount_min,
      amount_max: f.amount_max,
      group_by: groupBy
    },
    note: AIQ_TOOL_NOTE
  };
}

/* ==================== ツール2: list_rows（明細行の一覧） ==================== */
function aiqListRows(args) {
  var f = aiqPickFilters(args);
  if (AIQ_SOURCE_VALUES.indexOf(f.source) < 0) {
    return { error: 'source には sales / purchases / expenses のいずれかを指定してください。', count: 0, returned: 0, rows: [] };
  }
  var isSalesLike = f.source === 'sales';
  var rows = aiqApplyFilters(aiqBaseRows(f.source), f, isSalesLike);

  var sortRaw = args && typeof args.sort === 'string' ? args.sort : 'date_desc';
  var sort = AIQ_SORT_VALUES.indexOf(sortRaw) >= 0 ? sortRaw : 'date_desc';

  var limitRaw = args ? args.limit : undefined;
  var limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) limit = AIQ_DEFAULT_LIMIT;
  limit = Math.min(Math.max(1, Math.round(limit)), AIQ_MAX_LIMIT);

  var withKeys = rows.map(function (r) {
    return { row: r, amt: isSalesLike ? aiqSaleAmount(r) : aiqPurchaseAmount(r), date: String(r.date || '') };
  });
  withKeys.sort(function (a, b) {
    if (sort === 'amount_desc') return b.amt - a.amt;
    if (sort === 'date_asc') return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); // date_desc（既定）
  });

  var limited = withKeys.slice(0, limit).map(function (x) {
    var r = x.row;
    if (isSalesLike) {
      var amt = aiqSaleAmount(r), fee = aiqNum(r.fee), ship = aiqSaleShipping(r);
      return { date: r.date || '', shop: r.shop || '', name: r.name || '', amount: amt, fee: fee, shipping: ship, profit: amt - fee - ship, memo: r.memo || '' };
    }
    return { date: r.date || '', vendor: r.vendor || '', name: r.name || '', total: aiqPurchaseAmount(r), memo: r.memo || '' };
  });

  return {
    count: rows.length,
    returned: limited.length,
    rows: limited,
    filters_used: {
      source: f.source,
      month: f.month || null,
      month_from: f.month_from || null,
      month_to: f.month_to || null,
      shop: isSalesLike && f.shop ? f.shop : null,
      vendor: !isSalesLike && f.vendor ? f.vendor : null,
      name_contains: f.name_contains || null,
      memo_contains: f.memo_contains || null,
      amount_min: f.amount_min,
      amount_max: f.amount_max,
      limit: limit,
      sort: sort
    },
    note: AIQ_TOOL_NOTE
  };
}

/* ==================== ツールディスパッチ ==================== */
function aiqExecuteTool(name, args) {
  var safeArgs = args && typeof args === 'object' ? args : {};
  if (name === 'query_data') return aiqQueryData(safeArgs);
  if (name === 'list_rows') return aiqListRows(safeArgs);
  // 学習メモ（pages/ai-memory.js）。教わったことを覚えて以降の回答に反映する
  if (name === 'remember_preference' && typeof window.aimHandleToolCall === 'function') {
    return window.aimHandleToolCall(safeArgs);
  }
  // 変更提案（pages/ai-write.js）。ここでは「提案を作る」だけで、データは一切変更しない。
  // 実際の変更は利用者が画面の「実行」を押したときにaiwApplyProposalが行う。
  if (name === 'propose_update' && typeof window.aiwProposeUpdate === 'function') {
    return aiqStageProposal(window.aiwProposeUpdate(safeArgs));
  }
  if (name === 'propose_delete' && typeof window.aiwProposeDelete === 'function') {
    return aiqStageProposal(window.aiwProposeDelete(safeArgs));
  }
  return { error: '未対応のツールです: ' + name };
}

/* 提案を画面表示用に控えつつ、モデルには「提案を作った」事実だけを返す。
 * 実データの変更が起きていないことをモデルにも明示し、勝手に「変更しました」と
 * 報告させない（実行したのは人間のクリックだけ、という事実関係を崩さないため）。 */
var aiqPendingProposal = null;
function aiqStageProposal(proposal) {
  if (!proposal || !proposal.ok) {
    return { ok: false, error: (proposal && proposal.summary) || '提案を作成できませんでした' };
  }
  aiqPendingProposal = proposal;
  return {
    ok: true,
    staged: true,
    kind: proposal.kind,
    row_count: (proposal.rows || []).length,
    blocked_count: (proposal.blocked || []).length,
    summary: proposal.summary,
    note: 'この提案はまだ実行されていません。画面に確認欄を表示したので、利用者が「実行」を押すまでデータは一切変更されません。回答では「変更しました」ではなく「変更内容を提案しました。ご確認ください」と伝えること。'
  };
}

/* ==================== OpenAI Responses APIツール定義 ====================
 * type:'function'のResponses API標準スキーマ。read-onlyの2ツールのみを公開する。 */
var AIQ_TOOLS = [
  {
    type: 'function',
    name: 'query_data',
    description:
      '売上(sales)・仕入(purchases)・経費(expenses)データをフィルタして合計・件数を集計する。' +
      'sales: EC売上（ヤフオク/メルカリ/ラクマ等チャネル別）。amount=税込の売上総額、fee=プラットフォーム手数料、' +
      'shipping=送料、profit=amount-fee-shipping。' +
      'purchases: 買取仕入（total=仕入金額）。expenses: purchasesのうちメモが「[経費]」で始まる行のみ（total=経費金額）。' +
      'purchasesとexpensesは互いに排他（重複しない）。' +
      '「明細」（まとめ売り一括入力）行は自動的に除外済み（旧UIのKPI集計と同じ規則）。' +
      'group_by未指定またはnoneのときはoverallの値をそのまま使う。内訳が必要な場合のみgroup_byを指定してgroupsを見ること。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['sales', 'purchases', 'expenses'], description: '対象データ' },
        month: { type: 'string', description: '対象月 YYYY-MM（例: 2026-07）。指定月のみに絞る' },
        month_from: { type: 'string', description: '期間の開始月 YYYY-MM（month_toと併用。範囲集計に使う）' },
        month_to: { type: 'string', description: '期間の終了月 YYYY-MM（month_fromと併用）' },
        shop: { type: 'string', description: 'sales専用。チャネル名の完全一致（例: ヤフオク1, メルカリ, ラクマ）' },
        vendor: { type: 'string', description: 'purchases/expenses専用。仕入先・取引先名の完全一致（例: ブックオフ）' },
        name_contains: { type: 'string', description: '商品名の部分一致（大文字小文字区別なし）' },
        memo_contains: { type: 'string', description: 'メモの部分一致（大文字小文字区別なし）。CSV取込行のメモには取込元ファイル名が入るため、ファイル名の一部（例: 202607ヤフオク4）を渡せばその取込分だけを絞り込める' },
        amount_min: { type: 'number', description: '金額の下限（sales=amount, purchases/expenses=total）' },
        amount_max: { type: 'number', description: '金額の上限' },
        group_by: { type: 'string', enum: ['none', 'month', 'shop', 'vendor'], description: '内訳の単位。shopはsales専用、vendorはpurchases/expenses専用' }
      },
      required: ['source']
    }
  },
  {
    type: 'function',
    name: 'list_rows',
    description:
      'query_dataと同じフィルタ条件で、集計ではなく個々の取引行を一覧で返す（明細行そのものが必要なとき用）。' +
      '返す行はdate/shop(またはvendor)/name/amount(またはtotal)/fee/shipping/profit/memoなど表示用の項目のみ。' +
      '「明細」（まとめ売り一括入力）行は除外済み。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['sales', 'purchases', 'expenses'] },
        month: { type: 'string', description: '対象月 YYYY-MM' },
        month_from: { type: 'string' },
        month_to: { type: 'string' },
        shop: { type: 'string' },
        vendor: { type: 'string' },
        name_contains: { type: 'string' },
        memo_contains: { type: 'string', description: 'メモの部分一致。CSV取込行のメモには取込元ファイル名が入る（例: 202607ヤフオク4）' },
        amount_min: { type: 'number' },
        amount_max: { type: 'number' },
        limit: { type: 'integer', description: '返す件数の上限。既定20・最大100' },
        sort: { type: 'string', enum: ['date_desc', 'date_asc', 'amount_desc'], description: '並び順。既定はdate_desc' }
      },
      required: ['source']
    }
  },
  /* ---- 変更提案（pages/ai-write.js）----
   * これらは「提案を作る」だけでデータを変更しない。実行は利用者のクリックのみ。 */
  {
    type: 'function',
    name: 'propose_update',
    description:
      '条件に合う取引行の修正を「提案」する。このツールはデータを変更しない。' +
      '利用者が画面で内容を確認して「実行」を押したときだけ、自動バックアップの後に変更される。' +
      '一度に扱えるのは10件まで。締め済み月の行と、同一内容が複数あって特定できない行は対象外になる。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['sales', 'purchases', 'expenses'] },
        month: { type: 'string', description: '対象月 YYYY-MM' },
        month_from: { type: 'string' },
        month_to: { type: 'string' },
        shop: { type: 'string' },
        vendor: { type: 'string' },
        name_contains: { type: 'string' },
        memo_contains: { type: 'string', description: 'メモの部分一致。CSV取込行のメモには取込元ファイル名が入る（例: 202607ヤフオク4）' },
        amount_min: { type: 'number' },
        amount_max: { type: 'number' },
        set: {
          type: 'object',
          description: '変更する内容。指定した項目だけが書き換わる',
          properties: {
            date: { type: 'string', description: '取引日 YYYY-MM-DD' },
            name: { type: 'string', description: '商品名' },
            partner: { type: 'string', description: 'sales=チャネル名、purchases/expenses=取引先名' },
            amount: { type: 'number', description: '金額' },
            memo: { type: 'string', description: 'メモ' }
          }
        }
      },
      required: ['source', 'set']
    }
  },
  {
    type: 'function',
    name: 'propose_delete',
    description:
      '条件に合う取引行の削除を「提案」する。このツールはデータを変更しない。' +
      '利用者が画面で内容を確認して「実行」を押したときだけ、自動バックアップの後に削除される。' +
      '一度に扱えるのは10件まで。締め済み月の行と、同一内容が複数あって特定できない行は対象外になる。',
    parameters: {
      type: 'object',
      properties: {
        source: { type: 'string', enum: ['sales', 'purchases', 'expenses'] },
        month: { type: 'string', description: '対象月 YYYY-MM' },
        month_from: { type: 'string' },
        month_to: { type: 'string' },
        shop: { type: 'string' },
        vendor: { type: 'string' },
        name_contains: { type: 'string' },
        memo_contains: { type: 'string', description: 'メモの部分一致。CSV取込行のメモには取込元ファイル名が入る（例: 202607ヤフオク4）' },
        amount_min: { type: 'number' },
        amount_max: { type: 'number' }
      },
      required: ['source']
    }
  }
];
// 学習メモのツール（pages/ai-memory.js）が読み込まれていれば追加する
if (typeof window !== 'undefined' && typeof window.aimGetToolSpec === 'function') {
  try { AIQ_TOOLS.push(window.aimGetToolSpec()); } catch (e) {}
}

/* ==================== システムプロンプト ==================== */
/* 今日の日付をJSTで取得（クライアントPCのタイムゾーンに依存しないようにする）。 */
function aiqTodayJst() {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch (e) {
    try { return typeof today === 'function' ? today() : ''; } catch (e2) { return ''; }
  }
}
function aiqBuildSystemPrompt() {
  return [
    'あなたは株式会社RIBRE（古物商）の売上管理アプリに組み込まれた、社内向けデータ質問応答アシスタントです。',
    '対象データ: sales=EC売上（ヤフオク/メルカリ/ラクマ等のチャネル経由の販売）。purchases=買取仕入（お客様からの買取）。' +
      'expenses=purchasesのうちメモが「[経費]」で始まる行（送料・手数料以外の固定費等）。',
    '金額の意味: amount=税込の売上総額（グロス）。fee=プラットフォーム手数料。shipping=送料。profit=amount-fee-shipping。' +
      'purchases/expensesの金額はtotalフィールド。',
    '「明細」（まとめ売り一括入力）行はツールの戻り値の中で既に除外されている（旧UIのKPI集計と同じ規則）。この点は特に断る必要はない。',
    'CSVから取り込んだ売上のmemoには取込元のファイル名が入っている（形式:「ヤフオク売上CSV / <ファイル名>」）。' +
      'そのため「どのCSVで取り込んだ行か」はmemo_containsにファイル名（一部でも可。例: 202607ヤフオク4）を渡せば特定できる。' +
      '取込元チャネルを間違えて取り込んだ行を直したい、といった依頼ではこれを使うこと。' +
      '利用者がファイル名を言わない場合は、まずlist_rowsでmemoを見て候補のファイル名を提示してから確認するとよい。' +
      '「ファイル名が分からないので直せない」と即答してはいけない。',
    '今日の日付（日本時間）: ' + aiqTodayJst() + '。「今月」「先月」「今年度」等の相対的な期間はこの日付を基準に西暦月(YYYY-MM)へ変換してからquery_data/list_rowsに渡すこと。',
    '最重要ルール: 金額・件数は必ずquery_dataまたはlist_rowsの戻り値の数値をそのまま使うこと。自分で暗算・推計・合算しない。' +
      '複数のツール結果を組み合わせる場合も、足し算・引き算・割り算は戻ってきた数値同士の単純な演算に留め、' +
      'ツールで取得できない数値は正直に「取得できません」と答える。',
    'データの修正・削除を頼まれたらpropose_update/propose_deleteで「提案」を作ること。' +
      'これらのツールはデータを変更しない。実際に変更されるのは利用者が画面の「実行」ボタンを押したときだけで、' +
      'その直前に自動でバックアップが取られる。したがって提案を作った後の回答では、必ず' +
      '「変更しました」ではなく「変更内容を提案しました。内容を確認して実行してください」と伝えること。' +
      '一度に扱えるのは10件までで、締め済みの月の行は変更できない（提案しても対象外として弾かれる）。',
    '利用者から「◯◯として扱って」「いつも△△で」のような指示や訂正を受けたら、remember_preferenceで覚えること。' +
      '一度覚えたことは次回以降の質問でも自動的に適用されるので、同じ確認を繰り返さない。' +
      '例: 年を省略した月の指定は今年として解釈する、等。',
    '回答は簡潔な日本語で。どの期間・どの条件で集計したか（例: 「2026年7月・ヤフオク1」）を一言添える。',
    '質問が曖昧で複数の解釈がありうる場合は、推測でツールを呼ばずに短い確認質問を返すこと（例: 「利益率」は売上に対する粗利益率か、それとも別の指標か等）。' +
      'ただし過去に教わって覚えている事柄については、再確認せずその解釈を使うこと。',
    '回答はMarkdownを使わないプレーンテキストで書くこと（**強調** や見出し記号は画面にそのまま記号として表示されてしまう）。',
    (typeof window.aimBuildPromptBlock === 'function' ? window.aimBuildPromptBlock() : '')
  ].filter(function (s) { return s; }).join('\n');
}

/* ==================== OpenAI呼び出し（Responses API） ==================== */
// この機能はモデルに金額の計算をさせず「どの条件で集計するか」の判断とツール呼び出しだけを
// させる設計のため、ツール利用に最適化された安価・高速なLunaを既定にしている
// （OCR側は読取精度が生命線なのでgpt-4.1のまま。混同しないこと）。
// 万一Lunaが利用できない場合（モデル廃止・ツール非対応等）はgpt-4.1へ自動フォールバックし、
// 実際に使ったモデル名を回答の根拠行に表示する（黙って高いモデルに切り替わらないように）。
var AIQ_MODEL = 'gpt-5.6-luna';
var AIQ_FALLBACK_MODEL = 'gpt-4.1';
var AIQ_MAX_TOOL_ROUNDS = 5; // これを超えるとツールを使わせず、その時点の情報で回答させる
var aiqActiveModel = AIQ_MODEL;  // 実際に使えたモデル（フォールバック後は固定される）
var aiqLastUsedModel = '';       // 直近の回答で使ったモデル（根拠行の表示用）
var aiqOmitTemperature = false;  // temperature非対応モデル向け（初回失敗時に自動でtrueになる）
var aiqLastModelError = '';      // 既定モデルが使えなかった理由（画面に出して原因調査できるように）

async function aiqPostResponses(model, inputItems, tools, token, omitTemperature) {
  var body = {
    model: model,
    instructions: aiqBuildSystemPrompt(),
    input: inputItems,
    store: false
  };
  // GPT-5系など temperature を受け付けないモデルがあるため、必要に応じて外せるようにする
  if (!omitTemperature) body.temperature = 0;
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  var res = await fetch('/api/openai/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify(body)
  });
  if (res.status === 401) {
    var authErr = new Error('unauthorized');
    authErr.aiqUnauthorized = true;
    throw authErr;
  }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    var msg = (data && data.error && (data.error.message || data.error)) || ('HTTP ' + res.status);
    var err = new Error(String(msg));
    err.aiqStatus = res.status;
    throw err;
  }
  return data;
}

async function aiqCallOpenAI(inputItems, tools) {
  var token = '';
  try { token = (typeof sess === 'function' ? sess().access_token : '') || ''; } catch (e) { token = ''; }
  try {
    var data = await aiqPostResponses(aiqActiveModel, inputItems, tools, token, aiqOmitTemperature);
    aiqLastUsedModel = aiqActiveModel;
    return data;
  } catch (e) {
    // 認証エラーはフォールバック対象外（モデルの問題ではないため）
    if (e && e.aiqUnauthorized) throw e;
    // 既にフォールバック済み、またはフォールバック先自体の失敗ならそのまま投げる
    if (aiqActiveModel === AIQ_FALLBACK_MODEL) throw e;

    aiqLastModelError = (e && e.message) ? String(e.message).slice(0, 300) : '不明なエラー';
    try { console.warn('[RIBRE AI質問] ' + aiqActiveModel + ' の呼び出しに失敗:', aiqLastModelError); } catch (e2) {}

    // 段階1: temperature非対応（GPT-5系に多い）の可能性があるため、同じモデルで
    // temperatureを外して1度だけ再試行する。これで通れば以降もその形で呼ぶ。
    if (!aiqOmitTemperature) {
      try {
        var retry = await aiqPostResponses(aiqActiveModel, inputItems, tools, token, true);
        aiqOmitTemperature = true;
        aiqLastUsedModel = aiqActiveModel;
        try { console.info('[RIBRE AI質問] temperatureを外して成功したため、以降は付けずに呼びます'); } catch (e3) {}
        return retry;
      } catch (e4) {
        aiqLastModelError = (e4 && e4.message) ? String(e4.message).slice(0, 300) : aiqLastModelError;
        try { console.warn('[RIBRE AI質問] temperature無しでも失敗:', aiqLastModelError); } catch (e5) {}
      }
    }

    // 段階2: それでも駄目ならgpt-4.1へ切り替える（以降このセッションでは固定）
    aiqActiveModel = AIQ_FALLBACK_MODEL;
    aiqOmitTemperature = false;
    var fb = await aiqPostResponses(aiqActiveModel, inputItems, tools, token, false);
    aiqLastUsedModel = aiqActiveModel;
    return fb;
  }
}

function aiqExtractText(data) {
  var text = (data && data.output_text) || '';
  if (!text && data && Array.isArray(data.output)) {
    text = data.output
      .filter(function (o) { return o && o.type === 'message'; })
      .map(function (o) { return (o.content || []).map(function (c) { return (c && c.text) || ''; }).join(''); })
      .join('\n');
  }
  return text;
}

/* ==================== 会話履歴（アップストリームへ送るコストを抑えるため直近分のみ保持） ==================== */
var __aiqHistory = []; // { role:'user'|'assistant', text }の配列
var AIQ_MAX_HISTORY_ITEMS = 16; // 直近8往復分

function aiqPushHistory(userText, assistantText) {
  __aiqHistory.push({ role: 'user', text: userText });
  __aiqHistory.push({ role: 'assistant', text: assistantText });
  if (__aiqHistory.length > AIQ_MAX_HISTORY_ITEMS) {
    __aiqHistory = __aiqHistory.slice(__aiqHistory.length - AIQ_MAX_HISTORY_ITEMS);
  }
}
function aiqClearHistory() { __aiqHistory = []; }
function aiqBuildHistoryInput() {
  return __aiqHistory.map(function (h) {
    return { role: h.role, content: [{ type: h.role === 'user' ? 'input_text' : 'output_text', text: h.text }] };
  });
}

/* ==================== ツール呼び出しループ本体 ====================
 * 1問につき最大AIQ_MAX_TOOL_ROUNDS回までツール呼び出しラウンドを許可する。
 * それを超えたら（forceFinal）tools無しで再度呼び、その時点で分かっている範囲を
 * 日本語で答えさせる（「わからない」と正直に言わせる指示はシステムプロンプト側にある）。 */
async function aiqRunConversation(userText) {
  var toolLog = [];
  var inputItems = aiqBuildHistoryInput().concat([{ role: 'user', content: [{ type: 'input_text', text: userText }] }]);
  var round = 0;
  while (true) {
    round++;
    var forceFinal = round > AIQ_MAX_TOOL_ROUNDS;
    var data;
    try {
      data = await aiqCallOpenAI(inputItems, forceFinal ? null : AIQ_TOOLS);
    } catch (e) {
      if (e && e.aiqUnauthorized) return { answer: null, error: 'unauthorized', toolLog: toolLog };
      return { answer: null, error: (e && e.message) || String(e), toolLog: toolLog };
    }
    var output = Array.isArray(data.output) ? data.output : [];
    var functionCalls = output.filter(function (o) { return o && o.type === 'function_call'; });
    if (!functionCalls.length) {
      var text = aiqExtractText(data);
      if (forceFinal) {
        text = (text ? text + '\n\n' : '') + '（注: ツール呼び出しの上限（' + AIQ_MAX_TOOL_ROUNDS + '回）に達したため、ここまでの情報で回答しています）';
      }
      return { answer: text || '回答を生成できませんでした。', error: null, toolLog: toolLog };
    }
    // モデル自身の出力（function_callを含む）を会話に積み、続けて各ツールの実行結果を積む
    output.forEach(function (o) { inputItems.push(o); });
    for (var i = 0; i < functionCalls.length; i++) {
      var call = functionCalls[i];
      var args = {};
      try { args = JSON.parse(call.arguments || '{}'); } catch (e) { args = {}; }
      var result;
      try { result = aiqExecuteTool(call.name, args); } catch (e) { result = { error: (e && e.message) || String(e) }; }
      toolLog.push({ name: call.name, args: args });
      inputItems.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
    }
  }
}

/* ==================== UI ====================
 * このブロックはブラウザ環境（DOM）でのみ動作する。Node/vmでのツール単体テストでは
 * documentが無いため、要素が見つかったときだけ初期化する。 */
/* モデルがMarkdownの強調記号を付けて返すことがあるが、この画面はtextContentで
 * 描画する（XSS対策のためinnerHTMLは使わない）ので「**2,473円**」のように記号が
 * そのまま見えてしまう。表示前に記号だけを取り除く。
 * ※対になっている ** __ ` と行頭の見出し記号のみを対象にし、
 *   金額や商品名に含まれうる単独の記号は触らない。 */
function aiqStripMarkdown(text) {
  var s = String(text == null ? '' : text);
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');   // **強調**
  s = s.replace(/__([^_\n]+)__/g, '$1');       // __強調__
  s = s.replace(/`([^`\n]+)`/g, '$1');         // `コード`
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');    // 行頭の見出し
  return s;
}

function aiqAppendMessage(container, role, text, toolLog) {
  var msg = document.createElement('div');
  msg.className = 'aiq-msg aiq-' + role;
  msg.textContent = role === 'assistant' ? aiqStripMarkdown(text) : text;
  container.appendChild(msg);
  if (role === 'assistant' && toolLog && toolLog.length) {
    var details = document.createElement('details');
    details.className = 'aiq-toollog';
    var summary = document.createElement('summary');
    summary.textContent = '使用したツール（' + toolLog.length + '件）— クリックで詳細';
    details.appendChild(summary);
    var list = document.createElement('ul');
    toolLog.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t.name + '(' + JSON.stringify(t.args) + ')';
      list.appendChild(li);
    });
    // どのモデルが答えたかも残す（フォールバックで高いモデルに切り替わった場合に気づけるように）
    if (aiqLastUsedModel) {
      var modelLi = document.createElement('li');
      modelLi.textContent = 'モデル: ' + aiqLastUsedModel +
        (aiqLastUsedModel === AIQ_FALLBACK_MODEL && AIQ_MODEL !== AIQ_FALLBACK_MODEL
          ? '（' + AIQ_MODEL + 'が使えないため切替）' : '');
      list.appendChild(modelLi);
      // 切替が起きた場合は理由もここに出す（devtoolsを開かなくても原因が分かるように）
      if (aiqLastModelError && aiqLastUsedModel === AIQ_FALLBACK_MODEL && AIQ_MODEL !== AIQ_FALLBACK_MODEL) {
        var reasonLi = document.createElement('li');
        reasonLi.textContent = '切替理由: ' + aiqLastModelError;
        list.appendChild(reasonLi);
      }
    }
    details.appendChild(list);
    container.appendChild(details);
  }
  container.scrollTop = container.scrollHeight;
}

function aiqInitUI() {
  var log = document.getElementById('aiqLog');
  var input = document.getElementById('aiqInput');
  var sendBtn = document.getElementById('aiqSendBtn');
  var clearBtn = document.getElementById('aiqClearBtn');
  if (!log || !input || !sendBtn) return;

  async function onSend() {
    var text = (input.value || '').trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    aiqAppendMessage(log, 'user', text);
    sendBtn.disabled = true;
    var originalLabel = sendBtn.textContent;
    sendBtn.textContent = '考えています…';
    try {
      var result = await aiqRunConversation(text);
      if (result.error === 'unauthorized') {
        aiqAppendMessage(log, 'error', 'セッションが切れました。画面を再読み込みしてログインし直してください。');
        return;
      }
      if (result.error) {
        aiqAppendMessage(log, 'error', '取得中にエラーが発生しました: ' + result.error);
        return;
      }
      aiqAppendMessage(log, 'assistant', result.answer, result.toolLog);
      aiqPushHistory(text, result.answer);
      // 変更提案が作られていれば、その確認カードを会話の下に表示する。
      // ここで初めて利用者が「実行」を押せるようになる（押すまでデータは変わらない）。
      if (aiqPendingProposal && typeof window.aiwRenderProposal === 'function') {
        var proposal = aiqPendingProposal;
        aiqPendingProposal = null;
        var holder = document.createElement('div');
        holder.className = 'aiq-proposal-holder';
        log.appendChild(holder);
        try {
          window.aiwRenderProposal(holder, proposal, function (outcome) {
            // 実行/取消の結果を会話にも残す（後から見返せるように）
            if (outcome && outcome.applied) {
              aiqAppendMessage(log, 'assistant', '変更を実行しました（' + (outcome.rowCount || 0) + '件）。バックアップ済みなので「元に戻す」で取り消せます。');
            } else if (outcome && outcome.undone) {
              aiqAppendMessage(log, 'assistant', '変更を元に戻しました。');
            } else if (outcome && outcome.error) {
              aiqAppendMessage(log, 'error', '実行できませんでした: ' + outcome.error);
            }
          });
        } catch (e2) {
          aiqAppendMessage(log, 'error', '提案の表示に失敗しました: ' + ((e2 && e2.message) || String(e2)));
        }
        log.scrollTop = log.scrollHeight;
      }
    } catch (e) {
      aiqAppendMessage(log, 'error', '予期しないエラーが発生しました: ' + ((e && e.message) || String(e)));
    } finally {
      sendBtn.disabled = false;
      sendBtn.textContent = originalLabel;
    }
  }

  sendBtn.addEventListener('click', onSend);
  input.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      onSend();
    }
  });
  if (clearBtn) {
    clearBtn.addEventListener('click', function () {
      while (log.firstChild) log.removeChild(log.firstChild);
      aiqClearHistory();
    });
  }
  // 「AIが覚えていること」パネル（pages/ai-memory.js）。未読込でも本体は動く
  var memPanel = document.getElementById('aimPanel');
  if (memPanel && typeof window.aimRenderPanel === 'function') {
    try { window.aimRenderPanel(memPanel); } catch (e) {}
  }
  var chipRow = document.getElementById('aiqChipRow');
  if (chipRow) {
    Array.prototype.forEach.call(chipRow.querySelectorAll('[data-q]'), function (chip) {
      chip.addEventListener('click', function () {
        input.value = chip.getAttribute('data-q') || '';
        input.focus();
      });
    });
  }
}

if (typeof document !== 'undefined' && document.getElementById && document.readyState) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', aiqInitUI);
  } else {
    aiqInitUI();
  }
}

/* ==================== テスト・デバッグ用エクスポート ====================
 * ツール実行部分はNode(vm)から直接叩けるようにwindowへも公開する
 * （scratchpadのtest-ai-assistant.jsはこの経由で純粋なツールロジックだけを検証する）。 */
if (typeof window !== 'undefined') {
  window.aiqQueryData = aiqQueryData;
  window.aiqListRows = aiqListRows;
  window.aiqExecuteTool = aiqExecuteTool;
  window.aiqIsMeiRow = aiqIsMeiRow;
  window.aiqIsExpenseRow = aiqIsExpenseRow;
  window.aiqRowMonth = aiqRowMonth;
  window.aiqNum = aiqNum;
  window.AIQ_TOOLS = AIQ_TOOLS;
  window.AIQ_MAX_TOOL_ROUNDS = AIQ_MAX_TOOL_ROUNDS;
  window.aiqRunConversation = aiqRunConversation;
  window.aiqBuildSystemPrompt = aiqBuildSystemPrompt;
}
