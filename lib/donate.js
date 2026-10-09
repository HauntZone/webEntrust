'use strict';

/**
 * 赞赏支持页的数据来源。
 *
 * 图片是**管理员手工放进 assets/donate/ 的静态文件**，由既有的 /_assets 中间件
 * 直接提供，这里只负责列目录、生成 URL —— 不做上传，也不新增静态路由。
 * 只有说明文字是运行时数据，存 data/donate.json。
 *
 * 不塞进 lib/meta.js：那是外链开关和配额，跟这个页面无关。
 */

const fs = require('fs');
const path = require('path');

const config = require('./config');
const store = require('./store');

const FALLBACK = { schema: 1, note: '' };

function getNote() {
  const raw = store.readJsonSync(config.DONATE_FILE, null);
  if (!raw || typeof raw !== 'object' || typeof raw.note !== 'string') return '';
  return raw.note;
}

function setNote(text) {
  const note = String(text == null ? '' : text)
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, config.DONATE_NOTE_MAX);

  return store.update(config.DONATE_FILE, FALLBACK, (data) => {
    data.schema = 1;
    data.note = note;
    return data;
  });
}

/** "01-微信.png" → "微信"；没有序号前缀就整段当标题 */
function parseTitle(base) {
  const matched = /^\d+[-_.\s]+(.+)$/.exec(base);
  return (matched ? matched[1] : base).trim() || base;
}

/**
 * 列出 assets/donate/ 下可展示的图片。
 * 目录不存在（还没放过东西）时返回空数组，不抛。
 */
function listImages() {
  let entries;
  try {
    entries = fs.readdirSync(config.DONATE_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    // isFile() 对符号链接为 false，顺手把链接挡在门外
    .filter((entry) => entry.isFile()
      && config.DONATE_IMAGE_EXT.includes(path.extname(entry.name).toLowerCase()))
    .map((entry) => {
      const ext = path.extname(entry.name);
      return {
        file: entry.name,
        title: parseTitle(path.basename(entry.name, ext)),
        url: `/_assets/donate/${encodeURIComponent(entry.name)}`,
      };
    })
    // 文件名前缀的数字按数值比，所以 2- 排在 10- 前面
    .sort((a, b) => a.file.localeCompare(b.file, 'zh-CN', { numeric: true }));
}

module.exports = { getNote, setNote, listImages };
