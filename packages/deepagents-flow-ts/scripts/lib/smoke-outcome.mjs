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

/**
 * @param {string} combined
 * @returns {{ failed: boolean; reason: string; trace: SmokeFlowTrace | null }}
 */
export function evaluateSmokeOutput(combined) {
  const trace = parseSmokeSessionTrace(combined);
  const success = isSmokeFlowSuccess(trace);

  if (success) {
    return { failed: false, reason: "", trace };
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

  return { failed: false, reason: "", trace };
}
