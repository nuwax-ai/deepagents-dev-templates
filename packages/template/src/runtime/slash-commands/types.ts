/**
 * Slash Command Types & Constants
 *
 * Shared types and ACP command constants used by definitions,
 * rendering, and execution modules.
 */

export type SlashEnvironment = "cli" | "acp";

export interface SlashToolInfo {
  name: string;
  description?: string;
}

export interface SlashCommandConfig {
  agent: {
    name: string;
    description?: string;
  };
  model: {
    provider?: string;
    name: string;
  };
  platform: {
    agentId?: string;
  };
  skills: {
    directories: string[];
  };
}

export interface SlashCommandContext {
  environment: SlashEnvironment;
  tools: SlashToolInfo[];
  config: SlashCommandConfig;
  workspaceRoot: string;
  mode?: string;
  sessionId?: string;
  saveHistory?: (path: string) => void;
  clearScreen?: () => void;
}

export interface SlashCommandResult {
  kind: "handled" | "exit";
  text?: string;
}

export interface ParsedSlashCommand {
  name: string;
  arg: string;
}

export interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  environments: SlashEnvironment[];
  inputHint?: string;
  execute: (ctx: SlashCommandContext, parsed: ParsedSlashCommand) => SlashCommandResult;
}

export const ACP_BUILTIN_COMMANDS = [
  { name: "agent", description: "切换到 Agent 模式" },
  { name: "ask", description: "切换到问答模式" },
  { name: "clear", description: "清空当前 ACP 会话上下文" },
];

export const ACP_DEFAULT_COMMAND_NAMES = new Set([
  "plan",
  ...ACP_BUILTIN_COMMANDS.map((command) => command.name),
  "status",
]);
