/**
 * Runtime Layer — Barrel Export (vendored from deepagents-app-ts)
 *
 * 精简：去掉 flow-ts 不用的 agent-factory / code-graph，以及换成
 * @langchain/mcp-adapters 后不再需要的 MCPManager barrel（MCP 由 runtime-context
 * 内部用 MultiServerMCPClient 自管，不从此处导出）。
 */

export {
  loadConfig,
  resolveConfiguredWorkspaceRoot,
  AppConfigSchema,
  type AppConfig,
  type ModelConfig,
  type PlatformConfig,
  type PermissionsConfig,
  type ACPSessionConfig,
} from "./config/config-loader.js";
export {
  PlatformClient,
  type PlatformClientOptions,
  type PluginInfo,
  type AgentVariable,
  type ComponentBinding,
  type DebugSession,
} from "./platform/platform-client.js";
export {
  VariableManager,
  type VariableDefinition,
  type VariableStore,
} from "./platform/variable-manager.js";
export {
  createRuntimeContext,
  createRuntimeContextAsync,
  hydrateRuntimeContext,
  resolveModelString,
  resolveModel,
  resolveCliSystemPrompt,
  resolveSystemPrompt,
  discoverMemoryFiles,
  resolveSkillsPaths,
  discoverSubAgents,
  buildPermissions,
  buildInterruptOn,
  type DiscoveredSubAgent,
  type RuntimeContext,
} from "./helpers.js";
export { Logger, logger, type LogLevel } from "./logger.js";
export { getPackageVersion } from "./version.js";
