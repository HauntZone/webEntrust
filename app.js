'use strict';

/**
 * 平台中间件链。
 *
 * 注意顺序，尤其是两点：
 *   1. sessions.attach 必须在 cookieParser 之后、routes 之前。
 *   2. routes/site.js（用户站点 catch-all）必须最后挂载。
 *
 * 原来的 express.static(public) 那行一定要删掉 —— 留着它会先于 routes/site.js
 * 命中，用户内容就会绕过外链注入和"用户是否被禁用"的检查。
 * 平台自身资源改从 assets/ 经 /_assets 提供。
 */

const createError = require('http-errors');
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const logger = require('morgan');

const html = require('./lib/html');
const meta = require('./lib/meta');
const users = require('./lib/users');
const sessions = require('./lib/sessions');
const csrf = require('./lib/csrf');

const app = express();

sessions.warnIfEphemeral();

// 首次启动补齐数据文件；失败不阻断启动，读路径本身对缺文件是容错的
Promise.all([meta.ensureMeta(), users.ensureReserved()]).catch((err) => {
  console.error('[init] 初始化数据文件失败：', err.message);
});

app.use(logger('dev'));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());

app.use(sessions.attach);
app.use(csrf.protect);

app.use('/_assets', express.static(path.join(__dirname, 'assets'), { maxAge: '1h' }));

app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/dashboard', require('./routes/dashboard'));
app.use('/admin', require('./routes/admin'));
app.use('/go', require('./routes/go'));
app.use('/support', require('./routes/support'));
app.use('/', require('./routes/site'));

// 走到这里基本只剩根路径以外的空路径
app.use((req, res, next) => next(createError(404)));

app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error('[error]', err);

  // 上传接口是 fetch 调的，用 JSON 回话才有意义
  const wantsJson = req.xhr || String(req.get('accept') || '').includes('application/json');
  if (wantsJson) return res.status(status).json({ error: err.message });

  const message = status === 404
    ? '页面不存在'
    : status === 500
      ? '服务器内部错误'
      : err.message;

  return res.status(status).send(html.errorPage(status, message, req.user));
});

module.exports = app;
