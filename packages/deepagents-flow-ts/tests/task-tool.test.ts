import { describe, expect, it, vi } from "vitest";
import { AIMessageChunk, HumanMessage } from "@langchain/core/messages";
import { FakeStreamingChatModel } from "@langchain/core/utils/testing";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import type { StructuredTool } from "@langchain/core/tools";
import { AppConfigSchema } from "../src/runtime/index.js";
import { FlowStateAnnotation, type FlowState } from "../src/app/state.js";
import { createFlowGraph } from "../src/app/graph.js";
import {
  createTaskTool,
  parseSubagentModelOverride,
} from "../src/app/task.tool.js";

vi.mock("../src/app/graph.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/app/graph.js")>();
  return {
    ...actual,
    createFlowGraph: vi.fn(actual.createFlowGraph),
  };
});

const baseConfig = AppConfigSchema.parse({
  model: { provider: "openai", name: "deepseek-chat" },
});

describe("parseSubagentModelOverride", () => {
  it("plain model name inherits parent provider", () => {
    const result = parseSubagentModelOverride("gpt-4o-mini", baseConfig);
    expect("error" in result).toBe(false);
    if ("config" in result) {
      expect(result.config.model.provider).toBe("openai");
      expect(result.config.model.name).toBe("gpt-4o-mini");
    }
  });

  it("provider/model overrides provider and model together", () => {
    const result = parseSubagentModelOverride("anthropic/claude-sonnet-4-6", baseConfig);
    expect("error" in result).toBe(false);
    if ("config" in result) {
      expect(result.config.model.provider).toBe("anthropic");
      expect(result.config.model.name).toBe("claude-sonnet-4-6");
      expect(result.config.model.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
    }
  });

  it("rejects unsupported provider prefixes", () => {
    const result = parseSubagentModelOverride("google/gemini-pro", baseConfig);
    expect(result).toEqual({
      error: "不支持的 model provider，当前仅支持 anthropic/openai: google/gemini-pro",
    });
  });
});

describe("createTaskTool", () => {
  it("子智能体 token 仅经 source 回调发送一次，不再向父图 messages 重复冒泡", async () => {
    const text = "好的，。";
    const model = new FakeStreamingChatModel({
      sleep: 0,
      chunks: [...text].map((content) => new AIMessageChunk({ content })),
    });
    const childGraph = new StateGraph(FlowStateAnnotation)
      .addNode("think", async (state: FlowState) => {
        const message = await model.invoke([new HumanMessage(state.input)]);
        return { messages: [message], output: text };
      })
      .addEdge(START, "think")
      .addEdge("think", END)
      .compile({ checkpointer: new MemorySaver() });
    vi.mocked(createFlowGraph).mockReturnValueOnce(
      childGraph as ReturnType<typeof createFlowGraph>
    );

    const task = createTaskTool({
      config: baseConfig,
      parentWorkspaceRoot: process.cwd(),
      buildTools: () => [],
      subAgents: [
        {
          name: "视觉设计师",
          description: "视觉设计",
          systemPrompt: "负责视觉设计。",
        },
      ],
    });

    const ParentState = Annotation.Root({
      output: Annotation<string>,
    });
    const delivered: Array<{ route: "source" | "parent"; text: string; source?: string }> = [];
    const parentGraph = new StateGraph(ParentState)
      .addNode("task", async (_state, config) => {
        const output = await task.invoke(
          { subagent_type: "视觉设计师", description: "设计海报" },
          config
        );
        return { output: String(output) };
      })
      .addEdge(START, "task")
      .addEdge("task", END)
      .compile();

    const stream = await parentGraph.stream(
      {},
      {
        configurable: {
          onToken: (token: string, source?: string) => {
            delivered.push({ route: "source", text: token, source });
          },
        },
        streamMode: ["messages", "updates"],
      }
    );
    for await (const raw of stream) {
      if (!Array.isArray(raw) || raw[0] !== "messages") continue;
      const token = raw[1]?.[0]?.content;
      if (typeof token === "string" && token) {
        delivered.push({ route: "parent", text: token });
      }
    }

    expect(delivered.map((event) => event.text).join("")).toBe(text);
    expect(delivered.filter((event) => event.route === "parent")).toEqual([]);
    expect(
      new Set(
        delivered
          .filter((event) => event.route === "source")
          .map((event) => event.source)
      )
    ).toEqual(new Set(["视觉设计师"]));
  });

  it("rejects subagent tools that are not available", async () => {
    const tool = createTaskTool({
      config: baseConfig,
      parentWorkspaceRoot: process.cwd(),
      buildTools: () => [{ name: "read_file" } as StructuredTool],
      subAgents: [
        {
          name: "researcher",
          description: "Researcher",
          systemPrompt: "You research.",
          tools: ["missing_tool"],
        },
      ],
    });

    const result = await tool.invoke({
      subagent_type: "researcher",
      description: "test",
    });

    expect(result).toContain('Error: subagent "researcher" 配置了未知工具: missing_tool');
  });
});
