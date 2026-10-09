'use strict';

/**
 * ZIP 安全解压。
 *
 * 协议解析交给 yauzl，但 yauzl 只负责"把中央目录读出来"——它把原始
 * entry.fileName 原样交给你，不判断路径是否危险。所以下面这几件事全是
 * 我们自己写、也是真正的安全边界：
 *
 *   1. 路径校验（zip-slip）：拒绝 '..'、绝对路径、盘符、反斜杠
 *   2. 符号链接：拒绝
 *   3. 配额：解压前按声明大小求和快速失败；解压中按实际字节数再掐一次
 *      （防止中央目录谎报 uncompressedSize 做 zip bomb）
 *   4. 原子落盘：先解到 staging 目录，全部成功才替换目标，失败不留半个站点
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');

const yauzl = require('yauzl');
const config = require('./config');

class ZipError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ZipError';
    this.code = 'EZIP';
  }
}

class QuotaError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QuotaError';
    this.code = 'EQUOTA';
  }
}

// ---------------------------------------------------------------- 条目校验

/**
 * 把条目标题规范化成安全的相对路径。
 * 返回 null 表示这个条目不可信，直接拒绝整个包。
 */
function normalizeEntryName(rawName) {
  if (typeof rawName !== 'string') return null;
  if (rawName.length === 0 || rawName.length > config.ZIP_MAX_NAME_LEN) return null;
  if (rawName.includes('\0')) return null;

  const unified = rawName.replace(/\\/g, '/');
  const isDir = unified.endsWith('/');
  const trimmed = unified.replace(/\/+$/, '');

  if (!trimmed) return null;
  if (trimmed.startsWith('/')) return null;          // 绝对路径
  if (/^[A-Za-z]:/.test(trimmed)) return null;       // Windows 盘符 C:\

  const parts = trimmed.split('/');
  // 任何一段是空、'.' 或 '..' 都拒绝 —— 不做"归一化后放行"，直接拒
  if (parts.some((p) => p === '' || p === '.' || p === '..')) return null;
  if (parts.length > config.ZIP_MAX_DEPTH) return null;

  return { name: parts.join('/'), parts, isDir };
}

function isSymlink(entry) {
  const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
  return mode === 0xa000;
}

function isEncrypted(entry) {
  if (typeof entry.isEncrypted === 'function' && entry.isEncrypted()) return true;
  return (entry.generalPurposeBitFlag & 0x1) !== 0;
}

/** 校验单个条目；返回规范化信息，不合法则抛错（拒绝整个包） */
function vetEntry(entry) {
  if (isEncrypted(entry)) {
    throw new ZipError('压缩包已加密，无法解压');
  }
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ZipError(`不支持的压缩方式（method=${entry.compressionMethod}）`);
  }
  if (isSymlink(entry)) {
    throw new ZipError('压缩包内含符号链接，出于安全考虑已拒绝');
  }

  const info = normalizeEntryName(entry.fileName);
  if (!info) {
    throw new ZipError(`压缩包内含不安全的路径：${String(entry.fileName).slice(0, 120)}`);
  }
  return info;
}

function insideRoot(root, abs) {
  return abs === root || abs.startsWith(root + path.sep);
}

// ---------------------------------------------------------------- yauzl 封装

function openZip(zipPath) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: false }, (err, zipfile) => {
      if (err) return reject(new ZipError(`无法读取压缩包：${err.message}`));
      return resolve(zipfile);
    });
  });
}

function collectEntries(zipfile) {
  return new Promise((resolve, reject) => {
    const entries = [];
    zipfile.on('entry', (entry) => {
      entries.push(entry);
      if (entries.length > config.ZIP_MAX_ENTRIES) {
        reject(new ZipError(`压缩包内文件过多（上限 ${config.ZIP_MAX_ENTRIES} 个）`));
        return;
      }
      zipfile.readEntry();
    });
    zipfile.on('end', () => resolve(entries));
    zipfile.on('error', (err) => reject(new ZipError(`读取压缩包失败：${err.message}`)));
    zipfile.readEntry();
  });
}

