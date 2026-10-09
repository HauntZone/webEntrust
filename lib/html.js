'use strict';

/**
 * 模板层 —— 原生模板字符串，不引入模板引擎。
 *
 * 这套样式只服务于平台自有页面（/、/login、/register、/dashboard、/admin、/go）。
 * 用户托管的页面走 lib/inject.js，与这里完全无关。
 */

const config = require('./config');

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** 任何拼进 HTML 的用户数据都必须过这里 */
function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** 拼 URL 查询参数用 */
function encode(value) {
  return encodeURIComponent(String(value));
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown = value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1);
  return `${shown} ${units[unit]}`;
}

function csrfField(csrf) {
  return `<input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">`;
}

const NAV = [
  { href: '/dashboard', label: '我的站点', match: '/dashboard', roles: ['user', 'admin'] },
  { href: '/admin', label: '用户管理', match: '/admin', roles: ['admin'] },
  { href: '/admin/settings', label: '系统设置', match: '/admin/settings', roles: ['admin'] },
  { href: '/support', label: '赞赏支持', match: '/support', roles: ['user', 'admin'] },
];

function renderNav(user, active) {
  return NAV
    .filter((item) => user && item.roles.includes(user.role))
    .map((item) => {
      const on = active === item.match ? ' is-active' : '';
      return `<a class="nav-item${on}" href="${item.href}">${escapeHtml(item.label)}</a>`;
    })
    .join('');
}

/**
 * 主题在首屏渲染前就要定下来，否则会闪一下默认色。
 * 这段脚本放在 <head> 里、样式表之前执行。
 */
function themeBootstrapScript() {
  return `<script>(function(){try{var t=localStorage.getItem('theme');` +
    `if(${JSON.stringify(config.THEMES)}.indexOf(t)>=0){document.documentElement.dataset.theme=t}}catch(e){}})()</script>`;
}

function themeToggle() {
  return `<div class="theme-toggle" role="group" aria-label="主题色">
    <button type="button" data-theme-set="sky"  title="天蓝" aria-label="天蓝"></button>
    <button type="button" data-theme-set="pink" title="粉红" aria-label="粉红"></button>
  </div>`;
}

/**
 * 完整页面。
 *   bare = true  → 不渲染侧边栏/顶栏，用于登录、注册、/go 中转页、错误页
 */
function page({ title, body, user = null, active = '', csrf = '', bare = false, wide = false, scripts = [] }) {
  const scriptsTag = ['/_assets/ui.js', ...scripts]
    .map((src) => `<script src="${src}" defer></script>`)
    .join('\n');

  const head = `<!doctype html>
<html lang="zh-CN" data-theme="${config.DEFAULT_THEME}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${themeBootstrapScript()}
<link rel="stylesheet" href="/_assets/platform.css">
</head>`;

  const topbar = user ? `<header class="topbar">
    <div class="topbar-title">${escapeHtml(title)}</div>
    <div class="topbar-actions">
      ${themeToggle()}
      <span class="who">${escapeHtml(user.alias)}${user.role === 'admin' ? '<span class="badge">管理员</span>' : ''}</span>
      <form method="post" action="/logout" class="inline">${csrfField(csrf)}<button class="btn btn-ghost" type="submit">退出</button></form>
    </div>
  </header>` : '';

  if (bare) {
    return `${head}
<body class="is-bare">
${themeToggle()}
<main class="bare-main">${body}</main>
${scriptsTag}
</body>
</html>`;
  }

  return `${head}
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><span class="brand-dot"></span>静态托管</div>
    <nav class="nav">${renderNav(user, active)}</nav>
  </aside>
  <div class="main">
    ${topbar}
    <main class="content${wide ? ' is-wide' : ''}">${body}</main>
  </div>
</div>
${scriptsTag}
</body>
</html>`;
}

/** 卡片容器 */
function card(title, body, extraClass = '') {
  const heading = title ? `<h2 class="card-title">${escapeHtml(title)}</h2>` : '';
  return `<section class="card ${extraClass}">${heading}${body}</section>`;
}

/** 提示条。kind: info | warn | error | ok */
function alertBox(kind, text) {
  return `<div class="alert alert-${escapeHtml(kind)}">${escapeHtml(text)}</div>`;
}

function errorPage(status, message, user = null) {
  return page({
    title: `${status}`,
    user,
    bare: !user,
    body: `<div class="card center-card">
      <div class="err-code">${escapeHtml(status)}</div>
      <p class="err-msg">${escapeHtml(message)}</p>
      <a class="btn" href="/">回到首页</a>
    </div>`,
  });
}

module.exports = {
  escapeHtml,
  encode,
  formatBytes,
  csrfField,
  page,
  card,
  alertBox,
  errorPage,
  themeToggle,
  themeBootstrapScript,
};
