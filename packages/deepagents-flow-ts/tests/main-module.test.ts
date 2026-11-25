/**
 * isMainModule —— 入口判定对软链接稳健。
 *
 * 回归：旧判定直接比较 `process.argv[1]` 与 `import.meta.url`。经软链接 / bin shim 启动时
 * `argv[1]` 是链接路径，而 ESM 入口按真实路径解析，两者不相等 → `main()` 不执行、
 * 进程静默退出且退出码为 0。macOS 上 `/tmp`、`/var` 本身就是软链接，启动路径里只要有一级是链接就会中招。
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isMainModule } from "../src/runtime/main-module.js";

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-main-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("isMainModule", () => {
  it("以真实路径启动 → true；别的文件 / 无 argv[1] → false", () => {
    const dir = freshDir();
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, "");
    const other = join(dir, "other.mjs");
    writeFileSync(other, "");
    // ESM 入口按真实路径解析（与 Node 的行为一致）
    const moduleUrl = pathToFileURL(realpathSync(entry)).href;

    expect(isMainModule(entry, moduleUrl)).toBe(true);
    expect(isMainModule(other, moduleUrl)).toBe(false);
    expect(isMainModule(undefined, moduleUrl)).toBe(false);
  });

  it("经软链接启动（文件链接 / 目录链接）→ true，旧判定在同样输入下判否", () => {
    const dir = freshDir();
    const realDir = join(dir, "real");
    mkdirSync(realDir);
    const entry = join(realDir, "entry.mjs");
    writeFileSync(entry, "");
    const fileLink = join(dir, "link.mjs");
    symlinkSync(entry, fileLink);
    const dirLink = join(dir, "linkdir");
    symlinkSync(realDir, dirLink, "dir");
    const moduleUrl = pathToFileURL(realpathSync(entry)).href;

    // 旧判定：argv[1] 是链接路径 → 与 import.meta.url 不等 → main() 不执行
    expect(pathToFileURL(fileLink).href === moduleUrl).toBe(false);
    expect(pathToFileURL(join(dirLink, "entry.mjs")).href === moduleUrl).toBe(false);

    expect(isMainModule(fileLink, moduleUrl)).toBe(true);
    expect(isMainModule(join(dirLink, "entry.mjs"), moduleUrl)).toBe(true);
    expect(isMainModule(entry, moduleUrl)).toBe(true);
  });

  it("入口路径不存在或模块不是 file URL → false（不抛错）", () => {
    const dir = freshDir();
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, "");
    const moduleUrl = pathToFileURL(realpathSync(entry)).href;

    expect(isMainModule(join(dir, "missing.mjs"), moduleUrl)).toBe(false);
    expect(isMainModule(entry, "data:text/javascript,")).toBe(false);
  });
});
