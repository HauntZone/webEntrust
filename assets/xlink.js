/* 外链拦截。由 lib/inject.js 注入到用户托管的 HTML 里。
 *
 * 注意：这是「礼貌性」功能，不是安全边界。以下都能绕过它：
 *   - 用户在链接上按 Ctrl/中键在新标签打开
 *   - 访客禁用 JS
 *   - 用户页面自带 CSP 禁止内联/外域脚本
 *   - 图片、样式、iframe 等子资源照旧直连外站
 * 配置由注入的前一段内联脚本给出：window.__XLINK__ = {warn, guide, alias}
 */

(function () {
  'use strict';

  var cfg = window.__XLINK__ || {};
  if (!cfg.warn && !cfg.guide) return;

  function isExternal(absoluteUrl) {
    try {
      var url = new URL(absoluteUrl, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      return url.host !== location.host;
    } catch (e) {
      return false;
    }
  }

  document.addEventListener('click', function (event) {
    // 只在"普通左键点击当前窗口"时才有得拦
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var anchor = target.closest('a[href]');
    if (!anchor) return;

    // target=_blank 之类的交给浏览器，拦不住也不该拦
    var anchorTarget = anchor.getAttribute('target');
    if (anchorTarget && anchorTarget !== '_self') return;

    if (!isExternal(anchor.href)) return;

    if (cfg.guide) {
      // 引导优先：走中转页，警告文案在中转页里显示
      event.preventDefault();
      location.href = '/go?url=' + encodeURIComponent(anchor.href);
      return;
    }

    if (cfg.warn) {
      var ok = window.confirm('你即将离开本站，前往：\n' + anchor.href + '\n\n确定要继续吗？');
      if (!ok) event.preventDefault();
    }
  }, true);
})();
