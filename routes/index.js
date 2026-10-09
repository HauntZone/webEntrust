'use strict';

const express = require('express');
const router = express.Router();

const html = require('../lib/html');
const users = require('../lib/users');

router.get('/', (req, res) => {
  if (req.user) {
    return res.redirect(req.user.role === 'admin' ? '/admin' : '/dashboard');
  }

  const needsSetup = !users.hasAdmin();

  const body = `<div class="card center-card">
    <h1 class="hero">静态网页托管</h1>
    <p class="muted">把做好的网页打包成 zip 上传，马上得到一个可以分享的网址。</p>
    <div class="row center">
      <a class="btn btn-primary" href="/register">注册账号</a>
      <a class="btn" href="/login">登录</a>
    </div>
    ${needsSetup ? '<p class="muted small">系统还没有管理员，<a href="/admin/setup">点此初始化</a>。</p>' : ''}
  </div>`;

  return res.send(html.page({ title: '静态网页托管', bare: true, body }));
});

module.exports = router;
