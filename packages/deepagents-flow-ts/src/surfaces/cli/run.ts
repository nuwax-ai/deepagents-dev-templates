/**
 * Flow CLI — 命令行跑一次工作流（与具体图解耦）。
 *
 * 用法：
 *   tsx src/index.ts flow "你的输入"
 *   tsx src/index.ts flow --interactive
 */

import { createInterface } from "node:readline";
import type { FlowExecutor } from "../flow-types.js";

export interface FlowCliOptions {
  query?: string;
  interactive?: boolean;
  /** 无参时显示的用法提示（默认指向 src/index.ts flow） */
  usage?: string;
}

export async function runFlowCli(
  executor: FlowExecutor,
  options: FlowCliOptions = {}
): Promise<void> {
  const ask = async (q: string): Promise<void> => {
    process.stdout.write(`\n❓ ${q}\n⏳ 处理中...\n\n`);
    // CLI 非流式：不传 onToken，由 executor 返回完整结果
    const result = await executor(q, {
      onToolCall: (e) => {
        const tag =
          e.status === "in_progress" ? "▶" : e.status === "completed" ? "✓" : "✗";
        process.stdout.write(`${tag} ${e.toolName}${e.status === "in_progress" ? " …\n" : "\n"}`);
      },
    });
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
    process.stdout.write(
      options.usage ??
        '用法：\n  tsx src/index.ts flow "你的输入"\n  tsx src/index.ts flow --interactive\n'
    );
  }
}
