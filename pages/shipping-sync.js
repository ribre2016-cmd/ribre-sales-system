/* =====================================================================
 * RIBRE 配送(shipping)行のクラウド同期
 *
 * 問題: 配送CSV取込行（pages/app-v2.js の appvShipRows / appvImportShippingCsv が
 * 書く localStorage "ribre_shipping_rows230"）は、これまでSupabaseへ一切送られて
 * いなかった（grep確認済み: このキーを触るのは pages/storage-backup.js のファイル
 * バックアップ/復元のみ）。そのため別PCで取り込んだヤマト運賃明細がこの端末に無く、
 * 6/30に発送した売上がいつまでも送料0のままになる、ブラウザデータを消すと配送履歴が
 * 全滅する、といった事故が実データで確認されている。本ファイルはこれを
 * sales/purchases（services/data-store.js）と同じ考え方でクラウド同期する。
 *
 * このファイルが持つ役割はここまで（データ層のみ）。index.html へのscriptタグ追加や
 * 取込ページ(app-v2.js)からいつ呼ぶかの配線は、このファイルの担当ではない
 * （タスク指示により他の人が行う）。公開APIは window.svsPushShippingRows /
 * window.svsPullShippingRows / window.svsSyncShippingRows / window.svsGetSyncState。
 *
 * 依存: services/core.js の sb() / sess() / email() / setLS()（Supabase接続情報・
 * ログインセッション・現在のユーザーメール・容量不足に強い保存）。
 * app-v2.js の appvShipRows/appvSaveShipRows/keyOf 等には依存しない
 * （読み込み順を問わないよう、同じロジックを本ファイル内に再実装している）。
 *
 * 厳守事項（タスク指示より）:
 *  - ローカルの配送行は絶対に削除しない。pull は追加専用マージ。
 *  - raw（CSV1行まるごと）はクラウドへ絶対に送らない（下のsvsMapOutを参照。
 *    そもそもフィールドとして存在しない）。
 *  - マージ後の書き込みは setLS を使う（生の localStorage.setItem は使わない）。
 *    services/core.js の setLS はクォータ超過時に自動バックアップを間引いて
 *    書き直すため、直接 setItem するより保存の成功率が高い。
 *  - fetchは必ず apikey と Authorization の両方のヘッダーを付ける
 *    （CLAUDE.md #3: Authorizationだけだと黙って失敗する）。
 *  - shipping_rows テーブルが無い場合（PostgREST 404 / PGRST205 /
 *    "relation ... does not exist"）は、例外を投げず・ローカルデータも壊さず、
 *    supabase_shipping_rows.sql の実行を促す日本語メッセージを返す。
 *  - 未ログイン時は必ず {ok:false, error:'not_logged_in'} を返し、例外を投げない。
 *
 * クラウドから取り込んだ行には raw が無い（容量削減のため元々送っていない）。
 * appvMatchShipping は itemId/slip/shipping/company のみを見るため問題ない
 * （pages/app-v2.js 5323行目以降で確認済み）。旧レガシー画面
 * pages/app-shipping.js の ver250ShipRowsEnhanced は `x.raw || []` で raw欠如に
 * 既に対応済みで、raw由来のitemId/slip補完だけが働かず既存のitemId/slipは
 * そのまま使われる（＝クラッシュせず黙ってスキップされるだけ。同ファイルの
 * 857行目付近を確認済み・本ファイルからは触らない）。
 * ===================================================================== */
