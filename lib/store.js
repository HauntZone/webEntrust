'use strict';

/**
 * JSON 文件存储 —— 无数据库。
 *
 * 两个保证：
 *   1. 同一个文件的读-改-写串行化（内存队列），杜绝并发丢更新。
 *   2. 写入是原子的：先写 .tmp 再 rename 覆盖，进程中途挂掉不会留下半个文件。
 *
 * 明确不支持多进程/多实例：队列是进程内的。
 */

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');

/** file path -> 队尾 Promise */
const queues = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 把 fn 排到该文件的队尾，保证同一文件上的操作依次执行。
 * 前一个任务失败不能卡死后面的，所以用 catch 兜住队尾。
 */
function enqueue(file, fn) {
  const prev = queues.get(file) || Promise.resolve();
  const run = prev.then(fn, fn);
  queues.set(file, run.then(
    () => {},
    () => {},
  ));
  return run;
}

/** 同步读；文件不存在或损坏时返回 fallback，不抛。 */
function readJsonSync(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return fallback;
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    // 解析失败：保留现场，让调用方能在日志里看到，但不阻断启动
    console.error(`[store] 读取 ${path.basename(file)} 失败：${err.message}`);
    return fallback;
  }
}

/**
 * Windows 上 rename 覆盖已存在文件偶发 EPERM/EBUSY（杀软、索引器、编辑器占用），
 * 重试几次基本都能过。
 */
async function renameWithRetry(from, to, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (err) {
      const retriable = err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES';
      if (retriable && i < attempts - 1) {
        await sleep(200);
        continue;
      }
      throw err;
    }
  }
}

async function writeJsonNow(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fsp.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await renameWithRetry(tmp, file);
}

/** 排队写入整个对象。 */
function writeJson(file, data) {
  return enqueue(file, () => writeJsonNow(file, data));
}

/**
 * 排队做读-改-写。mutator 接收当前对象，直接改它或返回新对象。
 * mutator 抛错则整个写入取消，文件保持原样。
 */
function update(file, fallback, mutator) {
  return enqueue(file, async () => {
    // 深拷贝兜底对象：mutator 会直接改它，不能污染调用方传入的那个常量
    const current = readJsonSync(file, JSON.parse(JSON.stringify(fallback === undefined ? null : fallback)));
    const result = await mutator(current);
    const next = result === undefined ? current : result;
    await writeJsonNow(file, next);
    return next;
  });
}

module.exports = { readJsonSync, writeJson, update };
