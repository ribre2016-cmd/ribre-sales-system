/* RIBRE local line icons */
(function () {
  const ICONS = {
    home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
    sales: '<path d="M12 2v20"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6"/>',
    purchase: '<path d="M6 7h12l-1 13H7L6 7Z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
    upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M5 20h14"/>',
    download: '<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/>',
    truck: '<path d="M3 7h11v10H3z"/><path d="M14 10h4l3 3v4h-7z"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/>',
    chart: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 15v-4"/><path d="M12 15V8"/><path d="M16 15v-7"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2 3-.2-.1a1.8 1.8 0 0 0-2-.2 1.8 1.8 0 0 0-1 1.6v.2h-3.5v-.2a1.8 1.8 0 0 0-1-1.6 1.8 1.8 0 0 0-2 .2l-.2.1-2-3 .1-.1A1.7 1.7 0 0 0 6.5 15 1.8 1.8 0 0 0 5 14H4.8v-4H5a1.8 1.8 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L6.1 7l2-3 .2.1a1.8 1.8 0 0 0 2 .2 1.8 1.8 0 0 0 1-1.6v-.2h3.5v.2a1.8 1.8 0 0 0 1 1.6 1.8 1.8 0 0 0 2-.2l.2-.1 2 3-.1.1a1.7 1.7 0 0 0-.3 1.9 1.8 1.8 0 0 0 1.5 1h.2v4H21a1.8 1.8 0 0 0-1.6 1Z"/>',
    scan: '<path d="M4 7V5a1 1 0 0 1 1-1h2"/><path d="M17 4h2a1 1 0 0 1 1 1v2"/><path d="M20 17v2a1 1 0 0 1-1 1h-2"/><path d="M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M8 9h8"/><path d="M8 13h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/>',
    backup: '<path d="M12 3a9 9 0 1 0 8.5 12"/><path d="M21 10V4h-6"/><path d="M21 4 13 12"/><path d="M12 8v5l3 2"/>',
    sync: '<path d="M20 7h-5a6 6 0 0 0-10 2"/><path d="m17 4 3 3-3 3"/><path d="M4 17h5a6 6 0 0 0 10-2"/><path d="m7 20-3-3 3-3"/>',
    lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 7.5-2"/>',
    edit: '<path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"/><path d="m13 6 5 5"/>',
    trash: '<path d="M4 7h16"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M6 7l1 14h10l1-14"/><path d="M9 7V4h6v3"/>',
    file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/>',
    save: '<path d="M5 4h12l2 2v14H5z"/><path d="M8 4v6h8"/><path d="M8 20v-6h8v6"/>',
    plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
    login: '<path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 4h5v16h-5"/>',
    logout: '<path d="M14 17l5-5-5-5"/><path d="M19 12H8"/><path d="M10 4H5v16h5"/>',
    clear: '<path d="M7 7 17 17"/><path d="M17 7 7 17"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
    arrowUp: '<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    manual: '<path d="M4 20h4l10.5-10.5a2.5 2.5 0 0 0-4-3L4 17v3Z"/><path d="M13 7l4 4"/>',
    ai: '<path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.6 5.6 2.1 2.1"/><path d="m16.3 16.3 2.1 2.1"/><path d="m18.4 5.6-2.1 2.1"/><path d="m7.7 16.3-2.1 2.1"/><circle cx="12" cy="12" r="4"/>'
  };

  function icon(name) {
    const body = ICONS[name] || ICONS.file;
    return '<span class="ui-icon" aria-hidden="true"><svg viewBox="0 0 24 24">' + body + '</svg></span>';
  }

  function cleanText(node) {
    node.childNodes.forEach((child) => {
      if (child.nodeType !== 3) return;
      child.nodeValue = child.nodeValue.replace(/^[\s\uE000-\uF8FF\u2190-\u21FF\u2300-\u23FF\u2460-\u24FF\u2600-\u27BF\u{1F300}-\u{1FAFF}]+/u, '');
    });
  }

  function inferIcon(text, onclick, id) {
    const t = String(text || '') + ' ' + String(onclick || '') + ' ' + String(id || '');
    if (/dash|home|ホーム/.test(t)) return 'home';
    if (/sale|sales|売上/.test(t)) return 'sales';
    if (/purchase|purchases|仕入/.test(t)) return 'purchase';
    if (/shipping|配送|照合/.test(t)) return 'truck';
    if (/analytics|集計|分析|chart|レポート/.test(t)) return 'chart';
    if (/ocr|証憑|scan|画像|PDF/.test(t)) return 'scan';
    if (/CSV|取込|import|upload|保存|登録/.test(t)) return /保存/.test(t) ? 'save' : 'upload';
    if (/download|出力|ダウンロード|Export|export/.test(t)) return 'download';
    if (/sync|同期|Pull|Push|本番→|端末→/.test(t)) return 'sync';
    if (/backup|バックアップ|復元/.test(t)) return 'backup';
    if (/setting|設定|login|ログイン|Supabase|OpenAI/.test(t)) return /ログアウト/.test(t) ? 'logout' : 'settings';
    if (/search|検索|絞/.test(t)) return 'search';
    if (/lock|ロック|締め/.test(t)) return /解除/.test(t) ? 'unlock' : 'lock';
    if (/delete|削除|消す|クリア/.test(t)) return /クリア/.test(t) ? 'clear' : 'trash';
    if (/edit|編集|修正|メモ/.test(t)) return 'edit';
    if (/その他|menu|btnOther/.test(t)) return 'menu';
    if (/前の月/.test(t)) return 'arrowLeft';
    if (/次の月/.test(t)) return 'arrowRight';
    if (/AI/.test(t)) return 'ai';
    return '';
  }

  function enhanceButton(btn, forcedIcon) {
    if (!btn || btn.dataset.iconEnhanced === '1') return;
    if (btn.dataset.noIcon === '1') return;
    const name = forcedIcon || btn.dataset.icon || inferIcon(btn.textContent, btn.getAttribute('onclick'), btn.id);
    if (!name) return;
    btn.dataset.iconEnhanced = '1';
    btn.classList.add('has-ui-icon');
    cleanText(btn);
    btn.insertAdjacentHTML('afterbegin', icon(name));
  }

  function enhanceIconSpan(span, name) {
    if (!span || span.dataset.iconEnhanced === '1') return;
    span.dataset.iconEnhanced = '1';
    span.innerHTML = icon(name || 'file');
  }

  function enhanceStatic() {
    document.querySelectorAll('nav button, .controls button, .dash-sub-btn, .wf-step, .smp-btn, .smp-choice-btn, .smp-back-btn, .ver310-fixed-action').forEach((el) => enhanceButton(el));
    document.querySelectorAll('.smp-nav-item').forEach((item) => {
      const name = item.dataset.nav === 'home' ? 'home' : item.dataset.nav === 'inbox' ? 'upload' : item.dataset.nav === 'manual' ? 'manual' : 'chart';
      enhanceIconSpan(item.querySelector('.smp-nav-ico'), name);
    });
    document.querySelectorAll('.smp-action').forEach((item) => {
      const name = inferIcon(item.textContent, item.getAttribute('onclick'), '');
      enhanceIconSpan(item.querySelector('.smp-action-emoji'), name || 'file');
    });
    document.querySelectorAll('.sales-memo-edit-btn').forEach((btn) => enhanceButton(btn, 'edit'));
    document.querySelectorAll('.smp-recent-del').forEach((btn) => enhanceButton(btn, 'trash'));
    document.querySelectorAll('.smp-ship-unlock').forEach((btn) => enhanceButton(btn, 'unlock'));
  }

  function start() {
    enhanceStatic();
    const mo = new MutationObserver(() => enhanceStatic());
    mo.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.ribreEnhanceIcons = enhanceStatic;
})();
