/**
 * RAG 示例 —— createStatefulFlow 包装（conversational 多轮 + checkpointer）。
 */
import { createStatefulFlow } from "../../src/surfaces/stateful-flow.js";
import { createFileCheckpointer } from "../../src/runtime/services/file-checkpoint-saver.js";
import type { StatefulFlow } from "../../src/core/flow-types.js";
import { createRAGGraph, type RAGStateType } from "./graph.js";
import { buildGraphConfig, formatSourcesFooter } from "./run-rag.js";
import type { LoadedRagConfig } from "./config.js";
import type { RAGResponse } from "./nodes/types.js";

export function createRagFlow(loaded: LoadedRagConfig): StatefulFlow {
  const graphConfig = buildGraphConfig(loaded);
  const checkpointer = createFileCheckpointer(loaded.appConfig, process.cwd());

  return createStatefulFlow<RAGStateType>({
    buildGraph: (cp) => createRAGGraph({ ...graphConfig }, cp),
    toInput: (query) => ({ query }),
    toResult: (values) => {
      const response: RAGResponse = {
        answer: values.answer || "无法生成回答",
        sources: values.sources || [],
        metadata: values.metadata ?? { tools_used: [], token_count: 0, duration_ms: 0 },
      };
      return { answer: response.answer, footer: formatSourcesFooter(response) };
    },
    checkpointer,
    appConfig: loaded.appConfig,
    conversational: true,
  });
}
