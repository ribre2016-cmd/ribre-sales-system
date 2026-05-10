/* RIBRE — Storage/Cloud pages 移行（Phase1: ver290 の最終定義を pages 側へ集約） */
function ver290CreateBackup() {
  const snap = ver290Snapshot();
  const h = ver290Histories();
  h.unshift({
    id: 'backup_' + Date.now(),
    at: snap.exportedAtJp,
    salesCount: snap.sales.length || snap.yahooSales.length || 0,
    purchaseCount: snap.purchases.length,
    data: snap
  });
  ver290SaveHistories(h);
  ver290Refresh();
  ver290Set('ver290Status', '作成OK');
  ver290Render([
    { type: 'OK', msg: 'バックアップを作成しました' },
    { type: '売上', msg: '売上 ' + (snap.sales.length || snap.yahooSales.length || 0) + '件' },
    { type: '仕入', msg: '仕入 ' + snap.purchases.length + '件' }
  ]);
}
function ver290DownloadBackup() {
  const snap = ver290Snapshot();
  const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ribre_sales_backup_Ver29_0_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  ver290Set('ver290Status', '保存OK');
  ver290Render([{ type: '保存', msg: 'バックアップJSONをダウンロードしました' }]);
}
function ver290RestoreBackup() {
  const file = document.getElementById('ver290BackupFile').files[0];
  if (!file) {
    alert('復元するJSONファイルを選択してください');
    return;
  }
  if (!confirm('現在のブラウザ内データをバックアップ内容で復元します。よろしいですか？')) return;
  const rd = new FileReader();
  rd.onload = () => {
    try {
      const data = JSON.parse(rd.result);
      if (data.sales) localStorage.setItem('ribre_full_sales221', JSON.stringify(data.sales));
      if (data.purchases) localStorage.setItem('ribre_full_purchases221', JSON.stringify(data.purchases));
      if (data.yahooSales) localStorage.setItem('ribre_yahoo_sales240', JSON.stringify(data.yahooSales));
      if (data.shippingRows) localStorage.setItem('ribre_shipping_rows230', JSON.stringify(data.shippingRows));
      if (data.shippingResults) localStorage.setItem('ribre_shipping_results230', JSON.stringify(data.shippingResults));
      if (data.ocrCandidates) localStorage.setItem('ribre_ocr_candidates200', JSON.stringify(data.ocrCandidates));
      if (data.evidences) localStorage.setItem('ribre_full_evidences221', JSON.stringify(data.evidences));
      refreshAll();
      ver290Refresh();
      ver290Set('ver290Status', '復元OK');
      ver290Render([
        { type: '復元', msg: 'バックアップを復元しました' },
        { type: '売上', msg: '売上 ' + ((data.sales || []).length || (data.yahooSales || []).length) + '件' },
        { type: '仕入', msg: '仕入 ' + (data.purchases || []).length + '件' }
      ]);
    } catch (e) {
      ver290Set('ver290Status', 'エラー');
      ver290Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
    }
  };
  rd.readAsText(file);
}
function ver290ShowHistory() {
  const h = ver290Histories();
  if (!h.length) {
    ver290Render([{ type: 'INFO', level: 'warn', msg: 'バックアップ履歴はありません' }]);
    return;
  }
  ver290Render(
    h.map((x) => ({
      type: '履歴',
      msg: x.at + ' / 売上 ' + x.salesCount + '件 / 仕入 ' + x.purchaseCount + '件'
    }))
  );
}
function ver290ClearOldHistory() {
  const h = ver290Histories().slice(0, 5);
  ver290SaveHistories(h);
  ver290Refresh();
  ver290Render([{ type: '整理', msg: '最新5件だけ残しました' }]);
}

window.ver290CreateBackup = ver290CreateBackup;
window.ver290DownloadBackup = ver290DownloadBackup;
window.ver290RestoreBackup = ver290RestoreBackup;
window.ver290ShowHistory = ver290ShowHistory;
window.ver290ClearOldHistory = ver290ClearOldHistory;