function openReadStream(zipfile, entry) {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(new ZipError(`解压失败：${err.message}`));
      return resolve(stream);
    });
  });
}

/**
 * 流式写出一个条目。
 * available = 当前还剩多少配额余量；一边写一边数实际字节，超了就掐断。
 * 绝不用 inflateRawSync —— 那会一次性分配，zip bomb 能直接吃光内存。
 */
async function writeEntry(zipfile, entry, targetPath, available) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });

  const source = await openReadStream(zipfile, entry);
  let written = 0;

  const meter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > available) {
        // 中央目录声称的大小不可信，以实际写入量为准
        return cb(new QuotaError('解压后的体积超出配额'));
      }
      return cb(null, chunk);
    },
  });

  try {
    await pipeline(source, meter, fs.createWriteStream(targetPath));
  } catch (err) {
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    throw err;
  }

  // 实写量与声明量必须一致，否则包有问题
  if (written !== entry.uncompressedSize) {
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    throw new ZipError('压缩包内容与声明大小不符，可能已损坏');
  }
  return written;
}

/**
 * 解压到 stagingDir。stagingDir 必须是一个已经存在的空目录。
 *
 * budgetBytes = 这个用户当前可用的剩余配额。
 * 返回 { bytes, fileCount }。
 */
async function extractInto(zipPath, stagingDir, budgetBytes) {
  let zipfile;
  try {
    zipfile = await openZip(zipPath);
    const entries = await collectEntries(zipfile);

    if (entries.length === 0) throw new ZipError('压缩包是空的');

    // ---- 第一道配额闸：按中央目录声明的大小求和，超了立刻失败，一个字节都不写 ----
    let declared = 0;
    for (const entry of entries) {
      declared += entry.uncompressedSize;
      if (declared > budgetBytes) {
        throw new QuotaError(`解压后约需 ${formatMB(declared)}，超出可用配额 ${formatMB(budgetBytes)}`);
      }
    }

    // ---- 逐个校验 + 写出 ----
    await fsp.mkdir(stagingDir, { recursive: true });
    let totalWritten = 0;
    let fileCount = 0;

    for (const entry of entries) {
      const info = vetEntry(entry);
      const target = path.resolve(stagingDir, info.name);

      // 双保险：normalizeEntryName 已经挡掉 '..'，这里再确认一次没逃出 staging
      if (!insideRoot(stagingDir, target)) {
        throw new ZipError(`压缩包内含不安全的路径：${info.name}`);
      }

      if (info.isDir) {
        await fsp.mkdir(target, { recursive: true });
        continue;
      }

      // ---- 第二道闸：按实际字节数 ----
      const available = budgetBytes - totalWritten;
      totalWritten += await writeEntry(zipfile, entry, target, available);
      fileCount += 1;
    }

    return { bytes: totalWritten, fileCount };
  } finally {
    if (zipfile) {
      try {
        zipfile.close();
      } catch {
        /* 已经关了就算了 */
      }
    }
  }
}

// ---------------------------------------------------------------- 原子替换

/**
 * 把 staging 目录换成 target 目录。
 * 先把旧的挪到一旁，新的就位，成功后再删旧的；中途失败则回滚。
 */
async function swapInto(stagingDir, targetDir) {
  const backup = `${targetDir}.old-${crypto.randomBytes(4).toString('hex')}`;
  let movedOld = false;

  try {
    await fsp.rename(targetDir, backup);
    movedOld = true;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // 目录不存在是正常情况（首次上传）
  }

  try {
    await fsp.mkdir(path.dirname(targetDir), { recursive: true });
    await fsp.rename(stagingDir, targetDir);
  } catch (err) {
    if (movedOld) {
      await fsp.rename(backup, targetDir).catch(() => {});
    }
    throw err;
  }

  if (movedOld) {
    fsp.rm(backup, { recursive: true, force: true }).catch(() => {});
  }
}

function formatMB(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

module.exports = {
  extractInto,
  swapInto,
  normalizeEntryName,
  ZipError,
  QuotaError,
  formatMB,
  insideRoot,
};
