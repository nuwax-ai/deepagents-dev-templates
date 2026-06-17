/**
 * libs/nodes factory + 原语单测 —— AI Agent 改 factory 的安全网。
 *
 * 全部用 mock 模型 / 简单 tool,不依赖 LLM 凭证。
 * 覆盖:extractText / parseJson / isApproval / runTool 原语,
 *   createPrepareNode / createFanout / createLlmNode(含 parse、fallback)/
 *   createLlmStreamNode / createToolExecNode / createHumanApprovalNode。
 */

import { describe, it, expect } from "vitest";
import { HumanMessage, AIMessage, type BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { Annotation, type LangGraphRunnableConfig } from "@langchain/langgraph";
import {
  createLlmNode,
  createLlmStreamNode,
  createToolExecNode,
  createPrepareNode,
  createHumanApprovalNode,
  createFanout,
  extractText,
  parseJson,
  isApproval,
  runTool,
} from "../src/libs/nodes/index.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------- 原语 ----------
describe("extractText", () => {
  it("string 原样", () => expect(extractText("hi")).toBe("hi"));
  it("content block 数组拼接", () =>
    expect(extractText([{ text: "a" }, { text: "b" }])).toBe("ab"));
  it("非文本 block 忽略", () => expect(extractText([{ type: "image" }, { text: "x" }])).toBe("x"));
  it("其它类型 → 空串", () => expect(extractText(123)).toBe(""));
  it("null/undefined → 空串", () => expect(extractText(null)).toBe(""));
});

describe("parseJson", () => {
  it("对象", () => expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 }));
  it("数组", () => expect(parseJson<number[]>("[1,2,3]")).toEqual([1, 2, 3]));
  it("容忍 ```json 围栏 + 前后说明", () =>
    expect(parseJson<{ a: number }>("结果:\n```json\n{\"a\":1}\n```\n完")).toEqual({ a: 1 }));
  it("无 JSON → 抛", () => expect(() => parseJson("纯文本无结构")).toThrow());
  it("不完整 → 抛", () => expect(() => parseJson("{")).toThrow());
});

describe("isApproval", () => {
  it("空 / 纯空白 = 通过", () => {
    expect(isApproval("")).toBe(true);
    expect(isApproval("   ")).toBe(true);
  });
  it("中英文通过词", () => {
    for (const w of ["ok", "OK", "通过", "可以", "批准", "approved", "yes", "好的", "lgtm"]) {
      expect(isApproval(w)).toBe(true);
    }
  });
  it("否定 / 调整意见 = 不通过", () => {
    expect(isApproval("不可以")).toBe(false);
    expect(isApproval("再改改")).toBe(false);
    expect(isApproval("no")).toBe(false);
  });
  it("「不可以」不被「可以」误判", () => expect(isApproval("不可以")).toBe(false));
  it("自定义 regex 覆盖", () => {
    expect(isApproval("y", { regex: /^y$/ })).toBe(true);
    expect(isApproval("yes", { regex: /^y$/ })).toBe(false);
  });
});

describe("runTool", () => {
  it("成功 → in_progress→completed", async () => {
    const statuses: string[] = [];
    const { result, ok } = await runTool("t", { x: 1 }, async () => "done", (e) => {
      statuses.push(e.status);
    });
    expect(ok).toBe(true);
    expect(result).toBe("done");
    expect(statuses).toEqual(["in_progress", "completed"]);
  });
  it("抛错 → failed,result=错误信息", async () => {
    const { ok, result } = await runTool("t", {}, async () => {
      throw new Error("boom");
    });
    expect(ok).toBe(false);
    expect(result).toBe("boom");
  });
  it('"Unknown tool: xxx" 不抛但判失败', async () => {
    const { ok } = await runTool("t", {}, async () => "Unknown tool: foo");
    expect(ok).toBe(false);
  });
});

// ---------- createPrepareNode ----------
describe("createPrepareNode", () => {
  const S = Annotation.Root({
    input: Annotation<string>,
    messages: Annotation<BaseMessage[]>({ reducer: (a, b) => [...a, ...b], default: () => [] }),
  });
  type S_ = typeof S.State;

  it("input → HumanMessage", async () => {
    const out = (await createPrepareNode<S_>()({ input: "hi", messages: [] } as S_)) as any;
    expect(out.messages).toHaveLength(1);
    expect(out.messages[0]._getType()).toBe("human");
  });
  it("无 input → 空更新", async () => {
    expect(await createPrepareNode<S_>()({ input: "", messages: [] } as S_)).toEqual({});
  });
  it("systemPrompt 前置 SystemMessage", async () => {
    const out = (await createPrepareNode<S_>({ systemPrompt: "sys" })({
      input: "hi",
      messages: [],
    } as S_)) as any;
    expect(out.messages[0]._getType()).toBe("system");
    expect(out.messages[1]._getType()).toBe("human");
  });
});

