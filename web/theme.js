/* 黑白两套：在 <head> 里同步加载，先定好颜色再画页面，避免闪一下。
   点顶栏按钮切换并记住；没选过一律用深色 */
(function () {
  var KEY = 'vier-theme', root = document.documentElement;
  function saved() { try { var t = localStorage.getItem(KEY); return t === 'light' || t === 'dark' ? t : null; } catch (e) { return null; } }
  function apply(t) {
    root.dataset.theme = t;
    var meta = document.querySelector('meta[name=theme-color]');
    if (meta) meta.content = t === 'light' ? '#FFFFFF' : '#000000';
    var btn = document.getElementById('theme-btn');
    if (btn) btn.setAttribute('aria-label', t === 'light' ? '换成深色' : '换成浅色');
  }
  apply(saved() || 'dark');
  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('theme-btn');
    if (!btn) return;
    apply(root.dataset.theme);
    btn.addEventListener('click', function () {
      var t = root.dataset.theme === 'light' ? 'dark' : 'light';
      var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (document.startViewTransition && !still) {
        // 从按钮中心画一个圆铺开新颜色
        var r = btn.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        root.style.setProperty('--vt-x', x + 'px'); root.style.setProperty('--vt-y', y + 'px');
        root.style.setProperty('--vt-r', Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 'px');
        document.startViewTransition(function () { apply(t); });
      } else apply(t);
      try { localStorage.setItem(KEY, t); } catch (e) { /* 隐私模式下不记住 */ }
    });
  });
})();
