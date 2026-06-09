/**
 * ACP Server — Bootstrap
 *
 * Entry point for the ACP runnable surface: loads config, builds the
 * DeepAgentConfig, starts `deepagents-acp`'s `DeepAgentsServer` over stdio, and
 * applies the session-lifecycle patch.
 *
 * The config assembly lives in `config-builder.ts` and the server patching in
 * `session-lifecycle.ts`; both config builders are re-exported here so the
 * original `./server.js` import surface (used by the runtime barrel and tests)
 * is unchanged.
 */

import { DeepAgentsServer } from "deepagents-acp";
import { loadConfig, resolveConfiguredWorkspaceRoot, type ACPSessionConfig } from "../../runtime/config/config-loader.js";
import { logger } from "../../runtime/logger.js";
import { buildACPAgentConfigWithMcpAsync, loadSessionConfigFromEnv } from "./config-builder.js";
import { patchSessionLifecycle } from "./session-lifecycle.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export {
  buildACPAgentConfig,
  buildACPAgentConfigAsync,
  buildACPAgentConfigWithMcpAsync,
  loadSessionConfigFromEnv,
} from "./config-builder.js";

/**
 * Read this package's version from package.json as a fallback for the
 * `serverVersion` advertised by `DeepAgentsServer`. Cached at module
 * load. Used when `config.agent.version` is left unset in
 * `app-agent.config.json` — the package version is the most common
 * default in templates.
 */
let cachedPackageVersion: string | undefined;
function readPackageVersionSafe(): string | undefined {
  if (cachedPackageVersion !== undefined) return cachedPackageVersion;
  try {
    // Resolve relative to this file so the lookup works regardless of cwd.
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "package.json");
    const parsed = JSON.parse(readFileSync(pkgPath, "utf-8")) as { version?: string };
    cachedPackageVersion = typeof parsed?.version === "string" ? parsed.version : undefined;
  } catch {
    cachedPackageVersion = undefined;
  }
  return cachedPackageVersion;
}

// ─── Types ──────────────────────────────────────────────

export interface ACPServerOptions {
  /** Enable debug logging */
  debug?: boolean;
  /** Path to config file */
  configPath?: string;
  /** Run in ACP mode (default: true) */
  acp?: boolean;
  /** Workspace root override */
  workspaceRoot?: string;
  /** ACP/platform session config supplied by nuwaclaw at launch time */
  sessionConfig?: ACPSessionConfig;
}

// ─── Bootstrap ──────────────────────────────────────────

/**
 * Bootstrap the agent runtime and start the ACP server.
 * Main entry point called from src/index.ts.
 */
export async function bootstrap(options: ACPServerOptions = {}): Promise<void> {
  const log = logger.child("bootstrap");

  if (options.debug) {
    process.env.LOG_LEVEL = "debug";
  }

  const sessionConfig = options.sessionConfig ?? loadSessionConfigFromEnv();
  const initialWorkspaceRoot = options.workspaceRoot || sessionConfig?.cwd || process.cwd();

  log.info("Bootstrapping DeepAgents app agent", {
    acp: options.acp,
    debug: options.debug,
    workspaceRoot: initialWorkspaceRoot,
  });

  // Diagnostic: log effective model env vars (mask API key)
  log.info("Effective env vars", {
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "(unset)",
    ANTHROPIC_BASE_URL: process.env.ANTHROPIC_BASE_URL ?? "(unset)",
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? "***" : "(unset)",
    ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN ? "***" : "(unset)",
  });

  // Validate that at least one model credential is available
  if (
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.ANTHROPIC_AUTH_TOKEN &&
    !process.env.OPENAI_API_KEY &&
    !sessionConfig?.model
  ) {
    log.warn("No model credentials found. Set at least one of: ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, OPENAI_API_KEY");
  }

  // Load configuration
  const config = loadConfig({
    configPath: options.configPath,
    sessionConfig,
    workspaceRoot: initialWorkspaceRoot,
  });
  const workspaceRoot = resolveConfiguredWorkspaceRoot(config, initialWorkspaceRoot);

  if (options.acp === false) {
    log.info("ACP mode disabled — skipping server start");
    return;
  }

  // Build DeepAgentConfig using shared helpers
  const { agentConfig, mcpManager } = await buildACPAgentConfigWithMcpAsync(config, workspaceRoot, sessionConfig);

  // Start the ACP server
  // serverVersion: prefer the config's agent.version (so consumers can
  // pin a release tag), but fall back to this package's version when
  // the config leaves it unset. This keeps the version Zed displays
  // in sync with `npm view deepagents-app-ts version`.
  const pkgVersion = readPackageVersionSafe();
  const server = new DeepAgentsServer({
    agents: agentConfig,
    serverName: config.agent.name,
    serverVersion: config.agent.version || pkgVersion || "0.0.0",
    workspaceRoot,
    debug: process.env.LOG_LEVEL === "debug",
  });

  log.info("Starting DeepAgentsServer", {
    name: agentConfig.name,
    model: agentConfig.model,
    skills: agentConfig.skills,
    tools: agentConfig.tools?.length,
  });

  // Pass mcpManager so ACP session mcpServers can be forwarded
  const _sessionManager = patchSessionLifecycle(server, mcpManager, config, workspaceRoot, {
    configPath: options.configPath,
    sessionConfig,
    useSessionCwd: !options.workspaceRoot && !config.workspace.workingDir,
  });
  log.info("Active sessions after startup", { count: _sessionManager.count });
  await server.start();
}
