import { describe, expect, it } from "vitest";
import {
  isSmokeFlowSuccess,
  parseSmokeSessionTrace,
  parseSmokeToolCalls,
  evaluateExpectedTool,
  evaluateSmokeOutput,
} from "../scripts/lib/smoke-outcome.mjs";

const ROUTER_GATE_SNIPPET = `
2026-06-29 15:52:50.112 [info] [runtime:session-trace] flow.run done sessionId=sess_068 flowStatus=done outputChars=58 footerChars=0
2026-06-29 15:52:50.112 [info] [runtime:session-trace] prompt_end end_turn sessionId=sess_068 stopReason=end_turn flowStatus=done answerChars=58 streamed=true streamChars=58 tokenChunks=26
[ERR ] Prompt ended with error (session: sess_068): Session cancelled
`;

const INTERVIEW_SNIPPET = `
2026-06-29 15:54:10.354 [info] [runtime:session-trace] flow.run done sessionId=sess_f31 flowStatus=interrupted outputChars=0 footerChars=0 questionChars=166
2026-06-29 15:54:10.355 [info] [runtime:session-trace] prompt_end end_turn sessionId=sess_f31 stopReason=end_turn flowStatus=interrupted questionChars=166 streamed=true streamChars=151 tokenChunks=72
[ERR ] Prompt ended with error (session: sess_f31): Session cancelled
`;

const EMPTY_FAIL_SNIPPET = `
[ERR ] Prompt ended with error (session: sess_x): Session cancelled
`;

const INTERRUPT_NO_STREAM = `
flow.run done sessionId=sess_x flowStatus=interrupted outputChars=0 questionChars=0
prompt_end sessionId=sess_x flowStatus=interrupted streamed=false streamChars=0
Session cancelled
`;

// 平台能力闸门（SMOKE_EXPECT_TOOL）夹具：专用脱敏工具摘要为 info 级 session-trace 行
const TOOL_OK_SNIPPET = `
2026-07-02 10:00:01.000 [info] [runtime:session-trace] tool invoke start  toolName=search__web_search toolCallId=call_1 sessionId=sess_t
2026-07-02 10:00:03.000 [info] [runtime:session-trace] tool invoke done  toolName=search__web_search toolCallId=call_1 sessionId=sess_t resultChars=1834
2026-07-02 10:00:09.000 [info] [runtime:session-trace] flow.run done sessionId=sess_t flowStatus=done outputChars=420 footerChars=0
2026-07-02 10:00:09.001 [info] [runtime:session-trace] prompt_end end_turn sessionId=sess_t stopReason=end_turn flowStatus=done answerChars=420 streamed=true streamChars=420 tokenChunks=88
`;

const TOOL_FAILED_SNIPPET = `
2026-07-02 10:00:01.000 [info] [runtime:session-trace] tool invoke start  toolName=search__web_search toolCallId=call_1 sessionId=sess_t
2026-07-02 10:00:03.000 [info] [runtime:session-trace] tool invoke failed  toolName=search__web_search toolCallId=call_1 sessionId=sess_t
2026-07-02 10:00:09.000 [info] [runtime:session-trace] flow.run done sessionId=sess_t flowStatus=done outputChars=120 footerChars=0
2026-07-02 10:00:09.001 [info] [runtime:session-trace] prompt_end end_turn sessionId=sess_t stopReason=end_turn flowStatus=done answerChars=120 streamed=true streamChars=120 tokenChunks=30
`;

const TOOL_EMPTY_SNIPPET = `
2026-07-02 10:00:03.000 [info] [runtime:session-trace] tool invoke done  toolName=search__web_search toolCallId=call_1 sessionId=sess_t resultChars=0
2026-07-02 10:00:09.000 [info] [runtime:session-trace] flow.run done sessionId=sess_t flowStatus=done outputChars=120 footerChars=0
2026-07-02 10:00:09.001 [info] [runtime:session-trace] prompt_end end_turn sessionId=sess_t stopReason=end_turn flowStatus=done answerChars=120 streamed=true streamChars=120 tokenChunks=30
`;

describe("parseSmokeSessionTrace", () => {
  it("merges flow.run done + prompt_end fields", () => {
    const t = parseSmokeSessionTrace(INTERVIEW_SNIPPET);
    expect(t).toMatchObject({
      flowStatus: "interrupted",
      outputChars: 0,
      questionChars: 166,
      streamed: true,
      streamChars: 151,
      tokenChunks: 72,
    });
  });
});

