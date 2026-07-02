#!/usr/bin/env node
/**
 * 统一范例入口：pnpm example <name> [args...]
 *
 *   pnpm example rag "什么是 LangGraph？"   # CLI
 *   pnpm example rag -i                    # 交互 CLI
 *   pnpm example rag                       # 启动 ACP 服务
 *   pnpm example --list                    # 列出可用范例
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildExampleArgv,
  listExamples,
  resolveExample,
} from "./lib/example-registry.mjs";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function resolveTsxModule() {
  // 用 node 直接跑 tsx 的 cli.mjs（等价 tsx shim），而非 spawn node_modules/.bin/tsx.cmd：
  // Windows 上直接 spawn .cmd 会触发 Node CVE-2024-27980 守卫抛 EINVAL；而 shell:true 又会
  // 破坏含中文/空格的 query 参数引号。node + cli.mjs 两端都干净。
  const cli = path.join(PKG_DIR, "node_modules", "tsx", "dist", "cli.mjs");
  return existsSync(cli) ? cli : null;
}

function usage() {
  console.log(`Usage: pnpm example <name> [args...]
       pnpm example --list

Run a reference example by short name. Extra args forward to the example entry.

Examples:
  pnpm example rag "什么是 LangGraph？"
  pnpm example rag -i
  pnpm example travel "东京 3 天"
  pnpm example research "调研 LangGraph 生态"
  pnpm smoke -- --example rag

Available examples:`);
  for (const ex of listExamples()) {
    const cliHint = ex.cli ? ` (cli: ${ex.cli})` : "";
    console.log(`  ${ex.name.padEnd(12)} ${ex.description}${cliHint}`);
  }
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    usage();
    process.exit(argv.length === 0 ? 1 : 0);
  }

  if (argv[0] === "--list" || argv[0] === "list") {
    for (const ex of listExamples()) {
      console.log(`${ex.name}\t${ex.entry}`);
    }
    return;
  }

  const name = argv[0];
  const userArgs = argv.slice(1);
  const spec = resolveExample(name);

  if (!spec) {
    console.error(`Unknown example: ${name}`);
    console.error("Run: pnpm example --list");
    process.exit(1);
  }

  const entryPath = path.resolve(PKG_DIR, spec.entry);
  if (!existsSync(entryPath)) {
    console.error(`Example entry not found: ${spec.entry}`);
    process.exit(1);
  }

  const forwardArgs = buildExampleArgv(spec.cli, userArgs);
  const tsxModule = resolveTsxModule();
  const spawnOpts = { cwd: PKG_DIR, stdio: "inherit", env: process.env };
  // 首选本地 tsx cli.mjs（node 跑）；tsx 不在本地 node_modules（罕见）时回退 PATH 上的 tsx
  // （Windows 需 shell 解析 .cmd）。
  const result = tsxModule
    ? spawnSync(process.execPath, [tsxModule, entryPath, ...forwardArgs], spawnOpts)
    : spawnSync("tsx", [entryPath, ...forwardArgs], {
        ...spawnOpts,
        shell: process.platform === "win32",
      });

  process.exit(result.status ?? 1);
}

main();
