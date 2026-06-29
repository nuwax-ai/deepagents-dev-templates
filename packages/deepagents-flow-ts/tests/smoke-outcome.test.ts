import { describe, expect, it } from "vitest";
import { isSmokeFlowSuccess, parseSmokeSessionTrace, evaluateSmokeOutput } from "../scripts/lib/smoke-outcome.mjs";

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

  it("interview-agent interrupted + streamed + question 为成功", () => {
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

  it("interview-agent：interrupted + streamed 判通过", () => {
    expect(evaluateSmokeOutput(INTERVIEW_SNIPPET).failed).toBe(false);
  });

  it("无 trace + Session cancelled 判失败", () => {
    expect(evaluateSmokeOutput(EMPTY_FAIL_SNIPPET).failed).toBe(true);
  });
});
