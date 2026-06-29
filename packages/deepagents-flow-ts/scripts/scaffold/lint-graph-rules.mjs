/**
 * custom spec 图编排规则静态检查（生成前 gate）。
 *
 * 规则权威：docs/flow-graph-rules.md
 * 当前实现：R-G001（parse 仅当 write/route 消费 parsed）、R-G007（节点名 ≠ state channel）、
 * R-G009（llm-stream / approval-finalize.rejectedLlm 的 write 须用 r.text）
 */

/** write 是否读取流式 LLM 结果（r.text）。 */
export function writeUsesStreamText(writeSrc) {
  if (typeof writeSrc !== "string" || !writeSrc.trim()) return false;
  return /\br\.text\b/.test(writeSrc) || /\br\?\.text\b/.test(writeSrc);
}

/** write 是否仍读取一次性 LLM 结果（r.content）—— llm-stream 路径禁止。 */
export function writeUsesLlmContent(writeSrc) {
  if (typeof writeSrc !== "string" || !writeSrc.trim()) return false;
  return /\br\.content\b/.test(writeSrc) || /\br\?\.content\b/.test(writeSrc);
}

/** write 是否读取 LLM 解析结果（r.parsed 或从 r 解构 parsed）。 */
export function writeConsumesParsed(writeSrc) {
  if (typeof writeSrc !== "string" || !writeSrc.trim()) return false;
  return (
    /\br\.parsed\b/.test(writeSrc) ||
    /\br\?\.parsed\b/.test(writeSrc) ||
    /\{[^}]*\bparsed\b[^}]*\}\s*=\s*r\b/.test(writeSrc)
  );
}

/** llm-router 的 route(parsed) 是否使用 parsed 参数。 */
export function routeConsumesParsed(routeSrc) {
  if (typeof routeSrc !== "string" || !routeSrc.trim()) return false;
  return /\bparsed\b/.test(routeSrc);
}

/**
 * 对已通过 zod 的 spec 跑图规则 lint。
 * @returns {{ errors: Array<{ rule: string, node?: string, message: string }>, warnings: typeof errors }}
 */
export function lintGraphRules(spec) {
  const errors = [];
  const warnings = [];

  if (spec.topology !== "custom") return { errors, warnings };

  const stateChannels = new Set(Object.keys(spec.params?.state ?? {}));
  const nodes = spec.params?.nodes ?? {};

  for (const nodeName of Object.keys(nodes)) {
    if (stateChannels.has(nodeName)) {
      errors.push({
        rule: "R-G007",
        node: nodeName,
        message:
          `节点名 "${nodeName}" 与 state channel 同名；LangGraph 会拒绝 addNode。` +
          `请重命名节点（如 writeReport）或 channel（见 docs/flow-graph-rules.md#r-g007）。`,
      });
    }
  }

  for (const [nodeName, node] of Object.entries(nodes)) {
    const p = node.params ?? {};

    if (node.type === "llm" && p.parse != null) {
      if (!writeConsumesParsed(p.write)) {
        errors.push({
          rule: "R-G001",
          node: nodeName,
          message:
            `节点 "${nodeName}" 配置了 parse 但 write 未读取 r.parsed；` +
            `只用 r.content 时请删除 parse，或让 write 消费 r.parsed（见 docs/flow-graph-rules.md#r-g001）。`,
        });
      }
    }

    if (node.type === "llm-stream") {
      if (!writeUsesStreamText(p.write)) {
        errors.push({
          rule: "R-G009",
          node: nodeName,
          message:
            `节点 "${nodeName}" 为 llm-stream，write 须读取 r.text（createLlmStreamNode 写回签名）。`,
        });
      }
      if (writeUsesLlmContent(p.write)) {
        errors.push({
          rule: "R-G009",
          node: nodeName,
          message:
            `节点 "${nodeName}" 为 llm-stream，write 不得使用 r.content；请改为 r.text。`,
        });
      }
    }

    if (node.type === "llm-router" && p.parse != null) {
      if (!routeConsumesParsed(p.route)) {
        errors.push({
          rule: "R-G001",
          node: nodeName,
          message:
            `节点 "${nodeName}" 配置了 parse 但 route 未使用 parsed 参数；` +
            `删除 parse 或让 route(parsed) 消费解析结果。`,
        });
      }
    }

    if (node.type === "approval-finalize") {
      const rejected = p.rejectedLlm ?? {};
      if (rejected.parse != null) {
        errors.push({
          rule: "R-G009",
          node: nodeName,
          message:
            `节点 "${nodeName}".rejectedLlm 走 createLlmStreamNode，不支持 parse；删除 parse 或改用 llm 节点。`,
        });
      }
      if (rejected.write != null) {
        if (!writeUsesStreamText(rejected.write)) {
          errors.push({
            rule: "R-G009",
            node: nodeName,
            message:
              `节点 "${nodeName}".rejectedLlm.write 须读取 r.text（createLlmStreamNode 写回签名）。`,
          });
        }
        if (writeUsesLlmContent(rejected.write)) {
          errors.push({
            rule: "R-G009",
            node: nodeName,
            message:
              `节点 "${nodeName}".rejectedLlm.write 不得使用 r.content；请改为 r.text。`,
          });
        }
      }
    }
  }

  return { errors, warnings };
}

/** lint 失败时抛出可读错误（供 generate.mjs / 单测）。 */
export function assertGraphRules(spec) {
  const { errors, warnings } = lintGraphRules(spec);
  for (const w of warnings) {
    console.warn(`⚠️  [${w.rule}]${w.node ? ` ${w.node}:` : ""} ${w.message}`);
  }
  if (errors.length === 0) return;
  const lines = errors.map((e) => `  [${e.rule}]${e.node ? ` ${e.node}:` : ""} ${e.message}`);
  throw new Error(`图编排规则校验失败（${errors.length}）：\n${lines.join("\n")}`);
}
