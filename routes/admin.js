'use strict';

const fsp = require('fs').promises;
const express = require('express');
const router = express.Router();

const html = require('../lib/html');
const users = require('../lib/users');
const meta = require('../lib/meta');
const csrf = require('../lib/csrf');
const sessions = require('../lib/sessions');

const { escapeHtml } = html;

function notFound(res) {
  return res.status(404).send(html.errorPage(404, '页面不存在'));
}

function activeAdminCount(exceptId) {
  return users.listUsers()
    .filter((u) => u.role === 'admin' && u.status === 'active' && u.id !== exceptId)
    .length;
}

// ---------------------------------------------------------------- 初始化管理员
// 只在一个管理员都没有的时候存在；一旦创建过，这个路由就永久 404。

router.get('/setup', (req, res) => {
  if (users.hasAdmin()) return notFound(res);

  const body = `<div class="card center-card">
    <h1 class="card-title">初始化管理员</h1>
    <p class="muted small">系统里还没有管理员。这个页面一旦用完就会永久关闭。</p>
    ${req.query.error ? html.alertBox('error', String(req.query.error)) : ''}
    <form method="post" action="/admin/setup" class="form">
      <label class="field">管理员别名
        <input name="alias" required value="owner" autocapitalize="off" spellcheck="false">
        <span class="hint">这同时也是你的登录名和站点路径。admin、login、dashboard 等平台路径已被占用。</span>
      </label>
      <label class="field">密码
        <input type="password" name="password" required autocomplete="new-password">
        <span class="hint">至少 8 位。</span>
      </label>
      <label class="field">再输一次
        <input type="password" name="password2" required autocomplete="new-password">
      </label>
      <button class="btn btn-primary btn-block" type="submit">创建管理员</button>
    </form>
  </div>`;

  return res.send(html.page({ title: '初始化管理员', bare: true, body }));
});

