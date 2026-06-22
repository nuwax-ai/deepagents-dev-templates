/**
 * content-review — human-in-loop 拓扑（scaffold 生成，可手改）
 * 内容审阅定稿：生成初稿 → 人审 → 按意见定稿（stateful）
 *
 * 图逻辑单一权威在 src/libs/topologies/human-in-loop/；本文件只绑 spec。
 * systemPrompt 注入 compose 节点（spec 场景优先；spec 空时图用领域默认 DEFAULT_COMPOSE_PROMPT）。
 */
import type { FlowRuntime } from "../../../runtime/flow-runtime.js";
import type { StatefulTopologyRecipe } from "../../../libs/topologies/types.js";
import {
  reviewRecipe,
  getReviewTopology,
} from "../../../libs/topologies/human-in-loop/index.js";

/** compose 节点场景系统提示词（spec.systemPrompt）；spec 空时为 undefined，图回退领域默认。 */
const FALLBACK_SYSTEM_PROMPT = "你是资深内容编辑。根据用户要求撰写高质量初稿，结构清晰、语言精炼，直接给正文，不要寒暄。";

// as StatefulTopologyRecipe：边界处擦除具体 state 泛型（注册表/createStatefulFlow 都是泛型，
// 不携带具体 ReviewStateType；toResult 在 S 上逆变，具体类型不能直接赋 Record，故擦除）。
export const recipe = (runtime: FlowRuntime): StatefulTopologyRecipe =>
  reviewRecipe(runtime, {
    systemPrompt: FALLBACK_SYSTEM_PROMPT,
  }) as StatefulTopologyRecipe;

export const getTopology = () => getReviewTopology();
