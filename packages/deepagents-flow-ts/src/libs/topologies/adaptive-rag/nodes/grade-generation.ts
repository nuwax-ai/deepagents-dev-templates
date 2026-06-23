/**
 * grade_generation 节点 —— 生成后幻觉 + 答案双评分（对齐官方 Adaptive RAG 的
 * grade_generation_v_documents_and_question）。
 *
 * 串行两步：
 *  1. hallucination_grader：生成是否 grounded in 检索事实？no → grade_generation="not_supported"（重生成）。
 *  2. answer_grader（仅当 grounded）：答案是否解决了问题？no → "not_useful"（重写重检）；yes → "useful"（结束）。
 *
 * 综合写 state.grade_generation，由纯函数条件边 routeAfterGradeGeneration 消费三路决策。
 * generation_attempts 上限保护：达上限即便未通过也放行 useful（防 generate↔generate 死循环）。
 * 无凭证 → 放行 useful（grade 是增强环节，不阻塞）。评分原语见 ./binary-grade.ts。
 */
import { type AppConfig } from "../../../../runtime/index.js";
import { requireModel, type ChatModelLike } from "../../../nodes/index.js";
import { logger } from "../../../../runtime/index.js";
import { gradeBinaryYesNo } from "./binary-grade.js";
import type { AdaptiveRAGState } from "./types.js";

const log = logger.child("adaptive-rag-grade-gen");

const HALLUCINATION_PROMPT = `你是事实核查员。判断「LLM 生成」是否基于/被支持于「检索到的事实集合」。
只输出 JSON：{"binary_score": "yes" | "no"}（yes = 生成有事实依据，no = 编造/无据）。`;

const ANSWER_PROMPT = `你是答案评分员。判断「答案」是否真正回答/解决了「用户问题」。
只输出 JSON：{"binary_score": "yes" | "no"}（yes = 解决了问题，no = 未解决）。`;

/** generate↔generate / generate↔transform_query 循环上限。达上限即便未通过也放行。 */
export const MAX_GENERATION_ATTEMPTS = 3;

/**
 * grade_generation 节点：幻觉 → 答案 两步评分 → 写 state.grade_generation。
 */
export async function gradeGenerationNode(
  state: AdaptiveRAGState,
  appConfig?: AppConfig
): Promise<Partial<AdaptiveRAGState>> {
  const question = state.rewritten_query || state.query;
  const documents = state.context ?? "";
  const generation = state.answer ?? "";
  const generation_attempts = (state.generation_attempts ?? 0) + 1;

  if (!generation) {
    return { grade_generation: "not_useful", generation_attempts };
  }

  // requireModel 无凭证会抛 → 退回放行 useful（增强环节不阻塞）。
  let model: ChatModelLike | undefined;
  try {
    model = appConfig ? requireModel(appConfig, "adaptive-rag grade_generation") : undefined;
  } catch (err) {
    log.warn("no model for grade_generation, pass through", { error: String(err) });
    model = undefined;
  }
  if (!model) {
    return { grade_generation: "useful", generation_attempts };
  }

  const resolvedModel: ChatModelLike = model;

  // 1. 幻觉检测（defaultValue=true：评分异常保守视为 grounded，继续答案评分，不无谓重生成）
  const grounded = await gradeBinaryYesNo(
    resolvedModel,
    HALLUCINATION_PROMPT,
    `事实集合：\n${documents}\n\nLLM 生成：${generation}`,
    { appConfig, label: "grade_generation", defaultValue: true }
  );
  if (!grounded) {
    log.info("generation not grounded, retry generate", { generation_attempts });
    return { grade_generation: "not_supported", hallucination_grade: "no", generation_attempts };
  }

  // 2. 答案评分（仅 grounded 时；defaultValue=true：评分抖动保守放行 useful）
  const useful = await gradeBinaryYesNo(
    resolvedModel,
    ANSWER_PROMPT,
    `用户问题：\n${question}\n\nLLM 生成：${generation}`,
    { appConfig, label: "grade_generation", defaultValue: true }
  );
  log.info("generation graded", { grounded: true, useful, generation_attempts });
  return {
    grade_generation: useful ? "useful" : "not_useful",
    hallucination_grade: "yes",
    answer_grade: useful ? "yes" : "no",
    generation_attempts,
  };
}

/**
 * 纯函数条件边：grade_generation →（"useful" | "not_supported" | "not_useful"）
 * - 达 MAX_GENERATION_ATTEMPTS 且未通过 → 强制 useful 放行（防死循环）
 * - 否则按 grade_generation 原值路由
 *
 * 映射对象：{ useful: END, not_supported: "generate", not_useful: "transform_query" }（见 graph.ts）。
 */
export function routeAfterGradeGeneration(
  state: AdaptiveRAGState
): "useful" | "not_supported" | "not_useful" {
  const g = state.grade_generation ?? "useful";
  if ((state.generation_attempts ?? 0) >= MAX_GENERATION_ATTEMPTS && g !== "useful") {
    log.info("generation attempts reached max, force pass", {
      attempts: state.generation_attempts,
      original: g,
    });
    return "useful";
  }
  return g;
}
