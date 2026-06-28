#!/usr/bin/env node
/**
 * 通过 rcoder-cli 对 flow ACP agent 做冒烟测试（内联 one-shot chat）。
 * 跨平台（PowerShell / macOS / Linux）。
 *
 * 模型 env：从 .env + config/flow-agent.config.json 解析（过滤 {MODEL_PROVIDER_*} 占位符），
 * 再 -e 传给 rcoder 子进程，避免 400 Invalid model。
 *
 * 默认入口为包主 flow（src/index.ts）。可用 --entry 或 AGENT_ENTRY 指向其他 flow。
 *
 * Debug:
 *   pnpm run smoke -- --debug --dry-run
 *   SMOKE_DEBUG=1 SMOKE_DRY_RUN=1 pnpm run smoke
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { commandExists } from "./lib/tools.mjs";
import { resolveExample } from "./lib/example-registry.mjs";
import {
  hasSmokeCredential,
  loadFlowAgentConfig,
  resolveSmokeModelEnv,
  resolveSmokePrompts,
} from "./lib/smoke-env.mjs";

const PKG_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    } else if (arg === "--example" && argv[i + 1]) {
      const exampleName = argv[++i];
      const spec = resolveExample(exampleName);
      if (!spec) {
        console.error(`Unknown example: ${exampleName}`);
        process.exit(1);
      }
      entry = spec.entry;
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

function buildRcoderArgs({ entry, prompt, timeoutS, verbose, smokeEnv }) {
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

  for (const [name, val] of Object.entries(smokeEnv.forward)) {
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

function warnActiveFlow(smokeEnv, { entry, debug }) {
  const expect = process.env.SMOKE_EXPECT_ACTIVE_FLOW?.trim();
  const active = smokeEnv.activeFlow ?? "(unknown)";
  if (expect && active !== expect) {
    console.error(
      `ERROR: activeFlow="${active}" 与 SMOKE_EXPECT_ACTIVE_FLOW="${expect}" 不一致。请先改 config/flow-agent.config.json`
    );
    process.exit(1);
  }
  const isMainEntry = entry === DEFAULT_ENTRY || entry === "src/index.ts";
  if (
    isMainEntry &&
    active === "default" &&
    process.env.SMOKE_WARN_ACTIVE_FLOW !== "0"
  ) {
    console.error(
      `WARN: activeFlow=default — smoke 跑的是默认 ReAct 图，不是 custom flow。开发 interview-agent 等请先把 activeFlow 写入 config，或设 SMOKE_EXPECT_ACTIVE_FLOW=<name>`
    );
  }
  logDebug(debug, "activeFlow:", active);
}

function usage() {
  console.log(`Usage: node scripts/smoke-acp.mjs [options]

Options:
  --entry PATH     Agent entry TS file (default: src/index.ts; also AGENT_ENTRY env)
  --example NAME   Shorthand for --entry (rag | travel | pm | review | dev-agent | research)
  --debug       Log resolved paths, env (masked), and command (also SMOKE_DEBUG=1)
  --dry-run     Print plan and exit 0 without calling rcoder-cli (also SMOKE_DRY_RUN=1)
  -h, --help    Show help

Env (model — 与 runtime config-loader 对齐):
  ./.env               复制 .env.example；OPENAI_* 或 ANTHROPIC_* 凭证
  flow-agent.config.json  model.provider / model.name（env 未设或占位符时兜底）

  SMOKE_PROMPT         主路径 prompt（默认 React useState 题）
  SMOKE_PROMPT_EDGE    可选第二条 prompt（边界输入，如「你是？」，验 R-G002）
  SMOKE_EXPECT_ACTIVE_FLOW  与 config.activeFlow 不一致则失败
  SMOKE_WARN_ACTIVE_FLOW=0  关闭 activeFlow=default 警告
  SMOKE_TIMEOUT        Timeout seconds (default: 150)
  SMOKE_VERBOSE=1      Pass -v to rcoder-cli
  ./.env               Model credentials (see .env.example)`);
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

  const flowConfig = loadFlowAgentConfig(PKG_DIR);
  const smokeEnv = resolveSmokeModelEnv(process.env, flowConfig);

  if (!hasSmokeCredential(process.env)) {
    if (flags.dryRun) {
      console.error("WARN: no model credential — dry-run only, rcoder would fail.");
    } else {
      console.error(`ERROR: no model credential found for smoke:acp.
Set at least one of OPENAI_API_KEY / ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN
in ${dotenvPath} (see .env.example) or your shell environment.

Debug without credentials:
  pnpm run smoke -- --debug --dry-run`);
      process.exit(1);
    }
  }

  if (!smokeEnv.modelName) {
    console.error(
      "ERROR: 无法解析 model name。请设 OPENAI_MODEL / ANTHROPIC_MODEL / DEFAULT_MODEL，或 config/flow-agent.config.json → model.name"
    );
    process.exit(1);
  }

  const prompts = resolveSmokePrompts(process.env, DEFAULT_PROMPT);
  const timeoutS = process.env.SMOKE_TIMEOUT ?? DEFAULT_TIMEOUT;
  const verbose = process.env.SMOKE_VERBOSE === "1";
  const entryPath = path.resolve(PKG_DIR, flags.entry);

  warnActiveFlow(smokeEnv, flags);

  if (flags.debug) {
    console.error("[smoke:acp] resolved model:");
    console.error(`  provider=${smokeEnv.provider} model=${smokeEnv.modelName} baseUrl=${smokeEnv.baseUrl ?? "(default)"}`);
    console.error(`  activeFlow=${smokeEnv.activeFlow ?? "(unknown)"}`);
    if (smokeEnv.skippedPlaceholderKeys.length) {
      console.error(`  skipped placeholders: ${smokeEnv.skippedPlaceholderKeys.join(", ")}`);
    }
    console.error("[smoke:acp] forward env (masked):");
    for (const [k, v] of Object.entries(smokeEnv.forward)) {
      const secret = /KEY|TOKEN/i.test(k);
      console.error(`  ${k}=${secret ? maskSecret(v) : v}`);
    }
    console.error("[smoke:acp] entry:", flags.entry, existsSync(entryPath) ? "(ok)" : "(missing)");
    console.error("[smoke:acp] tsx:", resolveTsx());
    console.error("[smoke:acp] prompts:", prompts.map((p) => JSON.stringify(p)).join(" → "));
    console.error("[smoke:acp] timeout:", timeoutS);
  }

  if (!existsSync(entryPath) && !flags.dryRun) {
    console.error(`Agent entry not found: ${flags.entry}`);
    process.exit(1);
  }

  const pnpm = resolvePnpm();

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const label = prompts.length > 1 ? ` [${i + 1}/${prompts.length}]` : "";
    if (prompts.length > 1) {
      console.error(`[smoke:acp]${label} prompt: ${JSON.stringify(prompt)}`);
    }

    const rcoderArgs = buildRcoderArgs({
      entry: flags.entry,
      prompt,
      timeoutS,
      verbose,
      smokeEnv,
    });

    if (flags.dryRun) {
      console.log(`# dry-run${label} — rcoder command:`);
      console.log(formatCommand(pnpm, rcoderArgs));
      continue;
    }

    const code = runPnpm(rcoderArgs, { debug: flags.debug });
    if (code !== 0) {
      console.error(`[smoke:acp] failed${label} (exit ${code})`);
      process.exit(code);
    }
  }
}

main();
