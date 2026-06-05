import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getRuntimeStorage,
  listSessions,
  migrateLegacyState,
  readableMemoryPath,
  readTextIfExists,
} from "./runtime-storage.js";
import { approvalsPath, listApprovals } from "./approvals.js";

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

interface ParsedSlashCommand {
  name: string;
  arg: string;
}

interface SlashCommandDefinition {
  name: string;
  aliases?: string[];
  description: string;
  environments: SlashEnvironment[];
  inputHint?: string;
  execute: (ctx: SlashCommandContext, parsed: ParsedSlashCommand) => SlashCommandResult;
}

const ACP_BUILTIN_COMMANDS = [
  { name: "agent", description: "切换到 Agent 模式" },
  { name: "ask", description: "切换到问答模式" },
  { name: "clear", description: "清空当前 ACP 会话上下文" },
];

const DEEPAGENTS_ACP_DEFAULT_COMMANDS = [
  { name: "plan", description: "切换到计划模式" },
  ...ACP_BUILTIN_COMMANDS,
  { name: "status", description: "显示当前会话状态" },
];

const ACP_DEFAULT_COMMAND_NAMES = new Set([
  ...ACP_BUILTIN_COMMANDS.map((command) => command.name),
  "status",
]);

const COMMANDS: SlashCommandDefinition[] = [
  {
    name: "help",
    aliases: ["?"],
    description: "显示可用 slash commands",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderHelp(ctx.environment),
    }),
  },
  {
    name: "tools",
    description: "列出当前 Agent 可用工具",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderTools(ctx.tools),
    }),
  },
  {
    name: "config",
    description: "显示当前配置摘要",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderConfig(ctx),
    }),
  },
  {
    name: "status",
    description: "显示当前会话状态",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderStatus(ctx),
    }),
  },
  {
    name: "sessions",
    description: "列出当前工作区历史会话",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderSessions(ctx),
    }),
  },
  {
    name: "session",
    description: "显示当前会话存储信息",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderSession(ctx),
    }),
  },
  {
    name: "plan",
    description: "查看当前会话 plan.md",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderPlan(ctx),
    }),
  },
  {
    name: "history",
    description: "查看当前会话消息历史",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderHistory(ctx),
    }),
  },
  {
    name: "memory",
    description: "查看当前 agent memory 路径和摘要",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderMemory(ctx),
    }),
  },
  {
    name: "checkpoints",
    description: "列出当前会话 checkpoints",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderCheckpoints(ctx),
    }),
  },
  {
    name: "migrate-state",
    description: "迁移旧 .agent-memory 和 .agent-checkpoints 到 ~/.deepagents",
    environments: ["cli", "acp"],
    execute: (ctx) => {
      const result = migrateLegacyState(ctx.workspaceRoot, ctx.sessionId);
      return {
        kind: "handled",
        text: [
          "Legacy state 迁移完成:",
          `  Memory files: ${result.memoryFiles}`,
          `  Checkpoints:   ${result.checkpoints}`,
          `  Target:        ${result.target}`,
          "旧目录不会自动删除。",
        ].join("\n"),
      };
    },
  },
  {
    name: "approvals",
    description: "查看当前 workspace 的用户级审批记录",
    environments: ["cli", "acp"],
    execute: (ctx) => ({
      kind: "handled",
      text: renderApprovals(ctx),
    }),
  },
  {
    name: "clear",
    description: "清屏",
    environments: ["cli"],
    execute: (ctx) => {
      ctx.clearScreen?.();
      return { kind: "handled" };
    },
  },
  {
    name: "save",
    description: "保存 CLI 对话历史到 JSON 文件",
    environments: ["cli"],
    inputHint: "<path>",
    execute: (ctx, parsed) => {
      if (!parsed.arg) {
        return {
          kind: "handled",
          text: "Error: /save requires a file path",
        };
      }
      ctx.saveHistory?.(parsed.arg);
      return { kind: "handled" };
    },
  },
  {
    name: "exit",
    aliases: ["quit"],
    description: "退出 CLI REPL",
    environments: ["cli"],
    execute: () => ({ kind: "exit" }),
  },
];

