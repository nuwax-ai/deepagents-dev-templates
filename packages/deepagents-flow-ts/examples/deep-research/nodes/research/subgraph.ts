/**
 * research 子图 —— 单章节调研的 mini ReAct（框架优先）。
 *
 *   START → prepare(注入 messages) → think(bindTools) ── toolsCondition ──┐
 *                                      ▲                                ├─ tool_calls → tools(ToolNode) → think
 *                                      └────────────────────────────────┘
 *                                               └─ 无 tool_calls → summarize → END
 *
 * 编译后作为父图 `research` 节点；父图 Send 扇出时每个 section 跑一份子图实例。
 * 子图与父图共享 currentSection / refinedTopic / outline / languageHint / findings channel。
 */

import {
  StateGraph,
  START,
  END,
  Annotation,
  messagesStateReducer,
  type LangGraphRunnableConfig,
} from "@langchain/langgraph";
import { ToolNode, toolsCondition } from "@langchain/langgraph/prebuilt";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import type { StructuredTool } from "@langchain/core/tools";
import { logger, type AppConfig } from "../../../../src/runtime/index.js";
import type { FlowCallbacks } from "../../../../src/surfaces/flow-types.js";
import {
  emitPlan,
  emitStage,
  extractText,
  invokeWithResilience,
  requireModel,
  resolveLlmResilience,
} from "../../../shared.js";
import type { OutlineSection, ResearchFinding } from "../types.js";
import { invokeLLM, langClause } from "../helpers.js";
import { outlineToPlanEntries } from "../planning.js";
import { createDuckDuckGoSearchTool } from "./tools.js";

const log = logger.child("deep-research");

