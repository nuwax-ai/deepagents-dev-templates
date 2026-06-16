/**
 * path-utils 跨平台路径解析单测（用固定路径字符串模拟，不依赖真实 OS）。
 */

import { describe, it, expect } from "vitest";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  toPosixPath,
  toAbsolutePath,
  toWorkspaceRelativePosix,
  matchPosixGlob,
} from "../src/runtime/path-utils.js";

describe("toPosixPath", () => {
  it("反斜杠转成正斜杠", () => {
    expect(toPosixPath("src\\app\\a.ts")).toBe("src/app/a.ts");
  });
});

describe("toAbsolutePath", () => {
  const ws = resolve("/tmp/flow-ws-test");

  it("相对路径解析到 workspace 下", () => {
    expect(toAbsolutePath("src/a.ts", ws)).toBe(resolve(ws, "src/a.ts"));
  });

  it("POSIX workspace 根相对 /test.txt 不落到系统根", () => {
    expect(toAbsolutePath("/test.txt", ws)).toBe(resolve(ws, "test.txt"));
  });

  it("~/ 使用 homedir 展开", () => {
    expect(toAbsolutePath("~/doc/x", "/ws")).toBe(resolve(homedir(), "doc/x"));
  });
});

describe("toWorkspaceRelativePosix", () => {
  it("产出 POSIX 相对路径", () => {
    const base = resolve("/tmp/flow-ws-test");
    const file = resolve(base, "src/app/foo.ts");
    expect(toWorkspaceRelativePosix(file, base)).toBe("src/app/foo.ts");
  });
});

describe("matchPosixGlob", () => {
  it("denied 前缀匹配反斜杠路径", () => {
    const denied = "C:\\ws\\src\\runtime";
    const file = "C:\\ws\\src\\runtime\\x.ts";
    expect(matchPosixGlob(file, denied)).toBe(true);
  });

  it("/** 后缀匹配子目录", () => {
    expect(matchPosixGlob("C:/ws/src/runtime/x.ts", "C:/ws/src/runtime/**")).toBe(true);
  });
});
