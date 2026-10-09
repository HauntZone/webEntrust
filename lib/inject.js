'use strict';

/**
 * 往用户托管的 HTML 里注入外链拦截脚本。
 *
 * 边界：这里只加一行不可见的 <script>，不碰用户页面的样式、结构和原有标记。
 * 平台的 platform.css 绝不能出现在这条路径上。
 */

const fsp = require('fs').promises;
const config = require('./config');

/** 拼进 <script> 里的 JSON 要防 </script> 提前闭合 */
function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function snippet(alias, flags) {
  return `<script>window.__XLINK__=${jsonForScript({
    warn: flags.warn,
    guide: flags.guide,
    alias,
  })};</script><script src="/_assets/xlink.js" defer></script>`;
}

/**
 * 尝试注入并发送。
 * 返回 true  = 已处理（响应已发出）
 * 返回 false = 不适合注入（非 UTF-8 等），调用方按原样流式返回
 */
async function send(res, absPath, user, flags) {
  let buf;
  let stat;
  try {
    stat = await fsp.stat(absPath);
    buf = await fsp.readFile(absPath);
  } catch {
    return false;
  }

  const html = buf.toString('utf8');

  // 字节数对不上说明不是 UTF-8（可能是 GBK 老页面）。
  // 强行注入会把整页字符弄乱，宁可放弃注入。
  if (Buffer.byteLength(html, 'utf8') !== buf.length) {
    return false;
  }

  const tag = snippet(user.alias, flags);
  const lower = html.toLowerCase();
  const idx = lower.lastIndexOf('</body');

  const out = idx >= 0
    ? html.slice(0, idx) + tag + html.slice(idx)
    : html + tag;

  // res.send 会算 ETag（注入结果是确定性的，所以 ETag 稳定）并处理 304。
  // Last-Modified 得自己补 —— 否则 If-Modified-Since 这条路径就断了。
  res.set('Last-Modified', stat.mtime.toUTCString());
  res.type('html').send(out);
  return true;
}

/** HTML 才注入，二进制绝不碰 */
function isHtml(relPath) {
  const lower = String(relPath).toLowerCase();
  return lower.endsWith('.html') || lower.endsWith('.htm');
}

module.exports = { send, isHtml, snippet, INJECT_MAX_BYTES: config.INJECT_MAX_BYTES };
