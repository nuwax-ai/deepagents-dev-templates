/**
 * smoke:acp 输出解析 —— 从 rcoder/runtime 日志判断 flow 是否实质跑通。
 *
 * rcoder 常在 turn 正常结束后仍打 `Session cancelled` / `Prompt ended with error`（exit 0），
 * 不能单靠这些字符串判失败。以 session-trace 的 flowStatus + 产出/流式指标为准。
 */

/** @typedef {{ flowStatus?: string; outputChars?: number; answerChars?: number; questionChars?: number; streamed?: boolean; streamChars?: number; tokenChunks?: number }} SmokeFlowTrace */

const TRACE_LINE_RE = /(?:flow\.run done|prompt_end)[^\n]*/g;

function parseTraceField(line, key) {
  const m = line.match(new RegExp(`\\b${key}=([^\\s]+)`));
  if (!m) return undefined;
  const raw = m[1];
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

/**
 * 从 smoke 合并输出解析最后一次 session-trace 摘要。
 * 优先 `prompt_end`（turn 终态），其次 `flow.run done`。
 * @param {string} text
 * @returns {SmokeFlowTrace | null}
 */
export function parseSmokeSessionTrace(text) {
  if (typeof text !== "string" || !text.trim()) return null;

  let flowRunLine = "";
  let promptEndLine = "";
  for (const m of text.matchAll(TRACE_LINE_RE)) {
    const line = m[0];
    if (line.includes("flow.run done")) flowRunLine = line;
    if (line.includes("prompt_end")) promptEndLine = line;
  }

  if (!flowRunLine && !promptEndLine) return null;

  /** @type {SmokeFlowTrace} */
  const merged = {};
  const apply = (line) => {
    if (!line) return;
    for (const key of [
      "flowStatus",
      "outputChars",
      "answerChars",
      "questionChars",
      "streamed",
      "streamChars",
      "tokenChunks",
    ]) {
      const v = parseTraceField(line, key);
      if (v !== undefined) merged[key] = v;
    }
  };
  // flow.run done 常有 outputChars/questionChars；prompt_end 常有 streamed/streamChars
  apply(flowRunLine);
  apply(promptEndLine);

  if (typeof merged.flowStatus !== "string") return null;
  return merged;
}

/**
 * flow 是否算 smoke 通过（允许 HITL interrupt + 流式出题）。
 * @param {SmokeFlowTrace | null} trace
 */
export function isSmokeFlowSuccess(trace) {
  if (!trace?.flowStatus) return false;

  const hasStreamedContent =
    trace.streamed === true && ((trace.streamChars ?? 0) > 0 || (trace.tokenChunks ?? 0) > 0);

  if (trace.flowStatus === "done") {
    if ((trace.outputChars ?? 0) > 0 || (trace.answerChars ?? 0) > 0) return true;
    return hasStreamedContent;
  }

  if (trace.flowStatus === "interrupted") {
    // HITL：outputChars/answerChars 常为 0；有流式出题或 question 文本即通过
    if ((trace.questionChars ?? 0) > 0) return true;
    return hasStreamedContent;
  }

  return false;
}

/** smoke-acp 用的失败特征（与 evaluateSmokeOutput 配套）。 */
export const SMOKE_FAIL_SIGNATURES = [
  { re: /Prompt ended with error/, reason: "rcoder: Prompt ended with error", rcoderNoise: true },
  { re: /Session cancelled/, reason: "agent 会话被取消（多为空答/异常）", rcoderNoise: true },
  { re: /\banswerChars=0\b/, reason: "agent 最终答案为空（answerChars=0）", skipIfInterrupted: true },
  { re: /\boutputChars=0\b/, reason: "flow 输出为空（outputChars=0）", skipIfInterrupted: true },
];

/** @typedef {{ name: string; status: "start" | "done" | "failed"; resultChars?: number }} SmokeToolCall */

// session-trace 的工具摘要行：`tool invoke start|done|failed  toolName=xxx …`
const TOOL_LINE_RE = /tool invoke (start|done|failed)[^\n]*/g;

/**
 * 解析工具调用轨迹。SMOKE_EXPECT_TOOL 下由子进程 SMOKE_TOOL_TRACE=1 以 info 级输出
 * 脱敏摘要；正常运行时仍为 debug 级。
 * @param {string} text
 * @returns {SmokeToolCall[]}
 */
export function parseSmokeToolCalls(text) {
  if (typeof text !== "string" || !text.trim()) return [];
  /** @type {SmokeToolCall[]} */
  const calls = [];
  for (const m of text.matchAll(TOOL_LINE_RE)) {
    const line = m[0];
    const name = line.match(/\btoolName=([^\s]+)/)?.[1];
    if (!name) continue;
    /** @type {SmokeToolCall} */
    const call = { name, status: /** @type {SmokeToolCall["status"]} */ (m[1]) };
    const resultChars = line.match(/\bresultChars=(\d+)/)?.[1];
    if (resultChars !== undefined) call.resultChars = Number(resultChars);
    calls.push(call);
  }
  return calls;
}

/**
 * SMOKE_EXPECT_TOOL 断言（平台能力真实调用闸门）：
 * 轨迹须出现名称含 expect（大小写不敏感子串）的工具调用，至少一次 done 且结果非空、无 failed。
 * @param {string} combined
 * @param {string} expect
 * @returns {{ failed: boolean; reason: string; calls: SmokeToolCall[] }}
 */
export function evaluateExpectedTool(combined, expect) {
  const want = String(expect ?? "").trim().toLowerCase();
  if (!want) return { failed: false, reason: "", calls: [] };
  const calls = parseSmokeToolCalls(combined).filter((c) =>
    c.name.toLowerCase().includes(want)
  );
  if (!calls.length) {
    return {
      failed: true,
      reason: `SMOKE_EXPECT_TOOL="${expect}"：轨迹未出现该工具调用（检查 SMOKE_PROMPT 是否能触发该能力、能力是否已登记/下发、SMOKE_TOOL_TRACE 是否生效）`,
      calls,
    };
  }
  const failedCall = calls.find((c) => c.status === "failed");
  if (failedCall) {
    return {
      failed: true,
      reason: `SMOKE_EXPECT_TOOL="${expect}"：工具 ${failedCall.name} 调用失败（tool invoke failed）`,
      calls,
    };
  }
  const doneCalls = calls.filter((c) => c.status === "done");
  if (!doneCalls.length) {
    return {
      failed: true,
      reason: `SMOKE_EXPECT_TOOL="${expect}"：工具 ${calls[0].name} 只见 start 未见 done（可能卡住/超时）`,
      calls,
    };
  }
  if (doneCalls.every((c) => (c.resultChars ?? 0) === 0)) {
    return {
      failed: true,
      reason: `SMOKE_EXPECT_TOOL="${expect}"：工具 ${doneCalls[0].name} 调用完成但结果为空（resultChars=0）`,
      calls,
    };
  }
  return { failed: false, reason: "", calls };
}

/**
 * @param {string} combined
 * @param {{ expectTool?: string }} [opts]
 * @returns {{ failed: boolean; reason: string; trace: SmokeFlowTrace | null; toolCalls?: SmokeToolCall[] }}
 */
export function evaluateSmokeOutput(combined, opts = {}) {
  const trace = parseSmokeSessionTrace(combined);
  const success = isSmokeFlowSuccess(trace);
  // 平台能力闸门：flow 绿也必须过工具断言（LLM 兜底输出会让 flow 假绿）
  const toolCheck = opts.expectTool ? evaluateExpectedTool(combined, opts.expectTool) : null;

  if (success) {
    if (toolCheck?.failed) {
      return { failed: true, reason: toolCheck.reason, trace, toolCalls: toolCheck.calls };
    }
    return { failed: false, reason: "", trace, toolCalls: toolCheck?.calls };
  }

  for (const { re, reason, rcoderNoise, skipIfInterrupted } of SMOKE_FAIL_SIGNATURES) {
    if (skipIfInterrupted && trace?.flowStatus === "interrupted") continue;
    if (rcoderNoise && trace) continue;
    if (re.test(combined)) return { failed: true, reason, trace };
  }

  if (trace?.flowStatus === "interrupted") {
    return {
      failed: true,
      reason: "HITL interrupt 但未检测到流式输出或 questionChars（interrupted 且无 streamed/question）",
      trace,
    };
  }

  if (toolCheck?.failed) {
    return { failed: true, reason: toolCheck.reason, trace, toolCalls: toolCheck.calls };
  }

  return { failed: false, reason: "", trace, toolCalls: toolCheck?.calls };
}
