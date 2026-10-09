'use strict';

const express = require('express');
const router = express.Router();

const html = require('../lib/html');
const users = require('../lib/users');
const sessions = require('../lib/sessions');

/** 只接受站内相对路径，防止 ?next=//evil.com 这种开放重定向 */
function safeNext(value) {
  const next = String(value || '');
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

function loginForm({ error = '', next = '', alias = '' } = {}) {
  return html.page({
    title: '登录',
    bare: true,
    body: `<div class="card center-card">
      <h1 class="card-title">登录</h1>
      ${error ? html.alertBox('error', error) : ''}
      <form method="post" action="/login" class="form">
        <input type="hidden" name="next" value="${html.escapeHtml(next)}">
        <label class="field">别名
          <input name="alias" value="${html.escapeHtml(alias)}" required autofocus
                 autocomplete="username" autocapitalize="off" spellcheck="false">
        </label>
        <label class="field">密码
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        <button class="btn btn-primary btn-block" type="submit">登录</button>
      </form>
      <p class="muted small">还没有账号？<a href="/register">注册一个</a></p>
    </div>`,
  });
}

function registerForm({ error = '', alias = '' } = {}) {
  return html.page({
    title: '注册',
    bare: true,
    body: `<div class="card center-card">
      <h1 class="card-title">注册</h1>

      <div class="alert alert-warn">
        <strong>重要提示</strong><br>
        本项目不对用户信息进行加密存储，请勿使用常用或与其他网站相同的账号密码；
        本项目可能被随时移除，请勿存储重要数据。
      </div>

      ${error ? html.alertBox('error', error) : ''}

      <form method="post" action="/register" class="form">
        <label class="field">别名
          <input name="alias" value="${html.escapeHtml(alias)}" required autofocus
                 autocomplete="username" autocapitalize="off" spellcheck="false"
                 placeholder="你网址里的名字，如 mypage">
          <span class="hint">3-30 位小写字母、数字和短横线，必须以字母开头。注册后不可更改。</span>
        </label>
        <label class="field">密码
          <input type="password" name="password" required autocomplete="new-password">
          <span class="hint">至少 8 位。</span>
        </label>
        <label class="field">再输一次
          <input type="password" name="password2" required autocomplete="new-password">
        </label>
        <button class="btn btn-primary btn-block" type="submit">注册</button>
      </form>
      <p class="muted small">已有账号？<a href="/login">去登录</a></p>
    </div>`,
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  return res.send(loginForm({ next: safeNext(req.query.next) }));
});

router.post('/login', (req, res) => {
  const alias = String(req.body.alias || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const next = safeNext(req.body.next);

  const user = users.findByAlias(alias);
  if (!user || !users.verifyPassword(password, user.pass)) {
    return res.status(401).send(loginForm({ error: '别名或密码不正确', next, alias }));
  }
  if (user.status !== 'active') {
    return res.status(403).send(loginForm({ error: '该账号已被禁用', next, alias }));
  }

  sessions.setSession(req, res, user);
  return res.redirect(next);
});

router.get('/register', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  return res.send(registerForm());
});

router.post('/register', async (req, res) => {
  const rawAlias = String(req.body.alias || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  const aliasCheck = users.validateAlias(rawAlias);
  if (!aliasCheck.ok) {
    return res.status(400).send(registerForm({ error: aliasCheck.error, alias: rawAlias }));
  }
  const passwordCheck = users.validatePassword(password);
  if (!passwordCheck.ok) {
    return res.status(400).send(registerForm({ error: passwordCheck.error, alias: rawAlias }));
  }
  if (password !== password2) {
    return res.status(400).send(registerForm({ error: '两次输入的密码不一致', alias: rawAlias }));
  }

  // role 硬编码，永不接受请求体里的 role
  let user;
  try {
    user = await users.createUser({ alias: aliasCheck.alias, password, role: 'user' });
  } catch (err) {
    console.error('[auth] 注册失败：', err);
    return res.status(500).send(registerForm({ error: '注册失败，请稍后重试', alias: rawAlias }));
  }

  sessions.setSession(req, res, user);
  return res.redirect('/dashboard');
});

router.post('/logout', (req, res) => {
  sessions.clearSession(req, res);
  return res.redirect('/');
});

module.exports = router;
