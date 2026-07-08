/**
 * blueprint: custom —— 节点级编排，**生成时渲染真实 TS**（非运行时 eval）。
 *
 * spec（state/nodes/edges）→ 渲染成 flows/<name>/graph.ts 的真实 StateGraph 代码：
 * node.params 里的 prompt/route/write 等箭头函数字符串**原样内联为代码**（它们本就是合法 TS），
 * 因此被 tsc 静态检查、可读、可被 inspector 可视化、可手改。生成的 flow 自包含，
 * 不依赖 libs/topologies/custom 运行时解释器（已废弃）。
 *
 * 支持节点 type：llm / llm-stream / llm-router / approval / approval-finalize / platform-tool / tool-exec / mcp-retrieval / prepare / passthrough。
 * 支持边 kind：static / conditional / fanout。subgraph 暂不支持 → 生成后手改。
 */

export const kind = "stateful-recipe";

const TS_TYPE = { string: "string", number: "number", boolean: "boolean", "any-last": "unknown" };

/** state spec → Annotation.Root channel 行。 */
function renderState(state) {
  const lines = Object.entries(state).map(([name, ch]) => {
    if (ch.type === "string-array-append") {
      return `  ${name}: Annotation<unknown[]>({ reducer: (a, b) => [...(a ?? []), ...(b ?? [])], default: () => [] }),`;
    }
    if (ch.type === "any-last") {
      // last-wins reducer：fanout/并发写时取最后值（无 reducer 的 LastValue 通道并发写会 InvalidUpdateError）
      return `  ${name}: Annotation<unknown>({ reducer: (_a, b) => b }),`;
    }
    return `  ${name}: Annotation<${TS_TYPE[ch.type] ?? "unknown"}>(),`;
  });
  return lines.join("\n");
}

/** 单个 node → factory 调用代码（params 字符串原样内联为真实代码）。 */
function renderNode(name, node) {
  const p = node.params ?? {};
  const q = JSON.stringify(name);
  const model = p.model ? p.model : `() => requireModel(appConfig, ${q})`;
  switch (node.type) {
    case "llm":
      return `createLlmNode<StateShape>({
      model: ${model},
      prompt: ${p.prompt},
      write: ${p.write},${p.parse ? `\n      parse: ${p.parse},` : ""}${p.systemPrompt ? `\n      systemPrompt: ${JSON.stringify(p.systemPrompt)},` : ""}
      config: appConfig,
      label: ${q},
    })`;
    case "llm-stream":
      return `createLlmStreamNode<StateShape>({
      model: ${model},
      prompt: ${p.prompt},
      write: ${p.write},
      config: appConfig,
      label: ${q},
      timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
    })`;
    case "llm-router":
      return `createLlmRouterNode<StateShape>({
      model: ${model},
      prompt: ${p.prompt},${p.parse ? `\n      parse: ${p.parse},` : ""}
      route: ${p.route},
      routeFallback: ${p.routeFallback},
      config: appConfig,
      label: ${q},
    })`;
    case "approval":
      return `createHumanApprovalNode<StateShape>({
      question: ${p.question},
      write: ${p.write},
    })`;
    case "approval-finalize":
      if (!p.rejectedLlm?.prompt || !p.rejectedLlm?.write) {
        throw new Error(
          `custom: approval-finalize 节点 "${name}" 缺 rejectedLlm.prompt/write（必填：spec.params.rejectedLlm = { prompt, write }）`
        );
      }
      return `createApprovalFinalizeNode<StateShape>({
      approvedOutput: ${p.approvedOutput},
      rejectedLlm: {
        model: () => requireModel(appConfig, ${q}),
        prompt: ${p.rejectedLlm?.prompt},
        write: ${p.rejectedLlm?.write},
        config: appConfig,
        label: ${q},
        timeoutMs: resolveLlmResilience(appConfig).longTimeoutMs,
      },
    })`;
    case "tool-exec":
      return `createToolExecNode<StateShape & { messages: BaseMessage[] }>({
      tools: pickTools(allTools, ${JSON.stringify(p.tools ?? [])}),${p.write ? `\n      write: ${p.write},` : ""}
    })`;
    case "platform-tool":
      if (!p.toolName || !p.args || !p.write) {
        throw new Error(
          `custom: platform-tool 节点 "${name}" 缺 toolName/args/write（必填：params.toolName = "<工具名>", params.args = (s) => ({...}), params.write = (r,s) => ({...})）`
        );
      }
      return `createPlatformToolActionNode<StateShape>({
      tools: allTools,
      toolName: ${JSON.stringify(p.toolName)},
      args: ${p.args},
      write: ${p.write},
      label: ${q},
    })`;
    case "mcp-retrieval":
      return `createMcpRetrievalNode<StateShape>({
      mcpServers: ${JSON.stringify(p.mcpServers ?? {})},
      retrieve: ${p.retrieve},
      write: ${p.write},
      label: ${q},
    })`;
    case "prepare":
      return `createPrepareNode<StateShape>(${p.systemPrompt ? `{ systemPrompt: ${JSON.stringify(p.systemPrompt)} }` : ""})`;
    case "passthrough":
      // write 直接作为节点函数（不包一层调用）；不用 state 就写 () => ({})。
      return `((${p.write ?? "() => ({})"}) as (s: StateShape) => Partial<StateShape>)`;
    default:
      throw new Error(
        `custom 渲染不支持节点类型 "${node.type}"（subgraph 请生成后手改）`
      );
  }
}

