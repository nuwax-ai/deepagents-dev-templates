/**
 * 静态守卫：日志模块创建目录不得使用递归 mkdir。
 *
 * Node 的递归 mkdir 在上级目录失效（如源目录被删的 bind mount）时会无界重试
 * （nodejs/node#66268，v22.23.x / v24.21.0 未修）：同步形式占满一个核并卡死主线程，
 * 异步形式占死一个线程池线程。日志路径上一律逐级非递归创建。
 * 动态行为见 logger-file-logging.test.ts；这里防止日后有人把 recursive 加回来。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");
const GUARDED = ["runtime/logger.ts", "libs/deepagents-acp/logger.ts"];

describe("日志模块不得使用递归 mkdir", () => {
  it("守卫名单非空（自检）", () => {
    expect(GUARDED.length).toBeGreaterThan(0);
  });

  for (const rel of GUARDED) {
    it(`${rel} 中没有 recursive: true`, () => {
      const source = readFileSync(resolve(SRC, rel), "utf-8");
      expect(source).not.toMatch(/recursive\s*:\s*true/);
    });
  }
});