describe("isSmokeFlowSuccess", () => {
  it("router-gate done + streamed 为成功", () => {
    expect(isSmokeFlowSuccess(parseSmokeSessionTrace(ROUTER_GATE_SNIPPET))).toBe(true);
  });

  it("HITL flow interrupted + streamed + question 为成功", () => {
    expect(isSmokeFlowSuccess(parseSmokeSessionTrace(INTERVIEW_SNIPPET))).toBe(true);
  });

  it("无 trace 为失败", () => {
    expect(isSmokeFlowSuccess(parseSmokeSessionTrace(EMPTY_FAIL_SNIPPET))).toBe(false);
  });

  it("interrupted 无流式为失败", () => {
    expect(isSmokeFlowSuccess(parseSmokeSessionTrace(INTERRUPT_NO_STREAM))).toBe(false);
  });
});

describe("evaluateSmokeOutput", () => {
  it("router-gate：Session cancelled 仍判通过", () => {
    expect(evaluateSmokeOutput(ROUTER_GATE_SNIPPET).failed).toBe(false);
  });

  it("HITL flow：interrupted + streamed 判通过", () => {
    expect(evaluateSmokeOutput(INTERVIEW_SNIPPET).failed).toBe(false);
  });

  it("无 trace + Session cancelled 判失败", () => {
    expect(evaluateSmokeOutput(EMPTY_FAIL_SNIPPET).failed).toBe(true);
  });
});

describe("parseSmokeToolCalls", () => {
  it("解析 start/done 与 resultChars", () => {
    expect(parseSmokeToolCalls(TOOL_OK_SNIPPET)).toEqual([
      { name: "search__web_search", status: "start" },
      { name: "search__web_search", status: "done", resultChars: 1834 },
    ]);
  });

  it("无工具轨迹返回空数组", () => {
    expect(parseSmokeToolCalls(ROUTER_GATE_SNIPPET)).toEqual([]);
  });
});

describe("evaluateExpectedTool（SMOKE_EXPECT_TOOL 平台能力闸门）", () => {
  it("子串命中 + done 非空 → 通过", () => {
    expect(evaluateExpectedTool(TOOL_OK_SNIPPET, "search").failed).toBe(false);
    expect(evaluateExpectedTool(TOOL_OK_SNIPPET, "WEB_SEARCH").failed).toBe(false);
  });

  it("轨迹无该工具 → 失败", () => {
    const r = evaluateExpectedTool(ROUTER_GATE_SNIPPET, "search");
    expect(r.failed).toBe(true);
    expect(r.reason).toContain("未出现该工具调用");
  });

  it("工具 invoke failed → 失败", () => {
    const r = evaluateExpectedTool(TOOL_FAILED_SNIPPET, "search");
    expect(r.failed).toBe(true);
    expect(r.reason).toContain("调用失败");
  });

  it("只见 start 未见 done（卡住）→ 失败", () => {
    const onlyStart = TOOL_OK_SNIPPET.split("\n").filter((l) => !l.includes("invoke done")).join("\n");
    const r = evaluateExpectedTool(onlyStart, "search");
    expect(r.failed).toBe(true);
    expect(r.reason).toContain("未见 done");
  });

  it("done 但结果为空（resultChars=0）→ 失败", () => {
    const r = evaluateExpectedTool(TOOL_EMPTY_SNIPPET, "search");
    expect(r.failed).toBe(true);
    expect(r.reason).toContain("结果为空");
  });

  it("evaluateSmokeOutput：flow 绿但 expectTool 未命中 → 整体失败（防 LLM 兜底假绿）", () => {
    const ok = evaluateSmokeOutput(TOOL_OK_SNIPPET, { expectTool: "search" });
    expect(ok.failed).toBe(false);
    expect(ok.toolCalls?.some((c) => c.status === "done")).toBe(true);

    const fake = evaluateSmokeOutput(ROUTER_GATE_SNIPPET, { expectTool: "search" });
    expect(fake.failed).toBe(true);
    expect(fake.reason).toContain("SMOKE_EXPECT_TOOL");
  });

  it("不传 expectTool 行为不变（向后兼容）", () => {
    expect(evaluateSmokeOutput(TOOL_FAILED_SNIPPET).failed).toBe(false);
  });
});
