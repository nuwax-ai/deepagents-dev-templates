/**
 * search-aggregator — 「平台能力对话样板」（conversational ReAct + 平台搜索能力）。
 *
 * 这是**聊天助手型**的注册版官方样板：不写任何图代码、不写任何 fetch —— 复用默认
 * ReAct 图（prepare → think ↔ tools → respond），靠 systemPrompt 定制行为。
 *
 * **平台能力接入（登记即接入）**：
 *   1. 开发期：在平台侧登记搜索能力；
 *   2. 运行期：平台把已登记工具（Plugin/Workflow/Knowledge 等）适配为 runtime 工具，
 *      合并进 allTools → think 自动 bindTools。
 *   全程**零包装代码**。禁止照 Plugin schema 手写 fetch（猜端点/猜 envelope/无超时 = 运行期卡住）。
 *
 * **提示词策略（conversational 样板通用）**：
 *   - 平台 systemPrompt 为权威来源（经 `update-config.sh` 同步）
 *   - 本文件嵌入式 prompt 仅作本地 CLI fallback（无平台配置时）
 *   - 平台优先、fallback 兜底，避免重复叠加
 *
 * 本文件不硬编码任何平台工具名（运行期工具命名以下发为准；bindTools 是发现式的，
 * 模型按工具描述自选）。未登记搜索能力时，systemPrompt 要求模型如实告知，不编造检索结果。
 *
 * 验证：须触发搜索（如「搜索并总结今天的 AI 新闻」），并确认搜索工具被真实调用（防 LLM 兜底假绿）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import type { FlowTopology } from "../../../core/flow-types.js";
import { createFlowGraph } from "../../graph.js";
import { getFlowTopology } from "../../topology.js";
import type { FlowState } from "../../state.js";

/**
 * 如实性护栏（不可协商）：无论提示词来自平台还是本地 fallback，都必须包含，
 * 防止平台侧提示词遗漏导致模型编造检索结果/来源。composeSystemPrompt 会强制追加。
 */
const HONESTY_GUARDRAIL = `## 如实性（不可协商）
没有任何搜索类工具可用时，直接说明「当前未接入联网搜索能力，需在平台登记后使用」，并仅基于已有知识作答、明确标注可能过时；检索结果为空或失败时如实说明，禁止编造来源或链接。`;

/** 本地 CLI fallback；平台 systemPrompt 存在时由 composeSystemPrompt 优先采用（护栏另行强制追加）。 */
const SEARCH_AGGREGATOR_PROMPT = `你是一个搜索聚合助手。用户提出问题后，你负责检索多个信息面并综合作答。

## 工作方式
1. **优先使用可用的搜索/检索类工具**（联网搜索、资讯、百科、专业数据查询等）。同一问题可换角度多次检索（概况 / 最新动态 / 权威资料），再综合。
2. **每条关键信息标注来源**，格式「[来源名](URL)」；多来源一致时标 1–2 个即可。
3. 按主题综合作答，不要按来源罗列；结构清晰（小标题 / 分点）。
4. **支持追问与钻取**：用户就上一轮答案继续问时，围绕已有结论补充检索，不要从零重复全部搜索。

${HONESTY_GUARDRAIL}`;

/**
 * 平台 systemPrompt 为权威来源；但「如实性护栏」不可被覆盖，总是强制追加。
 * - 平台提示词存在：平台提示词 + 护栏（避免平台侧遗漏防幻觉约束）。
 * - 无平台提示词：本地 fallback（其正文已含同一护栏，不重复追加）。
 */
export function composeSystemPrompt(platformPrompt: string | undefined): string {
  const trimmed = platformPrompt?.trim();
  if (trimmed) return `${trimmed}\n\n${HONESTY_GUARDRAIL}`;
  return SEARCH_AGGREGATOR_PROMPT;
}

/**
 * conversational recipe（注册表标 conversational: true）：多轮记忆 + 真流式 + 压缩，
 * 与 default flow 同一底座（见 src/app/default-flow.ts），仅 systemPrompt 不同。
 */
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe => ({
  buildGraph: (checkpointer) =>
    createFlowGraph({
      allTools: runtime.allTools,
      checkpointer,
      config: runtime.config,
      systemPrompt: composeSystemPrompt(runtime.systemPrompt),
    }),
  toInput: (query) => ({ input: query }),
  toResult: (values) => ({ answer: String((values as FlowState).output ?? "") }),
});

/** 拓扑与默认图一致（prepare → think ↔ tools → respond），直接复用反射。 */
export const getTopology = (): Promise<FlowTopology> => getFlowTopology();
