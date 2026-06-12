/**
 * 内置 demo 工具注册表 —— 让 act 节点能演示「工具调用」,不依赖 MCP / 外部服务。
 *
 * 默认 config 无需配 MCP 即可跑通。真实模板里换成你自己的工具(MCP / API / 本地函数);
 * act 节点的调用方式(onToolCall 透出 + runDemoTool 执行)保持不变。
 */

export interface DemoTool {
  name: string;
  description: string;
  run: (args: Record<string, unknown>) => string;
}

/** 安全算术求值:仅允许数字、加减乘除、()、小数点与空白;其余字符直接报错(绝不 eval 任意代码)。 */
function safeCalc(expression: string): string {
  const expr = expression.replace(/\s+/g, "");
  if (!expr || !/^[-+/*().0-9]+$/.test(expr)) {
    throw new Error(`calculate: unsupported expression "${expression}"`);
  }
  // 字符集已严格限定为数字与运算符 → Function 求值安全(无法调用任意函数)。
  const value = Function(`"use strict"; return (${expr});`)();
  return String(value);
}

export const DEMO_TOOLS: Record<string, DemoTool> = {
  echo: {
    name: "echo",
    description: "原样回显 {text}。",
    run: (a) => String(a.text ?? a.value ?? ""),
  },
  calculate: {
    name: "calculate",
    description: "算术求值 {expression},如 '2 + 3 * 4'。",
    run: (a) => safeCalc(String(a.expression ?? "0")),
  },
  time: {
    name: "time",
    description: "返回当前 ISO 时间(演示无参工具)。",
    run: () => new Date().toISOString(),
  },
};

/** 执行一个 demo 工具;未知工具抛错(由 act 节点捕获并标记 failed)。 */
export function runDemoTool(name: string, args: Record<string, unknown>): string {
  const tool = DEMO_TOOLS[name];
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.run(args);
}
