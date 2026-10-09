'use strict';

/** 平台级配置：两个全局外链开关 + 默认配额。存 data/meta.json。 */

const store = require('./store');
const config = require('./config');

function fallback() {
  return {
    schema: 1,
    flags: { warn: true, guide: true },
    defaultQuotaMB: config.DEFAULT_QUOTA_MB,
  };
}

/** 读出来的一定是形状完整的对象，缺字段按默认值补齐 */
function getMeta() {
  const raw = store.readJsonSync(config.META_FILE, null);
  const base = fallback();
  if (!raw || typeof raw !== 'object') return base;
  return {
    schema: 1,
    flags: {
      warn: raw.flags && raw.flags.warn !== false,
      guide: raw.flags && raw.flags.guide !== false,
    },
    defaultQuotaMB: Number.isFinite(raw.defaultQuotaMB) && raw.defaultQuotaMB > 0
      ? raw.defaultQuotaMB
      : base.defaultQuotaMB,
  };
}

function ensureMeta() {
  if (store.readJsonSync(config.META_FILE, null)) return Promise.resolve();
  return store.writeJson(config.META_FILE, fallback());
}

/** flag 名：'warn' | 'guide' */
function setFlag(name, value) {
  return store.update(config.META_FILE, fallback(), (meta) => {
    if (!meta.flags) meta.flags = { warn: true, guide: true };
    meta.flags[name] = !!value;
    return meta;
  });
}

function setDefaultQuota(mb) {
  return store.update(config.META_FILE, fallback(), (meta) => {
    meta.defaultQuotaMB = mb;
    return meta;
  });
}

/**
 * 两级开关合流：管理员全局关掉就是关掉，用户自己再打开也没用。
 * 用户侧只有「显式 false」才算关，缺字段视为跟随全局。
 */
function effectiveFlags(user, meta) {
  const m = meta || getMeta();
  return {
    warn: m.flags.warn === true && !(user && user.features && user.features.warn === false),
    guide: m.flags.guide === true && !(user && user.features && user.features.guide === false),
  };
}

module.exports = { getMeta, ensureMeta, setFlag, setDefaultQuota, effectiveFlags };
