/**
 * Runtime 底层运行时 —— Barrel Export。
 *
 * 模板自有、自包含的底层运行时门面:config 加载、模型解析、日志、平台 API、runtime-context。
 * MCP 经 @langchain/mcp-adapters 的 MultiServerMCPClient 由 runtime-context 内部自管，不从此处导出。
 * app / surfaces / compose 统一从这里取底层能力。
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
  destroyRuntimeContext,
  resolveModelString,
  resolveModel,
  resolveCliSystemPrompt,
  resolveSystemPrompt,
  discoverMemoryFiles,
  resolveSkillsPaths,
  discoverSubAgents,
  discoverSkills,
  renderSkillsSection,
  renderSubagentsSection,
  type DiscoveredSubAgent,
  type DiscoveredSkill,
  type RuntimeContext,
} from "./context/helpers.js";
export { Logger, logger, setLogAgent, setLogSession, type LogLevel } from "./logger.js";
export { getPackageVersion } from "./version.js";
