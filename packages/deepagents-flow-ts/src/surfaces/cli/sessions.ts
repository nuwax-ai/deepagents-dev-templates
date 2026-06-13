/**
 * flow sessions —— 列出已持久化的会话（FileCheckpointSaver 的 thread 文件）。
 *
 * 静态读取 config.memory.dir 目录（不加载 MCP、不需凭证）。
 */

import { readdirSync, existsSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { loadFlowConfig } from "../../runtime/config.js";

function expandDir(dir: string, pkgRoot: string): string {
  let d = dir || "./.flow-sessions";
  if (d.startsWith("~/")) d = resolve(homedir(), d.slice(2));
  return d.startsWith("/") ? d : resolve(pkgRoot, d);
}

export async function runSessions(): Promise<void> {
  const { appConfig, configPath } = loadFlowConfig();
  const pkgRoot = dirname(dirname(configPath));
  const dir = expandDir(appConfig.memory.dir, pkgRoot);

  const sessions: { id: string; mtime: string }[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      try {
        sessions.push({
          id: f.slice(0, -5),
          mtime: statSync(resolve(dir, f)).mtime.toISOString(),
        });
      } catch {
        /* skip */
      }
    }
  }
  sessions.sort((a, b) => b.mtime.localeCompare(a.mtime));

  process.stdout.write(
    JSON.stringify({ dir, count: sessions.length, sessions }, null, 2) + "\n"
  );
}
