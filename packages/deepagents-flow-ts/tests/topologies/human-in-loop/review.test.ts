/**
 * 人审 flow 测试。
 *  - 纯函数（无凭证、确定性）：isApproval —— 守住「通过」判定（含「不可以」不误判）。
 *  - 真实接入（skipIf 无凭证）：compose/finalize 真调 LLM，验证 interrupt→resume 闭环与 checkpointer 隔离。
 */

import { config as loadDotenv } from "dotenv";
loadDotenv();

import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { MemorySaver } from "@langchain/langgraph";
import type { StructuredTool } from "@langchain/core/tools";
import { loadFlowConfig } from "../../../src/runtime/flow-config.js";
import { isApproval } from "../../../src/libs/nodes/index.js";
import {
  createAskQuestionPresentationNode,
  createReviewGraph,
  findAskQuestionTool,
  getReviewTopology,
  normalizeReviewFeedback,
  type ReviewStateType,
} from "../../../src/libs/topologies/human-in-loop/index.js";
import { materializeRecipe } from "../_helpers.js";

const hasCreds = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "OPENAI_API_KEY"].some(
  (k) => Boolean(process.env[k])
);

const runIntegration = process.env.RUN_INTEGRATION === "1" && hasCreds;

/** 测试用 createReviewFlow：直接物化图 recipe，不经 examples 包装。 */
function createReviewFlow(
  appConfig?: ReturnType<typeof loadFlowConfig>["appConfig"],
  opts: {
    checkpointer?: import("@langchain/langgraph").BaseCheckpointSaver;
    askQuestionTool?: StructuredTool;
  } = {}
) {
  return materializeRecipe<ReviewStateType>(
    {
      buildGraph: (cp) =>
        createReviewGraph(appConfig, cp, undefined, opts.askQuestionTool),
      toInput: (query) => ({ query }),
      toResult: (v) => ({ answer: v.output ?? "" }),
    },
    appConfig,
    opts.checkpointer
  );
}

describe("isApproval (纯函数, 无凭证)", () => {
  it("空回复 / 通过词 → 通过", () => {
    for (const fb of ["", "  ", "ok", "OK", "通过", "可以", "lgtm", "好的"]) {
      expect(isApproval(fb)).toBe(true);
    }
  });
  it("意见 / 否定 → 不通过", () => {
    for (const fb of ["改短一点", "不可以", "再加一段", "no"]) {
      expect(isApproval(fb)).toBe(false);
    }
  });
});