router.post('/setup', async (req, res) => {
  if (users.hasAdmin()) return notFound(res);

  const rawAlias = String(req.body.alias || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const password2 = String(req.body.password2 || '');

  const aliasCheck = users.validateAlias(rawAlias);
  const passwordCheck = users.validatePassword(password);

  const fail = (message) => res.redirect(`/admin/setup?error=${encodeURIComponent(message)}`);
  if (!aliasCheck.ok) return fail(aliasCheck.error);
  if (!passwordCheck.ok) return fail(passwordCheck.error);
  if (password !== password2) return fail('两次输入的密码不一致');

  try {
    await users.createUser({ alias: aliasCheck.alias, password, role: 'admin', quotaMB: 1024 });
  } catch (err) {
    console.error('[admin] 创建管理员失败：', err);
    return fail('创建失败，请重试');
  }

  return res.redirect('/login');
});

// ---------------------------------------------------------------- 用户管理

function userRow(u, used, selfId, token) {
  const isSelf = u.id === selfId;
  const disabled = u.status !== 'active';
  const quotaBytes = u.quotaMB * 1024 * 1024;
  const percent = quotaBytes > 0 ? Math.min(100, Math.round((used / quotaBytes) * 100)) : 0;

  return `<tr class="${disabled ? 'is-disabled' : ''}">
    <td><code>${escapeHtml(u.alias)}</code>${isSelf ? ' <span class="badge">你</span>' : ''}</td>
    <td>${u.role === 'admin' ? '<span class="badge badge-accent">管理员</span>' : '用户'}</td>
    <td>${disabled ? '<span class="badge badge-muted">已禁用</span>' : '<span class="badge">正常</span>'}</td>
    <td>
      <div class="mini-bar" title="${escapeHtml(html.formatBytes(used))} / ${u.quotaMB} MB">
        <span style="width:${percent}%"></span>
      </div>
      <span class="muted small">${escapeHtml(html.formatBytes(used))} / ${u.quotaMB} MB</span>
    </td>
    <td class="muted small">${escapeHtml(new Date(u.createdAt).toLocaleString('zh-CN'))}</td>
    <td class="right nowrap">
      <form method="post" action="/admin/users/${escapeHtml(u.id)}/status" class="inline">
        ${html.csrfField(token)}
        <input type="hidden" name="status" value="${disabled ? 'active' : 'disabled'}">
        <button class="btn btn-sm" type="submit" ${isSelf ? 'disabled' : ''}>${disabled ? '启用' : '禁用'}</button>
      </form>
      <form method="post" action="/admin/users/${escapeHtml(u.id)}/logout" class="inline">
        ${html.csrfField(token)}
        <button class="btn btn-sm" type="submit">强制下线</button>
      </form>
      <form method="post" action="/admin/users/${escapeHtml(u.id)}/delete" class="inline" data-confirm="确定删除用户 ${escapeHtml(u.alias)} 及其全部站点文件？此操作不可撤销。">
        ${html.csrfField(token)}
        <button class="btn btn-sm btn-danger" type="submit" ${isSelf ? 'disabled' : ''}>删除</button>
      </form>
    </td>
  </tr>`;
}

router.get('/', sessions.requireAdmin, async (req, res, next) => {
  try {
    const token = csrf.tokenFor(req.user);
    const list = users.listUsers();

    const rows = [];
    for (const u of list) {
      const used = await users.recalcUsage(u.alias);
      rows.push({ user: u, used });
    }
    // 用量落库，下次后台就不用再全量扫盘
    await Promise.all(rows.map((r) => users.setUserFields(r.user.id, { usedBytes: r.used })));

    const totalUsed = rows.reduce((sum, r) => sum + r.used, 0);
    const activeCount = list.filter((u) => u.status === 'active').length;

    const body = `
      <div class="card">
        <h2 class="card-title">概览</h2>
        <div class="stat-row">
          <div class="stat"><div class="stat-num">${list.length}</div><div class="stat-label">用户总数</div></div>
          <div class="stat"><div class="stat-num">${activeCount}</div><div class="stat-label">正常</div></div>
          <div class="stat"><div class="stat-num">${html.formatBytes(totalUsed)}</div><div class="stat-label">总占用</div></div>
        </div>
      </div>

      <div class="card">
        <h2 class="card-title">新建用户</h2>
        <p class="muted small">正常情况下用户自己注册就行，这里用于代客建号。</p>
        <form method="post" action="/admin/users/create" class="form form-inline">
          ${html.csrfField(token)}
          <label class="field">别名<input name="alias" required autocapitalize="off" spellcheck="false"></label>
          <label class="field">密码<input type="password" name="password" required autocomplete="new-password"></label>
          <label class="field">配额 (MB)<input type="number" name="quotaMB" min="1" value="${meta.getMeta().defaultQuotaMB}"></label>
          <button class="btn btn-primary" type="submit">创建</button>
        </form>
      </div>

      <div class="card">
        <h2 class="card-title">用户列表</h2>
        ${list.length === 0 ? '<p class="muted">还没有用户。</p>' : `<table class="table">
          <thead><tr><th>别名</th><th>角色</th><th>状态</th><th>用量</th><th>注册时间</th><th></th></tr></thead>
          <tbody>${rows.map((r) => userRow(r.user, r.used, req.user.id, token)).join('')}</tbody>
        </table>`}
        <p class="muted small">改配额和重置密码：在上表的用量列下方，或直接用下方表单（按别名操作）。</p>
        <form method="post" action="/admin/users/quota" class="form form-inline">
          ${html.csrfField(token)}
          <label class="field">别名<input name="alias" required autocapitalize="off" spellcheck="false"></label>
          <label class="field">新配额 (MB)<input type="number" name="quotaMB" min="1" required></label>
          <button class="btn" type="submit">改配额</button>
        </form>
        <form method="post" action="/admin/users/password" class="form form-inline">
          ${html.csrfField(token)}
          <label class="field">别名<input name="alias" required autocapitalize="off" spellcheck="false"></label>
          <label class="field">新密码<input type="password" name="password" minlength="8" required autocomplete="new-password"></label>
          <button class="btn" type="submit">重置密码</button>
        </form>
      </div>`;

    return res.send(html.page({ title: '用户管理', active: '/admin', user: req.user, csrf: token, body, wide: true }));
  } catch (err) {
    return next(err);
  }
});

router.post('/users/create', sessions.requireAdmin, async (req, res, next) => {
  try {
    const rawAlias = String(req.body.alias || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const quotaMB = Number(req.body.quotaMB);

    const aliasCheck = users.validateAlias(rawAlias);
    const passwordCheck = users.validatePassword(password);
    if (!aliasCheck.ok || !passwordCheck.ok) {
      return res.status(400).send(html.errorPage(400, (aliasCheck.error || passwordCheck.error), req.user));
    }

    await users.createUser({ alias: aliasCheck.alias, password, role: 'user', quotaMB });
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

/** 上表里的启停按钮走这个 */
router.post('/users/:id/status', sessions.requireAdmin, async (req, res, next) => {
  try {
    const target = users.findById(req.params.id);
    if (!target) return notFound(res);

    const next_ = req.body.status === 'disabled' ? 'disabled' : 'active';

    // 别把最后一个管理员关掉，否则谁也进不来了
    if (next_ === 'disabled' && target.role === 'admin' && activeAdminCount(target.id) === 0) {
      return res.status(400).send(html.errorPage(400, '不能禁用系统里唯一的管理员', req.user));
    }

    await users.setStatus(target.id, next_);
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

router.post('/users/:id/logout', sessions.requireAdmin, async (req, res, next) => {
  try {
    const target = users.findById(req.params.id);
    if (!target) return notFound(res);
    await users.forceLogout(target.id);
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

router.post('/users/:id/delete', sessions.requireAdmin, async (req, res, next) => {
  try {
    const target = users.findById(req.params.id);
    if (!target) return notFound(res);

    if (target.role === 'admin' && activeAdminCount(target.id) === 0) {
      return res.status(400).send(html.errorPage(400, '不能删除系统里唯一的管理员', req.user));
    }

    await users.deleteUser(target.id);
    // 连同磁盘上的站点目录一起清掉
    await fsp.rm(users.userDir(target.alias), { recursive: true, force: true }).catch(() => {});
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

router.post('/users/quota', sessions.requireAdmin, async (req, res, next) => {
  try {
    const target = users.findByAlias(req.body.alias);
    const quotaMB = Number(req.body.quotaMB);
    if (!target) return res.status(404).send(html.errorPage(404, '用户不存在', req.user));
    if (!Number.isFinite(quotaMB) || quotaMB < 1) {
      return res.status(400).send(html.errorPage(400, '配额必须是不小于 1 的数字', req.user));
    }
    await users.setQuota(target.id, Math.round(quotaMB));
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

router.post('/users/password', sessions.requireAdmin, async (req, res, next) => {
  try {
    const target = users.findByAlias(req.body.alias);
    const password = String(req.body.password || '');
    if (!target) return res.status(404).send(html.errorPage(404, '用户不存在', req.user));

    const check = users.validatePassword(password);
    if (!check.ok) return res.status(400).send(html.errorPage(400, check.error, req.user));

    await users.setPassword(target.id, password);
    return res.redirect('/admin');
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------- 系统设置

router.get('/settings', sessions.requireAdmin, (req, res) => {
  const token = csrf.tokenFor(req.user);
  const flags = meta.getMeta().flags;
  const reserved = users.reservedAliases();

  const body = `
    <div class="card">
      <h2 class="card-title">外链功能（全局）</h2>
      <p class="muted small">
        关掉之后，所有用户站点立即停止注入对应脚本，用户自己打开也没用。
      </p>
      <form method="post" action="/admin/settings/flags" class="form">
        ${html.csrfField(token)}
        <label class="switch-row">
          <span class="switch-label">外链警告<small>点击站外链接前弹确认框</small></span>
          <input type="checkbox" name="warn" value="1" ${flags.warn ? 'checked' : ''}>
        </label>
        <label class="switch-row">
          <span class="switch-label">外链引导<small>经过 /go 中转页，显示目标域名</small></span>
          <input type="checkbox" name="guide" value="1" ${flags.guide ? 'checked' : ''}>
        </label>
        <button class="btn btn-primary" type="submit">保存</button>
      </form>
    </div>

    <div class="card">
      <h2 class="card-title">保留别名</h2>
      <p class="muted small">
        这些名字不能被注册为别名。一行一个。平台自用的路径（login、admin 等）已经由规则排除，不必列在这里。
      </p>
      <form method="post" action="/admin/settings/reserved" class="form">
        ${html.csrfField(token)}
        <label class="field">
          <textarea name="aliases" rows="12" spellcheck="false">${escapeHtml(reserved.join('\n'))}</textarea>
        </label>
        <button class="btn btn-primary" type="submit">保存</button>
      </form>
    </div>`;

  return res.send(html.page({ title: '系统设置', active: '/admin/settings', user: req.user, csrf: token, body }));
});

router.post('/settings/flags', sessions.requireAdmin, async (req, res, next) => {
  try {
    await meta.setFlag('warn', req.body.warn === '1');
    await meta.setFlag('guide', req.body.guide === '1');
    return res.redirect('/admin/settings');
  } catch (err) {
    return next(err);
  }
});

router.post('/settings/reserved', sessions.requireAdmin, async (req, res, next) => {
  try {
    const aliases = String(req.body.aliases || '')
      .split(/\r?\n/)
      .map((line) => line.trim().toLowerCase())
      .filter(Boolean);
    await users.setReservedAliases(aliases);
    return res.redirect('/admin/settings');
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
