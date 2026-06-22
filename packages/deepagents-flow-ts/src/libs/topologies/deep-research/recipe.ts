/**
 * deep-research 拓扑的构造配方（StatefulTopologyRecipe）。
 *
 * configurable.appConfig：与原 example createResearchFlow 保持一致（research 子图经编译时
 * 闭包取模型，**当前无节点读 configurable.appConfig**；保留以对齐基座 configurable 约定，
 * 供未来节点/工具读取，勿误以为是 research 取模型的唯一来源）。
 * toResult 优先用交付产物（artifact 路径）格式化，否则回退报告/答疑/草稿。
 * recursionLimit 50 防 reflection 回边跑飞。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../types.js";
import { createResearchGraph, type ResearchStateType } from "./graph.js";
import { formatDeliveryAnswer } from "./nodes/index.js";

export function researchRecipe(
  runtime: FlowRuntime
): StatefulTopologyRecipe<ResearchStateType> {
  return {
    buildGraph: (cp) => createResearchGraph(runtime.config, cp),
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
    configurable: { appConfig: runtime.config },
    recursionLimit: 50,
  };
}