/** 子图 state：与父图重叠字段 + ReAct messages 通道。 */
const ResearchSectionState = Annotation.Root({
  currentSection: Annotation<OutlineSection>,
  refinedTopic: Annotation<string>,
  languageHint: Annotation<string>,
  outline: Annotation<OutlineSection[]>,
  /** ReAct 消息流（子图内部；summarize 后不再写回父图）。 */
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  /** 从 ToolMessage 累积的原始检索文本，供 summarize 降级使用。 */
  rawMaterial: Annotation<string>({
    reducer: (a, b) => (b ? `${a}\n${b}`.trim() : a),
    default: () => "",
  }),
  findings: Annotation<ResearchFinding[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
});

type SectionState = typeof ResearchSectionState.State;

type BoundModel = { invoke: (m: BaseMessage[]) => Promise<AIMessage> };

/** 从 messages 里抽出全部 ToolMessage 正文。 */
function extractToolMaterial(messages: BaseMessage[]): string {
  return messages
    .filter((m): m is ToolMessage => m._getType() === "tool")
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n")
    .trim();
}

/** prepare：透出阶段进度，并注入「必须用搜索工具」的初始 messages。 */
function createPrepareNode() {
  return async (
    state: SectionState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<SectionState>> => {
    const section = state.currentSection;
    await emitPlan(config, outlineToPlanEntries(state.outline, { currentTitle: section.title }));
    await emitStage(config, { stage: "调研", detail: section.title });

    return {
      messages: [
        new SystemMessage(
          `你是研究助理。必须使用 duckduckgo_search 工具检索章节资料，可基于建议检索词改写 query。` +
            `检索到足够资料后，用一句话说明「检索完成」，不要输出长文摘要（摘要由后续节点完成）。` +
            langClause(state.languageHint)
        ),
        new HumanMessage(
          `研究主题：${state.refinedTopic}\n` +
            `章节：${section.title}\n` +
            `建议检索词：${section.query}\n` +
            `请调用 duckduckgo_search 检索相关资料。`
        ),
      ],
      rawMaterial: "",
    };
  };
}

/** think：bindTools 后由模型决定是否/如何调搜索工具（prebuilt toolsCondition 路由）。 */
function createThinkNode(searchTool: StructuredTool, appConfig?: AppConfig) {
  const model = appConfig ? requireModel(appConfig, "deep-research 示例") : null;
  const bound: BoundModel | null =
    model && typeof model !== "string"
      ? (model as unknown as { bindTools: (t: StructuredTool[]) => BoundModel }).bindTools([
          searchTool,
        ])
      : null;

  return async (state: SectionState): Promise<Partial<SectionState>> => {
    if (!bound) {
      return {
        messages: [
          new AIMessage({
            content: `（无模型凭证，跳过工具检索；建议检索词：${state.currentSection.query}）`,
          }),
        ],
      };
    }
    const { shortTimeoutMs } = resolveLlmResilience(appConfig);
    const ai = await invokeWithResilience(bound, state.messages, {
      timeoutMs: shortTimeoutMs,
      label: "deep-research research-think",
      retryLabel: "deep-research research-think LLM",
      useSharedLimiter: true,
      config: appConfig,
    });
    return { messages: [ai] };
  };
}

/**
 * tools：prebuilt ToolNode 执行 tool_calls + onToolCall 三态透出。
 * 与默认图 `src/app/nodes/tools.ts` 同模式。
 */
function createToolsNode(searchTool: StructuredTool) {
  const toolNode = new ToolNode([searchTool]);

  return async (
    state: SectionState,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<SectionState>> => {
    const onToolCall = config?.configurable?.onToolCall as
      | FlowCallbacks["onToolCall"]
      | undefined;
    const last = state.messages[state.messages.length - 1] as AIMessage;
    const calls = (last?.tool_calls ?? []) as Array<{
      id?: string;
      name: string;
      args: Record<string, unknown>;
    }>;

    for (const c of calls) {
      if (onToolCall && c.id) {
        await onToolCall({
          toolCallId: c.id,
          toolName: c.name,
          args: c.args,
          status: "in_progress",
        });
      }
    }

    const result = (await toolNode.invoke({ messages: state.messages })) as {
      messages?: ToolMessage[];
    };
    const toolMsgs = result?.messages ?? [];

    for (const tm of toolMsgs) {
      if (onToolCall) {
        const failed = tm.status === "error";
        const text = typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content);
        await onToolCall({
          toolCallId: tm.tool_call_id,
          toolName: tm.name ?? "duckduckgo_search",
          args: {},
          status: failed ? "failed" : "completed",
          ...(failed ? { error: text } : { result: text }),
        });
      }
    }

    const chunk = toolMsgs
      .map((tm) => (typeof tm.content === "string" ? tm.content : JSON.stringify(tm.content)))
      .join("\n")
      .trim();

    return {
      messages: toolMsgs,
      ...(chunk ? { rawMaterial: chunk } : {}),
    };
  };
}

/** summarize：把 ToolMessage 检索结果整理成结构化章节摘要，写回父图 findings。 */
function createSummarizeNode(appConfig?: AppConfig) {
  return async (state: SectionState): Promise<Partial<SectionState>> => {
    const section = state.currentSection;
    const fromTools = extractToolMaterial(state.messages);
    const rawMaterial =
      fromTools ||
      state.rawMaterial ||
      `（未检索到资料；将基于主题常识整理。建议检索词：${section.query}）`;

    const model = requireModel(appConfig, "deep-research 示例");
    let summary: string;
    try {
      const res = await invokeLLM(
        model,
        [
          new SystemMessage(
            `你是技术分析师。根据检索资料，为章节「${section.title}」写一段 200-400 字的结构化摘要。` +
              `提取关键事实、数据、结论，不要堆砌链接。只输出摘要正文。` +
              langClause(state.languageHint)
          ),
          new HumanMessage(
            `主题：${state.refinedTopic}\n章节：${section.title}\n检索资料：\n${rawMaterial}`
          ),
        ],
        appConfig
      );
      summary = extractText(res.content).trim();
    } catch (err) {
      log.warn("research summarize 失败 → 降级", { section: section.title, error: String(err) });
      summary = fromTools
        ? fromTools.slice(0, 400)
        : `（${section.title} 资料获取失败，该章节将基于其他已有内容推断）`;
    }

    log.info("research done", { section: section.title, summaryLen: summary.length });
    return {
      findings: [{ title: section.title, searchResult: rawMaterial, summary }],
    };
  };
}

/**
 * 编译单章节调研子图；父图 `.addNode("research", createResearchSectionSubgraph(appConfig))`。
 */
export function createResearchSectionSubgraph(appConfig?: AppConfig) {
  const searchTool = createDuckDuckGoSearchTool();

  return new StateGraph(ResearchSectionState)
    .addNode("prepare", createPrepareNode())
    .addNode("think", createThinkNode(searchTool, appConfig))
    .addNode("tools", createToolsNode(searchTool))
    .addNode("summarize", createSummarizeNode(appConfig))
    .addEdge(START, "prepare")
    .addEdge("prepare", "think")
    .addConditionalEdges("think", toolsCondition, {
      tools: "tools",
      [END]: "summarize",
    })
    .addEdge("tools", "think")
    .addEdge("summarize", END)
    .compile();
}
