/**
 * Subagent Registry
 *
 * Define and register subagents that can be delegated to
 * via the deepagents `task` tool.
 *
 * @scaffold — Not yet wired. This module provides extension points for
 * future custom subagent definitions. Currently has zero consumers.
 * deepagents already provides built-in subagents (research, planner).
 * Remove or implement custom subagents as needed.
 */

export interface SubAgentDefinition {
  name: string;
  description: string;
  systemPrompt: string;
  tools?: string[];
}

const subagentRegistry = new Map<string, SubAgentDefinition>();

export function registerSubAgent(subagent: SubAgentDefinition): void {
  subagentRegistry.set(subagent.name, subagent);
}

export function getSubAgent(name: string): SubAgentDefinition | undefined {
  return subagentRegistry.get(name);
}

export function listSubAgents(): SubAgentDefinition[] {
  return Array.from(subagentRegistry.values());
}

// Register built-in subagents here
// Example:
// registerSubAgent({
//   name: "researcher",
//   description: "Deep research on a topic using web search",
//   systemPrompt: "You are a research assistant...",
// });
