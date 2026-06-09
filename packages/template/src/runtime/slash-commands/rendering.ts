/**
 * Slash Command Rendering Functions
 *
 * All render* functions that format slash command output.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getRuntimeStorage,
  loadSessionState,
  listSessions,
  readableMemoryPath,
  readTextIfExists,
} from "../storage/runtime-storage.js";
import { approvalsPath, listApprovals } from "../storage/approvals.js";
import { ACP_BUILTIN_COMMANDS } from "./types.js";
import type { SlashCommandContext, SlashEnvironment, SlashToolInfo } from "./types.js";
import { COMMANDS } from "./definitions.js";

export function renderHelp(environment: SlashEnvironment): string {
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

export function renderTools(tools: SlashToolInfo[]): string {
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

export function renderConfig(ctx: SlashCommandContext): string {
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

export function renderStatus(ctx: SlashCommandContext): string {
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

export function renderSessions(ctx: SlashCommandContext): string {
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

export function renderSession(ctx: SlashCommandContext, targetSessionId?: string): string {
  const sessionId = targetSessionId || ctx.sessionId;
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId });
  const loaded = loadSessionState(ctx.workspaceRoot, storage.sessionId, { maxMessages: 5 });
  const metadata = loaded.metadata
    ? JSON.stringify(loaded.metadata, null, 2)
    : null;
  const recentMessages = loaded.messages.length > 0
    ? loaded.messages.map((message) => `  - ${message.role}: ${truncate(String(message.content), 120)}`).join("\n")
    : "  (none)";
  return [
    targetSessionId ? "指定会话:" : "当前会话:",
    `  Session:     ${storage.sessionId}`,
    `  Exists:      ${loaded.exists}`,
    `  Status:      ${loaded.summary.status ?? "unknown"}`,
    `  Updated:     ${loaded.summary.updatedAt ?? "unknown"}`,
    `  Messages:    ${loaded.summary.messageCount ?? 0}`,
    `  Workspace:   ${storage.workspaceRoot}`,
    `  WorkspaceId: ${storage.workspaceSlug}`,
    `  Path:        ${storage.sessionDir}`,
    `  MessageLog:  ${storage.messagesPath}`,
    `  Plan:        ${storage.planPath}`,
    `  Checkpoints: ${storage.checkpointsDir}`,
    `\nRecent messages:\n${recentMessages}`,
    metadata ? `\nMetadata:\n${metadata}` : "",
  ].filter(Boolean).join("\n");
}

export function renderPlan(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  const content = readTextIfExists(storage.planPath);
  if (!content) {
    return `当前会话还没有 plan。\nPath: ${storage.planPath}`;
  }
  return `Plan (${storage.planPath}):\n\n${truncate(content, 8000)}`;
}

export function renderHistory(ctx: SlashCommandContext): string {
  const storage = getRuntimeStorage({ workspaceRoot: ctx.workspaceRoot, sessionId: ctx.sessionId });
  const content = readTextIfExists(storage.messagesPath);
  if (!content?.trim()) {
    return `当前会话还没有消息历史。\nPath: ${storage.messagesPath}`;
  }
  return `History (${storage.messagesPath}):\n\n${truncate(content.trim(), 8000)}`;
}

export function renderMemory(ctx: SlashCommandContext): string {
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

export function renderCheckpoints(ctx: SlashCommandContext): string {
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

export function renderApprovals(ctx: SlashCommandContext): string {
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
