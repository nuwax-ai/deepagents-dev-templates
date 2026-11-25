/**
 * mkdirLevels / mkdirLevelsSync —— 逐级、非递归建目录。
 *
 * 回归点：上级目录失效（如源目录被删的 bind mount）时必须立即失败，调用次数随路径深度有界。
 * 建目录的原语可注入，这里用假的 mkdir 精确模拟失效目录，不需要真实挂载。
 */

import { describe, it, expect, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { mkdirLevels, mkdirLevelsSync } from "../src/runtime/fs/mkdir-levels.js";

function fsError(code: string, path: string): NodeJS.ErrnoException {
  return Object.assign(
    new Error(`${code}: no such file or directory, mkdir '${path}'`),
    { code }
  );
}

/**
 * 模拟「源目录已被删除的 bind mount」：dead 本身 mkdir → EEXIST（目录在），
 * 其下 mkdir → ENOENT（建不出来）。与线上容器内 `mkdir` 的表现一致。
 */
function deadDirMkDir(dead: string): { mkDir: (path: string) => void; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    mkDir: (path) => {
      calls.push(path);
      if (path === dead) throw fsError("EEXIST", path);
      if (path.startsWith(dead + sep)) throw fsError("ENOENT", path);
    },
  };
}

const tmpDirs: string[] = [];
function freshDir(): string {
  const d = mkdtempSync(join(tmpdir(), "flow-mkdir-"));
  tmpDirs.push(d);
  return d;
}
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("mkdirLevels / mkdirLevelsSync", () => {
  it("正常路径（同步）：逐级建出多级目录，已存在的目录容忍", () => {
    const root = freshDir();
    const target = join(root, "a", "b", "c");
    mkdirLevelsSync(target);
    expect(existsSync(target)).toBe(true);
    expect(() => mkdirLevelsSync(target)).not.toThrow();

    mkdirSync(join(root, "x"));
    mkdirLevelsSync(join(root, "x", "y"));
    expect(existsSync(join(root, "x", "y"))).toBe(true);
  });

  it("正常路径（异步）：逐级建出多级目录", async () => {
    const root = freshDir();
    const target = join(root, "p", "q");
    await mkdirLevels(target);
    expect(existsSync(target)).toBe(true);
  });

  it("上级目录失效：每一级最多试两次，立即以 ENOENT 失败", () => {
    const dead = join(tmpdir(), "flow-mkdir-dead", "dead");
    const target = join(dead, "sess-1", "logs");
    const { mkDir, calls } = deadDirMkDir(dead);

    expect(() => mkdirLevelsSync(target, mkDir)).toThrow("ENOENT");
    // logs → sess-1 → dead(EEXIST) → 重试 sess-1(ENOENT) 即止，不再往上走
    expect(calls).toEqual([target, join(dead, "sess-1"), dead, join(dead, "sess-1")]);
    expect(calls.length).toBeLessThanOrEqual(2 * 4);
  });

  it("上级目录自身也报 ENOENT：同样有界失败", () => {
    const dead = join(tmpdir(), "flow-mkdir-dead", "dead");
    const target = join(dead, "sess-1", "logs");
    const calls: string[] = [];
    const mkDir = (path: string): void => {
      calls.push(path);
      if (path.startsWith(dead)) throw fsError("ENOENT", path);
    };

    expect(() => mkdirLevelsSync(target, mkDir)).toThrow("ENOENT");
    expect(calls).toEqual([
      target,
      join(dead, "sess-1"),
      dead,
      join(dead, ".."),
      dead,
    ]);
    expect(calls.length).toBeLessThanOrEqual(2 * 5);
  });

  it("其他错误码原样抛出，不重试", () => {
    const calls: string[] = [];
    const mkDir = (path: string): void => {
      calls.push(path);
      throw Object.assign(new Error(`EACCES: permission denied, mkdir '${path}'`), {
        code: "EACCES",
      });
    };

    expect(() => mkdirLevelsSync(join(tmpdir(), "flow-mkdir-eacces", "x"), mkDir)).toThrow(
      "EACCES"
    );
    expect(calls).toHaveLength(1);
  });

  it("异步版：上级目录失效时同样有界失败", async () => {
    const dead = join(tmpdir(), "flow-mkdir-dead", "dead");
    const target = join(dead, "sess-1", "logs");
    const { mkDir, calls } = deadDirMkDir(dead);

    await expect(
      mkdirLevels(target, async (path) => mkDir(path))
    ).rejects.toThrow("ENOENT");
    expect(calls).toEqual([target, join(dead, "sess-1"), dead, join(dead, "sess-1")]);
  });
});
