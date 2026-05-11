/* RIBRE — Mobile UI script pages 移行（ver310-mobile-script） */
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      const isMobile = window.innerWidth <= 760;
      if (isMobile) {
        const box = document.getElementById('dashList');
        if (box) {
          box.innerHTML =
            '<div class="row ok"><span>スマホ表示を最適化しました。上部メニューは横スクロールできます。</span><span class="badge">Ver60.0</span></div>' +
            box.innerHTML;
        }
      }
    } catch (e) {}
  }, 1500);
});
