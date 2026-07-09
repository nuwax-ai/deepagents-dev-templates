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
import {
  configureExpectedToolTrace,
  hasSmokeCredential,
  loadFlowAgentConfig,
  resolveSmokeModelEnv,
  resolveSmokePrompts,
} from "./lib/smoke-env.mjs";
import { evaluateSmokeOutput } from "./lib/smoke-outcome.mjs";

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
    } else if (arg === "--example") {
      console.error(
        "Removed: --example. Scaffold a flow into src/app/flows/, set activeFlow, then use --entry src/index.ts."
      );
      process.exit(1);
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

function resolveNpx() {
  if (process.platform === "win32") {
    for (const cmd of ["npx.cmd", "npx.exe", "npx"]) {
      if (commandExists(cmd)) return cmd;
    }
  }
  return "npx";
}

/** 默认 npx（绕过 pnpm dlx 的 minimumReleaseAge / deps 检查）；SMOKE_RCODER_LAUNCHER=pnpm 可回退 */
function resolveRcoderCmd(chatArgs) {
  const mode = (process.env.SMOKE_RCODER_LAUNCHER ?? "npx").trim().toLowerCase();
  if (mode === "pnpm") {
    return { cmd: resolvePnpm(), args: ["dlx", "rcoder-cli", ...chatArgs] };
  }
  return { cmd: resolveNpx(), args: ["-y", "rcoder-cli", ...chatArgs] };
}

function resolveTsx() {
  const local = path.join(PKG_DIR, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  if (existsSync(local)) return local;
  if (commandExists("tsx")) return "tsx";
  return local;
}

function buildRcoderChatArgs({ entry, prompt, timeoutS, verbose, smokeEnv }) {
  const tsxBin = resolveTsx();
  const chatArgs = [
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
  if (verbose) chatArgs.push("-v");

  for (const [name, val] of Object.entries(smokeEnv.forward)) {
    if (val) chatArgs.push("-e", `${name}=${val}`);
  }
  return chatArgs;
}

function formatCommand(cmd, args) {
  const quote = (s) => (/\s/.test(s) ? JSON.stringify(s) : s);
  return [cmd, ...args].map(quote).join(" ");
}

// rcoder 在 agent 空答 / Session cancelled 时仍可能 exit 0 —— 仅看退出码会把「agent 没产出答案」漏成通过。
// 判定逻辑见 scripts/lib/smoke-outcome.mjs（session-trace 优先于 rcoder 收尾噪音）。

/** 回显 MCP 加载摘要（runtime info 日志 `Loaded MCP tools total=… connectedServers=… failedServers=…`）。 */
function echoMcpSummary(combined) {
  const loaded = [...combined.matchAll(/Loaded MCP tools[^\n]*/g)].at(-1)?.[0];
  if (loaded) console.error(`[smoke:acp] mcp: ${loaded.replace(/^.*Loaded MCP tools/, "Loaded MCP tools")}`);
  const failedLines = [...combined.matchAll(/MCP server 连接失败[^\n]*/g)].map((m) => m[0]);
  for (const line of failedLines.slice(0, 5)) {
    console.error(`[smoke:acp] mcp: ${line}`);
  }
}

function runRcoder({ cmd, args }, { debug, expectTool }) {
  logDebug(debug, "cwd:", PKG_DIR);
  logDebug(debug, "launcher:", process.env.SMOKE_RCODER_LAUNCHER ?? "npx (default)");
  logDebug(debug, "cmd:", formatCommand(cmd, args));

  let result;
  try {
    result = spawnSync(cmd, args, {
      cwd: PKG_DIR,
      stdio: ["inherit", "pipe", "pipe"],
      shell: false,
      env: process.env,
      maxBuffer: 100 * 1024 * 1024,
    });
  } catch (err) {
    // 输出超 maxBuffer 等异常：回退 inherit（仅看退出码，放弃特征扫描）
    logDebug(debug, "captured run threw, fallback to inherit:", String(err));
    const r = spawnSync(cmd, args, { cwd: PKG_DIR, stdio: "inherit", shell: false, env: process.env });
    if (expectTool) {
      // 平台能力闸门依赖输出扫描；无法捕获输出时不能假绿
      return { code: r.status ?? 1, failed: true, reason: `SMOKE_EXPECT_TOOL="${expectTool}"：输出捕获失败，无法验证工具调用` };
    }
    return { code: r.status ?? 1, failed: false, reason: "" };
  }
  // 回放捕获的输出，保持原 stdio:inherit 的可见性
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const code = result.status ?? 1;
  const combined = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  echoMcpSummary(combined);
  const evalResult = evaluateSmokeOutput(combined, { expectTool });
  if (expectTool && !evalResult.failed) {
    const done = (evalResult.toolCalls ?? []).filter((c) => c.status === "done");
    console.error(
      `[smoke:acp] expect tool "${expectTool}": OK — ${done.map((c) => `${c.name}(resultChars=${c.resultChars ?? "?"})`).join(", ")}`
    );
  }
  if (evalResult.failed) return { code, failed: true, reason: evalResult.reason };
  if (evalResult.trace) logDebug(debug, "flow trace OK:", JSON.stringify(evalResult.trace));
  // rcoder 常在 trace 正常时仍 exit 1（Session cancelled 等）；以 trace 为准
  return { code: evalResult.trace ? 0 : code, failed: false, reason: "" };
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
      `WARN: activeFlow=default — smoke 跑的是默认 ReAct 图，不是 custom flow。开发场景 flow（如 router-gate）请先把 activeFlow 写入 config，或设 SMOKE_EXPECT_ACTIVE_FLOW=<name>`
    );
  }
  logDebug(debug, "activeFlow:", active);
}

function usage() {
  console.log(`Usage: node scripts/smoke-acp.mjs [options]

Options:
  --entry PATH     Agent entry TS file (default: src/index.ts; also AGENT_ENTRY env)
  --debug       Log resolved paths, env (masked), and command (also SMOKE_DEBUG=1)
  --dry-run     Print plan and exit 0 without calling rcoder-cli (also SMOKE_DRY_RUN=1)
  -h, --help    Show help

Env (model — 与 runtime config-loader 对齐):
  ./.env               复制 .env.example；OPENAI_* 或 ANTHROPIC_* 凭证
  flow-agent.config.json  model.provider / model.name（env 未设或占位符时兜底）

  SMOKE_PROMPT         主路径 prompt（默认 React useState 题）
  SMOKE_PROMPT_EDGE    可选第二条 prompt（边界输入，如「你是？」，验 R-G002）
  SMOKE_EXPECT_ACTIVE_FLOW  与 config.activeFlow 不一致则失败
  SMOKE_EXPECT_TOOL    平台能力闸门：轨迹须现名称含该子串的工具调用且 done 非空，
                       否则 exit 1（自动启用脱敏工具摘要；prompt 须设计成能触发该工具）
  SMOKE_WARN_ACTIVE_FLOW=0  关闭 activeFlow=default 警告
  SMOKE_TIMEOUT        Timeout seconds (default: 150)
  SMOKE_VERBOSE=1      Pass -v to rcoder-cli
  SMOKE_RCODER_LAUNCHER  npx (default) | pnpm — rcoder-cli 启动方式
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
  // override:true —— .env 优先于继承的环境变量。smoke 可能在带 NuWaClaw 注入 env
  // (API_PROTOCOL + OPENAI_*/ANTHROPIC_*) 的进程里跑；此时项目 .env 应覆盖注入值，
  // .env 未设的变量再回落到注入的 NuWaClaw env（「.env 第一，注入 env 兜底」）。
  const dotenvResult = loadDotenv({ path: dotenvPath, override: true });

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
  const expectTool = process.env.SMOKE_EXPECT_TOOL?.trim() || undefined;
  if (configureExpectedToolTrace(smokeEnv, expectTool)) {
    console.error(
      `[smoke:acp] SMOKE_EXPECT_TOOL="${expectTool}" — 已启用脱敏工具摘要（不修改 LOG_LEVEL）`
    );
  }

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

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const label = prompts.length > 1 ? ` [${i + 1}/${prompts.length}]` : "";
    if (prompts.length > 1) {
      console.error(`[smoke:acp]${label} prompt: ${JSON.stringify(prompt)}`);
    }

    const rcoderCmd = resolveRcoderCmd(
      buildRcoderChatArgs({
        entry: flags.entry,
        prompt,
        timeoutS,
        verbose,
        smokeEnv,
      }),
    );

    if (flags.dryRun) {
      console.log(`# dry-run${label} — rcoder command:`);
      console.log(formatCommand(rcoderCmd.cmd, rcoderCmd.args));
      continue;
    }

    // SMOKE_EXPECT_TOOL 只对主 prompt（第一条）断言；SMOKE_PROMPT_EDGE 边界输入（如「你是？」）不要求触发工具
    const res = runRcoder(rcoderCmd, { debug: flags.debug, expectTool: i === 0 ? expectTool : undefined });
    if (res.code !== 0 || res.failed) {
      const reason = res.failed ? ` — ${res.reason}` : "";
      console.error(`[smoke:acp] failed${label} (exit ${res.code})${reason}`);
      process.exit(res.code !== 0 ? res.code : 1);
    }
  }
}

main();
