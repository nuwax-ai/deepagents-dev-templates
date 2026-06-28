/**
 * 范例注册表 —— `pnpm example <name>` 与 `pnpm smoke -- --example <name>` 共用。
 * name 为短别名；entry 为相对包根的路径；cli 为 CLI 子命令（无则直接转发 argv）。
 */
export const EXAMPLES = {
  rag: {
    entry: "examples/rag/index.ts",
    cli: "rag",
    description: "RAG 检索增强问答",
  },
  travel: {
    entry: "examples/travel-planner/index.ts",
    cli: "plan",
    description: "旅行规划（map-reduce + HITL）",
  },
  pm: {
    entry: "examples/project-manager/index.ts",
    cli: "plan",
    description: "项目管理（评估循环 + HITL）",
  },
  review: {
    entry: "examples/human-in-loop/index.ts",
    cli: "review",
    description: "人审草稿（HITL）",
  },
  "dev-agent": {
    entry: "examples/dev-agent/index.ts",
    cli: null,
    description: "综合能力 dev-agent",
  },
  research: {
    entry: "examples/deep-research/index.ts",
    cli: "research",
    description: "深度研究报告",
  },
};

/** 目录名 → 短别名（便于记路径时解析） */
const ALIASES = {
  "travel-planner": "travel",
  "project-manager": "pm",
  "human-in-loop": "review",
  "deep-research": "research",
};

/**
 * @param {string} name
 * @returns {{ key: string, entry: string, cli: string | null, description: string } | null}
 */
export function resolveExample(name) {
  const key = ALIASES[name] ?? name;
  const spec = EXAMPLES[key];
  if (!spec) return null;
  return { key, ...spec };
}

/**
 * 有 query / -i 时插入 CLI 子命令；否则走 ACP 模式（仅启动服务）。
 * dev-agent 无子命令，始终原样转发。
 *
 * @param {string | null} cli
 * @param {string[]} userArgs
 * @returns {string[]}
 */
export function buildExampleArgv(cli, userArgs) {
  if (!cli) return userArgs;

  const hasInteractive = userArgs.some((a) => a === "-i" || a === "--interactive");
  const positional = userArgs.filter((a) => !a.startsWith("-"));
  const wantsCli = hasInteractive || positional.length > 0;

  return wantsCli ? [cli, ...userArgs] : userArgs;
}

export function listExamples() {
  return Object.entries(EXAMPLES).map(([key, spec]) => ({
    name: key,
    entry: spec.entry,
    cli: spec.cli,
    description: spec.description,
  }));
}