export function executeSlashCommand(
  input: string,
  ctx: SlashCommandContext
): SlashCommandResult | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return null;
  }

  const command = COMMANDS.find((candidate) =>
    commandMatches(candidate, parsed.name) &&
    candidate.environments.includes(ctx.environment)
  );

  if (!command) {
    if (ctx.environment === "acp") {
      return null;
    }
    return {
      kind: "handled",
      text: `Unknown command: /${parsed.name}\n\n${renderHelp(ctx.environment)}`,
    };
  }

  return command.execute(ctx, parsed);
}

export function getAcpSlashCommandSpecs(): Array<{
  name: string;
  description: string;
  input?: { hint: string };
}> {
  return COMMANDS
    .filter((command) => command.environments.includes("acp"))
    .filter((command) => !ACP_DEFAULT_COMMAND_NAMES.has(command.name))
    .map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint ? { input: { hint: command.inputHint } } : {}),
    }));
}

export function getAcpAvailableCommandSpecs(): Array<{
  name: string;
  description: string;
  input?: { hint: string };
}> {
  const commands = new Map<string, {
    name: string;
    description: string;
    input?: { hint: string };
  }>();
  for (const command of DEEPAGENTS_ACP_DEFAULT_COMMANDS) {
    commands.set(command.name, command);
  }
  for (const command of getAcpSlashCommandSpecs()) {
    commands.set(command.name, command);
  }
  return Array.from(commands.values());
}

function parseSlashCommand(input: string): ParsedSlashCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const body = trimmed.slice(1);
  const [rawName = "", ...args] = body.split(/\s+/);
  const name = rawName.toLowerCase();
  if (!name) {
    return null;
  }

  return {
    name,
    arg: args.join(" "),
  };
}

function commandMatches(command: SlashCommandDefinition, name: string): boolean {
  return command.name === name || command.aliases?.includes(name) === true;
}

function renderHelp(environment: SlashEnvironment): string {
  const commands = COMMANDS
    .filter((command) => command.environments.includes(environment))
    .map((command) => {
      const aliases = command.aliases?.map((alias) => `/${alias}`).join(", ");
      const names = aliases ? `/${command.name}, ${aliases}` : `/${command.name}`;
      const input = command.inputHint ? ` ${command.inputHint}` : "";
      return `  ${names}${input} - ${command.description}`;
    });

  if (environment === "acp") {
    commands.push(
      ...ACP_BUILTIN_COMMANDS.map((command) =>
        `  /${command.name} - ${command.description}`
      )
    );
  }

  return ["可用命令:", ...commands].join("\n");
}

function renderTools(tools: SlashToolInfo[]): string {
  if (tools.length === 0) {
    return "当前没有可用工具。";
  }

  return [
    "可用工具:",
    ...tools.map((tool) => {
      const desc = tool.description?.split("\n")[0]?.slice(0, 100) || "(no description)";
      return `  ${tool.name} - ${desc}`;
    }),
  ].join("\n");
}

function renderConfig(ctx: SlashCommandContext): string {
  const modelProvider = ctx.config.model.provider
    ? `${ctx.config.model.provider}:`
    : "";
  return [
    "当前配置:",
    `  Agent:     ${ctx.config.agent.name}`,
    `  Model:     ${modelProvider}${ctx.config.model.name}`,
    `  Platform:  ${ctx.config.platform.agentId || "(local-only mode)"}`,
    `  Skills:    ${ctx.config.skills.directories.join(", ")}`,
    `  Workspace: ${ctx.workspaceRoot}`,
    `  Storage:   ${getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId }).workspaceDir}`,
  ].join("\n");
}

function renderStatus(ctx: SlashCommandContext): string {
  const lines = [
    "当前状态:",
    `  Agent:   ${ctx.config.agent.name}`,
    `  Mode:    ${ctx.mode ?? "agent"}`,
    `  Tools:   ${ctx.tools.length}`,
    `  Skills:  ${ctx.config.skills.directories.length}`,
  ];

  if (ctx.sessionId) {
    lines.push(`  Session: ${ctx.sessionId}`);
  }

  return lines.join("\n");
}

