'use strict';

/**
 * 访客侧静态托管：/<别名>/<文件夹>/...
 *
 * 用 res.sendFile(相对路径, { root }) 把 Range、ETag、Last-Modified、
 * 条件请求 304 全部白拿（Express 内置的 send 模块），一行都不用自己写。
 * 传相对路径 + root 时 send 会自己拒绝逃逸 root 的 '..'。
 */

const path = require('path');
const fsp = require('fs').promises;

const config = require('./config');
const users = require('./users');
const meta = require('./meta');
const inject = require('./inject');

/** 访客侧的报错页刻意不带平台样式，避免平台品牌渗进用户站点的命名空间 */
function plainPage(res, status, title, message) {
  res
    .status(status)
    .type('html')
    .send(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<title>${status}</title></head><body style="font:16px/1.6 system-ui,sans-serif;` +
      `max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#333">` +
      `<h1 style="font-size:3rem;margin:0">${status}</h1><p>${message}</p></body></html>`,
    );
}

const notFound = (res) => plainPage(res, 404, '404', '页面不存在');
const badRequest = (res) => plainPage(res, 400, '400', '请求路径不合法');
const forbidden = (res) => plainPage(res, 403, '403', '禁止访问');

/**
 * 解码并做第一层拒绝。
 * Express 的 req.path 没有解码，所以 %2e%2e 这类要在这里显形。
 */
function safeDecode(rawPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return null; // 非法百分号编码
  }
  // 空字节和反斜杠：Windows 上 '..\..\' 能逃出 root，必须在这里掐掉
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  return decoded;
}

/** 确认 abs 确实落在 root 之内 */
function insideRoot(root, abs) {
  if (abs === root) return true;
  return abs.startsWith(root + path.sep);
}

function streamFile(res, user, relPath) {
  const root = users.userDir(user.alias);
  res.sendFile(relPath, { root }, (err) => {
    if (!err) return;
    if (res.headersSent) return res.destroy();
    if (err.status === 404 || err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return notFound(res);
    }
    if (err.status === 403) return forbidden(res);
    console.error('[site] 发送文件失败：', err.message);
    return plainPage(res, 500, '500', '服务器内部错误');
  });
}

async function handle(req, res, next) {
  const decoded = safeDecode(req.path);
  if (decoded === null) return badRequest(res);

  const segments = decoded.split('/').filter(Boolean);
  if (segments.length === 0) return next(); // 根路径，交给平台首页

  const alias = segments[0].toLowerCase();
  const rest = segments.slice(1);

  const user = users.findByAlias(alias);
  // 用户不存在、已被禁用 —— 站点一并下线
  if (!user || user.status !== 'active') return notFound(res);

  // 用规范化后的 alias 取目录，避免 Windows 大小写不敏感导致的目录歧义
  const siteRoot = users.userDir(user.alias);
  let relPath = rest.join('/');

  const abs = path.resolve(siteRoot, relPath);
  if (!insideRoot(siteRoot, abs)) return forbidden(res);

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    return notFound(res);
  }

  if (stat.isDirectory()) {
    // 补尾斜杠，否则页面里的相对链接会算错基准
    if (!req.path.endsWith('/')) {
      const query = req.originalUrl.slice(req.path.length);
      return res.redirect(301, `${req.path}/${query}`);
    }
    const indexAbs = path.join(abs, 'index.html');
    try {
      const indexStat = await fsp.stat(indexAbs);
      if (!indexStat.isFile()) return notFound(res);
      // 没有 index.html 就 404，不列目录
    } catch {
      return notFound(res);
    }
    relPath = relPath ? `${relPath}/index.html` : 'index.html';
    stat = await fsp.stat(path.join(siteRoot, relPath));
  } else if (!stat.isFile()) {
    return notFound(res);
  }

  // 外链脚本只在 HTML 上注入；两个开关都关就直接流式返回，读文件都省了
  const flags = meta.effectiveFlags(user);
  if (inject.isHtml(relPath) && (flags.warn || flags.guide) && stat.size <= config.INJECT_MAX_BYTES) {
    const absFile = path.join(siteRoot, ...relPath.split('/'));
    const handled = await inject.send(res, absFile, user, flags);
    if (handled) return undefined;
  }

  return streamFile(res, user, relPath);
}

module.exports = { handle, notFound, plainPage };
