'use strict';

/**
 * 无状态会话：Cookie 里装的是 base64url(载荷) + '.' + HMAC 签名，服务端不存任何东西。
 *
 * 代价是无法单独吊销某个会话 —— 所以载荷里带 epoch，用户记录里也有 sessionEpoch。
 * 改密码、禁用、强制下线时把 epoch +1，所有旧 Cookie 立刻全部失效。
 */

const crypto = require('crypto');
const config = require('./config');
const users = require('./users');

let secret = config.SESSION_SECRET;
let ephemeral = false;

if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  ephemeral = true;
}

function getSecret() {
  return secret;
}

function isEphemeral() {
  return ephemeral;
}

function warnIfEphemeral() {
  if (ephemeral) {
    console.warn(
      '[会话] 未设置 SESSION_SECRET 环境变量，已生成随机密钥。' +
      '服务器重启后所有登录都会失效；生产环境请设置 SESSION_SECRET。',
    );
  }
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token) return null;
  const idx = token.lastIndexOf('.');
  if (idx <= 0) return null;

  const body = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || Date.now() > data.exp) return null;
    return data;
  } catch {
    return null;
  }
}

function buildCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.SESSION_TTL_MS,
    secure: !!(req && (req.secure || req.get('x-forwarded-proto') === 'https')),
  };
}

function setSession(req, res, user) {
  const token = sign({
    p: user.id,
    r: user.role,
    epoch: user.sessionEpoch || 0,
    exp: Date.now() + config.SESSION_TTL_MS,
  });
  res.cookie(config.COOKIE_NAME, token, buildCookieOptions(req));
}

function clearSession(req, res) {
  const opts = buildCookieOptions(req);
  delete opts.maxAge;
  res.clearCookie(config.COOKIE_NAME, opts);
}

/** 每个请求解析 Cookie → req.user（或 null）。挂在 cookieParser 之后。 */
function attach(req, res, next) {
  req.user = null;
  const data = verifyToken(req.cookies && req.cookies[config.COOKIE_NAME]);

  if (data) {
    const user = users.findById(data.p);
    // 用户被删、被禁用、或 epoch 变了 —— 一律当作未登录
    if (user && user.status === 'active' && (user.sessionEpoch || 0) === data.epoch) {
      req.user = user;
      // 剩余寿命不足一半时才续签，避免每个请求都写 Set-Cookie
      if (data.exp - Date.now() < config.SESSION_TTL_MS / 2) {
        setSession(req, res, user);
      }
    }
  }
  next();
}

function requireLogin(req, res, next) {
  if (req.user) return next();
  if (req.xhr || req.get('accept') === 'application/json' || req.path.startsWith('/api/')) {
    return res.status(401).json({ error: '请先登录' });
  }
  const next_ = encodeURIComponent(req.originalUrl || '/dashboard');
  return res.redirect(`/login?next=${next_}`);
}

function requireAdmin(req, res, next) {
  if (!req.user) return requireLogin(req, res, next);
  if (req.user.role !== 'admin') {
    return res.status(403).send('只有管理员可以访问');
  }
  return next();
}

module.exports = {
  attach,
  setSession,
  clearSession,
  requireLogin,
  requireAdmin,
  getSecret,
  isEphemeral,
  warnIfEphemeral,
};
