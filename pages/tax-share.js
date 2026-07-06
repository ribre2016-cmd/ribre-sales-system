/* ==================== 税理士向け共有ページ（ログイン不要・URL1本） ====================
 * URLのハッシュから u(Supabaseプロジェクトのホスト名), t(共有token) を読み取り、
 * 公開バケット tax-share の share/<t>.json をfetchして一覧を描画する。
 * 認証は一切行わない（公開バケットのため）。auth-gate等は読み込まない独立ページ。
 */
(function () {
  'use strict';

  function fmtSize(bytes) {
    var n = Number(bytes) || 0;
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + 'MB';
    if (n >= 1024) return Math.round(n / 1024) + 'KB';
    return n + 'B';
  }

  function fmtMonthTitle(month) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
    if (!m) return month || '(月不明)';
    return m[1] + '年' + parseInt(m[2], 10) + '月';
  }

  function fmtDate(ts) {
    if (!ts) return '-';
    try { return new Date(ts).toLocaleString('ja-JP'); } catch (e) { return '-'; }
  }

  function showError(msg) {
    var statusEl = document.getElementById('status');
    var listEl = document.getElementById('list');
    if (listEl) listEl.innerHTML = '';
    if (statusEl) {
      statusEl.textContent = msg;
      statusEl.className = 'error';
      statusEl.style.display = '';
    }
  }

  function render(manifest) {
    var statusEl = document.getElementById('status');
    var listEl = document.getElementById('list');
    if (statusEl) statusEl.style.display = 'none';
    if (!listEl) return;
    listEl.innerHTML = '';

    var files = (manifest && Array.isArray(manifest.files)) ? manifest.files : [];
    if (!files.length) {
      var empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'ファイルはありません';
      listEl.appendChild(empty);
      return;
    }

    // 月ごとにグループ化（マニフェストは既に month降順→ts降順で並んでいる前提だが、念のため保持順を尊重してグルーピングのみ行う）
    var groups = [];
    var groupByMonth = {};
    files.forEach(function (f) {
      var month = f.month || '(月不明)';
      if (!groupByMonth[month]) {
        groupByMonth[month] = { month: month, items: [] };
        groups.push(groupByMonth[month]);
      }
      groupByMonth[month].items.push(f);
    });

    groups.forEach(function (g) {
      var card = document.createElement('div');
      card.className = 'card';

      var h = document.createElement('div');
      h.className = 'month-title';
      h.textContent = fmtMonthTitle(g.month);
      card.appendChild(h);

      var table = document.createElement('table');
      var thead = document.createElement('thead');
      thead.innerHTML = '<tr><th>ファイル名</th><th>追加日</th><th style="text-align:right">サイズ</th></tr>';
      table.appendChild(thead);

      var tbody = document.createElement('tbody');
      g.items.forEach(function (f) {
        var tr = document.createElement('tr');

        var nameTd = document.createElement('td');
        var a = document.createElement('a');
        a.className = 'file-link';
        a.href = f.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = f.name || '(無題)'; // XSS対策: textContentのみ使用
        nameTd.appendChild(a);

        var dateTd = document.createElement('td');
        dateTd.textContent = fmtDate(f.ts);

        var sizeTd = document.createElement('td');
        sizeTd.style.textAlign = 'right';
        sizeTd.textContent = fmtSize(f.size);

        tr.appendChild(nameTd);
        tr.appendChild(dateTd);
        tr.appendChild(sizeTd);
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      card.appendChild(table);
      listEl.appendChild(card);
    });
  }

  async function main() {
    var params;
    try {
      params = new URLSearchParams(location.hash.slice(1));
    } catch (e) {
      showError('リンクが正しくありません');
      return;
    }
    var u = params.get('u');
    var t = params.get('t');
    if (!u || !t) {
      showError('リンクが正しくありません');
      return;
    }
    // uはSupabaseプロジェクトのホスト名のみを許容（余分なプロトコル混入時は除去）
    var host = String(u).replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (!host) {
      showError('リンクが正しくありません');
      return;
    }
    var manifestUrl = 'https://' + host + '/storage/v1/object/public/tax-share/share/' + encodeURIComponent(t) + '.json';
    try {
      var r = await fetch(manifestUrl, { cache: 'no-store' });
      if (!r.ok) {
        showError('共有が見つかりません（削除された可能性があります）');
        return;
      }
      var manifest = await r.json();
      render(manifest);
    } catch (e) {
      showError('共有が見つかりません（削除された可能性があります）');
    }
  }

  main();
})();
