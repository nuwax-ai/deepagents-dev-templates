#!/usr/bin/env node

import { spawn } from "node:child_process";
import { inspectAgent, writeOrchestrationSpec } from "../inspector.js";
import { defaultStaticDir } from "../inspector.js";
import { startInspectServer } from "../server.js";
import { loadTemplateRuntime } from "../template-runtime.js";

interface CliOptions {
  configPath?: string;
  workspaceRoot?: string;
  out?: string;
  format: "json" | "mermaid";
  port: number;
  open: boolean;
  full: boolean;
  xray: boolean | number;
  help: boolean;
}

const HELP = `deepagents-inspect

Usage:
  deepagents-inspect [flags]

Flags:
  --config <path>          config file (default: ./config/app-agent.config.json)
  --workspace <path>       workspace root (default: cwd)
  --out <path>             write spec to file and exit
  --format json|mermaid    output format with --out (default: json)
  --port <n>               local UI port (default: 7322)
  --no-open                print URL without opening a browser
  --full                   instantiate the real agent and include LangGraph topology
  --xray <bool|number>     graph xray depth for --full (default: 1)
  --help, -h               show help
`;

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(HELP);
    return;
  }
  if (options.format === "mermaid" && !options.full) {
    throw new Error("Mermaid output requires --full because dry-run mode does not compile a runtime graph.");
  }

  const spec = await inspectAgent({
    configPath: options.configPath,
    workspaceRoot: options.workspaceRoot,
    mode: options.full ? "full" : "dry-run",
    xray: options.xray,
  });

  if (options.out) {
    await writeOrchestrationSpec(spec, options.out, options.format);
    console.log(`Wrote ${options.format} inspection to ${options.out}`);
    return;
  }

  const runtime = await loadTemplateRuntime();
  const server = await startInspectServer({
    spec,
    port: options.port,
    staticDir: defaultStaticDir(),
    editing: {
      runtime,
      workspaceRoot: options.workspaceRoot ?? process.cwd(),
      configPath: options.configPath ?? "config/app-agent.config.json",
    },
  });
  console.log(`DeepAgents inspector running at ${server.url}`);
  if (options.open) {
    await openBrowser(server.url);
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: "json",
    port: 7322,
    open: true,
    full: false,
    xray: 1,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--config") {
      options.configPath = readValue(argv, ++i, arg);
    } else if (arg === "--workspace") {
      options.workspaceRoot = readValue(argv, ++i, arg);
    } else if (arg === "--out") {
      options.out = readValue(argv, ++i, arg);
    } else if (arg === "--format") {
      const value = readValue(argv, ++i, arg);
      if (value !== "json" && value !== "mermaid") {
        throw new Error(`Unsupported --format: ${value}`);
      }
      options.format = value;
    } else if (arg === "--port") {
      options.port = Number.parseInt(readValue(argv, ++i, arg), 10);
      if (!Number.isFinite(options.port)) {
        throw new Error("--port must be a number");
      }
    } else if (arg === "--no-open") {
      options.open = false;
    } else if (arg === "--full") {
      options.full = true;
    } else if (arg === "--xray") {
      options.xray = parseXray(readValue(argv, ++i, arg));
    } else {
      throw new Error(`Unknown flag: ${arg}`);
    }
  }

  return options;
}

function readValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parseXray(value: string): boolean | number {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) {
    throw new Error("--xray must be true, false, or a number");
  }
  return number;
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? "open" : "xdg-open";
  await new Promise<void>((resolve) => {
    const child = spawn(command, [url], { stdio: "ignore", detached: true });
    child.once("error", () => {
      console.log(`Could not open browser automatically. Open ${url}`);
      resolve();
    });
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
