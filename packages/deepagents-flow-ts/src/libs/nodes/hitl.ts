/**
 * createHumanApprovalNode —— HITL 审批节点（interrupt + isApproval）。
 *
 * 泛化 review / approve / confirm / clarify 等人审节点：
 *  - 简单写回：`{ question, write? }` → 默认写 { feedback }；
 *  - 路由变体：`{ question, route }` → 返回 Command | 节点名（按 approved + feedback 决定去向）。
 * 默认 APPROVAL_RE 内置中英文通过词；opts.regex 覆盖。
 */

import { Command, interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { FlowCallbacks } from "../../core/flow-types.js";

const APPROVAL_RE = /^(ok|okay|通过|可以|批准|approved?|confirm(ed)?|yes|好的?|lgtm)$/i;

export function isApproval(
  feedback: string,
  opts?: { regex?: RegExp }
): boolean {
  const re = opts?.regex ?? APPROVAL_RE;
  const fb = feedback.trim();
  return !fb || re.test(fb);
}

export interface HumanApprovalNodeOptions<S> {
  /** interrupt 载荷：字符串（包成 {question}）或完整 payload 对象。 */
  question: (state: S) => string | Record<string, unknown>;
  /** 自定义通过判定词。 */
  regex?: RegExp;
  /** 简单写回（默认 { feedback }）。与 route 二选一。 */
  write?: (feedback: string, approved: boolean, state: S) => Partial<S>;
  /** 路由变体：返回 Command（含 goto + update）。与 write 二选一。 */
  route?: (approved: boolean, feedback: string, state: S) => Command;
}

export function createHumanApprovalNode<S>(
  opts: HumanApprovalNodeOptions<S>
) {
  const { question, regex, write, route } = opts;
  return (state: S): Partial<S> | Command => {
    const q = question(state);
    const payload = typeof q === "string" ? { question: q } : q;
    const feedback = String(interrupt(payload) ?? "").trim();
    const approved = isApproval(feedback, regex ? { regex } : undefined);
    if (route) return route(approved, feedback, state);
    if (write) return write(feedback, approved, state);
    return { feedback } as unknown as Partial<S>;
  };
}

/**
 * createPermissionApprovalNode —— 弹窗式审批节点（同步门控，非 interrupt）。
 *
 * 与 createHumanApprovalNode（前置 interrupt，跨轮对话式）互补：本节点经
 * `configurable.onApprovalRequest`（ACP surface 注入）**同 turn 同步**弹
 * `session/request_permission` 征询确认，用户点选项即决（不结束 turn、不等下一轮消息）。
 * 适合秒级 yes/no（如"确认发布?"）。复用工具审批（A）的同步弹窗通道；
 * 未注入回调（CLI / 非 ACP）→ 默认放行（graceful，与工具审批一致）。
 *
 * @example
 * const confirm = createPermissionApprovalNode<S>({
 *   request: (s) => ({ title: "确认发布?", detail: s.draft }),
 *   approved: (s) => new Command({ goto: "publish" }),
 *   rejected: (s) => new Command({ goto: "revise" }),
 * });
 */
export interface PermissionApprovalNodeOptions<S> {
  /** 弹窗内容：字符串（作 title）或 { title, detail }。 */
  request: (state: S) => string | { title: string; detail?: string };
  /** 通过（allow）时的写回 / 路由。 */
  approved: (state: S) => Partial<S> | Command;
  /** 拒绝 / 取消（reject / cancelled）时的写回 / 路由。 */
  rejected: (state: S) => Partial<S> | Command;
}

export function createPermissionApprovalNode<S>(
  opts: PermissionApprovalNodeOptions<S>
) {
  return async (
    state: S,
    config?: LangGraphRunnableConfig
  ): Promise<Partial<S> | Command> => {
    const onApprovalRequest = config?.configurable
      ?.onApprovalRequest as FlowCallbacks["onApprovalRequest"];
    const req = opts.request(state);
    const event = typeof req === "string" ? { title: req } : req;
    // 未注入回调（CLI / 非 ACP surface）→ 默认放行（graceful，与工具审批 A 一致）。
    const decision = onApprovalRequest ? await onApprovalRequest(event) : "allow";
    return decision === "allow" ? opts.approved(state) : opts.rejected(state);
  };
}