// ---------- createFanout ----------
describe("createFanout", () => {
  it("每个 item → 一个 Send(同 target)", () => {
    const fanout = createFanout<string, { items: string[] }>({
      items: (s) => s.items,
      target: "proc",
      input: (it) => ({ item: it }),
    });
    const sends = fanout({ items: ["a", "b", "c"] });
    expect(sends).toHaveLength(3);
  });
  it("空 items → 空 Send[]", () => {
    const fanout = createFanout<string, { items: string[] }>({
      items: (s) => s.items,
      target: "proc",
      input: (it) => ({ item: it }),
    });
    expect(fanout({ items: [] })).toEqual([]);
  });
});

// ---------- createLlmNode ----------
describe("createLlmNode", () => {
  const mockModel = (content: unknown) => ({ invoke: async () => ({ content }) });

  it("一次调 → write(content)", async () => {
    const node = createLlmNode<{ q: string; out?: string }>({
      model: mockModel("hello") as any,
      prompt: (s) => [new HumanMessage(s.q)],
      write: (r) => ({ out: r.content }),
    });
    expect((await node({ q: "x" })).out).toBe("hello");
  });
  it("content block 数组也被 extractText 成文本", async () => {
    const node = createLlmNode<any>({
      model: mockModel([{ text: "a" }, { text: "b" }]) as any,
      prompt: () => [],
      write: (r) => ({ out: r.content }),
    });
    expect((await node({})).out).toBe("ab");
  });
  it("parse 结构化输出", async () => {
    const node = createLlmNode<any>({
      model: mockModel('{"n":5}') as any,
      prompt: () => [],
      parse: (t) => parseJson<{ n: number }>(t),
      write: (r) => ({ n: (r.parsed as { n: number }).n }),
    });
    expect((await node({})).n).toBe(5);
  });
  it("调用失败 → fallback(attempts:1 不重试,提速)", async () => {
    const node = createLlmNode<any>({
      model: { invoke: async () => Promise.reject(new Error("fail")) } as any,
      prompt: () => [],
      write: () => ({}),
      attempts: 1,
      fallback: () => ({ out: "fallback" }),
    });
    expect((await node({})).out).toBe("fallback");
  });
});

// ---------- createLlmStreamNode ----------
describe("createLlmStreamNode", () => {
  it("流式 → write({text, streamed:true})", async () => {
    const chunks = [{ content: "he" }, { content: "llo" }];
    const mockStream = {
      invoke: async () => ({ content: "" }),
      stream: async function* () {
        for (const c of chunks) yield c;
      },
    };
    const node = createLlmStreamNode<any>({
      model: mockStream as any,
      prompt: () => [],
      write: (r) => ({ text: r.text, streamed: r.streamed }),
      timeoutMs: 5000,
    });
    // 需 configurable.onToken 才走 stream 分支(streamLLMText 的 hasVisibleTokenSink)
    const out = await node({}, { configurable: { onToken: () => undefined } } as LangGraphRunnableConfig);
    expect(out.text).toBe("hello");
    expect(out.streamed).toBe(true);
  });
  it("无 onToken sink → 退回 invoke(streamed:false)", async () => {
    const mock = { invoke: async () => ({ content: "full" }), stream: async function* () {
      yield { content: "x" };
    } };
    const node = createLlmStreamNode<any>({
      model: mock as any,
      prompt: () => [],
      write: (r) => ({ text: r.text, streamed: r.streamed }),
      timeoutMs: 5000,
    });
    const out = await node({}, undefined);
    expect(out.text).toBe("full");
    expect(out.streamed).toBe(false);
  });
});

// ---------- createToolExecNode ----------
describe("createToolExecNode", () => {
  it("执行 tool_call + 三态 onToolCall(in_progress→completed)", async () => {
    const echo = tool(async ({ x }: { x: string }) => `got:${x}`, {
      name: "echo",
      schema: z.object({ x: z.string() }),
      description: "echo back",
    });
    const statuses: string[] = [];
    const node = createToolExecNode<{ messages: BaseMessage[] }>({
      tools: [echo] as any,
      callbacks: { onToolCall: (e) => void statuses.push(e.status) } as any,
    });
    const ai = new AIMessage({
      content: "",
      tool_calls: [{ id: "tc1", name: "echo", args: { x: "hi" } }] as any,
    });
    const out = (await node({ messages: [ai] })) as any;
    expect(out.messages).toHaveLength(1);
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("completed");
  });
  it("无 tool_calls → 空 messages", async () => {
    const node = createToolExecNode<{ messages: BaseMessage[] }>({ tools: [] as any });
    const out = (await node({ messages: [new AIMessage({ content: "no calls" })] })) as any;
    expect(out.messages).toEqual([]);
  });
});

// ---------- createHumanApprovalNode(纯逻辑部分)----------
describe("createHumanApprovalNode", () => {
  // interrupt() 在图外会抛,故只验「write/route 的判定逻辑」经 isApproval 走通。
  // 真实 interrupt 闭环由 examples 的 stateful-flow 测试覆盖。
  it("isApproval 已在原语测试覆盖(此 factory 内部用同一判定)", () => {
    expect(isApproval("ok")).toBe(true);
    expect(isApproval("改改")).toBe(false);
  });
});