(function () {
  'use strict';

  var LS_ROWS_KEY = 'ribre_shipping_rows230'; // pages/app-v2.js appvShipRows と同一キー
  var LS_SYNCED_KEY = 'ribre_shipping_synced_v1'; // {clientId: contentHash} 既知同期済み
  var LS_LAST_SYNC_KEY = 'ribre_shipping_last_sync_v1'; // 最終同期時刻（表示用）
  var ROW_CAP = 10000; // appvSaveShipRowsと同じ上限
  var SYNC_STATE_CAP = 12000; // ribre_shipping_synced_v1 が無限に肥大化しないための上限
  var PUSH_CHUNK = 500;
  var PULL_PAGE_SIZE = 1000;
  var PULL_MAX_PAGES = 50; // 5万件まで（現状想定の10000件に十分な余裕）
  var MISSING_TABLE_MSG =
    '配送データの同期用テーブル(shipping_rows)がまだ作成されていません。' +
    'Supabaseのダッシュボード(SQL Editor)で supabase_shipping_rows.sql を実行してください。';

  // ---- 接続/認証情報（pages/app-v2.js appvCreds と同じ考え方の自前実装） --------
  function svsCreds() {
    try {
      var c = (typeof sb === 'function') ? sb() : {};
      var s = (typeof sess === 'function') ? sess() : {};
      var tok = s.access_token || (s.session && s.session.access_token) || '';
      var em = (typeof email === 'function') ? email() : '';
      if (c && c.url && c.key && tok && em) {
        return { url: String(c.url).replace(/\/$/, ''), key: c.key, tok: tok, em: em };
      }
    } catch (e) {}
    return null;
  }

  // ---- ローカル配送行の読み書き -------------------------------------------------
  function svsShipRows() {
    try { return JSON.parse(localStorage.getItem(LS_ROWS_KEY) || '[]') || []; } catch (e) { return []; }
  }
  function svsLoadSyncState() {
    try { return JSON.parse(localStorage.getItem(LS_SYNCED_KEY) || '{}') || {}; } catch (e) { return {}; }
  }
  function svsCapSyncState(obj) {
    var keys = Object.keys(obj);
    if (keys.length <= SYNC_STATE_CAP) return obj;
    // Object のキーは挿入順を保持する（数値様の文字列を除く。client_idは"type|..."形式なので該当しない）。
    // 古い方から間引いて、直近 SYNC_STATE_CAP 件だけ残す。
    var keep = keys.slice(keys.length - SYNC_STATE_CAP);
    var out = {};
    keep.forEach(function (k) { out[k] = obj[k]; });
    return out;
  }
  function svsSaveSyncState(obj) {
    try { setLS(LS_SYNCED_KEY, svsCapSyncState(obj)); } catch (e) {}
  }
  function svsMarkLastSync() {
    try { setLS(LS_LAST_SYNC_KEY, new Date().toISOString()); } catch (e) {}
  }

  // ---- 数値/ハッシュ/正規化ユーティリティ ---------------------------------------
  function svsNum(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  function svsStableJson(o) {
    if (o === null || typeof o !== 'object') return JSON.stringify(o);
    if (Array.isArray(o)) return '[' + o.map(svsStableJson).join(',') + ']';
    return '{' + Object.keys(o).sort().map(function (k) { return JSON.stringify(k) + ':' + svsStableJson(o[k]); }).join(',') + '}';
  }
  function svsHashStr(s) {
    var h = 5381, i = s.length;
    while (i) { h = (h * 33) ^ s.charCodeAt(--i); }
    return (h >>> 0).toString(36);
  }
  // pages/app-v2.js appvNormalizeSlip と同一ロジック（全角数字→半角、ハイフン/空白除去）
  function svsNormalizeSlip(v) {
    return String(v || '')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xfee0); })
      .replace(/[-\s]/g, '')
      .trim();
  }
  // pages/app-v2.js appvImportShippingCsv の keyOf と同一の重複判定キー。
  // ローカル形状(type/itemId/slip/rk)・クラウド形状(ship_type/item_id/row_key)の
  // どちらの行を渡しても同じキーになるようにしてある。
  function svsRowKey(r) {
    r = r || {};
    var type = r.type || r.ship_type || '';
    var slip = svsNormalizeSlip(r.slip);
    var itemId = String(r.itemId || r.item_id || '');
    var rk = r.rk || r.row_key || (Array.isArray(r.raw) ? r.raw.join('') : String(r.raw || ''));
    var idPart = slip || itemId || ('c' + rk);
    return type + '|' + idPart;
  }

  // ---- ローカル行 → Supabase行 / Supabase行 → ローカル行 ------------------------
  // raw（CSV1行まるごと）は意図的に含めない。
  function svsMapOut(userEmail, clientId, r) {
    return {
      user_email: userEmail,
      client_id: clientId,
      ship_type: r.type || r.ship_type || '',
      item_id: r.itemId || r.item_id || '',
      slip: r.slip || '',
      shipping: svsNum(r.shipping),
      company: r.company || '',
      status: r.status || '',
      row_key: r.rk || r.row_key || ''
    };
  }
  function svsMapIn(x) {
    return {
      type: x.ship_type || '',
      row: 0,
      itemId: x.item_id || '',
      slip: x.slip || '',
      shipping: svsNum(x.shipping),
      company: x.company || '',
      status: x.status || '未照合',
      rk: x.row_key || ''
      // raw は意図的に持たせない（クラウドには保存していない）。
      // cloudUpdatedAt は保存後の10000件上限で「新しい順」に残すためだけに使う一時値。
      ,cloudUpdatedAt: x.updated_at || null
    };
  }

  // ---- テーブル未作成エラーの検出 ------------------------------------------------
  function svsIsMissingTableError(status, bodyText) {
    if (status === 404) return true;
    var s = String(bodyText || '');
    return /PGRST205|schema cache|relation .* does not exist|does not exist/i.test(s);
  }
  async function svsReadErrorText(res) {
    try { return await res.text(); } catch (e) { return ''; }
  }

  // ---- 10000件上限を守りつつ、ローカル専用行は絶対に削らない ---------------------
  // ローカル行(localRows)は無条件に全部残す。増える分（クラウドにしか無かった新規行）
  // だけを、上限を超える場合に updated_at が新しい順に間引く。
  // 戻り値の rows が実際に保存する配列、added が実際に取り込めた行（＝呼び出し元が
  // 返す added件数はこちらを使う。addedRows.length ではなく「間引き後」の実数にする）。
  function svsApplyCap(localRows, addedRows) {
    if (localRows.length >= ROW_CAP) return { rows: localRows.slice(), added: [] };
    var room = ROW_CAP - localRows.length;
    if (addedRows.length <= room) return { rows: localRows.concat(addedRows), added: addedRows };
    var sorted = addedRows.slice().sort(function (a, b) {
      var ta = Date.parse(a.cloudUpdatedAt || '') || 0;
      var tb = Date.parse(b.cloudUpdatedAt || '') || 0;
      return tb - ta; // 新しい順
    });
    var kept = sorted.slice(0, room);
    return { rows: localRows.concat(kept), added: kept };
  }

  // ---- push: ローカルの未同期/変更行だけをクラウドへupsert -----------------------
  async function svsPushShippingRows() {
    var cr = svsCreds();
    if (!cr) return { ok: false, error: 'not_logged_in' };
    try {
      var localRows = svsShipRows();
      var synced = svsLoadSyncState();
      var toPush = [];
      var seen = {};
      for (var idx = 0; idx < localRows.length; idx++) {
        var r = localRows[idx];
        var key = svsRowKey(r);
        if (seen[key]) continue; // ローカル配列内の同一キー重複は1件に丸める
        seen[key] = true;
        var out = svsMapOut(cr.em, key, r);
        var hash = svsHashStr(svsStableJson(out));
        if (synced[key] === hash) continue; // 既に同内容で同期済み
        toPush.push({ key: key, out: out, hash: hash });
      }
      if (!toPush.length) {
        return { ok: true, pushed: 0, skipped: localRows.length };
      }
      for (var i = 0; i < toPush.length; i += PUSH_CHUNK) {
        var batch = toPush.slice(i, i + PUSH_CHUNK);
        var res = await fetch(cr.url + '/rest/v1/shipping_rows?on_conflict=user_email,client_id', {
          method: 'POST',
          headers: {
            apikey: cr.key,
            Authorization: 'Bearer ' + cr.tok,
            'Content-Type': 'application/json',
            Prefer: 'resolution=merge-duplicates,return=minimal'
          },
          body: JSON.stringify(batch.map(function (b) { return b.out; }))
        });
        if (!res.ok) {
          var text = await svsReadErrorText(res);
          if (svsIsMissingTableError(res.status, text)) return { ok: false, error: MISSING_TABLE_MSG };
          if (res.status === 401) return { ok: false, error: 'ログインの有効期限が切れています。再ログインしてください。' };
          return { ok: false, error: 'クラウド保存エラー: HTTP ' + res.status + (text ? (' ' + text.slice(0, 200)) : '') };
        }
        batch.forEach(function (b) { synced[b.key] = b.hash; });
      }
      svsSaveSyncState(synced);
      svsMarkLastSync();
      return { ok: true, pushed: toPush.length, skipped: localRows.length - toPush.length };
    } catch (e) {
      return { ok: false, error: '通信エラー: ' + ((e && e.message) || String(e)) };
    }
  }

  // ---- pull: クラウド全件を取得し、ローカルへ追加専用マージ ----------------------
  async function svsPullShippingRows() {
    var cr = svsCreds();
    if (!cr) return { ok: false, error: 'not_logged_in' };
    try {
      var all = [];
      var page = 0;
      while (page < PULL_MAX_PAGES) {
        var url = cr.url + '/rest/v1/shipping_rows?select=*&user_email=eq.' + encodeURIComponent(cr.em) +
          '&order=id.asc&limit=' + PULL_PAGE_SIZE + '&offset=' + (page * PULL_PAGE_SIZE);
        var res = await fetch(url, { headers: { apikey: cr.key, Authorization: 'Bearer ' + cr.tok } });
        if (!res.ok) {
          var text = await svsReadErrorText(res);
          if (svsIsMissingTableError(res.status, text)) return { ok: false, error: MISSING_TABLE_MSG };
          if (res.status === 401) return { ok: false, error: 'ログインの有効期限が切れています。再ログインしてください。' };
          return { ok: false, error: 'クラウド取得エラー: HTTP ' + res.status + (text ? (' ' + text.slice(0, 200)) : '') };
        }
        var data = [];
        try { data = await res.json(); } catch (e) { data = []; }
        data = data || [];
        all = all.concat(data);
        if (data.length < PULL_PAGE_SIZE) break;
        page++;
      }

      var cloudRows = all.map(svsMapIn);
      var localRows = svsShipRows();
      var localKeys = {};
      localRows.forEach(function (r) { localKeys[svsRowKey(r)] = true; });

      var addedRows = [];
      cloudRows.forEach(function (r) {
        var key = svsRowKey(r);
        if (localKeys[key]) return; // 既にローカルにある行は上書きしない（ローカル優先）
        localKeys[key] = true; // クラウド側の重複キーも1件に丸める
        addedRows.push(r);
      });

      var actuallyAdded = 0;
      if (addedRows.length) {
        var capResult = svsApplyCap(localRows, addedRows);
        actuallyAdded = capResult.added.length;
        // cloudUpdatedAtは容量削減が主目的のcap判定専用の一時フィールドなので、
        // 保存前に取り除いてローカル形状(appvShipRowsが元々持つプロパティ)に揃える。
        var merged = capResult.rows.map(function (r) {
          if (r && Object.prototype.hasOwnProperty.call(r, 'cloudUpdatedAt')) {
            var copy = {};
            for (var k in r) { if (k !== 'cloudUpdatedAt') copy[k] = r[k]; }
            return copy;
          }
          return r;
        });
        setLS(LS_ROWS_KEY, merged); // 生のlocalStorage.setItemではなくsetLS（クォータ超過時の自動復旧つき）
      }
      svsMarkLastSync();
      // added は「実際にローカルへ保存できた件数」（10000件上限で間引かれた分は含まない）。
      // クラウド側に何件の新規行があったかは fetched - (ローカルに既にあった件数) で分かる。
      return { ok: true, fetched: cloudRows.length, added: actuallyAdded };
    } catch (e) {
      return { ok: false, error: '通信エラー: ' + ((e && e.message) || String(e)) };
    }
  }

  // ---- pull → push を順に実行し、結果をまとめて返す -----------------------------
  async function svsSyncShippingRows() {
    var pull = await svsPullShippingRows();
    var push = await svsPushShippingRows();
    var ok = !!(pull && pull.ok && push && push.ok);
    return {
      ok: ok,
      fetched: pull ? pull.fetched : 0,
      added: pull ? pull.added : 0,
      pushed: push ? push.pushed : 0,
      skipped: push ? push.skipped : 0,
      error: (pull && !pull.ok && pull.error) || (push && !push.ok && push.error) || null,
      pull: pull,
      push: push
    };
  }

  // ---- 状態表示用 ----------------------------------------------------------------
  function svsGetSyncState() {
    var localCount = svsShipRows().length;
    var synced = svsLoadSyncState();
    var syncedCount = Object.keys(synced).length;
    var lastSyncAt = null;
    try { lastSyncAt = localStorage.getItem(LS_LAST_SYNC_KEY) || null; } catch (e) {}
    return { localCount: localCount, syncedCount: syncedCount, lastSyncAt: lastSyncAt };
  }

  // ---- 公開API ---------------------------------------------------------------
  window.svsPushShippingRows = svsPushShippingRows;
  window.svsPullShippingRows = svsPullShippingRows;
  window.svsSyncShippingRows = svsSyncShippingRows;
  window.svsGetSyncState = svsGetSyncState;
})();
