#!/usr/bin/env node
/**
 * 通过 rcoder-cli 对 flow ACP agent 做冒烟测试（内联 one-shot chat）。
 * 跨平台（PowerShell / macOS / Linux）。
 *
 * 默认入口为包主 flow（src/index.ts）。可用 --entry 或 AGENT_ENTRY 指向其他 flow。
 *
 * Debug:
 *   pnpm run smoke:acp -- --debug --dry-run
 *   SMOKE_DEBUG=1 SMOKE_DRY_RUN=1 pnpm run smoke:acp
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { commandExists } from "./lib/tools.mjs";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FORWARD_VARS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENAI_MODEL",
  "DEFAULT_MODEL",
  "LLM_PROVIDER",
  "LOG_DIR",
  "LOG_LEVEL",
];

const DEFAULT_PROMPT = "如何用 React 的 useState 管理组件状态？请给出基本用法";
const DEFAULT_ENTRY = "src/index.ts";
const DEFAULT_TIMEOUT = "150";

function parseFlags(argv) {
  let entry = process.env.AGENT_ENTRY ?? DEFAULT_ENTRY;
  let debug = argv.includes("--debug") || process.env.SMOKE_DEBUG === "1";
  let dryRun = argv.includes("--dry-run") || process.env.SMOKE_DRY_RUN === "1";
  let help = argv.includes("-h") || argv.includes("--help");

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--entry" && argv[i + 1]) {
      entry = argv[++i];
    }
  }

  return { entry, debug, dryRun, help };
}

function logDebug(enabled, ...args) {
  if (enabled) console.error("[smoke:acp]", ...args);
}

function maskSecret(val) {
  if (!val) return "(unset)";
  if (val.length <= 8) return `*** (${val.length} chars)`;
  return `${val.slice(0, 4)}…${val.slice(-2)} (${val.length} chars)`;
}

function resolvePnpm() {
  if (process.platform === "win32") {
    for (const cmd of ["pnpm.cmd", "pnpm.exe", "pnpm"]) {
      if (commandExists(cmd)) return cmd;
    }
  }
  return "pnpm";
}

function resolveTsx() {
  const local = path.join(PKG_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  if (existsSync(local)) return local;
  if (commandExists("tsx")) return "tsx";
  return local;
}

function hasCredential() {
  return ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
    (v) => process.env[v],
  );
}

function buildRcoderArgs({ entry, prompt, timeoutS, verbose }) {
  const tsxBin = resolveTsx();
  const rcoderArgs = [
    "dlx",
    "rcoder-cli",
    "chat",
    "-c",
    tsxBin,
    "--arg",
    entry,
    "-w",
    PKG_DIR,
    "-p",
    prompt,
    "--timeout",
    timeoutS,
    "--mode",
    "yolo",
    "-q",
  ];
  if (verbose) rcoderArgs.push("-v");

  for (const name of FORWARD_VARS) {
    const val = process.env[name];
    if (val) rcoderArgs.push("-e", `${name}=${val}`);
  }
  return rcoderArgs;
}

function formatCommand(pnpm, args) {
  const quote = (s) => (/\s/.test(s) ? JSON.stringify(s) : s);
  return [pnpm, ...args].map(quote).join(" ");
}

function runPnpm(args, { debug }) {
  const pnpm = resolvePnpm();
  logDebug(debug, "cwd:", PKG_DIR);
  logDebug(debug, "cmd:", formatCommand(pnpm, args));

  const result = spawnSync(pnpm, args, {
    cwd: PKG_DIR,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });
  return result.status ?? 1;
}

function usage() {
  console.log(`Usage: node scripts/smoke-acp.mjs [options]

Options:
  --entry PATH  Agent entry TS file (default: src/index.ts; also AGENT_ENTRY env)
  --debug       Log resolved paths, env (masked), and command (also SMOKE_DEBUG=1)
  --dry-run     Print plan and exit 0 without calling rcoder-cli (also SMOKE_DRY_RUN=1)
  -h, --help    Show help

Env:
  AGENT_ENTRY      Same as --entry
  SMOKE_PROMPT     Prompt text (default: RAG-style Chinese question)
  SMOKE_TIMEOUT    Timeout seconds (default: 150)
  SMOKE_VERBOSE=1  Pass -v to rcoder-cli
  ./.env           Model credentials (see .env.example)`);
}

function main() {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    usage();
    return;
  }

  process.chdir(PKG_DIR);
  const dotenvPath = path.join(PKG_DIR, ".env");
  const dotenvResult = loadDotenv({ path: dotenvPath });

  logDebug(flags.debug, "package dir:", PKG_DIR);
  logDebug(flags.debug, ".env path:", dotenvPath, existsSync(dotenvPath) ? "(found)" : "(missing)");
  if (flags.debug && dotenvResult.error) {
    logDebug(true, ".env load error:", dotenvResult.error.message);
  }

  if (!hasCredential()) {
    if (flags.dryRun) {
      console.error("WARN: no model credential — dry-run only, rcoder would fail.");
    } else {
      console.error(`ERROR: no model credential found for smoke:acp.
Set at least one of:
  - Anthropic:         ANTHROPIC_API_KEY (or ANTHROPIC_AUTH_TOKEN) [+ ANTHROPIC_BASE_URL / ANTHROPIC_MODEL]
  - OpenAI-compatible: OPENAI_API_KEY + OPENAI_BASE_URL + OPENAI_MODEL
in ${dotenvPath} or your shell environment.

Debug without credentials:
  pnpm run smoke:acp -- --debug --dry-run`);
      process.exit(1);
    }
  }

  const prompt = process.env.SMOKE_PROMPT ?? DEFAULT_PROMPT;
  const timeoutS = process.env.SMOKE_TIMEOUT ?? DEFAULT_TIMEOUT;
  const verbose = process.env.SMOKE_VERBOSE === "1";
  const entryPath = path.resolve(PKG_DIR, flags.entry);

  if (flags.debug) {
    console.error("[smoke:acp] forwarded env (masked):");
    for (const name of FORWARD_VARS) {
      console.error(`  ${name}=${maskSecret(process.env[name])}`);
    }
    console.error("[smoke:acp] entry:", flags.entry, existsSync(entryPath) ? "(ok)" : "(missing)");
    console.error("[smoke:acp] tsx:", resolveTsx());
    console.error("[smoke:acp] prompt:", JSON.stringify(prompt));
    console.error("[smoke:acp] timeout:", timeoutS);
  }

  if (!existsSync(entryPath) && !flags.dryRun) {
    console.error(`Agent entry not found: ${flags.entry}`);
    process.exit(1);
  }

  const rcoderArgs = buildRcoderArgs({ entry: flags.entry, prompt, timeoutS, verbose });
  const pnpm = resolvePnpm();

  if (flags.dryRun) {
    console.log("# dry-run — rcoder command:");
    console.log(formatCommand(pnpm, rcoderArgs));
    return;
  }

  process.exit(runPnpm(rcoderArgs, { debug: flags.debug }));
}

main();
