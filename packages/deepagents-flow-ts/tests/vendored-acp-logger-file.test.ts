/**
 * vendored ACP logger 的 logFile 路径 —— 回归（评审建议 2）。
 *
 * `libs/deepagents-acp/logger.ts` 用的是同步 `fs.mkdirSync`，不经 fs/promises，
 * 所以 logger-file-logging.test.ts 里对 fs/promises 的 mock 覆盖不到它。
 * 这条路径目前不在 ACP 生产启动链上（bootstrapFlowAcp 不传 logFile），
 * 但 cli.ts 的 --log-file / DEEPAGENTS_LOG_FILE 会走到；目录失效时不得卡死。
 */

import { describe, it, expect, afterEach, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { createLogger } from "../src/libs/deepagents-acp/logger.js";

/**
 * node:fs.mkdirSync 探针：默认透传真实实现；各用例按需替换，模拟「上级目录失效」。
 * vendored logger 用的是默认导入（`import fs from "node:fs"`），所以 default 也要替换。
 */
const mkdirProbe = vi.hoisted(() => ({
  impl: null as null | ((path: string) => void),
  calls: [] as Array<{ path: string; options: unknown }>,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const realMkdirSync = actual.mkdirSync as unknown as (
    path: string,
    options?: unknown
  ) => void;
  const mkdirSync = (path: string, options?: unknown) => {
    mkdirProbe.calls.push({ path: String(path), options });
    if (mkdirProbe.impl) return mkdirProbe.impl(String(path));
    return realMkdirSync(String(path), options);
  };
  return {
    ...actual,
    mkdirSync,
    default: { ...actual.default, mkdirSync },
  };
});

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-vlogger-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
  mkdirProbe.impl = null;
  mkdirProbe.calls.length = 0;
});

function fsError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`${code}: no such file or directory, mkdir '${path}'`),
    { code }
  );
}

/** 模拟「源目录已被删除的 bind mount」：dead 本身 mkdir → EEXIST，其下 → ENOENT。 */
function deadDirImpl(dead: string) {
  return (path: string): void => {
    if (path === dead) throw fsError("EEXIST", path);
    if (path.startsWith(dead + sep)) throw fsError("ENOENT", path);
  };
}

function expectNoRecursiveMkdir() {
  for (const call of mkdirProbe.calls) {
    expect(
      (call.options as { recursive?: boolean } | undefined)?.recursive,
      `mkdirSync(${call.path}) 不应带 recursive`
    ).not.toBe(true);
  }
}

describe("vendored ACP logger：logFile 路径不经递归 mkdir", () => {
  it("正常路径：逐级建出目录并写入", async () => {
    const root = freshDir();
    const logFile = join(root, "a", "b", "app.log");

    const logger = createLogger({ logFile });
    expect(logger.hasFileLogging()).toBe(true);
    logger.info("hello from vendored logger");
    await logger.close();

    const content = readFileSync(logFile, "utf-8");
    expect(content).toContain("hello from vendored logger");
    expect(content).toContain("Started at");
    expect(content).toContain("Shutting down at");
    expectNoRecursiveMkdir();
  });

  it("上级目录失效：不抛、停用文件日志、只报一次、mkdirSync 调用有界且不递归", async () => {
    const dead = join(freshDir(), "dead");
    mkdirProbe.impl = deadDirImpl(dead);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logFile = join(dead, "logs", "app.log");

    let logger: ReturnType<typeof createLogger> | undefined;
    expect(() => {
      logger = createLogger({ logFile });
    }).not.toThrow();
    expect(logger!.hasFileLogging()).toBe(false);
    expect(logger!.getLogFilePath()).toBe(logFile);
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0])).toContain("Failed to initialize log file");

    // logs → dead(EEXIST) → 重试 logs(ENOENT) 即止
    expect(mkdirProbe.calls.map((c) => c.path)).toEqual([
      join(dead, "logs"),
      dead,
      join(dead, "logs"),
    ]);
    expectNoRecursiveMkdir();

    // 停用后写日志、关闭都不抛
    expect(() => logger!.info("still works")).not.toThrow();
    await expect(logger!.close()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});
