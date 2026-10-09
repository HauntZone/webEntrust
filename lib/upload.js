'use strict';

/**
 * 上传：绕过 multer。
 *
 * 前端不用 <input type=file> 的原生表单提交（那是 multipart/form-data，需要解析器），
 * 而是用 fetch 把 File 直接当 body 发原始字节，服务端 req 就是一条裸流，
 * 直接 pipe 落盘即可 —— 零依赖，也不会有解析器被喂畸形输入的风险。
 *
 * 落盘后再交给 lib/zip.js 安全解压，先解到 staging，成功才整站替换。
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const config = require('./config');
const users = require('./users');
const zip = require('./zip');

class PayloadTooLarge extends Error {
  constructor(message) {
    super(message);
    this.name = 'PayloadTooLarge';
    this.code = 'ETOOLARGE';
  }
}

function json(res, status, payload) {
  res.status(status).json(payload);
}

function tempPath(ext) {
  return path.join(config.TMP_DIR, `up-${crypto.randomBytes(8).toString('hex')}${ext}`);
}

/** 把请求体边数边写到磁盘；超过 maxBytes 立刻中止 */
async function receiveToFile(req, destPath, maxBytes) {
  let received = 0;

  const meter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      if (received > maxBytes) {
        return cb(new PayloadTooLarge('上传内容超出允许的大小'));
      }
      return cb(null, chunk);
    },
  });

  await fsp.mkdir(path.dirname(destPath), { recursive: true });
  await pipeline(req, meter, fs.createWriteStream(destPath));
  return received;
}

/**
 * POST /api/upload?folder=xxx
 * body = zip 原始字节
 */
async function handleUpload(req, res) {
  const user = req.user;
  const folder = String(req.query.folder || '').trim().toLowerCase();

  if (!config.FOLDER_RE.test(folder)) {
    return json(res, 400, { error: '文件夹名只能用小写字母、数字和短横线，1-31 位，且不能以短横线开头' });
  }

  // 用量以磁盘实际为准，不信缓存 —— 否则外部删过文件后会算错配额
  const used = await users.recalcUsage(user.alias);
  const quotaBytes = user.quotaMB * 1024 * 1024;
  const remaining = quotaBytes - used;

  if (remaining <= 0) {
    return json(res, 413, {
      error: `配额已满（${user.quotaMB} MB），请先删除不用的文件夹`,
      used, quotaMB: user.quotaMB,
    });
  }

  // 压缩包本身就不可能大于剩余配额（压缩只会更小），所以提前卡住
  const limit = Math.min(config.MAX_UPLOAD_BYTES, remaining);
  const tmpZip = tempPath('.zip');
  const staging = path.join(users.userDir(user.alias), `.staging-${crypto.randomBytes(6).toString('hex')}`);
  let stagingUsed = false;

  try {
    await receiveToFile(req, tmpZip, limit);

    const result = await zip.extractInto(tmpZip, staging, remaining);
    stagingUsed = true;

    await zip.swapInto(staging, path.join(users.userDir(user.alias), folder));
    stagingUsed = false; // 已经改名走人，不再是 staging

    const newUsed = await users.recalcUsage(user.alias);
    await users.setUserFields(user.id, { usedBytes: newUsed });

    return json(res, 200, {
      ok: true,
      folder,
      fileCount: result.fileCount,
      bytes: result.bytes,
      used: newUsed,
      quotaMB: user.quotaMB,
    });
  } catch (err) {
    if (err instanceof zip.QuotaError) {
      return json(res, 413, { error: err.message, used, quotaMB: user.quotaMB });
    }
    if (err instanceof zip.ZipError) {
      return json(res, 400, { error: err.message });
    }
    if (err instanceof PayloadTooLarge) {
      return json(res, 413, {
        error: `上传内容超出可用额度（剩余 ${zip.formatMB(remaining)}）`,
        used, quotaMB: user.quotaMB,
      });
    }
    console.error('[upload] 失败：', err);
    return json(res, 500, { error: '服务器处理上传时出错' });
  } finally {
    if (stagingUsed) {
      await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
    await fsp.rm(tmpZip, { force: true }).catch(() => {});
  }
}

/** 删除用户的某个站点文件夹，回收配额 */
async function handleDeleteSite(req, res) {
  const user = req.user;
  const folder = String(req.body.folder || req.query.folder || '').trim().toLowerCase();

  if (!config.FOLDER_RE.test(folder)) {
    return json(res, 400, { error: '文件夹名不合法' });
  }

  const target = path.join(users.userDir(user.alias), folder);
  // 再确认一次没跑出用户目录
  if (!zip.insideRoot(users.userDir(user.alias), path.resolve(target))) {
    return json(res, 400, { error: '路径不合法' });
  }

  try {
    await fsp.rm(target, { recursive: true, force: true });
  } catch (err) {
    console.error('[upload] 删除失败：', err);
    return json(res, 500, { error: '删除失败' });
  }

  const newUsed = await users.recalcUsage(user.alias);
  await users.setUserFields(user.id, { usedBytes: newUsed });

  return json(res, 200, { ok: true, used: newUsed, quotaMB: user.quotaMB });
}

module.exports = { handleUpload, handleDeleteSite, receiveToFile, json, PayloadTooLarge };
