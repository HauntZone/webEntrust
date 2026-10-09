'use strict';

/**
 * 外链中转页。
 *
 * 它本身是平台自有页面，所以用平台样式；用户托管的页面则绝不引用这套 CSS。
 * 这是"开放重定向"，但正因如此：只放行 http/https，且页面上明写目标域名，
 * 让人能看清自己要跳去哪。
 */

const express = require('express');
const router = express.Router();

const html = require('../lib/html');

router.get('/', (req, res) => {
  const raw = String(req.query.url || '');
  let target = null;
  let host = '';

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      target = parsed.toString();
      host = parsed.host;
    }
  } catch {
    target = null;
  }

  if (!target) {
    return res.status(400).send(html.page({
      title: '链接无效',
      bare: true,
      body: `<div class="card center-card">
        <h1 class="card-title">链接无效</h1>
        <p class="muted">这个外链地址无法识别，或不是 http/https 链接。</p>
        <button class="btn" type="button" onclick="history.back()">返回上一页</button>
      </div>`,
    }));
  }

  return res.send(html.page({
    title: '即将离开本站',
    bare: true,
    body: `<div class="card center-card">
      <h1 class="card-title">即将离开本站</h1>
      <p class="muted">你要访问的是外部网站，本站无法保证其内容安全。</p>
      <p class="target-host">${html.escapeHtml(host)}</p>
      <p class="target-url">${html.escapeHtml(target)}</p>
      <div class="row center">
        <a class="btn btn-primary" href="${html.escapeHtml(target)}" rel="noopener noreferrer nofollow">继续访问</a>
        <button class="btn" type="button" onclick="history.back()">取消</button>
      </div>
    </div>`,
  }));
});

module.exports = router;