/* RIBRE — Storage/Cloud pages 移行（Phase2/3: ver320 の最終定義を pages 側へ集約） */
function ver320Logs() {
  try {
    return JSON.parse(localStorage.getItem('ribre_sync_logs320') || '[]');
  } catch (e) {
    return [];
  }
}
function ver320SaveLogs(arr) {
  localStorage.setItem('ribre_sync_logs320', JSON.stringify((arr || []).slice(0, 300)));
}
function ver320Render(rows) {
  const box = document.getElementById('autosyncList');
  if (!box) return;
  box.innerHTML = (rows || [])
    .map((r) => '<div class="row ' + (r.level || 'ok') + '"><span>' + r.msg + '</span><span class="badge">' + r.type + '</span></div>')
    .join('');
}
function ver320Set(id, v) {
  const el = document.getElementById(id);
  if (el) el.textContent = v;
}
function ver320Log(type, msg, level = 'ok') {
  const arr = ver320Logs();
  arr.unshift({ at: new Date().toLocaleString('ja-JP'), type: type, msg: msg, level: level, user: typeof email === 'function' ? email() : '' });
  ver320SaveLogs(arr);
}
function ver320Hash() {
  try {
    const payload = {
      sales: typeof sales === 'function' ? sales() : [],
      purchases: typeof purchases === 'function' ? purchases() : [],
      yahoo: JSON.parse(localStorage.getItem('ribre_yahoo_sales240') || '[]')
    };
    return JSON.stringify(payload).length + ':' + JSON.stringify(payload).slice(0, 200);
  } catch (e) {
    return String(Date.now());
  }
}
function ver320MarkDirty(reason) {
  localStorage.setItem('ribre_dirty320', '1');
  localStorage.setItem('ribre_dirty_reason320', reason || '変更あり');
  ver320Refresh();
}
function ver320ClearDirty() {
  localStorage.setItem('ribre_dirty320', '0');
  localStorage.setItem('ribre_last_hash320', ver320Hash());
}
function ver320Refresh() {
  const auto = localStorage.getItem('ribre_auto_sync320') === '1';
  const dirty = localStorage.getItem('ribre_dirty320') === '1';
  ver320Set('ver320AutoStatus', auto ? 'ON' : 'OFF');
  ver320Set('ver320DirtyStatus', dirty ? 'あり' : 'なし');
  ver320Set('ver320LastSync', localStorage.getItem('ribre_last_sync320') || 'なし');
}
function ver320ToggleAutoSync() {
  const now = localStorage.getItem('ribre_auto_sync320') === '1';
  localStorage.setItem('ribre_auto_sync320', now ? '0' : '1');
  ver320Refresh();
  ver320Render([{ type: '設定', msg: '自動同期を ' + (now ? 'OFF' : 'ON') + ' にしました' }]);
}
function ver320CheckDirty() {
  const last = localStorage.getItem('ribre_last_hash320') || '';
  const now = ver320Hash();
  const dirty = localStorage.getItem('ribre_dirty320') === '1' || last !== now;
  localStorage.setItem('ribre_dirty320', dirty ? '1' : '0');
  ver320Refresh();
  ver320Render([{ type: dirty ? '変更あり' : 'OK', level: dirty ? 'warn' : 'ok', msg: dirty ? '未同期の変更があります' : '未同期変更はありません' }]);
}
async function ver320SyncNow() {
  if (typeof email === 'function' && !email()) {
    alert('先にログインしてください');
    return;
  }
  if (typeof cloudCheck === 'function') {
    ver320Set('ver320SyncStatus', '接続確認中');
    try {
      await cloudCheck();
    } catch (e) {}
  }
  ver320Set('ver320SyncStatus', '同期中');
  const rows = [];
  try {
    if (typeof uploadSales === 'function') {
      await uploadSales();
      rows.push({ type: '売上', msg: '売上をクラウド同期しました' });
    }
    if (typeof uploadPurchases === 'function') {
      await uploadPurchases();
      rows.push({ type: '仕入', msg: '仕入をクラウド同期しました' });
    }
    const at = new Date().toLocaleString('ja-JP');
    localStorage.setItem('ribre_last_sync320', at);
    ver320ClearDirty();
    ver320Set('ver320SyncStatus', '同期OK');
    ver320Log('同期', 'クラウド同期完了');
    ver320Refresh();
    ver320Render(rows.concat([{ type: 'OK', msg: '同期完了：' + at }]));
  } catch (e) {
    ver320Set('ver320SyncStatus', 'エラー');
    ver320Log('ERROR', e.message, 'danger');
    ver320Render([{ type: 'ERROR', level: 'danger', msg: e.message }]);
  }
}
function ver320ShowSyncLogs() {
  const logs = ver320Logs();
  if (!logs.length) {
    ver320Render([{ type: 'INFO', level: 'warn', msg: '同期履歴はありません' }]);
    return;
  }
  ver320Render(logs.slice(0, 120).map((x) => ({ type: x.type, level: x.level, msg: x.at + ' / ' + x.user + ' / ' + x.msg })));
}
function ver320ExportSyncLogs() {
  const rows = [['日時', 'ユーザー', '区分', '内容', '状態']];
  ver320Logs().forEach((x) => rows.push([x.at, x.user, x.type, x.msg, x.level]));
  csvDownload(rows, 'sync_logs_Ver32_0.csv');
}
function ver320WrapChangeFunctions() {
  const names = ['addSale', 'addPurchase', 'ocrToSale', 'ocrToPurchase', 'ocrAutoRegister', 'importYahooSalesCsv', 'autoMatchShippingFromYahoo', 'ver250ImproveUnmatched'];
  names.forEach((name) => {
    if (typeof window[name] === 'function' && !window['__ver320_' + name]) {
      const old = window[name];
      window[name] = function () {
        const result = old.apply(this, arguments);
        ver320MarkDirty(name);
        if (localStorage.getItem('ribre_auto_sync320') === '1') {
          setTimeout(() => {
            try {
              ver320SyncNow();
            } catch (e) {}
          }, 1200);
        }
        return result;
      };
      window['__ver320_' + name] = true;
    }
  });
}

window.ver320ToggleAutoSync = ver320ToggleAutoSync;
window.ver320SyncNow = ver320SyncNow;
window.ver320CheckDirty = ver320CheckDirty;
window.ver320ShowSyncLogs = ver320ShowSyncLogs;
window.ver320ExportSyncLogs = ver320ExportSyncLogs;

window.addEventListener('load', () => {
  setTimeout(() => {
    ver320Refresh();
    ver320WrapChangeFunctions();
    ver320Render([{ type: '案内', msg: '自動同期をONにすると、登録後にクラウド保存を実行します' }]);
  }, 1600);
});
