'use strict';

const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

module.exports = {
  ROOT,
  DATA_DIR,
  TMP_DIR: path.join(DATA_DIR, 'tmp'),

  /** 站点根目录：用户上传的内容全部落在这里，public/ 本身不出现在 URL 里 */
  PUBLIC_DIR: path.join(ROOT, 'public'),
  /** 平台自有静态资源，经 /_assets 提供。这里没有用户内容，可整套静态托管 */
  ASSETS_DIR: path.join(ROOT, 'assets'),

  // ---- 赞赏支持 ----
  /**
   * 赞赏码图片：管理员手工放进来的静态文件，由既有的 /_assets 中间件提供。
   * 刻意不放 DATA_DIR —— 它不是运行时数据，而是要被公开访问的静态资源。
   */
  DONATE_DIR: path.join(ROOT, 'assets', 'donate'),
  DONATE_FILE: path.join(DATA_DIR, 'donate.json'),
  /** 只认位图。不含 svg：它能在平台同源下执行脚本，不该由静态目录提供 */
  DONATE_IMAGE_EXT: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp'],
  DONATE_NOTE_MAX: 2000,

  USERS_FILE: path.join(DATA_DIR, 'users.json'),
  META_FILE: path.join(DATA_DIR, 'meta.json'),
  RESERVED_FILE: path.join(DATA_DIR, 'reserved-aliases.json'),

  // ---- 会话 ----
  COOKIE_NAME: 'sid',
  /** 未设置时在启动阶段随机生成，重启即全体掉线（bin/www 会打印警告） */
  SESSION_SECRET: process.env.SESSION_SECRET || null,
  SESSION_TTL_MS: 7 * 24 * 60 * 60 * 1000,

  // ---- 配额与上传 ----
  DEFAULT_QUOTA_MB: 20,
  /** 上传的 zip 体积上限（压缩后），防止有人先撑爆磁盘再谈解压 */
  MAX_UPLOAD_BYTES: 100 * 1024 * 1024,
  /** 超过这个大小的 HTML 不做外链注入，直接流式返回 */
  INJECT_MAX_BYTES: 4 * 1024 * 1024,

  // ---- 格式约束 ----
  /** 别名必须以字母开头：这样 /_xxx 天然不可能被别名占用，平台留出整块 _ 命名空间 */
  ALIAS_RE: /^[a-z][a-z0-9-]{2,29}$/,
  FOLDER_RE: /^[a-z0-9][a-z0-9-]{0,30}$/,
  PASSWORD_MIN: 8,

  // ---- ZIP 解压限制 ----
  ZIP_MAX_ENTRIES: 2000,
  ZIP_MAX_DEPTH: 8,
  ZIP_MAX_NAME_LEN: 255,

  // ---- 界面 ----
  THEMES: ['sky', 'pink'],
  DEFAULT_THEME: 'sky',

  /** 这些顶层路径归平台所有，别名不得占用 */
  RESERVED_PATHS: [
    'login', 'register', 'logout', 'dashboard', 'admin',
    'go', 'api', 'assets', 'support',
  ],

  /** 初始保留别名清单，首次启动写入 data/reserved-aliases.json，之后以文件为准 */
  RESERVED_ALIASES: [
    'home', 'index', 'main', 'login', 'signin', 'signup', 'register', 'logout',
    'auth', 'dashboard', 'admin', 'manage', 'administrator', 'root', 'system',
    'api', 'assets', 'static', 'public', 'user', 'users', 'account', 'profile',
    'settings', 'help', 'about', 'support', 'terms', 'privacy', 'favicon',
    'robots', 'well-known', 'null', 'undefined', 'test', 'demo', 'www', 'mail',
    'ftp', 'cdn', 'go', 'redirect',
  ],
};
