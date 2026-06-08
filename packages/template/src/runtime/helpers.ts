/**
 * Shared Runtime Helpers — Barrel
 *
 * Historically a single module; the implementation now lives in focused
 * modules (model, prompt, discovery, permissions, runtime-context,
 * agent-config). This barrel preserves the original import surface so existing
 * callers and the runtime barrel (`index.ts`) keep working unchanged.
 */

export {
  createRuntimeContext,
  createRuntimeContextAsync,
  hydrateRuntimeContext,
  type RuntimeContext,
} from "./runtime-context.js";
export { resolveModelString, resolveModel, resolveSummarizerModel } from "./model.js";
export { resolveSystemPrompt, resolveCliSystemPrompt, resolveOutputStyle } from "./prompt.js";
export {
  discoverMemoryFiles,
  resolveSkillsPaths,
  discoverSubAgents,
  type DiscoveredSubAgent,
} from "./discovery.js";
export {
  resolveSandboxPolicy,
  buildPermissions,
  buildInterruptOn,
  type SandboxPolicy,
} from "./permissions.js";
export { buildAgentConfigParts } from "./agent-config.js";