/** 单条 edge → addEdge / addConditionalEdges 代码。 */
function renderEdge(e) {
  if (e.kind === "static") {
    const from = e.from === "__start__" ? "START" : JSON.stringify(e.from);
    const to = e.to === "__end__" ? "END" : JSON.stringify(e.to);
    return `    .addEdge(${from}, ${to})`;
  }
  if (e.kind === "conditional") {
    // ⚠️ condition 的返回值必须 ∈ targets，否则运行时 LangGraph 抛 "Invalid edge"；
    // 静态反射（COMPLETION_GATE 的 graph）不执行 condition，检不出该错配——需人工核对。
    const pm = e.targets
      .map((t) => `${JSON.stringify(t)}: ${t === "__end__" ? "END" : JSON.stringify(t)}`)
      .join(", ");
    return `    .addConditionalEdges(${JSON.stringify(e.from)}, ${e.condition}, { ${pm} })`;
  }
  // fanout：Send map-reduce
  return `    .addConditionalEdges(
      ${JSON.stringify(e.from)},
      createFanout<unknown, StateShape>({ items: ${e.items}, target: ${JSON.stringify(e.target)}, input: ${e.input} }),
      [${JSON.stringify(e.target)}]
    )`;
}

/** 按 spec 实际用到的符号精确收集 import（避免 noUnusedLocals 报错）。 */
function collectImports(params) {
  const nodeTypes = new Set(Object.values(params.nodes).map((n) => n.type));
  const factory = {
    llm: "createLlmNode",
    "llm-stream": "createLlmStreamNode",
    "llm-router": "createLlmRouterNode",
    approval: "createHumanApprovalNode",
    "approval-finalize": "createApprovalFinalizeNode",
    "platform-tool": "createPlatformToolActionNode",
    "tool-exec": "createToolExecNode",
    "mcp-retrieval": "createMcpRetrievalNode",
    prepare: "createPrepareNode",
  };
  const nodes = new Set();
  for (const t of nodeTypes) if (factory[t]) nodes.add(factory[t]);
  if ([...nodeTypes].some((t) => ["llm", "llm-stream", "llm-router", "approval-finalize"].includes(t))) {
    nodes.add("requireModel");
  }
  const needsLlmResilience = [...nodeTypes].some((t) => ["llm-stream", "approval-finalize"].includes(t));
  if (params.edges.some((e) => e.kind === "fanout")) nodes.add("createFanout");

  const text = JSON.stringify(params);
  if (/\bparseJson\s*\(/.test(text)) nodes.add("parseJson");
  if (/\bextractText\s*\(/.test(text)) nodes.add("extractText");

  const lg = ["StateGraph", "Annotation", "MemorySaver"];
  if (params.edges.some((e) => e.kind === "static" && e.from === "__start__")) lg.push("START");
  const endsHasEnd = Object.values(params.nodes).some(
    (n) => n.type === "llm-router" && Array.isArray(n.params?.ends) && n.params.ends.includes("__end__")
  );
  if (
    endsHasEnd ||
    params.edges.some(
      (e) =>
        (e.kind === "static" && e.to === "__end__") ||
        (e.kind === "conditional" && (e.targets ?? []).includes("__end__"))
    )
  ) {
    lg.push("END");
  }
  if (/\bCommand\s*\(/.test(text)) lg.push("Command");
  if (/\bnew Send\b/.test(text)) lg.push("Send");

  const msgs = [];
  if (/\bSystemMessage\s*\(/.test(text)) msgs.push("SystemMessage");
  if (/\bHumanMessage\s*\(/.test(text)) msgs.push("HumanMessage");
  if (/\bAIMessage\s*\(/.test(text)) msgs.push("AIMessage");
  if (nodeTypes.has("tool-exec")) msgs.push("type BaseMessage");

  return {
    langgraph: lg,
    messages: msgs,
    nodes: [...nodes],
    needsLlmResilience,
    needsToolBindings: nodeTypes.has("tool-exec") || nodeTypes.has("platform-tool"),
    needsPickTools: nodeTypes.has("tool-exec"),
  };
}

/** @param {{name:string,description:string,params:{state:object,nodes:object,edges:array,input:object,result:object,recursionLimit?:number}}} spec */
export function render(spec) {
  const platformToolRefs = (spec.tools ?? []).filter(
    (tool) => tool && typeof tool === "object" && "targetType" in tool && "targetId" in tool
  );
  const P = spec.params;
  const imp = collectImports(P);
  // 无 llm/llm-router/approval-finalize 节点时 appConfig 不被引用 → 加 _ 前缀避免 noUnusedParameters
  const appConfigParam = imp.nodes.includes("requireModel") ? "appConfig" : "_appConfig";
  const allToolsParam = imp.needsToolBindings ? "allTools" : "_allTools";

  const nodeLines = Object.entries(P.nodes)
    .map(([name, node]) => {
      // llm-router 的 Command goto 目标须经 addNode 第三参 ends 声明，否则 getGraphAsync 反射不出这些边
      const ends =
        node.type === "llm-router" && Array.isArray(node.params?.ends)
          ? `, { ends: [${node.params.ends.map((e) => (e === "__end__" ? "END" : JSON.stringify(e))).join(", ")}] }`
          : "";
      return `    .addNode(${JSON.stringify(name)}, ${renderNode(name, node)}${ends})`;
    })
    .join("\n");
  const edgeLines = P.edges.map(renderEdge).join("\n");

  const graphTs = `/**
 * ${spec.name} — custom 节点级拓扑（scaffold 生成的真实 TS，可手改）
 * ${spec.description || "按 spec 的 state/nodes/edges 编排"}
 *
 * 本文件由 spec 渲染成真实 StateGraph：节点用 libs/nodes factory，prompt/route 等为内联真实代码
 * （受 tsc 检查）。改图直接改这里的 addNode / addEdge。节点 type 词表见 docs/node-catalog.md。
 */
import {
  StateGraph,
  ${imp.langgraph.filter((s) => s !== "StateGraph").join(",\n  ")},
  type BaseCheckpointSaver,
} from "@langchain/langgraph";${imp.messages.length ? `\nimport { ${imp.messages.join(", ")} } from "@langchain/core/messages";` : ""}
import type { AppConfig } from "../../../runtime/index.js";
import type { StructuredTool } from "@langchain/core/tools";
${imp.needsLlmResilience ? `import { resolveLlmResilience } from "../../../runtime/services/llm-resilience.js";\n` : ""}${imp.nodes.length ? `import { ${imp.nodes.join(", ")} } from "../../../libs/nodes/index.js";\n` : ""}import { reflectTopology } from "../../../libs/topologies/reflect.js";
import type { FlowTopology } from "../../../core/flow-types.js";
${imp.needsPickTools ? `import { pickTools } from "../../tool-bindings.js";\n` : ""}

const State = Annotation.Root({
${renderState(P.state)}
});
export type StateShape = typeof State.State;

/** 按 spec 构造图（编译后）。被 index.ts 的 recipe.buildGraph 调用。 */
export function buildGraph(${appConfigParam}: AppConfig | undefined, checkpointer: BaseCheckpointSaver = new MemorySaver(), ${allToolsParam}: StructuredTool[] = []) {
  return new StateGraph(State)
${nodeLines}
${edgeLines}
    .compile({ checkpointer });
}

/** 静态拓扑反射（不运行图、不需凭证）。 */
export function getTopology(): Promise<FlowTopology> {
  return reflectTopology(buildGraph(undefined));
}
`;

  const extra =
    P.input.extra && Object.keys(P.input.extra).length
      ? `, ...${JSON.stringify(P.input.extra)}`
      : "";
  const footer = P.result.footerField
    ? `\n    const footer = String((v as Record<string, unknown>)[${JSON.stringify(P.result.footerField)}] ?? "");`
    : "";
  const ret = P.result.footerField
    ? `footer ? { answer, footer } : { answer }`
    : `{ answer }`;

  const indexTs = `/**
 * ${spec.name} — custom 拓扑 recipe（scaffold 生成）。图见 ./graph.ts。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import { buildGraph, getTopology as _getTopology } from "./graph.js";

const _platformToolRefsJson = ${JSON.stringify(JSON.stringify(platformToolRefs))};
export const platformToolRefs = JSON.parse(_platformToolRefsJson);

export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe => ({
  buildGraph: (cp) => buildGraph(runtime.config, cp, runtime.allTools),
  toInput: (query) => ({ ${JSON.stringify(P.input.queryField)}: query${extra} }),
  toResult: (v) => {
    const answer = String((v as Record<string, unknown>)[${JSON.stringify(P.result.answerField)}] ?? "");${footer}
    return ${ret};
  },${P.recursionLimit ? `\n  recursionLimit: ${P.recursionLimit},` : ""}
  platformToolRefs,
});

export const getTopology = _getTopology;
`;

  return [
    { path: `src/app/flows/${spec.name}/graph.ts`, content: graphTs },
    { path: `src/app/flows/${spec.name}/index.ts`, content: indexTs },
  ];
}
