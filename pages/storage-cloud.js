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
