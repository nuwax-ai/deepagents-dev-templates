/**
 * 默认 MCP 配置 —— npx 拉不到包时必须快速失败。
 *
 * 回归点：`ask-question` 由 `npx -y nuwax-ask-question-mcp@latest` 启动。离线或访问不到 npm registry 时，
 * npm 默认退避重试到约 70 秒才放弃，而 MCP SDK 的连接超时是 60 秒——于是**每个新会话**都要等满
 * 60 秒（实测 session/new 60,075ms）。加上不重试 + 请求超时后降到约 0.5 秒。
 * 这里防止日后有人把参数删掉；端到端行为见 CHANGELOG 2.3.2 的 Docker 实测记录。
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../config/mcp.default.json"
);

interface ServerEntry {
  command?: string;
  args?: string[];
}

const servers = (
  JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as { servers: Record<string, ServerEntry> }
).servers;
const npxServers = Object.entries(servers).filter(
  ([, server]) => server.command === "npx" || server.command === "npm"
);

describe("默认 MCP 配置：npx 拉不到包时必须快速失败", () => {
  it("默认配置里至少有一个 npx 启动的 server（自检）", () => {
    expect(npxServers.length).toBeGreaterThan(0);
  });

  for (const [name, server] of npxServers) {
    it(`${name}：失败时间有上界（最多重试 1 次、单次请求不超过 10 秒），且不用 --offline`, () => {
      const args = server.args ?? [];
      const retries = args.find((a) => a.startsWith("--fetch-retries"));
      const timeout = args.find((a) => a.startsWith("--fetch-timeout"));
      expect(retries, "缺少 --fetch-retries").toBeDefined();
      expect(timeout, "缺少 --fetch-timeout").toBeDefined();
      // npm 默认重试 2 次且退避到 10–60 秒；这里要求总等待远小于 MCP 连接超时（60 秒）
      expect(Number(retries!.split("=")[1])).toBeLessThanOrEqual(1);
      expect(Number(timeout!.split("=")[1])).toBeLessThanOrEqual(10_000);
      // --offline 会让联网且没缓存的首次启动直接失败；快速失败靠的是不重试 / 少重试 + 请求超时
      expect(args).not.toContain("--offline");
    });
  }
});
