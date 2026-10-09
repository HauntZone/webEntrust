'use strict';

const crypto = require('crypto');
const fsp = require('fs').promises;
const path = require('path');

const config = require('./config');
const store = require('./store');
const meta = require('./meta');

const FALLBACK = { schema: 1, users: {} };

// ---------------------------------------------------------------- 口令

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

/** 存储格式：scrypt$N$r$p$<saltB64>$<hashB64> */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  return ['scrypt', SCRYPT_N, SCRYPT_R, SCRYPT_P, salt.toString('base64'), hash.toString('base64')].join('$');
}

function verifyPassword(password, stored) {
  try {
    const [scheme, n, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = crypto.scryptSync(password, salt, expected.length, { N: +n, r: +r, p: +p });
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 读取

function allUsers() {
  const db = store.readJsonSync(config.USERS_FILE, FALLBACK);
  if (!db || typeof db !== 'object' || !db.users || typeof db.users !== 'object') return {};
  return db.users;
}

function listUsers() {
  return Object.values(allUsers());
}

function findById(id) {
  return allUsers()[id] || null;
}

function findByAlias(alias) {
  const key = String(alias || '').trim().toLowerCase();
  if (!key) return null;
  return listUsers().find((u) => String(u.alias).toLowerCase() === key) || null;
}

function hasAdmin() {
  return listUsers().some((u) => u.role === 'admin');
}

/** 用户的站点目录（绝对路径） */
function userDir(alias) {
  return path.join(config.PUBLIC_DIR, alias);
}

// ---------------------------------------------------------------- 保留别名

function reservedAliases() {
  const raw = store.readJsonSync(config.RESERVED_FILE, null);
  if (raw && Array.isArray(raw.aliases)) return raw.aliases.map(String);
  return config.RESERVED_ALIASES.slice();
}

function ensureReserved() {
  if (store.readJsonSync(config.RESERVED_FILE, null)) return Promise.resolve();
  return store.writeJson(config.RESERVED_FILE, { schema: 1, aliases: config.RESERVED_ALIASES.slice() });
}

function setReservedAliases(aliases) {
  const cleaned = Array.from(new Set(aliases.map((a) => String(a).trim().toLowerCase()).filter(Boolean)));
  return store.writeJson(config.RESERVED_FILE, { schema: 1, aliases: cleaned });
}

// ---------------------------------------------------------------- 校验

function validateAlias(raw) {
  const alias = String(raw || '').trim().toLowerCase();
  if (!config.ALIAS_RE.test(alias)) {
    return { ok: false, error: '别名只能用 3-30 位小写字母、数字和短横线，且必须以字母开头' };
  }
  // 平台自己的路由是硬抢占，不能靠可编辑的保留清单来兜 —— 管理员一旦把
  // 'admin' 之类的名字从清单里删掉，注册它的人站点就会被平台路由永久遮蔽。
  if (config.RESERVED_PATHS.indexOf(alias) >= 0) {
    return { ok: false, error: `“${alias}”是平台保留路径，不能作为别名` };
  }
  if (reservedAliases().some((a) => a.toLowerCase() === alias)) {
    return { ok: false, error: '该别名已被保留，请更换' };
  }
  if (findByAlias(alias)) {
    return { ok: false, error: '该别名已被使用，请更换' };
  }
  return { ok: true, alias };
}

function validatePassword(password) {
  const pw = String(password || '');
  if (pw.length < config.PASSWORD_MIN) {
    return { ok: false, error: `密码至少 ${config.PASSWORD_MIN} 位` };
  }
  return { ok: true };
}

// ---------------------------------------------------------------- 写入

function newId() {
  return `u_${crypto.randomBytes(4).toString('hex')}`;
}

function createUser({ alias, password, role = 'user', quotaMB }) {
  const id = newId();
  const quota = Number.isFinite(quotaMB) && quotaMB > 0 ? quotaMB : meta.getMeta().defaultQuotaMB;
  const user = {
    id,
    alias,
    pass: hashPassword(password),
    role: role === 'admin' ? 'admin' : 'user', // 永远不接受外部直接塞 role
    status: 'active',
    quotaMB: quota,
    usedBytes: 0,
    sessionEpoch: 0,
    features: { warn: true, guide: true },
    sites: [],
    createdAt: Date.now(),
  };
  return store.update(config.USERS_FILE, FALLBACK, (db) => {
    if (!db.users) db.users = {};
    db.users[id] = user;
    return db;
  }).then(() => user);
}

/** 改动单个用户。mutator 拿到用户对象副本，返回新对象或就地修改。 */
function updateUser(id, mutator) {
  return store.update(config.USERS_FILE, FALLBACK, (db) => {
    if (!db.users || !db.users[id]) throw new Error('用户不存在');
    const next = mutator({ ...db.users[id] });
    db.users[id] = next || db.users[id];
    return db;
  });
}

function setUserFields(id, fields) {
  return updateUser(id, (u) => Object.assign(u, fields));
}

/** 改口令 / 禁用 / 强制下线 —— 都必须让旧 Cookie 立刻失效 */
function bumpEpoch(user) {
  return (user.sessionEpoch || 0) + 1;
}

function setPassword(id, password) {
  return updateUser(id, (u) => {
    u.pass = hashPassword(password);
    u.sessionEpoch = bumpEpoch(u);
    return u;
  });
}

function setStatus(id, status) {
  return updateUser(id, (u) => {
    u.status = status === 'disabled' ? 'disabled' : 'active';
    u.sessionEpoch = bumpEpoch(u);
    return u;
  });
}

function setQuota(id, mb) {
  return updateUser(id, (u) => {
    u.quotaMB = mb;
    return u;
  });
}

function setFeature(id, name, value) {
  return updateUser(id, (u) => {
    if (!u.features) u.features = { warn: true, guide: true };
    u.features[name] = !!value;
    return u;
  });
}

function forceLogout(id) {
  return updateUser(id, (u) => {
    u.sessionEpoch = bumpEpoch(u);
    return u;
  });
}

/** 删除用户记录；磁盘上的站点目录由调用方清理 */
function deleteUser(id) {
  return store.update(config.USERS_FILE, FALLBACK, (db) => {
    if (db.users) delete db.users[id];
    return db;
  });
}

// ---------------------------------------------------------------- 用量

async function dirSize(dir) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await fsp.stat(full)).size;
      } catch {
        /* 文件刚被删掉，忽略 */
      }
    }
  }
  return total;
}

/** 缓存的 usedBytes 可能漂移（外部工具删过文件等），按磁盘实际情况重算 */
async function recalcUsage(alias) {
  return dirSize(userDir(alias));
}

/** 列出用户已发布的文件夹 */
async function listSiteFolders(alias) {
  try {
    const entries = await fsp.readdir(userDir(alias), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return [];
  }
}

module.exports = {
  hashPassword,
  verifyPassword,

  allUsers,
  listUsers,
  findById,
  findByAlias,
  hasAdmin,
  userDir,

  reservedAliases,
  ensureReserved,
  setReservedAliases,

  validateAlias,
  validatePassword,

  createUser,
  updateUser,
  setUserFields,
  setPassword,
  setStatus,
  setQuota,
  setFeature,
  forceLogout,
  deleteUser,

  dirSize,
  recalcUsage,
  listSiteFolders,
};
