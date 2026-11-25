/**
 * 静态守卫：一方代码建目录不得使用递归 mkdir，且只能经 fs/mkdir-levels.ts。
 *
 * Node 的递归 mkdir 在上级目录失效（如源目录被删的 bind mount）时会无界重试
 * （nodejs/node#66268，v22.23.x / v24.21.0 未修）：同步形式占满一个核并卡死主线程，
 * 异步形式占死一个线程池线程。动态行为见 logger-file-logging / mkdir-levels /
 * file-checkpoint-persistence 几个测试；这里防止日后有人把 recursive 加回来，
 * 或在别处绕过助手直接建目录。
 *
 * 用 TypeScript 编译器接口解析 AST，而不是对源码文本做正则：注释和字符串不会误报，
 * 别名导入（`import { mkdirSync as _m }`）也躲不过——调用处写的是 `_m(p)`，但原名仍在 AST 里。
 */

import { describe, it, expect } from "vitest";
import ts from "typescript";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../src");

/** 规则一：这些文件里不得出现 `recursive: true`。 */
const GUARDED = [
  "runtime/fs/mkdir-levels.ts",
  "runtime/logger.ts",
  "runtime/services/file-checkpoint-saver.ts",
  "runtime/mcp/tool-schema-cache.ts",
  "libs/deepagents-acp/logger.ts",
];

/** 规则二：src/ 下出现 mkdir / mkdirSync 标识符的只允许这些文件。 */
const MAY_CALL_MKDIR = new Set([
  "runtime/fs/mkdir-levels.ts",
  "runtime/logger.ts", // 注入带超时的实现
  "libs/deepagents-acp/logger.ts", // vendored，保持自包含
]);

/** 递归收集 src/ 下全部 .ts（排除 .d.ts）。 */
function collectTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = resolve(dir, name);
    if (statSync(full).isDirectory()) collectTs(full, out);
    else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function parse(sourceText: string, fileName: string): ts.SourceFile {
  return ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.ESNext, true);
}

function lineOf(sf: ts.SourceFile, node: ts.Node): number {
  return sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
}

/** 所有 `recursive: true` 的属性赋值所在行。 */
function findRecursiveTrue(sourceText: string, fileName: string): number[] {
  const sf = parse(sourceText, fileName);
  const hits: number[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(sf).replace(/^["']|["']$/g, "") === "recursive" &&
      node.initializer.kind === ts.SyntaxKind.TrueKeyword
    ) {
      hits.push(lineOf(sf, node));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

/** 所有名为 mkdir / mkdirSync 的标识符（import 的原名、属性访问、直接调用都算）。 */
function findMkdirIdentifiers(sourceText: string, fileName: string): string[] {
  const sf = parse(sourceText, fileName);
  const hits: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && (node.text === "mkdir" || node.text === "mkdirSync")) {
      hits.push(`${lineOf(sf, node)}: ${node.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

describe("一方代码不得使用递归 mkdir", () => {
  it("守卫名单里的文件都存在，且 src/ 下能扫到文件（自检）", () => {
    for (const rel of GUARDED) expect(existsSync(resolve(SRC, rel)), rel).toBe(true);
    for (const rel of MAY_CALL_MKDIR) expect(existsSync(resolve(SRC, rel)), rel).toBe(true);
    expect(collectTs(SRC).length).toBeGreaterThan(20);
  });

  it("AST 检测自检：别名导入和注释都能正确处理", () => {
    const aliased = 'import { mkdirSync as _m } from "node:fs";\nexport const t = (p: string) => _m(p);\n';
    expect(findMkdirIdentifiers(aliased, "x.ts")).toEqual(["1: mkdirSync"]);
    // 注释、字符串、相近的名字都不算
    const harmless = [
      '// mkdirSync(dir) in a comment',
      'export const s = "mkdirSync(dir)";',
      "export const a = (d: string) => mkdirLevelsSync(d);",
    ].join("\n");
    expect(findMkdirIdentifiers(harmless, "y.ts")).toEqual([]);
    expect(findRecursiveTrue("const o = { recursive: true };", "z.ts")).toEqual([1]);
    expect(findRecursiveTrue("const o = { recursive: false, other: true };", "z.ts")).toEqual([]);
    expect(findRecursiveTrue("const o = { recursive: true }; // in a string only", "w.ts")).toEqual([1]);
  });

  for (const rel of GUARDED) {
    it(`${rel} 中没有 recursive: true`, () => {
      const hits = findRecursiveTrue(readFileSync(resolve(SRC, rel), "utf-8"), rel);
      expect(hits, `${rel} 第 ${hits.join("、")} 行出现 recursive: true`).toEqual([]);
    });
  }

  it("src/ 下出现 mkdir / mkdirSync 标识符的只有白名单文件", () => {
    const offenders: string[] = [];
    for (const file of collectTs(SRC)) {
      const rel = relative(SRC, file).split(sep).join("/");
      if (MAY_CALL_MKDIR.has(rel)) continue;
      const hits = findMkdirIdentifiers(readFileSync(file, "utf-8"), rel);
      if (hits.length > 0) offenders.push(`${rel}（${hits.join("，")}）`);
    }
    expect(offenders, `这些文件绕过了 fs/mkdir-levels.ts 直接建目录:\n${offenders.join("\n")}`).toEqual([]);
  });
});
