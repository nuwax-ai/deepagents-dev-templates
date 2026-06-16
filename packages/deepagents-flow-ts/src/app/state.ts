/**
 * 默认 flow 的状态（LangGraph ReAct）。
 *
 * messages: 标准消息流——直接展开 LangGraph 原生 MessagesAnnotation.spec（含
 *           messagesStateReducer + 默认值），自动进 checkpointer，上下文压缩 /
 *           持久化 / ToolMessage 都操作这条标准通道。
 * input:    本次用户输入（prepare 转 HumanMessage 加入 messages）。
 * output:   最终回答（respond 节点写入，供非流式 surface）。
 * steps:    人类可读轨迹（便于测试 / 展示）。
 */

import { Annotation, MessagesAnnotation } from "@langchain/langgraph";

const lastValue = <T>(_: T, n: T): T => n;

export const FlowStateAnnotation = Annotation.Root({
  ...MessagesAnnotation.spec,
  input: Annotation<string>({ value: lastValue<string>, default: () => "" }),
  output: Annotation<string>({ value: lastValue<string>, default: () => "" }),
  steps: Annotation<string[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});

export type FlowState = typeof FlowStateAnnotation.State;
