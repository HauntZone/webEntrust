/* 平台自有页面的通用交互：主题切换、表单确认、Toast。
   只加载在平台页面上，用户托管的页面不会引用它。 */

(function () {
  'use strict';

  var THEMES = ['sky', 'pink'];

  // ------------------------------------------------------------ 主题

  function currentTheme() {
    var t = document.documentElement.getAttribute('data-theme');
    return THEMES.indexOf(t) >= 0 ? t : THEMES[0];
  }

  function syncButtons() {
    var active = currentTheme();
    var buttons = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < buttons.length; i += 1) {
      var on = buttons[i].getAttribute('data-theme-set') === active;
      buttons[i].setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch (e) {
      /* 隐私模式下 localStorage 可能不可用，忽略即可 */
    }
    syncButtons();
  }

  document.addEventListener('click', function (event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var button = target.closest('[data-theme-set]');
    if (button) {
      applyTheme(button.getAttribute('data-theme-set'));
    }
  });

  // ------------------------------------------------------------ 危险操作确认

  // 任何带 data-confirm 的表单提交前问一句
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || typeof form.getAttribute !== 'function') return;

    var message = form.getAttribute('data-confirm');
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  }, true);

  // ------------------------------------------------------------ Toast

  function host() {
    var el = document.querySelector('.toast-host');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast-host';
      document.body.appendChild(el);
    }
    return el;
  }

  function toast(message, kind) {
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' toast-' + kind : '');
    el.textContent = message;
    host().appendChild(el);

    var life = kind === 'error' ? 5200 : 3200;
    setTimeout(function () {
      el.classList.add('is-out');
      setTimeout(function () {
        el.remove();
      }, 220);
    }, life);
  }

  window.toast = toast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncButtons);
  } else {
    syncButtons();
  }
})();
