/**
 * task 工具 —— 把子任务委派给一个声明式 subagent（.agents/agents/<name>/AGENT.md）。
 *
 * 框架原生实现：每个子智能体（subagent）复用默认 ReAct 图（createFlowGraph）单次 invoke——
 * 自带 systemPrompt（AGENT.md 正文）、工具子集、独立工作目录、可选独立模型。
 * LangGraph 无「声明式子智能体（subagent）」原生概念，故参考 deepagents 的 `task` 委派语义。
 *
 * 防递归：子智能体拿到的工具集**不含 `task` 本身**（由 createFlowTools 的 buildTools 保证）。
 * 工作目录：默认 = 父级 workspaceRoot（启动 agent 的当前目录）；AGENT.md `workdir` 指定相对子目录。
 * 临时态：用图默认 MemorySaver，不落父会话 checkpointer。
 */

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { StructuredTool } from "@langchain/core/tools";
import type { AppConfig, DiscoveredSubAgent } from "../runtime/index.js";
import { createFlowGraph } from "./graph.js";
import type { FlowState } from "./state.js";
import { extractText } from "../libs/nodes/index.js";
import type { FlowCallbacks } from "../core/flow-types.js";

export interface TaskToolDeps {
  subAgents: DiscoveredSubAgent[];
  config: AppConfig;
  /** 父 agent 的工作目录（子智能体未指定 workdir 时继承）。 */
  parentWorkspaceRoot: string;
  /** 按工作目录重建子智能体工具集（不含 task，防递归）。 */
  buildTools: (workspaceRoot: string) => StructuredTool[];
}

export function parseSubagentModelOverride(
  spec: string | undefined,
  config: AppConfig
): { config: AppConfig } | { error: string } {
  if (!spec) return { config };

  // 兼容简单模型名；也支持 "provider/model" 或 "provider:model" 显式覆盖 provider。
  const match = spec.match(/^(anthropic|openai)[/:](.+)$/);
  if (!match) {
    if (/^[a-zA-Z]+[/:]/.test(spec)) {
      return {
        error: `不支持的 model provider，当前仅支持 anthropic/openai: ${spec}`,
      };
    }
    return { config: { ...config, model: { ...config.model, name: spec } } };
  }

  const provider = match[1] as AppConfig["model"]["provider"];
  const name = match[2]?.trim();
  if (!name) return { error: `model 覆盖缺少模型名: ${spec}` };

  const inherited =
    provider === config.model.provider
      ? config.model
      : {
          ...config.model,
          provider,
          apiKeyEnv: provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY",
          authTokenEnv:
            provider === "anthropic" ? config.model.authTokenEnv : "ANTHROPIC_AUTH_TOKEN",
          baseUrl: undefined,
        };

  return { config: { ...config, model: { ...inherited, provider, name } } };
}

export function createTaskTool(deps: TaskToolDeps) {
  const { subAgents, config, parentWorkspaceRoot, buildTools } = deps;
  const byName = new Map(subAgents.map((a) => [a.name, a]));
  const names = subAgents.map((a) => a.name).join(", ") || "(none)";

  return tool(
    async ({ subagent_type, description }, runConfig) => {
      const agent = byName.get(subagent_type);
      if (!agent) return `Error: 未找到 subagent "${subagent_type}"。可用: ${names}`;

      // 工作目录：默认继承父级；AGENT.md workdir 覆盖为相对子目录。
      const subRoot = agent.workdir
        ? resolve(parentWorkspaceRoot, agent.workdir)
        : parentWorkspaceRoot;

      // 工具：按子智能体工作目录重建（沙箱受限于 subRoot）；AGENT.md tools 进一步收窄为 allowlist。
      let tools = buildTools(subRoot);
      if (agent.tools?.length) {
        const allow = new Set(agent.tools);
        const available = new Set(tools.map((t) => t.name));
        const unknown = agent.tools.filter((name) => !available.has(name));
        if (unknown.length) {
          return `Error: subagent "${subagent_type}" 配置了未知工具: ${unknown.join(", ")}。`;
        }
        tools = tools.filter((t) => allow.has(t.name));
        if (!tools.length) {
          return `Error: subagent "${subagent_type}" 的 tools allowlist 为空，无法执行任务。`;
        }
      }

      // 模型：缺省继承父 agent；AGENT.md model 可写模型名或 provider/model。
      const modelOverride = parseSubagentModelOverride(agent.model, config);
      if ("error" in modelOverride) return `Error: ${modelOverride.error}`;
      const subConfig = modelOverride.config;

      try {
        // 流式委派：subagent 的工具调用经 callbacks.onToolCall（带 [subagent] 前缀）实时透出；
        // LLM token 经 graph.stream messages 模式逐个 onToken；最终 output 取终态（替代原 invoke）。
        const parentCallbacks = ((runConfig as { configurable?: Record<string, unknown> } | undefined)
          ?.configurable ?? {}) as Partial<FlowCallbacks>;
        const wrapToolCall: FlowCallbacks["onToolCall"] = async (e) => {
          await parentCallbacks.onToolCall?.({
            ...e,
            toolName: `[${subagent_type}] ${e.toolName}`,
          });
        };
        const graph = createFlowGraph({
          allTools: tools,
          config: subConfig,
          systemPrompt: agent.systemPrompt,
          callbacks: { onToolCall: wrapToolCall },
        });
        const threadId = `subagent-${subagent_type}-${randomUUID()}`;
        const stream = await graph.stream(
          { input: description, messages: [] } as unknown as FlowState,
          {
            configurable: { thread_id: threadId },
            recursionLimit: 50,
            streamMode: ["messages"],
          }
        );
        for await (const raw of stream) {
          // 多模式 chunk = [mode, payload]；messages 模式 payload = [messageChunk, metadata]
          if (!Array.isArray(raw) || raw[0] !== "messages") continue;
          const pair = raw[1] as [{ content?: unknown }, unknown] | undefined;
          if (!Array.isArray(pair)) continue;
          const [msg] = pair;
          // 全放开：subagent 所有节点的 token 透出（messages token 是模型输出，不含模型配置）。
          const text = extractText(msg?.content);
          if (text) await parentCallbacks.onToken?.(text);
        }
        const finalState = (await graph.getState({ configurable: { thread_id: threadId } }))
          .values as FlowState;
        return finalState.output || "(subagent 无输出)";
      } catch (err) {
        return `Error: subagent "${subagent_type}" 执行失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
    {
      name: "task",
      description: `把子任务委派给一个声明式子智能体（subagent，各自独立 prompt/工具/工作目录），返回其最终结果。可用 subagent_type: ${names}。`,
      schema: z.object({
        subagent_type: z.string().describe("子智能体名 subagent_type（见系统提示词 Subagents 列表）"),
        description: z.string().describe("交给子智能体（subagent）执行的完整任务说明（自包含，子智能体看不到主对话历史）"),
      }),
    }
  );
}
