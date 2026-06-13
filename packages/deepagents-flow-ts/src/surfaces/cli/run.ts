/**
 * Flow CLI — 命令行跑一次工作流（与具体图解耦）。
 *
 * 支持两种 flow：
 *  - one-shot FlowExecutor：单输入 → 单输出（默认图 / RAG / router 等）。
 *  - StatefulFlow：human-in-the-loop —— 图 interrupt 暂停时，CLI 用 readline 采集用户回复、
 *    再 resume，直到跑到底（见 examples/human-in-loop）。
 *
 * 用法：
 *   tsx src/index.ts flow "你的输入"
 *   tsx src/index.ts flow --interactive
 */

import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { FlowExecutor, StatefulFlow, FlowCallbacks } from "../flow-types.js";

export interface FlowCliOptions {
  query?: string;
  interactive?: boolean;
  /** 无参时显示的用法提示（默认指向 src/index.ts flow） */
  usage?: string;
}

const DEFAULT_USAGE =
  '用法：\n  tsx src/index.ts flow "你的输入"\n  tsx src/index.ts flow --interactive\n';

/** 工具调用过程打印（▶ 进行中 / ✓ 完成 / ✗ 失败）——one-shot 与 stateful 共用。 */
const toolCallbacks: FlowCallbacks = {
  onToolCall: (e) => {
    const tag =
      e.status === "in_progress" ? "▶" : e.status === "completed" ? "✓" : "✗";
    process.stdout.write(
      `${tag} ${e.toolName}${e.status === "in_progress" ? " …\n" : "\n"}`
    );
  },
};

export async function runFlowCli(
  flow: FlowExecutor | StatefulFlow,
  options: FlowCliOptions = {}
): Promise<void> {
  // 对象（有 run）⇒ StatefulFlow（支持 HITL）；function ⇒ one-shot。
  if (typeof flow !== "function") {
    return runStatefulCli(flow, options);
  }

  const ask = async (q: string): Promise<void> => {
    process.stdout.write(`\n❓ ${q}\n⏳ 处理中...\n\n`);
    // CLI 非流式：不传 onToken，由 executor 返回完整结果
    const result = await flow(q, toolCallbacks);
    process.stdout.write("📝 回答：\n");
    process.stdout.write(result.answer + (result.footer ?? "") + "\n");
  };

  if (options.interactive) {
    process.stdout.write("🤖 工作流交互模式（输入 'exit' 退出）\n");
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const loop = () => {
      rl.question("❓ ", async (input) => {
        const q = input.trim();
        if (q === "exit" || q === "quit") {
          rl.close();
          return;
        }
        if (q) await ask(q);
        loop();
      });
    };
    loop();
  } else if (options.query) {
    await ask(options.query);
  } else {
    process.stdout.write(options.usage ?? DEFAULT_USAGE);
  }
}

/**
 * StatefulFlow 的 CLI 驱动：起跑 → 遇 interrupt 就显示问题、readline 采集回复 → resume，
 * 循环到 done。同一会话用一个 threadId（图 checkpointer 据此续接状态）。
 */
async function runStatefulCli(
  flow: StatefulFlow,
  options: FlowCliOptions
): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const prompt = (p: string): Promise<string> =>
    new Promise((resolve) => rl.question(p, resolve));
  const threadId = randomUUID();

  // 驱动一轮完整对话：首个 input 起跑，遇 interrupt 就问用户并 resume，直到 done。
  const drive = async (first: {
    query?: string;
    resume?: string;
  }): Promise<void> => {
    let input = first;
    while (true) {
      const res = await flow.run(input, threadId, toolCallbacks);
      if (res.status === "done") {
        process.stdout.write("📝 回答：\n");
        process.stdout.write(res.answer + (res.footer ?? "") + "\n");
        return;
      }
      // interrupted：显示问题，采集回复作为 resume
      process.stdout.write(`\n⏸️  ${res.question}\n`);
      const reply = (await prompt("↳ ")).trim();
      input = { resume: reply };
    }
  };

  try {
    if (options.interactive) {
      process.stdout.write(
        "🤖 工作流交互模式（human-in-the-loop；输入 'exit' 退出）\n"
      );
      while (true) {
        const q = (await prompt("❓ ")).trim();
        if (q === "exit" || q === "quit") break;
        if (q) {
          process.stdout.write("⏳ 处理中...\n");
          await drive({ query: q });
        }
      }
    } else if (options.query) {
      process.stdout.write(`\n❓ ${options.query}\n⏳ 处理中...\n`);
      await drive({ query: options.query });
    } else {
      process.stdout.write(options.usage ?? DEFAULT_USAGE);
    }
  } finally {
    rl.close();
  }
}
