/**
 * ACP Surface — Barrel
 *
 * The ACP runnable surface: bootstraps the deepagents-acp DeepAgentsServer
 * over stdio and assembles the per-session DeepAgentConfig. Composes the
 * runtime engine (`../../runtime`); the engine does not depend on this surface.
 */

export {
  bootstrap,
  buildACPAgentConfig,
  buildACPAgentConfigAsync,
  buildACPAgentConfigWithMcpAsync,
  loadSessionConfigFromEnv,
  type ACPServerOptions,
} from "./server.js";
