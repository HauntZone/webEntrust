'use strict';

const path = require('path');
const express = require('express');
const router = express.Router();

const html = require('../lib/html');
const users = require('../lib/users');
const meta = require('../lib/meta');
const csrf = require('../lib/csrf');
const sessions = require('../lib/sessions');
const upload = require('../lib/upload');

const { escapeHtml } = html;

function sitesTable(user, rows) {
  if (rows.length === 0) {
    return '<p class="muted">还没有发布任何站点。上传一个 zip 就能开始了。</p>';
  }
  const body = rows
    .map((row) => {
      const url = `/${escapeHtml(user.alias)}/${escapeHtml(row.folder)}/`;
      return `<tr>
        <td><code>${escapeHtml(row.folder)}</code></td>
        <td>${html.formatBytes(row.size)}</td>
        <td><a href="${url}" target="_blank" rel="noopener">${url}</a></td>
        <td class="right">
          <button class="btn btn-danger btn-sm" type="button"
                  data-delete-site="${escapeHtml(row.folder)}">删除</button>
        </td>
      </tr>`;
    })
    .join('');

  return `<table class="table">
    <thead><tr><th>文件夹</th><th>大小</th><th>访问网址</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function featureRow(name, label, hint, enabled, globallyOff) {
  return `<label class="switch-row${globallyOff ? ' is-disabled' : ''}">
    <span class="switch-label">${escapeHtml(label)}<small>${escapeHtml(hint)}</small></span>
    <input type="checkbox" name="${name}" value="1"
           ${enabled ? 'checked' : ''} ${globallyOff ? 'disabled' : ''}>
  </label>`;
}

router.get('/', sessions.requireLogin, async (req, res, next) => {
  try {
    const user = req.user;
    const folders = await users.listSiteFolders(user.alias);
    const sizes = await Promise.all(
      folders.map(async (folder) => ({
        folder,
        size: await users.dirSize(path.join(users.userDir(user.alias), folder)),
      })),
    );

    const used = sizes.reduce((sum, row) => sum + row.size, 0);
    await users.setUserFields(user.id, { usedBytes: used });

    const quotaBytes = user.quotaMB * 1024 * 1024;
    const percent = quotaBytes > 0 ? Math.min(100, Math.round((used / quotaBytes) * 100)) : 100;

    const globalFlags = meta.getMeta().flags;
    const own = user.features || { warn: true, guide: true };
    const token = csrf.tokenFor(user);

    const body = `
      <div class="card">
        <h2 class="card-title">空间用量</h2>
        <div class="quota-bar" role="progressbar" aria-valuenow="${percent}" aria-valuemin="0" aria-valuemax="100">
          <span style="width:${percent}%"></span>
        </div>
        <p class="muted small">已用 ${html.formatBytes(used)} / ${user.quotaMB} MB（${percent}%）</p>
      </div>

      <div class="card">
        <h2 class="card-title">发布站点</h2>
        <p class="muted small">
          把网页打包成 zip 上传。若同名文件夹已存在，会先清空再解压，旧文件不会残留占配额。
        </p>
        <form id="upload-form" class="form" data-csrf="${escapeHtml(token)}">
          <label class="field">文件夹名
            <input name="folder" required pattern="[a-z0-9][a-z0-9-]{0,30}"
                   placeholder="如 mysite" autocapitalize="off" spellcheck="false">
            <span class="hint">小写字母、数字和短横线。上传后访问 /${escapeHtml(user.alias)}/文件夹名/</span>
          </label>
          <label class="field">zip 压缩包
            <input type="file" name="file" accept=".zip,application/zip" required>
          </label>
          <button class="btn btn-primary" type="submit">上传并解压</button>
        </form>
        <div id="upload-msg" class="alert hidden" role="status"></div>
      </div>

      <div class="card">
        <h2 class="card-title">我的站点</h2>
        ${sitesTable(user, sizes)}
      </div>

      <div class="card">
        <h2 class="card-title">外链功能</h2>
        <p class="muted small">
          访客点击你页面里的站外链接时，可以拦一下。管理员可以全局关闭，那之后你这里的开关就不起作用了。
        </p>
        <form method="post" action="/dashboard/features" class="form">
          ${html.csrfField(token)}
          ${featureRow('warn', '外链警告', '点击站外链接前弹出确认框', own.warn !== false, !globalFlags.warn)}
          ${featureRow('guide', '外链引导', '经过本站中转页，显示目标域名后再跳转', own.guide !== false, !globalFlags.guide)}
          ${!globalFlags.warn || !globalFlags.guide
            ? '<p class="muted small">管理员已全局关闭部分外链功能。</p>'
            : ''}
          <button class="btn btn-primary" type="submit">保存</button>
        </form>
      </div>`;

    return res.send(html.page({
      title: '我的站点',
      active: '/dashboard',
      user,
      csrf: token,
      scripts: ['/_assets/dashboard.js'],
      body,
    }));
  } catch (err) {
    return next(err);
  }
});

router.post('/features', sessions.requireLogin, async (req, res, next) => {
  try {
    const user = req.user;
    await users.setFeature(user.id, 'warn', req.body.warn === '1');
    await users.setFeature(user.id, 'guide', req.body.guide === '1');
    return res.redirect('/dashboard');
  } catch (err) {
    return next(err);
  }
});

router.post('/upload', sessions.requireLogin, (req, res) => {
  upload.handleUpload(req, res);
});

router.post('/sites/delete', sessions.requireLogin, (req, res) => {
  upload.handleDeleteSite(req, res);
});

module.exports = router;