function renderSessions(ctx: SlashCommandContext): string {
  const sessions = listSessions(ctx.workspaceRoot).slice(0, 20);
  if (sessions.length === 0) {
    return "当前工作区还没有持久化会话。";
  }
  return [
    "历史会话:",
    ...sessions.map((session) =>
      `  ${session.sessionId}  updated=${session.updatedAt ?? "unknown"}  messages=${session.messageCount ?? 0}`
    ),
  ].join("\n");
}

function renderSession(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  const metadata = readTextIfExists(storage.metadataPath);
  return [
    "当前会话:",
    `  Session:     ${storage.sessionId}`,
    `  Workspace:   ${storage.workspaceRoot}`,
    `  WorkspaceId: ${storage.workspaceSlug}`,
    `  Path:        ${storage.sessionDir}`,
    `  Messages:    ${storage.messagesPath}`,
    `  Plan:        ${storage.planPath}`,
    `  Checkpoints: ${storage.checkpointsDir}`,
    metadata ? `\nMetadata:\n${metadata}` : "",
  ].filter(Boolean).join("\n");
}

function renderPlan(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  const content = readTextIfExists(storage.planPath);
  if (!content) {
    return `当前会话还没有 plan。\nPath: ${storage.planPath}`;
  }
  return `Plan (${storage.planPath}):\n\n${truncate(content, 8000)}`;
}

function renderHistory(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  const content = readTextIfExists(storage.messagesPath);
  if (!content?.trim()) {
    return `当前会话还没有消息历史。\nPath: ${storage.messagesPath}`;
  }
  return `History (${storage.messagesPath}):\n\n${truncate(content.trim(), 8000)}`;
}

function renderMemory(ctx: SlashCommandContext): string {
  const agentName = ctx.config.agent.name || "default";
  const path = readableMemoryPath(agentName, ctx.workspaceRoot);
  if (!existsSync(path)) {
    const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
    return [
      "当前 agent 还没有 memory。",
      `  Agent: ${agentName}`,
      `  Path:  ${join(storage.memoryDir, agentName, "MEMORY.md")}`,
    ].join("\n");
  }

  const content = readFileSync(path, "utf-8");
  const headings = content.match(/^## .+$/gm)?.map((heading) => heading.replace("## ", "- ")) ?? [];
  return [
    "Memory:",
    `  Agent: ${agentName}`,
    `  Path:  ${path}`,
    `  Size:  ${content.length} chars`,
    headings.length > 0 ? `\nSections:\n${headings.join("\n")}` : "\nSections: (none)",
  ].join("\n");
}

function renderCheckpoints(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  if (!existsSync(storage.checkpointsDir)) {
    return `当前会话还没有 checkpoints。\nPath: ${storage.checkpointsDir}`;
  }
  const files = readdirSync(storage.checkpointsDir)
    .filter((file) => file.startsWith("cp-") && file.endsWith(".md"))
    .sort()
    .reverse();
  if (files.length === 0) {
    return `当前会话还没有 checkpoints。\nPath: ${storage.checkpointsDir}`;
  }
  return [
    `Checkpoints (${storage.checkpointsDir}):`,
    ...files.map((file) => `  ${file.replace(".md", "")}`),
  ].join("\n");
}

function renderApprovals(ctx: SlashCommandContext): string {
  const approvals = listApprovals(ctx.workspaceRoot);
  if (approvals.length === 0) {
    return [
      "当前 workspace 没有持久化审批记录。",
      `Path: ${approvalsPath()}`,
      "注意：Zed/ACP 的 always allow/reject 当前仍由 deepagents-acp 在 session 内部缓存；此 store 是后续持久化回调的落点。",
    ].join("\n");
  }
  return [
    `Approvals (${approvalsPath()}):`,
    ...approvals.map((approval) =>
      `  ${approval.decision} ${approval.toolName} path=${approval.pathPattern ?? "*"} command=${approval.commandHash ? approval.commandHash.slice(0, 12) : "-"} updated=${approval.updatedAt}`
    ),
  ].join("\n");
}

function truncate(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return `${content.slice(0, maxLength)}\n\n... [truncated, total length: ${content.length} chars]`;
}