describe("ask-question MCP 人审表单（无凭证）", () => {
  it("把表单回复归一化为通过或修改意见", () => {
    expect(normalizeReviewFeedback("ok")).toBe("ok");
    expect(
      normalizeReviewFeedback(
        JSON.stringify({
          requestId: "review-1",
          action: "submit",
          formData: { decision: "approve", feedback: "" },
        })
      )
    ).toBe("ok");
    expect(
      normalizeReviewFeedback(
        JSON.stringify({
          formData: { decision: "revise", feedback: "标题再短一些" },
        })
      )
    ).toBe("标题再短一些");
    expect(
      normalizeReviewFeedback(
        [
          "我已填写「审阅草稿」，表单内容如下：",
          "处理方式：通过并定稿",
          "修改意见：未填写",
        ].join("\n")
      )
    ).toBe("ok");
    expect(
      normalizeReviewFeedback(
        [
          'I submitted "审阅草稿" with the following form content:',
          "处理方式: 按意见修改",
          "修改意见: 保留结论，缩短背景",
        ].join("\n")
      )
    ).toBe("保留结论，缩短背景");
  });

  it("能识别带 MCP server 前缀的 nuwax_ask_question 工具", () => {
    const unrelated = { name: "search" } as StructuredTool;
    const askQuestion = {
      name: "ask-question__nuwax_ask_question",
    } as StructuredTool;
    expect(findAskQuestionTool([unrelated, askQuestion])).toBe(askQuestion);
  });

  it("展示节点调用 MCP 并透出可渲染的完整工具事件", async () => {
    const invoke = vi.fn(async (args: Record<string, unknown>) => ({
      structuredContent: {
        status: "pending",
        input: { toolName: "nuwax_ask_question", ...args },
      },
    }));
    const askQuestion = {
      name: "ask-question__nuwax_ask_question",
      invoke,
    } as unknown as StructuredTool;
    const events: Array<Record<string, unknown>> = [];

    await createAskQuestionPresentationNode(askQuestion)(
      {
        query: "写产品介绍",
        draft: "这是初稿。",
        feedback: "",
        output: "",
      },
      {
        configurable: {
          thread_id: "session-1",
          onToolCall: (event: Record<string, unknown>) => events.push(event),
        },
      }
    );

    expect(invoke).toHaveBeenCalledOnce();
    const args = invoke.mock.calls[0]?.[0];
    expect(args).toMatchObject({
      schemaVersion: "nuwax.mcp_ask.v2",
      requestId: "session-1:review",
      revision: 1,
      sessionId: "session-1",
      title: "审阅草稿",
      ui: {
        version: "nuwax.interaction.v2",
        presentation: "inline",
        fields: [
          {
            name: "decision",
            widget: "radio",
            options: [
              { value: "approve", label: "通过并定稿" },
              { value: "revise", label: "按意见修改" },
            ],
          },
          { name: "feedback", widget: "textarea" },
        ],
      },
    });
    expect(events.map((event) => event.status)).toEqual([
      "in_progress",
      "completed",
    ]);
    expect(events[0]?.args).toBe(args);
    expect(events[1]?.result).toMatchObject({
      structuredContent: { status: "pending" },
    });
  });

  it("拓扑把 MCP 展示和 durable interrupt 拆成相邻节点", async () => {
    const topology = await getReviewTopology();
    expect(topology.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining(["compose", "present_review", "review", "finalize"])
    );
    expect(topology.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "compose", target: "present_review" }),
        expect.objectContaining({ source: "present_review", target: "review" }),
      ])
    );
  });
});

describe("createReviewFlow + askQuestionTool 注入", () => {
  it("注入 MCP 工具后图含 present_review 节点", async () => {
    const { appConfig } = loadFlowConfig();
    const askQuestion = {
      name: "ask-question__nuwax_ask_question",
      invoke: async () => ({ structuredContent: { status: "pending" } }),
    } as unknown as StructuredTool;
    const flow = createReviewFlow(appConfig, {
      askQuestionTool: askQuestion,
      checkpointer: new MemorySaver(),
    });
    const topology = await getReviewTopology();
    expect(topology.nodes.map((n) => n.id)).toEqual(
      expect.arrayContaining(["present_review", "review"])
    );
    expect(flow).toBeDefined();
  });
});

describe.skipIf(!runIntegration)("human-in-loop review flow (真实 LLM + HITL)", () => {
  const { appConfig } = loadFlowConfig();

  it("首跑到 interrupt：返回带草稿的问题", async () => {
    const flow = createReviewFlow(appConfig);
    const res = await flow.run({ query: "写一句产品介绍" }, randomUUID());
    expect(res.status).toBe("interrupted");
    if (res.status === "interrupted") expect(res.question).toContain("草稿");
  }, 60000);

  it("resume 'ok' → 通过定稿（同一 threadId 续接草稿）", async () => {
    const flow = createReviewFlow(appConfig);
    const tid = randomUUID();
    const first = await flow.run({ query: "写一句产品介绍" }, tid);
    expect(first.status).toBe("interrupted");
    const done = await flow.run({ resume: "ok" }, tid);
    expect(done.status).toBe("done");
    if (done.status === "done") expect(done.answer).toContain("已通过");
  }, 60000);

  it("不同 threadId 互不串状态", async () => {
    const flow = createReviewFlow(appConfig);
    const a = randomUUID();
    const b = randomUUID();
    await flow.run({ query: "写关于猫的一句话" }, a);
    await flow.run({ query: "写关于狗的一句话" }, b);
    const doneA = await flow.run({ resume: "ok" }, a);
    expect(doneA.status).toBe("done");
  }, 90000);
});
