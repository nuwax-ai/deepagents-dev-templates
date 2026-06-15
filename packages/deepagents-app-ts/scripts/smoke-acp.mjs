#!/usr/bin/env node
/**
 * Smoke-test the bundled ACP agent via rcoder-cli (inline one-shot chat).
 * Cross-platform (PowerShell / macOS / Linux).
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
];

function parseFlags(argv) {
  return {
    debug: argv.includes("--debug") || process.env.SMOKE_DEBUG === "1",
    dryRun: argv.includes("--dry-run") || process.env.SMOKE_DRY_RUN === "1",
    help: argv.includes("-h") || argv.includes("--help"),
  };
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

function hasCredential() {
  return ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
    (v) => process.env[v],
  );
}

function buildRcoderArgs({ prompt, timeoutS, verbose }) {
  const rcoderArgs = [
    "dlx",
    "rcoder-cli",
    "chat",
    "-c",
    "node",
    "--arg",
    "dist/bundle.mjs",
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
  --debug       Log resolved paths, env (masked), and command (also SMOKE_DEBUG=1)
  --dry-run     Print plan and exit 0 without calling rcoder-cli (also SMOKE_DRY_RUN=1)
  -h, --help    Show help

Env:
  SMOKE_PROMPT     Prompt text (default: hello)
  SMOKE_TIMEOUT    Timeout seconds (default: 30)
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
  pnpm run smoke:acp -- --debug --dry-run

See docs/guides/rcoder-cloud-debug.md`);
      process.exit(1);
    }
  }

  const prompt = process.env.SMOKE_PROMPT ?? "hello";
  const timeoutS = process.env.SMOKE_TIMEOUT ?? "30";
  const verbose = process.env.SMOKE_VERBOSE === "1";
  const bundlePath = path.join(PKG_DIR, "dist/bundle.mjs");

  if (flags.debug) {
    console.error("[smoke:acp] forwarded env (masked):");
    for (const name of FORWARD_VARS) {
      console.error(`  ${name}=${maskSecret(process.env[name])}`);
    }
    console.error("[smoke:acp] bundle:", bundlePath, existsSync(bundlePath) ? "(ok)" : "(missing)");
    console.error("[smoke:acp] prompt:", JSON.stringify(prompt));
    console.error("[smoke:acp] timeout:", timeoutS);
  }

  if (!existsSync(bundlePath)) {
    console.error("dist/bundle.mjs not found — building via pnpm run bundle…");
    if (flags.dryRun) {
      console.error("[smoke:acp] dry-run: would run pnpm run bundle");
    } else {
      const buildStatus = runPnpm(["run", "bundle"], { debug: flags.debug });
      if (buildStatus !== 0) process.exit(buildStatus);
    }
  }

  const rcoderArgs = buildRcoderArgs({ prompt, timeoutS, verbose });
  const pnpm = resolvePnpm();

  if (flags.dryRun) {
    console.log("# dry-run — rcoder command:");
    console.log(formatCommand(pnpm, rcoderArgs));
    return;
  }

  process.exit(runPnpm(rcoderArgs, { debug: flags.debug }));
}

main();
