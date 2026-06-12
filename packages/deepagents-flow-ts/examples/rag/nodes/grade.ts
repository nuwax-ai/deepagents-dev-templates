/**
 * Grade 节点 + 条件路由 - 工作流编排的核心展示点
 *
 * 这是本模板想强调的"按设计好的节点连线规则运行"的关键：
 * grade 之后用 `addConditionalEdges` 在运行时决定走哪条边——
 * 检索不足就回到 rewrite 再试一轮，足够就进入 prepare。
 *
 * 这把一条直线流水线变成了带反馈环的图，且用 attempts 上限保证收敛。
 */

import { logger } from "deepagents-app-ts/runtime";
import type { RAGState } from "./types.js";

const log = logger.child("rag-grade");

/** retrieve 后的最大尝试次数（首次 + 重试）。达到上限即放行到 prepare，避免死循环。 */
export const MAX_RETRIEVE_ATTEMPTS = 2;

/**
 * Grade 节点：评估检索结果是否足够。
 * 示例策略——只要有非空内容即视为 sufficient；真实项目可替换为
 * 相关性打分 / LLM 评判 / 阈值判断。
 */
export function gradeNode(state: RAGState): Partial<RAGState> {
  const results = state.raw_results ?? [];
  const hasContent = results.some(
    (r) => typeof r.content === "string" && r.content.trim().length > 0
  );
  const grade = hasContent ? "sufficient" : "insufficient";

  log.info("Graded retrieval", {
    grade,
    resultCount: results.length,
    attempts: state.attempts ?? 0,
  });

  return { grade };
}

/**
 * 条件边路由：grade →（"rewrite" 重试 | "prepare" 放行）
 * - insufficient 且尝试次数未达上限 → 回到 rewrite 再试一轮
 * - 否则 → prepare（即便不足也放行，由 generate 负责说明"上下文不足"）
 */
export function routeAfterGrade(state: RAGState): "rewrite" | "prepare" {
  const attempts = state.attempts ?? 0;
  if (state.grade === "insufficient" && attempts < MAX_RETRIEVE_ATTEMPTS) {
    log.info("Routing back to rewrite (retry)", { attempts });
    return "rewrite";
  }
  log.info("Routing to prepare", { attempts, grade: state.grade });
  return "prepare";
}
