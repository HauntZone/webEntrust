'use strict';

/**
 * CSRF 令牌。SameSite=Lax 已经挡掉绝大多数跨站 POST，这里再叠一层显式令牌。
 *
 * 令牌绑定到 (用户 id, sessionEpoch)：改密码 / 强制下线时旧令牌自动作废。
 * 母密钥复用会话密钥，见 sessions.getSecret()。
 */

const crypto = require('crypto');
const sessions = require('./sessions');

function tokenFor(user) {
  if (!user) return '';
  return crypto
    .createHmac('sha256', sessions.getSecret())
    .update(`${user.id}:${user.sessionEpoch || 0}`)
    .digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function presentedToken(req) {
  if (req.body && typeof req.body._csrf === 'string') return req.body._csrf;
  const header = req.get('x-csrf-token');
  return typeof header === 'string' ? header : '';
}

/** 挂在 body 解析 + sessions.attach 之后 */
function protect(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  if (!req.user) return next(); // 未登录的写操作由各自的登录检查兜住

  const expected = tokenFor(req.user);
  if (!expected || !safeEqual(presentedToken(req), expected)) {
    if (req.path.startsWith('/api/') || req.xhr) {
      return res.status(403).json({ error: 'CSRF 校验失败，请刷新页面重试' });
    }
    return res.status(403).send('CSRF 校验失败，请返回上一页刷新后重试');
  }
  return next();
}

module.exports = { tokenFor, protect };
