/**
 * createHumanApprovalNode —— HITL 审批节点（interrupt + isApproval）。
 *
 * 泛化 review / approve / confirm / clarify 等人审节点：
 *  - 简单写回：`{ question, write? }` → 默认写 { feedback }；
 *  - 路由变体：`{ question, route }` → 返回 Command | 节点名（按 approved + feedback 决定去向）。
 * 默认 APPROVAL_RE 内置中英文通过词；opts.regex 覆盖。
 */

import { Command, interrupt } from "@langchain/langgraph";

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
