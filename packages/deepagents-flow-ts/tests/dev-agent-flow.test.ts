import { describe, expect, it, vi } from "vitest";
import { AIMessage } from "@langchain/core/messages";
import { MemorySaver, StateGraph, START, END } from "@langchain/langgraph";
import type { PlanEvent } from "../src/core/flow-types.js";
import { FlowStateAnnotation, type FlowState } from "../src/app/state.js";
import { createFlowGraph } from "../src/app/graph.js";
import { createDevAgentFlow } from "../src/app/flows/dev-agent/index.js";
import type { FlowRuntime } from "../src/runtime/flow-runtime.js";
import { writeTodosTool } from "../src/libs/tools/todo.tool.js";

vi.mock("../src/app/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app/graph.js")>();
  return {
    ...actual,
    createFlowGraph: vi.fn(actual.createFlowGraph),
  };
});

function minimalRuntime(): FlowRuntime {
  return {
    allTools: [writeTodosTool],
    checkpointer: new MemorySaver(),
    config: {
      model: {
        provider: "anthropic",
        name: "claude-test",
        apiKeyEnv: "ANTHROPIC_API_KEY",
      },
      agent: {},
      skills: { progressiveLoading: false },
      permissions: { mode: "allow", interruptOn: [] },
    },
    ctx: {} as FlowRuntime["ctx"],
    systemPrompt: "test",
    skillsPaths: [],
    skills: [],
    subAgents: [],
    sandbox: {} as FlowRuntime["sandbox"],
    workspaceRoot: process.cwd(),
  };
}

describe("createDevAgentFlow", () => {
  it("向图注入 onPlan（write_todos 可触发 ACP plan）", async () => {
    const childGraph = new StateGraph(FlowStateAnnotation)
      .addNode("think", async (state: FlowState, config) => {
        const onPlan = config?.configurable?.onPlan as
          | ((e: PlanEvent) => void | Promise<void>)
          | undefined;
        await onPlan?.({
          entries: [{ content: "执行验证", status: "in_progress" }],
        });
        return {
          messages: [new AIMessage({ content: "done" })],
          output: `done:${state.input}`,
        };
      })
      .addEdge(START, "think")
      .addEdge("think", END)
      .compile({ checkpointer: new MemorySaver() });

    let capturedCallbacks: Parameters<typeof createFlowGraph>[0]["callbacks"];
    vi.mocked(createFlowGraph).mockImplementationOnce((cfg) => {
      capturedCallbacks = cfg.callbacks;
      return childGraph as ReturnType<typeof createFlowGraph>;
    });

    const plans: PlanEvent[] = [];
    const flow = createDevAgentFlow(minimalRuntime());
    const result = await flow.run(
      { query: "写待办" },
      "thread-dev-agent",
      { onPlan: (event) => plans.push(event) }
    );

    expect(result).toEqual({ status: "done", answer: "done:写待办" });
    expect(capturedCallbacks?.onPlan).toBeTypeOf("function");
    expect(plans).toEqual([
      { entries: [{ content: "执行验证", status: "in_progress" }] },
    ]);
  });
});
