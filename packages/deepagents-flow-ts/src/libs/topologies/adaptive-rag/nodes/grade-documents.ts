/**
 * grade_documents 节点 —— LLM 逐文档相关性评分（对齐官方 Adaptive RAG 的 GradeDocuments）。
 *
 * 与 rag/nodes/grade.ts 的"有非空内容即 sufficient"粗筛不同：本节点对每个检索文档单独让 LLM
 * 判 yes/no（相关/无关），过滤掉无关文档。全被滤掉 → grade=insufficient → 触发 transform_query 重写重检；
 * 有任一相关 → grade=sufficient → 进 prepare。
 *
 * 逐文档评分**并行**（Promise.all）；评分原语见 ./binary-grade.ts（与 grade_generation 共用）。
 * 无凭证 / 单次评分异常 → 保守保留该文档（defaultValue=true，不阻塞主流程）。
 */
import { type AppConfig } from "../../../../runtime/index.js";
import { requireModel, type ChatModelLike } from "../../../nodes/index.js";
import { logger } from "../../../../runtime/index.js";
import { gradeBinaryYesNo } from "./binary-grade.js";
import type { AdaptiveRAGState, RetrievalResult } from "./types.js";

const log = logger.child("adaptive-rag-grade-docs");

const GRADE_PROMPT = `你是文档相关性评分员。判断「检索到的文档」是否与「用户问题」相关。
只要文档包含与问题相关的关键词或语义，即判为相关（不必严苛，目的是过滤明显无关的误检索）。
只输出 JSON：{"binary_score": "yes" | "no"}`;

/** retrieve↔transform_query 循环上限（首次 + 重试次数）。达上限即便 insufficient 也放行 prepare。 */
export const MAX_RETRIEVE_ATTEMPTS = 2;

/**
 * grade_documents 节点：逐文档 LLM 评分过滤。
 * - 无 raw_results / 无凭证 → 退回简单非空检查（不阻塞）。
 * - 有凭证 → 并行逐文档评分（gradeBinaryYesNo，异常保守保留）。
 */
export async function gradeDocumentsNode(
  state: AdaptiveRAGState,
  appConfig?: AppConfig
): Promise<Partial<AdaptiveRAGState>> {
  const question = state.rewritten_query || state.query;
  const docs = state.raw_results ?? [];

  if (docs.length === 0) {
    return { raw_results: [], grade: "insufficient" };
  }

  // requireModel 无凭证会抛 → try/catch 退回非空检查（grade 是增强环节，无凭证不阻塞主流程）。
  let model: ChatModelLike | undefined;
  try {
    model = appConfig ? requireModel(appConfig, "adaptive-rag grade_documents") : undefined;
  } catch (err) {
    log.warn("no model for grade_documents, fallback to non-empty check", { error: String(err) });
    model = undefined;
  }

  if (!model) {
    const filtered = docs.filter(
      (d) => typeof d.content === "string" && d.content.trim().length > 0
    );
    return { raw_results: filtered, grade: filtered.length > 0 ? "sufficient" : "insufficient" };
  }

  const resolvedModel: ChatModelLike = model;
  // 并行逐文档评分：invokeWithResilience 内部 useSharedLimiter:true，并发不击穿速率闸门。
  // defaultValue=true：单文档评分异常时保守保留（宁留勿杀）。
  const verdicts = await Promise.all(
    docs.map((doc) =>
      gradeBinaryYesNo(resolvedModel, GRADE_PROMPT, `文档：\n${doc.content ?? ""}\n\n问题：${question}`, {
        appConfig,
        label: "grade_documents",
        defaultValue: true,
      })
    )
  );
  const filtered: RetrievalResult[] = docs.filter((_, i) => verdicts[i]);

  log.info("graded documents", { total: docs.length, relevant: filtered.length });
  return { raw_results: filtered, grade: filtered.length > 0 ? "sufficient" : "insufficient" };
}

/**
 * 纯函数条件边：grade_documents →（"transform_query" | "prepare"）
 * - insufficient 且 attempts < MAX_RETRIEVE_ATTEMPTS → transform_query（重写后重新检索）
 * - 否则 → prepare（即便不足也放行，由 generate 说明"上下文不足"）
 */
export function routeAfterGradeDocuments(state: AdaptiveRAGState): "transform_query" | "prepare" {
  const attempts = state.attempts ?? 0;
  if (state.grade === "insufficient" && attempts < MAX_RETRIEVE_ATTEMPTS) {
    log.info("routing to transform_query (retry)", { attempts });
    return "transform_query";
  }
  return "prepare";
}
