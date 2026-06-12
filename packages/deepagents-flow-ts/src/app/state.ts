/**
 * 默认 flow 的状态（图的 channels）。
 *
 * 这是占位示例——换成你自己的字段即可。注意：channel 名不要和节点名相同
 * （LangGraph 限制），所以判定字段叫 `decision`，节点叫 `decide`。
 */

import { BaseMessage } from "@langchain/core/messages";

export interface FlowState {
  /** 输入 */
  input: string;
  history?: BaseMessage[];

  /** act 累积的步骤 / 中间结果 */
  steps?: string[];

  /** 编排控制（条件边） */
  attempts?: number; // act 执行轮次
  decision?: string; // decide 判定：done | retry

  /** 最终输出 */
  output?: string;
}
