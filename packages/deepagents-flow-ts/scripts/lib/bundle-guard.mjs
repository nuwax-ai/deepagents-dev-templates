/**
 * 产物守卫：构建出的 bundle 必须带着已知修复，且一方代码的已知危险调用形态不得再现。
 *
 * 为什么不用「bundle 里出现 recursive: true 即失败」：bundle 打进了第三方依赖，它们内部
 * 也有递归 mkdir / rm（实测 6 处），一刀切只会误报。这里只认一方代码的特征：
 *   - 必须存在：各修复点的稳定字面量（日志 / 告警文案）。
 *   - 不得出现：一方代码已知的危险调用形态（按参数形状识别，esbuild 改名不影响）。
 *
 * 源码层面的完整守卫在 tests/no-recursive-mkdir.test.ts；这里补的是「产物 ≠ 受检源码」的情况
 * （构建配置改动、过期产物等）。已知局限：vendored libs/deepagents-acp/logger.ts 的修复
 * 在产物里没有可识别的字面量，靠源码守卫和 tests/vendored-acp-logger-file.test.ts 覆盖。
 */

/**
 * 各修复点必须出现在产物里的字面量。
 * 只用 ASCII：esbuild 默认把非 ASCII 字符转成 \uXXXX 转义，带中文或破折号的标记在产物里匹配不上
 * （测试里有一条断言守住这一点）。
 */
export const REQUIRED_MARKERS = [
  // src/runtime/logger.ts：文件日志停用提示
  "[logger] file logging disabled",
  // src/runtime/services/file-checkpoint-saver.ts：checkpoint 降级告警
  "checkpoint persistence disabled",
];

/** 一方代码不得再出现的调用形态。 */
export const FORBIDDEN_SHAPES = [
  {
    label: "工具缓存目录用了递归 mkdir（runtime/mcp/tool-schema-cache.ts）",
    re: /\bmkdir[A-Za-z]*\d*\(\s*cacheDir\d*\(\s*\)\s*,\s*\{/g,
  },
  {
    label: "checkpoint 目录用了递归 mkdir（runtime/services/file-checkpoint-saver.ts）",
    re: /\bmkdir[A-Za-z]*\d*\(\s*this\.dir\s*,\s*\{/g,
  },
];

/** 返回问题列表；空数组 = 通过。 */
export function checkBundle(bundleText) {
  const problems = [];
  for (const marker of REQUIRED_MARKERS) {
    if (!bundleText.includes(marker)) {
      problems.push(`缺少修复标记 ${JSON.stringify(marker)}`);
    }
  }
  for (const { label, re } of FORBIDDEN_SHAPES) {
    re.lastIndex = 0;
    if (re.test(bundleText)) {
      problems.push(`出现一方代码的危险调用形态：${label}`);
    }
  }
  return problems;
}

/** 不通过直接抛错（供打包流程使用）。 */
export function assertBundleGuarded(bundleText, { source = "bundle" } = {}) {
  const problems = checkBundle(bundleText);
  if (problems.length > 0) {
    throw new Error(
      `[bundle-guard] ${source} 未通过产物守卫:\n${problems.map((p) => `  - ${p}`).join("\n")}`
    );
  }
  return true;
}
