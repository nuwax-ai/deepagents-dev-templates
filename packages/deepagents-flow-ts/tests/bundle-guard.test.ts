/**
 * 产物守卫（bundle-guard）—— 源码守卫之外的最后一道。
 *
 * 源码守卫（no-recursive-mkdir.test.ts）只看 src/；平台包实际发布的是 esbuild 打出来的
 * dist/bundle.mjs。这里一方面测 checkBundle 这个纯函数，另一方面真的构建一次 bundle
 * （进程内约 0.5 秒）断言它通过——构建配置改动或产物过期时能在这里发现。
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkBundle, REQUIRED_MARKERS } from "../scripts/lib/bundle-guard.mjs";
import { bundleAgent } from "../scripts/lib/bundle.mjs";

const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LOG_FIX = "[logger] file logging disabled";
const CKPT_FIX = "checkpoint persistence disabled";
const ALL_MARKERS = `${LOG_FIX} — LOG_DIR "x" … ${CKPT_FIX}`;

describe("checkBundle（纯函数）", () => {
  it("修复标记只用 ASCII（esbuild 默认把非 ASCII 转成 \\uXXXX，带进去就匹配不上）", () => {
    for (const marker of REQUIRED_MARKERS) {
      expect(marker, marker).toMatch(/^[\x20-\x7e]+$/);
    }
  });

  it("带齐修复标记、没有危险形态 → 没有问题", () => {
    expect(checkBundle(`${ALL_MARKERS} mkdirLevelsSync3(cacheDir3()) mkdirLevelsSync2(this.dir)`)).toEqual([]);
  });

  it("缺修复标记 → 报问题", () => {
    expect(checkBundle(CKPT_FIX)).toHaveLength(1);
    expect(checkBundle(LOG_FIX)).toHaveLength(1);
    expect(checkBundle("")).toHaveLength(2);
  });

  it("一方代码的危险调用形态 → 报问题（esbuild 改名后也要认得出）", () => {
    const cases = [
      "mkdirSync3(cacheDir(), { recursive: true })",
      "mkdirSync(cacheDir2(), { recursive: true });",
      "mkdirSync4(this.dir, { recursive: true })",
      "fs.mkdirSync(this.dir, { recursive: true })",
    ];
    for (const bad of cases) {
      expect(checkBundle(`${ALL_MARKERS} ${bad}`), bad).toHaveLength(1);
    }
  });

  it("修复后的调用形态与第三方依赖的递归 mkdir 不误报", () => {
    const ok = [
      ALL_MARKERS,
      "mkdirLevelsSync3(cacheDir3())",
      "mkdirLevelsSync2(this.dir)",
      "function mkdirSync2(dir) { nodeFs.mkdirSync(dir, { recursive: true }); }",
      "async function mkdir3(dir) { await nodeFsPromises.mkdir(dir, { recursive: true }); }",
      "await fs$1.mkdir(path5.dirname(resolvedPath), { recursive: true });",
    ].join("\n");
    expect(checkBundle(ok)).toEqual([]);
  });
});

describe("真实 bundle", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "flow-bundle-guard-"));
  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("从当前源码构建出的 bundle 通过产物守卫", async () => {
    const outfile = join(tmpDir, "bundle.mjs");
    await bundleAgent({ outfile, cwd: PKG_DIR, quiet: true }); // 内部已调用 assertBundleGuarded
    expect(existsSync(outfile)).toBe(true);
    expect(checkBundle(readFileSync(outfile, "utf-8"))).toEqual([]);
  });
});
