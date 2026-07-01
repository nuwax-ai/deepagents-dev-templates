/**
 * deep-research 示例 graph ——【图逻辑已提升至 src/libs/topologies/deep-research】。
 *
 * 本文件保留 example 的 createResearchFlow（StatefulFlow 包装）：examples 在 src 外、可自由
 * import surfaces 的 createStatefulFlow；图构造委托拓扑 createResearchGraph（单一权威，零重复）。
 *
 *   clarify → plan → outline_gate →(Send) research → review → draft → converse ↔ respond → delivery
 * 拓扑节点/反射/recipe 见 src/libs/topologies/deep-research/。
 */
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { durableCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import {
  createResearchGraph,
  type ResearchStateType,
  type DocRetrievalMcp,
} from "../../src/libs/topologies/deep-research/graph.js";
import { formatDeliveryAnswer } from "../../src/libs/topologies/deep-research/nodes/index.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import type { AppConfig } from "../../src/runtime/index.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph";

// 图逻辑单一权威在拓扑；re-export 供 example 测试（routeAfter*/isEndSignal/...）+ 入口。
export * from "../../src/libs/topologies/deep-research/graph.js";

/**
 * 包装成模板 StatefulFlow：多轮 HITL + 持续会话（clarify/outline_gate 审 → 报告 → converse 回路）。
 * configurable.appConfig 供 Send 并行 research 实例取模型；recursionLimit 防 reflection 回边。
 * @param opts.docMcp 文档检索 MCP（平台登记后注入）；缺省则 research 优雅降级
 */
export function createResearchFlow(
  appConfig?: AppConfig,
  opts: { checkpointer?: BaseCheckpointSaver; docMcp?: DocRetrievalMcp } = {}
): StatefulFlow {
  return createStatefulFlow<ResearchStateType>({
    buildGraph: (cp) => createResearchGraph(appConfig, cp, opts.docMcp),
    toInput: (query) => ({
      topic: query,
      outlineAttempts: 0,
      draftAttempts: 0,
      languageHint: "",
    }),
    toResult: (v) => ({
      answer:
        v.artifactMarkdownPath && v.artifactHtmlPath
          ? formatDeliveryAnswer({
              markdownPath: v.artifactMarkdownPath,
              htmlPath: v.artifactHtmlPath,
            })
          : v.finalReport || v.lastAnswer || v.draft || "",
    }),
    checkpointer: durableCheckpointer(appConfig, opts.checkpointer),
    configurable: { appConfig },
    recursionLimit: 50,
  });
}
