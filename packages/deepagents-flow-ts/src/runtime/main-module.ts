/**
 * 入口判定：当前模块是否就是 Node 启动的主模块。
 *
 * 不能直接比较 `process.argv[1]` 与 `import.meta.url`：经软链接 / bin shim 启动时，
 * `process.argv[1]` 是链接路径，而 ESM 入口已按真实路径解析，两者字符串不相等 →
 * `main()` 不执行、进程静默退出且退出码为 0。这里对两边各取一次真实路径再比较。
 *
 * 无依赖的纯函数模块：入口（index.ts）与单测共用。
 */

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

function realPath(p: string): string {
  // native：走系统 realpath，两边的盘上大小写归一方式一致（Windows / macOS 默认大小写不敏感）。
  return realpathSync.native(p);
}

export function isMainModule(entry: string | undefined, moduleUrl: string): boolean {
  if (!entry) return false;
  const entryPath = resolve(entry);
  try {
    const [entryReal, moduleReal] = [
      realPath(entryPath),
      realPath(fileURLToPath(moduleUrl)),
    ];
    return process.platform === "win32"
      ? entryReal.toLowerCase() === moduleReal.toLowerCase()
      : entryReal === moduleReal;
  } catch {
    // 取不到真实路径（异常启动环境 / 非文件 URL）：退回原来的字符串比较，保持旧行为。
    return pathToFileURL(entryPath).href === moduleUrl;
  }
}
