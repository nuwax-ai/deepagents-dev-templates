#!/usr/bin/env node
/**
 * 统一范例入口：pnpm example <name> [args...]
 *
 *   pnpm example rag "什么是 LangGraph？"   # CLI
 *   pnpm example rag -i                    # 交互 CLI
 *   pnpm example rag                       # 启动 ACP 服务
 *   pnpm example dev-agent "查 ToolNode"   # 无子命令，直接传 query
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

function resolveTsx() {
  const local = path.join(PKG_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  if (existsSync(local)) return local;
  return "tsx";
}

function usage() {
  console.log(`Usage: pnpm example <name> [args...]
       pnpm example --list

Run a reference example by short name. Extra args forward to the example entry.

Examples:
  pnpm example rag "什么是 LangGraph？"
  pnpm example rag -i
  pnpm example travel "东京 3 天"
  pnpm example dev-agent "查 langgraph ToolNode"
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
  const tsx = resolveTsx();
  const result = spawnSync(tsx, [entryPath, ...forwardArgs], {
    cwd: PKG_DIR,
    stdio: "inherit",
    env: process.env,
  });

  process.exit(result.status ?? 1);
}

main();
