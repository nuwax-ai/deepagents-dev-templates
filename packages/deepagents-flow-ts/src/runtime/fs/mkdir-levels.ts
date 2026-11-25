/**
 * 逐级、非递归建目录 —— 一方代码建目录的唯一入口。
 *
 * 绝不使用递归 mkdir（任何形式）：Node 的递归 mkdir 在上级目录失效（如源目录被删的 bind mount）时
 * 会无界重试（nodejs/node#66268）——同步形式占满一个核并卡死主线程，异步形式占死一个线程池线程。
 *
 * 规则：
 *   - 每一级只调用一次**不带 recursive** 的 mkdir；EEXIST 视为成功。
 *   - ENOENT（父目录不存在）→ 先补父目录，再重试一次。每一级最多两次，调用次数随路径深度有界。
 *     上级目录已失效时，补父目录得到 EEXIST/ENOENT，重试仍是 ENOENT → 立即失败。
 *   - 其他错误码（EACCES / EROFS / ENOSPC / ENOTDIR …）原样抛出，由调用方决定降级方式。
 *
 * 建目录的原语可注入（mkDir）：调用方可以包一层超时，测试可以模拟失效目录。
 *
 * 静态守卫（tests/no-recursive-mkdir.test.ts）：src/ 下直接调用 mkdir / mkdirSync 的只允许此处、
 * runtime/logger.ts（注入带超时的实现）和 vendored 的 libs/deepagents-acp/logger.ts（保持自包含）。
 */

import { mkdirSync as fsMkdirSync } from "node:fs";
import { mkdir as fsMkdirAsync } from "node:fs/promises";
import { dirname } from "node:path";

export type MkDirSync = (dir: string) => void;
export type MkDirAsync = (dir: string) => void | Promise<void>;

function errnoCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err
    ? String((err as { code?: unknown }).code)
    : undefined;
}

/** 同步版。失败时抛出底层 mkdir 的错误。 */
export function mkdirLevelsSync(dir: string, mkDir: MkDirSync = fsMkdirSync): void {
  try {
    mkDir(dir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === "EEXIST") return;
    if (code !== "ENOENT") throw err;
    const parent = dirname(dir);
    if (parent === dir) throw err;
    mkdirLevelsSync(parent, mkDir);
    try {
      mkDir(dir);
    } catch (retryErr) {
      if (errnoCode(retryErr) !== "EEXIST") throw retryErr;
    }
  }
}

/** 异步版（libuv 线程池，不阻塞事件循环）。失败时抛出底层 mkdir 的错误。 */
export async function mkdirLevels(
  dir: string,
  mkDir: MkDirAsync = (d) => fsMkdirAsync(d)
): Promise<void> {
  try {
    await mkDir(dir);
  } catch (err) {
    const code = errnoCode(err);
    if (code === "EEXIST") return;
    if (code !== "ENOENT") throw err;
    const parent = dirname(dir);
    if (parent === dir) throw err;
    await mkdirLevels(parent, mkDir);
    try {
      await mkDir(dir);
    } catch (retryErr) {
      if (errnoCode(retryErr) !== "EEXIST") throw retryErr;
    }
  }
}
